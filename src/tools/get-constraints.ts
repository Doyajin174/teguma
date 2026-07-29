import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";
import { compressBrandContext } from "../compressor.js";

export const getConstraintsSchema = {
  fileId: z.string().describe("Penpot file ID"),
  pageId: z.string().optional().describe("Specific page ID (optional, defaults to all)"),
};

export type GetConstraintsArgs = z.infer<z.ZodObject<typeof getConstraintsSchema>>;

/**
 * Returns layout constraints and guardrails for AI-generated designs.
 * This solves pain point P4 (no layout boundary concept) by explicitly
 * telling the AI what the viewport/frame limits are.
 */
export async function getConstraints(client: PenpotClient, args: GetConstraintsArgs) {
  const file = await client.getFile(args.fileId);
  const compressed = compressBrandContext(file);

  const constraints = {
    ...compressed.constraints,
    guardrails: [
      `MUST: Keep all content within frame boundaries`,
      `MUST: Use spacing scale: ${compressed.tokens.spacing.scale.join(", ")}px`,
      `MUST: Use defined color tokens only (${compressed.tokens.colors.length} available)`,
      `MUST: Use typography scale (${compressed.tokens.typography.scale.map((s) => `${s.name}:${s.size}px`).join(", ")})`,
      `MUST NOT: Exceed max content width of ${compressed.constraints.maxContentWidth ?? 1440}px`,
      `MUST NOT: Use colors/spacing outside the defined token system`,
      `SHOULD: Align to ${compressed.tokens.spacing.baseUnit}px grid`,
      `SHOULD: Use existing components before creating new ones`,
    ],
    availableComponents: compressed.components.map((c) => c.path),
  };

  return JSON.stringify(constraints, null, 2);
}
