import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  encodeGif,
  exportDocument,
  parseDesignDocument,
  quantizeGifPalette,
  type GifFrame,
} from "../src/design/index.js";

interface ParsedGif {
  width: number;
  height: number;
  frames: number;
  delays: number[];
  globalPaletteColors: number;
}

function rgb(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 3;
      const color = pixel(x, y);
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return pixels;
}

function skipSubBlocks(gif: Buffer, offset: number): number {
  let cursor = offset;
  while (true) {
    const length = gif[cursor];
    cursor += 1;
    if (length === 0) return cursor;
    cursor += length;
    if (cursor > gif.length) throw new Error("GIF sub-block exceeds the file");
  }
}

/** Parse GIF block boundaries structurally without using encoder implementation state. */
function parseGif(gif: Buffer): ParsedGif {
  expect(gif.subarray(0, 6).toString("ascii")).toBe("GIF89a");
  const width = gif.readUInt16LE(6);
  const height = gif.readUInt16LE(8);
  const packed = gif[10];
  expect(packed & 0x80).toBe(0x80);
  const globalPaletteColors = 1 << ((packed & 0x07) + 1);
  let offset = 13 + (globalPaletteColors * 3);
  let frames = 0;
  const delays: number[] = [];

  while (offset < gif.length) {
    const marker = gif[offset];
    offset += 1;
    if (marker === 0x3B) {
      expect(offset).toBe(gif.length);
      return { width, height, frames, delays, globalPaletteColors };
    }
    if (marker === 0x21) {
      const label = gif[offset];
      offset += 1;
      if (label === 0xF9) {
        expect(gif[offset]).toBe(4);
        delays.push(gif.readUInt16LE(offset + 2));
        offset += 5;
        expect(gif[offset]).toBe(0);
        offset += 1;
      } else {
        const applicationHeaderLength = gif[offset];
        offset += 1 + applicationHeaderLength;
        offset = skipSubBlocks(gif, offset);
      }
      continue;
    }
    if (marker === 0x2C) {
      expect(offset + 9).toBeLessThanOrEqual(gif.length);
      const localPacked = gif[offset + 8];
      offset += 9;
      if (localPacked & 0x80) offset += (1 << ((localPacked & 0x07) + 1)) * 3;
      const minimumCodeSize = gif[offset];
      expect(minimumCodeSize).toBeGreaterThanOrEqual(2);
      offset += 1;
      offset = skipSubBlocks(gif, offset);
      frames += 1;
      continue;
    }
    throw new Error(`Unexpected GIF block marker 0x${marker.toString(16)}`);
  }
  throw new Error("GIF has no trailer");
}

async function decodeWithPillow(
  gif: Buffer,
  frame = 0,
): Promise<{ info: string; png: PNG }> {
  const directory = await mkdtemp(path.join(tmpdir(), "teguma-gif-"));
  const input = path.join(directory, "animation.gif");
  const output = path.join(directory, "frame.png");
  await writeFile(input, gif);
  try {
    const info = execFileSync(
      "python3",
      [
        "-c",
        [
          "from PIL import Image",
          "import sys",
          "image = Image.open(sys.argv[1])",
          "delays = []",
          "for index in range(image.n_frames):",
          "    image.seek(index)",
          "    delays.append(str(image.info.get('duration', 0) // 10))",
          "print(f'format={image.format} size={image.width}x{image.height} frames={image.n_frames} loop={image.info.get(\"loop\", \"none\")} delays={\",\".join(delays)}')",
          "image.seek(int(sys.argv[3]))",
          "image.convert('RGB').save(sys.argv[2])",
        ].join("\n"),
        input,
        output,
        String(frame),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    return { info, png: PNG.sync.read(await readFile(output)) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function channelMae(source: Uint8Array, decoded: PNG): [number, number, number] {
  const totals = [0, 0, 0];
  for (let pixel = 0; pixel < source.length / 3; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      totals[channel] += Math.abs(source[(pixel * 3) + channel] - decoded.data[(pixel * 4) + channel]);
    }
  }
  return totals.map((total) => total / (source.length / 3)) as [number, number, number];
}

function photoLikeRgb(width: number, height: number): Buffer {
  return rgb(width, height, (x, y) => {
    const noise = ((x * 73) + (y * 151) + (x * y * 17)) % 31;
    return [
      (x * 255 / (width - 1)) + noise,
      (y * 255 / (height - 1)) + ((noise * 5) % 29),
      ((x + y) * 255 / (width + height - 2)) + ((noise * 11) % 23),
    ].map(Math.round) as [number, number, number];
  });
}

function animationDocument() {
  return parseDesignDocument({
    id: "gif-pages",
    title: "GIF pages",
    canvas: { width: 32, height: 20 },
    pages: [
      { id: "one", name: "one", background: "#0F6B4A", layers: [] },
      { id: "two", name: "two", background: "#F1CB4C", layers: [] },
      { id: "three", name: "three", background: "#D94736", layers: [] },
    ],
  });
}

describe("GIF89a export", () => {
  it("writes a deterministic, structurally valid animation from document pages", async () => {
    const document = animationDocument();
    const options = { format: "gif" as const, width: 64, gifFrameDelay: [5, 10, 15] };
    const [first, second] = await Promise.all([
      exportDocument(document, options),
      exportDocument(document, options),
    ]);
    const gif = first.files[0].data;
    const structure = parseGif(gif);

    expect(first.files).toHaveLength(1);
    expect(first.files[0].pageId).toBe(document.id);
    expect(first.files[0].data.equals(second.files[0].data)).toBe(true);
    expect({ width: structure.width, height: structure.height, frames: structure.frames }).toEqual({
      width: 64,
      height: 40,
      frames: 3,
    });
    expect(structure.delays).toEqual([5, 10, 15]);
    expect(gif.includes(Buffer.from("NETSCAPE2.0", "ascii"))).toBe(true);
    expect(gif[gif.length - 1]).toBe(0x3B);

    const decoded = await decodeWithPillow(gif);
    expect(decoded.info).toBe("format=GIF size=64x40 frames=3 loop=0 delays=5,10,15");
  });

  it("keeps a flat two-colour design lossless and omits looping for one page", async () => {
    const source = rgb(25, 17, (x) => x < 12 ? [15, 107, 74] : [241, 203, 76]);
    const gif = encodeGif([{ rgb: source }], 25, 17);
    const decoded = await decodeWithPillow(gif);

    expect(parseGif(gif)).toMatchObject({ width: 25, height: 17, frames: 1, delays: [10] });
    expect(gif.includes(Buffer.from("NETSCAPE2.0", "ascii"))).toBe(false);
    expect(decoded.info).toBe("format=GIF size=25x17 frames=1 loop=none delays=10");
    expect(channelMae(source, decoded.png)).toEqual([0, 0, 0]);
  });

  it("keeps a multi-colour brand raster lossless when all colours fit the palette", async () => {
    const brand = [
      [15, 107, 74], [241, 203, 76], [217, 71, 54], [17, 25, 29], [242, 244, 243], [255, 255, 255],
    ] as const;
    const source = rgb(36, 24, (x, y) => brand[(x + (y * 3)) % brand.length]);
    const decoded = await decodeWithPillow(encodeGif([{ rgb: source }], 36, 24));

    expect(channelMae(source, decoded.png)).toEqual([0, 0, 0]);
  });

  it("quantizes a photographic raster with bounded error and makes dithering observable", async () => {
    const source = photoLikeRgb(160, 100);
    const plain = encodeGif([{ rgb: source }], 160, 100);
    const dithered = encodeGif([{ rgb: source }], 160, 100, { dither: true });
    const decoded = await decodeWithPillow(plain);
    const mae = channelMae(source, decoded.png);

    expect(decoded.info).toBe("format=GIF size=160x100 frames=1 loop=none delays=10");
    expect(mae[0]).toBeLessThan(25);
    expect(mae[1]).toBeLessThan(25);
    expect(mae[2]).toBeLessThan(25);
    expect(plain.equals(dithered)).toBe(false);
    expect((await decodeWithPillow(dithered)).png).toMatchObject({ width: 160, height: 100 });
  });

  it("handles 1×1, exactly 256 colours, and more than 256 colours", async () => {
    const one = encodeGif([{ rgb: Buffer.from([17, 34, 51]) }], 1, 1);
    expect((await decodeWithPillow(one)).info).toBe("format=GIF size=1x1 frames=1 loop=none delays=10");

    const exactly256 = rgb(16, 16, (x, y) => [((y * 16) + x), 255 - ((y * 16) + x), (x * 17) % 256]);
    const exactFrames: GifFrame[] = [{ rgb: exactly256 }];
    const exactGif = encodeGif(exactFrames, 16, 16);
    expect(quantizeGifPalette(exactFrames, 16, 16)).toHaveLength(256);
    expect(channelMae(exactly256, (await decodeWithPillow(exactGif)).png)).toEqual([0, 0, 0]);

    const many = rgb(40, 20, (x, y) => [((x * 29) + (y * 7)) % 256, ((x * 11) + (y * 37)) % 256, ((x * 43) + (y * 13)) % 256]);
    const manyFrames: GifFrame[] = [{ rgb: many }];
    const manyDecoded = await decodeWithPillow(encodeGif(manyFrames, 40, 20));
    const manyMae = channelMae(many, manyDecoded.png);
    expect(quantizeGifPalette(manyFrames, 40, 20).length).toBeLessThanOrEqual(256);
    expect(manyMae[0]).toBeLessThan(30);
    expect(manyMae[1]).toBeLessThan(30);
    expect(manyMae[2]).toBeLessThan(30);
  });

  it("bounds aggregate GIF frame pixels before rasterization", async () => {
    const document = parseDesignDocument({
      id: "gif-limit",
      title: "GIF limit",
      canvas: { width: 2000, height: 2000 },
      pages: Array.from({ length: 10 }, (_, index) => ({
        id: `page-${index}`,
        name: `page-${index}`,
        background: "#FFFFFF",
        layers: [],
      })),
    });
    await expect(exportDocument(document, { format: "gif" })).rejects.toThrow(/32000000 total frame pixels/);
  });
});
