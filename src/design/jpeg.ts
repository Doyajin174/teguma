/**
 * Deterministic baseline (SOF0) JPEG encoder for opaque RGBA raster data.
 *
 * This deliberately uses 4:4:4 sampling: design exports commonly contain
 * coloured type and thin vector edges, for which 4:2:0 noticeably smears
 * chroma. The encoder has no metadata whose value could vary between runs.
 */

export interface JpegEncodeOptions {
  /** Conventional JPEG quality scale, from 1 (smallest) through 100. Default: 85. */
  quality?: number;
}

const DEFAULT_QUALITY = 85;

// Annex K quantization tables in natural (row-major DCT) order.
const LUMINANCE_QUANTIZATION = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

const CHROMINANCE_QUANTIZATION = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
];

const ZIG_ZAG = [
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

// Standard Annex K Huffman code-length counts and symbols.
const DC_LUMINANCE_LENGTHS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_CHROMINANCE_LENGTHS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const AC_LUMINANCE_LENGTHS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
const AC_CHROMINANCE_LENGTHS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUMINANCE_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13,
  0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42,
  0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A,
  0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
  0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67,
  0x68, 0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84,
  0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3,
  0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7,
  0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1,
  0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
  0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA,
];
const AC_CHROMINANCE_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51,
  0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xA1, 0xB1,
  0xC1, 0x09, 0x23, 0x33, 0x52, 0xF0, 0x15, 0x62, 0x72, 0xD1, 0x0A, 0x16, 0x24,
  0x34, 0xE1, 0x25, 0xF1, 0x17, 0x18, 0x19, 0x1A, 0x26, 0x27, 0x28, 0x29, 0x2A,
  0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66,
  0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x82,
  0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96,
  0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA,
  0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
  0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9,
  0xDA, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF2, 0xF3, 0xF4,
  0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA,
];

interface HuffmanCode {
  code: number;
  length: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function qualityTables(quality: number): { luminance: number[]; chrominance: number[] } {
  if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("JPEG quality must be a safe integer between 1 and 100");
  }
  const scale = quality < 50 ? Math.floor(5000 / quality) : (200 - (quality * 2));
  const scaleTable = (table: number[]) => table.map((value) =>
    Math.max(1, Math.min(255, Math.floor(((value * scale) + 50) / 100))),
  );
  return { luminance: scaleTable(LUMINANCE_QUANTIZATION), chrominance: scaleTable(CHROMINANCE_QUANTIZATION) };
}

function buildHuffmanTable(lengths: number[], values: number[]): Array<HuffmanCode | undefined> {
  const table: Array<HuffmanCode | undefined> = Array.from({ length: 256 });
  let code = 0;
  let valueIndex = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let count = 0; count < lengths[length - 1]; count += 1) {
      table[values[valueIndex]] = { code, length };
      code += 1;
      valueIndex += 1;
    }
    code <<= 1;
  }
  return table;
}

const HUFFMAN = {
  dcLuminance: buildHuffmanTable(DC_LUMINANCE_LENGTHS, DC_VALUES),
  acLuminance: buildHuffmanTable(AC_LUMINANCE_LENGTHS, AC_LUMINANCE_VALUES),
  dcChrominance: buildHuffmanTable(DC_CHROMINANCE_LENGTHS, DC_VALUES),
  acChrominance: buildHuffmanTable(AC_CHROMINANCE_LENGTHS, AC_CHROMINANCE_VALUES),
};

const COSINES = Array.from({ length: 8 }, (_, frequency) =>
  Array.from({ length: 8 }, (_, sample) => Math.cos(((2 * sample) + 1) * frequency * Math.PI / 16)),
);
const DCT_SCALE = Array.from({ length: 8 }, (_, index) => (index === 0 ? 1 / Math.sqrt(2) : 1));

class BitWriter {
  private readonly bytes: number[] = [];
  private bits = 0;
  private bitCount = 0;

  writeBits(value: number, length: number): void {
    this.bits = (this.bits << length) | value;
    this.bitCount += length;
    while (this.bitCount >= 8) {
      this.bitCount -= 8;
      const byte = (this.bits >>> this.bitCount) & 0xFF;
      this.writeByte(byte);
      this.bits &= (1 << this.bitCount) - 1;
    }
  }

  private writeByte(byte: number): void {
    this.bytes.push(byte);
    if (byte === 0xFF) this.bytes.push(0x00);
  }

  finish(): Buffer {
    if (this.bitCount > 0) this.writeBits((1 << (8 - this.bitCount)) - 1, 8 - this.bitCount);
    return Buffer.from(this.bytes);
  }
}

function category(value: number): number {
  let magnitude = Math.abs(value);
  let bits = 0;
  while (magnitude > 0) {
    bits += 1;
    magnitude >>= 1;
  }
  return bits;
}

function amplitude(value: number, bits: number): number {
  return value >= 0 ? value : value + ((1 << bits) - 1);
}

function writeCode(writer: BitWriter, table: Array<HuffmanCode | undefined>, symbol: number): void {
  const code = table[symbol];
  if (!code) throw new Error(`Missing JPEG Huffman code for symbol ${symbol}`);
  writer.writeBits(code.code, code.length);
}

function writeMarker(bytes: number[], marker: number): void {
  bytes.push(0xFF, marker);
}

function writeSegment(bytes: number[], marker: number, payload: number[]): void {
  writeMarker(bytes, marker);
  const length = payload.length + 2;
  bytes.push((length >> 8) & 0xFF, length & 0xFF, ...payload);
}

function writeHeaders(width: number, height: number, luminance: number[], chrominance: number[]): Buffer {
  const bytes: number[] = [];
  writeMarker(bytes, 0xD8); // SOI
  writeSegment(bytes, 0xE0, [
    0x4A, 0x46, 0x49, 0x46, 0x00, // JFIF\0
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  writeSegment(bytes, 0xDB, [
    0x00, ...ZIG_ZAG.map((index) => luminance[index]),
    0x01, ...ZIG_ZAG.map((index) => chrominance[index]),
  ]);
  writeSegment(bytes, 0xC0, [
    0x08, (height >> 8) & 0xFF, height & 0xFF, (width >> 8) & 0xFF, width & 0xFF,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ]);
  writeSegment(bytes, 0xC4, [
    0x00, ...DC_LUMINANCE_LENGTHS, ...DC_VALUES,
    0x10, ...AC_LUMINANCE_LENGTHS, ...AC_LUMINANCE_VALUES,
    0x01, ...DC_CHROMINANCE_LENGTHS, ...DC_VALUES,
    0x11, ...AC_CHROMINANCE_LENGTHS, ...AC_CHROMINANCE_VALUES,
  ]);
  writeSegment(bytes, 0xDA, [
    0x03,
    0x01, 0x00,
    0x02, 0x11,
    0x03, 0x11,
    0x00, 0x3F, 0x00,
  ]);
  return Buffer.from(bytes);
}

function fillComponentBlock(
  rgba: Uint8Array,
  width: number,
  height: number,
  blockX: number,
  blockY: number,
  component: 0 | 1 | 2,
  output: Float64Array,
): void {
  for (let y = 0; y < 8; y += 1) {
    const sourceY = Math.min(height - 1, blockY + y);
    for (let x = 0; x < 8; x += 1) {
      const sourceX = Math.min(width - 1, blockX + x);
      const offset = ((sourceY * width) + sourceX) * 4;
      const red = rgba[offset];
      const green = rgba[offset + 1];
      const blue = rgba[offset + 2];
      const ycbcr = component === 0
        ? (0.299 * red) + (0.587 * green) + (0.114 * blue)
        : component === 1
          ? (-0.168736 * red) - (0.331264 * green) + (0.5 * blue) + 128
          : (0.5 * red) - (0.418688 * green) - (0.081312 * blue) + 128;
      // Rounding and clamping before the DCT's 128 level shift prevents a
      // floating-point conversion edge from producing an invalid sample.
      output[(y * 8) + x] = clampByte(ycbcr) - 128;
    }
  }
}

function quantizeBlock(
  input: Float64Array,
  quantization: number[],
  temporary: Float64Array,
  output: Int16Array,
): void {
  for (let y = 0; y < 8; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let x = 0; x < 8; x += 1) sum += input[(y * 8) + x] * COSINES[u][x];
      temporary[(y * 8) + u] = sum * DCT_SCALE[u] * 0.5;
    }
  }
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let y = 0; y < 8; y += 1) sum += temporary[(y * 8) + u] * COSINES[v][y];
      const quantized = Math.round((sum * DCT_SCALE[v] * 0.5) / quantization[(v * 8) + u]);
      // Baseline entropy coding uses at most 11 DC and 10 AC magnitude bits.
      output[(v * 8) + u] = Math.max(-1023, Math.min(1023, quantized));
    }
  }
}

function writeBlock(
  writer: BitWriter,
  coefficients: Int16Array,
  previousDc: number,
  dcTable: Array<HuffmanCode | undefined>,
  acTable: Array<HuffmanCode | undefined>,
): number {
  const difference = coefficients[0] - previousDc;
  const dcBits = category(difference);
  writeCode(writer, dcTable, dcBits);
  if (dcBits > 0) writer.writeBits(amplitude(difference, dcBits), dcBits);

  let zeroes = 0;
  for (let index = 1; index < 64; index += 1) {
    const value = coefficients[ZIG_ZAG[index]];
    if (value === 0) {
      zeroes += 1;
      continue;
    }
    while (zeroes >= 16) {
      writeCode(writer, acTable, 0xF0);
      zeroes -= 16;
    }
    const bits = category(value);
    writeCode(writer, acTable, (zeroes << 4) | bits);
    writer.writeBits(amplitude(value, bits), bits);
    zeroes = 0;
  }
  if (zeroes > 0) writeCode(writer, acTable, 0x00);
  return coefficients[0];
}

/**
 * Encode opaque RGBA pixels as a deterministic, JFIF baseline JPEG.
 *
 * Alpha is intentionally ignored: callers must composite it onto their chosen
 * background first, because JPEG has no alpha channel.
 */
export function encodeJpeg(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: JpegEncodeOptions = {},
): Buffer {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error("JPEG dimensions must be positive safe integers");
  }
  if (width > 65_535 || height > 65_535) {
    throw new Error("Baseline JPEG dimensions must not exceed 65535 pixels");
  }
  if (rgba.length !== width * height * 4) {
    throw new Error("JPEG RGBA input length does not match its dimensions");
  }

  const { luminance, chrominance } = qualityTables(options.quality ?? DEFAULT_QUALITY);
  const header = writeHeaders(width, height, luminance, chrominance);
  const writer = new BitWriter();
  const samples = new Float64Array(64);
  const temporary = new Float64Array(64);
  const coefficients = new Int16Array(64);
  const previousDc = [0, 0, 0];

  for (let blockY = 0; blockY < height; blockY += 8) {
    for (let blockX = 0; blockX < width; blockX += 8) {
      for (const component of [0, 1, 2] as const) {
        fillComponentBlock(rgba, width, height, blockX, blockY, component, samples);
        quantizeBlock(samples, component === 0 ? luminance : chrominance, temporary, coefficients);
        previousDc[component] = writeBlock(
          writer,
          coefficients,
          previousDc[component],
          component === 0 ? HUFFMAN.dcLuminance : HUFFMAN.dcChrominance,
          component === 0 ? HUFFMAN.acLuminance : HUFFMAN.acChrominance,
        );
      }
    }
  }

  return Buffer.concat([header, writer.finish(), Buffer.from([0xFF, 0xD9])]);
}
