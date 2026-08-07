/**
 * Document export.
 *
 * SVG comes straight from the serializer. PNG and JPG go through resvg. PDF is
 * assembled directly so multi-page export needs no extra dependency.
 */

import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";
import { deflateSync } from "node:zlib";
import type { DesignDocument } from "./document.js";
import { resolveDocumentFonts, validateFontFiles, type MissingFontPolicy } from "./fonts.js";
import { encodeJpeg } from "./jpeg.js";
import { encodeGif } from "./gif.js";
import { encodeMp4 } from "./mp4.js";
import { buildPptx } from "./pptx.js";
import { inspectDocument } from "./qa.js";
import { canvasPixelSize, renderDocumentToSvg, type ImageResolver } from "./svg.js";

export type ExportFormat = "svg" | "png" | "jpg" | "pdf" | "pptx" | "gif" | "mp4";

/** Raster dimensions are capped to keep MCP-triggered renders within bounded memory. */
const MAX_EXPORT_RASTER_DIMENSION = 8_192;
/** A page can use several RGBA/RGB buffers while it is rendered and compressed. */
const MAX_EXPORT_PIXELS_PER_PAGE = 16_000_000;
/** PDFs are assembled in memory, so limiting page count also bounds aggregate buffers. */
const MAX_EXPORT_PAGES = 10;
/** GIF holds all animation frames while it builds one shared palette and file. */
const MAX_GIF_TOTAL_PIXELS = 32_000_000;
/**
 * Motion JPEG frames are independently compressed, so an MP4 export costs a
 * full JPEG encode per page. The aggregate cap matches GIF so neither animated
 * format can be used to force unbounded work through the MCP server.
 */
const MAX_MP4_TOTAL_PIXELS = 32_000_000;
/** SVG serialization and QA are linear in layers; this prevents pathological documents. */
const MAX_EXPORT_LAYERS = 1_000;

export interface ExportOptions {
  format: ExportFormat;
  /**
   * Reject documents that fail design QA. Defaults to true so library callers
   * cannot bypass the same safety gate used by the public export tool.
   */
  enforceQa?: boolean;
  /** Output pixel width for PNG, JPG, PDF, and GIF. SVG preserves native canvas dimensions. */
  width?: number;
  /** PNG only. When false the page background is kept. */
  transparentBackground?: boolean;
  /** Flattening colour for JPG and for PNG when transparency is disabled. */
  backgroundColor?: string;
  /** JPG only. Baseline JPEG quality from 1 through 100. Defaults to 85. */
  quality?: number;
  /** GIF only. Per-frame delays in hundredths of a second; defaults to 10 (100ms). */
  gifFrameDelay?: number | number[];
  /** GIF only. Dithering helps photographs but makes flat brand panels noisy; defaults to false. */
  gifDither?: boolean;
  /**
   * MP4 frame duration in milliseconds, either one value for every page or one
   * value per page. Defaults to DEFAULT_MP4_FRAME_DURATION.
   */
  mp4FrameDuration?: number | number[];
  fontFiles?: string[];
  defaultFontFamily?: string;
  /** How registry resolution handles a document family with no registered file. */
  onMissingFont?: MissingFontPolicy;
  resolveImage?: ImageResolver;
}

export interface ExportedPage {
  pageId: string;
  data: Buffer;
}

export interface ExportResult {
  format: ExportFormat;
  width: number;
  height: number;
  /** One entry per page for svg/png/jpg, a single entry for pdf/pptx/gif. */
  files: ExportedPage[];
}

function renderSvgToPng(
  svg: string,
  font: { fontFiles: string[]; defaultFontFamily?: string },
  width: number,
): Buffer {
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: font.fontFiles,
      loadSystemFonts: false,
      ...(font.defaultFontFamily ? { defaultFontFamily: font.defaultFontFamily } : {}),
    },
  });
  return Buffer.from(renderer.render().asPng());
}

function parseHex(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Composite RGBA pixels onto an opaque background, returning an opaque PNG. */
function flattenPng(pngBuffer: Buffer, backgroundColor: string): Buffer {
  const source = PNG.sync.read(pngBuffer);
  const [br, bg, bb] = parseHex(backgroundColor);
  const output = new PNG({ width: source.width, height: source.height });

  for (let index = 0; index < source.data.length; index += 4) {
    const alpha = source.data[index + 3] / 255;
    output.data[index] = Math.round((source.data[index] * alpha) + (br * (1 - alpha)));
    output.data[index + 1] = Math.round((source.data[index + 1] * alpha) + (bg * (1 - alpha)));
    output.data[index + 2] = Math.round((source.data[index + 2] * alpha) + (bb * (1 - alpha)));
    output.data[index + 3] = 255;
  }

  return PNG.sync.write(output);
}

/**
 * Escape an ASCII PDF literal string after choosing its ASCII byte encoding.
 *
 * Control bytes are octal escaped so they cannot change PDF tokenization.
 */
function pdfEscape(value: string): string {
  return value.replace(/[\\()\u0000-\u001F\u007F]/g, (character) => {
    if (character === "\\" || character === "(" || character === ")") {
      return `\\${character}`;
    }
    return `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`;
  });
}

/**
 * Encode PDF text without allowing Unicode low bytes to become syntax tokens.
 *
 * PDF literal strings are safe only for ASCII here. Any non-ASCII input uses a
 * UTF-16BE hex string with a BOM, which is both lossless for Korean text and
 * cannot introduce parentheses or dictionary delimiters into the PDF grammar.
 */
function pdfText(value: string): string {
  if ([...value].every((character) => character.charCodeAt(0) <= 0x7F)) {
    return `(${pdfEscape(value)})`;
  }

  let hex = "FEFF";
  for (let index = 0; index < value.length; index += 1) {
    hex += value.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  }
  return `<${hex}>`;
}

/**
 * Build a PDF that embeds one raster image per page.
 *
 * Images are stored as FlateDecode RGB streams using Node's built-in zlib, so
 * multi-page exports stay small without adding a dependency. Page boxes use PDF
 * points, converting millimetre canvases at 72dpi.
 */
export function buildPdf(
  pages: Array<{ width: number; height: number; rgb: Buffer }>,
  pageBox: { width: number; height: number },
  title: string,
): Buffer {
  const objects: Buffer[] = [];

  const addObject = (body: Buffer | string): number => {
    objects.push(typeof body === "string" ? Buffer.from(body, "ascii") : body);
    return objects.length;
  };

  const pageObjectNumbers: number[] = [];
  const kidsPlaceholder = addObject("");

  for (const page of pages) {
    const stream = deflateSync(page.rgb, { level: 9 });
    const imageNumber = addObject(
      Buffer.concat([
        Buffer.from(
          [
            "<< /Type /XObject /Subtype /Image",
            ` /Width ${page.width} /Height ${page.height}`,
            " /ColorSpace /DeviceRGB /BitsPerComponent 8",
            " /Filter /FlateDecode",
            ` /Length ${stream.length} >>\nstream\n`,
          ].join(""),
          "ascii",
        ),
        stream,
        Buffer.from("\nendstream", "ascii"),
      ]),
    );

    const content = `q ${pageBox.width} 0 0 ${pageBox.height} 0 0 cm /Im0 Do Q`;
    const contentNumber = addObject(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );

    pageObjectNumbers.push(
      addObject(
        [
          "<< /Type /Page",
          ` /Parent ${kidsPlaceholder} 0 R`,
          ` /MediaBox [0 0 ${pageBox.width} ${pageBox.height}]`,
          ` /Resources << /XObject << /Im0 ${imageNumber} 0 R >> >>`,
          ` /Contents ${contentNumber} 0 R >>`,
        ].join(""),
      ),
    );
  }

  objects[kidsPlaceholder - 1] = Buffer.from(
    [
      "<< /Type /Pages",
      ` /Count ${pageObjectNumbers.length}`,
      ` /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] >>`,
    ].join(""),
    "ascii",
  );

  const infoNumber = addObject(`<< /Title ${pdfText(title)} /Producer ${pdfText("teguma")} >>`);
  const catalogNumber = addObject(`<< /Type /Catalog /Pages ${kidsPlaceholder} 0 R >>`);

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets: number[] = [];
  let cursor = chunks[0].length;

  for (const [index, body] of objects.entries()) {
    const header = Buffer.from(`${index + 1} 0 obj\n`, "ascii");
    const footer = Buffer.from("\nendobj\n", "ascii");
    offsets.push(cursor);
    chunks.push(header, body, footer);
    cursor += header.length + body.length + footer.length;
  }

  const xrefOffset = cursor;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
  for (const offset of offsets) {
    xrefLines.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(Buffer.from(xrefLines.join(""), "ascii"));
  chunks.push(
    Buffer.from(
      [
        `trailer\n<< /Size ${objects.length + 1}`,
        ` /Root ${catalogNumber} 0 R`,
        ` /Info ${infoNumber} 0 R >>\n`,
        `startxref\n${xrefOffset}\n%%EOF\n`,
      ].join(""),
      "ascii",
    ),
  );

  return Buffer.concat(chunks);
}

function pngToRgb(pngBuffer: Buffer): { width: number; height: number; rgb: Buffer } {
  const png = PNG.sync.read(pngBuffer);
  const rgb = Buffer.allocUnsafe(png.width * png.height * 3);
  for (let pixel = 0; pixel < png.width * png.height; pixel += 1) {
    rgb[pixel * 3] = png.data[pixel * 4];
    rgb[(pixel * 3) + 1] = png.data[(pixel * 4) + 1];
    rgb[(pixel * 3) + 2] = png.data[(pixel * 4) + 2];
  }
  return { width: png.width, height: png.height, rgb };
}

/** Read PNG IHDR dimensions without inflating image pixels a second time. */
function pngDimensions(png: Buffer): { width: number; height: number } {
  if (
    png.length < 24
    || png.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0
    || png.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("Renderer returned an invalid PNG");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Validate document-wide limits before materializing SVG, raster, or PDF buffers. */
function validateExportDocumentLimits(
  document: DesignDocument,
  pixelSize: { width: number; height: number },
): void {
  if (document.pages.length > MAX_EXPORT_PAGES) {
    throw new Error(`Export supports at most ${MAX_EXPORT_PAGES} pages`);
  }

  const layers = document.pages.reduce((count, page) => count + page.layers.length, 0);
  if (layers > MAX_EXPORT_LAYERS) {
    throw new Error(`Export supports at most ${MAX_EXPORT_LAYERS} layers`);
  }

  if (
    pixelSize.width < 1
    || pixelSize.height < 1
    || pixelSize.width > MAX_EXPORT_RASTER_DIMENSION
    || pixelSize.height > MAX_EXPORT_RASTER_DIMENSION
  ) {
    throw new Error(
      `Canvas pixel dimensions must be between 1 and ${MAX_EXPORT_RASTER_DIMENSION}`,
    );
  }
  if (pixelSize.width * pixelSize.height > MAX_EXPORT_PIXELS_PER_PAGE) {
    throw new Error(`Canvas exceeds ${MAX_EXPORT_PIXELS_PER_PAGE} pixels per page`);
  }
}

/** Validate actual raster output dimensions before allocating renderer buffers. */
function validateRasterDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || width < 1) {
    throw new Error("Raster export width must be a positive and finite integer");
  }
  if (width > MAX_EXPORT_RASTER_DIMENSION || height > MAX_EXPORT_RASTER_DIMENSION) {
    throw new Error(`Raster export dimensions must not exceed ${MAX_EXPORT_RASTER_DIMENSION}`);
  }
  if (width * height > MAX_EXPORT_PIXELS_PER_PAGE) {
    throw new Error(`Raster export exceeds ${MAX_EXPORT_PIXELS_PER_PAGE} pixels per page`);
  }
}

/** GIF bounds aggregate frame pixels because its palette and output are assembled in memory. */
function validateGifLimits(
  pages: number,
  width: number,
  height: number,
  frameDelay: number | number[] | undefined,
): void {
  if (pages > MAX_EXPORT_PAGES) throw new Error(`GIF export supports at most ${MAX_EXPORT_PAGES} frames`);
  if ((width * height * pages) > MAX_GIF_TOTAL_PIXELS) {
    throw new Error(`GIF export exceeds ${MAX_GIF_TOTAL_PIXELS} total frame pixels`);
  }
  if (Array.isArray(frameDelay) && frameDelay.length !== pages) {
    throw new Error("GIF frame delay array must contain one delay per document page");
  }
}

function validateMp4Limits(
  pages: number,
  width: number,
  height: number,
  frameDuration: number | number[] | undefined,
): void {
  if (pages > MAX_EXPORT_PAGES) throw new Error(`MP4 export supports at most ${MAX_EXPORT_PAGES} frames`);
  if ((width * height * pages) > MAX_MP4_TOTAL_PIXELS) {
    throw new Error(`MP4 export exceeds ${MAX_MP4_TOTAL_PIXELS} total frame pixels`);
  }
  if (Array.isArray(frameDuration) && frameDuration.length !== pages) {
    throw new Error("MP4 frame duration array must contain one duration per document page");
  }
}

export async function exportDocument(
  document: DesignDocument,
  options: ExportOptions,
): Promise<ExportResult> {
  // Enforce resource limits before QA walks attacker-supplied pages and layers.
  const pixelSize = canvasPixelSize(document.canvas);
  validateExportDocumentLimits(document, pixelSize);

  if (options.enforceQa ?? true) {
    const report = inspectDocument(document);
    if (!report.passed) {
      const failed = report.checks
        .filter((check) => !check.pass)
        .map((check) => `${check.name}${check.detail ? ` (${check.detail})` : ""}`);
      throw new Error(`Design QA failed: ${failed.join("; ")}`);
    }
  }

  if (options.format === "svg") {
    if (options.width !== undefined) {
      throw new Error("SVG exports preserve native canvas dimensions; width is not supported");
    }
    const svgPages = await renderDocumentToSvg(document, options.resolveImage);
    return {
      format: "svg",
      width: pixelSize.width,
      height: pixelSize.height,
      files: svgPages.map((svg, index) => ({
        pageId: document.pages[index].id,
        data: Buffer.from(svg, "utf8"),
      })),
    };
  }

  if (options.format === "pptx") {
    return {
      format: "pptx",
      width: pixelSize.width,
      height: pixelSize.height,
      files: [{ pageId: document.id, data: await buildPptx(document, options.resolveImage) }],
    };
  }

  const width = options.width ?? pixelSize.width;
  const height = Math.max(1, Math.round(width * (pixelSize.height / pixelSize.width)));
  validateRasterDimensions(width, height);
  if (options.format === "gif") {
    validateGifLimits(document.pages.length, width, height, options.gifFrameDelay);
  }
  if (options.format === "mp4") {
    validateMp4Limits(document.pages.length, width, height, options.mp4FrameDuration);
  }
  // A transparent PNG must not paint the page background rect at all, otherwise
  // alpha is destroyed before resvg ever sees the document.
  const transparent = options.format === "png" && (options.transparentBackground ?? false);
  const svgPages = await renderDocumentToSvg(document, options.resolveImage, {
    includeBackground: !transparent,
  });

  // Explicit paths remain an override for callers with their own licensed font
  // set. Otherwise the registry supplies the bundled, validated Plex faces.
  const font = options.fontFiles !== undefined
    ? {
        fontFiles: validateFontFiles(options.fontFiles),
        ...(options.defaultFontFamily ? { defaultFontFamily: options.defaultFontFamily } : {}),
      }
    : resolveDocumentFonts(document, { onMissingFont: options.onMissingFont });
  const rendered = svgPages.map((svg) => renderSvgToPng(svg, font, width));
  const actualSize = pngDimensions(rendered[0]);

  if (options.format === "png") {
    return {
      format: "png",
      width: actualSize.width,
      height: actualSize.height,
      files: rendered.map((png, index) => ({
        pageId: document.pages[index].id,
        data: transparent
          ? png
          : flattenPng(png, options.backgroundColor ?? document.pages[index].background),
      })),
    };
  }

  if (options.format === "jpg") {
    return {
      format: "jpg",
      width: actualSize.width,
      height: actualSize.height,
      files: rendered.map((png, index) => ({
        pageId: document.pages[index].id,
        data: (() => {
          const flattened = flattenPng(png, options.backgroundColor ?? document.pages[index].background);
          const raster = PNG.sync.read(flattened);
          return encodeJpeg(raster.data, raster.width, raster.height, { quality: options.quality });
        })(),
      })),
    };
  }

  if (options.format === "gif") {
    const frames = rendered.map((png, index) => pngToRgb(
      flattenPng(png, options.backgroundColor ?? document.pages[index].background),
    ));
    const delay = options.gifFrameDelay;
    const gif = encodeGif(
      frames.map((frame, index) => ({
        rgb: frame.rgb,
        ...(typeof delay === "number" ? { delay } : delay ? { delay: delay[index] } : {}),
      })),
      actualSize.width,
      actualSize.height,
      { dither: options.gifDither },
    );
    return {
      format: "gif",
      width: actualSize.width,
      height: actualSize.height,
      files: [{ pageId: document.id, data: gif }],
    };
  }

  if (options.format === "mp4") {
    const frames = rendered.map((png, index) => pngToRgb(
      flattenPng(png, options.backgroundColor ?? document.pages[index].background),
    ));
    const duration = options.mp4FrameDuration;
    const video = encodeMp4(
      frames.map((frame, index) => ({
        rgb: frame.rgb,
        ...(typeof duration === "number"
          ? { duration }
          : duration
            ? { duration: duration[index] }
            : {}),
      })),
      actualSize.width,
      actualSize.height,
      { ...(options.quality === undefined ? {} : { quality: options.quality }) },
    );
    return {
      format: "mp4",
      width: actualSize.width,
      height: actualSize.height,
      files: [{ pageId: document.id, data: video.data }],
    };
  }

  const flattened = rendered.map((png, index) =>
    pngToRgb(flattenPng(png, options.backgroundColor ?? document.pages[index].background)),
  );
  const pointFactor = document.canvas.unit === "mm" ? 72 / 25.4 : 0.75;
  const pdf = buildPdf(
    flattened,
    {
      width: Math.round(document.canvas.width * pointFactor),
      height: Math.round(document.canvas.height * pointFactor),
    },
    document.title,
  );

  return {
    format: "pdf",
    width: actualSize.width,
    height: actualSize.height,
    files: [{ pageId: document.id, data: pdf }],
  };
}
