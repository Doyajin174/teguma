import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replacement = vi.hoisted(() => ({
  sourcePath: "",
  replace: undefined as undefined | (() => Promise<void>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (filePath: Parameters<typeof actual.realpath>[0]) => {
      const resolved = await actual.realpath(filePath);
      if (String(filePath) === replacement.sourcePath && replacement.replace) {
        const replace = replacement.replace;
        replacement.replace = undefined;
        await replace();
      }
      return resolved;
    },
  };
});

import { createImageResolver } from "../src/design/image-resolver.js";

let workspace: string;
let assetRoot: string;
let outside: string;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "teguma-image-containment-"));
  assetRoot = path.join(workspace, "assets");
  outside = path.join(workspace, "outside");
  await mkdir(assetRoot);
  await mkdir(outside);
  replacement.sourcePath = "";
  replacement.replace = undefined;
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("image resolver containment", () => {
  it("does not redirect a read when the validated path is replaced", async () => {
    const source = path.join(assetRoot, "image.png");
    const victim = path.join(outside, "victim.png");
    await writeFile(source, "inside image");
    await writeFile(victim, "outside image");
    replacement.sourcePath = source;
    replacement.replace = async () => {
      await rm(source);
      await symlink(victim, source);
    };

    const resolveImage = createImageResolver({ root: assetRoot });

    await expect(resolveImage("image.png")).rejects.toThrow("Asset path changed while resolving");
  });

  it("rejects an oversized image from fstat before allocating a read buffer", async () => {
    await writeFile(path.join(assetRoot, "oversized.png"), Buffer.alloc(1024 * 1024));
    const resolveImage = createImageResolver({ root: assetRoot, maxBytes: 64 });

    await expect(resolveImage("oversized.png")).rejects.toThrow(
      "Image exceeds maximum byte size of 64",
    );
  });
});
