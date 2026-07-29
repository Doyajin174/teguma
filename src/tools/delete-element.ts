import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";

export const deleteElementSchema = {
  fileId: z.string().describe("Penpot file ID"),
  pageId: z.string().describe("Page ID containing the element"),
  shapeId: z.string().describe("ID of the shape to delete"),
};

export type DeleteElementArgs = z.infer<z.ZodObject<typeof deleteElementSchema>>;

/**
 * Deletes a shape from a Penpot page.
 */
export async function deleteElement(client: PenpotClient, args: DeleteElementArgs) {
  const changes = [
    {
      type: "del-obj",
      id: args.shapeId,
      "page-id": args.pageId,
    },
  ];

  await client.commitChanges(args.fileId, changes);

  return JSON.stringify({
    success: true,
    deleted: args.shapeId,
  }, null, 2);
}
