/**
 * Deterministic GIF89a encoding.
 *
 * GIF stores palette indices, so this module uses weighted median cut rather
 * than a fixed web-safe palette. Median cut preserves the actual colours in a
 * design (including brand colours) while remaining dependency-free. A bounded,
 * evenly-spaced sample is used only when a raster has more than 256 colours so
 * photographs cannot make palette construction allocate per-source-colour
 * memory. Every comparison has an explicit tie-breaker for repeatable bytes.
 */

export const DEFAULT_GIF_FRAME_DELAY = 10;
const MAX_PALETTE_COLORS = 256;
const MAX_QUANTIZATION_SAMPLES = 262_144;

export interface GifFrame {
  /** Opaque RGB pixels in row-major order. */
  rgb: Uint8Array;
  /** Delay in hundredths of a second; defaults to 10 (100ms). */
  delay?: number;
}

export interface GifEncodeOptions {
  /**
   * Diffuse quantization error using Floyd–Steinberg dithering. It improves
   * photographic gradients but makes deliberate flat brand panels noisy, so
   * it defaults to false.
   */
  dither?: boolean;
  /** Default frame delay in hundredths of a second. */
  delay?: number;
}

interface Color {
  red: number;
  green: number;
  blue: number;
  count: number;
  key: number;
}

interface ColorBox {
  colors: Color[];
}

function colorKey(red: number, green: number, blue: number): number {
  return (red << 16) | (green << 8) | blue;
}

function compareColorKey(left: Color, right: Color): number {
  return left.key - right.key;
}

function validateDelay(delay: number): void {
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > 65_535) {
    throw new Error("GIF frame delay must be an integer from 0 through 65535 hundredths");
  }
}

function validateFrames(frames: readonly GifFrame[], width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error("GIF dimensions must be positive safe integers");
  }
  if (frames.length < 1) throw new Error("GIF requires at least one frame");
  const expectedLength = width * height * 3;
  for (const frame of frames) {
    if (frame.rgb.length !== expectedLength) {
      throw new Error(`GIF frame pixels must contain exactly ${expectedLength} RGB bytes`);
    }
    if (frame.delay !== undefined) validateDelay(frame.delay);
  }
}

function collectPaletteColors(frames: readonly GifFrame[], width: number, height: number): Color[] {
  const unique = new Map<number, Color>();
  for (const frame of frames) {
    for (let offset = 0; offset < frame.rgb.length; offset += 3) {
      const red = frame.rgb[offset];
      const green = frame.rgb[offset + 1];
      const blue = frame.rgb[offset + 2];
      const key = colorKey(red, green, blue);
      if (!unique.has(key)) {
        if (unique.size === MAX_PALETTE_COLORS) return collectSampledColors(frames, width, height);
        unique.set(key, { red, green, blue, count: 1, key });
      }
    }
  }
  return [...unique.values()].sort(compareColorKey);
}

/**
 * Sample positions are distributed over the whole animation instead of taking
 * a leading crop. This keeps palette memory bounded for high-colour photos.
 */
function collectSampledColors(frames: readonly GifFrame[], width: number, height: number): Color[] {
  const pixelsPerFrame = width * height;
  const totalPixels = pixelsPerFrame * frames.length;
  const samples = Math.min(totalPixels, MAX_QUANTIZATION_SAMPLES);
  const colors = new Map<number, Color>();
  for (let sample = 0; sample < samples; sample += 1) {
    const pixel = Math.floor((sample * totalPixels) / samples);
    const frame = frames[Math.floor(pixel / pixelsPerFrame)];
    const offset = (pixel % pixelsPerFrame) * 3;
    const red = frame.rgb[offset];
    const green = frame.rgb[offset + 1];
    const blue = frame.rgb[offset + 2];
    const key = colorKey(red, green, blue);
    const existing = colors.get(key);
    if (existing) existing.count += 1;
    else colors.set(key, { red, green, blue, count: 1, key });
  }
  return [...colors.values()].sort(compareColorKey);
}

function boxStats(box: ColorBox): {
  redRange: number;
  greenRange: number;
  blueRange: number;
  population: number;
  minKey: number;
} {
  let redMin = 255;
  let redMax = 0;
  let greenMin = 255;
  let greenMax = 0;
  let blueMin = 255;
  let blueMax = 0;
  let population = 0;
  let minKey = Number.MAX_SAFE_INTEGER;
  for (const color of box.colors) {
    redMin = Math.min(redMin, color.red);
    redMax = Math.max(redMax, color.red);
    greenMin = Math.min(greenMin, color.green);
    greenMax = Math.max(greenMax, color.green);
    blueMin = Math.min(blueMin, color.blue);
    blueMax = Math.max(blueMax, color.blue);
    population += color.count;
    minKey = Math.min(minKey, color.key);
  }
  return {
    redRange: redMax - redMin,
    greenRange: greenMax - greenMin,
    blueRange: blueMax - blueMin,
    population,
    minKey,
  };
}

function splitChannel(stats: ReturnType<typeof boxStats>): 0 | 1 | 2 {
  if (stats.redRange >= stats.greenRange && stats.redRange >= stats.blueRange) return 0;
  if (stats.greenRange >= stats.blueRange) return 1;
  return 2;
}

function compareBoxes(left: ColorBox, right: ColorBox): number {
  const leftStats = boxStats(left);
  const rightStats = boxStats(right);
  const leftRange = Math.max(leftStats.redRange, leftStats.greenRange, leftStats.blueRange);
  const rightRange = Math.max(rightStats.redRange, rightStats.greenRange, rightStats.blueRange);
  return (rightRange - leftRange)
    || (rightStats.population - leftStats.population)
    || (leftStats.minKey - rightStats.minKey);
}

function compareOnChannel(channel: 0 | 1 | 2): (left: Color, right: Color) => number {
  const value = (color: Color) => channel === 0 ? color.red : channel === 1 ? color.green : color.blue;
  return (left, right) => (value(left) - value(right))
    || (left.red - right.red)
    || (left.green - right.green)
    || (left.blue - right.blue)
    || (left.key - right.key);
}

function splitBox(box: ColorBox): [ColorBox, ColorBox] | undefined {
  if (box.colors.length < 2) return undefined;
  const stats = boxStats(box);
  const sorted = [...box.colors].sort(compareOnChannel(splitChannel(stats)));
  let accumulated = 0;
  let splitAt = 1;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    accumulated += sorted[index].count;
    if ((accumulated * 2) >= stats.population) {
      splitAt = index + 1;
      break;
    }
  }
  return [{ colors: sorted.slice(0, splitAt) }, { colors: sorted.slice(splitAt) }];
}

function representativeColor(box: ColorBox): Color {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (const color of box.colors) {
    red += color.red * color.count;
    green += color.green * color.count;
    blue += color.blue * color.count;
    count += color.count;
  }
  const roundedRed = Math.round(red / count);
  const roundedGreen = Math.round(green / count);
  const roundedBlue = Math.round(blue / count);
  return {
    red: roundedRed,
    green: roundedGreen,
    blue: roundedBlue,
    count,
    key: colorKey(roundedRed, roundedGreen, roundedBlue),
  };
}

/** Weighted median cut gives a compact palette tailored to the supplied animation. */
export function quantizeGifPalette(frames: readonly GifFrame[], width: number, height: number): Color[] {
  validateFrames(frames, width, height);
  const colors = collectPaletteColors(frames, width, height);
  if (colors.length <= MAX_PALETTE_COLORS) return colors;

  const boxes: ColorBox[] = [{ colors }];
  while (boxes.length < MAX_PALETTE_COLORS) {
    boxes.sort(compareBoxes);
    const split = splitBox(boxes[0]);
    if (!split) break;
    boxes.splice(0, 1, split[0], split[1]);
  }
  return boxes.map(representativeColor).sort(compareColorKey);
}

function nearestPaletteIndex(red: number, green: number, blue: number, palette: readonly Color[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index];
    const distance = ((red - color.red) ** 2) + ((green - color.green) ** 2) + ((blue - color.blue) ** 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function paletteIndices(frame: GifFrame, width: number, height: number, palette: readonly Color[], dither: boolean): Uint8Array {
  const indices = new Uint8Array(width * height);
  if (!dither) {
    for (let pixel = 0; pixel < indices.length; pixel += 1) {
      const offset = pixel * 3;
      indices[pixel] = nearestPaletteIndex(frame.rgb[offset], frame.rgb[offset + 1], frame.rgb[offset + 2], palette);
    }
    return indices;
  }

  let current = new Float64Array((width + 2) * 3);
  let next = new Float64Array((width + 2) * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width) + x;
      const source = pixel * 3;
      const error = (x + 1) * 3;
      const red = clampColor(frame.rgb[source] + current[error]);
      const green = clampColor(frame.rgb[source + 1] + current[error + 1]);
      const blue = clampColor(frame.rgb[source + 2] + current[error + 2]);
      const index = nearestPaletteIndex(red, green, blue, palette);
      indices[pixel] = index;
      const mapped = palette[index];
      const redError = red - mapped.red;
      const greenError = green - mapped.green;
      const blueError = blue - mapped.blue;
      const add = (target: Float64Array, targetOffset: number, factor: number) => {
        target[targetOffset] += redError * factor;
        target[targetOffset + 1] += greenError * factor;
        target[targetOffset + 2] += blueError * factor;
      };
      add(current, error + 3, 7 / 16);
      add(next, error - 3, 3 / 16);
      add(next, error, 5 / 16);
      add(next, error + 3, 1 / 16);
    }
    current = next;
    next = new Float64Array((width + 2) * 3);
  }
  return indices;
}

class LsbBitWriter {
  private readonly bytes: number[] = [];
  private value = 0;
  private length = 0;

  write(code: number, width: number): void {
    this.value |= code << this.length;
    this.length += width;
    while (this.length >= 8) {
      this.bytes.push(this.value & 0xFF);
      this.value >>>= 8;
      this.length -= 8;
    }
  }

  finish(): Buffer {
    if (this.length > 0) this.bytes.push(this.value & 0xFF);
    return Buffer.from(this.bytes);
  }
}

/** GIF LZW codes are packed least-significant-bit first and reset at 4096 entries. */
export function encodeGifLzw(indices: Uint8Array, minimumCodeSize: number): Buffer {
  if (!Number.isSafeInteger(minimumCodeSize) || minimumCodeSize < 2 || minimumCodeSize > 8) {
    throw new Error("GIF LZW minimum code size must be an integer from 2 through 8");
  }
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  const writer = new LsbBitWriter();
  let codeSize = minimumCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map<string, number>();
  const reset = () => {
    dictionary = new Map<string, number>();
    codeSize = minimumCodeSize + 1;
    nextCode = endCode + 1;
  };

  writer.write(clearCode, codeSize);
  if (indices.length === 0) {
    writer.write(endCode, codeSize);
    return writer.finish();
  }

  let prefix = indices[0];
  for (let index = 1; index < indices.length; index += 1) {
    const value = indices[index];
    const sequence = `${prefix}:${value}`;
    const known = dictionary.get(sequence);
    if (known !== undefined) {
      prefix = known;
      continue;
    }

    writer.write(prefix, codeSize);
    if (nextCode < 4096) {
      dictionary.set(sequence, nextCode);
      nextCode += 1;
      // The decoder adds this entry only after it has read the next code, so
      // the encoder changes width one emitted code later than its own table.
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      writer.write(clearCode, codeSize);
      reset();
    }
    prefix = value;
  }
  writer.write(prefix, codeSize);
  writer.write(endCode, codeSize);
  return writer.finish();
}

function subBlocks(data: Buffer): Buffer {
  const blocks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += 255) {
    const chunk = data.subarray(offset, offset + 255);
    blocks.push(Buffer.from([chunk.length]), chunk);
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

function tableBits(paletteLength: number): number {
  let bits = 2;
  while ((1 << bits) < paletteLength) bits += 1;
  return bits;
}

function globalColorTable(palette: readonly Color[], bits: number): Buffer {
  const table = Buffer.alloc((1 << bits) * 3);
  for (let index = 0; index < palette.length; index += 1) {
    table[index * 3] = palette[index].red;
    table[(index * 3) + 1] = palette[index].green;
    table[(index * 3) + 2] = palette[index].blue;
  }
  return table;
}

function graphicControlExtension(delay: number): Buffer {
  // Disposal 2 restores the background before the next full-canvas frame.
  return Buffer.from([0x21, 0xF9, 0x04, 0x08, delay & 0xFF, delay >> 8, 0x00, 0x00]);
}

/**
 * Encode opaque RGB frames into one GIF89a animation. Single-frame GIFs omit
 * NETSCAPE2.0 because looping has no observable meaning; animations loop
 * forever. Every frame occupies the logical screen and uses disposal method 2.
 */
export function encodeGif(
  frames: readonly GifFrame[],
  width: number,
  height: number,
  options: GifEncodeOptions = {},
): Buffer {
  validateFrames(frames, width, height);
  const defaultDelay = options.delay ?? DEFAULT_GIF_FRAME_DELAY;
  validateDelay(defaultDelay);
  const palette = quantizeGifPalette(frames, width, height);
  const bits = tableBits(palette.length);
  const chunks: Buffer[] = [
    Buffer.from("GIF89a", "ascii"),
    Buffer.from([
      width & 0xFF, width >> 8,
      height & 0xFF, height >> 8,
      0x80 | ((bits - 1) << 4) | (bits - 1),
      0x00,
      0x00,
    ]),
    globalColorTable(palette, bits),
  ];
  if (frames.length > 1) {
    chunks.push(Buffer.from([0x21, 0xFF, 0x0B]), Buffer.from("NETSCAPE2.0", "ascii"), Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));
  }
  for (const frame of frames) {
    const delay = frame.delay ?? defaultDelay;
    const indices = paletteIndices(frame, width, height, palette, options.dither ?? false);
    chunks.push(
      graphicControlExtension(delay),
      Buffer.from([0x2C, 0x00, 0x00, 0x00, 0x00, width & 0xFF, width >> 8, height & 0xFF, height >> 8, 0x00]),
      Buffer.from([bits]),
      subBlocks(encodeGifLzw(indices, bits)),
    );
  }
  chunks.push(Buffer.from([0x3B]));
  return Buffer.concat(chunks);
}
