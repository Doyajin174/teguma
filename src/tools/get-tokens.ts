import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";
import { compressBrandContext } from "../compressor.js";

export const getTokensSchema = {
  fileId: z.string().describe("Penpot file ID"),
  category: z
    .enum(["all", "colors", "typography", "spacing"])
    .default("all")
    .describe("Token category to extract"),
};

export type GetTokensArgs = z.infer<z.ZodObject<typeof getTokensSchema>>;

export async function getTokens(client: PenpotClient, args: GetTokensArgs) {
  const file = await client.getFile(args.fileId);
  const compressed = compressBrandContext(file);
  const { colors, typography, spacing } = compressed.tokens;

  const result: Record<string, unknown> = {};

  if (args.category === "all" || args.category === "colors") {
    result.colors = colors;
  }
  if (args.category === "all" || args.category === "typography") {
    result.typography = typography;
  }
  if (args.category === "all" || args.category === "spacing") {
    result.spacing = spacing;
  }

  return JSON.stringify(result, null, 2);
}
