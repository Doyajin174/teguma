import { describe, expect, it } from "vitest";
import {
  DesignDocumentSchema,
  SIZE_PRESETS,
  applyBrandKit,
  contrastRatio,
  countLayers,
  findBrandViolations,
  findSizePreset,
  inspectDocument,
  listSizePresets,
  nearestBrandColor,
  parseDesignDocument,
  requireSizePreset,
  resizeDocument,
  resolveResize,
  renderDocumentToSvg,
  renderPageToSvg,
  type BrandKit,
  type DesignDocument,
} from "../src/design/index.js";

const brandKit: BrandKit = {
  id: "sevasa",
  name: "SEVASA",
  palette: [
    { id: "ink", name: "Ink", value: "#11191D" },
    { id: "paper", name: "Paper", value: "#FFFFFF" },
    { id: "green", name: "Signal Green", value: "#00A653" },
  ],
  fonts: [{ family: "IBM Plex Sans KR", weights: [400, 600] }],
  logos: [{ id: "primary", source: "assets/logo.png" }],
};

function baseDocument(overrides: Partial<DesignDocument> = {}): DesignDocument {
  return parseDesignDocument({
    id: "promo",
    title: "충전비 절감 안내",
    canvas: { width: 1080, height: 1080, safeMargin: 48 },
    pages: [
      {
        id: "cover",
        name: "표지",
        background: "#FFFFFF",
        layers: [
          {
            id: "band",
            type: "rect",
            frame: { x: 48, y: 650, width: 984, height: 186 },
            fill: "#11191D",
          },
          {
            id: "hook",
            type: "text",
            frame: { x: 88, y: 690, width: 900, height: 110 },
            text: "충전비 줄이는 법",
            fontFamily: "IBM Plex Sans KR",
            fontSize: 120,
            fontWeight: 600,
            color: "#FFFFFF",
          },
        ],
      },
    ],
    ...overrides,
  });
}

describe("design document model", () => {
  it("fills defaults and counts layers across pages", () => {
    const document = baseDocument();

    expect(document.canvas.unit).toBe("px");
    expect(document.pages[0].layers[0].opacity).toBe(1);
    expect(countLayers(document)).toBe(2);
  });

  it("rejects duplicate layer ids, bad colors, and empty documents", () => {
    const duplicate = {
      id: "doc",
      title: "dup",
      canvas: { width: 100, height: 100 },
      pages: [
        {
          id: "p1",
          name: "P1",
          layers: [
            { id: "same", type: "rect", frame: { x: 0, y: 0, width: 10, height: 10 }, fill: "#000000" },
            { id: "same", type: "rect", frame: { x: 0, y: 0, width: 10, height: 10 }, fill: "#000000" },
          ],
        },
      ],
    };

    expect(() => parseDesignDocument(duplicate)).toThrow(/Duplicate layer id/);
    expect(
      () => parseDesignDocument({ ...duplicate, pages: [] }),
    ).toThrow();
    expect(() =>
      parseDesignDocument({
        id: "doc",
        title: "bad color",
        canvas: { width: 100, height: 100 },
        pages: [
          {
            id: "p1",
            name: "P1",
            layers: [
              { id: "r", type: "rect", frame: { x: 0, y: 0, width: 10, height: 10 }, fill: "red" },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects duplicate page ids", () => {
    const page = {
      id: "same",
      name: "P",
      layers: [],
    };

    expect(() =>
      parseDesignDocument({
        id: "doc",
        title: "dup pages",
        canvas: { width: 100, height: 100 },
        pages: [page, page],
      }),
    ).toThrow(/Duplicate page id/);
  });

  it("accepts signed coordinates for resize crop offsets", () => {
    const document = parseDesignDocument({
      id: "cropped",
      title: "cropped",
      canvas: { width: 100, height: 100 },
      pages: [{
        id: "p1",
        name: "P1",
        layers: [{
          id: "crop",
          type: "rect",
          frame: { x: -1, y: -1, width: 100, height: 100 },
          fill: "#000000",
        }],
      }],
    });

    expect(document.pages[0].layers[0].frame).toMatchObject({ x: -1, y: -1 });
  });
});

describe("size presets", () => {
  it("exposes the MiriCanvas-equivalent preset catalogue", () => {
    const expected = new Map([
      ["youtube-thumbnail", [1280, 720]],
      ["youtube-video", [1920, 1080]],
      ["instagram-square", [1080, 1080]],
      ["instagram-portrait", [1080, 1350]],
      ["instagram-story", [1080, 1920]],
      ["facebook-square", [1200, 1200]],
      ["blog-thumbnail", [900, 600]],
      ["blog-thumbnail-large", [1200, 800]],
      ["naver-blog-square", [1080, 1080]],
      ["naver-blog-thumbnail", [800, 800]],
      ["naver-blog-share", [1200, 675]],
      ["presentation-16-9", [1920, 1080]],
      ["a4-portrait", [210, 297]],
    ]);

    for (const [id, [width, height]] of expected) {
      const preset = requireSizePreset(id);
      expect({ id, width: preset.width, height: preset.height }).toEqual({ id, width, height });
    }

    expect(requireSizePreset("a4-portrait").unit).toBe("mm");
    expect(findSizePreset("nope")).toBeUndefined();
    expect(() => requireSizePreset("nope")).toThrow(/Unknown size preset/);
  });

  it("filters by category and keeps unique ids", () => {
    const print = listSizePresets("print");
    expect(print.every((preset) => preset.unit === "mm")).toBe(true);

    const ids = SIZE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resize engine", () => {
  function fullCanvasDocument(width: number, height: number): DesignDocument {
    return parseDesignDocument({
      id: `canvas-${width}-${height}`,
      title: "canvas probe",
      canvas: { width, height },
      pages: [{
        id: "p1",
        name: "P1",
        layers: [{
          id: "canvas",
          type: "rect",
          frame: { x: 0, y: 0, width, height },
          fill: "#000000",
        }],
      }],
    });
  }

  it("fills by the larger ratio and centres the overflow", () => {
    const resolved = resolveResize(baseDocument(), { preset: "instagram-story", mode: "fill" });

    expect(resolved).toMatchObject({ width: 1080, height: 1920 });
    expect(resolved.scale).toBeCloseTo(1920 / 1080);
    expect(resolved.offsetX).toBeCloseTo((1080 - (1080 * resolved.scale)) / 2, 12);
  });

  it("fits by the smaller ratio so in-canvas content is not cropped", () => {
    const document = baseDocument();
    const resized = resizeDocument(document, { preset: "instagram-story", mode: "fit" });
    const report = inspectDocument(resized);

    expect(resized.canvas).toMatchObject({ width: 1080, height: 1920 });
    expect(report.checks.find((check) => check.name === "layers-inside-canvas")?.pass).toBe(true);
  });

  it("keeps an already out-of-bounds source layer out of bounds after same-size fit", () => {
    const document = parseDesignDocument({
      id: "fit-source-overflow",
      title: "fit source overflow",
      canvas: { width: 100, height: 100 },
      pages: [{
        id: "p1",
        name: "P1",
        layers: [{
          id: "overflow",
          type: "rect",
          frame: { x: 90, y: 10, width: 20, height: 20 },
          fill: "#000000",
        }],
      }],
    });

    const resized = resizeDocument(document, { width: 100, height: 100, mode: "fit" });

    expect(resized.pages[0].layers[0].frame).toMatchObject({ x: 90, y: 10, width: 20, height: 20 });
    expect(inspectDocument(resized).checks.find((check) => check.name === "layers-inside-canvas")?.pass)
      .toBe(false);
    expect(() => parseDesignDocument(resized)).not.toThrow();
  });

  it("keeps fit geometry inside the canvas across deterministic source and target pairs", () => {
    const pairs: Array<[number, number, number, number]> = [[3, 3, 2, 4]];
    let seed = 0x13c0ffee;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };

    for (let index = 0; index < 48; index += 1) {
      pairs.push([
        (next() % 10_000) + 1,
        (next() % 10_000) + 1,
        (next() % 10_000) + 1,
        (next() % 10_000) + 1,
      ]);
    }

    for (const [sourceWidth, sourceHeight, targetWidth, targetHeight] of pairs) {
      const resized = resizeDocument(
        fullCanvasDocument(sourceWidth, sourceHeight),
        { width: targetWidth, height: targetHeight, mode: "fit" },
      );
      const frame = resized.pages[0].layers[0].frame;

      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(resized.canvas.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(resized.canvas.height);
    }
  });

  it("keeps fill geometry covering the canvas, including large near-two-thirds targets", () => {
    const pairs: Array<[number, number, number, number]> = [
      [10_000, 10_000, 6664, 6664],
      [3, 3, 2, 4],
      [4, 3, 13, 5],
      [19, 37, 101, 13],
    ];

    for (const [sourceWidth, sourceHeight, targetWidth, targetHeight] of pairs) {
      const resized = resizeDocument(
        fullCanvasDocument(sourceWidth, sourceHeight),
        { width: targetWidth, height: targetHeight, mode: "fill" },
      );
      const frame = resized.pages[0].layers[0].frame;

      expect(frame.x).toBeLessThanOrEqual(0);
      expect(frame.y).toBeLessThanOrEqual(0);
      expect(frame.x + frame.width).toBeGreaterThanOrEqual(resized.canvas.width);
      expect(frame.y + frame.height).toBeGreaterThanOrEqual(resized.canvas.height);
    }
  });

  it("preserves positive geometry through extreme scales and validates the result", () => {
    const downscale = fullCanvasDocument(1_000_000, 1_000_000);
    const upscale = fullCanvasDocument(1, 1);

    for (const [document, width, height] of [
      [downscale, 1, 1],
      [downscale, 0.0004, 0.0004],
      [upscale, 1_000_000, 1_000_000],
    ] as const) {
      const resized = resizeDocument(document, { width, height, mode: "fit" });
      const frame = resized.pages[0].layers[0].frame;

      expect(resized.canvas.width).toBeGreaterThan(0);
      expect(resized.canvas.height).toBeGreaterThan(0);
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
      expect(() => parseDesignDocument(resized)).not.toThrow();
    }
  });

  it("keeps layer sizes in original mode and only re-centres", () => {
    const document = baseDocument();
    const resized = resizeDocument(document, { preset: "instagram-story", mode: "original" });
    const source = document.pages[0].layers[1];
    const target = resized.pages[0].layers[1];

    expect(target.frame.width).toBe(source.frame.width);
    expect(target.frame.y).toBe(source.frame.y + ((1920 - 1080) / 2));
    if (target.type !== "text" || source.type !== "text") throw new Error("expected text layers");
    expect(target.fontSize).toBe(source.fontSize);
  });

  it("scales text metrics and corner radius with the canvas", () => {
    const document = parseDesignDocument({
      id: "scale",
      title: "scale",
      canvas: { width: 1000, height: 1000 },
      pages: [
        {
          id: "p1",
          name: "P1",
          layers: [
            {
              id: "chip",
              type: "rect",
              frame: { x: 0, y: 0, width: 100, height: 100 },
              fill: "#000000",
              radius: 10,
            },
            {
              id: "label",
              type: "text",
              frame: { x: 0, y: 200, width: 500, height: 100 },
              text: "A",
              fontFamily: "IBM Plex Sans KR",
              fontSize: 50,
              color: "#000000",
              letterSpacing: 2,
            },
          ],
        },
      ],
    });

    const resized = resizeDocument(document, { width: 2000, height: 2000, mode: "fill" });
    const [chip, label] = resized.pages[0].layers;

    if (chip.type !== "rect" || label.type !== "text") throw new Error("unexpected layer types");
    expect(chip.radius).toBe(20);
    expect(label.fontSize).toBe(100);
    expect(label.letterSpacing).toBe(4);
    expect(resized.canvas.safeMargin).toBe(0);
  });

  it("derives the missing axis only when the ratio is locked", () => {
    const document = baseDocument();

    expect(resolveResize(document, { width: 540, lockAspectRatio: true })).toMatchObject({
      width: 540,
      height: 540,
    });
    expect(() => resolveResize(document, { width: 540 })).toThrow(/lockAspectRatio/);
    expect(() => resolveResize(document, { height: 540 })).toThrow(/lockAspectRatio/);
    expect(() => resolveResize(document, {})).toThrow(/requires a preset or explicit dimensions/);
    expect(() => resolveResize(document, { preset: "instagram-square", width: 10 })).toThrow(
      /not both/,
    );
  });

  it("refuses to mix pixel and millimetre units", () => {
    expect(() => resolveResize(baseDocument(), { preset: "a4-portrait" })).toThrow(
      /Cannot resize a px document to mm/,
    );
  });

  it("adapt keeps content on the left edge and vertically balanced on a wide canvas", () => {
    const document = baseDocument();
    const fitted = resizeDocument(document, { preset: "youtube-thumbnail", mode: "fit" });
    const adapted = resizeDocument(document, { preset: "youtube-thumbnail", mode: "adapt" });

    expect(adapted.canvas).toMatchObject({ width: 1280, height: 720 });

    const fittedBand = fitted.pages[0].layers[0];
    const adaptedBand = adapted.pages[0].layers[0];

    // fit centres the whole square, leaving a large left margin.
    expect(fittedBand.frame.x).toBeGreaterThan(300);
    // adapt maps the original left margin onto the wider canvas instead.
    expect(adaptedBand.frame.x).toBeLessThan(100);

    // Both keep uniform glyph scale, so text is never distorted.
    const adaptedHook = adapted.pages[0].layers[1];
    const fittedHook = fitted.pages[0].layers[1];
    if (adaptedHook.type !== "text" || fittedHook.type !== "text") {
      throw new Error("expected text layers");
    }
    expect(adaptedHook.fontSize).toBe(fittedHook.fontSize);

    expect(inspectDocument(adapted).checks.find((check) => check.name === "layers-inside-canvas")?.pass)
      .toBe(true);
  });

  it("adapt preserves a decorative full-width band's aspect ratio and stretches a full-bleed background", () => {
    const document = parseDesignDocument({
      id: "adapt-shapes",
      title: "adapt shapes",
      canvas: { width: 100, height: 100 },
      pages: [{
        id: "p1",
        name: "P1",
        layers: [
          {
            id: "background",
            type: "rect",
            frame: { x: 0, y: 0, width: 100, height: 100 },
            fill: "#000000",
          },
          {
            id: "square",
            type: "rect",
            frame: { x: 10, y: 40, width: 20, height: 20 },
            fill: "#FFFFFF",
          },
          {
            id: "band",
            type: "rect",
            frame: { x: 0, y: 40, width: 100, height: 20 },
            fill: "#FFFFFF",
          },
        ],
      }],
    });

    const adapted = resizeDocument(document, { width: 200, height: 100, mode: "adapt" });
    const [background, square, band] = adapted.pages[0].layers;

    expect(square.frame.width / square.frame.height).toBeCloseTo(1);
    expect(square.frame.width).toBeCloseTo(20);
    expect(square.frame.height).toBeCloseTo(20);
    expect(band.frame).toMatchObject({ x: 0, y: 40, width: 100, height: 20 });
    expect(band.frame.width / band.frame.height).toBeCloseTo(5);
    expect(background.frame).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect(() => parseDesignDocument(adapted)).not.toThrow();
  });

  it("adapt centres each page independently", () => {
    const document = parseDesignDocument({
      id: "two-pages",
      title: "two pages",
      canvas: { width: 100, height: 100 },
      pages: [
        {
          id: "first",
          name: "First",
          layers: [{
            id: "top-block",
            type: "rect",
            frame: { x: 10, y: 10, width: 20, height: 20 },
            fill: "#000000",
          }],
        },
        {
          id: "second",
          name: "Second",
          layers: [{
            id: "lower-block",
            type: "rect",
            frame: { x: 10, y: 50, width: 20, height: 40 },
            fill: "#000000",
          }],
        },
      ],
    });

    const resolved = resolveResize(document, { width: 100, height: 200, mode: "adapt" });
    const adapted = resizeDocument(document, { width: 100, height: 200, mode: "adapt" });

    for (const page of adapted.pages) {
      const frame = page.layers[0].frame;
      expect(frame.y + (frame.height / 2)).toBeCloseTo(100);
    }
    expect(resolved.pageOffsetY).toEqual({ first: 80, second: 30 });
  });

  it("reports the exact transform applied for every resize mode", () => {
    const document = parseDesignDocument({
      id: "reported-transform",
      title: "reported transform",
      canvas: { width: 100, height: 100 },
      pages: [{
        id: "p1",
        name: "P1",
        layers: [{
          id: "shape",
          type: "rect",
          frame: { x: 10, y: 20, width: 20, height: 20 },
          fill: "#000000",
        }],
      }],
    });

    for (const mode of ["fill", "fit", "original", "adapt"] as const) {
      const target = { width: 200, height: 100, mode };
      const resolved = resolveResize(document, target);
      const frame = resizeDocument(document, target).pages[0].layers[0].frame;

      if (mode === "adapt") {
        expect(resolved.pageOffsetY?.p1).toBeTypeOf("number");
        expect(frame.x).toBeCloseTo(10 * (resolved.axisScaleX ?? resolved.scale));
        expect(frame.y).toBeCloseTo((20 * resolved.scale) + (resolved.pageOffsetY?.p1 ?? 0));
      } else {
        expect(frame.x).toBeCloseTo((10 * resolved.scale) + resolved.offsetX);
        expect(frame.y).toBeCloseTo((20 * resolved.scale) + (resolved.offsetY ?? 0));
      }
      expect(frame.width).toBeCloseTo(20 * resolved.scale);
      expect(frame.height).toBeCloseTo(20 * resolved.scale);
    }
  });

  it("adapt centres the visible text block rather than its declared frame", () => {
    const document = parseDesignDocument({
      id: "tall-frame",
      title: "tall frame",
      canvas: { width: 1000, height: 1000 },
      pages: [
        {
          id: "p1",
          name: "P1",
          background: "#FFFFFF",
          layers: [
            {
              id: "single-line",
              type: "text",
              // Frame is far taller than one rendered line.
              frame: { x: 100, y: 100, width: 800, height: 700 },
              text: "한 줄",
              fontFamily: "IBM Plex Sans KR",
              fontSize: 100,
              color: "#11191D",
            },
          ],
        },
      ],
    });

    const adapted = resizeDocument(document, { width: 1000, height: 400, mode: "adapt" });
    const layer = adapted.pages[0].layers[0];
    const renderedHeight = 100 * 0.4 * 1.3;

    // Rendered line is ~52px tall, so it should sit near the middle of 400px.
    expect(layer.frame.y).toBeGreaterThan(150);
    expect(layer.frame.y + renderedHeight).toBeLessThan(250);
  });

  it("adapt never pushes content above the canvas top", () => {
    const document = parseDesignDocument({
      id: "dense",
      title: "dense",
      canvas: { width: 1000, height: 1000 },
      pages: [
        {
          id: "p1",
          name: "P1",
          background: "#FFFFFF",
          layers: [
            {
              id: "full",
              type: "rect",
              frame: { x: 0, y: 0, width: 1000, height: 1000 },
              fill: "#11191D",
            },
          ],
        },
      ],
    });

    const adapted = resizeDocument(document, { width: 1000, height: 200, mode: "adapt" });
    expect(adapted.pages[0].layers[0].frame.y).toBeGreaterThanOrEqual(0);
  });
});

describe("brand kit", () => {
  it("normalizes off-brand colors and fonts to the nearest approved value", () => {
    const document = baseDocument({ brandKit });
    const drifted = parseDesignDocument({
      ...document,
      pages: [
        {
          ...document.pages[0],
          layers: [
            { ...document.pages[0].layers[0], fill: "#101820" },
            {
              ...document.pages[0].layers[1],
              color: "#FDFDFD",
              fontFamily: "Arial",
              fontWeight: 700,
            },
          ],
        },
      ],
    });

    expect(findBrandViolations(drifted)).toHaveLength(3);

    const normalized = applyBrandKit(drifted);
    const [band, hook] = normalized.pages[0].layers;
    if (band.type !== "rect" || hook.type !== "text") throw new Error("unexpected layer types");

    expect(band.fill).toBe("#11191D");
    expect(hook.color).toBe("#FFFFFF");
    expect(hook.fontFamily).toBe("IBM Plex Sans KR");
    expect(hook.fontWeight).toBe(600);
    expect(findBrandViolations(normalized)).toHaveLength(0);
  });

  it("flags logos that are not registered in the kit", () => {
    const document = parseDesignDocument({
      ...baseDocument({ brandKit }),
      pages: [
        {
          id: "cover",
          name: "표지",
          background: "#FFFFFF",
          layers: [
            {
              id: "logo",
              type: "image",
              frame: { x: 48, y: 48, width: 200, height: 60 },
              source: "assets/other.png",
              logoId: "unknown",
            },
          ],
        },
      ],
    });

    const violations = findBrandViolations(document);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "logo", value: "unknown" });
  });

  it("requires a claimed logo id to use its registered source", () => {
    const document = parseDesignDocument({
      ...baseDocument({ brandKit }),
      pages: [{
        id: "cover",
        name: "표지",
        background: "#FFFFFF",
        layers: [{
          id: "logo",
          type: "image",
          frame: { x: 48, y: 48, width: 200, height: 60 },
          source: "assets/arbitrary.png",
          logoId: "primary",
        }],
      }],
    });

    expect(findBrandViolations(document)).toMatchObject([{
      kind: "logo",
      value: "primary",
      message: expect.stringContaining("assets/logo.png"),
    }]);
  });

  it("accepts a claimed logo when its source matches the registered logo", () => {
    const document = parseDesignDocument({
      ...baseDocument({ brandKit }),
      pages: [{
        id: "cover",
        name: "표지",
        background: "#FFFFFF",
        layers: [{
          id: "logo",
          type: "image",
          frame: { x: 48, y: 48, width: 200, height: 60 },
          source: "assets/logo.png",
          logoId: "primary",
        }],
      }],
    });

    expect(findBrandViolations(document)).toHaveLength(0);
  });

  it("skips enforcement when no kit is registered", () => {
    expect(findBrandViolations(baseDocument())).toHaveLength(0);
    expect(applyBrandKit(baseDocument())).toEqual(baseDocument());
  });

  it("picks the nearest palette entry by rgb distance", () => {
    expect(nearestBrandColor(brandKit, "#00A755")).toBe("#00A653");
    expect(nearestBrandColor(brandKit, "#F8F8F8")).toBe("#FFFFFF");
  });

  it("shares stable hex parsing and contrast values with QA", async () => {
    const { contrastRatio: sharedContrastRatio, hexToRgb } = await import("../src/design/color.js");

    expect(hexToRgb("#11191D")).toEqual([17, 25, 29]);
    expect(sharedContrastRatio("#FFFFFF", "#11191D")).toBe(contrastRatio("#FFFFFF", "#11191D"));
    expect(contrastRatio("#FFFFFF", "#11191D")).toBeGreaterThan(4.5);
  });
});

describe("automated QA", () => {
  it("passes a well-formed document", () => {
    const source = baseDocument({ brandKit });
    const report = inspectDocument(parseDesignDocument({
      ...source,
      pages: source.pages.map((page) => ({
        ...page,
        layers: page.layers.map((layer) =>
          layer.type === "text" ? { ...layer, fontSize: 80 } : layer,
        ),
      })),
    }));

    expect(report.passed).toBe(true);
    expect(report.checks.every((check) => check.pass)).toBe(true);
    expect(report.pages).toBe(1);
    expect(report.layers).toBe(2);
  });

  it("detects canvas overflow, safe-area breaches, and weak contrast", () => {
    const document = parseDesignDocument({
      id: "bad",
      title: "bad",
      canvas: { width: 1000, height: 1000, safeMargin: 40 },
      pages: [
        {
          id: "p1",
          name: "P1",
          background: "#FFFFFF",
          layers: [
            {
              id: "overflow",
              type: "rect",
              frame: { x: 900, y: 900, width: 300, height: 300 },
              fill: "#000000",
            },
            {
              id: "edge-text",
              type: "text",
              frame: { x: 4, y: 4, width: 400, height: 60 },
              text: "너무 가장자리",
              fontFamily: "IBM Plex Sans KR",
              fontSize: 40,
              color: "#F2F2F2",
            },
          ],
        },
      ],
    });

    const report = inspectDocument(document);
    const failed = report.checks.filter((check) => !check.pass).map((check) => check.name);

    expect(report.passed).toBe(false);
    expect(failed).toContain("layers-inside-canvas");
    expect(failed).toContain("content-respects-safe-area");
    expect(failed).toContain("text-contrast-at-least-4.5");
  });

  it("measures contrast against a covering opaque rect, not just the page background", () => {
    const report = inspectDocument(baseDocument());

    expect(report.checks.find((check) => check.name === "text-contrast-at-least-4.5")?.pass).toBe(
      true,
    );
    expect(contrastRatio("#FFFFFF", "#11191D")).toBeGreaterThan(4.5);
  });

  it("fails white text over a 90%-opaque white rect on black", () => {
    const document = parseDesignDocument({
      id: "translucent",
      title: "translucent",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#000000",
        layers: [
          { id: "wash", type: "rect", frame: { x: 0, y: 0, width: 200, height: 200 }, fill: "#FFFFFF", opacity: 0.9 },
          { id: "headline", type: "text", frame: { x: 20, y: 50, width: 160, height: 60 }, text: "A", fontFamily: "Arial", fontSize: 32, color: "#FFFFFF" },
        ],
      }],
    });

    const contrast = inspectDocument(document).checks.find((check) => check.name === "text-contrast-at-least-4.5");
    expect(contrast).toMatchObject({ pass: false });
    expect(contrast?.detail).toContain("headline");
  });

  it("fails low-opacity white text on black using its effective painted color", () => {
    const document = parseDesignDocument({
      id: "transparent-text",
      title: "transparent text",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#000000",
        layers: [{
          id: "headline",
          type: "text",
          frame: { x: 20, y: 50, width: 160, height: 60 },
          text: "A",
          fontFamily: "Arial",
          fontSize: 32,
          color: "#FFFFFF",
          opacity: 0.1,
        }],
      }],
    });

    const contrast = inspectDocument(document).checks.find((check) => check.name === "text-contrast-at-least-4.5");
    expect(contrast).toMatchObject({ pass: false });
    expect(contrast?.detail).toContain("1.20:1");
  });

  it("evaluates semi-transparent text against a solid band at its composited color", () => {
    const document = parseDesignDocument({
      id: "transparent-text-band",
      title: "transparent text band",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#000000",
        layers: [
          { id: "band", type: "rect", frame: { x: 0, y: 0, width: 200, height: 200 }, fill: "#FFFFFF" },
          {
            id: "headline",
            type: "text",
            frame: { x: 20, y: 50, width: 160, height: 60 },
            text: "A",
            fontFamily: "Arial",
            fontSize: 32,
            color: "#000000",
            opacity: 0.5,
          },
        ],
      }],
    });

    const contrast = inspectDocument(document).checks.find((check) => check.name === "text-contrast-at-least-4.5");
    expect(contrast).toMatchObject({ pass: false });
    expect(contrast?.detail).toContain("3.98:1");
  });

  it("fails closed when text reaches a rounded rect corner arc", () => {
    const document = parseDesignDocument({
      id: "rounded-corner-text",
      title: "rounded corner text",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#FFFFFF",
        layers: [
          { id: "panel", type: "rect", frame: { x: 0, y: 0, width: 200, height: 200 }, fill: "#000000", radius: 40 },
          { id: "headline", type: "text", frame: { x: 10, y: 10, width: 100, height: 40 }, text: "A", fontFamily: "Arial", fontSize: 32, color: "#FFFFFF" },
        ],
      }],
    });

    const contrast = inspectDocument(document).checks.find((check) => check.name === "text-contrast-at-least-4.5");
    expect(contrast).toMatchObject({ pass: false });
    expect(contrast?.detail).toContain("indeterminate rounded rect backdrop");
  });

  it("accepts text fully inside a rounded rect's corner-radius inset", () => {
    const document = parseDesignDocument({
      id: "rounded-safe-text",
      title: "rounded safe text",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#FFFFFF",
        layers: [
          { id: "panel", type: "rect", frame: { x: 0, y: 0, width: 200, height: 200 }, fill: "#000000", radius: 40 },
          { id: "headline", type: "text", frame: { x: 50, y: 50, width: 100, height: 40 }, text: "A", fontFamily: "Arial", fontSize: 32, color: "#FFFFFF" },
        ],
      }],
    });

    expect(inspectDocument(document).checks.find(
      (check) => check.name === "text-contrast-at-least-4.5",
    )).toMatchObject({ pass: true });
  });

  it("fails closed when black text sits over an image", () => {
    const document = parseDesignDocument({
      id: "image-backdrop",
      title: "image backdrop",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#FFFFFF",
        layers: [
          { id: "photo", type: "image", frame: { x: 0, y: 0, width: 200, height: 200 }, source: "assets/black.png" },
          { id: "headline", type: "text", frame: { x: 20, y: 50, width: 160, height: 60 }, text: "A", fontFamily: "Arial", fontSize: 32, color: "#000000" },
        ],
      }],
    });

    const contrast = inspectDocument(document).checks.find((check) => check.name === "text-contrast-at-least-4.5");
    expect(contrast).toMatchObject({ pass: false });
    expect(contrast?.detail).toContain("indeterminate image backdrop");
    expect(contrast?.detail).toContain("solid rect band");
  });

  it("uses the worst contrast where a backdrop only partly covers text", () => {
    const document = parseDesignDocument({
      id: "partial-backdrop",
      title: "partial backdrop",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#FFFFFF",
        layers: [
          { id: "dark-half", type: "rect", frame: { x: 0, y: 0, width: 100, height: 200 }, fill: "#000000" },
          { id: "headline", type: "text", frame: { x: 20, y: 50, width: 160, height: 60 }, text: "A", fontFamily: "Arial", fontSize: 32, color: "#FFFFFF" },
        ],
      }],
    });

    const contrast = inspectDocument(document).checks.find((check) => check.name === "text-contrast-at-least-4.5");
    expect(contrast).toMatchObject({ pass: false });
    expect(contrast?.detail).toContain("1.00:1");
  });

  it("fails text hidden by a later opaque rect", () => {
    const document = parseDesignDocument({
      id: "occluded",
      title: "occluded",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#FFFFFF",
        layers: [
          { id: "headline", type: "text", frame: { x: 20, y: 50, width: 160, height: 60 }, text: "A", fontFamily: "Arial", fontSize: 32, color: "#000000" },
          { id: "overlay", type: "rect", frame: { x: 20, y: 50, width: 160, height: 60 }, fill: "#000000" },
        ],
      }],
    });

    expect(inspectDocument(document).checks.find(
      (check) => check.name === "text-not-occluded-by-later-opaque-layer",
    )).toMatchObject({ pass: false, detail: "p1/headline <- p1/overlay" });
  });

  it("gates public exports by default and allows explicit raw rendering", async () => {
    const document = parseDesignDocument({
      id: "too-large",
      title: "too large",
      canvas: { width: 100, height: 100 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#FFFFFF",
        layers: [
          { id: "headline", type: "text", frame: { x: 5, y: 5, width: 90, height: 90 }, text: "A", fontFamily: "Arial", fontSize: 200, color: "#000000" },
        ],
      }],
    });
    const { exportDocument } = await import("../src/design/index.js");

    await expect(exportDocument(document, { format: "svg" })).rejects.toThrow("text-fits-frame");
    await expect(exportDocument(document, { format: "svg", enforceQa: false })).resolves.toMatchObject({
      files: [{ pageId: "p1" }],
    });
  });

  it("reports brand violations through the QA gate", () => {
    const document = parseDesignDocument({
      ...baseDocument({ brandKit }),
      pages: [
        {
          id: "cover",
          name: "표지",
          background: "#FFFFFF",
          layers: [
            {
              id: "band",
              type: "rect",
              frame: { x: 48, y: 650, width: 984, height: 186 },
              fill: "#FF00FF",
            },
          ],
        },
      ],
    });

    const report = inspectDocument(document);
    expect(report.passed).toBe(false);
    expect(report.brandViolations[0]).toMatchObject({ kind: "color", value: "#FF00FF" });
  });
});

describe("svg serialization", () => {
  it("is deterministic and escapes user text", async () => {
    const document = parseDesignDocument({
      ...baseDocument(),
      pages: [
        {
          id: "cover",
          name: "표지",
          background: "#FFFFFF",
          layers: [
            {
              id: "hook",
              type: "text",
              frame: { x: 48, y: 100, width: 900, height: 120 },
              text: 'A & B <script>alert("x")</script>',
              fontFamily: "IBM Plex Sans KR",
              fontSize: 60,
              color: "#11191D",
            },
          ],
        },
      ],
    });

    const [first] = await renderDocumentToSvg(document);
    const [second] = await renderDocumentToSvg(document);

    expect(first).toBe(second);
    expect(first).toContain("&amp;");
    expect(first).toContain("&lt;script&gt;");
    expect(first).not.toContain("<script>");
    expect(first).toContain('width="1080" height="1080"');
  });

  it("splits multi-line text into positioned spans", async () => {
    const document = parseDesignDocument({
      ...baseDocument(),
      pages: [
        {
          id: "cover",
          name: "표지",
          background: "#FFFFFF",
          layers: [
            {
              id: "hook",
              type: "text",
              frame: { x: 0, y: 0, width: 1080, height: 300 },
              text: "첫 줄\n둘째 줄",
              fontFamily: "IBM Plex Sans KR",
              fontSize: 100,
              color: "#11191D",
              align: "middle",
            },
          ],
        },
      ],
    });

    const [svg] = await renderDocumentToSvg(document);
    expect(svg.match(/<tspan/g)).toHaveLength(2);
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('x="540"');
  });

  it("requires a resolver for image layers and uses the resolved href", async () => {
    const document = parseDesignDocument({
      ...baseDocument(),
      pages: [
        {
          id: "cover",
          name: "표지",
          background: "#FFFFFF",
          layers: [
            {
              id: "photo",
              type: "image",
              frame: { x: 0, y: 0, width: 1080, height: 1080 },
              source: "assets/photo.jpg",
            },
          ],
        },
      ],
    });

    await expect(renderPageToSvg(document, document.pages[0])).rejects.toThrow(
      /requires an image resolver/,
    );

    const svg = await renderPageToSvg(document, document.pages[0], async () => "data:image/png;base64,AAA");
    expect(svg).toContain('href="data:image/png;base64,AAA"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
  });

  it("converts millimetre canvases to a pixel viewport at 96dpi", async () => {
    const document = parseDesignDocument({
      id: "print",
      title: "A4",
      canvas: { width: 210, height: 297, unit: "mm" },
      pages: [{ id: "p1", name: "P1", layers: [] }],
    });

    const [svg] = await renderDocumentToSvg(document);
    expect(svg).toContain('width="794" height="1123"');
    expect(svg).toContain('viewBox="0 0 210 297"');
  });

  it("keeps the schema exported for MCP tool wiring", () => {
    expect(DesignDocumentSchema.safeParse(baseDocument()).success).toBe(true);
  });
});
