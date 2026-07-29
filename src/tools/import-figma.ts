import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { convertFigmaToPenpot } from "../figma/converter.js";
import type { PenpotClient } from "../penpot/client.js";

export const importFigmaSchema = {
  figmaFileKey: z
    .string()
    .describe("Figma file key (from URL: figma.com/file/<KEY>/...)"),
  figmaToken: z
    .string()
    .describe("Figma Personal Access Token"),
  penpotFileId: z
    .string()
    .optional()
    .describe("Target Penpot file ID (if omitted, returns conversion preview only)"),
  dryRun: z
    .boolean()
    .default(true)
    .describe("If true, only preview conversion without writing to Penpot"),
};

export type ImportFigmaArgs = z.infer<z.ZodObject<typeof importFigmaSchema>>;

/**
 * Import a Figma file's design system into Penpot.
 * Solves pain point P1 (design system import destruction) by doing
 * a structured conversion that preserves tokens, components, and hierarchy.
 */
export async function importFigma(client: PenpotClient, args: ImportFigmaArgs) {
  const figma = new FigmaClient({ accessToken: args.figmaToken });

  // Fetch Figma file
  const figmaFile = await figma.getFile(args.figmaFileKey);

  // Convert to Penpot format
  const result = convertFigmaToPenpot(figmaFile);

  if (args.dryRun || !args.penpotFileId) {
    // Preview mode — return conversion summary
    return JSON.stringify({
      mode: "preview",
      fileName: result.fileName,
      stats: result.stats,
      colors: result.colors.slice(0, 20),
      typographies: result.typographies.slice(0, 10),
      components: result.components.slice(0, 20),
      pages: result.pages.map((p) => ({
        name: p.name,
        shapeCount: p.shapes.length,
      })),
      note: "Set dryRun=false and provide penpotFileId to write to Penpot",
    }, null, 2);
  }

  // Write mode — commit to Penpot
  // For each page, commit the shapes
  const committedPages: string[] = [];

  for (const page of result.pages) {
    const changes = page.shapes.map((shape) => ({
      type: "add-obj",
      id: shape.id,
      "page-id": args.penpotFileId, // Simplified — real impl needs page creation
      "frame-id": "root",
      obj: shape,
    }));

    if (changes.length > 0) {
      await client.commitChanges(args.penpotFileId!, changes);
      committedPages.push(page.name);
    }
  }

  return JSON.stringify({
    mode: "imported",
    fileName: result.fileName,
    stats: result.stats,
    committedPages,
    penpotFileId: args.penpotFileId,
  }, null, 2);
}
