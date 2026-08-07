import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  autoLayoutDocument,
  inspectDocument,
  parseDesignDocument,
  wrapTextLayers,
} from "../src/design/index.js";
import { createServer } from "../src/server.js";

function textDocument(options: {
  text: string;
  frame: { x: number; y: number; width: number; height: number };
  fontSize: number;
  lineHeight?: number;
  canvas?: { width: number; height: number; safeMargin?: number };
}) {
  return parseDesignDocument({
    id: "autolayout",
    title: "Autolayout",
    canvas: options.canvas ?? { width: 600, height: 600 },
    pages: [{
      id: "page",
      name: "Page",
      background: "#FFFFFF",
      layers: [{
        id: "copy",
        type: "text",
        frame: options.frame,
        text: options.text,
        // Layout mechanics are under test; bundled Plex keeps the fixture on real glyph metrics.
        fontFamily: "IBM Plex Sans KR",
        fontSize: options.fontSize,
        lineHeight: options.lineHeight ?? 1.2,
        color: "#000000",
      }],
    }],
  });
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content.map((item) => item.text).join("\n");
}

describe("design autolayout", () => {
  it("hard-wraps a long Korean paragraph without mutating the source and passes QA", () => {
    const document = textDocument({
      text: "미리캔버스처럼 긴 한국어 문단도 자동으로 프레임 너비에 맞춰 여러 줄로 배치되어야 합니다.",
      frame: { x: 20, y: 20, width: 150, height: 500 },
      fontSize: 28,
    });

    const wrapped = wrapTextLayers(document);
    const result = autoLayoutDocument(document);

    expect(document.pages[0].layers[0]).toMatchObject({ text: expect.not.stringContaining("\n") });
    expect(wrapped.pages[0].layers[0]).toMatchObject({ text: expect.stringContaining("\n") });
    expect(result.changes[0]).toMatchObject({ wrappedLineCount: expect.any(Number), truncated: false });
    expect(result.changes[0].wrappedLineCount).toBeGreaterThan(1);
    expect(inspectDocument(result.document).passed).toBe(true);
  });

  it("shrinks an overflowing headline using the deterministic ladder", () => {
    const document = textDocument({
      text: "ABCDEFGHIJ",
      frame: { x: 20, y: 20, width: 400, height: 90 },
      fontSize: 100,
      lineHeight: 1,
    });

    const result = autoLayoutDocument(document, { onOverflow: "shrink" });

    expect(result.changes).toEqual([expect.objectContaining({
      fontSizeBefore: 100,
      fontSizeAfter: expect.any(Number),
      frameHeightBefore: 90,
      frameHeightAfter: 90,
      truncated: false,
    })]);
    expect(result.changes[0].fontSizeAfter).toBeLessThan(100);
    expect(inspectDocument(result.document).passed).toBe(true);
  });

  it("grows only to the available safe-area height when shrinking reaches the floor", () => {
    const document = textDocument({
      text: "가나다라마바사아자차카타파하",
      frame: { x: 20, y: 50, width: 200, height: 40 },
      fontSize: 30,
      canvas: { width: 300, height: 300, safeMargin: 20 },
    });

    const result = autoLayoutDocument(document, { onOverflow: "grow" });
    const layer = result.document.pages[0].layers[0];

    expect(layer.type).toBe("text");
    expect(layer.frame.height).toBeGreaterThan(40);
    expect(layer.frame.y + layer.frame.height).toBeLessThanOrEqual(280);
    expect(inspectDocument(result.document).passed).toBe(true);
  });

  it("truncates a 200-character unbreakable token with an ellipsis when requested", () => {
    const document = textDocument({
      text: "x".repeat(200),
      frame: { x: 20, y: 20, width: 200, height: 25 },
      fontSize: 30,
      lineHeight: 1,
    });

    const result = autoLayoutDocument(document, { onOverflow: "truncate" });
    const layer = result.document.pages[0].layers[0];

    expect(layer.type).toBe("text");
    expect(layer.text).toMatch(/…$/);
    expect(result.changes).toEqual([expect.objectContaining({ truncated: true })]);
    expect(inspectDocument(result.document).passed).toBe(true);
  });

  it("throws an actionable error when even one glyph cannot fit at the minimum size", () => {
    const document = textDocument({
      text: "가",
      frame: { x: 20, y: 20, width: 5, height: 100 },
      fontSize: 20,
    });

    expect(() => autoLayoutDocument(document)).toThrow(/too small for a single glyph/);
  });

  it("is deterministic across repeated runs", () => {
    const document = textDocument({
      text: "반복 실행해도 같은 줄바꿈과 글자 크기를 선택해야 합니다.",
      frame: { x: 20, y: 20, width: 180, height: 45 },
      fontSize: 30,
    });

    expect(autoLayoutDocument(document)).toEqual(autoLayoutDocument(document));
  });

  it("is idempotent after it has repaired a document", () => {
    const document = textDocument({
      text: "재실행해도 추가 수정이 없어야 하는 자동 레이아웃 문장입니다.",
      frame: { x: 20, y: 20, width: 180, height: 45 },
      fontSize: 30,
    });

    const first = autoLayoutDocument(document);
    const second = autoLayoutDocument(first.document);

    expect(second.document).toEqual(first.document);
    expect(second.changes).toEqual([]);
  });

  it("returns an adjusted document and passing QA report through MCP", async () => {
    const document = textDocument({
      text: "x".repeat(200),
      frame: { x: 20, y: 20, width: 200, height: 25 },
      fontSize: 30,
      lineHeight: 1,
      canvas: { width: 300, height: 300 },
    });
    expect(inspectDocument(document).passed).toBe(false);

    const server = createServer({ penpotBaseUrl: "http://localhost:9001", penpotToken: "test-token" });
    const client = new Client({ name: "test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const response = await client.callTool({
        name: "autolayout_design_document",
        arguments: { document, onOverflow: "truncate" },
      });
      const result = JSON.parse(textOf(response));

      expect(response.isError).not.toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.document.pages[0].layers[0].text).toMatch(/…$/);
      expect(result.qa.passed).toBe(true);
    } finally {
      await client.close();
    }
  });
});
