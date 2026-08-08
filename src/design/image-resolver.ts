/**
 * Filesystem-backed image resolver for SVG exports.
 *
 * Design documents refer to local, repository-relative assets. This resolver
 * embeds only supported files from a configured root, guarding both lexical
 * paths and resolved symlinks before loading bytes into an SVG data URI.
 */

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { ImageResolver } from "./svg.js";

export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export interface ImageResolverOptions {
  /** Root directory that image sources are allowed to reference. */
  root: string;
  /** Largest image file that may be embedded, in bytes. */
  maxBytes?: number;
}

function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function mimeTypeFor(filePath: string): string {
  const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!mimeType) {
    throw new Error(`Unsupported image extension: ${path.extname(filePath) || "(none)"}`);
  }
  return mimeType;
}

function hasSameIdentity(
  left: { dev: number; ino: number },
  right: { dev: number; ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Read only the byte range approved by fstat, even if the file grows concurrently. */
async function readBoundedImage(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<Buffer> {
  const data = Buffer.alloc(size);
  let bytesRead = 0;

  while (bytesRead < data.length) {
    const result = await handle.read(data, bytesRead, data.length - bytesRead, bytesRead);
    if (result.bytesRead === 0) break;
    bytesRead += result.bytesRead;
  }

  return data.subarray(0, bytesRead);
}

/** Create an image resolver that embeds contained filesystem assets as data URIs. */
export function createImageResolver(options: ImageResolverOptions): ImageResolver {
  const root = path.resolve(options.root);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error("Image maximum byte size must be a non-negative safe integer");
  }

  const cache = new Map<string, string>();

  return async (source: string): Promise<string> => {
    const absolutePath = path.resolve(root, source);
    if (!isContained(root, absolutePath)) {
      throw new Error(`Asset path escapes asset root: ${source}`);
    }

    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error: unknown) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ELOOP") {
        throw error;
      }

      // Preserve support for an already-present symlink that resolves inside
      // the asset root. We canonicalize it before opening its non-symlink
      // target; an outside target remains rejected with the containment error.
      const [realRoot, realAssetPath] = await Promise.all([realpath(root), realpath(absolutePath)]);
      if (!isContained(realRoot, realAssetPath)) {
        throw new Error(`Asset real path escapes asset root: ${source}`, { cause: error });
      }
      handle = await open(realAssetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) {
        throw new Error(`Asset path is not a regular file: ${source}`);
      }
      if (metadata.size > maxBytes) {
        throw new Error(`Image exceeds maximum byte size of ${maxBytes}: ${source}`);
      }

      // The descriptor is opened before pathname validation. Comparing the
      // current pathname to the held inode prevents a replacement during that
      // validation from redirecting the later read, which always uses handle.
      // Concurrent writes to that same inode can still change its contents;
      // the bounded descriptor read prevents them from exceeding maxBytes.
      const [realRoot, realAssetPath] = await Promise.all([realpath(root), realpath(absolutePath)]);
      if (!isContained(realRoot, realAssetPath)) {
        throw new Error(`Asset real path escapes asset root: ${source}`);
      }
      const named = await lstat(realAssetPath);
      if (!named.isFile() || !hasSameIdentity(metadata, named)) {
        throw new Error(`Asset path changed while resolving: ${source}`);
      }

      const cached = cache.get(realAssetPath);
      if (cached) return cached;

      const mimeType = mimeTypeFor(realAssetPath);
      const data = await readBoundedImage(handle, metadata.size);
      const dataUri = `data:${mimeType};base64,${data.toString("base64")}`;
      cache.set(realAssetPath, dataUri);
      return dataUri;
    } finally {
      await handle.close();
    }
  };
}
