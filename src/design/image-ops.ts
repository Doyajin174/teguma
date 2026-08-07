/**
 * Deterministic pixel operations for design assets.
 *
 * pngjs exposes straight (unassociated) RGBA. Resampling converts samples to
 * premultiplied alpha while averaging, then converts back to straight RGBA.
 * That avoids the dark fringe produced by averaging transparent pixels' RGB
 * values directly. Downscales use an area/box filter to retain the average of
 * covered source pixels; upscales use bilinear interpolation for smooth,
 * deterministic enlargement without the blockiness of nearest-neighbour.
 */

import { PNG } from "pngjs";

/** Kept in step with export.ts so an MCP call cannot allocate an unbounded raster. */
export const MAX_IMAGE_RASTER_DIMENSION = 8_192;
export const MAX_IMAGE_PIXELS = 16_000_000;

export type Rgba = readonly [number, number, number, number];
export type ImageFit = "stretch" | "contain" | "cover";
export type ImageCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScaleImageOptions {
  width?: number;
  height?: number;
  /** stretch uses both dimensions; contain and cover preserve aspect ratio. */
  fit?: ImageFit;
}

export interface PadImageOptions {
  top: number;
  right: number;
  bottom: number;
  left: number;
  fill: Rgba;
}

export interface RemoveFlatBackgroundOptions {
  /** Maximum per-channel RGB difference from a sampled corner, from 0 through 255. */
  tolerance: number;
  /** Corners whose colours seed the edge-connected background flood fill. */
  corners?: readonly ImageCorner[];
}

export interface TrimTransparentResult {
  image: PNG;
  offsets: { left: number; top: number; right: number; bottom: number };
}

function validateInteger(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer${minimum > 0 ? ` of at least ${minimum}` : ""}`);
  }
}

function validateChannel(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be an integer between 0 and 255`);
  }
}

function validateRgba(fill: Rgba): void {
  if (fill.length !== 4) throw new Error("fill must contain exactly four RGBA channels");
  fill.forEach((channel, index) => validateChannel(channel, `fill[${index}]`));
}

/** Validate decoded image geometry before allocating any destination buffer. */
export function validateImageDimensions(width: number, height: number): void {
  validateInteger(width, "Image width", 1);
  validateInteger(height, "Image height", 1);
  if (width > MAX_IMAGE_RASTER_DIMENSION || height > MAX_IMAGE_RASTER_DIMENSION) {
    throw new Error(`Image dimensions must not exceed ${MAX_IMAGE_RASTER_DIMENSION}`);
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error(`Image exceeds ${MAX_IMAGE_PIXELS} pixels`);
  }
}

function validatePng(png: PNG): void {
  validateImageDimensions(png.width, png.height);
  if (png.data.length !== png.width * png.height * 4) {
    throw new Error("PNG pixel data does not match its dimensions");
  }
}

function pixelOffset(width: number, x: number, y: number): number {
  return ((y * width) + x) * 4;
}

function newPng(width: number, height: number): PNG {
  validateImageDimensions(width, height);
  return new PNG({ width, height });
}

/** Crop an exact in-bounds rectangle without resampling its straight RGBA pixels. */
export function cropImage(png: PNG, rect: CropRect): PNG {
  validatePng(png);
  validateInteger(rect.x, "Crop x");
  validateInteger(rect.y, "Crop y");
  validateInteger(rect.width, "Crop width", 1);
  validateInteger(rect.height, "Crop height", 1);
  if (rect.x + rect.width > png.width || rect.y + rect.height > png.height) {
    throw new Error("Crop rectangle must stay within image bounds");
  }

  const output = newPng(rect.width, rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = pixelOffset(png.width, rect.x, rect.y + y);
    const targetStart = pixelOffset(output.width, 0, y);
    png.data.copy(output.data, targetStart, sourceStart, sourceStart + (rect.width * 4));
  }
  return output;
}

function resolveScaleDimensions(
  sourceWidth: number,
  sourceHeight: number,
  options: ScaleImageOptions,
): { width: number; height: number } {
  const fit = options.fit ?? "stretch";
  if (!(["stretch", "contain", "cover"] as const).includes(fit)) {
    throw new Error("Scale fit must be stretch, contain, or cover");
  }
  if (options.width === undefined && options.height === undefined) {
    throw new Error("Scale requires width and/or height");
  }
  if (options.width !== undefined) validateInteger(options.width, "Scale width", 1);
  if (options.height !== undefined) validateInteger(options.height, "Scale height", 1);

  if (options.width === undefined) {
    return { width: Math.max(1, Math.round((sourceWidth * options.height!) / sourceHeight)), height: options.height! };
  }
  if (options.height === undefined) {
    return { width: options.width, height: Math.max(1, Math.round((sourceHeight * options.width) / sourceWidth)) };
  }
  if (fit === "stretch") return { width: options.width, height: options.height };

  const ratio = fit === "contain"
    ? Math.min(options.width / sourceWidth, options.height / sourceHeight)
    : Math.max(options.width / sourceWidth, options.height / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
  };
}

interface AxisSample {
  index: number;
  weight: number;
}

/**
 * Build source-pixel weights in a fixed order. A minifying destination pixel
 * integrates its complete source-area footprint; a magnifying one gets the two
 * bilinear neighbours around its centre.
 */
function axisSamples(sourceLength: number, targetLength: number, targetIndex: number): AxisSample[] {
  if (targetLength < sourceLength) {
    const start = (targetIndex * sourceLength) / targetLength;
    const end = ((targetIndex + 1) * sourceLength) / targetLength;
    const samples: AxisSample[] = [];
    for (let index = Math.floor(start); index < Math.ceil(end); index += 1) {
      const weight = Math.max(0, Math.min(end, index + 1) - Math.max(start, index));
      if (weight > 0) samples.push({ index, weight: weight / (end - start) });
    }
    return samples;
  }

  const coordinate = (((targetIndex + 0.5) * sourceLength) / targetLength) - 0.5;
  const lower = Math.floor(coordinate);
  const upper = lower + 1;
  const upperWeight = coordinate - lower;
  const lowerIndex = Math.max(0, Math.min(sourceLength - 1, lower));
  const upperIndex = Math.max(0, Math.min(sourceLength - 1, upper));
  if (lowerIndex === upperIndex) return [{ index: lowerIndex, weight: 1 }];
  return [
    { index: lowerIndex, weight: 1 - upperWeight },
    { index: upperIndex, weight: upperWeight },
  ];
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Scale a straight-alpha PNG using box filtering for downscaling and bilinear
 * interpolation for upscaling. All accumulation loops have a fixed order so
 * equal input/options produce equal encoded pixels on supported Node runtimes.
 */
export function scaleImage(png: PNG, options: ScaleImageOptions): PNG {
  validatePng(png);
  const size = resolveScaleDimensions(png.width, png.height, options);
  validateImageDimensions(size.width, size.height);
  if (size.width === png.width && size.height === png.height) {
    const copy = newPng(png.width, png.height);
    png.data.copy(copy.data);
    return copy;
  }

  const horizontal = Array.from({ length: size.width }, (_, index) => axisSamples(png.width, size.width, index));
  const vertical = Array.from({ length: size.height }, (_, index) => axisSamples(png.height, size.height, index));
  // Premultiplied RGBA avoids bleeding the RGB of transparent source pixels into edges.
  const intermediate = new Float32Array(size.width * png.height * 4);

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (const sample of horizontal[x]) {
        const source = pixelOffset(png.width, sample.index, y);
        const sourceAlpha = png.data[source + 3] / 255;
        red += png.data[source] * sourceAlpha * sample.weight;
        green += png.data[source + 1] * sourceAlpha * sample.weight;
        blue += png.data[source + 2] * sourceAlpha * sample.weight;
        alpha += sourceAlpha * sample.weight;
      }
      const target = pixelOffset(size.width, x, y);
      intermediate[target] = red;
      intermediate[target + 1] = green;
      intermediate[target + 2] = blue;
      intermediate[target + 3] = alpha;
    }
  }

  const output = newPng(size.width, size.height);
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (const sample of vertical[y]) {
        const source = pixelOffset(size.width, x, sample.index);
        red += intermediate[source] * sample.weight;
        green += intermediate[source + 1] * sample.weight;
        blue += intermediate[source + 2] * sample.weight;
        alpha += intermediate[source + 3] * sample.weight;
      }
      const target = pixelOffset(output.width, x, y);
      output.data[target + 3] = clampChannel(alpha * 255);
      if (alpha > 0) {
        output.data[target] = clampChannel(red / alpha);
        output.data[target + 1] = clampChannel(green / alpha);
        output.data[target + 2] = clampChannel(blue / alpha);
      }
    }
  }
  return output;
}

/**
 * Extend a canvas with a supplied solid RGBA colour. This is deterministic
 * image expansion only: it never invents or generates scene content.
 */
export function padImage(png: PNG, options: PadImageOptions): PNG {
  validatePng(png);
  validateInteger(options.top, "Pad top");
  validateInteger(options.right, "Pad right");
  validateInteger(options.bottom, "Pad bottom");
  validateInteger(options.left, "Pad left");
  validateRgba(options.fill);
  const width = png.width + options.left + options.right;
  const height = png.height + options.top + options.bottom;
  validateImageDimensions(width, height);

  const output = newPng(width, height);
  for (let offset = 0; offset < output.data.length; offset += 4) output.data.set(options.fill, offset);
  for (let y = 0; y < png.height; y += 1) {
    const sourceStart = pixelOffset(png.width, 0, y);
    const targetStart = pixelOffset(output.width, options.left, options.top + y);
    png.data.copy(output.data, targetStart, sourceStart, sourceStart + (png.width * 4));
  }
  return output;
}

function cornerOffset(png: PNG, corner: ImageCorner): number {
  switch (corner) {
    case "top-left": return pixelOffset(png.width, 0, 0);
    case "top-right": return pixelOffset(png.width, png.width - 1, 0);
    case "bottom-left": return pixelOffset(png.width, 0, png.height - 1);
    case "bottom-right": return pixelOffset(png.width, png.width - 1, png.height - 1);
  }
}

/**
 * Remove edge-connected pixels close to selected corner colours. This is a
 * classical flood fill for uniform backdrops, not AI matting: it cannot retain
 * hair/soft edges or reliably isolate subjects against busy backgrounds.
 */
export function removeFlatBackground(png: PNG, options: RemoveFlatBackgroundOptions): PNG {
  validatePng(png);
  if (!Number.isFinite(options.tolerance) || options.tolerance < 0 || options.tolerance > 255) {
    throw new Error("Background tolerance must be between 0 and 255");
  }
  const tolerance = Math.round(options.tolerance);
  const corners = options.corners ?? ["top-left", "top-right", "bottom-left", "bottom-right"];
  if (corners.length === 0) throw new Error("Background removal requires at least one corner");
  if (new Set(corners).size !== corners.length) throw new Error("Background corners must not contain duplicates");
  const samples = corners.map((corner) => {
    if (!(["top-left", "top-right", "bottom-left", "bottom-right"] as const).includes(corner)) {
      throw new Error(`Unsupported background corner: ${corner}`);
    }
    const offset = cornerOffset(png, corner);
    return [png.data[offset], png.data[offset + 1], png.data[offset + 2]] as const;
  });
  const output = newPng(png.width, png.height);
  png.data.copy(output.data);
  const pixels = png.width * png.height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  const matchesBackdrop = (pixel: number): boolean => {
    const offset = pixel * 4;
    return samples.some((sample) => (
      Math.abs(png.data[offset] - sample[0]) <= tolerance
      && Math.abs(png.data[offset + 1] - sample[1]) <= tolerance
      && Math.abs(png.data[offset + 2] - sample[2]) <= tolerance
    ));
  };
  const enqueue = (pixel: number): void => {
    if (visited[pixel] || !matchesBackdrop(pixel)) return;
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < png.width; x += 1) {
    enqueue(x);
    enqueue(((png.height - 1) * png.width) + x);
  }
  for (let y = 1; y < png.height - 1; y += 1) {
    enqueue(y * png.width);
    enqueue((y * png.width) + png.width - 1);
  }
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    output.data[(pixel * 4) + 3] = 0;
    const x = pixel % png.width;
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < png.width) enqueue(pixel + 1);
    if (pixel >= png.width) enqueue(pixel - png.width);
    if (pixel + png.width < pixels) enqueue(pixel + png.width);
  }
  return output;
}

/** Crop transparent margins and report how much was removed from every edge. */
export function trimTransparent(png: PNG): TrimTransparentResult {
  validatePng(png);
  let left = png.width;
  let top = png.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[pixelOffset(png.width, x, y) + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) {
    const image = newPng(1, 1);
    return {
      image,
      offsets: { left: 0, top: 0, right: png.width - 1, bottom: png.height - 1 },
    };
  }
  return {
    image: cropImage(png, { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }),
    offsets: { left, top, right: png.width - right - 1, bottom: png.height - bottom - 1 },
  };
}
