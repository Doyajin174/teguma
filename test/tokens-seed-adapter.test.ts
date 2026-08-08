/**
 * SEED → canonical 어댑터 테스트 (명세 5.2).
 *
 * - light/dark 병합(logical token), alias(resolved/unresolved: missing·circular),
 *   rem→px conversion, radius/duration/percent, unsupported/lossy 보고.
 * - 기존 transformSeedRootage 결과와 mode·참조·단위가 회귀 없이 일치하는지
 *   교차 검증(5.2 "기존 결과 회귀 금지").
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readSeedRootageFile,
  transformSeedRootage,
  type SeedRootageFile,
  type SeedTokenEntry,
} from "../src/design/seed.js";
import {
  assertCanonicalDocumentSorted,
  transformSeedRootageToCanonical,
} from "../src/tokens/index.js";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/seed-rootage-canonical.yaml", import.meta.url));
const LEGACY_FIXTURE_PATH = fileURLToPath(new URL("./fixtures/seed-rootage.yaml", import.meta.url));

function loadFixture(): SeedRootageFile {
  return readSeedRootageFile(FIXTURE_PATH);
}

function tokenOf(doc: ReturnType<typeof transformSeedRootageToCanonical>, id: string) {
  const token = doc.tokens.find((candidate) => candidate.id === id);
  if (token === undefined) throw new Error(`missing canonical token ${id}`);
  return token;
}

describe("SEED → canonical 어댑터", () => {
  it("문서 뼈대와 정렬 규칙을 지킨다 (4.1·4.8)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());
    expect(doc.schemaVersion).toBe("0.1.0");
    expect(doc.document).toEqual({
      id: "canonical:seed:canonical-seed-poc",
      sourceAdapter: "seed",
      sourceName: "Canonical Seed POC",
    });
    assertCanonicalDocumentSorted(doc);
  });

  it("같은 path의 light/dark를 한 logical 토큰의 values에 병합한다 (4.2)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());
    const carrot = tokenOf(doc, "seed:$color.palette.carrot-600");
    expect(Object.keys(carrot.values)).toEqual(["light", "dark"]);
    expect(carrot.provenance).toMatchObject({
      adapter: "seed",
      sourcePath: "$color.palette.carrot-600",
      sourceId: "canonical-seed-poc",
      collection: "color",
    });
    expect(carrot.semanticRole).toBeUndefined(); // 5.2 — rootage에 role 개념 없음

    const light = carrot.values.light;
    const dark = carrot.values.dark;
    expect(light?.status).toBe("resolved");
    if (light?.status === "resolved") {
      expect(light.raw).toBe("#ff6600");
      expect(light.resolvedValue.resolvedValue.value).toMatchObject({
        colorSpace: "srgb",
        components: [255, 102, 0],
        alpha: 1,
        hex: "#ff6600",
      });
    }
    if (dark?.status === "resolved") {
      expect(dark.raw).toBe("#e65200");
    }
  });

  it("alias는 logical id 참조로 보존하고 해석 결과를 기록한다 (4.3)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());
    const gutter = tokenOf(doc, "seed:$dimension.spacing-x.global-gutter");
    const value = gutter.values.default;
    expect(value?.status).toBe("resolved");
    if (value?.status === "resolved") {
      expect(value.raw).toBe("$dimension.x4");
      expect(value.alias).toEqual({ ref: "seed:$dimension.x4", resolved: true });
      expect(value.resolvedValue.resolvedValue).toEqual({ value: 16, unit: "px" });
    }
    expect(gutter.description).toBe("화면 전체에 적용되는 기본 수평 padding 값입니다.");
    expect(gutter.kind).toBe("spacing"); // 10.1 예시 — resolved dimension은 kind spacing
  });

  it("rem→px 환산을 sourceValue/resolvedValue/conversion으로 보존한다 (4.4)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());
    const t1 = tokenOf(doc, "seed:$font-size.t1");
    const value = t1.values.default;
    expect(value?.status).toBe("resolved");
    if (value?.status === "resolved") {
      expect(value.resolvedValue.sourceValue).toEqual({ value: 0.6875, unit: "rem" });
      expect(value.resolvedValue.resolvedValue).toEqual({ value: 11, unit: "px" });
      expect(value.resolvedValue.conversion).toEqual({ kind: "rem-to-px", rootFontSizePx: 16 });
    }
  });

  it("미존재 참조는 unresolved(missing), 순환 참조는 unresolved(circular) (4.3)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());

    const breakpoint = tokenOf(doc, "seed:$dimension.breakpoint.md");
    expect(breakpoint.kind).toBeUndefined(); // 값이 전부 unresolved — kind 생략
    expect(breakpoint.values.default).toMatchObject({
      status: "unresolved",
      raw: "$dimension.breakpoint.not-found",
      alias: { ref: "seed:$dimension.breakpoint.not-found", resolved: false, reason: "missing" },
    });

    const circularA = tokenOf(doc, "seed:$dimension.circular-a");
    const circularB = tokenOf(doc, "seed:$dimension.circular-b");
    expect(circularA.values.default).toMatchObject({
      status: "unresolved",
      alias: { ref: "seed:$dimension.circular-b", resolved: false, reason: "circular" },
    });
    expect(circularB.values.default).toMatchObject({
      status: "unresolved",
      alias: { ref: "seed:$dimension.circular-a", resolved: false, reason: "circular" },
    });
  });

  it("radius/duration을 5.2 매핑대로 변환한다", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());
    const radius = tokenOf(doc, "seed:$radius.r2");
    expect(radius.type).toBe("dimension");
    expect(radius.kind).toBe("radius");
    if (radius.values.default?.status === "resolved") {
      expect(radius.values.default.resolvedValue.resolvedValue).toEqual({ value: 8, unit: "px" });
    }

    const duration = tokenOf(doc, "seed:$duration.d3");
    expect(duration.type).toBe("duration");
    if (duration.values.default?.status === "resolved") {
      expect(duration.values.default.resolvedValue.resolvedValue).toEqual({ value: 150, unit: "ms" });
    }
  });

  it("% line-height를 비율로 정규화하고 percent-to-ratio를 기록한다 (4.4)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());
    const percent = tokenOf(doc, "seed:$line-height.percent");
    expect(percent.type).toBe("number");
    expect(percent.kind).toBe("line-height");
    if (percent.values.default?.status === "resolved") {
      expect(percent.values.default.resolvedValue.sourceValue).toEqual({ value: 150, unit: "%" });
      expect(percent.values.default.resolvedValue.resolvedValue).toEqual({ value: 1.5 });
      expect(percent.values.default.resolvedValue.conversion).toEqual({ kind: "percent-to-ratio" });
    }

    const ratio = tokenOf(doc, "seed:$line-height.ratio");
    if (ratio.values.default?.status === "resolved") {
      expect(ratio.values.default.resolvedValue.conversion).toBeUndefined();
      expect(ratio.values.default.resolvedValue.resolvedValue).toEqual({ value: 1.5 });
    }
  });

  it("unsupported 범주·구조화 값은 importLoss에 구조 보존으로 보고한다 (4.6)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());

    const shadow = doc.importLoss.unsupported.find((item) => item.path === "$shadow.s1");
    expect(shadow).toMatchObject({
      code: "unsupported-category",
      reason: expect.stringContaining("shadow"),
      raw: { values: { "theme-light": { type: "shadow", value: ["0px", "1px"] } } },
    });
    expect(shadow?.mode).toBeUndefined(); // 범주 수준 실패 — mode 구분 없음

    const gradient = doc.importLoss.unsupported.find((item) => item.path === "$color.gradient.hero");
    expect(gradient).toMatchObject({
      mode: "light",
      code: "unsupported-category",
      raw: { values: { "theme-light": { from: "#ff6600", to: "#000000" } } },
    });
    expect(tokenOfSafe(doc, "seed:$color.gradient.hero")).toBeUndefined();
  });

  it("비표준 단위는 토큰을 보존하고 lossy(nonstandard-unit)로 보고한다 (4.4)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture());
    const vw = tokenOf(doc, "seed:$dimension.vw");
    if (vw.values.default?.status === "resolved") {
      expect(vw.values.default.resolvedValue.sourceValue).toEqual({ value: "2vw" });
    }
    const lossy = doc.importLoss.lossy.find((item) => item.path === "$dimension.vw");
    expect(lossy).toMatchObject({
      tokenId: "seed:$dimension.vw",
      mode: "default",
      code: "nonstandard-unit",
      original: "2vw",
    });
  });

  it("mode 필터: theme-light는 color를 light로 제한하고 global은 default 유지", () => {
    const doc = transformSeedRootageToCanonical(loadFixture(), { mode: "theme-light" });
    const carrot = tokenOf(doc, "seed:$color.palette.carrot-600");
    expect(Object.keys(carrot.values)).toEqual(["light"]);
    expect(carrot.values.dark).toBeUndefined();
    const t1 = tokenOf(doc, "seed:$font-size.t1");
    expect(Object.keys(t1.values)).toEqual(["default"]);
  });

  it("mode 필터: default 요청 시 color 토큰은 missing-mode로 보고된다 (5.2)", () => {
    const doc = transformSeedRootageToCanonical(loadFixture(), { mode: "default" });
    expect(tokenOfSafe(doc, "seed:$color.palette.carrot-600")).toBeUndefined();
    const items = doc.importLoss.unsupported.filter((item) => item.code === "missing-mode");
    // gray-00 / gray-1000 / carrot-600 / gradient.hero (color 컬렉션 4종)
    expect(items.map((item) => item.path).sort()).toEqual([
      "$color.gradient.hero",
      "$color.palette.carrot-600",
      "$color.palette.gray-00",
      "$color.palette.gray-1000",
    ]);
    expect(items.find((item) => item.path === "$color.palette.carrot-600")).toMatchObject({
      mode: "default",
      code: "missing-mode",
    });
  });

  it("기존 transformSeedRootage 결과와 mode·참조·단위가 회귀 없이 일치한다", () => {
    // 순환 참조가 없는 기존 fixture 기준으로 교차 검증
    const rootage = readSeedRootageFile(LEGACY_FIXTURE_PATH);
    const legacy = transformSeedRootage(rootage, { mode: "theme-light" });
    const canonical = transformSeedRootageToCanonical(rootage, { mode: "theme-light" });

    for (const entry of legacy.manifest.tokens) {
      const token = tokenOfSafe(canonical, `seed:${entry.path}`);
      expect(token, `missing canonical token for ${entry.path}`).toBeDefined();
      if (token === undefined) continue;
      const modeName = entry.mode === "theme-light" ? "light" : entry.mode === "theme-dark" ? "dark" : "default";
      const modeValue = token.values[modeName];
      expect(modeValue?.status, `${entry.path} should be resolved in ${modeName}`).toBe("resolved");
      if (modeValue?.status !== "resolved") continue;
      const canonicalValue = modeValue.resolvedValue;
      assertLegacyMatchesCanonical(entry, canonicalValue);
    }
  });
});

function tokenOfSafe(doc: ReturnType<typeof transformSeedRootageToCanonical>, id: string) {
  return doc.tokens.find((candidate) => candidate.id === id);
}

/** 기존 manifest 토큰 ↔ canonical resolvedValue의 값·단위·환산 일치 검증. */
function assertLegacyMatchesCanonical(
  entry: SeedTokenEntry,
  canonicalValue: { sourceValue: unknown; resolvedValue: unknown; conversion?: unknown },
): void {
  const source = canonicalValue.sourceValue as { value: unknown; unit?: string };
  const resolved = canonicalValue.resolvedValue as { value: unknown; unit?: string };
  const conversion = canonicalValue.conversion as
    | { kind: string; rootFontSizePx?: number }
    | undefined;

  switch (entry.category) {
    case "color":
      expect((resolved.value as { hex: string }).hex).toBe(entry.value);
      break;
    case "font-family":
      expect(resolved.value).toBe(entry.value);
      break;
    case "font-weight":
      expect(resolved.value).toBe(entry.value);
      break;
    default: {
      // 길이 계열: 해석 값(px 수치)과 원문 단위·환산 기준 일치
      expect(resolved.value).toBe(entry.value);
      if (entry.unit !== undefined) {
        expect(source.unit).toBe(entry.unit);
      }
      if (entry.conversion !== undefined) {
        expect(conversion?.kind).toBe("rem-to-px");
        expect(conversion?.rootFontSizePx).toBe(entry.conversion.rootFontSizePx);
      }
    }
  }
}
