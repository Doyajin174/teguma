import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  estimateTextWidth,
  exportDocument,
  inspectDocument,
  measureTextBlock,
  parseDesignDocument,
  wrapText,
} from "../src/design/index.js";

const metrics = { fontSize: 20, letterSpacing: 0 };

interface RasterTextOptions {
  fontFamily?: string;
  fontWeight?: number;
  letterSpacing?: number;
}

async function rasterInkWidth(text: string, options: RasterTextOptions = {}): Promise<number> {
  const fontFamily = options.fontFamily ?? "IBM Plex Sans KR";
  const fontWeight = options.fontWeight ?? 400;
  const letterSpacing = options.letterSpacing ?? 0;
  const document = parseDesignDocument({
    id: "text-metrics-raster",
    title: "Text metrics raster",
    canvas: { width: 2_000, height: 300 },
    pages: [{
      id: "page",
      name: "Page",
      background: "#FFFFFF",
      layers: [{
        id: "text",
        type: "text",
        frame: { x: 100, y: 50, width: 1_800, height: 200 },
        text,
        fontFamily,
        fontWeight,
        fontSize: 100,
        letterSpacing,
        color: "#000000",
      }],
    }],
  });
  // This deliberately bypasses QA: the test independently compares the
  // estimator with rasterized pixels instead of allowing QA to grade itself.
  const exported = await exportDocument(document, {
    format: "png",
    width: 2_000,
    enforceQa: false,
    ...(fontFamily === "IBM Plex Sans KR" ? {} : { onMissingFont: "ignore" as const }),
  });
  const png = PNG.sync.read(exported.files[0].data);
  let left = png.width;
  let right = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = ((y * png.width) + x) * 4;
      if (png.data[offset] < 245 || png.data[offset + 1] < 245 || png.data[offset + 2] < 245) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  if (right < left) throw new Error("Rasterized text did not produce ink");
  return right - left + 1;
}

describe("text metrics", () => {
  it("estimates Korean as wider per character than Latin, including mixed text", () => {
    const korean = estimateTextWidth("가나다라마바사", 20, 0);
    const latin = estimateTextWidth("abcdefg", 20, 0);
    const mixed = estimateTextWidth("가나다abcd", 20, 0);

    expect(korean).toBeGreaterThan(latin);
    expect(mixed).toBeGreaterThan(latin);
    expect(mixed).toBeLessThan(korean + latin);
  });

  it("tracks rasterized bundled-font ink without under-measuring", async () => {
    const samples = [
      "WWWWW",
      "iiiii",
      "가나다라마",
      "가W가W가W",
      "The quick 갈색 W fox 123!",
      "0123456789",
      ".,:;!?",
    ];
    const expectedPairs = new Map([
      ["WWWWW", { estimate: 445.5, ink: 444 }],
      ["가W가W가W", { estimate: 534.9, ink: 528 }],
      ["iiiii", { estimate: 125, ink: 111 }],
      ["가나다라마", { estimate: 446, ink: 440 }],
      ["0123456789", { estimate: 600, ink: 588 }],
    ]);

    for (const text of samples) {
      const ink = await rasterInkWidth(text);
      const estimate = estimateTextWidth(text, 100, 0, {
        fontFamily: "IBM Plex Sans KR",
        fontWeight: 400,
      });
      expect(estimate).toBeGreaterThanOrEqual(ink);
      expect(estimate - ink).toBeLessThanOrEqual(16);
      const expected = expectedPairs.get(text);
      if (expected !== undefined) {
        expect(estimate).toBe(expected.estimate);
        expect(ink).toBe(expected.ink);
      }
    }
  });

  it("uses a conservative fallback only for unregistered families", () => {
    const registered = estimateTextWidth("WWWWW", 100, 0, {
      fontFamily: "IBM Plex Sans KR",
      fontWeight: 600,
    });
    const fallback = estimateTextWidth("WWWWW", 100, 0, { fontFamily: "Unregistered Sans" });

    expect(fallback).toBeGreaterThanOrEqual(registered);
  });

  it("uses the widest bundled weight when legacy callers omit metrics options", () => {
    const legacy = estimateTextWidth("WWWWW", 100, 0);
    const semibold = estimateTextWidth("WWWWW", 100, 0, {
      fontFamily: "IBM Plex Sans KR",
      fontWeight: 600,
    });

    expect(legacy).toBeGreaterThanOrEqual(semibold);
  });

  it("does not wildly over-measure emoji or combining text", async () => {
    const emoji = estimateTextWidth("🙂🙂🙂", 100, 0, { fontFamily: "IBM Plex Sans KR" });
    const combining = estimateTextWidth("e\u0301e\u0301e\u0301", 100, 0, {
      fontFamily: "IBM Plex Sans KR",
    });
    const emojiInk = await rasterInkWidth("🙂🙂🙂");
    const combiningInk = await rasterInkWidth("e\u0301e\u0301e\u0301");

    expect(emoji).toBeGreaterThanOrEqual(emojiInk);
    expect(emoji - emojiInk).toBeLessThanOrEqual(16);
    expect(combining).toBeLessThanOrEqual(combiningInk * 1.56);
    expect(combining).toBeGreaterThanOrEqual(combiningInk);
  });

  it("does not under-measure unregistered-family ink", async () => {
    const text = "WWWWW";
    const fontFamily = "Unregistered Sans";
    const estimate = estimateTextWidth(text, 100, 0, { fontFamily, fontWeight: 400 });
    const ink = await rasterInkWidth(text, { fontFamily, fontWeight: 400 });

    expect(estimate).toBeGreaterThanOrEqual(ink);
  });

  it("keeps an extreme legal negative tracking run at least one glyph wide", async () => {
    const text = "WWWWW";
    const letterSpacing = -120;
    const estimate = estimateTextWidth(text, 100, letterSpacing, {
      fontFamily: "IBM Plex Sans KR",
      fontWeight: 400,
    });
    const ink = await rasterInkWidth(text, { letterSpacing });

    expect(estimate).toBeGreaterThanOrEqual(ink);
  });

  it("respects hard newlines", () => {
    expect(wrapText("first\nsecond", { ...metrics, maxWidth: 200 }).lines).toEqual(["first", "second"]);
  });

  it("wraps Latin at spaces without exceeding the maximum width", () => {
    const result = wrapText("alpha beta gamma", { ...metrics, maxWidth: 70 });

    expect(result.lines).toEqual(["alpha", "beta", "gamma"]);
    expect(result.lines.every((line) => estimateTextWidth(line, 20, 0) <= 70)).toBe(true);
  });

  it("character-splits an oversized unbreakable token", () => {
    const result = wrapText("abcdefghij", { ...metrics, maxWidth: 45 });

    expect(result.lines.join("")).toBe("abcdefghij");
    expect(result.lines.every((line) => estimateTextWidth(line, 20, 0) <= 45)).toBe(true);
  });

  it("splits a long unbreakable token in linear time", () => {
    const token = "W".repeat(5_000);
    const started = performance.now();
    const result = wrapText(token, {
      fontSize: 20,
      letterSpacing: 0,
      maxWidth: 45,
      fontFamily: "IBM Plex Sans KR",
    });

    expect(result.lines.join("")).toBe(token);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("keeps metric-dependent wrapping deterministic", () => {
    const options = {
      fontSize: 32,
      letterSpacing: 0.5,
      maxWidth: 180,
      fontFamily: "IBM Plex Sans KR",
      fontWeight: 600,
    };
    const text = "가W가W가W deterministic wrapping";

    expect(wrapText(text, options)).toEqual(wrapText(text, options));
    expect(estimateTextWidth(text, 32, 0.5, options)).toBe(estimateTextWidth(text, 32, 0.5, options));
  });

  it("truncates maxLines with an ellipsis that fits", () => {
    const result = wrapText("alpha beta gamma", { ...metrics, maxWidth: 70, maxLines: 2 });

    expect(result).toMatchObject({ lines: ["alpha", "beta…"], overflowed: true });
    expect(estimateTextWidth(result.lines[1], 20, 0)).toBeLessThanOrEqual(70);
  });

  it("rejects non-positive widths", () => {
    expect(() => wrapText("text", { ...metrics, maxWidth: 0 })).toThrow(/maxWidth must be greater than 0/);
    expect(() => wrapText("text", { ...metrics, maxWidth: -1 })).toThrow(/maxWidth must be greater than 0/);
  });

  it("calculates exact block height from its line count", () => {
    const result = measureTextBlock("one\ntwo\nthree", {
      fontSize: 20,
      lineHeight: 1.25,
      letterSpacing: 0,
    });

    expect(result.height).toBe(75);
    expect(result.lines).toHaveLength(3);
  });
});

describe("text overflow QA", () => {
  it("rejects an unregistered family whose fallback ink exceeds its narrow frame", async () => {
    const document = parseDesignDocument({
      id: "unregistered-font-overflow",
      title: "Unregistered font overflow",
      canvas: { width: 500, height: 300 },
      pages: [{
        id: "page",
        name: "Page",
        background: "#FFFFFF",
        layers: [{
          id: "external",
          type: "text",
          frame: { x: 0, y: 0, width: 99, height: 130 },
          text: "W",
          fontFamily: "Unregistered Sans",
          fontSize: 100,
          color: "#000000",
        }],
      }],
    });

    expect(inspectDocument(document).checks.find((check) => check.name === "text-fits-frame-width"))
      .toMatchObject({ pass: false, detail: "page/external" });
    await expect(exportDocument(document, { format: "png", onMissingFont: "ignore" }))
      .rejects.toThrow(/Design QA failed/);
  });

  it("rejects extreme negative tracking instead of clamping its width to zero", () => {
    const document = parseDesignDocument({
      id: "negative-tracking-overflow",
      title: "Negative tracking overflow",
      canvas: { width: 500, height: 300 },
      pages: [{
        id: "page",
        name: "Page",
        background: "#FFFFFF",
        layers: [{
          id: "tracked",
          type: "text",
          frame: { x: 0, y: 0, width: 1, height: 130 },
          text: "WWWWW",
          fontFamily: "IBM Plex Sans KR",
          fontSize: 100,
          letterSpacing: -120,
          color: "#000000",
        }],
      }],
    });

    expect(inspectDocument(document).checks.find((check) => check.name === "text-fits-frame-width"))
      .toMatchObject({ pass: false, detail: "page/tracked" });
  });

  it("fails the reviewed W-only overflow that heuristic Latin averages accepted", () => {
    const document = parseDesignDocument({
      id: "wide-w-regression",
      title: "Wide W regression",
      canvas: { width: 500, height: 300 },
      pages: [{
        id: "page",
        name: "Page",
        background: "#FFFFFF",
        layers: [{
          id: "wide-w",
          type: "text",
          frame: { x: 0, y: 0, width: 261.3, height: 130 },
          text: "WWWWW",
          fontFamily: "IBM Plex Sans KR",
          fontSize: 100,
          color: "#000000",
        }],
      }],
    });

    expect(inspectDocument(document).checks.find((check) => check.name === "text-fits-frame-width"))
      .toMatchObject({ pass: false, detail: "page/wide-w" });
  });

  it("fails clearly overflowing text and passes comfortable text", () => {
    const document = parseDesignDocument({
      id: "text-qa",
      title: "text QA",
      canvas: { width: 500, height: 500 },
      pages: [{
        id: "page",
        name: "Page",
        layers: [
          {
            id: "overflowing",
            type: "text",
            frame: { x: 0, y: 0, width: 100, height: 25 },
            text: "This headline is far too long\nfor its frame",
            fontFamily: "sans-serif",
            fontSize: 30,
            color: "#000000",
          },
          {
            id: "comfortable",
            type: "text",
            frame: { x: 0, y: 100, width: 300, height: 80 },
            text: "Fits",
            fontFamily: "sans-serif",
            fontSize: 20,
            color: "#000000",
          },
        ],
      }],
    });
    const report = inspectDocument(document);

    expect(report.checks.find((check) => check.name === "text-fits-frame-width")).toMatchObject({
      pass: false,
      detail: "page/overflowing",
    });
    expect(report.checks.find((check) => check.name === "text-fits-frame-height")).toMatchObject({
      pass: false,
      detail: "page/overflowing",
    });

    const comfortable = parseDesignDocument({
      id: "comfortable-text-qa",
      title: "comfortable text QA",
      canvas: { width: 500, height: 500 },
      pages: [{
        id: "page",
        name: "Page",
        layers: [{
          id: "comfortable",
          type: "text",
          frame: { x: 0, y: 0, width: 300, height: 80 },
          text: "Fits",
          fontFamily: "sans-serif",
          fontSize: 20,
          color: "#000000",
        }],
      }],
    });
    expect(inspectDocument(comfortable).passed).toBe(true);
  });
});
