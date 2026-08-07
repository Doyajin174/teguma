/**
 * Deterministic text-frame repair for declarative design documents.
 *
 * Text metrics can prove that an authored frame overflows, but a design agent
 * cannot click and drag it like a MiriCanvas user. This module makes the
 * corrective decision explicit, immutable, and repeatable before export.
 */

import type { DesignDocument, TextLayer } from "./document.js";
import { estimateTextWidth, measureTextBlock, wrapText } from "./text-metrics.js";

const DEFAULT_MINIMUM_FONT_SCALE = 0.6;
const DEFAULT_CANDIDATE_COUNT = 41;

export type TextOverflowPolicy = "shrink" | "grow" | "truncate";

export interface AutoLayoutOptions {
  /** Smallest allowed font size, expressed as a fraction of the authored size. */
  minimumFontScale?: number;
  /**
   * Action when wrapping and shrinking to the floor cannot fit the frame.
   * `grow` is the default because it preserves authored text while staying in
   * the canvas safe area; `truncate` deliberately discards hidden text.
   */
  onOverflow?: TextOverflowPolicy;
}

export interface TextLayerChange {
  pageId: string;
  layerId: string;
  wrappedLineCount: number;
  fontSizeBefore: number;
  fontSizeAfter: number;
  frameHeightBefore: number;
  frameHeightAfter: number;
  truncated: boolean;
}

export interface AutoLayoutResult {
  document: DesignDocument;
  changes: TextLayerChange[];
}

interface ResolvedAutoLayoutOptions {
  minimumFontScale: number;
  onOverflow: TextOverflowPolicy;
}

interface FittedTextLayer {
  layer: TextLayer;
  truncated: boolean;
}

function resolveOptions(options: AutoLayoutOptions): ResolvedAutoLayoutOptions {
  const minimumFontScale = options.minimumFontScale ?? DEFAULT_MINIMUM_FONT_SCALE;
  if (!Number.isFinite(minimumFontScale) || minimumFontScale <= 0 || minimumFontScale > 1) {
    throw new Error("minimumFontScale must be a finite number greater than 0 and at most 1");
  }

  return {
    minimumFontScale,
    onOverflow: options.onOverflow ?? "grow",
  };
}

function roundFontSize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Return a stable largest-to-smallest candidate ladder. Rounding makes the
 * serialized result independent of intermediate floating-point operations.
 */
function fontSizeCandidates(fontSize: number, minimumFontScale: number): number[] {
  const candidates = new Set<number>();
  for (let index = 0; index < DEFAULT_CANDIDATE_COUNT; index += 1) {
    const progress = index / (DEFAULT_CANDIDATE_COUNT - 1);
    const scale = 1 - ((1 - minimumFontScale) * progress);
    candidates.add(roundFontSize(fontSize * scale));
  }
  candidates.add(roundFontSize(fontSize * minimumFontScale));
  return [...candidates].sort((a, b) => b - a);
}

function wrappedLayer(layer: TextLayer, fontSize: number, maxLines?: number): {
  text: string;
  width: number;
  height: number;
  overflowed: boolean;
} {
  const wrapped = wrapText(layer.text, {
    fontSize,
    letterSpacing: layer.letterSpacing,
    maxWidth: layer.frame.width,
    fontFamily: layer.fontFamily,
    fontWeight: layer.fontWeight,
    ...(maxLines === undefined ? {} : { maxLines }),
  });
  const text = wrapped.lines.join("\n");
  const measurement = measureTextBlock(text, {
    fontSize,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
    fontFamily: layer.fontFamily,
    fontWeight: layer.fontWeight,
  });
  return { text, width: measurement.width, height: measurement.height, overflowed: wrapped.overflowed };
}

function assertMinimumGlyphFits(
  layer: TextLayer,
  pageId: string,
  minimumFontSize: number,
): void {
  const glyphWidths = Array.from(layer.text)
    .filter((character) => character !== "\n" && !/^\s$/u.test(character))
    .map((character) => estimateTextWidth(character, minimumFontSize, layer.letterSpacing, {
      fontFamily: layer.fontFamily,
      fontWeight: layer.fontWeight,
    }));
  const widestGlyph = Math.max(...glyphWidths);

  if (widestGlyph > layer.frame.width) {
    throw new Error(
      `Cannot auto-layout ${pageId}/${layer.id}: frame width ${layer.frame.width} is too small for a single glyph at minimum font size ${minimumFontSize}. Widen the frame or lower minimumFontScale.`,
    );
  }
}

function maximumSafeHeight(document: DesignDocument, layer: TextLayer, pageId: string): number {
  const safeMargin = document.canvas.safeMargin;
  if (safeMargin > 0 && layer.frame.y < safeMargin) {
    throw new Error(
      `Cannot grow ${pageId}/${layer.id}: its frame starts above the canvas safe area. Move it inside the safe area or use onOverflow: "truncate".`,
    );
  }

  return document.canvas.height - safeMargin - layer.frame.y;
}

function fitLayer(
  document: DesignDocument,
  pageId: string,
  layer: TextLayer,
  options: ResolvedAutoLayoutOptions,
): FittedTextLayer {
  const candidates = fontSizeCandidates(layer.fontSize, options.minimumFontScale);
  const minimumFontSize = candidates.at(-1);
  if (minimumFontSize === undefined || minimumFontSize <= 0) {
    throw new Error(`Cannot auto-layout ${pageId}/${layer.id}: no positive font-size candidates`);
  }
  assertMinimumGlyphFits(layer, pageId, minimumFontSize);

  for (const fontSize of candidates) {
    const wrapped = wrappedLayer(layer, fontSize);
    if (wrapped.width <= layer.frame.width && wrapped.height <= layer.frame.height) {
      return {
        layer: { ...layer, text: wrapped.text, fontSize },
        truncated: false,
      };
    }
  }

  const floor = wrappedLayer(layer, minimumFontSize);
  if (floor.width > layer.frame.width) {
    throw new Error(
      `Cannot auto-layout ${pageId}/${layer.id}: its frame remains too narrow at minimum font size ${minimumFontSize}. Widen the frame or lower minimumFontScale.`,
    );
  }

  if (options.onOverflow === "grow") {
    const availableHeight = maximumSafeHeight(document, layer, pageId);
    if (floor.height > availableHeight) {
      throw new Error(
        `Cannot grow ${pageId}/${layer.id} to ${floor.height}: only ${availableHeight} is available inside the canvas safe area. Use onOverflow: "truncate" or revise the layout.`,
      );
    }
    return {
      layer: {
        ...layer,
        text: floor.text,
        fontSize: minimumFontSize,
        frame: { ...layer.frame, height: Math.max(layer.frame.height, floor.height) },
      },
      truncated: false,
    };
  }

  if (options.onOverflow === "truncate") {
    const lineHeight = minimumFontSize * layer.lineHeight;
    const maxLines = Math.floor(layer.frame.height / lineHeight);
    if (maxLines < 1) {
      throw new Error(
        `Cannot truncate ${pageId}/${layer.id}: frame height ${layer.frame.height} cannot fit one line at minimum font size ${minimumFontSize}. Grow the frame or lower minimumFontScale.`,
      );
    }

    let truncated;
    try {
      truncated = wrappedLayer(layer, minimumFontSize, maxLines);
    } catch (error) {
      throw new Error(
        `Cannot truncate ${pageId}/${layer.id}: its frame is too narrow for an ellipsis at minimum font size ${minimumFontSize}. Widen the frame or lower minimumFontScale.`,
        { cause: error },
      );
    }
    return {
      layer: { ...layer, text: truncated.text, fontSize: minimumFontSize },
      truncated: truncated.overflowed,
    };
  }

  throw new Error(
    `Cannot fit ${pageId}/${layer.id} at minimum font size ${minimumFontSize}. Use onOverflow: "grow" or "truncate", or lower minimumFontScale.`,
  );
}

function layoutDocument(document: DesignDocument, options: ResolvedAutoLayoutOptions): AutoLayoutResult {
  const changes: TextLayerChange[] = [];
  const laidOut: DesignDocument = {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      layers: page.layers.map((layer) => {
        if (layer.type !== "text") return { ...layer, frame: { ...layer.frame } };

        const fitted = fitLayer(document, page.id, layer, options);
        const result = fitted.layer;
        const changed = result.text !== layer.text
          || result.fontSize !== layer.fontSize
          || result.frame.height !== layer.frame.height;
        if (changed) {
          changes.push({
            pageId: page.id,
            layerId: layer.id,
            wrappedLineCount: result.text.split("\n").length,
            fontSizeBefore: layer.fontSize,
            fontSizeAfter: result.fontSize,
            frameHeightBefore: layer.frame.height,
            frameHeightAfter: result.frame.height,
            truncated: fitted.truncated,
          });
        }
        return result;
      }),
    })),
  };

  return { document: laidOut, changes };
}

/** Hard-wrap every text layer to its existing frame width without mutation. */
export function wrapTextLayers(document: DesignDocument): DesignDocument {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      layers: page.layers.map((layer) => layer.type === "text"
        ? { ...layer, text: wrappedLayer(layer, layer.fontSize).text }
        : { ...layer, frame: { ...layer.frame } }),
    })),
  };
}

/** Wrap and fit all text layers, throwing when the chosen policy cannot be QA-clean. */
export function fitTextLayers(document: DesignDocument, options: AutoLayoutOptions = {}): DesignDocument {
  return layoutDocument(document, resolveOptions(options)).document;
}

/**
 * Wrap and fit every text layer and report each material decision. The default
 * overflow policy is `grow`, so text is never silently discarded.
 */
export function autoLayoutDocument(
  document: DesignDocument,
  options: AutoLayoutOptions = {},
): AutoLayoutResult {
  return layoutDocument(document, resolveOptions(options));
}
