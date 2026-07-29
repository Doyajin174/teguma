/**
 * Figma → Penpot converter.
 *
 * Transforms Figma REST API responses into Penpot-compatible
 * data structures that can be committed via Penpot's RPC API.
 */

import type { FigmaFile, FigmaNode, FigmaPaint, FigmaStyle, FigmaComponent } from "./client.js";
import type { PenpotColor, PenpotTypography, PenpotComponent } from "../penpot/types.js";

export interface ConversionResult {
  fileName: string;
  colors: PenpotColor[];
  typographies: PenpotTypography[];
  components: PenpotComponent[];
  pages: ConvertedPage[];
  stats: ConversionStats;
}

export interface ConvertedPage {
  name: string;
  shapes: ConvertedShape[];
}

export interface ConvertedShape {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills?: Array<{ fillType: string; fillColor: string; fillOpacity: number }>;
  layout?: {
    type: "flex";
    direction: "row" | "column";
    gap?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
  };
  cornerRadius?: number;
  children?: ConvertedShape[];
}

export interface ConversionStats {
  totalPages: number;
  totalShapes: number;
  totalColors: number;
  totalTypographies: number;
  totalComponents: number;
  warnings: string[];
}

export function convertFigmaToPenpot(figmaFile: FigmaFile): ConversionResult {
  const warnings: string[] = [];
  let totalShapes = 0;

  // Extract colors from styles
  const colors = extractColors(figmaFile.styles);

  // Extract typographies from styles
  const typographies = extractTypographies(figmaFile.styles);

  // Extract components
  const components = extractComponents(figmaFile.components);

  // Convert pages (document.children are CANVAS nodes = pages)
  const pages: ConvertedPage[] = [];
  const docChildren = figmaFile.document?.children ?? [];

  for (const canvas of docChildren) {
    if (canvas.type !== "CANVAS") continue;

    const shapes: ConvertedShape[] = [];
    for (const child of canvas.children ?? []) {
      const converted = convertNode(child, warnings);
      if (converted) {
        shapes.push(converted);
        totalShapes += countShapes(converted);
      }
    }

    pages.push({ name: canvas.name, shapes });
  }

  return {
    fileName: figmaFile.name,
    colors,
    typographies,
    components,
    pages,
    stats: {
      totalPages: pages.length,
      totalShapes,
      totalColors: colors.length,
      totalTypographies: typographies.length,
      totalComponents: components.length,
      warnings,
    },
  };
}

// --- Internal converters ---

function extractColors(styles: Record<string, FigmaStyle>): PenpotColor[] {
  const colors: PenpotColor[] = [];

  for (const [id, style] of Object.entries(styles)) {
    if (style.styleType !== "FILL") continue;

    // Figma styles don't include the actual color value in the styles endpoint
    // We store the name and path for now; actual values come from the document tree
    const parts = style.name.split("/");
    const name = parts.pop() ?? style.name;
    const path = parts.join("/");

    colors.push({
      id,
      name,
      path: path || undefined,
      color: "#000000", // Placeholder — resolved from document tree
    });
  }

  return colors;
}

function extractTypographies(styles: Record<string, FigmaStyle>): PenpotTypography[] {
  const typographies: PenpotTypography[] = [];

  for (const [id, style] of Object.entries(styles)) {
    if (style.styleType !== "TEXT") continue;

    const parts = style.name.split("/");
    const name = parts.pop() ?? style.name;

    typographies.push({
      id,
      name,
      path: parts.join("/") || undefined,
      fontFamily: "Inter", // Resolved from document tree
      fontSize: "16",
      fontWeight: "400",
      lineHeight: "1.5",
    });
  }

  return typographies;
}

function extractComponents(components: Record<string, FigmaComponent>): PenpotComponent[] {
  return Object.entries(components).map(([id, comp]) => ({
    id,
    name: comp.name,
    path: comp.containingFrame
      ? `${comp.containingFrame.pageName}/${comp.containingFrame.name}`
      : comp.name,
  }));
}

function convertNode(node: FigmaNode, warnings: string[]): ConvertedShape | null {
  const bbox = node.absoluteBoundingBox;
  if (!bbox) {
    warnings.push(`Node "${node.name}" has no bounding box, skipped`);
    return null;
  }

  const shape: ConvertedShape = {
    id: crypto.randomUUID(),
    type: mapNodeType(node.type),
    name: node.name,
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
  };

  // Fills
  if (node.fills && node.fills.length > 0) {
    shape.fills = node.fills
      .filter((f) => f.type === "SOLID" && f.color)
      .map((f) => ({
        fillType: "solid",
        fillColor: rgbaToHex(f.color!),
        fillOpacity: f.opacity ?? f.color!.a ?? 1,
      }));
  }

  // Auto Layout → Flex Layout
  if (node.layoutMode && node.layoutMode !== "NONE") {
    shape.layout = {
      type: "flex",
      direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
      gap: node.itemSpacing,
      padding: {
        top: node.paddingTop ?? 0,
        right: node.paddingRight ?? 0,
        bottom: node.paddingBottom ?? 0,
        left: node.paddingLeft ?? 0,
      },
    };
  }

  // Corner radius
  if (node.cornerRadius) {
    shape.cornerRadius = node.cornerRadius;
  }

  // Children (recursive)
  if (node.children && node.children.length > 0) {
    shape.children = node.children
      .map((child) => convertNode(child, warnings))
      .filter((c): c is ConvertedShape => c !== null);
  }

  return shape;
}

function mapNodeType(figmaType: string): string {
  const mapping: Record<string, string> = {
    FRAME: "frame",
    GROUP: "group",
    RECTANGLE: "rect",
    ELLIPSE: "circle",
    TEXT: "text",
    COMPONENT: "frame",
    COMPONENT_SET: "frame",
    INSTANCE: "frame",
    VECTOR: "path",
    LINE: "path",
    STAR: "path",
    REGULAR_POLYGON: "path",
    BOOLEAN_OPERATION: "path",
  };
  return mapping[figmaType] ?? "frame";
}

function rgbaToHex(color: { r: number; g: number; b: number; a: number }): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function countShapes(shape: ConvertedShape): number {
  let count = 1;
  if (shape.children) {
    for (const child of shape.children) {
      count += countShapes(child);
    }
  }
  return count;
}
