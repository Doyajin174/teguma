import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import {
  cropImage,
  padImage,
  removeFlatBackground,
  scaleImage,
  trimTransparent,
} from "../src/design/image-ops.js";
import { processDesignImageTool } from "../src/tools/design-engine.js";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

function image(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      png.data.set(pixel(x, y), ((y * width) + x) * 4);
    }
  }
  return png;
}

function rgba(png: PNG, x: number, y: number): number[] {
  const offset = ((y * png.width) + x) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

function bytes(png: PNG): Buffer {
  return PNG.sync.write(png);
}

describe("design image operations", () => {
  it("crops exact source pixels and rejects an out-of-bounds rectangle", () => {
    const source = image(3, 2, (x, y) => [(y * 30) + (x * 10), 1, 2, 255]);
    const cropped = cropImage(source, { x: 1, y: 0, width: 2, height: 2 });

    expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 2, height: 2 });
    expect(rgba(cropped, 0, 0)).toEqual([10, 1, 2, 255]);
    expect(rgba(cropped, 1, 1)).toEqual([50, 1, 2, 255]);
    expect(() => cropImage(source, { x: 2, y: 1, width: 2, height: 1 })).toThrow(/within image bounds/);
  });

  it("box-downscales a high-frequency checkerboard to its 50% mean instead of aliasing", () => {
    const checkerboard = image(32, 32, (x, y) => {
      const channel = (x + y) % 2 === 0 ? 0 : 255;
      return [channel, channel, channel, 255];
    });
    const scaled = scaleImage(checkerboard, { width: 1, height: 1 });

    // Nearest-neighbour returns 0 or 255 here; the area filter preserves 50% coverage.
    expect(rgba(scaled, 0, 0)).toEqual([128, 128, 128, 255]);
  });

  it("bilinearly upscales a gradient with monotonic intermediate values", () => {
    const gradient = image(2, 1, (x) => [x * 255, x * 255, x * 255, 255]);
    const scaled = scaleImage(gradient, { width: 9 });
    const values = Array.from({ length: scaled.width }, (_, x) => rgba(scaled, x, 0)[0]);

    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(5);
    expect(values[4]).toBeCloseTo(128, 0);
  });

  it("pads with the requested solid fill and preserves original placement", () => {
    const source = image(2, 1, (x) => [x ? 20 : 10, 30, 40, 255]);
    const padded = padImage(source, { top: 1, right: 2, bottom: 1, left: 1, fill: [1, 2, 3, 4] });

    expect({ width: padded.width, height: padded.height }).toEqual({ width: 5, height: 3 });
    expect(rgba(padded, 0, 0)).toEqual([1, 2, 3, 4]);
    expect(rgba(padded, 1, 1)).toEqual([10, 30, 40, 255]);
    expect(rgba(padded, 2, 1)).toEqual([20, 30, 40, 255]);
  });

  it("removes only edge-connected uniform backdrop pixels and preserves the subject", () => {
    const source = image(7, 7, (x, y) => (
      x >= 2 && x <= 4 && y >= 2 && y <= 4 ? [220, 20, 30, 255] : [240, 240, 240, 255]
    ));
    const removed = removeFlatBackground(source, { tolerance: 0 });

    expect(rgba(removed, 0, 0)[3]).toBe(0);
    expect(rgba(removed, 6, 6)[3]).toBe(0);
    expect(rgba(removed, 3, 3)).toEqual([220, 20, 30, 255]);
  });

  it("does not claim to remove a busy gradient backdrop", () => {
    const gradientBackdrop = image(7, 5, (x, y) => [x * 40, (y * 35) + 10, 100, 255]);
    const removed = removeFlatBackground(gradientBackdrop, { tolerance: 0 });

    // Corner-matched edge pixels can be removed, but the unrelated middle stays opaque.
    expect(rgba(removed, 3, 2)[3]).toBe(255);
    expect([...removed.data].filter((_, index) => index % 4 === 3 && removed.data[index] === 0).length)
      .toBeLessThan(gradientBackdrop.width * gradientBackdrop.height);
  });

  it("trims fully transparent margins and reports exact offsets", () => {
    const source = image(5, 4, (x, y) => (
      x >= 1 && x <= 3 && y >= 1 && y <= 2 ? [7, 8, 9, 255] : [1, 2, 3, 0]
    ));
    const result = trimTransparent(source);

    expect(result.offsets).toEqual({ left: 1, top: 1, right: 1, bottom: 1 });
    expect({ width: result.image.width, height: result.image.height }).toEqual({ width: 3, height: 2 });
    expect(rgba(result.image, 0, 0)).toEqual([7, 8, 9, 255]);
  });

  it("rejects invalid output sizes, background tolerance, and oversized padding", () => {
    const source = image(1, 1, () => [1, 2, 3, 255]);

    expect(() => scaleImage(source, { width: 0 })).toThrow(/Scale width/);
    expect(() => removeFlatBackground(source, { tolerance: 256 })).toThrow(/tolerance/);
    expect(() => padImage(source, { top: 8_192, right: 0, bottom: 0, left: 0, fill: [0, 0, 0, 0] }))
      .toThrow(/must not exceed/);
  });

  it("is byte-deterministic for every operation", () => {
    const source = image(8, 8, (x, y) => [x * 20, y * 20, 100, (x + y) % 3 === 0 ? 128 : 255]);
    const operations = [
      () => cropImage(source, { x: 1, y: 1, width: 6, height: 6 }),
      () => scaleImage(source, { width: 5, height: 3 }),
      () => padImage(source, { top: 1, right: 1, bottom: 2, left: 2, fill: [4, 5, 6, 7] }),
      () => removeFlatBackground(source, { tolerance: 5 }),
      () => trimTransparent(source).image,
    ];

    for (const operation of operations) {
      expect(bytes(operation()).equals(bytes(operation()))).toBe(true);
    }
  });

  it("round-trips a resolver-approved repo JPEG through the MCP tool into a valid PNG", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "teguma-image-ops-"));
    workspaces.push(outputRoot);
    const result = JSON.parse(await processDesignImageTool(
      {
        source: "experiments/company-promo-naver-v3/assets/backgrounds/sevasa.jpg",
        outputDirectory: "processed",
        outputFile: "sevasa.png",
        operations: [{ type: "scale", width: 100, height: 80, fit: "stretch" }],
      },
      { outputRoot },
    ));
    const output = PNG.sync.read(await readFile(result.outputPath));

    expect(result.before).toEqual({ width: 1254, height: 1254 });
    expect(result.after).toEqual({ width: 100, height: 80 });
    expect({ width: output.width, height: output.height }).toEqual({ width: 100, height: 80 });
  });

  it("refuses an input path outside the resolver asset root", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "teguma-image-ops-"));
    workspaces.push(outputRoot);

    await expect(processDesignImageTool(
      {
        source: "../outside.png",
        outputDirectory: "processed",
        operations: [{ type: "scale", width: 1 }],
      },
      { outputRoot },
    )).rejects.toThrow("Asset path escapes asset root");
  });
});
