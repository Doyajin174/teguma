/**
 * Deterministic Motion JPEG in an ISO base media file format (MP4) container.
 *
 * Why Motion JPEG rather than H.264: this repository writes every container and
 * codec itself with no dependencies, and a conforming H.264 encoder needs the
 * 4x4 integer transform, CAVLC, macroblock prediction, and SPS/PPS/avcC
 * signalling — a large surface with many ways to emit bytes that look valid but
 * do not decode. Motion JPEG reuses the JPEG encoder already verified in this
 * repository, so every frame is independently decodable and the remaining work
 * is container correctness, which is directly testable.
 *
 * Tradeoffs, stated plainly: every frame is a full intra frame, so files are
 * far larger than H.264 at the same quality, and while ffmpeg, QuickTime, and
 * VLC play these files, most browsers do not play Motion JPEG in MP4 natively.
 * Use GIF for short loops that must render inline, and MP4 for handoff to a
 * video pipeline.
 *
 * Determinism: the container carries no wall-clock time. Creation and
 * modification fields are fixed constants so identical input yields identical
 * bytes.
 */

import { encodeJpeg } from "./jpeg.js";

/** Frames per second used when a caller does not specify a frame duration. */
export const DEFAULT_MP4_FRAME_DURATION = 100;

/** Media timescale in ticks per second. 1000 keeps millisecond durations exact. */
const TIMESCALE = 1_000;

/**
 * Fixed creation/modification timestamp. ISO BMFF counts seconds from
 * 1904-01-01, and embedding the real clock would break byte determinism.
 */
const FIXED_MP4_TIME = 0;

export interface Mp4Frame {
  /** Opaque RGB pixels in row-major order. */
  rgb: Uint8Array;
  /** Duration in milliseconds. Defaults to DEFAULT_MP4_FRAME_DURATION. */
  duration?: number;
}

export interface Mp4EncodeOptions {
  /** Default frame duration in milliseconds. */
  duration?: number;
  /** JPEG quality for each frame, 1-100. */
  quality?: number;
}

function u32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function u16(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

/** Wrap payload in a box: 4-byte big-endian size, 4-byte type, then payload. */
function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, "latin1"), body]);
}

/** A full box carries a version byte and 3 flag bytes before its payload. */
function fullBox(type: string, version: number, flags: number, ...payload: Buffer[]): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt8(version, 0);
  header.writeUIntBE(flags, 1, 3);
  return box(type, header, ...payload);
}

/** 16.16 fixed point, used by mvhd/tkhd rate and volume fields. */
function fixed16(value: number): Buffer {
  return u32(Math.round(value * 65_536));
}

/** Unity 3x3 transformation matrix in 16.16/2.30 fixed point. */
function unityMatrix(): Buffer {
  return Buffer.concat([
    u32(0x0001_0000), u32(0), u32(0),
    u32(0), u32(0x0001_0000), u32(0),
    u32(0), u32(0), u32(0x4000_0000),
  ]);
}

function buildFtyp(): Buffer {
  // `isom` with `mp41` and `avc1` compatible brands is the widely accepted
  // baseline for a plain MP4 track; `qt  ` is not used because the file follows
  // ISO BMFF structure rather than classic QuickTime conventions.
  return box(
    "ftyp",
    Buffer.from("isom", "latin1"),
    u32(0x0000_0200),
    Buffer.from("isom", "latin1"),
    Buffer.from("mp41", "latin1"),
  );
}

function buildStsd(width: number, height: number): Buffer {
  // Visual sample entry: 6 reserved bytes, data reference index, 16 bytes of
  // pre-defined/reserved, dimensions, 72dpi resolutions, frame count, a
  // 32-byte fixed compressor name, depth, and a -1 colour table index.
  const compressorName = Buffer.alloc(32);
  compressorName.writeUInt8(13, 0);
  compressorName.write("Motion JPEG", 1, "latin1");

  const sampleEntry = box(
    "jpeg",
    Buffer.alloc(6),
    u16(1),
    Buffer.alloc(16),
    u16(width),
    u16(height),
    u32(0x0048_0000),
    u32(0x0048_0000),
    u32(0),
    u16(1),
    compressorName,
    u16(24),
    Buffer.from([0xff, 0xff]),
  );

  return fullBox("stsd", 0, 0, u32(1), sampleEntry);
}

/** Run-length encode per-sample durations into stts entries. */
function buildStts(durations: number[]): Buffer {
  const entries: Array<{ count: number; delta: number }> = [];
  for (const duration of durations) {
    const last = entries.at(-1);
    if (last && last.delta === duration) last.count += 1;
    else entries.push({ count: 1, delta: duration });
  }

  return fullBox(
    "stts",
    0,
    0,
    u32(entries.length),
    ...entries.flatMap((entry) => [u32(entry.count), u32(entry.delta)]),
  );
}

export interface Mp4EncodeResult {
  data: Buffer;
  width: number;
  height: number;
  frames: number;
  /** Total duration in milliseconds. */
  durationMs: number;
}

/**
 * Encode frames into a Motion JPEG MP4.
 *
 * Frames are JPEG-compressed first so their exact byte lengths are known, which
 * the sample size table requires, and so the media data offset can be computed
 * before the header is assembled.
 */
export function encodeMp4(
  frames: Mp4Frame[],
  width: number,
  height: number,
  options: Mp4EncodeOptions = {},
): Mp4EncodeResult {
  if (frames.length === 0) throw new Error("MP4 export requires at least one frame");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("MP4 dimensions must be positive integers");
  }
  // A visual sample entry stores dimensions as unsigned 16-bit values.
  if (width > 65_535 || height > 65_535) {
    throw new Error("MP4 dimensions must not exceed 65535 pixels");
  }

  const defaultDuration = options.duration ?? DEFAULT_MP4_FRAME_DURATION;
  const durations = frames.map((frame, index) => {
    const duration = frame.duration ?? defaultDuration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`MP4 frame ${index + 1} duration must be positive`);
    }
    return Math.max(1, Math.round(duration));
  });

  const expected = width * height * 3;
  const samples = frames.map((frame, index) => {
    if (frame.rgb.length !== expected) {
      throw new Error(
        `MP4 frame ${index + 1} has ${frame.rgb.length} bytes, expected ${expected}`,
      );
    }
    // encodeJpeg takes opaque RGBA, so widen the packed RGB frame first.
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      rgba[pixel * 4] = frame.rgb[pixel * 3];
      rgba[(pixel * 4) + 1] = frame.rgb[(pixel * 3) + 1];
      rgba[(pixel * 4) + 2] = frame.rgb[(pixel * 3) + 2];
      rgba[(pixel * 4) + 3] = 255;
    }
    return encodeJpeg(rgba, width, height, {
      ...(options.quality === undefined ? {} : { quality: options.quality }),
    });
  });

  const durationMs = durations.reduce((total, duration) => total + duration, 0);
  const mediaDuration = Math.round(durationMs * TIMESCALE / 1_000);
  const mdat = box("mdat", ...samples);

  const stbl = box(
    "stbl",
    buildStsd(width, height),
    buildStts(durations),
    // Every JPEG frame is independently decodable, so all samples are sync
    // samples and every one is listed in stss.
    fullBox("stss", 0, 0, u32(samples.length), ...samples.map((_, index) => u32(index + 1))),
    // One chunk holding every sample keeps the offset table to a single entry.
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    fullBox("stsz", 0, 0, u32(0), u32(samples.length), ...samples.map((sample) => u32(sample.length))),
    fullBox("stco", 0, 0, u32(1), u32(0)),
  );

  const minf = box(
    "minf",
    box("vmhd", Buffer.from([0, 0, 0, 1]), u16(0), u16(0), u16(0), u16(0)),
    box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
    stbl,
  );

  const mdia = box(
    "mdia",
    fullBox(
      "mdhd",
      0,
      0,
      u32(FIXED_MP4_TIME),
      u32(FIXED_MP4_TIME),
      u32(TIMESCALE),
      u32(mediaDuration),
      // 0x55c4 is the packed ISO-639-2/T code for "und".
      u16(0x55c4),
      u16(0),
    ),
    fullBox(
      "hdlr",
      0,
      0,
      u32(0),
      Buffer.from("vide", "latin1"),
      Buffer.alloc(12),
      Buffer.from("VideoHandler\0", "latin1"),
    ),
    minf,
  );

  const trak = box(
    "trak",
    fullBox(
      "tkhd",
      0,
      // Flags 0x000007: track enabled, in movie, in preview.
      0x000007,
      u32(FIXED_MP4_TIME),
      u32(FIXED_MP4_TIME),
      u32(1),
      u32(mediaDuration),
      Buffer.alloc(8),
      u16(0),
      u16(0),
      fixed16(0),
      u16(0),
      unityMatrix(),
      fixed16(width),
      fixed16(height),
    ),
    mdia,
  );

  const moov = box(
    "moov",
    fullBox(
      "mvhd",
      0,
      0,
      u32(FIXED_MP4_TIME),
      u32(FIXED_MP4_TIME),
      u32(TIMESCALE),
      u32(mediaDuration),
      fixed16(1),
      u16(0x0100),
      Buffer.alloc(10),
      unityMatrix(),
      Buffer.alloc(24),
      u32(2),
    ),
    trak,
  );

  const ftyp = buildFtyp();
  // stco holds absolute file offsets, so the first sample's position is only
  // known once the preceding boxes exist. moov has a fixed size regardless of
  // the offset value, so patching it in place keeps every other box valid.
  const chunkOffset = ftyp.length + moov.length + 8;
  const stcoIndex = moov.indexOf(Buffer.from("stco", "latin1"));
  if (stcoIndex < 0) throw new Error("Failed to locate stco while assembling MP4");
  moov.writeUInt32BE(chunkOffset, stcoIndex + 12);

  return {
    data: Buffer.concat([ftyp, moov, mdat]),
    width,
    height,
    frames: samples.length,
    durationMs,
  };
}
