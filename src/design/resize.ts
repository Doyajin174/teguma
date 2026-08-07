/**
 * Document resize engine.
 *
 * Mirrors MiriCanvas' "크기 조정" behaviour: pick a target size by preset or by
 * explicit numbers, then reflow with one of four modes.
 *
 * - fill      scale by the larger ratio, so the canvas is fully covered
 * - fit       scale by the smaller ratio, so content already inside the source
 *             canvas stays visible
 * - original  keep layer sizes, only re-centre the composition
 * - adapt     scale type and shapes by the smaller ratio, then redistribute the
 *             composition per axis and re-balance the content block so a very
 *             different aspect ratio does not leave one giant empty margin
 */

import {
  parseDesignDocument,
  type DesignDocument,
  type DesignLayer,
  type DesignPage,
} from "./document.js";
import { requireSizePreset, type PresetUnit } from "./presets.js";

export type ResizeMode = "fill" | "fit" | "original" | "adapt";

export interface ResizeTarget {
  /** Preset id. Mutually exclusive with width/height. */
  preset?: string;
  width?: number;
  height?: number;
  unit?: PresetUnit;
  mode?: ResizeMode;
  /** When true, a single provided axis derives the other from the source ratio. */
  lockAspectRatio?: boolean;
}

export interface ResolvedResize {
  width: number;
  height: number;
  unit: PresetUnit;
  mode: ResizeMode;
  scale: number;
  offsetX: number;
  /**
   * Global vertical translation after uniform scaling. `adapt` omits this
   * because its independently-centred pages need distinct translations.
   */
  offsetY?: number;
  /** adapt mode only: horizontal placement is stretched by this ratio. */
  axisScaleX?: number;
  /**
   * adapt mode only: vertical translation after uniform scaling, keyed by page
   * id. Reporting this prevents callers from mistaking a per-page transform
   * for a single document-wide offset.
   */
  pageOffsetY?: Record<string, number>;
}

interface ContentBounds {
  top: number;
  bottom: number;
}

/**
 * Vertical extent of the visible composition, used to re-balance adapt mode.
 *
 * Text layers are measured by the space their lines actually occupy, not by the
 * declared frame, so generous frames do not push the block off centre.
 */
function contentBounds(page: DesignPage): ContentBounds | undefined {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const layer of page.layers) {
    const renderedHeight = layer.type === "text"
      ? Math.min(
          layer.frame.height,
          layer.text.split("\n").length * layer.fontSize * layer.lineHeight,
        )
      : layer.frame.height;

    top = Math.min(top, layer.frame.y);
    bottom = Math.max(bottom, layer.frame.y + renderedHeight);
  }

  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : undefined;
}

/**
 * Reject a transform before it can turn valid positive schema values into
 * zero or infinity. Keeping the exact scale avoids ordinary precision loss;
 * this guard covers the remaining IEEE-754 underflow and overflow cases.
 */
function assertRepresentableScale(document: DesignDocument, scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Resize target cannot be represented with a positive, finite scale");
  }

  const scalableValues = document.pages.flatMap((page) => page.layers.flatMap((layer) => [
    layer.frame.width,
    layer.frame.height,
    ...(layer.type === "text" ? [layer.fontSize, layer.letterSpacing] : []),
    ...(layer.type === "rect" ? [layer.radius] : []),
  ]));

  if (scalableValues.some((value) => !Number.isFinite(value * scale))) {
    throw new Error("Resize target is too large to represent finite layer geometry");
  }

  if (scalableValues.some((value) => value > 0 && value * scale <= 0)) {
    throw new Error(
      "Resize target is too small to preserve positive layer sizes; increase the target dimensions",
    );
  }
}

/** Move one IEEE-754 value toward zero without applying presentation rounding. */
function nextDownPositive(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

/** Move one IEEE-754 value away from zero without applying presentation rounding. */
function nextUpPositive(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

/**
 * Division and multiplication can differ by one IEEE-754 unit even when they
 * describe the same mathematical ratio. Nudge only when that residue breaks
 * the mode's guarantee: down for `fit`, up for `fill`.
 */
function preserveCanvasGuarantee(
  scale: number,
  mode: ResizeMode,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): number {
  let adjusted = scale;

  if (mode === "fit") {
    while ((sourceWidth * adjusted) > width || (sourceHeight * adjusted) > height) {
      const next = nextDownPositive(adjusted);
      if (next <= 0 || next === adjusted) break;
      adjusted = next;
    }
  }

  if (mode === "fill") {
    while ((sourceWidth * adjusted) < width || (sourceHeight * adjusted) < height) {
      const next = nextUpPositive(adjusted);
      if (!Number.isFinite(next) || next === adjusted) break;
      adjusted = next;
    }
  }

  return adjusted;
}

/**
 * `adapt` centres each page separately because pages are independent outputs,
 * not one vertically stacked composition.
 */
function resolveAdaptPageOffsets(
  document: DesignDocument,
  scale: number,
  height: number,
): Record<string, number> {
  return Object.fromEntries(document.pages.map((page) => {
    const bounds = contentBounds(page);
    const scaledTop = (bounds?.top ?? 0) * scale;
    const scaledBottom = (bounds?.bottom ?? document.canvas.height) * scale;
    const blockHeight = scaledBottom - scaledTop;
    const verticalShift = ((height - blockHeight) / 2) - scaledTop;

    return [page.id, verticalShift];
  }));
}

export function resolveResize(document: DesignDocument, target: ResizeTarget): ResolvedResize {
  const mode = target.mode ?? "fill";
  const source = document.canvas;

  if (target.preset && (target.width !== undefined || target.height !== undefined)) {
    throw new Error("Provide either a preset or explicit width/height, not both");
  }

  let width: number;
  let height: number;
  let unit: PresetUnit;

  if (target.preset) {
    const preset = requireSizePreset(target.preset);
    width = preset.width;
    height = preset.height;
    unit = preset.unit;
  } else {
    unit = target.unit ?? source.unit;
    const ratio = source.width / source.height;

    if (target.width !== undefined && target.height !== undefined) {
      width = target.width;
      height = target.height;
    } else if (target.width !== undefined) {
      if (!target.lockAspectRatio) {
        throw new Error("Provide height, or set lockAspectRatio to derive it");
      }
      width = target.width;
      height = target.width / ratio;
    } else if (target.height !== undefined) {
      if (!target.lockAspectRatio) {
        throw new Error("Provide width, or set lockAspectRatio to derive it");
      }
      height = target.height;
      width = target.height * ratio;
    } else {
      throw new Error("Resize target requires a preset or explicit dimensions");
    }
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Resize target must be positive and finite");
  }

  if (unit !== source.unit) {
    throw new Error(
      `Cannot resize a ${source.unit} document to ${unit}. Convert the document unit first.`,
    );
  }

  const scaleX = width / source.width;
  const scaleY = height / source.height;
  const exactScale = mode === "fill"
    ? Math.max(scaleX, scaleY)
    : mode === "fit" || mode === "adapt"
      ? Math.min(scaleX, scaleY)
      : 1;
  assertRepresentableScale(document, exactScale);
  // Geometry must use the exact ratio. Rounding this value can make `fit`
  // overflow by a fraction or leave a visible `fill` gap at large sizes.
  const scale = preserveCanvasGuarantee(
    exactScale,
    mode,
    source.width,
    source.height,
    width,
    height,
  );

  if (mode === "adapt") {
    return {
      width,
      height,
      unit,
      mode,
      scale,
      offsetX: 0,
      axisScaleX: scaleX,
      pageOffsetY: resolveAdaptPageOffsets(document, scale, height),
    };
  }

  return {
    width,
    height,
    unit,
    mode,
    scale,
    offsetX: (width - (source.width * scale)) / 2,
    offsetY: (height - (source.height * scale)) / 2,
  };
}

function scaleLayer(layer: DesignLayer, resolved: ResolvedResize): DesignLayer {
  const { scale, offsetX, offsetY } = resolved;

  if (offsetY === undefined) {
    throw new Error("A non-adapt resize requires a global vertical offset");
  }

  const frame = {
    x: (layer.frame.x * scale) + offsetX,
    y: (layer.frame.y * scale) + offsetY,
    width: layer.frame.width * scale,
    height: layer.frame.height * scale,
  };

  if (layer.type === "text") {
    return {
      ...layer,
      frame,
      fontSize: layer.fontSize * scale,
      letterSpacing: layer.letterSpacing * scale,
    };
  }

  if (layer.type === "rect") {
    return { ...layer, frame, radius: layer.radius * scale };
  }

  return { ...layer, frame };
}

/**
 * adapt keeps glyph and ordinary shape scale uniform, stretches horizontal
 * placement so side margins grow with the canvas, then centres each page's
 * content block vertically. Only a rect that starts at (0, 0) and spans both
 * source canvas dimensions is a full-bleed background and may stretch to the
 * target width. Requiring full height prevents ordinary full-width bands from
 * being distorted by the special case.
 */
function adaptLayer(
  layer: DesignLayer,
  resolved: ResolvedResize,
  verticalShift: number,
  sourceWidth: number,
  sourceHeight: number,
): DesignLayer {
  const { scale, axisScaleX } = resolved;
  const horizontalScale = axisScaleX ?? scale;
  const isFullBleedRect = layer.type === "rect"
    && layer.frame.x === 0
    && layer.frame.y === 0
    && layer.frame.width === sourceWidth
    && layer.frame.height === sourceHeight;

  const frame = {
    x: isFullBleedRect ? 0 : layer.frame.x * horizontalScale,
    y: (layer.frame.y * scale) + verticalShift,
    width: isFullBleedRect ? resolved.width : layer.frame.width * scale,
    height: layer.frame.height * scale,
  };

  if (layer.type === "text") {
    return {
      ...layer,
      frame,
      fontSize: layer.fontSize * scale,
      letterSpacing: layer.letterSpacing * scale,
    };
  }

  if (layer.type === "rect") {
    return { ...layer, frame, radius: layer.radius * scale };
  }

  return { ...layer, frame };
}

/**
 * Produce a new document at the requested size. The input is left untouched.
 * `fit` keeps every source layer visible only when that layer is already inside
 * the source canvas; out-of-bounds source geometry remains out of bounds after
 * a same-size fit so QA can report the authoring defect instead of hiding it.
 */
export function resizeDocument(document: DesignDocument, target: ResizeTarget): DesignDocument {
  const resolved = resolveResize(document, target);

  if (resolved.mode === "adapt") {
    const resized = {
      ...document,
      canvas: {
        ...document.canvas,
        width: resolved.width,
        height: resolved.height,
        safeMargin: document.canvas.safeMargin * resolved.scale,
      },
      pages: document.pages.map((page) => ({
        ...page,
        layers: page.layers.map((layer) => adaptLayer(
          layer,
          resolved,
          resolved.pageOffsetY?.[page.id] ?? 0,
          document.canvas.width,
          document.canvas.height,
        )),
      })),
    };

    return parseDesignDocument(resized);
  }

  const resized = {
    ...document,
    canvas: {
      ...document.canvas,
      width: resolved.width,
      height: resolved.height,
      safeMargin: document.canvas.safeMargin * resolved.scale,
    },
    pages: document.pages.map((page) => ({
      ...page,
      layers: page.layers.map((layer) => scaleLayer(layer, resolved)),
    })),
  };

  return parseDesignDocument(resized);
}
