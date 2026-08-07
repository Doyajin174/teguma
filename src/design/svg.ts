/**
 * Deterministic document to SVG serialization.
 *
 * The same document always produces byte-identical SVG so downstream renders and
 * hashes stay reproducible.
 */

import type { Canvas, DesignDocument, DesignLayer, DesignPage } from "./document.js";

/** 1mm at 96dpi. Used to give print documents a pixel-accurate viewBox. */
export const MM_TO_PX = 96 / 25.4;

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export interface ImageResolver {
  (source: string): Promise<string>;
}

// Image resolvers embed local assets as base64 data URIs. Restricting the
// returned value to that contract prevents a resolver-controlled quote from
// escaping the SVG href attribute into new markup.
const IMAGE_DATA_URI_PATTERN = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]*={0,2}$/;

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

/** Canvas size in pixels, converting millimetre documents at 96dpi. */
export function canvasPixelSize(canvas: Canvas): { width: number; height: number } {
  const factor = canvas.unit === "mm" ? MM_TO_PX : 1;
  return {
    width: Math.round(canvas.width * factor),
    height: Math.round(canvas.height * factor),
  };
}

function textAnchorX(layer: Extract<DesignLayer, { type: "text" }>): number {
  if (layer.align === "middle") return layer.frame.x + (layer.frame.width / 2);
  if (layer.align === "end") return layer.frame.x + layer.frame.width;
  return layer.frame.x;
}

function renderTextLayer(layer: Extract<DesignLayer, { type: "text" }>): string {
  const lines = layer.text.split("\n");
  const lineHeight = layer.fontSize * layer.lineHeight;
  const anchor = layer.align === "start" ? "start" : layer.align;
  const x = formatNumber(textAnchorX(layer));

  const spans = lines.map((line, index) => {
    const y = layer.frame.y + (layer.fontSize * 0.82) + (index * lineHeight);
    return `<tspan x="${x}" y="${formatNumber(y)}">${escapeXml(line)}</tspan>`;
  });

  return [
    `<text font-family="${escapeXml(layer.fontFamily)}"`,
    ` font-size="${formatNumber(layer.fontSize)}"`,
    ` font-weight="${layer.fontWeight}"`,
    ` letter-spacing="${formatNumber(layer.letterSpacing)}"`,
    ` fill="${layer.color}"`,
    ` text-anchor="${anchor}"`,
    ` opacity="${formatNumber(layer.opacity)}">`,
    spans.join(""),
    "</text>",
  ].join("");
}

function renderRectLayer(layer: Extract<DesignLayer, { type: "rect" }>): string {
  const radius = layer.radius > 0 ? ` rx="${formatNumber(layer.radius)}"` : "";
  return [
    `<rect x="${formatNumber(layer.frame.x)}"`,
    ` y="${formatNumber(layer.frame.y)}"`,
    ` width="${formatNumber(layer.frame.width)}"`,
    ` height="${formatNumber(layer.frame.height)}"`,
    radius,
    ` fill="${layer.fill}"`,
    ` opacity="${formatNumber(layer.opacity)}"/>`,
  ].join("");
}

function renderImageLayer(
  layer: Extract<DesignLayer, { type: "image" }>,
  href: string,
): string {
  if (!IMAGE_DATA_URI_PATTERN.test(href)) {
    throw new Error(`Image resolver returned an unsupported data URI for layer ${layer.id}`);
  }
  const preserve = layer.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
  return [
    `<image href="${escapeXml(href)}"`,
    ` x="${formatNumber(layer.frame.x)}"`,
    ` y="${formatNumber(layer.frame.y)}"`,
    ` width="${formatNumber(layer.frame.width)}"`,
    ` height="${formatNumber(layer.frame.height)}"`,
    ` preserveAspectRatio="${preserve}"`,
    ` opacity="${formatNumber(layer.opacity)}"/>`,
  ].join("");
}

export async function renderPageToSvg(
  document: DesignDocument,
  page: DesignPage,
  resolveImage?: ImageResolver,
  options: { includeBackground?: boolean } = {},
): Promise<string> {
  const { width, height } = canvasPixelSize(document.canvas);
  const viewWidth = document.canvas.width;
  const viewHeight = document.canvas.height;
  const includeBackground = options.includeBackground ?? true;
  const body: string[] = includeBackground
    ? [
        `<rect x="0" y="0" width="${formatNumber(viewWidth)}" height="${formatNumber(viewHeight)}" fill="${page.background}"/>`,
      ]
    : [];

  for (const layer of page.layers) {
    if (layer.type === "text") {
      body.push(renderTextLayer(layer));
    } else if (layer.type === "rect") {
      body.push(renderRectLayer(layer));
    } else {
      if (!resolveImage) {
        throw new Error(`Image layer ${layer.id} requires an image resolver`);
      }
      body.push(renderImageLayer(layer, await resolveImage(layer.source)));
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${formatNumber(viewWidth)} ${formatNumber(viewHeight)}">`,
    body.join(""),
    "</svg>",
  ].join("");
}

export async function renderDocumentToSvg(
  document: DesignDocument,
  resolveImage?: ImageResolver,
  options: { includeBackground?: boolean } = {},
): Promise<string[]> {
  const pages: string[] = [];
  for (const page of document.pages) {
    pages.push(await renderPageToSvg(document, page, resolveImage, options));
  }
  return pages;
}
