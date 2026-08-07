import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportDocument, parseDesignDocument, type DesignDocument } from "../src/design/index.js";
import {
  createDesignDocumentTool,
  exportDesignDocumentTool,
  listSizePresetsTool,
  resizeDesignDocumentTool,
} from "../src/tools/design-engine.js";

const FONT_FILES = [
  fileURLToPath(
    new URL(
      "../experiments/company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-SemiBold.ttf",
      import.meta.url,
    ),
  ),
];

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "teguma-export-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function cardNews(): DesignDocument {
  const page = (id: string, label: string, background: string, text: string) => ({
    id,
    name: label,
    background,
    layers: [
      {
        id: "headline",
        type: "text" as const,
        // 2 lines at 96px with the default 1.3 line height need 249.6px, so the
        // frame is sized from the measured block, not guessed.
        frame: { x: 80, y: 500, width: 920, height: 260 },
        text,
        fontFamily: "IBM Plex Sans KR",
        fontSize: 96,
        fontWeight: 600,
        color: "#11191D",
        align: "middle" as const,
      },
    ],
  });

  return parseDesignDocument({
    id: "cardnews",
    title: "충전비 카드뉴스",
    canvas: { width: 1080, height: 1350, safeMargin: 48 },
    pages: [
      page("p1", "1면", "#FFFFFF", "충전비\n줄이는 법"),
      page("p2", "2면", "#F2F4F3", "시간대만\n바꿔도 절감"),
    ],
  });
}

describe("design export", () => {
  it("writes one SVG per page and keeps rendering deterministic", async () => {
    const document = cardNews();
    const first = await exportDocument(document, { format: "svg" });
    const second = await exportDocument(document, { format: "svg" });

    expect(first.files).toHaveLength(2);
    expect(first.files.map((file) => file.pageId)).toEqual(["p1", "p2"]);
    expect(first.files[0].data.equals(second.files[0].data)).toBe(true);
  });

  it("renders PNG at the requested width with byte-identical repeats", async () => {
    const document = cardNews();
    const options = { format: "png" as const, width: 540, fontFiles: FONT_FILES };
    const first = await exportDocument(document, options);
    const second = await exportDocument(document, options);

    const png = PNG.sync.read(first.files[0].data);
    expect({ width: png.width, height: png.height }).toEqual({ width: 540, height: 675 });
    expect(first.files[0].data.equals(second.files[0].data)).toBe(true);
    expect(first.height).toBe(675);
  });

  it("keeps alpha only when transparency is requested", async () => {
    const document = parseDesignDocument({
      id: "badge",
      title: "badge",
      canvas: { width: 200, height: 200 },
      pages: [
        {
          id: "only",
          name: "only",
          background: "#FFFFFF",
          layers: [
            {
              id: "dot",
              type: "rect",
              frame: { x: 50, y: 50, width: 100, height: 100 },
              fill: "#00A653",
            },
          ],
        },
      ],
    });

    const opaque = await exportDocument(document, { format: "png", width: 200 });
    const flattened = PNG.sync.read(opaque.files[0].data);
    expect(flattened.data[3]).toBe(255);

    const transparent = await exportDocument(document, {
      format: "png",
      width: 200,
      transparentBackground: true,
    });
    const raw = PNG.sync.read(transparent.files[0].data);
    // Corner pixel sits outside the green square, so alpha survives.
    expect(raw.data[3]).toBe(0);
  });

  it("builds a single multi-page PDF with a media box in points", async () => {
    const result = await exportDocument(cardNews(), {
      format: "pdf",
      width: 300,
      fontFiles: FONT_FILES,
    });

    expect(result.files).toHaveLength(1);
    const pdf = result.files[0].data;
    const header = pdf.subarray(0, 8).toString("latin1");
    const trailer = pdf.subarray(pdf.length - 32).toString("latin1");

    expect(header).toBe("%PDF-1.4");
    expect(trailer).toContain("%%EOF");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 810 1013]");
    expect(pdf.toString("latin1")).toContain("/Count 2");
  });

  it("compresses PDF image streams so multi-page exports stay small", async () => {
    const result = await exportDocument(cardNews(), {
      format: "pdf",
      width: 1080,
      fontFiles: FONT_FILES,
    });

    const pdf = result.files[0].data;
    const rawRgbBytes = 1080 * 1350 * 3 * 2;

    expect(pdf.toString("latin1")).toContain("/Filter /FlateDecode");
    // Uncompressed RGB for two 1080x1350 pages would exceed 8MB.
    expect(pdf.length).toBeLessThan(rawRgbBytes / 10);
  });

  it("rejects a non-positive export width", async () => {
    await expect(exportDocument(cardNews(), { format: "png", width: 0 })).rejects.toThrow(
      /positive and finite/,
    );
  });
});

describe("design engine MCP tools", () => {
  it("lists presets and filters by category", () => {
    const all = JSON.parse(listSizePresetsTool({}));
    const social = JSON.parse(listSizePresetsTool({ category: "social" }));

    expect(all.count).toBeGreaterThanOrEqual(12);
    expect(social.presets.every((preset: { category: string }) => preset.category === "social")).toBe(
      true,
    );
  });

  it("returns a QA report when validating a document", () => {
    const result = JSON.parse(createDesignDocumentTool({ document: cardNews() }));

    expect(result.qa.passed).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.layers).toBe(2);
  });

  it("normalizes to the brand kit on request", () => {
    const source = cardNews();
    const document = {
      ...source,
      pages: source.pages.map((page) => ({
        ...page,
        // Off-brand ink and an unregistered weight, so QA must fail first.
        layers: page.layers.map((layer) =>
          layer.type === "text" ? { ...layer, color: "#123456", fontWeight: 700 } : layer,
        ),
      })),
      brandKit: {
        id: "kit",
        name: "Kit",
        palette: [
          { id: "ink", name: "Ink", value: "#11191D" },
          { id: "paper", name: "Paper", value: "#FFFFFF" },
          { id: "mist", name: "Mist", value: "#F2F4F3" },
        ],
        fonts: [{ family: "IBM Plex Sans KR", weights: [600] }],
        logos: [],
      },
    };

    const raw = JSON.parse(createDesignDocumentTool({ document }));
    expect(raw.qa.passed).toBe(false);
    expect(raw.qa.brandViolations.map((item: { kind: string }) => item.kind)).toEqual([
      "color",
      "font-weight",
      "color",
      "font-weight",
    ]);

    const normalized = JSON.parse(
      createDesignDocumentTool({ document, applyBrandKitNormalization: true }),
    );
    expect(normalized.qa.passed).toBe(true);
    expect(normalized.document.pages[0].layers[0].fontWeight).toBe(600);
    expect(normalized.document.pages[0].layers[0].color).toBe("#11191D");
  });

  it("resizes through the tool and reports the applied transform", () => {
    const result = JSON.parse(
      resizeDesignDocumentTool({
        document: cardNews(),
        preset: "instagram-story",
        mode: "fit",
      }),
    );

    expect(result.from).toEqual({ width: 1080, height: 1350 });
    expect(result.to).toEqual({ width: 1080, height: 1920 });
    expect(result.applied.mode).toBe("fit");
    expect(result.qa.passed).toBe(true);
  });

  it("writes exports inside the export root", async () => {
    const payload = await exportDesignDocumentTool(
      {
        document: cardNews(),
        format: "png",
        outputDirectory: "cardnews",
        width: 270,
        fontFiles: FONT_FILES,
      },
      { outputRoot: workspace },
    );

    const result = JSON.parse(payload);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].file).toBe("cardnews-01-p1.png");

    const written = await readdir(path.join(workspace, "cardnews"));
    expect(written.sort()).toEqual(["cardnews-01-p1.png", "cardnews-02-p2.png"]);

    const bytes = await readFile(path.join(workspace, "cardnews", "cardnews-01-p1.png"));
    expect(PNG.sync.read(bytes).width).toBe(270);
  });

  it("refuses to export a document that fails QA", async () => {
    const broken = {
      id: "broken",
      title: "broken",
      canvas: { width: 500, height: 500 },
      pages: [
        {
          id: "p1",
          name: "P1",
          background: "#FFFFFF",
          layers: [
            {
              id: "spill",
              type: "rect",
              frame: { x: 400, y: 400, width: 300, height: 300 },
              fill: "#000000",
            },
          ],
        },
      ],
    };

    await expect(
      exportDesignDocumentTool(
        { document: broken, format: "png", outputDirectory: "broken" },
        { outputRoot: workspace },
      ),
    ).rejects.toThrow(/Design QA failed/);
  });

  it("blocks lexical and symlink escapes from the export root", async () => {
    await expect(
      exportDesignDocumentTool(
        { document: cardNews(), format: "svg", outputDirectory: "../escape" },
        { outputRoot: workspace },
      ),
    ).rejects.toThrow(/escapes the export root/);

    const outside = await mkdtemp(path.join(tmpdir(), "teguma-outside-"));
    const linkPath = path.join(workspace, "linked");
    await symlink(outside, linkPath);
    try {
      await expect(
        exportDesignDocumentTool(
          { document: cardNews(), format: "svg", outputDirectory: "linked" },
          { outputRoot: workspace },
        ),
        // Containment now rejects a symlinked component before creating or
        // resolving anything through it, so the failure is reported earlier.
      ).rejects.toThrow(/symlink, refusing to follow it/);
    } finally {
      await rm(linkPath, { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("writes real baseline JPEG bytes for the jpg format", async () => {
    const payload = await exportDesignDocumentTool(
      {
        document: cardNews(),
        format: "jpg",
        outputDirectory: "jpg",
        width: 200,
        fontFiles: FONT_FILES,
      },
      { outputRoot: workspace },
    );

    const result = JSON.parse(payload);
    expect(result.note).toBeUndefined();
    expect(result.files[0].file).toBe("cardnews-01-p1.jpg");

    // Assert genuine JFIF bytes rather than trusting the reported format.
    const bytes = await readFile(path.join(workspace, "jpg", "cardnews-01-p1.jpg"));
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.subarray(bytes.length - 2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(bytes.includes(Buffer.from("JFIF", "latin1"))).toBe(true);
  });
});
