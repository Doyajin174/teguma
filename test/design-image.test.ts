import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createImageResolver,
  exportDocument,
  parseDesignDocument,
  renderPageToSvg,
  type DesignDocument,
} from "../src/design/index.js";

let workspace: string;
let assetRoot: string;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "teguma-design-image-"));
  assetRoot = path.join(workspace, "assets");
  await writePng(path.join(assetRoot, "pixel.png"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writePng(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const png = new PNG({ width: 2, height: 3 });
  png.data.fill(255);
  await writeFile(filePath, PNG.sync.write(png));
}

function imageDocument(source = "pixel.png"): DesignDocument {
  return parseDesignDocument({
    id: "image-document",
    title: "Image document",
    canvas: { width: 40, height: 60 },
    pages: [
      {
        id: "page",
        name: "Page",
        background: "#FFFFFF",
        layers: [
          {
            id: "image",
            type: "image",
            source,
            frame: { x: 0, y: 0, width: 40, height: 60 },
          },
        ],
      },
    ],
  });
}

describe("design image resolver", () => {
  it("embeds a PNG data URI and renders it into SVG", async () => {
    const document = imageDocument();
    const resolveImage = createImageResolver({ root: assetRoot });

    const svg = await renderPageToSvg(document, document.pages[0], resolveImage);

    expect(svg).toContain("href=\"data:image/png;base64,");
  });

  it("rejects lexical paths outside the asset root", async () => {
    const resolveImage = createImageResolver({ root: assetRoot });

    await expect(resolveImage("../../etc/passwd")).rejects.toThrow(
      "Asset path escapes asset root: ../../etc/passwd",
    );
  });

  it("rejects symlinks that resolve outside the asset root", async () => {
    const outside = path.join(workspace, "outside.png");
    await writePng(outside);
    await symlink(outside, path.join(assetRoot, "outside.png"));
    const resolveImage = createImageResolver({ root: assetRoot });

    await expect(resolveImage("outside.png")).rejects.toThrow(
      "Asset real path escapes asset root: outside.png",
    );
  });

  it("rejects unsupported image extensions", async () => {
    await writeFile(path.join(assetRoot, "image.gif"), "not an image");
    const resolveImage = createImageResolver({ root: assetRoot });

    await expect(resolveImage("image.gif")).rejects.toThrow("Unsupported image extension: .gif");
  });

  it("rejects images larger than the configured byte limit", async () => {
    const resolveImage = createImageResolver({ root: assetRoot, maxBytes: 1 });

    await expect(resolveImage("pixel.png")).rejects.toThrow("Image exceeds maximum byte size of 1");
  });

  it("caches a resolved path within one resolver instance", async () => {
    const imagePath = path.join(assetRoot, "pixel.png");
    const resolveImage = createImageResolver({ root: assetRoot });
    const first = await resolveImage("pixel.png");
    await writeFile(imagePath, "changed image data");

    await expect(resolveImage("pixel.png")).resolves.toBe(first);
  });

  it("exports image documents as valid PNGs at the requested dimensions", async () => {
    const document = imageDocument();
    const result = await exportDocument(document, {
      format: "png",
      width: 80,
      resolveImage: createImageResolver({ root: assetRoot }),
    });

    const png = PNG.sync.read(result.files[0].data);
    expect({ width: png.width, height: png.height }).toEqual({ width: 80, height: 120 });
  });
});
