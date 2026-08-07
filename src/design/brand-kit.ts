/**
 * Brand kit application and enforcement.
 *
 * MiriCanvas brand kits register logos, palettes, and fonts so a team only uses
 * approved assets. teguma goes one step further: it can normalize a document to
 * the kit and report every violation as machine-readable output.
 */

import type { BrandKit, DesignDocument, DesignLayer } from "./document.js";
import { hexToRgb } from "./color.js";

export interface BrandViolation {
  pageId: string;
  layerId: string;
  kind: "color" | "font" | "font-weight" | "logo";
  value: string;
  message: string;
}

/** Squared euclidean distance in RGB space. Enough to pick a nearest swatch. */
export function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return ((ar - br) ** 2) + ((ag - bg) ** 2) + ((ab - bb) ** 2);
}

export function nearestBrandColor(kit: BrandKit, color: string): string {
  let nearest = kit.palette[0].value;
  let best = Number.POSITIVE_INFINITY;

  for (const swatch of kit.palette) {
    const distance = colorDistance(color, swatch.value);
    if (distance < best) {
      best = distance;
      nearest = swatch.value;
    }
  }
  return nearest;
}

function normalizeUpper(value: string): string {
  return value.toUpperCase();
}

function paletteHas(kit: BrandKit, color: string): boolean {
  return kit.palette.some((swatch) => normalizeUpper(swatch.value) === normalizeUpper(color));
}

function findBrandFont(kit: BrandKit, family: string) {
  return kit.fonts.find((font) => font.family === family);
}

function nearestBrandWeight(weights: number[], weight: number): number {
  return weights.reduce(
    (best, candidate) => (
      Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best
    ),
    weights[0],
  );
}

/**
 * Rewrite layer colors and fonts to the closest approved kit entry.
 * Returns a new document; the input is left untouched.
 */
export function applyBrandKit(document: DesignDocument, kit?: BrandKit): DesignDocument {
  const activeKit = kit ?? document.brandKit;
  if (!activeKit) return document;

  const primaryFont = activeKit.fonts[0];

  const normalizeLayer = (layer: DesignLayer): DesignLayer => {
    if (layer.type === "rect") {
      return paletteHas(activeKit, layer.fill)
        ? layer
        : { ...layer, fill: nearestBrandColor(activeKit, layer.fill) };
    }

    if (layer.type === "text") {
      const font = findBrandFont(activeKit, layer.fontFamily) ?? primaryFont;
      return {
        ...layer,
        color: paletteHas(activeKit, layer.color)
          ? layer.color
          : nearestBrandColor(activeKit, layer.color),
        fontFamily: font.family,
        fontWeight: font.weights.includes(layer.fontWeight)
          ? layer.fontWeight
          : nearestBrandWeight(font.weights, layer.fontWeight),
      };
    }

    return layer;
  };

  return {
    ...document,
    brandKit: activeKit,
    pages: document.pages.map((page) => ({
      ...page,
      background: paletteHas(activeKit, page.background)
        ? page.background
        : nearestBrandColor(activeKit, page.background),
      layers: page.layers.map(normalizeLayer),
    })),
  };
}

/** Report every layer that uses an asset outside the registered kit. */
export function findBrandViolations(document: DesignDocument, kit?: BrandKit): BrandViolation[] {
  const activeKit = kit ?? document.brandKit;
  if (!activeKit) return [];

  const violations: BrandViolation[] = [];
  const logosById = new Map(activeKit.logos.map((logo) => [logo.id, logo]));

  for (const page of document.pages) {
    for (const layer of page.layers) {
      if (layer.type === "rect" && !paletteHas(activeKit, layer.fill)) {
        violations.push({
          pageId: page.id,
          layerId: layer.id,
          kind: "color",
          value: layer.fill,
          message: `Fill ${layer.fill} is not in brand kit ${activeKit.id}`,
        });
      }

      if (layer.type === "text") {
        if (!paletteHas(activeKit, layer.color)) {
          violations.push({
            pageId: page.id,
            layerId: layer.id,
            kind: "color",
            value: layer.color,
            message: `Text color ${layer.color} is not in brand kit ${activeKit.id}`,
          });
        }

        const font = findBrandFont(activeKit, layer.fontFamily);
        if (!font) {
          violations.push({
            pageId: page.id,
            layerId: layer.id,
            kind: "font",
            value: layer.fontFamily,
            message: `Font ${layer.fontFamily} is not in brand kit ${activeKit.id}`,
          });
        } else if (!font.weights.includes(layer.fontWeight)) {
          violations.push({
            pageId: page.id,
            layerId: layer.id,
            kind: "font-weight",
            value: String(layer.fontWeight),
            message: `Weight ${layer.fontWeight} is not registered for ${layer.fontFamily}`,
          });
        }
      }

      if (layer.type === "image" && layer.logoId) {
        const registeredLogo = logosById.get(layer.logoId);
        if (!registeredLogo) {
          violations.push({
            pageId: page.id,
            layerId: layer.id,
            kind: "logo",
            value: layer.logoId,
            message: `Logo ${layer.logoId} is not in brand kit ${activeKit.id}`,
          });
        } else if (layer.source !== registeredLogo.source) {
          violations.push({
            pageId: page.id,
            layerId: layer.id,
            kind: "logo",
            value: layer.logoId,
            message: `Logo ${layer.logoId} must use registered source ${registeredLogo.source}; received ${layer.source}`,
          });
        }
      }
    }
  }

  return violations;
}
