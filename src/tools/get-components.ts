import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";

export const getComponentsSchema = {
  fileId: z.string().describe("Penpot file ID"),
  filter: z
    .string()
    .optional()
    .describe("Filter components by name/path (case-insensitive substring match)"),
};

export type GetComponentsArgs = z.infer<z.ZodObject<typeof getComponentsSchema>>;

export async function getComponents(client: PenpotClient, args: GetComponentsArgs) {
  let components = await client.getComponents(args.fileId);

  if (args.filter) {
    const lower = args.filter.toLowerCase();
    components = components.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        c.path.toLowerCase().includes(lower),
    );
  }

  const summary = components.map((c) => ({
    name: c.name,
    path: c.path,
    variants: c.variantProperties ?? null,
  }));

  return JSON.stringify(
    { count: summary.length, components: summary },
    null,
    2,
  );
}
