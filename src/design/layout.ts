/**
 * Immutable layout primitives for declarative design documents.
 *
 * A canvas author should describe relationships such as alignment, spacing, and
 * visual rhythm rather than repeat fragile coordinate arithmetic. These helpers
 * retain the authored layer order, use no ambient state, and return fresh layer
 * objects so the same input always produces the same geometry.
 */

import type { DesignLayer, Frame, TextLayer } from "./document.js";
import { measureTextBlock } from "./text-metrics.js";

export type LayoutAlignment = "start" | "center" | "end";
export type LayoutAxis = "x" | "y";
export type DistributionMode = "space-between" | "space-around" | "fixed-gap";
export type VerticalRhythmAnchor = "top" | "upper-middle" | "remaining-space" | "bottom";

/** A uniform inset matching DesignDocument.canvas.safeMargin. */
export interface SafeAreaOptions {
  safeMargin?: number;
}

export interface AlignLayersOptions extends SafeAreaOptions {
  horizontal?: LayoutAlignment;
  vertical?: LayoutAlignment;
}

export interface DistributeLayersOptions extends SafeAreaOptions {
  axis: LayoutAxis;
  mode: DistributionMode;
  /** Required for fixed-gap; ignored by the two free-space distribution modes. */
  gap?: number;
}

export interface StackLayersOptions extends SafeAreaOptions {
  origin: { x: number; y: number };
  axis: LayoutAxis;
  gap: number;
  /**
   * Optional measurement override for the stacked dimension. By default, text
   * uses measured natural height on the y axis and authored frame size elsewhere.
   */
  measure?: (layer: DesignLayer, axis: LayoutAxis) => number;
  /**
   * Bounds for the sequence. Supplying the canvas frame makes stack placement
   * obey the same safe area as QA; standalone callers can omit it when their
   * origin already belongs to another bounded parent frame.
   */
  container?: Frame;
}

export interface VerticalRhythmOptions extends SafeAreaOptions {
  /** One semantic vertical anchor for each layer, in the same order as layers. */
  anchors: VerticalRhythmAnchor[];
}

function requireFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

function safeContainer(container: Frame, safeMargin: number): Frame {
  requireFiniteNonnegative(safeMargin, "safeMargin");
  const width = container.width - (safeMargin * 2);
  const height = container.height - (safeMargin * 2);
  if (width <= 0 || height <= 0) {
    throw new Error("safeMargin leaves no usable layout area inside the container");
  }
  return {
    x: container.x + safeMargin,
    y: container.y + safeMargin,
    width,
    height,
  };
}

function cloneLayer(layer: DesignLayer, frame: Frame = layer.frame): DesignLayer {
  return { ...layer, frame: { ...frame } };
}

function assertFits(layer: DesignLayer, container: Frame): void {
  const { frame } = layer;
  if (frame.width > container.width || frame.height > container.height) {
    throw new Error(`Layer ${layer.id} is larger than the safe layout area`);
  }
  if (
    frame.x < container.x
    || frame.y < container.y
    || frame.x + frame.width > container.x + container.width
    || frame.y + frame.height > container.y + container.height
  ) {
    throw new Error(`Layout places layer ${layer.id} outside the safe layout area`);
  }
}

function positioned(layer: DesignLayer, x: number, y: number, container?: Frame): DesignLayer {
  const result = cloneLayer(layer, { ...layer.frame, x, y });
  if (container) assertFits(result, container);
  return result;
}

function textAlign(alignment: LayoutAlignment): TextLayer["align"] {
  return alignment === "center" ? "middle" : alignment;
}

function textHeight(layer: TextLayer): number {
  return measureTextBlock(layer.text, {
    fontSize: layer.fontSize,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
  }).height;
}

function measuredDimension(layer: DesignLayer, axis: LayoutAxis): number {
  if (layer.type === "text" && axis === "y") return textHeight(layer);
  return axis === "x" ? layer.frame.width : layer.frame.height;
}

function axisSize(layer: DesignLayer, axis: LayoutAxis): number {
  return axis === "x" ? layer.frame.width : layer.frame.height;
}

function axisStart(frame: Frame, axis: LayoutAxis): number {
  return axis === "x" ? frame.x : frame.y;
}

function axisLength(frame: Frame, axis: LayoutAxis): number {
  return axis === "x" ? frame.width : frame.height;
}

function withAxisPosition(
  layer: DesignLayer,
  axis: LayoutAxis,
  value: number,
  container?: Frame,
): DesignLayer {
  return positioned(
    layer,
    axis === "x" ? value : layer.frame.x,
    axis === "y" ? value : layer.frame.y,
    container,
  );
}

/**
 * Align each layer independently inside the safe inset of container. Horizontal
 * text alignment is changed with its box because SVG uses the frame edge (or
 * centre) as the glyph anchor.
 */
export function alignLayers(
  layers: DesignLayer[],
  container: Frame,
  options: AlignLayersOptions = {},
): DesignLayer[] {
  const safe = safeContainer(container, options.safeMargin ?? 0);
  return layers.map((layer) => {
    if (layer.frame.width > safe.width || layer.frame.height > safe.height) {
      throw new Error(`Layer ${layer.id} is larger than the safe layout area`);
    }
    const x = options.horizontal === undefined
      ? layer.frame.x
      : options.horizontal === "start"
        ? safe.x
        : options.horizontal === "center"
          ? safe.x + ((safe.width - layer.frame.width) / 2)
          : safe.x + safe.width - layer.frame.width;
    const y = options.vertical === undefined
      ? layer.frame.y
      : options.vertical === "start"
        ? safe.y
        : options.vertical === "center"
          ? safe.y + ((safe.height - layer.frame.height) / 2)
          : safe.y + safe.height - layer.frame.height;
    const result = positioned(layer, x, y, safe);
    return result.type === "text" && options.horizontal !== undefined
      ? { ...result, align: textAlign(options.horizontal) }
      : result;
  });
}

/**
 * Distribute layers in their supplied order. Free-space modes reserve the
 * uniform safe inset at both edges; fixed-gap starts at that inset and throws
 * if the requested sequence cannot fit, preventing an invalid QA result.
 */
export function distributeLayers(
  layers: DesignLayer[],
  container: Frame,
  options: DistributeLayersOptions,
): DesignLayer[] {
  const safe = safeContainer(container, options.safeMargin ?? 0);
  if (layers.length === 0) return [];
  const available = axisLength(safe, options.axis);
  const total = layers.reduce((sum, layer) => sum + axisSize(layer, options.axis), 0);
  if (total > available) throw new Error("Layers do not fit inside the safe layout area");

  let gap = 0;
  let cursor = axisStart(safe, options.axis);
  const remaining = available - total;
  if (options.mode === "space-between") {
    if (layers.length === 1) {
      cursor += remaining / 2;
    } else {
      gap = remaining / (layers.length - 1);
    }
  } else if (options.mode === "space-around") {
    gap = remaining / layers.length;
    cursor += gap / 2;
  } else {
    gap = options.gap ?? 0;
    requireFiniteNonnegative(gap, "gap");
    const used = total + (gap * (layers.length - 1));
    if (used > available) {
      throw new Error("Layers and requested gap do not fit inside the safe layout area");
    }
  }

  return layers.map((layer) => {
    const result = withAxisPosition(layer, options.axis, cursor, safe);
    cursor += axisSize(layer, options.axis) + gap;
    return result;
  });
}

/**
 * Stack layers sequentially from origin. On a vertical stack text advances the
 * cursor by measureTextBlock's natural height, not by any spare authored frame
 * height, so oversized text frames cannot create artificial blank space.
 */
export function stackLayers(layers: DesignLayer[], options: StackLayersOptions): DesignLayer[] {
  requireFiniteNonnegative(options.gap, "gap");
  const safe = options.container === undefined
    ? undefined
    : safeContainer(options.container, options.safeMargin ?? 0);
  let cursor = options.axis === "x" ? options.origin.x : options.origin.y;

  return layers.map((layer) => {
    const result = positioned(
      layer,
      options.axis === "x" ? cursor : options.origin.x,
      options.axis === "x" ? options.origin.y : cursor,
      safe,
    );
    const measurement = options.measure?.(layer, options.axis) ?? measuredDimension(layer, options.axis);
    if (!Number.isFinite(measurement) || measurement <= 0) {
      throw new Error(`Measured size for layer ${layer.id} must be a finite positive number`);
    }
    cursor += measurement + options.gap;
    return result;
  });
}

/**
 * Place content in semantic vertical bands instead of authored y coordinates.
 * Top blocks are packed from the safe top, upper-middle blocks are packed as a
 * group centred at 38% of safe height (the optical upper-middle), bottom blocks
 * are packed upward from the safe bottom, and remaining-space blocks are spread
 * with equal leading, internal, and trailing gaps in the interval left between
 * those anchored groups. All positions retain their authored frame dimensions.
 */
export function distributeVerticalRhythm(
  layers: DesignLayer[],
  container: Frame,
  options: VerticalRhythmOptions,
): DesignLayer[] {
  if (layers.length !== options.anchors.length) {
    throw new Error("anchors must contain exactly one entry per layer");
  }
  const safe = safeContainer(container, options.safeMargin ?? 0);
  for (const layer of layers) {
    if (layer.frame.width > safe.width || layer.frame.height > safe.height) {
      throw new Error(`Layer ${layer.id} is larger than the safe layout area`);
    }
  }

  const grouped = (anchor: VerticalRhythmAnchor) => layers
    .map((layer, index) => ({ layer, index }))
    .filter((item) => options.anchors[item.index] === anchor);
  const placements = new Map<number, number>();
  const top = grouped("top");
  const upper = grouped("upper-middle");
  const bottom = grouped("bottom");
  const remainder = grouped("remaining-space");

  let topCursor = safe.y;
  for (const item of top) {
    placements.set(item.index, topCursor);
    topCursor += item.layer.frame.height;
  }

  const upperHeight = upper.reduce((sum, item) => sum + item.layer.frame.height, 0);
  const upperStart = upper.length === 0
    ? safe.y
    : safe.y + (safe.height * 0.38) - (upperHeight / 2);
  let upperCursor = upperStart;
  for (const item of upper) {
    placements.set(item.index, upperCursor);
    upperCursor += item.layer.frame.height;
  }

  const bottomHeight = bottom.reduce((sum, item) => sum + item.layer.frame.height, 0);
  let bottomCursor = safe.y + safe.height - bottomHeight;
  for (const item of bottom) {
    placements.set(item.index, bottomCursor);
    bottomCursor += item.layer.frame.height;
  }

  const remainderStart = Math.max(topCursor, upperStart + upperHeight);
  const remainderEnd = bottom.length === 0 ? safe.y + safe.height : bottomCursor - bottomHeight;
  const remainderHeight = remainder.reduce((sum, item) => sum + item.layer.frame.height, 0);
  const free = remainderEnd - remainderStart - remainderHeight;
  if (remainder.length > 0 && free < 0) {
    throw new Error("Anchored groups leave no room for remaining-space layers");
  }
  const gap = remainder.length === 0 ? 0 : free / (remainder.length + 1);
  let remainderCursor = remainderStart + gap;
  for (const item of remainder) {
    placements.set(item.index, remainderCursor);
    remainderCursor += item.layer.frame.height + gap;
  }

  return layers.map((layer, index) => {
    const y = placements.get(index);
    if (y === undefined) throw new Error(`No vertical rhythm placement for layer ${layer.id}`);
    return positioned(layer, layer.frame.x, y, safe);
  });
}
