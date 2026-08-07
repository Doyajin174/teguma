import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  alignLayers,
  distributeLayers,
  distributeVerticalRhythm,
  inspectDocument,
  measureTextBlock,
  parseDesignDocument,
  stackLayers,
  type DesignLayer,
} from "../src/design/index.js";
import { createServer } from "../src/server.js";

const canvas = { width: 220, height: 240, safeMargin: 20 };
const container = { x: 0, y: 0, width: canvas.width, height: canvas.height };

function rect(id: string, x = 20, y = 20, width = 20, height = 20): DesignLayer {
  return {
    id,
    type: "rect",
    frame: { x, y, width, height },
    opacity: 1,
    fill: "#FFFFFF",
    radius: 0,
  };
}

function text(id: string, x = 20, y = 20, width = 120, height = 30, value = "Layout"): DesignLayer {
  return {
    id,
    type: "text",
    frame: { x, y, width, height },
    opacity: 1,
    text: value,
    // Alignment and stacking are under test; bundled Plex supplies real text metrics.
    fontFamily: "IBM Plex Sans KR",
    fontSize: 20,
    fontWeight: 400,
    color: "#000000",
    align: "start",
    lineHeight: 1.2,
    letterSpacing: 0,
  };
}

function documentFor(layers: DesignLayer[], canvasOverride = canvas) {
  return parseDesignDocument({
    id: "layout",
    title: "Layout",
    canvas: canvasOverride,
    pages: [{ id: "page", name: "Page", background: "#FFFFFF", layers }],
  });
}

function expectClean(layers: DesignLayer[], canvasOverride = canvas): void {
  const document = documentFor(layers, canvasOverride);
  expect(parseDesignDocument(document)).toEqual(document);
  expect(inspectDocument(document).passed).toBe(true);
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content.map((item) => item.text).join("\n");
}

describe("design layout primitives", () => {
  it("centres odd and even remainders exactly", () => {
    const odd = alignLayers([rect("odd", 20, 20, 20)], { ...container, width: 101 }, {
      horizontal: "center",
      safeMargin: 0,
    });
    const even = alignLayers([rect("even", 20, 20, 21)], { ...container, width: 101 }, {
      horizontal: "center",
      safeMargin: 0,
    });

    expect(odd[0].frame.x).toBe(40.5);
    expect(even[0].frame.x).toBe(40);
    expectClean(odd, { ...canvas, width: 101, safeMargin: 0 });
    expectClean(even, { ...canvas, width: 101, safeMargin: 0 });
  });

  it("keeps start and end alignment inside the safe margin", () => {
    const source = [rect("block", 20, 20, 40, 20)];
    const start = alignLayers(source, container, { horizontal: "start", safeMargin: 20 });
    const end = alignLayers(source, container, { horizontal: "end", safeMargin: 20 });

    expect(start[0].frame.x).toBe(20);
    expect(end[0].frame.x + end[0].frame.width).toBe(200);
    expectClean(start);
    expectClean(end);
  });

  it("keeps text SVG anchoring consistent with horizontal alignment", () => {
    const source = [text("copy")];
    const start = alignLayers(source, container, { horizontal: "start", safeMargin: 20 });
    const center = alignLayers(source, container, { horizontal: "center", safeMargin: 20 });
    const end = alignLayers(source, container, { horizontal: "end", safeMargin: 20 });

    expect(start[0]).toMatchObject({ align: "start", frame: { x: 20 } });
    expect(center[0]).toMatchObject({ align: "middle", frame: { x: 50 } });
    expect(end[0]).toMatchObject({ align: "end", frame: { x: 80 } });
    expectClean(start);
    expectClean(center);
    expectClean(end);
  });

  it("distributes 0, 1, 2, and 5 layers without NaN and deterministically", () => {
    for (const count of [0, 1, 2, 5]) {
      const layers = Array.from({ length: count }, (_, index) => rect(`r${index}`));
      const first = distributeLayers(layers, container, {
        axis: "x",
        mode: "space-around",
        safeMargin: 20,
      });
      const second = distributeLayers(layers, container, {
        axis: "x",
        mode: "space-around",
        safeMargin: 20,
      });

      expect(first).toEqual(second);
      expect(first.every((layer) => Number.isFinite(layer.frame.x))).toBe(true);
      expectClean(first);
    }
  });

  it("puts space-between endpoints flush to safe container edges", () => {
    const result = distributeLayers(
      Array.from({ length: 5 }, (_, index) => rect(`r${index}`)),
      container,
      { axis: "x", mode: "space-between", safeMargin: 20 },
    );

    expect(result.map((layer) => layer.frame.x)).toEqual([20, 60, 100, 140, 180]);
    expect(result.at(-1)?.frame.x + result.at(-1)?.frame.width).toBe(200);
    expectClean(result);
  });

  it("honours fixed gaps exactly", () => {
    const result = distributeLayers([rect("a"), rect("b"), rect("c")], container, {
      axis: "x",
      mode: "fixed-gap",
      gap: 15,
      safeMargin: 20,
    });

    expect(result.map((layer) => layer.frame.x)).toEqual([20, 55, 90]);
    expect(result[1].frame.x - (result[0].frame.x + result[0].frame.width)).toBe(15);
    expect(result[2].frame.x - (result[1].frame.x + result[1].frame.width)).toBe(15);
    expectClean(result);
  });

  it("stacks using measured text height instead of excess text-frame height", () => {
    const copy = text("copy", 70, 20, 120, 160, "Hi");
    const result = stackLayers([copy, rect("next", 80, 20, 40, 20)], {
      origin: { x: 20, y: 20 },
      axis: "y",
      gap: 12,
      container,
      safeMargin: 20,
    });
    const measured = measureTextBlock("Hi", {
      fontSize: 20,
      lineHeight: 1.2,
      letterSpacing: 0,
    }).height;

    expect(measured).toBe(24);
    expect(result[0].frame.x).toBe(20);
    expect(result[1].frame.x).toBe(20);
    expect(result[1].frame.y).toBe(20 + measured + 12);
    expect(result[1].frame.y).not.toBe(20 + copy.frame.height + 12);
    expectClean(result);
  });

  it("uses semantic rhythm to occupy the lower portion of a tall canvas", () => {
    const tallCanvas = { width: 240, height: 800, safeMargin: 40 };
    const tallContainer = { x: 0, y: 0, width: 240, height: 800 };
    const result = distributeVerticalRhythm([
      text("eyebrow", 40, 40, 160, 30, "EYEBROW"),
      text("headline", 40, 40, 160, 50, "Headline"),
      rect("visual", 40, 40, 160, 90),
      text("footer", 40, 40, 160, 30, "Footer"),
    ], tallContainer, {
      anchors: ["top", "upper-middle", "remaining-space", "bottom"],
      safeMargin: 40,
    });
    const contentBounds = result.reduce((bounds, layer) => {
      const visibleHeight = layer.type === "text"
        ? measureTextBlock(layer.text, {
            fontSize: layer.fontSize,
            lineHeight: layer.lineHeight,
            letterSpacing: layer.letterSpacing,
          }).height
        : layer.frame.height;
      return {
        top: Math.min(bounds.top, layer.frame.y),
        bottom: Math.max(bounds.bottom, layer.frame.y + visibleHeight),
      };
    }, { top: Number.POSITIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY });

    expect(contentBounds.top).toBe(40);
    expect(contentBounds.bottom).toBeGreaterThan(720);
    expect(contentBounds.bottom - contentBounds.top).toBeGreaterThan(600);
    expectClean(result, tallCanvas);
  });

  it("returns a passing QA report through arrange_design_layers MCP", async () => {
    const server = createServer({ penpotBaseUrl: "http://localhost:9001" });
    const client = new Client({ name: "layout-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const document = documentFor([text("title", 20, 30), text("subtitle", 20, 80)]);
      const result = await client.callTool({
        name: "arrange_design_layers",
        arguments: {
          document,
          pageId: "page",
          layerIds: ["title", "subtitle"],
          operation: { type: "align", horizontal: "center" },
        },
      });
      const body = JSON.parse(textOf(result));

      expect(body.qa.passed).toBe(true);
      expect(body.document.pages[0].layers.map((layer: DesignLayer) => layer.align)).toEqual([
        "middle",
        "middle",
      ]);
      expect(parseDesignDocument(body.document)).toEqual(body.document);
    } finally {
      await client.close();
    }
  });
});
