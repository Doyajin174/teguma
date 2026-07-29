import { describe, it, expect } from "vitest";
import { convertFigmaToPenpot } from "../src/figma/converter.js";
import type { FigmaFile } from "../src/figma/client.js";

const mockFigmaFile: FigmaFile = {
  name: "Acme UI Kit",
  lastModified: "2026-07-01T00:00:00Z",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        name: "Components",
        type: "CANVAS",
        children: [
          {
            id: "1:1",
            name: "Button/Primary",
            type: "COMPONENT",
            absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 44 },
            fills: [{ type: "SOLID", color: { r: 0.39, g: 0.4, b: 0.95, a: 1 } }],
            cornerRadius: 8,
            layoutMode: "HORIZONTAL",
            itemSpacing: 8,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 12,
            paddingBottom: 12,
            children: [
              {
                id: "1:2",
                name: "Label",
                type: "TEXT",
                absoluteBoundingBox: { x: 16, y: 12, width: 60, height: 20 },
                style: {
                  fontFamily: "Inter",
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeightPx: 20,
                  letterSpacing: 0,
                },
              },
            ],
          },
          {
            id: "2:1",
            name: "Card",
            type: "FRAME",
            absoluteBoundingBox: { x: 200, y: 0, width: 320, height: 240 },
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
            layoutMode: "VERTICAL",
            itemSpacing: 16,
            paddingLeft: 24,
            paddingRight: 24,
            paddingTop: 24,
            paddingBottom: 24,
          },
        ],
      },
      {
        id: "0:2",
        name: "Screens",
        type: "CANVAS",
        children: [
          {
            id: "3:1",
            name: "Dashboard",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1024 },
          },
        ],
      },
    ],
  },
  components: {
    "1:1": {
      key: "abc123",
      name: "Button/Primary",
      description: "Primary action button",
      containingFrame: { name: "Buttons", pageName: "Components" },
    },
  },
  styles: {
    "s1": { key: "k1", name: "brand/Primary", description: "", styleType: "FILL" },
    "s2": { key: "k2", name: "Heading/H1", description: "", styleType: "TEXT" },
    "s3": { key: "k3", name: "Body", description: "", styleType: "TEXT" },
  },
};

describe("convertFigmaToPenpot", () => {
  it("extracts file name", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    expect(result.fileName).toBe("Acme UI Kit");
  });

  it("converts pages from CANVAS nodes", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].name).toBe("Components");
    expect(result.pages[1].name).toBe("Screens");
  });

  it("converts shapes with bounding boxes", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    const button = result.pages[0].shapes[0];
    expect(button.name).toBe("Button/Primary");
    expect(button.width).toBe(120);
    expect(button.height).toBe(44);
    expect(button.type).toBe("frame"); // COMPONENT → frame
  });

  it("converts fills to hex colors", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    const button = result.pages[0].shapes[0];
    expect(button.fills).toHaveLength(1);
    expect(button.fills![0].fillColor).toBe("#6366f2");
    expect(button.fills![0].fillOpacity).toBe(1);
  });

  it("converts Auto Layout to flex layout", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    const button = result.pages[0].shapes[0];
    expect(button.layout).toBeDefined();
    expect(button.layout!.type).toBe("flex");
    expect(button.layout!.direction).toBe("row");
    expect(button.layout!.gap).toBe(8);
    expect(button.layout!.padding).toEqual({ top: 12, right: 16, bottom: 12, left: 16 });
  });

  it("converts vertical layout", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    const card = result.pages[0].shapes[1];
    expect(card.layout!.direction).toBe("column");
    expect(card.layout!.gap).toBe(16);
  });

  it("converts corner radius", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    const button = result.pages[0].shapes[0];
    expect(button.cornerRadius).toBe(8);
  });

  it("converts children recursively", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    const button = result.pages[0].shapes[0];
    expect(button.children).toHaveLength(1);
    expect(button.children![0].name).toBe("Label");
    expect(button.children![0].type).toBe("text");
  });

  it("extracts components", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe("Button/Primary");
    expect(result.components[0].path).toBe("Components/Buttons");
  });

  it("extracts color styles", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    expect(result.colors).toHaveLength(1);
    expect(result.colors[0].name).toBe("Primary");
    expect(result.colors[0].path).toBe("brand");
  });

  it("extracts typography styles", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    expect(result.typographies).toHaveLength(2);
    expect(result.typographies[0].name).toBe("H1");
    expect(result.typographies[0].path).toBe("Heading");
  });

  it("produces correct stats", () => {
    const result = convertFigmaToPenpot(mockFigmaFile);
    expect(result.stats.totalPages).toBe(2);
    expect(result.stats.totalComponents).toBe(1);
    expect(result.stats.totalColors).toBe(1);
    expect(result.stats.totalTypographies).toBe(2);
    expect(result.stats.totalShapes).toBeGreaterThan(3);
  });

  it("handles nodes without bounding box gracefully", () => {
    const fileWithMissing: FigmaFile = {
      ...mockFigmaFile,
      document: {
        ...mockFigmaFile.document,
        children: [
          {
            id: "0:1",
            name: "Test",
            type: "CANVAS",
            children: [
              { id: "x:1", name: "NoBBox", type: "FRAME" }, // no absoluteBoundingBox
            ],
          },
        ],
      },
    };
    const result = convertFigmaToPenpot(fileWithMissing);
    expect(result.stats.warnings).toContain('Node "NoBBox" has no bounding box, skipped');
  });
});
