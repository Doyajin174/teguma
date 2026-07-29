import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";
import type { PenpotShape } from "../penpot/types.js";

export const getPageLayoutSchema = {
  fileId: z.string().describe("Penpot file ID"),
  pageId: z.string().describe("Page ID to inspect"),
  depth: z
    .number()
    .default(2)
    .describe("Max nesting depth to include (default: 2, max: 5)"),
};

export type GetPageLayoutArgs = z.infer<z.ZodObject<typeof getPageLayoutSchema>>;

interface LayoutNode {
  name: string;
  type: string;
  size: string;
  layout?: string;
  children?: LayoutNode[];
}

/**
 * Returns the layout structure of a page as a compact tree.
 * Solves P4 (no layout boundary concept) by showing the AI
 * exactly how frames are structured and constrained.
 */
export async function getPageLayout(client: PenpotClient, args: GetPageLayoutArgs) {
  const depth = Math.min(args.depth, 5);
  const page = await client.getPage(args.fileId, args.pageId);

  const tree = page.children.map((shape) => shapeToLayoutNode(shape, depth, 0));

  const output = {
    page: page.name,
    frameCount: page.children.length,
    structure: tree,
    hints: generateLayoutHints(page.children),
  };

  return JSON.stringify(output, null, 2);
}

function shapeToLayoutNode(shape: PenpotShape, maxDepth: number, currentDepth: number): LayoutNode {
  const node: LayoutNode = {
    name: shape.name,
    type: shape.type,
    size: `${Math.round(shape.width)}x${Math.round(shape.height)}`,
  };

  if (shape.layout) {
    const l = shape.layout;
    node.layout = `${l.type}${l.direction ? `-${l.direction}` : ""}${l.gap ? ` gap:${l.gap}` : ""}`;
  }

  if (shape.children && currentDepth < maxDepth) {
    node.children = shape.children.map((child) =>
      shapeToLayoutNode(child, maxDepth, currentDepth + 1)
    );
  } else if (shape.children && shape.children.length > 0) {
    node.children = [{ name: `...${shape.children.length} more`, type: "truncated", size: "" }];
  }

  return node;
}

function generateLayoutHints(shapes: PenpotShape[]): string[] {
  const hints: string[] = [];

  // Detect common frame sizes (likely breakpoints)
  const widths = shapes
    .filter((s) => s.type === "frame" || s.type === "board")
    .map((s) => Math.round(s.width));

  const uniqueWidths = [...new Set(widths)].sort((a, b) => a - b);
  if (uniqueWidths.length > 1) {
    hints.push(`Multiple frame widths detected: ${uniqueWidths.join(", ")}px — likely responsive breakpoints`);
  }

  // Detect frames without layout (potential overflow risk)
  const noLayout = shapes.filter(
    (s) => (s.type === "frame" || s.type === "board") && !s.layout
  );
  if (noLayout.length > 0) {
    hints.push(`${noLayout.length} frame(s) without explicit layout — children may overflow`);
  }

  // Detect very large frames
  const oversized = shapes.filter((s) => s.width > 2000 || s.height > 2000);
  if (oversized.length > 0) {
    hints.push(`${oversized.length} oversized frame(s) (>2000px) — check if intentional`);
  }

  if (hints.length === 0) {
    hints.push("Layout looks well-structured. Use defined spacing and token system.");
  }

  return hints;
}
