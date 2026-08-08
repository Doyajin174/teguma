/**
 * Predictable text measurement and wrapping for design QA.
 *
 * Raster exports use bundled fonts, so registered faces are measured from
 * their sfnt glyph advances. Heuristics remain only for unregistered families
 * where a conservative false overflow is safer than clipped exported text.
 */

import {
  bundledFontRegistry,
  conservativeGlyphAdvanceProviderFor,
  glyphAdvanceProviderFor,
  type FontRegistry,
  type GlyphAdvanceProvider,
} from "./fonts.js";

/**
 * Conservative fallback advances in em for an unregistered font. These are
 * intentionally wide (3em): an arbitrary supplied display face can have ink
 * far wider than its common Latin advance. Claiming a line fits when it can
 * clip is worse than asking an author to widen a frame.
 */
export const TEXT_WIDTH_RATIOS = {
  fullWidth: 3,
  latin: 3,
  space: 0.5,
  narrow: 3,
  punctuation: 3,
  other: 3,
} as const;

export interface TextMetricsOptions {
  /** Defaults to the bundled face used by the design engine's raster export. */
  fontFamily?: string;
  /** Selects the closest registered face; defaults to regular (400). */
  fontWeight?: number;
  /** Allows callers with an explicit registry to retain matching metrics. */
  registry?: FontRegistry;
}

export interface WrapTextOptions extends TextMetricsOptions {
  fontSize: number;
  letterSpacing: number;
  maxWidth: number;
  maxLines?: number;
}

export interface WrappedText {
  lines: string[];
  overflowed: boolean;
}

export interface MeasureTextBlockOptions extends TextMetricsOptions {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  maxWidth?: number;
  maxLines?: number;
}

export interface TextBlockMeasurement {
  lines: string[];
  width: number;
  height: number;
  overflowed: boolean;
}

interface ResolvedMetrics {
  provider?: GlyphAdvanceProvider;
}

const textMetricsDiagnostics = {
  estimateTextWidthCalls: 0,
  wrapTextCalls: 0,
};

/**
 * Return lightweight call counts for performance regression tests without
 * changing the production measurement contract.
 */
export function getTextMetricsDiagnosticsForTesting(): Readonly<typeof textMetricsDiagnostics> {
  return { ...textMetricsDiagnostics };
}

/** Reset instrumentation so a benchmark can report one isolated operation. */
export function resetTextMetricsDiagnosticsForTesting(): void {
  textMetricsDiagnostics.estimateTextWidthCalls = 0;
  textMetricsDiagnostics.wrapTextCalls = 0;
}

function ratioFor(character: string): number {
  if (/^[\uAC00-\uD7A3\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFEE]$/u.test(character)) {
    return TEXT_WIDTH_RATIOS.fullWidth;
  }
  if (/^\s$/u.test(character)) return TEXT_WIDTH_RATIOS.space;
  if (/^[.,:;!'|iIl]$/u.test(character)) return TEXT_WIDTH_RATIOS.narrow;
  if (/^[A-Za-z0-9]$/u.test(character)) return TEXT_WIDTH_RATIOS.latin;
  if ("-–—_()[]{}?/\\@#$%^&*+=~`\"<>".includes(character)) {
    return TEXT_WIDTH_RATIOS.punctuation;
  }
  return TEXT_WIDTH_RATIOS.other;
}

function resolveMetrics(options: TextMetricsOptions = {}): ResolvedMetrics {
  const registry = options.registry ?? bundledFontRegistry;
  const family = options.fontFamily ?? registry.defaultFontFamily;
  return {
    provider: options.fontWeight === undefined
      ? conservativeGlyphAdvanceProviderFor(family, registry)
      : glyphAdvanceProviderFor(family, options.fontWeight, registry),
  };
}

function glyphWidth(character: string, fontSize: number, metrics: ResolvedMetrics): number {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (metrics.provider !== undefined) {
    // A mapped combining glyph has a zero hmtx advance and must stay zero.
    return metrics.provider.advanceForCodePoint(codePoint) * fontSize;
  }
  return ratioFor(character) * fontSize;
}

function measureLine(text: string, fontSize: number, letterSpacing: number, metrics: ResolvedMetrics): number {
  let totalGlyphWidth = 0;
  let widestGlyphWidth = 0;
  let characterCount = 0;
  for (const character of text) {
    const width = glyphWidth(character, fontSize, metrics);
    totalGlyphWidth += width;
    widestGlyphWidth = Math.max(widestGlyphWidth, width);
    characterCount += 1;
  }
  const trackedWidth = totalGlyphWidth + (Math.max(0, characterCount - 1) * letterSpacing);

  /**
   * Resvg overlaps glyphs when negative SVG letter-spacing exceeds their
   * advances; it does not erase the widest glyph's ink. Retaining that floor
   * prevents a negative advance from turning a visibly wide run into zero.
   */
  return Math.max(widestGlyphWidth, trackedWidth);
}

/**
 * Estimate a single rendered line's advance width in document units. Code
 * points, rather than UTF-16 code units, keep surrogate-pair glyph lookup
 * correct for non-BMP characters.
 */
export function estimateTextWidth(
  text: string,
  fontSize: number,
  letterSpacing: number,
  options: TextMetricsOptions = {},
): number {
  textMetricsDiagnostics.estimateTextWidthCalls += 1;
  return measureLine(text, fontSize, letterSpacing, resolveMetrics(options));
}

function splitLongToken(
  token: string,
  maxWidth: number,
  fontSize: number,
  letterSpacing: number,
  metrics: ResolvedMetrics,
): string[] {
  const lines: string[] = [];
  let characters: string[] = [];
  let width = 0;

  for (const character of token) {
    const characterWidth = glyphWidth(character, fontSize, metrics);
    const nextWidth = width
      + (characters.length > 0 ? letterSpacing : 0)
      + characterWidth;
    if (characters.length > 0 && nextWidth > maxWidth) {
      lines.push(characters.join(""));
      characters = [character];
      width = characterWidth;
    } else {
      characters.push(character);
      width = nextWidth;
    }
  }

  if (characters.length > 0) lines.push(characters.join(""));
  return lines;
}

function truncateWithEllipsis(
  line: string,
  maxWidth: number,
  fontSize: number,
  letterSpacing: number,
  metrics: ResolvedMetrics,
): string {
  const ellipsis = "…";
  const ellipsisWidth = glyphWidth(ellipsis, fontSize, metrics);
  if (ellipsisWidth > maxWidth) throw new Error("maxWidth is too small to fit an ellipsis");

  const visible: string[] = [];
  let width = 0;
  for (const character of line.trimEnd()) {
    const nextWidth = width
      + (visible.length > 0 ? letterSpacing : 0)
      + glyphWidth(character, fontSize, metrics)
      + letterSpacing
      + ellipsisWidth;
    if (nextWidth > maxWidth) break;
    visible.push(character);
    width += (visible.length > 1 ? letterSpacing : 0) + glyphWidth(character, fontSize, metrics);
  }
  return `${visible.join("").trimEnd()}${ellipsis}`;
}

/**
 * Greedily wrap text to a width, honoring explicit newlines and splitting a
 * single oversized token at character boundaries when necessary.
 */
export function wrapText(text: string, options: WrapTextOptions): WrappedText {
  textMetricsDiagnostics.wrapTextCalls += 1;
  const { fontSize, letterSpacing, maxWidth, maxLines } = options;
  if (maxWidth <= 0) throw new Error("maxWidth must be greater than 0");
  if (maxLines !== undefined && (!Number.isInteger(maxLines) || maxLines <= 0)) {
    throw new Error("maxLines must be a positive integer");
  }

  const metrics = resolveMetrics(options);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }

    let line = "";
    let lineWidth = 0;
    for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
      const tokenWidth = measureLine(token, fontSize, letterSpacing, metrics);
      if (/^\s+$/u.test(token)) {
        if (line.length === 0) continue;
        if (lineWidth + letterSpacing + tokenWidth <= maxWidth) {
          line += token;
          lineWidth += letterSpacing + tokenWidth;
        } else {
          lines.push(line.trimEnd());
          line = "";
          lineWidth = 0;
        }
        continue;
      }

      if (tokenWidth > maxWidth) {
        if (line.length > 0) {
          lines.push(line.trimEnd());
        }
        const fragments = splitLongToken(token, maxWidth, fontSize, letterSpacing, metrics);
        lines.push(...fragments.slice(0, -1));
        line = fragments.at(-1) ?? "";
        lineWidth = measureLine(line, fontSize, letterSpacing, metrics);
        continue;
      }

      if (line.length === 0 || lineWidth + letterSpacing + tokenWidth <= maxWidth) {
        line += token;
        lineWidth = line.length === token.length ? tokenWidth : lineWidth + letterSpacing + tokenWidth;
      } else {
        lines.push(line.trimEnd());
        line = token;
        lineWidth = tokenWidth;
      }
    }
    lines.push(line.trimEnd());
  }

  if (maxLines !== undefined && lines.length > maxLines) {
    const visible = lines.slice(0, maxLines);
    visible[maxLines - 1] = truncateWithEllipsis(
      visible[maxLines - 1],
      maxWidth,
      fontSize,
      letterSpacing,
      metrics,
    );
    return { lines: visible, overflowed: true };
  }
  return { lines, overflowed: false };
}

/** Measure rendered hard lines, or wrap them first when a maxWidth is supplied. */
export function measureTextBlock(text: string, options: MeasureTextBlockOptions): TextBlockMeasurement {
  const { fontSize, lineHeight, letterSpacing, maxWidth, maxLines } = options;
  const wrapped = maxWidth === undefined
    ? { lines: text.split("\n"), overflowed: false }
    : wrapText(text, { ...options, maxWidth });
  const truncatedWithoutWidth = maxWidth === undefined
    && maxLines !== undefined
    && wrapped.lines.length > maxLines;
  const lines = truncatedWithoutWidth
    ? [...wrapped.lines.slice(0, maxLines - 1), `${wrapped.lines[maxLines - 1].trimEnd()}…`]
    : wrapped.lines;
  const metrics = resolveMetrics(options);

  return {
    lines,
    width: Math.max(0, ...lines.map((line) => measureLine(line, fontSize, letterSpacing, metrics))),
    height: lines.length * fontSize * lineHeight,
    overflowed: wrapped.overflowed || truncatedWithoutWidth,
  };
}
