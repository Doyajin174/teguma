/**
 * Brand Context Compressor
 *
 * Takes raw Penpot file data and compresses it into a structured,
 * token-efficient representation that AI agents can consume without
 * burning through context windows.
 *
 * Key insight from community pain points (P5):
 * Instead of sending full HTML/CSS, we send only the *structure* —
 * token names + values, component names + variants, layout constraints.
 * This reduces token consumption by ~10x compared to raw output.
 */

import type {
  PenpotFile,
  PenpotColor,
  PenpotTypography,
  PenpotComponent,
  PenpotPage,
  BrandContext,
  CompressedColor,
  CompressedTypography,
  CompressedSpacing,
  CompressedComponent,
  CompressedPage,
  LayoutConstraints,
} from "./penpot/types.js";

export interface CompressorOptions {
  /** Maximum number of components to include (default: 50) */
  maxComponents?: number;
  /** Include shape-level detail for pages (default: false) */
  includeShapeDetail?: boolean;
  /** Custom breakpoint detection (default: [375, 768, 1024, 1440]) */
  breakpoints?: number[];
}

const DEFAULT_BREAKPOINTS = [375, 768, 1024, 1440];

export function compressBrandContext(file: PenpotFile, options: CompressorOptions = {}): BrandContext {
  const {
    maxComponents = 50,
    breakpoints = DEFAULT_BREAKPOINTS,
  } = options;

  return {
    fileName: file.name,
    summary: buildSummary(file),
    tokens: {
      colors: compressColors(file.colors),
      typography: compressTypography(file.typographies),
      spacing: inferSpacing(file),
    },
    components: compressComponents(file.components, maxComponents),
    pages: compressPages(file.pages),
    constraints: inferConstraints(file.pages, breakpoints),
  };
}

/**
 * Serialize BrandContext to a compact string format optimized for LLM consumption.
 * Uses terse key:value notation instead of verbose JSON.
 */
export function serializeForLLM(ctx: BrandContext): string {
  const lines: string[] = [];

  lines.push(`# ${ctx.fileName}`);
  lines.push(ctx.summary);
  lines.push("");

  // Colors — compact table
  lines.push("## Colors");
  for (const c of ctx.tokens.colors) {
    lines.push(`- ${c.name}: ${c.value}${c.role ? ` (${c.role})` : ""}`);
  }
  lines.push("");

  // Typography
  const typo = ctx.tokens.typography;
  lines.push("## Typography");
  lines.push(`Families: ${typo.families.join(", ")}`);
  lines.push(`Base: ${typo.baseSize}px`);
  lines.push("Scale:");
  for (const s of typo.scale) {
    lines.push(`  ${s.name}: ${s.size}px/${s.lineHeight} w${s.weight}`);
  }
  lines.push("");

  // Spacing
  const sp = ctx.tokens.spacing;
  lines.push("## Spacing");
  lines.push(`Base: ${sp.baseUnit}px | Scale: ${sp.scale.join(", ")}`);
  lines.push("");

  // Components
  lines.push("## Components");
  for (const comp of ctx.components) {
    const variants = comp.variants
      ? ` [${Object.entries(comp.variants).map(([k, v]) => `${k}:${v.join("|")}`).join(", ")}]`
      : "";
    lines.push(`- ${comp.path}${variants}`);
  }
  lines.push("");

  // Pages
  lines.push("## Pages");
  for (const page of ctx.pages) {
    lines.push(`- ${page.name} (${page.frameCount} frames)`);
    for (const frame of page.topLevelFrames.slice(0, 5)) {
      lines.push(`    ${frame.name} [${frame.width}x${frame.height}]`);
    }
  }
  lines.push("");

  // Constraints
  const con = ctx.constraints;
  lines.push("## Layout Constraints");
  lines.push(`Breakpoints: ${con.breakpoints.join(", ")}px`);
  if (con.maxContentWidth) lines.push(`Max content: ${con.maxContentWidth}px`);
  if (con.gridColumns) lines.push(`Grid: ${con.gridColumns} cols, ${con.gridGutter}px gutter`);

  return lines.join("\n");
}

// --- Internal helpers ---

function buildSummary(file: PenpotFile): string {
  const pageCount = file.pages.length;
  const compCount = file.components.length;
  const colorCount = file.colors.length;
  return `${pageCount} pages, ${compCount} components, ${colorCount} colors defined.`;
}

function compressColors(colors: PenpotColor[]): CompressedColor[] {
  return colors.map((c) => ({
    name: c.path ? `${c.path}/${c.name}` : c.name,
    value: c.color + (c.opacity !== undefined && c.opacity < 1 ? ` @${Math.round(c.opacity * 100)}%` : ""),
    role: inferColorRole(c.name, c.path),
  }));
}

function inferColorRole(name: string, path?: string): string | undefined {
  const combined = `${path ?? ""}/${name}`.toLowerCase();
  if (/primary|brand|accent/.test(combined)) return "primary";
  if (/secondary|support/.test(combined)) return "secondary";
  if (/neutral|gray|grey|base/.test(combined)) return "neutral";
  if (/error|success|warn|info|danger/.test(combined)) return "semantic";
  if (/bg|background|surface/.test(combined)) return "surface";
  if (/text|foreground|fg/.test(combined)) return "text";
  return undefined;
}

function compressTypography(typographies: PenpotTypography[]): CompressedTypography {
  const families = [...new Set(typographies.map((t) => t.fontFamily))];

  const scale = typographies
    .map((t) => ({
      name: t.name,
      size: parseFloat(t.fontSize) || 16,
      weight: parseInt(t.fontWeight) || 400,
      lineHeight: parseFloat(t.lineHeight) || 1.5,
    }))
    .sort((a, b) => a.size - b.size);

  // Infer base size (most common or median)
  const sizes = scale.map((s) => s.size);
  const baseSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 16;

  return { families, scale, baseSize };
}

function inferSpacing(file: PenpotFile): CompressedSpacing {
  // Collect all gap/padding values from shapes
  const values: number[] = [];

  for (const page of file.pages) {
    collectSpacingValues(page.children, values);
  }

  if (values.length === 0) {
    return { baseUnit: 8, scale: [4, 8, 12, 16, 24, 32, 48, 64] };
  }

  // Find GCD-like base unit
  const unique = [...new Set(values)].sort((a, b) => a - b);
  const baseUnit = findBaseUnit(unique);
  const scale = unique.filter((v) => v % baseUnit === 0).slice(0, 10);

  return { baseUnit, scale };
}

function collectSpacingValues(shapes: any[], values: number[]): void {
  for (const shape of shapes) {
    if (shape.layout?.gap) values.push(shape.layout.gap);
    if (shape.layout?.padding) {
      const p = shape.layout.padding;
      values.push(p.top, p.right, p.bottom, p.left);
    }
    if (shape.children) {
      collectSpacingValues(shape.children, values);
    }
  }
}

function findBaseUnit(values: number[]): number {
  if (values.length === 0) return 8;
  // Try common base units (prefer 8px grid, then 4px, then 2px)
  for (const candidate of [8, 4, 2]) {
    if (values.filter((v) => v % candidate === 0).length >= values.length * 0.7) {
      return candidate;
    }
  }
  return values[0] || 8;
}

function compressComponents(components: PenpotComponent[], max: number): CompressedComponent[] {
  return components.slice(0, max).map((c) => ({
    name: c.name,
    path: c.path || c.name,
    variants: c.variantProperties,
  }));
}

function compressPages(pages: PenpotPage[]): CompressedPage[] {
  return pages.map((page) => {
    const topLevelFrames = page.children
      .filter((s) => s.type === "frame" || s.type === "board")
      .map((f) => ({ name: f.name, width: Math.round(f.width), height: Math.round(f.height) }));

    return {
      name: page.name,
      frameCount: topLevelFrames.length,
      topLevelFrames: topLevelFrames.slice(0, 10),
    };
  });
}

function inferConstraints(pages: PenpotPage[], breakpoints: number[]): LayoutConstraints {
  // Infer max content width from frame widths
  const widths: number[] = [];
  for (const page of pages) {
    for (const shape of page.children) {
      if (shape.width > 100) widths.push(shape.width);
    }
  }

  const maxWidths = widths.filter((w) => w >= 1000);
  const maxContentWidth = maxWidths.length > 0
    ? Math.max(...maxWidths)
    : undefined;

  return {
    breakpoints,
    maxContentWidth,
    gridColumns: 12, // Penpot default
    gridGutter: 24,
  };
}
