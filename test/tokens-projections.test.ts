/**
 * canonical → BrandKit/DesignDocument(6.2) · Astryx(6.3) projection 테스트.
 *
 * - 4.2 mode 해석(요청 mode → default, light↔dark 교차 fallback 없음).
 * - Astryx: explicit만 registry 매칭, mapped 자동 매핑 금지, id 기반 override,
 *   충돌(M3) + loss.ambiguous, missing-light/missing-dark 세분 code.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readSeedRootageFile,
  transformSeedRootage,
} from "../src/design/seed.js";
import type { PenpotFile } from "../src/penpot/types.js";
import {
  parseCanonicalDocument,
  projectToAstryxTheme,
  projectToBrandKit,
  projectToDesignDocument,
  transformPenpotFileToCanonical,
  transformSeedRootageToCanonical,
} from "../src/tokens/index.js";
import penpotFixture from "./fixtures/penpot-canonical.json";

const CANONICAL_FIXTURE_PATH = fileURLToPath(new URL("./fixtures/canonical-token-document.json", import.meta.url));
const SEED_FIXTURE_PATH = fileURLToPath(new URL("./fixtures/seed-rootage-canonical.yaml", import.meta.url));
const LEGACY_SEED_FIXTURE_PATH = fileURLToPath(new URL("./fixtures/seed-rootage.yaml", import.meta.url));

function loadCanonicalFixture() {
  return parseCanonicalDocument(readFileSync(CANONICAL_FIXTURE_PATH, "utf8"));
}

describe("canonical → BrandKit projection (6.2)", () => {
  it("mode 해석 후 palette·fonts를 구성하고 소비 불가 타입은 unsupported로 보고한다", () => {
    const result = projectToBrandKit(loadCanonicalFixture(), { mode: "light" });

    expect(result.value).not.toBeNull();
    expect(result.value?.palette).toEqual([
      { id: "color.palette.carrot-600", name: "carrot-600", value: "#ff6600" },
      { id: "color.state.error", name: "error", value: "#dc2626" },
      { id: "color.state.error-alt", name: "error-alt", value: "#ff0000" },
      { id: "color.state.warning", name: "warning", value: "#d97706" },
      { id: "color.surface.card", name: "card", value: "#f9fafb" },
      { id: "color.text.primary", name: "primary", value: "#1f2937" },
    ]);
    expect(result.value?.fonts).toEqual([{ family: "Pretendard", weights: [400] }]);

    expect(result.loss.lossy).toContainEqual(
      expect.objectContaining({ path: "fonts", code: "weight-union" }),
    );
    const unsupportedPaths = result.loss.unsupported.map((item) => item.path).sort();
    expect(unsupportedPaths).toEqual([
      "$dimension.breakpoint.md",
      "$dimension.x1",
      "$dimension.x2",
      "$dimension.x3",
      "$duration.d3",
      "$font-size.t1",
      "$line-height.t1",
    ]);
  });

  it("dark mode는 dark 값을 선택하고, mode·default 모두 없으면 missing-mode (4.2)", () => {
    const result = projectToBrandKit(loadCanonicalFixture(), { mode: "dark" });
    expect(result.value?.palette.map((color) => color.value)).toEqual([
      "#e65200",
      "#f59e0b",
      "#f3f4f6",
    ]);
    const missing = result.loss.ambiguous.filter((item) => item.code === "missing-mode");
    expect(missing.map((item) => item.path).sort()).toEqual([
      "$color.state.error",
      "$color.state.error-alt",
      "$color.surface.card",
    ]);
  });

  it("default 요청에서 color가 없으면 palette 생략 — 기존 SEED 정책 유지 (6.2)", () => {
    const result = projectToBrandKit(loadCanonicalFixture(), { mode: "default" });
    expect(result.value).toBeNull();
    expect(result.loss.ambiguous).toHaveLength(6);
  });
});

describe("canonical → DesignDocument projection (6.2)", () => {
  it("SEED 어댑터 문서에서 대표 문서를 재현한다 (buildSeedDocument 일반화)", () => {
    const seedDoc = transformSeedRootageToCanonical(readSeedRootageFile(SEED_FIXTURE_PATH));
    const result = projectToDesignDocument(seedDoc, { mode: "light" });

    expect(result.value).not.toBeNull();
    const document = result.value!;
    expect(document.canvas.safeMargin).toBe(16);
    expect(document.pages[0].background).toBe("#1a1c20");
    const textLayer = document.pages[0].layers.find((layer) => layer.type === "text");
    expect(textLayer).toMatchObject({
      type: "text",
      text: "SEED POC",
      fontFamily: "Pretendard",
      fontSize: 11,
      fontWeight: 400,
      color: "#ff6600",
      lineHeight: 15 / 11,
      letterSpacing: 0,
    });
    expect(result.loss.ambiguous).toHaveLength(0);
  });

  it("필수 토큰이 없으면 null + lossy(missing-document-token)", () => {
    const result = projectToDesignDocument(loadCanonicalFixture(), { mode: "light" });
    expect(result.value).toBeNull();
    const missing = result.loss.lossy.filter((item) => item.code === "missing-document-token");
    expect(missing.map((item) => item.path).sort()).toEqual([
      "$color.palette.gray-1000",
      "$dimension.spacing-x.global-gutter",
    ]);
  });
});

describe("canonical → Astryx theme draft (6.3)", () => {
  it("explicit role만 registry 매칭 — mapped role은 자동 매핑하지 않는다", () => {
    const result = projectToAstryxTheme(loadCanonicalFixture());
    const draft = result.value;

    expect(draft.light).toMatchObject({
      "--color-text-primary": "#1f2937",
      "--color-state-warning": "#d97706",
      "--color-background-elevated": "#f9fafb",
      "--spacing-1": "4px",
      "--spacing-2": "8px",
      "--spacing-3": "12px",
    });
    // error vs error-alt 충돌 → 변수 생략(M3), 어떤 값도 복원되지 않는다
    expect(draft.light?.["--color-state-error"]).toBeUndefined();
    expect(draft.dark).toMatchObject({
      "--color-text-primary": "#f3f4f6",
      "--color-state-warning": "#f59e0b",
    });

    // mapped(carrot-600)는 추측 금지 → unmapped + MISSING_ROLE
    const carrotMapping = draft.mapping.find(
      (entry) => entry.sourceToken === "$color.palette.carrot-600",
    );
    expect(carrotMapping?.status).toBe("unmapped");
    expect(draft.warnings.some(
      (warning) => warning.code === "MISSING_ROLE" && warning.sourceToken === "$color.palette.carrot-600",
    )).toBe(true);

    // 타이포그래피·spacing — 현행 규칙 유지
    expect(draft.typography).toMatchObject({
      "--font-size-t1": "11px",
      "--font-weight-t1": 400,
      "--line-height-t1": 1.5,
      "--font-family-pretendard": "Pretendard",
      "--font-size-base": "11px",
    });
  });

  it("충돌은 mapping conflict + loss.ambiguous 병기, mode 누락은 missing-* 세분 code", () => {
    const result = projectToAstryxTheme(loadCanonicalFixture());

    const conflicts = result.value.mapping.filter((entry) => entry.status === "conflict");
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
    expect(result.loss.ambiguous.some((item) => item.code === "conflict")).toBe(true);

    const missingDark = result.loss.ambiguous.filter((item) => item.code === "missing-dark");
    expect(missingDark.map((item) => item.path).sort()).toEqual([
      "$color.state.error",
      "$color.state.error-alt",
      "$color.surface.card",
    ]);
    // 기존 MISSING_DARK_MODE/MISSING_LIGHT_MODE 경고는 loss로 대체된다 (6.3)
    expect(result.value.warnings.some(
      (warning) => warning.code === "MISSING_DARK_MODE" || warning.code === "MISSING_LIGHT_MODE",
    )).toBe(false);

    expect(result.loss.unsupported.map((item) => item.path).sort()).toEqual([
      "$dimension.breakpoint.md",
      "$duration.d3",
    ]);
  });

  it("roleOverrides는 canonical id(logical)를 참조한다", () => {
    const result = projectToAstryxTheme(loadCanonicalFixture(), {
      roleOverrides: [{ token: "seed:$color.palette.carrot-600", role: "state-info" }],
    });
    expect(result.value.light?.["--color-state-info"]).toBe("#ff6600");
    expect(result.value.dark?.["--color-state-info"]).toBe("#e65200");

    const mapped = result.value.mapping.find(
      (entry) => entry.sourceToken === "$color.palette.carrot-600" && entry.status === "mapped",
    );
    expect(mapped?.astryxToken).toBe("--color-state-info");
  });

  it("SEED 어댑터 문서: role 부재 토큰은 전부 unmapped, override만 매핑된다", () => {
    const seedDoc = transformSeedRootageToCanonical(readSeedRootageFile(SEED_FIXTURE_PATH));
    const result = projectToAstryxTheme(seedDoc);

    expect(Object.keys(result.value.light ?? {}).some((key) => key.startsWith("--color-"))).toBe(false);
    expect(result.value.mapping.filter((entry) => entry.status === "mapped").every(
      (entry) => entry.astryxToken?.startsWith("--spacing-") || entry.astryxToken?.startsWith("--font-") || entry.astryxToken?.startsWith("--line-"),
    )).toBe(true);
    expect(result.value.light).toMatchObject({
      "--spacing-1": "4px",
      "--spacing-2": "8px",
      "--spacing-4": "16px",
    });

    const overridden = projectToAstryxTheme(seedDoc, {
      roleOverrides: [{ token: "seed:$color.palette.carrot-600", role: "state-warning" }],
    });
    expect(overridden.value.light?.["--color-state-warning"]).toBe("#ff6600");
    expect(overridden.value.dark?.["--color-state-warning"]).toBe("#e65200");
  });

  it("Penpot 어댑터 문서: mapped role은 자동 확정되지 않고 spacing·typography는 매핑된다", () => {
    const penpotDoc = transformPenpotFileToCanonical(penpotFixture as PenpotFile);
    const result = projectToAstryxTheme(penpotDoc);
    const draft = result.value;

    expect(Object.keys(draft.light ?? {}).some((key) => key.startsWith("--color-"))).toBe(false);
    expect(draft.warnings.some((warning) => warning.code === "MISSING_ROLE")).toBe(true);
    expect(draft.light).toMatchObject({
      "--spacing-1": "8px",
      "--spacing-2": "16px",
      "--spacing-3": "24px",
    });
    expect(draft.typography).toMatchObject({
      "--font-size-body": "16px",
      "--font-weight-body": 400,
      "--line-height-body": 1.5,
      "--font-size-display": "40px",
      "--font-weight-display": 700,
      "--line-height-display": 48,
      "--font-size-base": "40px",
    });

    // 불투명도·letterSpacing은 구조화 loss로 보고
    expect(result.loss.lossy.some((item) => item.code === "alpha-dropped")).toBe(true);
    expect(result.loss.lossy.some(
      (item) => item.code === "dropped-property" && item.path === "Typography/Body",
    )).toBe(true);
  });

  it("기존 convertPenpotTokensToAstryx 출력 형태(AstryxThemeDraft)를 유지한다", () => {
    const result = projectToAstryxTheme(loadCanonicalFixture());
    const draft = result.value;
    expect(typeof draft.baseTheme).toBe("string");
    expect(Array.isArray(draft.mapping)).toBe(true);
    expect(Array.isArray(draft.warnings)).toBe(true);
    for (const entry of draft.mapping) {
      expect(entry).toHaveProperty("sourceToken");
      expect(entry).toHaveProperty("status");
      expect(["mapped", "unmapped", "conflict"]).toContain(entry.status);
    }
  });
});

describe("회귀 — 기존 SEED 변환과 canonical projection의 값 일치", () => {
  it("BrandKit projection(light)은 기존 transformSeedRootage brandKit과 동일 팔레트를 낸다", () => {
    const rootage = readSeedRootageFile(LEGACY_SEED_FIXTURE_PATH);
    const legacy = transformSeedRootage(rootage, { mode: "theme-light" });
    const canonical = transformSeedRootageToCanonical(rootage);
    const projected = projectToBrandKit(canonical, { mode: "light" });

    expect(projected.value?.palette.map((color) => color.value).sort()).toEqual(
      legacy.brandKit?.palette.map((color) => color.value).sort(),
    );
  });
});
