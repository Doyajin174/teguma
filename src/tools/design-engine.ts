/**
 * MCP tools for the design engine.
 *
 * These operate on declarative documents, so they work with or without a Penpot
 * connection. Export writes into a caller-provided directory that is validated
 * to stay inside the configured output root.
 */

import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";
import { z } from "zod";
import {
  BrandKitSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
  DesignDocumentSchema,
  DesignPolicySchema,
  ProjectIdSchema,
  alignLayers,
  autoLayoutDocument,
  applyBrandKit,
  createImageResolver,
  countLayers,
  distributeLayers,
  distributeVerticalRhythm,
  evaluatePolicy,
  exportDocument,
  instantiateTemplate,
  inspectDocument,
  listSizePresets,
  listProjects,
  loadProject,
  parseDesignDocument,
  resizeDocument,
  resolveResize,
  saveProject,
  stackLayers,
  cropImage,
  padImage,
  removeFlatBackground,
  scaleImage,
  trimTransparent,
  validateImageDimensions,
  type DesignDocument,
  type DesignProjectStore,
  type ExportFormat,
} from "../design/index.js";

const PRESET_CATEGORIES = ["social", "video", "blog", "presentation", "print"] as const;

export const listSizePresetsSchema = {
  category: z
    .enum(PRESET_CATEGORIES)
    .optional()
    .describe("Optional preset category filter"),
};

export function listSizePresetsTool(args: { category?: (typeof PRESET_CATEGORIES)[number] }) {
  const presets = listSizePresets(args.category);
  return JSON.stringify({ count: presets.length, presets }, null, 2);
}

export const createDesignDocumentSchema = {
  document: DesignDocumentSchema.describe("Design document to validate"),
  applyBrandKitNormalization: z
    .boolean()
    .default(false)
    .describe("Rewrite colors and fonts to the nearest brand kit entry before QA"),
};

export function createDesignDocumentTool(args: {
  document: unknown;
  applyBrandKitNormalization?: boolean;
}) {
  let document = parseDesignDocument(args.document);
  if (args.applyBrandKitNormalization) {
    document = applyBrandKit(document);
  }

  const report = inspectDocument(document);
  return JSON.stringify(
    {
      documentId: document.id,
      title: document.title,
      canvas: document.canvas,
      pages: document.pages.length,
      layers: countLayers(document),
      qa: report,
      document,
    },
    null,
    2,
  );
}

export const checkDesignPolicySchema = {
  document: DesignDocumentSchema.describe("Design document to evaluate against a workspace policy"),
  policy: DesignPolicySchema.describe("Configurable workspace brand and approval policy"),
};

/** Evaluate configurable workspace policy without exporting or changing the document. */
export function checkDesignPolicyTool(args: { document: unknown; policy: unknown }) {
  const document = parseDesignDocument(args.document);
  const policy = DesignPolicySchema.parse(args.policy);
  const violations = evaluatePolicy(document, policy);
  return JSON.stringify(
    {
      violations,
      approvalState: policy.approval.state,
      exportPermitted: violations.length === 0,
    },
    null,
    2,
  );
}

export const createFromTemplateSchema = {
  templateId: z.string().min(1).describe("Registered template id, such as card-news-cover"),
  input: z.record(z.unknown()).describe("Only the template's declared content slots"),
};

/** Build a validated, QA-inspected document from original parameterized layouts. */
export function createFromTemplateTool(args: { templateId: string; input: Record<string, unknown> }) {
  const result = instantiateTemplate(args.templateId, args.input);
  return JSON.stringify(
    {
      templateId: args.templateId,
      filledSlots: result.filledSlots,
      qa: result.qa,
      document: result.document,
    },
    null,
    2,
  );
}

export const autoLayoutDesignDocumentSchema = {
  document: DesignDocumentSchema.describe("Design document whose text frames should be repaired"),
  minimumFontScale: z
    .number()
    .positive()
    .max(1)
    .default(0.6)
    .describe("Smallest allowed text size as a fraction of its authored size"),
  onOverflow: z
    .enum(["shrink", "grow", "truncate"])
    .default("grow")
    .describe("After shrinking to the floor: fail, grow inside the safe area, or truncate with an ellipsis"),
};

export function autoLayoutDesignDocumentTool(args: {
  document: unknown;
  minimumFontScale?: number;
  onOverflow?: "shrink" | "grow" | "truncate";
}) {
  const document = parseDesignDocument(args.document);
  const result = autoLayoutDocument(document, {
    ...(args.minimumFontScale === undefined ? {} : { minimumFontScale: args.minimumFontScale }),
    ...(args.onOverflow === undefined ? {} : { onOverflow: args.onOverflow }),
  });

  return JSON.stringify(
    {
      document: result.document,
      changes: result.changes,
      qa: inspectDocument(result.document),
    },
    null,
    2,
  );
}

type ArrangeDesignLayersOperation =
  | { type: "align"; horizontal?: "start" | "center" | "end"; vertical?: "start" | "center" | "end" }
  | {
      type: "distribute";
      axis: "x" | "y";
      mode: "space-between" | "space-around" | "fixed-gap";
      gap?: number;
    }
  | { type: "stack"; origin: { x: number; y: number }; axis: "x" | "y"; gap: number }
  | {
      type: "vertical-rhythm";
      anchors: Array<"top" | "upper-middle" | "remaining-space" | "bottom">;
    };

const layoutOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("align"),
    horizontal: z.enum(["start", "center", "end"]).optional(),
    vertical: z.enum(["start", "center", "end"]).optional(),
  }),
  z.object({
    type: z.literal("distribute"),
    axis: z.enum(["x", "y"]),
    mode: z.enum(["space-between", "space-around", "fixed-gap"]),
    gap: z.number().finite().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("stack"),
    origin: z.object({ x: z.number().finite(), y: z.number().finite() }),
    axis: z.enum(["x", "y"]),
    gap: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal("vertical-rhythm"),
    anchors: z.array(z.enum(["top", "upper-middle", "remaining-space", "bottom"])).min(1),
  }),
]);

export const arrangeDesignLayersSchema = {
  document: DesignDocumentSchema.describe("Design document containing the layers to arrange"),
  pageId: z.string().min(1).describe("Page containing all selected layer ids"),
  layerIds: z.array(z.string().min(1)).min(1).describe("Layer ids in the intended layout order"),
  operation: layoutOperationSchema.describe("Deterministic layout operation to apply"),
};

/** Arrange selected page layers within the document canvas safe area and return fresh document QA. */
export function arrangeDesignLayersTool(args: {
  document: unknown;
  pageId: string;
  layerIds: string[];
  operation: unknown;
}) {
  const document = parseDesignDocument(args.document);
  const operation = layoutOperationSchema.parse(args.operation) as ArrangeDesignLayersOperation;
  if (new Set(args.layerIds).size !== args.layerIds.length) {
    throw new Error("layerIds must not contain duplicates");
  }
  const page = document.pages.find((candidate) => candidate.id === args.pageId);
  if (!page) throw new Error(`Design page not found: ${args.pageId}`);

  const selected = args.layerIds.map((id) => {
    const layer = page.layers.find((candidate) => candidate.id === id);
    if (!layer) throw new Error(`Layer not found on page ${page.id}: ${id}`);
    return layer;
  });
  const container = {
    x: 0,
    y: 0,
    width: document.canvas.width,
    height: document.canvas.height,
  };
  const safeMargin = document.canvas.safeMargin;
  let arranged;

  switch (operation.type) {
    case "align":
      if (operation.horizontal === undefined && operation.vertical === undefined) {
        throw new Error("align requires horizontal and/or vertical");
      }
      arranged = alignLayers(selected, container, { ...operation, safeMargin });
      break;
    case "distribute":
      arranged = distributeLayers(selected, container, { ...operation, safeMargin });
      break;
    case "stack":
      arranged = stackLayers(selected, { ...operation, container, safeMargin });
      break;
    case "vertical-rhythm":
      if (operation.anchors.length !== selected.length) {
        throw new Error("vertical-rhythm anchors must match layerIds length");
      }
      arranged = distributeVerticalRhythm(selected, container, { ...operation, safeMargin });
      break;
  }

  const byId = new Map(arranged.map((layer) => [layer.id, layer]));
  const result = parseDesignDocument({
    ...document,
    pages: document.pages.map((candidate) => candidate.id !== page.id
      ? candidate
      : {
          ...candidate,
          layers: candidate.layers.map((layer) => byId.get(layer.id) ?? {
            ...layer,
            frame: { ...layer.frame },
          }),
        }),
  });
  return JSON.stringify({ document: result, qa: inspectDocument(result) }, null, 2);
}

export const resizeDesignDocumentSchema = {
  document: DesignDocumentSchema.describe("Source design document"),
  preset: z.string().optional().describe("Size preset id, such as instagram-story"),
  width: z.number().positive().optional().describe("Target width, when no preset is used"),
  height: z.number().positive().optional().describe("Target height, when no preset is used"),
  mode: z
    .enum(["fill", "fit", "original", "adapt"])
    .default("fill")
    .describe(
      "fill covers the canvas, fit keeps everything visible, original keeps layer sizes, adapt redistributes the layout for a different aspect ratio",
    ),
  lockAspectRatio: z
    .boolean()
    .default(false)
    .describe("Derive the missing axis from the source ratio"),
};

export function resizeDesignDocumentTool(args: {
  document: unknown;
  preset?: string;
  width?: number;
  height?: number;
  mode?: "fill" | "fit" | "original" | "adapt";
  lockAspectRatio?: boolean;
}) {
  const document = parseDesignDocument(args.document);
  const target = {
    ...(args.preset ? { preset: args.preset } : {}),
    ...(args.width !== undefined ? { width: args.width } : {}),
    ...(args.height !== undefined ? { height: args.height } : {}),
    mode: args.mode ?? "fill",
    lockAspectRatio: args.lockAspectRatio ?? false,
  };

  const resolved = resolveResize(document, target);
  const resized = resizeDocument(document, target);

  return JSON.stringify(
    {
      from: { width: document.canvas.width, height: document.canvas.height },
      to: { width: resized.canvas.width, height: resized.canvas.height },
      applied: resolved,
      qa: inspectDocument(resized),
      document: resized,
    },
    null,
    2,
  );
}

export const exportDesignDocumentSchema = {
  document: DesignDocumentSchema.describe("Design document to export"),
  format: z
    .enum(["svg", "png", "jpg", "pdf", "pptx", "gif", "mp4"])
    .describe("Export format"),
  outputDirectory: z
    .string()
    .describe("Directory for exported files, resolved inside the configured output root"),
  width: z.number().positive().optional().describe("Output pixel width"),
  transparentBackground: z
    .boolean()
    .default(false)
    .describe("PNG only. Keep alpha instead of flattening onto the page background"),
  fontFiles: z
    .array(z.string())
    .optional()
    .describe("Absolute font file paths for deterministic text rendering"),
};

export interface DesignExportContext {
  /** Only paths inside this directory may be written. */
  outputRoot: string;
  resolveImage?: (source: string) => Promise<string>;
}

/**
 * Resolve a writable export directory without ever creating or writing outside
 * the export root.
 *
 * Creating the directory first and validating afterwards is exploitable: a
 * symlinked path component makes `mkdir -p` materialize directories outside the
 * root before the check runs. So each component is validated against the real
 * root as it is created, and existing components must already resolve inside it.
 */
interface WritableDirectory {
  /** The validated directory name, used because Node does not expose openat(2). */
  path: string;
  /** Holds the directory object that was validated for the export lifetime. */
  handle: FileHandle;
  /** Device/inode identity captured from the held directory handle. */
  identity: { dev: number; ino: number };
}

function hasIdentity(
  metadata: { dev: number; ino: number },
  identity: WritableDirectory["identity"],
): boolean {
  return metadata.dev === identity.dev && metadata.ino === identity.ino;
}

/**
 * Confirm that the pathname still names the directory object held by this
 * export. The handle alone is not enough: it remains valid after a rename,
 * while subsequent Node pathname operations would otherwise use a replacement.
 */
async function verifyWritableDirectory(directory: WritableDirectory): Promise<void> {
  const [held, named] = await Promise.all([directory.handle.stat(), lstat(directory.path)]);
  if (!held.isDirectory() || !named.isDirectory() || !hasIdentity(held, directory.identity)
    || !hasIdentity(named, directory.identity)) {
    throw new Error("Export directory changed after validation, refusing to write");
  }
}

async function resolveWritableDirectory(
  outputRoot: string,
  requested: string,
): Promise<WritableDirectory> {
  if (path.isAbsolute(requested)) {
    throw new Error(`Output directory must be relative to the export root: ${requested}`);
  }

  const root = path.resolve(outputRoot);
  const target = path.resolve(root, requested);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Output directory escapes the export root: ${requested}`);
  }

  await mkdir(root, { recursive: true });
  let cursor = await realpath(root);
  const realRoot = cursor;

  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    if (segment === "..") {
      throw new Error(`Output directory escapes the export root: ${requested}`);
    }

    const candidate = path.join(cursor, segment);
    const existing = await lstat(candidate).catch(() => undefined);

    if (existing?.isSymbolicLink()) {
      throw new Error(
        `Output directory path component is a symlink, refusing to follow it: ${segment}`,
      );
    }
    if (existing && !existing.isDirectory()) {
      throw new Error(`Output directory path component is not a directory: ${segment}`);
    }
    if (!existing) {
      await mkdir(candidate);
    }

    cursor = await realpath(candidate);
    if (cursor !== realRoot && !cursor.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`Output directory real path escapes the export root: ${requested}`);
    }
  }

  const handle = await open(cursor, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const metadata = await handle.stat();
    if (!metadata.isDirectory()) {
      throw new Error(`Output directory path component is not a directory: ${requested}`);
    }

    const directory = {
      path: cursor,
      handle,
      identity: { dev: metadata.dev, ino: metadata.ino },
    };
    await verifyWritableDirectory(directory);
    return directory;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Write an export file without following a pre-existing symlink or hardlink.
 *
 * Node has no openat(2)-style API, so it cannot create a file relative to the
 * held directory handle. We verify that the pathname still names that handle
 * immediately before each pathname operation, use exclusive no-follow creation,
 * and verify the new file handle before writing. A hostile replacement after the
 * final directory verification but before open remains a Node API limitation;
 * it can at most create an empty file before the post-open check refuses to
 * write bytes. Likewise, a same-credential actor can add a hardlink after the
 * link-count check but before writeFile; Node cannot atomically pin a pathname
 * or lock link count through a write, so this residual requires native support.
 */
async function writeExportFile(
  directory: WritableDirectory,
  name: string,
  data: Buffer,
): Promise<void> {
  await verifyWritableDirectory(directory);
  const target = path.join(directory.path, name);
  const existing = await lstat(target).catch(() => undefined);

  if (existing?.isSymbolicLink()) {
    throw new Error(`Refusing to overwrite a symlink inside the export root: ${target}`);
  }
  if (existing && !existing.isFile()) {
    throw new Error(`Refusing to overwrite a non-file export path: ${target}`);
  }

  if (existing) {
    // Removing the checked directory entry never follows a symlink. Replacing
    // our own prior output is therefore safe even if it has become a hardlink.
    await unlink(target);
  }

  await verifyWritableDirectory(directory);
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new Error(`Refusing to write a linked or non-file export path: ${target}`);
    }
    await verifyWritableDirectory(directory);
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}

function fileNameFor(
  document: DesignDocument,
  format: ExportFormat,
  pageId: string,
  index: number,
): string {
  // pdf, pptx, gif, and mp4 are single-file, document-level exports.
  if (format === "pdf" || format === "pptx" || format === "gif" || format === "mp4") {
    return `${document.id}.${format}`;
  }
  const extension = format;
  return `${document.id}-${String(index + 1).padStart(2, "0")}-${pageId}.${extension}`;
}

export async function exportDesignDocumentTool(
  args: {
    document: unknown;
    format: ExportFormat;
    outputDirectory: string;
    width?: number;
    transparentBackground?: boolean;
    fontFiles?: string[];
  },
  context: DesignExportContext,
) {
  const document = parseDesignDocument(args.document);
  const report = inspectDocument(document);
  if (!report.passed) {
    const failed = report.checks.filter((check) => !check.pass);
    throw new Error(
      `Design QA failed, refusing to export: ${failed
        .map((check) => `${check.name}${check.detail ? ` (${check.detail})` : ""}`)
        .join("; ")}`,
    );
  }

  const directory = await resolveWritableDirectory(context.outputRoot, args.outputDirectory);
  try {
    const result = await exportDocument(document, {
      format: args.format,
      ...(args.width !== undefined ? { width: args.width } : {}),
      transparentBackground: args.transparentBackground ?? false,
      ...(args.fontFiles !== undefined ? { fontFiles: args.fontFiles } : {}),
      resolveImage: context.resolveImage ?? createImageResolver({ root: process.cwd() }),
    });

    const written: Array<{ file: string; bytes: number }> = [];
    for (const [index, file] of result.files.entries()) {
      const name = fileNameFor(document, result.format, file.pageId, index);
      await writeExportFile(directory, name, file.data);
      written.push({ file: name, bytes: file.data.length });
    }

    return JSON.stringify(
      {
        format: result.format,
        width: result.width,
        height: result.height,
        directory: directory.path,
        files: written,
        qa: report,
      },
      null,
      2,
    );
  } finally {
    await directory.handle.close();
  }
}

const imageRgbaSchema = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);

const imageOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("crop"),
    rect: z.object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  }),
  z.object({
    type: z.literal("scale"),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fit: z.enum(["stretch", "contain", "cover"]).optional(),
  }),
  z.object({
    type: z.literal("pad"),
    top: z.number().int().nonnegative(),
    right: z.number().int().nonnegative(),
    bottom: z.number().int().nonnegative(),
    left: z.number().int().nonnegative(),
    fill: imageRgbaSchema,
  }),
  z.object({
    type: z.literal("remove-flat-background"),
    tolerance: z.number().min(0).max(255),
    corners: z.array(z.enum(["top-left", "top-right", "bottom-left", "bottom-right"])).min(1).optional(),
  }),
  z.object({ type: z.literal("trim-transparent") }),
]);

export const processDesignImageSchema = {
  source: z.string().min(1).describe("Image path resolved inside the configured asset root"),
  outputDirectory: z.string().describe("Directory for the PNG result, inside the configured export root"),
  outputFile: z.string().min(1).default("processed-image.png").describe("PNG filename only, without path separators"),
  operations: z.array(imageOperationSchema).min(1).max(20).describe("Ordered deterministic image operations"),
};

export interface DesignImageProcessContext {
  /** Only paths inside this directory may be written. */
  outputRoot: string;
  /** Optional test or host resolver. The default uses the existing contained image resolver. */
  resolveImage?: (source: string) => Promise<string>;
}

function decodedDataUri(dataUri: string): { mimeType: "image/png" | "image/jpeg"; data: Buffer } {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUri);
  if (!match) {
    throw new Error("Image processing supports PNG and JPEG sources resolved as base64 data URIs");
  }
  return { mimeType: match[1] as "image/png" | "image/jpeg", data: Buffer.from(match[2], "base64") };
}

/** Read encoded PNG dimensions before pngjs inflates pixels, blocking decompression-sized allocations. */
function pngSourceDimensions(data: Buffer): { width: number; height: number } {
  if (
    data.length < 24
    || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || data.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("Resolved PNG is invalid");
  }
  const dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  validateImageDimensions(dimensions.width, dimensions.height);
  return dimensions;
}

/** Obtain JPEG dimensions without a decoder so resvg can rasterize the approved data URI safely. */
function jpegSourceDimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error("Resolved JPEG is invalid");
  let offset = 2;
  while (offset < data.length) {
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 8) break;
      const dimensions = { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
      validateImageDimensions(dimensions.width, dimensions.height);
      return dimensions;
    }
    offset += length;
  }
  throw new Error("Resolved JPEG has no supported frame dimensions");
}

/** Decode the resolver-approved source to PNG pixels; JPEG rasterization reuses the installed renderer. */
function decodeResolvedImage(dataUri: string): PNG {
  const resolved = decodedDataUri(dataUri);
  if (resolved.mimeType === "image/png") {
    pngSourceDimensions(resolved.data);
    const png = PNG.sync.read(resolved.data);
    validateImageDimensions(png.width, png.height);
    return png;
  }
  const dimensions = jpegSourceDimensions(resolved.data);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}"><image href="${dataUri}" width="${dimensions.width}" height="${dimensions.height}"/></svg>`;
  const png = PNG.sync.read(Buffer.from(new Resvg(svg).render().asPng()));
  validateImageDimensions(png.width, png.height);
  return png;
}

function outputImageName(name: string): void {
  if (path.basename(name) !== name || name === "." || name === "..") {
    throw new Error("Output file must be a filename without path separators");
  }
  if (path.extname(name).toLowerCase() !== ".png") {
    throw new Error("Output file must use the .png extension");
  }
}

/**
 * Apply ordered classical pixel operations to a resolver-approved image and
 * write the PNG through the same hardened export-root writer as document export.
 */
export async function processDesignImageTool(
  args: {
    source: string;
    outputDirectory: string;
    outputFile?: string;
    operations: unknown;
  },
  context: DesignImageProcessContext,
) {
  const operations = z.array(imageOperationSchema).min(1).max(20).parse(args.operations);
  const outputFile = args.outputFile ?? "processed-image.png";
  outputImageName(outputFile);
  const resolveImage = context.resolveImage ?? createImageResolver({ root: process.cwd() });
  let image = decodeResolvedImage(await resolveImage(args.source));
  const before = { width: image.width, height: image.height };
  const trims: Array<{ left: number; top: number; right: number; bottom: number }> = [];

  for (const operation of operations) {
    switch (operation.type) {
      case "crop": image = cropImage(image, operation.rect); break;
      case "scale": image = scaleImage(image, operation); break;
      case "pad": image = padImage(image, operation); break;
      case "remove-flat-background": image = removeFlatBackground(image, operation); break;
      case "trim-transparent": {
        const result = trimTransparent(image);
        image = result.image;
        trims.push(result.offsets);
        break;
      }
    }
  }

  const directory = await resolveWritableDirectory(context.outputRoot, args.outputDirectory);
  try {
    const data = PNG.sync.write(image);
    await writeExportFile(directory, outputFile, data);
    return JSON.stringify(
      {
        outputPath: path.join(directory.path, outputFile),
        before,
        after: { width: image.width, height: image.height },
        ...(trims.length > 0 ? { trimOffsets: trims } : {}),
      },
      null,
      2,
    );
  } finally {
    await directory.handle.close();
  }
}

export const saveDesignProjectSchema = {
  id: ProjectIdSchema.describe("Stable project id; letters, digits, ., _, and - only"),
  title: z.string().min(1).describe("Human-readable project title"),
  document: DesignDocumentSchema.describe("Design document to persist"),
  brandKit: BrandKitSchema.optional().describe("Reusable project-level brand kit"),
};

export const loadDesignProjectSchema = {
  id: ProjectIdSchema.describe("Saved project id"),
};

export const listDesignProjectsSchema = {};

export interface DesignProjectContext {
  /** Only paths inside this directory may hold persistent project files. */
  projectRoot: string;
}

function projectStore(context: DesignProjectContext): DesignProjectStore {
  return { root: context.projectRoot };
}

/**
 * Persist a draft while reporting its current QA state. Unlike export, saving
 * intentionally permits failing QA so agents can resume and repair drafts.
 */
export async function saveDesignProjectTool(
  args: {
    id: string;
    title: string;
    document: unknown;
    brandKit?: unknown;
  },
  context: DesignProjectContext,
) {
  const now = new Date().toISOString();
  let createdAt = now;

  try {
    createdAt = (await loadProject(projectStore(context), args.id)).createdAt;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Design project not found:")) {
      throw error;
    }
  }

  const project = await saveProject(projectStore(context), {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: args.id,
    title: args.title,
    createdAt,
    updatedAt: now,
    document: args.document,
    ...(args.brandKit === undefined ? {} : { brandKit: args.brandKit }),
  });
  return JSON.stringify({ project, qa: inspectDocument(project.document) }, null, 2);
}

/** Load the full persisted envelope so an agent can continue editing its document. */
export async function loadDesignProjectTool(
  args: { id: string },
  context: DesignProjectContext,
) {
  return JSON.stringify({ project: await loadProject(projectStore(context), args.id) }, null, 2);
}

/** List persisted project envelopes in deterministic id order. */
export async function listDesignProjectsTool(context: DesignProjectContext) {
  const projects = await listProjects(projectStore(context));
  return JSON.stringify({ count: projects.length, projects }, null, 2);
}
