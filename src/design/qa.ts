/**
 * Automated design QA.
 *
 * MiriCanvas leaves layout correctness to the human clicking around. teguma
 * checks it mechanically so an agent cannot ship a document whose text falls off
 * the canvas or fails contrast.
 */

import { findBrandViolations, type BrandViolation } from "./brand-kit.js";
import {
  contrastRatio,
  hexToRgb,
  relativeLuminanceFromRgb,
  type RgbColor,
} from "./color.js";
import type { DesignDocument, DesignLayer, Frame } from "./document.js";
import { evaluatePolicy, type PolicyViolation } from "./policy.js";
import { measureTextBlock } from "./text-metrics.js";

export interface QaCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface QaReport {
  documentId: string;
  pages: number;
  layers: number;
  passed: boolean;
  checks: QaCheck[];
  brandViolations: BrandViolation[];
  /** Present only when a caller supplied a workspace policy. */
  policyViolations?: PolicyViolation[];
}

export { contrastRatio } from "./color.js";

function insideCanvas(frame: Frame, width: number, height: number): boolean {
  return frame.x >= 0
    && frame.y >= 0
    && frame.x + frame.width <= width
    && frame.y + frame.height <= height;
}

function insideSafeArea(frame: Frame, width: number, height: number, margin: number): boolean {
  return frame.x >= margin
    && frame.y >= margin
    && frame.x + frame.width <= width - margin
    && frame.y + frame.height <= height - margin;
}

/**
 * Return whether two frames share visible area. Touching edges do not create a
 * backdrop region and therefore do not affect text contrast.
 */
function framesIntersect(a: Frame, b: Frame): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function frameCovers(cover: Frame, covered: Frame): boolean {
  return cover.x <= covered.x
    && cover.y <= covered.y
    && cover.x + cover.width >= covered.x + covered.width
    && cover.y + cover.height >= covered.y + covered.height;
}

function pointInFrame(x: number, y: number, frame: Frame): boolean {
  return x >= frame.x
    && x < frame.x + frame.width
    && y >= frame.y
    && y < frame.y + frame.height;
}

function composite(foreground: RgbColor, opacity: number, background: RgbColor): RgbColor {
  return [
    (foreground[0] * opacity) + (background[0] * (1 - opacity)),
    (foreground[1] * opacity) + (background[1] * (1 - opacity)),
    (foreground[2] * opacity) + (background[2] * (1 - opacity)),
  ];
}

function contrastRatioForRgb(foreground: RgbColor, background: RgbColor): number {
  const a = relativeLuminanceFromRgb(foreground);
  const b = relativeLuminanceFromRgb(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * A rounded corner exposes the underlying page outside its quarter-circle.
 * We accept a rounded rect as a uniform text backdrop only when the entire
 * text frame fits within the rect inset by its effective radius on every side.
 * This conservative rectangle avoids sampling a few interior points and
 * incorrectly claiming contrast in a corner arc. Templates forbid rounded
 * pills; this protects QA from arbitrary author input.
 */
function roundedRectSafelyCovers(
  rect: Extract<DesignLayer, { type: "rect" }>,
  frame: Frame,
): boolean {
  const radius = Math.min(rect.radius, rect.frame.width / 2, rect.frame.height / 2);
  return frameCovers({
    x: rect.frame.x + radius,
    y: rect.frame.y + radius,
    width: rect.frame.width - (radius * 2),
    height: rect.frame.height - (radius * 2),
  }, frame);
}

/**
 * A later opaque square rect has deterministically repainted every text pixel,
 * so an earlier rounded corner cannot make that backdrop indeterminate.
 */
function roundedBackdropIsVisibleAtText(
  candidateIndex: number,
  lowerLayers: DesignLayer[],
  textFrame: Frame,
): boolean {
  return !lowerLayers.slice(candidateIndex + 1).some((layer) =>
    layer.type === "rect"
      && layer.radius === 0
      && layer.opacity === 1
      && frameCovers(layer.frame, textFrame));
}

function hasIndeterminateRoundedBackdrop(lowerLayers: DesignLayer[], textFrame: Frame): boolean {
  return lowerLayers.some((layer, index) =>
    layer.type === "rect"
      && layer.radius > 0
      && layer.opacity > 0
      && framesIntersect(layer.frame, textFrame)
      && !roundedRectSafelyCovers(layer, textFrame)
      && roundedBackdropIsVisibleAtText(index, lowerLayers, textFrame));
}

/**
 * Split a text frame into regions wherever a lower rect or image boundary
 * crosses it. Contrast must pass in every region: evaluating only a fully
 * covered frame used to silently treat partial overlays as the page colour.
 */
function backdropSamplePoints(layer: DesignLayer, lowerLayers: DesignLayer[]): Array<[number, number]> {
  const xEdges = [layer.frame.x, layer.frame.x + layer.frame.width];
  const yEdges = [layer.frame.y, layer.frame.y + layer.frame.height];

  for (const candidate of lowerLayers) {
    if ((candidate.type !== "rect" && candidate.type !== "image")
      || candidate.opacity === 0
      || !framesIntersect(candidate.frame, layer.frame)) {
      continue;
    }
    xEdges.push(
      Math.max(layer.frame.x, candidate.frame.x),
      Math.min(layer.frame.x + layer.frame.width, candidate.frame.x + candidate.frame.width),
    );
    yEdges.push(
      Math.max(layer.frame.y, candidate.frame.y),
      Math.min(layer.frame.y + layer.frame.height, candidate.frame.y + candidate.frame.height),
    );
  }

  const xs = [...new Set(xEdges)].sort((a, b) => a - b);
  const ys = [...new Set(yEdges)].sort((a, b) => a - b);
  const samples: Array<[number, number]> = [];
  for (let x = 0; x < xs.length - 1; x += 1) {
    for (let y = 0; y < ys.length - 1; y += 1) {
      samples.push([(xs[x] + xs[x + 1]) / 2, (ys[y] + ys[y + 1]) / 2]);
    }
  }
  return samples;
}

/**
 * Find the painted backdrop at one sample point. Images have unknown pixel
 * content, so a visible image makes the result indeterminate unless a later
 * opaque rectangle overwrites it with a known solid colour.
 */
function backdropAt(
  sample: [number, number],
  lowerLayers: DesignLayer[],
  pageBackground: string,
): RgbColor | undefined {
  let backdrop: RgbColor | undefined = hexToRgb(pageBackground);

  for (const candidate of lowerLayers) {
    if (!pointInFrame(sample[0], sample[1], candidate.frame) || candidate.opacity === 0) continue;

    if (candidate.type === "image") {
      backdrop = undefined;
    } else if (candidate.type === "rect") {
      const foreground = hexToRgb(candidate.fill);
      backdrop = candidate.opacity === 1
        ? foreground
        : backdrop === undefined
          ? undefined
          : composite(foreground, candidate.opacity, backdrop);
    }
  }

  return backdrop;
}

export function inspectDocument(document: DesignDocument, policy?: unknown): QaReport {
  const { width, height, safeMargin } = document.canvas;
  const checks: QaCheck[] = [];
  let layerCount = 0;

  const outside: string[] = [];
  const outsideSafe: string[] = [];
  const lowContrast: string[] = [];
  const imageWithoutSource: string[] = [];
  const textTooWide: string[] = [];
  const textTooTall: string[] = [];
  const textOccluded: string[] = [];

  for (const page of document.pages) {
    layerCount += page.layers.length;

    for (const [layerIndex, layer] of page.layers.entries()) {
      const label = `${page.id}/${layer.id}`;

      if (!insideCanvas(layer.frame, width, height)) outside.push(label);

      if (
        safeMargin > 0
        && (layer.type === "text" || layer.type === "image")
        && !insideSafeArea(layer.frame, width, height, safeMargin)
      ) {
        outsideSafe.push(label);
      }

      if (layer.type === "text") {
        const measurement = measureTextBlock(layer.text, {
          fontSize: layer.fontSize,
          lineHeight: layer.lineHeight,
          letterSpacing: layer.letterSpacing,
          fontFamily: layer.fontFamily,
          fontWeight: layer.fontWeight,
        });
        // SVG/font rasterizers differ slightly; one percent avoids false positives.
        if (measurement.width > layer.frame.width * 1.01) textTooWide.push(label);
        if (measurement.height > layer.frame.height) textTooTall.push(label);

        const lowerLayers = page.layers.slice(0, layerIndex);
        const backdrops = backdropSamplePoints(layer, lowerLayers)
          .map((sample) => backdropAt(sample, lowerLayers, page.background));
        if (hasIndeterminateRoundedBackdrop(lowerLayers, layer.frame)) {
          lowContrast.push(
            `${label} (indeterminate rounded rect backdrop; keep the text frame inset by the corner radius)`,
          );
        } else if (backdrops.some((backdrop) => backdrop === undefined)) {
          lowContrast.push(
            `${label} (indeterminate image backdrop; place text on a fully covering solid rect band)`,
          );
        } else {
          const knownBackdrops = backdrops.filter(
            (backdrop): backdrop is RgbColor => backdrop !== undefined,
          );
          const worstRatio = Math.min(
            ...knownBackdrops.map((backdrop) => contrastRatioForRgb(
              composite(hexToRgb(layer.color), layer.opacity, backdrop),
              backdrop,
            )),
          );
          if (worstRatio < 4.5) {
            lowContrast.push(`${label} (${worstRatio.toFixed(2)}:1)`);
          }
        }

        for (const candidate of page.layers.slice(layerIndex + 1)) {
          const opaqueRect = candidate.type === "rect" && candidate.radius === 0;
          const opaqueImage = candidate.type === "image";
          if (
            (opaqueRect || opaqueImage)
            && candidate.opacity === 1
            && frameCovers(candidate.frame, layer.frame)
          ) {
            textOccluded.push(`${label} <- ${page.id}/${candidate.id}`);
          }
        }
      }

      if (layer.type === "image" && layer.source.trim().length === 0) {
        imageWithoutSource.push(label);
      }
    }
  }

  checks.push({
    name: "layers-inside-canvas",
    pass: outside.length === 0,
    ...(outside.length > 0 ? { detail: outside.join(", ") } : {}),
  });
  checks.push({
    name: "content-respects-safe-area",
    pass: outsideSafe.length === 0,
    ...(outsideSafe.length > 0 ? { detail: outsideSafe.join(", ") } : {}),
  });
  checks.push({
    name: "text-contrast-at-least-4.5",
    pass: lowContrast.length === 0,
    ...(lowContrast.length > 0 ? { detail: lowContrast.join(", ") } : {}),
  });
  checks.push({
    name: "text-fits-frame-width",
    pass: textTooWide.length === 0,
    ...(textTooWide.length > 0 ? { detail: textTooWide.join(", ") } : {}),
  });
  checks.push({
    name: "text-fits-frame-height",
    pass: textTooTall.length === 0,
    ...(textTooTall.length > 0 ? { detail: textTooTall.join(", ") } : {}),
  });
  checks.push({
    name: "text-not-occluded-by-later-opaque-layer",
    pass: textOccluded.length === 0,
    ...(textOccluded.length > 0 ? { detail: textOccluded.join(", ") } : {}),
  });
  checks.push({
    name: "image-layers-have-source",
    pass: imageWithoutSource.length === 0,
    ...(imageWithoutSource.length > 0 ? { detail: imageWithoutSource.join(", ") } : {}),
  });

  const brandViolations = findBrandViolations(document);
  checks.push({
    name: "brand-kit-respected",
    pass: brandViolations.length === 0,
    ...(brandViolations.length > 0
      ? { detail: brandViolations.map((item) => item.message).join("; ") }
      : {}),
  });

  const report: QaReport = {
    documentId: document.id,
    pages: document.pages.length,
    layers: layerCount,
    passed: checks.every((check) => check.pass),
    checks,
    brandViolations,
  };

  // No policy must retain the exact historic report shape for existing callers.
  if (policy === undefined) return report;

  const policyViolations = evaluatePolicy(document, policy);
  const checksByKind: Array<[string, PolicyViolation["kind"][]]> = [
    ["policy-banned-terms", ["banned-term"]],
    ["policy-required-terms", ["required-term"]],
    ["policy-approval-for-export", ["approval-required"]],
    [
      "policy-restricted-capabilities",
      ["image-layer", "non-brand-kit-color", "unregistered-canvas", "page-limit"],
    ],
  ];
  for (const [name, kinds] of checksByKind) {
    const failures = policyViolations.filter((violation) => kinds.includes(violation.kind));
    checks.push({
      name,
      pass: failures.length === 0,
      ...(failures.length > 0 ? { detail: failures.map((failure) => failure.detail).join("; ") } : {}),
    });
  }

  return {
    ...report,
    passed: checks.every((check) => check.pass),
    policyViolations,
  };
}
