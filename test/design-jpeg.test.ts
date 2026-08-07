import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  createImageResolver,
  encodeJpeg,
  exportDocument,
  parseDesignDocument,
} from "../src/design/index.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

function opaqueRgba(width: number, height: number, color: readonly [number, number, number]): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function headerMarkers(jpeg: Buffer): number[] {
  expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xFF, 0xD8]));
  const markers = [0xD8];
  let offset = 2;
  while (offset < jpeg.length) {
    expect(jpeg[offset]).toBe(0xFF);
    const marker = jpeg[offset + 1];
    markers.push(marker);
    offset += 2;
    if (marker === 0xDA) return markers;
    const length = jpeg.readUInt16BE(offset);
    expect(length).toBeGreaterThanOrEqual(2);
    offset += length;
  }
  throw new Error("JPEG did not contain a start-of-scan marker");
}

async function decodeWithSips(jpeg: Buffer): Promise<{ png: PNG; info: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "teguma-jpeg-"));
  const input = path.join(directory, "image.jpg");
  const output = path.join(directory, "image.png");
  await writeFile(input, jpeg);
  try {
    const info = execFileSync(
      "sips",
      ["-g", "format", "-g", "pixelWidth", "-g", "pixelHeight", input],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    execFileSync("sips", ["-s", "format", "png", input, "--out", output], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { png: PNG.sync.read(await readFile(output)), info };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function meanAbsoluteError(source: Uint8Array, decoded: PNG): number {
  let total = 0;
  for (let offset = 0; offset < source.length; offset += 4) {
    total += Math.abs(source[offset] - decoded.data[offset]);
    total += Math.abs(source[offset + 1] - decoded.data[offset + 1]);
    total += Math.abs(source[offset + 2] - decoded.data[offset + 2]);
  }
  return total / ((source.length / 4) * 3);
}

function textDocument() {
  return parseDesignDocument({
    id: "jpeg-text",
    title: "JPEG text",
    canvas: { width: 320, height: 140 },
    pages: [{
      id: "page",
      name: "Page",
      background: "#FFFFFF",
      layers: [{
        id: "copy",
        type: "text",
        // Real glyph advances measure this line at 285.984px, so the frame is
        // sized from measurement rather than a guess.
        frame: { x: 20, y: 35, width: 292, height: 70 },
        text: "SHARP TEXT",
        fontFamily: "IBM Plex Sans KR",
        fontSize: 48,
        fontWeight: 600,
        color: "#000000",
      }],
    }],
  });
}

function photographDocument() {
  return parseDesignDocument({
    id: "jpeg-photograph",
    title: "JPEG photograph",
    canvas: { width: 320, height: 180 },
    pages: [{
      id: "page",
      name: "Page",
      background: "#FFFFFF",
      layers: [{
        id: "photograph",
        type: "image",
        frame: { x: 0, y: 0, width: 320, height: 180 },
        source: "experiments/company-promo-naver-v3/assets/backgrounds/sevasa.jpg",
        fit: "cover",
      }],
    }],
  });
}

describe("baseline JPEG export", () => {
  it("writes ordered JFIF baseline markers, decodes independently, and is deterministic", async () => {
    const source = opaqueRgba(19, 13, [32, 144, 224]);
    const first = encodeJpeg(source, 19, 13);
    const second = encodeJpeg(source, 19, 13);

    expect(() => encodeJpeg(source, 19, 13, { quality: 0 })).toThrow(/between 1 and 100/);
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(-2)).toEqual(Buffer.from([0xFF, 0xD9]));
    expect(headerMarkers(first)).toEqual([0xD8, 0xE0, 0xDB, 0xC0, 0xC4, 0xDA]);

    const decoded = await decodeWithSips(first);
    expect(decoded.info).toContain("format: jpeg");
    expect(decoded.info).toContain("pixelWidth: 19");
    expect(decoded.info).toContain("pixelHeight: 13");
    expect(meanAbsoluteError(source, decoded.png)).toBeLessThan(2);
  });

  it("exports real JPEG bytes for sharp black-on-white text with bounded error", async () => {
    const document = textDocument();
    const [png, jpg] = await Promise.all([
      exportDocument(document, { format: "png", width: 320 }),
      exportDocument(document, { format: "jpg", width: 320, quality: 95 }),
    ]);
    const source = PNG.sync.read(png.files[0].data);
    const decoded = await decodeWithSips(jpg.files[0].data);

    expect(jpg.files[0].data.subarray(0, 2)).toEqual(Buffer.from([0xFF, 0xD8]));
    expect(decoded.png.width).toBe(source.width);
    expect(decoded.png.height).toBe(source.height);
    expect(meanAbsoluteError(source.data, decoded.png)).toBeLessThan(6);
  });

  it("keeps photographic output smaller than PNG and makes quality affect bytes and fidelity", async () => {
    const resolveImage = createImageResolver({ root: REPOSITORY_ROOT });
    const sourceExport = await exportDocument(photographDocument(), {
      format: "png",
      width: 320,
      resolveImage,
    });
    const source = PNG.sync.read(sourceExport.files[0].data);
    const quality40 = encodeJpeg(source.data, source.width, source.height, { quality: 40 });
    const quality85 = encodeJpeg(source.data, source.width, source.height);
    const quality95 = encodeJpeg(source.data, source.width, source.height, { quality: 95 });
    const [decoded40, decoded85, decoded95] = await Promise.all([
      decodeWithSips(quality40),
      decodeWithSips(quality85),
      decodeWithSips(quality95),
    ]);

    expect(quality95.length).toBeGreaterThan(quality40.length);
    expect(quality85.length).toBeLessThan(sourceExport.files[0].data.length * 0.8);
    expect({ width: decoded40.png.width, height: decoded40.png.height }).toEqual({
      width: source.width,
      height: source.height,
    });
    expect({ width: decoded95.png.width, height: decoded95.png.height }).toEqual({
      width: source.width,
      height: source.height,
    });
    expect(meanAbsoluteError(source.data, decoded85.png)).toBeLessThan(18);
  });
});
