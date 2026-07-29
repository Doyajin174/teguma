import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";

export const createElementSchema = {
  fileId: z.string().describe("Penpot file ID"),
  pageId: z.string().describe("Target page ID"),
  type: z
    .enum(["rectangle", "ellipse", "text", "board", "svg"])
    .describe("Shape type to create"),
  name: z.string().describe("Layer name (semantic, e.g. 'hero-background')"),
  x: z.number().default(0).describe("X position"),
  y: z.number().default(0).describe("Y position"),
  width: z.number().default(100).describe("Width in px"),
  height: z.number().default(100).describe("Height in px"),
  text: z.string().optional().describe("Text content (for type=text)"),
  svgContent: z.string().optional().describe("SVG string (for type=svg)"),
  fillColor: z.string().optional().describe("Fill color hex (e.g. #6366f1)"),
  cornerRadius: z.number().optional().describe("Corner radius in px"),
};

export type CreateElementArgs = z.infer<z.ZodObject<typeof createElementSchema>>;

/**
 * Creates a shape element on a Penpot page via the RPC change-commit API.
 *
 * Penpot's internal API uses a "changes" array that gets committed atomically.
 * Each change has a type (e.g. "add-obj") and the shape data.
 */
export async function createElement(client: PenpotClient, args: CreateElementArgs) {
  const shapeId = crypto.randomUUID();

  // Build the shape object based on type
  const shape: Record<string, unknown> = {
    id: shapeId,
    type: args.type === "board" ? "frame" : args.type,
    name: args.name,
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
  };

  if (args.fillColor) {
    shape.fills = [{ fillType: "solid", fillColor: args.fillColor, fillOpacity: 1 }];
  }

  if (args.cornerRadius) {
    shape.rx = args.cornerRadius;
    shape.ry = args.cornerRadius;
  }

  if (args.type === "text" && args.text) {
    shape.type = "text";
    shape.content = {
      type: "root",
      children: [
        {
          type: "paragraph-set",
          children: [
            {
              type: "paragraph",
              children: [
                { type: "text", value: args.text },
              ],
            },
          ],
        },
      ],
    };
  }

  if (args.type === "svg" && args.svgContent) {
    // SVG shapes are stored as groups with path children
    shape.type = "group";
    shape.shapes = [];
    // Note: full SVG parsing would require server-side SVG → Penpot path conversion
    // For now, store as a rectangle placeholder with metadata
    shape.name = `${args.name} (svg-import)`;
  }

  // Commit the change via Penpot's RPC API
  const changes = [
    {
      type: "add-obj",
      id: shapeId,
      "page-id": args.pageId,
      "frame-id": "root",
      obj: shape,
    },
  ];

  await client.commitChanges(args.fileId, changes);

  return JSON.stringify({
    success: true,
    shapeId,
    type: args.type,
    name: args.name,
    position: { x: args.x, y: args.y },
    size: { width: args.width, height: args.height },
  }, null, 2);
}
