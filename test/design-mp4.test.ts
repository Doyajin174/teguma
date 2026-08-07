import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_MP4_FRAME_DURATION,
  encodeMp4,
  exportDocument,
  parseDesignDocument,
} from "../src/design/index.js";

/**
 * MP4 export is only meaningful if a real decoder plays it, so these tests use
 * ffprobe/ffmpeg as an independent oracle rather than trusting our own encoder.
 * Structural assertions alone cannot distinguish a valid container wrapping
 * garbage samples from a correct file.
 */

const FFPROBE = "/opt/homebrew/bin/ffprobe";
const FFMPEG = "/opt/homebrew/bin/ffmpeg";

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "teguma-mp4-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function solidFrame(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * 3] = rgb[0];
    data[(pixel * 3) + 1] = rgb[1];
    data[(pixel * 3) + 2] = rgb[2];
  }
  return data;
}

function probe(file: string): Record<string, string> {
  const output = execFileSync(
    FFPROBE,
    [
      "-v", "error",
      "-count_frames",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,nb_read_frames",
      "-show_entries", "format=format_name,duration",
      "-of", "default=noprint_wrappers=1",
      file,
    ],
    { encoding: "utf8" },
  );

  return Object.fromEntries(
    output.trim().split("\n").map((line) => {
      const [key, ...rest] = line.split("=");
      return [key, rest.join("=")];
    }),
  );
}

/** Sum every top-level box size and confirm it accounts for the whole file. */
function topLevelBoxes(data: Buffer): Array<{ type: string; size: number }> {
  const boxes: Array<{ type: string; size: number }> = [];
  let offset = 0;
  while (offset + 8 <= data.length) {
    const size = data.readUInt32BE(offset);
    const type = data.toString("latin1", offset + 4, offset + 8);
    if (size < 8) throw new Error(`Invalid box size ${size} for ${type}`);
    boxes.push({ type, size });
    offset += size;
  }
  expect(offset).toBe(data.length);
  return boxes;
}

describe("Motion JPEG MP4 export", () => {
  it("writes a container whose boxes exactly span the file", () => {
    const result = encodeMp4([{ rgb: solidFrame(16, 16, [200, 30, 40]) }], 16, 16);
    const boxes = topLevelBoxes(result.data);

    expect(boxes.map((box) => box.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(result.data.toString("latin1", 8, 12)).toBe("isom");
    expect(result.frames).toBe(1);
    expect(result.durationMs).toBe(DEFAULT_MP4_FRAME_DURATION);
  });

  it("is decodable by ffprobe with the expected stream properties", async () => {
    const frames = [
      { rgb: solidFrame(64, 40, [220, 40, 40]), duration: 100 },
      { rgb: solidFrame(64, 40, [40, 200, 90]), duration: 100 },
      { rgb: solidFrame(64, 40, [30, 60, 220]), duration: 100 },
    ];
    const result = encodeMp4(frames, 64, 40);
    const file = path.join(workspace, "three-frames.mp4");
    await writeFile(file, result.data);

    const info = probe(file);
    expect(info.codec_name).toBe("mjpeg");
    expect(info.width).toBe("64");
    expect(info.height).toBe("40");
    expect(info.nb_read_frames).toBe("3");
    expect(Number(info.duration)).toBeCloseTo(0.3, 2);
  });

  it("stores frame pixels faithfully enough to decode back", async () => {
    const width = 32;
    const height = 32;
    const source = solidFrame(width, height, [180, 60, 200]);
    const result = encodeMp4([{ rgb: source }], width, height, { quality: 95 });
    const file = path.join(workspace, "fidelity.mp4");
    await writeFile(file, result.data);

    const framePath = path.join(workspace, "frame1.png");
    execFileSync(FFMPEG, ["-v", "error", "-y", "-i", file, "-frames:v", "1", framePath]);
    const decoded = PNG.sync.read(await readFile(framePath));

    expect({ width: decoded.width, height: decoded.height }).toEqual({ width, height });

    let total = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        total += Math.abs(decoded.data[(pixel * 4) + channel] - source[(pixel * 3) + channel]);
      }
    }
    // A wrong zig-zag order or DC predictor reset would produce a large error
    // even though the container still parses.
    expect(total / (width * height * 3)).toBeLessThan(3);
  });

  it("produces byte-identical output for identical input", () => {
    const frames = [{ rgb: solidFrame(24, 24, [15, 120, 90]) }];
    const first = encodeMp4(frames, 24, 24);
    const second = encodeMp4(frames, 24, 24);

    expect(first.data.equals(second.data)).toBe(true);
  });

  it("handles a 1x1 canvas and odd dimensions", async () => {
    const tiny = encodeMp4([{ rgb: solidFrame(1, 1, [0, 0, 0]) }], 1, 1);
    const tinyPath = path.join(workspace, "tiny.mp4");
    await writeFile(tinyPath, tiny.data);
    expect(probe(tinyPath).codec_name).toBe("mjpeg");

    // Motion JPEG has no even-dimension requirement, unlike H.264 4:2:0.
    const odd = encodeMp4([{ rgb: solidFrame(33, 17, [90, 90, 90]) }], 33, 17);
    const oddPath = path.join(workspace, "odd.mp4");
    await writeFile(oddPath, odd.data);
    const info = probe(oddPath);
    expect({ width: info.width, height: info.height }).toEqual({ width: "33", height: "17" });
  });

  it("rejects invalid frame input", () => {
    expect(() => encodeMp4([], 16, 16)).toThrow(/at least one frame/);
    expect(() => encodeMp4([{ rgb: solidFrame(16, 16, [0, 0, 0]) }], 16, 15))
      .toThrow(/expected/);
    expect(() => encodeMp4([{ rgb: solidFrame(16, 16, [0, 0, 0]), duration: 0 }], 16, 16))
      .toThrow(/duration must be positive/);
  });

  it("exports a multi-page document as one playable file", async () => {
    const page = (id: string, background: string) => ({
      id,
      name: id,
      background,
      layers: [
        {
          id: "band",
          type: "rect" as const,
          frame: { x: 20, y: 60, width: 200, height: 40 },
          fill: "#11191D",
        },
      ],
    });

    const document = parseDesignDocument({
      id: "reel",
      title: "reel",
      canvas: { width: 240, height: 160 },
      pages: [page("p1", "#FFFFFF"), page("p2", "#F1F3F2")],
    });

    const result = await exportDocument(document, { format: "mp4", width: 240 });
    expect(result.files).toHaveLength(1);

    const file = path.join(workspace, "reel.mp4");
    await writeFile(file, result.files[0].data);
    const info = probe(file);

    expect(info.codec_name).toBe("mjpeg");
    expect(info.nb_read_frames).toBe("2");
    expect(info.width).toBe("240");
  });

  it("enforces the aggregate frame-pixel cap", async () => {
    const document = parseDesignDocument({
      id: "big",
      title: "big",
      canvas: { width: 4000, height: 4000 },
      pages: Array.from({ length: 3 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `p${index + 1}`,
        background: "#FFFFFF",
        layers: [],
      })),
    });

    await expect(exportDocument(document, { format: "mp4", width: 4000 }))
      .rejects.toThrow(/total frame pixels/);
  });
});
