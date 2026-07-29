import { describe, it, expect } from "vitest";
import { compressBrandContext, serializeForLLM } from "../src/compressor.js";
import { convertFigmaToPenpot } from "../src/figma/converter.js";
import type { PenpotFile } from "../src/penpot/types.js";
import type { FigmaFile } from "../src/figma/client.js";

describe("compressor edge cases", () => {
  const emptyFile: PenpotFile = {
    id: "empty",
    name: "Empty File",
    pages: [],
    components: [],
    colors: [],
    typographies: [],
  };

  it("handles empty file gracefully", () => {
    const ctx = compressBrandContext(emptyFile);
    expect(ctx.fileName).toBe("Empty File");
    expect(ctx.tokens.colors).toHaveLength(0);
    expect(ctx.tokens.typography.families).toHaveLength(0);
    expect(ctx.tokens.typography.baseSize).toBe(16); // default
    expect(ctx.tokens.spacing.baseUnit).toBe(8); // default
    expect(ctx.components).toHaveLength(0);
    expect(ctx.pages).toHaveLength(0);
  });

  it("serializes empty file without crashing", () => {
    const ctx = compressBrandContext(emptyFile);
    const text = serializeForLLM(ctx);
    expect(text).toContain("# Empty File");
    expect(text).toContain("## Colors");
    expect(text.length).toBeGreaterThan(0);
  });

  it("handles colors with opacity", () => {
    const file: PenpotFile = {
      ...emptyFile,
      colors: [
        { id: "c1", name: "Overlay", color: "#000000", opacity: 0.5 },
        { id: "c2", name: "Solid", color: "#ff0000", opacity: 1 },
      ],
    };
    const ctx = compressBrandContext(file);
    const overlay = ctx.tokens.colors.find((c) => c.name === "Overlay");
    expect(overlay?.value).toBe("#000000 @50%");
    const solid = ctx.tokens.colors.find((c) => c.name === "Solid");
    expect(solid?.value).toBe("#ff0000");
  });

  it("handles gradient colors", () => {
    const file: PenpotFile = {
      ...emptyFile,
      colors: [
        {
          id: "g1",
          name: "Gradient",
          color: "#6366f1",
          gradient: {
            type: "linear",
            startX: 0, startY: 0, endX: 1, endY: 1,
            stops: [
              { color: "#6366f1", opacity: 1, offset: 0 },
              { color: "#8b5cf6", opacity: 1, offset: 1 },
            ],
          },
        },
      ],
    };
    const ctx = compressBrandContext(file);
    expect(ctx.tokens.colors).toHaveLength(1);
    expect(ctx.tokens.colors[0].name).toBe("Gradient");
  });

  it("deduplicates font families", () => {
    const file: PenpotFile = {
      ...emptyFile,
      typographies: [
        { id: "t1", name: "H1", fontFamily: "Inter", fontSize: "32", fontWeight: "700", lineHeight: "1.2" },
        { id: "t2", name: "Body", fontFamily: "Inter", fontSize: "16", fontWeight: "400", lineHeight: "1.5" },
        { id: "t3", name: "Code", fontFamily: "JetBrains Mono", fontSize: "14", fontWeight: "400", lineHeight: "1.6" },
      ],
    };
    const ctx = compressBrandContext(file);
    expect(ctx.tokens.typography.families).toEqual(["Inter", "JetBrains Mono"]);
  });

  it("respects maxComponents=0", () => {
    const file: PenpotFile = {
      ...emptyFile,
      components: [
        { id: "c1", name: "Button", path: "ui/button" },
        { id: "c2", name: "Card", path: "ui/card" },
      ],
    };
    const ctx = compressBrandContext(file, { maxComponents: 0 });
    expect(ctx.components).toHaveLength(0);
  });
});

describe("figma converter edge cases", () => {
  const emptyFigma: FigmaFile = {
    name: "Empty",
    lastModified: "2026-01-01",
    document: { id: "0:0", name: "Document", type: "DOCUMENT", children: [] },
    components: {},
    styles: {},
  };

  it("handles empty Figma file", () => {
    const result = convertFigmaToPenpot(emptyFigma);
    expect(result.fileName).toBe("Empty");
    expect(result.pages).toHaveLength(0);
    expect(result.stats.totalShapes).toBe(0);
    expect(result.stats.warnings).toHaveLength(0);
  });

  it("handles nodes with zero-size bounding box", () => {
    const figma: FigmaFile = {
      ...emptyFigma,
      document: {
        id: "0:0", name: "Doc", type: "DOCUMENT",
        children: [{
          id: "0:1", name: "Page", type: "CANVAS",
          children: [{
            id: "1:1", name: "Zero", type: "RECTANGLE",
            absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 },
          }],
        }],
      },
    };
    const result = convertFigmaToPenpot(figma);
    expect(result.pages[0].shapes[0].width).toBe(0);
    expect(result.pages[0].shapes[0].height).toBe(0);
  });

  it("skips non-SOLID fills", () => {
    const figma: FigmaFile = {
      ...emptyFigma,
      document: {
        id: "0:0", name: "Doc", type: "DOCUMENT",
        children: [{
          id: "0:1", name: "Page", type: "CANVAS",
          children: [{
            id: "1:1", name: "Image", type: "RECTANGLE",
            absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
            fills: [{ type: "IMAGE" }],
          }],
        }],
      },
    };
    const result = convertFigmaToPenpot(figma);
    expect(result.pages[0].shapes[0].fills).toHaveLength(0);
  });

  it("maps unknown node types to frame", () => {
    const figma: FigmaFile = {
      ...emptyFigma,
      document: {
        id: "0:0", name: "Doc", type: "DOCUMENT",
        children: [{
          id: "0:1", name: "Page", type: "CANVAS",
          children: [{
            id: "1:1", name: "Widget", type: "STICKY",
            absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
          }],
        }],
      },
    };
    const result = convertFigmaToPenpot(figma);
    expect(result.pages[0].shapes[0].type).toBe("frame");
  });
});
