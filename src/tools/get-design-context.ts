import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";
import { compressBrandContext, serializeForLLM } from "../compressor.js";

export const getDesignContextSchema = {
  fileId: z.string().describe("Penpot file ID to extract brand context from"),
  format: z
    .enum(["compact", "json"])
    .default("compact")
    .describe("Output format: 'compact' for LLM-optimized text, 'json' for structured data"),
};

export type GetDesignContextArgs = z.infer<z.ZodObject<typeof getDesignContextSchema>>;

export async function getDesignContext(client: PenpotClient, args: GetDesignContextArgs) {
  const file = await client.getFile(args.fileId);
  const compressed = compressBrandContext(file);

  if (args.format === "json") {
    return JSON.stringify(compressed, null, 2);
  }

  return serializeForLLM(compressed);
}
