/**
 * Penpot → canonical 어댑터 테스트 (명세 5.1).
 *
 * - coarse role → semanticRole confidence "mapped" 보존(추측 금지 표시).
 * - 불투명도(@NN%) → alpha + lossy, gradient → unsupported.
 * - typography 속성별 분해(font-size/font-weight/line-height/letter-spacing),
 *   textTransform → lossy(dropped-property).
 * - spacing 추론 → kind "spacing" 토큰 + lossy("추론").
 */

import { describe, expect, it } from "vitest";
import type { PenpotFile } from "../src/penpot/types.js";
import {
  assertCanonicalDocumentSorted,
  transformPenpotFileToCanonical,
} from "../src/tokens/index.js";
import penpotFixture from "./fixtures/penpot-canonical.json";

function tokenOf(doc: ReturnType<typeof transformPenpotFileToCanonical>, id: string) {
  const token = doc.tokens.find((candidate) => candidate.id === id);
  if (token === undefined) throw new Error(`missing canonical token ${id}`);
  return token;
}

describe("Penpot → canonical 어댑터", () => {
  it("문서 뼈대·mode(default)·정렬 규칙을 지킨다 (4.1·4.8)", () => {
    const doc = transformPenpotFileToCanonical(penpotFixture as PenpotFile);
    expect(doc.document).toEqual({
      id: "canonical:penpot:file-42",
      sourceAdapter: "penpot",
      sourceName: "Canonical Penpot Fixture",
    });
    assertCanonicalDocumentSorted(doc);
    expect(doc.tokens.every((token) => token.values.default !== undefined)).toBe(true);
  });

  it("color의 path/name을 분리 보존하고 role은 mapped로 명시한다 (5.1)", () => {
    const doc = transformPenpotFileToCanonical(penpotFixture as PenpotFile);
    const primary = tokenOf(doc, "penpot:file-42:color-1");
    expect(primary).toMatchObject({
      id: "penpot:file-42:color-1",
      name: "Primary",
      path: "Brand/Primary",
      type: "color",
      semanticRole: { role: "primary", confidence: "mapped" },
      provenance: { adapter: "penpot", sourcePath: "Brand/Primary", sourceId: "color-1" },
    });
    if (primary.values.default?.status === "resolved") {
      expect(primary.values.default.raw).toBe("#ff6600");
      expect(primary.values.default.resolvedValue.resolvedValue.value).toMatchObject({
        colorSpace: "srgb",
        components: [255, 102, 0],
        alpha: 1,
        hex: "#ff6600",
      });
    }

    // role 추론이 없는 색상은 semanticRole 생략
    const muted = tokenOf(doc, "penpot:file-42:color-4");
    expect(muted.semanticRole).toBeUndefined();
  });

  it("불투명도(@NN%)는 alpha로 변환하고 lossy로 보고한다 (5.1)", () => {
    const doc = transformPenpotFileToCanonical(penpotFixture as PenpotFile);
    const overlay = tokenOf(doc, "penpot:file-42:color-2");
    if (overlay.values.default?.status === "resolved") {
      expect(overlay.values.default.resolvedValue.resolvedValue.value).toMatchObject({
        alpha: 0.8,
        hex: "#000000",
      });
    }
    const item = doc.importLoss.lossy.find((loss) => loss.path === "Brand/Overlay");
    expect(item).toMatchObject({
      tokenId: "penpot:file-42:color-2",
      mode: "default",
      code: "opacity-to-alpha",
      original: "#000000 @80%",
    });
  });

  it("gradient는 unsupported로 보고하고 토큰을 생성하지 않는다 (5.1)", () => {
    const doc = transformPenpotFileToCanonical(penpotFixture as PenpotFile);
    const item = doc.importLoss.unsupported.find((loss) => loss.path === "Brand/HeroGradient");
    expect(item).toMatchObject({
      mode: "default",
      code: "unsupported-category",
      reason: expect.stringContaining("gradient"),
      raw: { type: "linear", stops: expect.any(Array) },
    });
    expect(doc.tokens.some((token) => token.id.includes("color-3"))).toBe(false);
  });

  it("typography를 속성별 토큰으로 분해한다 (5.1)", () => {
    const doc = transformPenpotFileToCanonical(penpotFixture as PenpotFile);
    const ids = doc.tokens
      .filter((token) => token.id.startsWith("penpot:file-42:typo-1"))
      .map((token) => token.id);
    expect(ids).toEqual([
      "penpot:file-42:typo-1:font-size",
      "penpot:file-42:typo-1:font-weight",
      "penpot:file-42:typo-1:letter-spacing",
      "penpot:file-42:typo-1:line-height",
    ]);

    const fontSize = tokenOf(doc, "penpot:file-42:typo-1:font-size");
    expect(fontSize).toMatchObject({ type: "dimension", kind: "font-size", path: "Typography/Body" });
    if (fontSize.values.default?.status === "resolved") {
      expect(fontSize.values.default.resolvedValue.resolvedValue).toEqual({ value: 16, unit: "px" });
    }

    const lineHeight = tokenOf(doc, "penpot:file-42:typo-1:line-height");
    expect(lineHeight).toMatchObject({ type: "number", kind: "line-height" });

    const displayLineHeight = tokenOf(doc, "penpot:file-42:typo-2:line-height");
    expect(displayLineHeight).toMatchObject({ type: "dimension", kind: "line-height" });
    if (displayLineHeight.values.default?.status === "resolved") {
      expect(displayLineHeight.values.default.resolvedValue.resolvedValue).toEqual({ value: 48, unit: "px" });
    }

    const letterSpacing = tokenOf(doc, "penpot:file-42:typo-1:letter-spacing");
    expect(letterSpacing).toMatchObject({ type: "dimension", kind: "letter-spacing" });
    if (letterSpacing.values.default?.status === "resolved") {
      expect(letterSpacing.values.default.resolvedValue.resolvedValue).toEqual({ value: 0.5, unit: "px" });
    }
  });

  it("textTransform은 lossy(dropped-property)로 보고한다 (5.1·10.2)", () => {
    const doc = transformPenpotFileToCanonical(penpotFixture as PenpotFile);
    const item = doc.importLoss.lossy.find((loss) => loss.code === "dropped-property");
    expect(item).toMatchObject({
      tokenId: "penpot:file-42:typo-1:font-size",
      path: "Typography/Body",
      mode: "default",
      code: "dropped-property",
      reason: expect.stringContaining("textTransform"),
      original: "uppercase",
    });
  });

  it("spacing 추론(baseUnit·scale)을 kind spacing 토큰 + lossy로 보고한다 (5.1)", () => {
    const doc = transformPenpotFileToCanonical(penpotFixture as PenpotFile);
    const spacingIds = doc.tokens
      .filter((token) => token.id.startsWith("penpot:file-42:spacing:"))
      .map((token) => token.id);
    // base + scale [8, 16, 24]
    expect(spacingIds).toEqual([
      "penpot:file-42:spacing:16",
      "penpot:file-42:spacing:24",
      "penpot:file-42:spacing:8",
      "penpot:file-42:spacing:base",
    ]);

    const base = tokenOf(doc, "penpot:file-42:spacing:base");
    expect(base).toMatchObject({ type: "dimension", kind: "spacing", name: "base" });
    if (base.values.default?.status === "resolved") {
      expect(base.values.default.resolvedValue.resolvedValue).toEqual({ value: 8, unit: "px" });
    }

    const inferred = doc.importLoss.lossy.filter((loss) => loss.code === "inferred-spacing");
    expect(inferred).toHaveLength(4);
    expect(inferred[0]).toMatchObject({
      code: "inferred-spacing",
      reason: expect.stringContaining("추론"),
      original: { baseUnit: 8, scale: [8, 16, 24] },
    });
  });
});
