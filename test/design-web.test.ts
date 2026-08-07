import { describe, expect, it } from "vitest";
import {
  inspectDocument,
  instantiateTemplate,
  parseDesignDocument,
  resizeDocument,
  type DesignDocument,
} from "../src/design/index.js";
import {
  hitTest,
  moveLayer,
  resizeFrame,
  resizeLayer,
} from "../web/editor-logic.js";

const validate = (value: unknown): DesignDocument => parseDesignDocument(value);

function documentFixture(): DesignDocument {
  return parseDesignDocument({
    id: "web-test",
    title: "웹 에디터 테스트",
    canvas: { width: 400, height: 300, unit: "px", safeMargin: 0 },
    pages: [{
      id: "page-1",
      name: "첫 페이지",
      background: "#FFFFFF",
      layers: [
        { id: "back", type: "rect", frame: { x: 10, y: 10, width: 240, height: 120 }, fill: "#11191D" },
        { id: "text", type: "text", frame: { x: 30, y: 30, width: 160, height: 50 }, text: "읽을 수 있는 제목", fontFamily: "IBM Plex Sans KR", fontSize: 24, fontWeight: 600, color: "#FFFFFF", align: "start", lineHeight: 1.2, letterSpacing: 0 },
        { id: "front", type: "rect", frame: { x: 40, y: 40, width: 80, height: 50 }, fill: "#00A653" },
      ],
    }],
  });
}

describe("web editor interaction logic", () => {
  it("hit-tests the topmost layer in draw order", () => {
    const page = documentFixture().pages[0];
    expect(hitTest(page, 50, 50)?.id).toBe("front");
    expect(hitTest(page, 15, 15)?.id).toBe("back");
    expect(hitTest(page, 390, 290)).toBeUndefined();
  });

  it("moves and resizes through a schema revalidation boundary", () => {
    const moved = moveLayer(documentFixture(), "page-1", "front", 24, -12, validate);
    const resized = resizeLayer(moved, "page-1", "front", "se", 35, 20, validate);
    expect(resized.pages[0].layers.find((layer) => layer.id === "front")?.frame).toEqual({ x: 64, y: 28, width: 115, height: 70 });
    expect(() => parseDesignDocument(resized)).not.toThrow();
  });

  it("never permits zero or negative dimensions from resize handles", () => {
    const frame = resizeFrame({ x: 20, y: 30, width: 40, height: 50 }, "nw", 200, 300);
    expect(frame).toEqual({ x: 59, y: 79, width: 1, height: 1 });
    const resized = resizeLayer(documentFixture(), "page-1", "front", "nw", 500, 500, validate);
    const layer = resized.pages[0].layers.find((candidate) => candidate.id === "front");
    expect(layer?.frame.width).toBeGreaterThan(0);
    expect(layer?.frame.height).toBeGreaterThan(0);
  });

  it("reports QA failure after a valid mutation instead of silently accepting it", () => {
    const moved = moveLayer(documentFixture(), "page-1", "text", 300, 0, validate);
    expect(() => parseDesignDocument(moved)).not.toThrow();
    const bounds = inspectDocument(moved).checks.find((check) => check.name === "layers-inside-canvas");
    expect(bounds).toMatchObject({ pass: false });
    expect(bounds?.detail).toContain("page-1/text");
  });

  it.each(["fill", "fit", "original", "adapt"] as const)("switches presets with %s mode", (mode) => {
    const resized = resizeDocument(documentFixture(), { preset: "instagram-square", mode });
    expect(resized.canvas).toMatchObject({ width: 1080, height: 1080, unit: "px" });
    expect(() => parseDesignDocument(resized)).not.toThrow();
  });

  it("instantiates supplied template slots into a QA-passing document", () => {
    const result = instantiateTemplate("card-news-cover", {
      eyebrow: "TEGUMA 디자인 노트",
      headline: "검증 가능한\n웹 에디터",
      body: "편집 결과와 내보내기 결과가 같은 SVG에서 출발합니다.",
      footer: "TEGUMA / EDITOR",
      accentColor: "#00A653",
    });
    expect(result.qa.passed).toBe(true);
    expect(result.filledSlots).toContain("headline");
  });

  it("is deterministic for the same interaction sequence", () => {
    const sequence = () => resizeLayer(
      moveLayer(documentFixture(), "page-1", "front", 12.5, 8.25, validate),
      "page-1", "front", "se", 16, 9, validate,
    );
    expect(sequence()).toEqual(sequence());
  });
});
