/**
 * Design document model.
 *
 * A document is a multi-page, layered description of a graphic that can be
 * resized, brand-normalized, rendered, and exported. It is intentionally
 * declarative so an agent can produce it in one shot and so identical input
 * always yields identical output.
 */

import { z } from "zod";

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const HexColorSchema = z.string().regex(HEX_COLOR_PATTERN, "Color must be #RRGGBB");

const IdentifierSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Identifier must be alphanumeric with . _ -");

export const FrameSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const LayerBaseSchema = {
  id: IdentifierSchema,
  frame: FrameSchema,
  opacity: z.number().min(0).max(1).default(1),
};

export const TextLayerSchema = z.object({
  ...LayerBaseSchema,
  type: z.literal("text"),
  text: z.string().min(1),
  fontFamily: z.string().min(1),
  fontSize: z.number().finite().positive(),
  fontWeight: z.number().int().min(100).max(900).default(400),
  color: HexColorSchema,
  align: z.enum(["start", "middle", "end"]).default("start"),
  lineHeight: z.number().finite().positive().default(1.3),
  letterSpacing: z.number().finite().default(0),
});

export const RectLayerSchema = z.object({
  ...LayerBaseSchema,
  type: z.literal("rect"),
  fill: HexColorSchema,
  radius: z.number().finite().nonnegative().default(0),
});

export const ImageLayerSchema = z.object({
  ...LayerBaseSchema,
  type: z.literal("image"),
  /** Repository-relative path resolved through the contained-path guard. */
  source: z.string().min(1),
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Optional brand logo id, used for brand-kit validation. */
  logoId: IdentifierSchema.optional(),
});

export const DesignLayerSchema = z.discriminatedUnion("type", [
  TextLayerSchema,
  RectLayerSchema,
  ImageLayerSchema,
]);

export const DesignPageSchema = z.object({
  id: IdentifierSchema,
  name: z.string().min(1),
  background: HexColorSchema.default("#FFFFFF"),
  layers: z.array(DesignLayerSchema),
});

export const CanvasSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  unit: z.enum(["px", "mm"]).default("px"),
  safeMargin: z.number().finite().nonnegative().default(0),
});

export const BrandColorSchema = z.object({
  id: IdentifierSchema,
  name: z.string().min(1),
  value: HexColorSchema,
});

export const BrandFontSchema = z.object({
  family: z.string().min(1),
  weights: z.array(z.number().int().min(100).max(900)).min(1),
});

export const BrandLogoSchema = z.object({
  id: IdentifierSchema,
  source: z.string().min(1),
});

export const BrandKitSchema = z.object({
  id: IdentifierSchema,
  name: z.string().min(1),
  palette: z.array(BrandColorSchema).min(1),
  fonts: z.array(BrandFontSchema).min(1),
  logos: z.array(BrandLogoSchema).default([]),
});

export const DesignDocumentSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1),
    canvas: CanvasSchema,
    brandKit: BrandKitSchema.optional(),
    pages: z.array(DesignPageSchema).min(1),
  })
  .superRefine((document, context) => {
    const pageIds = new Set<string>();

    for (const [pageIndex, page] of document.pages.entries()) {
      if (pageIds.has(page.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate page id: ${page.id}`,
          path: ["pages", pageIndex, "id"],
        });
      }
      pageIds.add(page.id);

      const layerIds = new Set<string>();
      for (const [layerIndex, layer] of page.layers.entries()) {
        if (layerIds.has(layer.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate layer id: ${layer.id}`,
            path: ["pages", pageIndex, "layers", layerIndex, "id"],
          });
        }
        layerIds.add(layer.id);
      }
    }
  });

export type Frame = z.infer<typeof FrameSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;
export type RectLayer = z.infer<typeof RectLayerSchema>;
export type ImageLayer = z.infer<typeof ImageLayerSchema>;
export type DesignLayer = z.infer<typeof DesignLayerSchema>;
export type DesignPage = z.infer<typeof DesignPageSchema>;
export type Canvas = z.infer<typeof CanvasSchema>;
export type BrandColor = z.infer<typeof BrandColorSchema>;
export type BrandFont = z.infer<typeof BrandFontSchema>;
export type BrandLogo = z.infer<typeof BrandLogoSchema>;
export type BrandKit = z.infer<typeof BrandKitSchema>;
export type DesignDocument = z.infer<typeof DesignDocumentSchema>;

/** Validate and normalize an untrusted document, filling schema defaults. */
export function parseDesignDocument(value: unknown): DesignDocument {
  return DesignDocumentSchema.parse(value);
}

/** Total layer count across every page. */
export function countLayers(document: DesignDocument): number {
  return document.pages.reduce((total, page) => total + page.layers.length, 0);
}
