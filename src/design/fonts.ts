/**
 * Deterministic font registration and document font resolution.
 *
 * resvg's system-font fallback varies by host and can produce missing Korean
 * glyphs, so raster exports always select validated font files explicitly.
 */

import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DesignDocument } from "./document.js";

export type MissingFontPolicy = "throw" | "warn" | "ignore";

export interface FontRegistration {
  family: string;
  weight: number;
  file: string;
}

/**
 * A font's normalized horizontal metrics. Returning em units keeps callers
 * independent of a particular document font size while retaining real glyph
 * advances instead of relying on character-class averages.
 */
export interface GlyphAdvanceProvider {
  advanceForCodePoint(codePoint: number): number;
}

interface TableRecord {
  offset: number;
  length: number;
}

interface CmapFormat4 {
  format: 4;
  offset: number;
  length: number;
  segCount: number;
}

interface CmapFormat12 {
  format: 12;
  offset: number;
  length: number;
  groups: number;
}

interface ParsedFontMetrics {
  unitsPerEm: number;
  indexToLocFormat: number;
  numGlyphs: number;
  numberOfHMetrics: number;
  advances: number[];
  advanceByCodePoint: Map<number, number>;
  cmap4?: CmapFormat4;
  cmap12?: CmapFormat12;
  data: Buffer;
}

const parsedFontMetrics = new Map<string, ParsedFontMetrics>();
const providersByFile = new Map<string, GlyphAdvanceProvider>();
const conservativeProvidersByFiles = new Map<string, GlyphAdvanceProvider>();
const fontMetricsParseCounts = new Map<string, number>();
let fontMetricsCacheHits = 0;
let fontMetricsParseMilliseconds = 0;
let fontProviderCacheHits = 0;
let conservativeProviderCacheHits = 0;

/**
 * Return parser activity for regression tests. This remains module-local
 * rather than part of the design-engine barrel because callers must not rely
 * on an implementation detail of font resolution.
 */
export function getFontMetricsDiagnosticsForTesting(): {
  parseCounts: ReadonlyMap<string, number>;
  cacheHits: number;
  parseMilliseconds: number;
  providerCacheHits: number;
  conservativeProviderCacheHits: number;
} {
  return {
    parseCounts: new Map(fontMetricsParseCounts),
    cacheHits: fontMetricsCacheHits,
    parseMilliseconds: fontMetricsParseMilliseconds,
    providerCacheHits: fontProviderCacheHits,
    conservativeProviderCacheHits,
  };
}

function tableRecords(data: Buffer): Map<string, TableRecord> {
  if (data.length < 12) throw new Error("Font file is missing its sfnt header");
  const count = data.readUInt16BE(4);
  const directoryLength = 12 + (count * 16);
  if (directoryLength > data.length) throw new Error("Font file has a truncated sfnt directory");

  const tables = new Map<string, TableRecord>();
  for (let index = 0; index < count; index += 1) {
    const offset = 12 + (index * 16);
    const tag = data.toString("ascii", offset, offset + 4);
    const tableOffset = data.readUInt32BE(offset + 8);
    const length = data.readUInt32BE(offset + 12);
    if (tableOffset > data.length || length > data.length - tableOffset) {
      throw new Error(`Font table ${tag} is outside the file bounds`);
    }
    tables.set(tag, { offset: tableOffset, length });
  }
  return tables;
}

function requiredTable(tables: Map<string, TableRecord>, tag: string, minimumLength: number): TableRecord {
  const table = tables.get(tag);
  if (table === undefined || table.length < minimumLength) {
    throw new Error(`Font file is missing a valid ${tag} table`);
  }
  return table;
}

function tableContains(table: TableRecord, offset: number, length: number): boolean {
  return offset >= table.offset && length >= 0 && offset <= table.offset + table.length - length;
}

function selectCmap(data: Buffer, table: TableRecord): { cmap4?: CmapFormat4; cmap12?: CmapFormat12 } {
  if (table.length < 4) throw new Error("Font file has a truncated cmap table");
  const records = data.readUInt16BE(table.offset + 2);
  if (4 + (records * 8) > table.length) throw new Error("Font file has a truncated cmap directory");

  let cmap4: CmapFormat4 | undefined;
  let cmap12: CmapFormat12 | undefined;
  for (let index = 0; index < records; index += 1) {
    const record = table.offset + 4 + (index * 8);
    const subtableOffset = table.offset + data.readUInt32BE(record + 4);
    if (!tableContains(table, subtableOffset, 2)) continue;
    const format = data.readUInt16BE(subtableOffset);

    if (format === 4 && tableContains(table, subtableOffset, 8)) {
      const length = data.readUInt16BE(subtableOffset + 2);
      const segCountX2 = data.readUInt16BE(subtableOffset + 6);
      if (length >= 16 && segCountX2 % 2 === 0 && tableContains(table, subtableOffset, length)) {
        cmap4 ??= { format: 4, offset: subtableOffset, length, segCount: segCountX2 / 2 };
      }
    }

    if (format === 12 && tableContains(table, subtableOffset, 16)) {
      const length = data.readUInt32BE(subtableOffset + 4);
      const groups = data.readUInt32BE(subtableOffset + 12);
      if (length >= 16 + (groups * 12) && tableContains(table, subtableOffset, length)) {
        cmap12 ??= { format: 12, offset: subtableOffset, length, groups };
      }
    }
  }
  return { cmap4, cmap12 };
}

/** Parse only the sfnt tables needed to turn a code point into an hmtx advance. */
function parseFontMetrics(file: string): ParsedFontMetrics {
  const cached = parsedFontMetrics.get(file);
  if (cached !== undefined) {
    fontMetricsCacheHits += 1;
    return cached;
  }

  fontMetricsParseCounts.set(file, (fontMetricsParseCounts.get(file) ?? 0) + 1);
  const started = performance.now();

  const data = readFileSync(file);
  if (!FONT_MAGICS.has(data.subarray(0, 4).toString("latin1"))) {
    throw new Error(`Font file is not a supported sfnt font: ${file}`);
  }
  const tables = tableRecords(data);
  const head = requiredTable(tables, "head", 54);
  const maxp = requiredTable(tables, "maxp", 6);
  const hhea = requiredTable(tables, "hhea", 36);
  const hmtx = requiredTable(tables, "hmtx", 4);
  const cmap = requiredTable(tables, "cmap", 4);

  const unitsPerEm = data.readUInt16BE(head.offset + 18);
  const indexToLocFormat = data.readInt16BE(head.offset + 50);
  const numGlyphs = data.readUInt16BE(maxp.offset + 4);
  const numberOfHMetrics = data.readUInt16BE(hhea.offset + 34);
  if (unitsPerEm === 0 || numberOfHMetrics === 0 || numberOfHMetrics > numGlyphs) {
    throw new Error(`Font file has invalid horizontal metrics: ${file}`);
  }
  if (hmtx.length < numberOfHMetrics * 4) {
    throw new Error(`Font file has a truncated hmtx table: ${file}`);
  }

  const advances: number[] = [];
  for (let glyph = 0; glyph < numberOfHMetrics; glyph += 1) {
    advances.push(data.readUInt16BE(hmtx.offset + (glyph * 4)));
  }

  const parsed: ParsedFontMetrics = {
    unitsPerEm,
    indexToLocFormat,
    numGlyphs,
    numberOfHMetrics,
    advances,
    advanceByCodePoint: new Map(),
    ...selectCmap(data, cmap),
    data,
  };
  parsedFontMetrics.set(file, parsed);
  fontMetricsParseMilliseconds += performance.now() - started;
  return parsed;
}

function glyphFromFormat12(font: ParsedFontMetrics, codePoint: number): number | undefined {
  const cmap = font.cmap12;
  if (cmap === undefined) return undefined;
  let low = 0;
  let high = cmap.groups - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const group = cmap.offset + 16 + (middle * 12);
    const start = font.data.readUInt32BE(group);
    const end = font.data.readUInt32BE(group + 4);
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return font.data.readUInt32BE(group + 8) + (codePoint - start);
  }
  return undefined;
}

function glyphFromFormat4(font: ParsedFontMetrics, codePoint: number): number | undefined {
  const cmap = font.cmap4;
  if (cmap === undefined || codePoint > 0xFFFF) return undefined;
  const endCodes = cmap.offset + 14;
  const startCodes = endCodes + (cmap.segCount * 2) + 2;
  const idDeltas = startCodes + (cmap.segCount * 2);
  const idRangeOffsets = idDeltas + (cmap.segCount * 2);
  if (idRangeOffsets + (cmap.segCount * 2) > cmap.offset + cmap.length) return undefined;

  let low = 0;
  let high = cmap.segCount - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const end = font.data.readUInt16BE(endCodes + (middle * 2));
    if (codePoint > end) {
      low = middle + 1;
      continue;
    }
    const start = font.data.readUInt16BE(startCodes + (middle * 2));
    if (codePoint < start) {
      high = middle - 1;
      continue;
    }
    const delta = font.data.readInt16BE(idDeltas + (middle * 2));
    const rangeOffsetAddress = idRangeOffsets + (middle * 2);
    const rangeOffset = font.data.readUInt16BE(rangeOffsetAddress);
    if (rangeOffset === 0) return (codePoint + delta) & 0xFFFF;
    const glyphAddress = rangeOffsetAddress + rangeOffset + (2 * (codePoint - start));
    if (glyphAddress + 2 > cmap.offset + cmap.length) return undefined;
    const glyph = font.data.readUInt16BE(glyphAddress);
    return glyph === 0 ? 0 : (glyph + delta) & 0xFFFF;
  }
  return undefined;
}

function advanceForCodePoint(font: ParsedFontMetrics, codePoint: number): number {
  const cached = font.advanceByCodePoint.get(codePoint);
  if (cached !== undefined) return cached;

  const glyph = glyphFromFormat12(font, codePoint) ?? glyphFromFormat4(font, codePoint) ?? 0;
  if (glyph >= font.numGlyphs) {
    const fallback = font.advances[0] / font.unitsPerEm;
    font.advanceByCodePoint.set(codePoint, fallback);
    return fallback;
  }
  const advance = glyph < font.numberOfHMetrics
    ? font.advances[glyph]
    : font.advances.at(-1);
  const normalizedAdvance = (advance ?? 0) / font.unitsPerEm;
  font.advanceByCodePoint.set(codePoint, normalizedAdvance);
  return normalizedAdvance;
}

/**
 * Reuse a provider by resolved file so all font sizes share immutable em
 * advances and repeated characters avoid another cmap binary search.
 */
function providerForFile(file: string): GlyphAdvanceProvider {
  const cached = providersByFile.get(file);
  if (cached !== undefined) {
    fontProviderCacheHits += 1;
    return cached;
  }

  const font = parseFontMetrics(file);
  const provider = {
    advanceForCodePoint: (codePoint: number) => advanceForCodePoint(font, codePoint),
  };
  providersByFile.set(file, provider);
  return provider;
}

export interface ResolveDocumentFontsOptions {
  registry?: FontRegistry;
  /** Defaults to throw so an unrenderable document cannot silently ship tofu. */
  onMissingFont?: MissingFontPolicy;
}

export interface ResolvedDocumentFonts {
  fontFiles: string[];
  defaultFontFamily: string;
  missing: string[];
}

const FONT_MAGICS = new Set(["\u0000\u0001\u0000\u0000", "true", "ttcf", "OTTO"]);

/**
 * Verify inputs before resvg sees them so callers get actionable path or file
 * errors instead of renderer-specific parse failures.
 */
export function validateFontFiles(fontFiles: readonly string[]): string[] {
  return fontFiles.map((fontFile) => {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(fontFile, "r");
      const header = Buffer.alloc(4);
      const bytesRead = readSync(descriptor, header, 0, header.length, 0);
      if (bytesRead !== header.length || !FONT_MAGICS.has(header.toString("latin1"))) {
        throw new Error(`Font file is not a supported sfnt font: ${fontFile}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Font file is not")) {
        throw error;
      }
      const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
      throw new Error(`Font file is not readable: ${fontFile}${detail}`, { cause: error });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    return fontFile;
  });
}

/** A small registry makes the font set explicit and independently testable. */
export class FontRegistry {
  readonly defaultFontFamily: string;
  private readonly registrations: FontRegistration[] = [];

  constructor(defaultFontFamily: string) {
    this.defaultFontFamily = defaultFontFamily;
  }

  /** Register a face by family and weight; resolution validates its path later. */
  register(registration: FontRegistration): this {
    this.registrations.push({ ...registration });
    return this;
  }

  filesForFamily(family: string): string[] {
    return this.registrations
      .filter((registration) => registration.family === family)
      .sort((left, right) => left.weight - right.weight)
      .map((registration) => registration.file);
  }

  /**
   * Use the nearest registered face because renderers synthesize unregistered
   * weights from the closest available bundled face as well.
   */
  registrationFor(family: string, weight: number): FontRegistration | undefined {
    return this.registrations
      .filter((registration) => registration.family === family)
      .sort((left, right) => {
        const distance = Math.abs(left.weight - weight) - Math.abs(right.weight - weight);
        return distance === 0 ? left.weight - right.weight : distance;
      })[0];
  }

  registrationsForFamily(family: string): FontRegistration[] {
    return this.registrations
      .filter((registration) => registration.family === family)
      .map((registration) => ({ ...registration }));
  }
}

/**
 * Resolve package-owned font files from this module rather than cwd: callers
 * can invoke the CLI from anywhere, and both src tests and published dist
 * retain this relative layout.
 */
export const BUNDLED_DEFAULT_FONT_FILES = [
  fileURLToPath(
    new URL("../../assets/fonts/IBMPlexSansKR-Regular.ttf", import.meta.url),
  ),
  fileURLToPath(
    new URL("../../assets/fonts/IBMPlexSansKR-SemiBold.ttf", import.meta.url),
  ),
] as const;

export const bundledFontRegistry = new FontRegistry("IBM Plex Sans KR")
  .register({ family: "IBM Plex Sans KR", weight: 400, file: BUNDLED_DEFAULT_FONT_FILES[0] })
  .register({ family: "IBM Plex Sans KR", weight: 600, file: BUNDLED_DEFAULT_FONT_FILES[1] });

/**
 * Return normalized glyph advances for a registered face. Tables are cached by
 * path because bundled fonts are multi-megabyte files and text layout calls
 * this repeatedly during QA and auto-layout.
 */
export function glyphAdvanceProviderFor(
  family: string,
  weight = 400,
  registry: FontRegistry = bundledFontRegistry,
): GlyphAdvanceProvider | undefined {
  const registration = registry.registrationFor(family, weight);
  if (registration === undefined) return undefined;
  return providerForFile(registration.file);
}

/**
 * Existing metric call sites do not carry a layer weight. Use the widest real
 * advance from the registered faces so those callers cannot turn an unknown
 * weight into a false "fits" result while they migrate to explicit metrics.
 */
export function conservativeGlyphAdvanceProviderFor(
  family: string,
  registry: FontRegistry = bundledFontRegistry,
): GlyphAdvanceProvider | undefined {
  const files = registry.registrationsForFamily(family)
    .map((registration) => registration.file)
    .sort();
  if (files.length === 0) return undefined;

  const key = files.join("\u0000");
  const cached = conservativeProvidersByFiles.get(key);
  if (cached !== undefined) {
    conservativeProviderCacheHits += 1;
    return cached;
  }

  const providers = files.map((file) => providerForFile(file));
  const provider = {
    advanceForCodePoint: (codePoint: number) => {
      let widest = 0;
      for (const candidate of providers) {
        widest = Math.max(widest, candidate.advanceForCodePoint(codePoint));
      }
      return widest;
    },
  };
  conservativeProvidersByFiles.set(key, provider);
  return provider;
}

/** Collect each declared text family once, preserving the document's page order. */
export function collectDocumentFontFamilies(document: DesignDocument): string[] {
  const families = new Set<string>();
  for (const page of document.pages) {
    for (const layer of page.layers) {
      if (layer.type === "text") families.add(layer.fontFamily);
    }
  }
  return [...families];
}

/**
 * Select every registered face for used families, retaining available weights
 * for resvg's matching and synthetic-weight fallback. The bundled default is
 * also present for deterministic fallback even in a document with no text.
 */
export function resolveDocumentFonts(
  document: DesignDocument,
  options: ResolveDocumentFontsOptions = {},
): ResolvedDocumentFonts {
  const registry = options.registry ?? bundledFontRegistry;
  const families = collectDocumentFontFamilies(document);
  const missing = families.filter((family) => registry.filesForFamily(family).length === 0);
  const onMissingFont = options.onMissingFont ?? "throw";

  if (missing.length > 0) {
    const message = `No registered font files for: ${missing.join(", ")}`;
    if (onMissingFont === "throw") throw new Error(message);
    if (onMissingFont === "warn") console.warn(message);
  }

  const files = [
    ...registry.filesForFamily(registry.defaultFontFamily),
    ...families.flatMap((family) => registry.filesForFamily(family)),
  ];

  return {
    fontFiles: validateFontFiles([...new Set(files)]),
    defaultFontFamily: registry.defaultFontFamily,
    missing,
  };
}
