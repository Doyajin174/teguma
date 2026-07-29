import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";

export const updateElementSchema = {
  fileId: z.string().describe("Penpot file ID"),
  pageId: z.string().describe("Page ID containing the element"),
  shapeId: z.string().describe("ID of the shape to update"),
  name: z.string().optional().describe("New layer name"),
  x: z.number().optional().describe("New X position"),
  y: z.number().optional().describe("New Y position"),
  width: z.number().optional().describe("New width"),
  height: z.number().optional().describe("New height"),
  fillColor: z.string().optional().describe("New fill color hex"),
  cornerRadius: z.number().optional().describe("New corner radius"),
  visible: z.boolean().optional().describe("Visibility toggle"),
};

export type UpdateElementArgs = z.infer<z.ZodObject<typeof updateElementSchema>>;

/**
 * Updates an existing shape on a Penpot page.
 * Uses Penpot's commit-changes API with "mod-obj" change type.
 */
export async function updateElement(client: PenpotClient, args: UpdateElementArgs) {
  const operations: Array<Record<string, unknown>> = [];

  if (args.name !== undefined) {
    operations.push({ attr: "name", value: args.name });
  }
  if (args.x !== undefined) {
    operations.push({ attr: "x", value: args.x });
  }
  if (args.y !== undefined) {
    operations.push({ attr: "y", value: args.y });
  }
  if (args.width !== undefined) {
    operations.push({ attr: "width", value: args.width });
  }
  if (args.height !== undefined) {
    operations.push({ attr: "height", value: args.height });
  }
  if (args.fillColor !== undefined) {
    operations.push({
      attr: "fills",
      value: [{ fillType: "solid", fillColor: args.fillColor, fillOpacity: 1 }],
    });
  }
  if (args.cornerRadius !== undefined) {
    operations.push({ attr: "rx", value: args.cornerRadius });
    operations.push({ attr: "ry", value: args.cornerRadius });
  }
  if (args.visible !== undefined) {
    operations.push({ attr: "hidden", value: !args.visible });
  }

  if (operations.length === 0) {
    return JSON.stringify({ success: false, error: "No changes specified" });
  }

  const changes = [
    {
      type: "mod-obj",
      id: args.shapeId,
      "page-id": args.pageId,
      operations,
    },
  ];

  await client.commitChanges(args.fileId, changes);

  return JSON.stringify({
    success: true,
    shapeId: args.shapeId,
    updatedFields: operations.map((op) => op.attr),
  }, null, 2);
}
