/**
 * SEED rootage YAML → BrandKit/DesignDocument 변환 POC 단위 테스트.
 *
 * 이슈 #22 완료 조건을 고정 fixture(test/fixtures/seed-rootage.yaml)로 재현한다:
 * mode 선택(theme-light/theme-dark/default), "$" 참조 순환 해석, rem/px 정규화,
 * BrandKit/DesignDocument 스키마 통과, inspectDocument QA 통과, 결정론, 그리고
 * 오류 케이스(mode 부재·없는 참조·순환 참조·미지원 단위)와 unsupported 보고를 단언한다.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BrandKitSchema,
  DesignDocumentSchema,
  applyBrandKit,
  inspectDocument,
  type TextLayer,
} from "../src/design/index.js";
import {
  SeedError,
  parseRootageYaml,
  readSeedRootageFile,
  transformSeedRootage,
  type SeedMode,
  type SeedRootageFile,
  type SeedTransformResult,
} from "../src/design/seed.js";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/seed-rootage.yaml", import.meta.url));

function loadFixture(): SeedRootageFile {
  return readSeedRootageFile(FIXTURE_PATH);
}

/** 테스트용 인라인 rootage. tokensBody는 `tokens:` 아래 4칸 들여쓰기로 받는다. */
function inlineRootage(collection: string, tokensBody: string): SeedRootageFile {
  return parseRootageYaml(`kind: Tokens
metadata:
  id: inline
  name: Inline
data:
  collection: ${collection}
  tokens:
${tokensBody}`);
}

function entryOf(result: SeedTransformResult, path: string) {
  const entry = result.manifest.tokens.find((token) => token.path === path);
  if (entry === undefined) throw new Error(`missing resolved token ${path}`);
  return entry;
}

function unsupportedOf(result: SeedTransformResult, path: string) {
  const entry = result.manifest.unsupported.find((token) => token.path === path);
  if (entry === undefined) throw new Error(`missing unsupported token ${path}`);
  return entry;
}

describe("SEED rootage 파서", () => {
  it("fixture의 kind/metadata/data.collection/data.tokens 구조를 읽는다", () => {
    const fixture = loadFixture();
    expect(fixture.kind).toBe("Tokens");
    expect(fixture.metadata).toEqual({ id: "seed-poc", name: "Seed POC" });
    expect(fixture.collection).toBe("global");
    expect(fixture.tokens).toHaveLength(18);

    const byPath = new Map(fixture.tokens.map((token) => [token.path, token]));
    expect(byPath.get("$color.palette.carrot-600")?.collection).toBe("color");
    expect(byPath.get("$dimension.x4")?.collection).toBe("global");
    expect(byPath.get("$radius.r2")?.collection).toBe("global");
    expect(byPath.get("$duration.d3")?.collection).toBe("global");
  });

  it("mode별 values(따옴표 hex, 숫자, $참조)를 파싱한다", () => {
    const fixture = loadFixture();
    const byPath = new Map(fixture.tokens.map((token) => [token.path, token]));

    expect(byPath.get("$color.palette.carrot-600")?.values["theme-light"]).toBe("#ff6600");
    expect(byPath.get("$color.palette.carrot-600")?.values["theme-dark"]).toBe("#e65200");
    expect(byPath.get("$dimension.x4")?.values.default).toBe("16px");
    expect(byPath.get("$dimension.spacing-x.global-gutter")?.values.default).toBe("$dimension.x4");
    expect(byPath.get("$font-weight.regular")?.values.default).toBe(400);
  });

  it("인라인 주석(`# 11px ÷ 16`)을 값에서 분리한다", () => {
    const fixture = loadFixture();
    const byPath = new Map(fixture.tokens.map((token) => [token.path, token]));
    expect(byPath.get("$font-size.t1")?.values.default).toBe("0.6875rem");
    expect(byPath.get("$line-height.t1")?.values.default).toBe("0.9375rem");
  });

  it("복합 구조(unsupported 범주)는 파싱해 보존한다", () => {
    const shadow = inlineRootage("color", `    $shadow.s1:
      values:
        theme-light:
          type: shadow
          value:
            - 0px
            - 1px
`);
    expect(shadow.tokens).toHaveLength(1);
    const result = transformSeedRootage(shadow, { mode: "theme-light" });
    expect(result.manifest.unsupported).toHaveLength(1);
    expect(result.manifest.unsupported[0]).toMatchObject({
      path: "$shadow.s1",
      collection: "color",
      reason: expect.stringContaining("shadow"),
    });
    expect(result.manifest.unsupported[0].raw).toBe(
      '{"theme-light":{"type":"shadow","value":["0px","1px"]}}',
    );
  });

  it("Tokens가 아닌 kind는 거부한다", () => {
    expect(() => parseRootageYaml(`kind: ComponentSpec
metadata:
  id: action-button
  name: Action Button
data:
  schema: {}
`)).toThrow(SeedError);
  });

  it("플로우 컬렉션과 시퀀스 내 인라인 맵은 명시적 오류로 거부한다", () => {
    expect(() => parseRootageYaml(`kind: Tokens
metadata:
  id: t
  name: T
data:
  collection: global
  tokens:
    $dimension.a:
      values:
        default: [1, 2]
`)).toThrow(/flow collections are not supported/);

    expect(() => parseRootageYaml(`kind: Tokens
metadata:
  id: t
  name: T
data:
  collection: global
  tokens:
    $dimension.a:
      values:
        default:
          - offsetX: 0px
`)).toThrow(/inline mappings inside block sequences are not supported/);
  });
});

describe("mode 선택과 참조 해석", () => {
  const fixture = loadFixture();

  it("theme-light: 색상 hex와 global default 토큰을 해석한다", () => {
    const result = transformSeedRootage(fixture, {
      mode: "theme-light",
      source: "test/fixtures/seed-rootage.yaml",
    });
    expect(result.manifest.mode).toBe("theme-light");
    expect(result.manifest.rootFontSizePx).toBe(16);
    expect(result.manifest.source).toBe("test/fixtures/seed-rootage.yaml");

    expect(entryOf(result, "$color.palette.carrot-600")).toMatchObject({
      collection: "color",
      mode: "theme-light",
      raw: "#ff6600",
      value: "#ff6600",
      category: "color",
    });
    expect(entryOf(result, "$font-size.t1")).toMatchObject({
      mode: "default",
      raw: "0.6875rem",
      value: 11,
      category: "font-size",
      unit: "rem",
      conversion: { from: "rem", rootFontSizePx: 16 },
    });
    expect(entryOf(result, "$font-size.t1-static")).toMatchObject({ value: 11, unit: "px" });
    expect(entryOf(result, "$line-height.t1")).toMatchObject({ value: 15 });
    expect(entryOf(result, "$font-family.display")).toMatchObject({ value: "Pretendard" });
    expect(entryOf(result, "$font-weight.regular")).toMatchObject({ value: 400 });
  });

  it("다단 $참조($dimension.spacing-x.global-gutter → $dimension.x4 → 16px)를 해석한다", () => {
    const result = transformSeedRootage(fixture, { mode: "theme-light" });
    expect(entryOf(result, "$dimension.spacing-x.global-gutter")).toMatchObject({
      raw: "$dimension.x4",
      value: 16,
      unit: "px",
      category: "dimension",
    });
    expect(entryOf(result, "$dimension.x4")).toMatchObject({ value: 16 });
  });

  it("theme-dark: 같은 fixture에서 dark 팔레트 hex를 산출한다", () => {
    const result = transformSeedRootage(fixture, { mode: "theme-dark" });
    expect(entryOf(result, "$color.palette.carrot-600").value).toBe("#e65200");
    expect(result.brandKit?.id).toBe("seed-dark");
  });

  it("default: global 토큰을 해석하고 색상은 unsupported로 보고한다", () => {
    const result = transformSeedRootage(fixture, { mode: "default" });
    expect(entryOf(result, "$font-size.t1").value).toBe(11);
    expect(entryOf(result, "$dimension.spacing-x.global-gutter").value).toBe(16);
    expect(result.brandKit).toBeNull();
    expect(result.document).toBeNull();

    const color = unsupportedOf(result, "$color.palette.carrot-600");
    expect(color.reason).toMatch(/no "default" mode/);
  });

  it("root font-size를 바꾸면 rem 환산이 결정론적으로 바뀐다", () => {
    const result = transformSeedRootage(fixture, { mode: "default", rootFontSizePx: 10 });
    expect(entryOf(result, "$font-size.t1").value).toBe(6.875);
    expect(entryOf(result, "$line-height.t1").value).toBe(9.375);
    expect(entryOf(result, "$font-size.t1-static").value).toBe(11);
  });

  it("mode 생략은 실패한다", () => {
    expect(() => transformSeedRootage(fixture, { mode: undefined as unknown as SeedMode }))
      .toThrow(/mode is required/);
  });

  it("호출 mode가 토큰에 없으면 실패한다(색상 모드 부재)", () => {
    const rootage = inlineRootage("color", `    $color.palette.carrot-600:
      values:
        theme-light: "#ff6600"
`);
    expect(() => transformSeedRootage(rootage, { mode: "theme-dark" }))
      .toThrow(/mode "theme-dark" is not defined for \$color\.palette\.carrot-600/);
  });

  it("global 토큰에 default가 없으면 실패한다", () => {
    const rootage = inlineRootage("global", `    $font-size.t1:
      values:
        theme-light: 11px
`);
    expect(() => transformSeedRootage(rootage, { mode: "theme-light" }))
      .toThrow(/mode "default" is not defined for \$font-size\.t1/);
  });
});

describe("오류 케이스", () => {
  it("없는 참조는 실패한다", () => {
    const rootage = inlineRootage("global", `    $dimension.a:
      values:
        default: $dimension.x99
`);
    expect(() => transformSeedRootage(rootage, { mode: "default" }))
      .toThrow(/unknown token reference "\$dimension\.x99"/);
  });

  it("순환 참조는 체인과 함께 실패한다", () => {
    const rootage = inlineRootage("global", `    $dimension.a:
      values:
        default: $dimension.b
    $dimension.b:
      values:
        default: $dimension.a
`);
    expect(() => transformSeedRootage(rootage, { mode: "default" }))
      .toThrow(/circular token reference: \$dimension\.a -> \$dimension\.b -> \$dimension\.a/);
  });

  it("알 수 없는 단위는 실패한다", () => {
    const rootage = inlineRootage("global", `    $dimension.a:
      values:
        default: 12pt
`);
    expect(() => transformSeedRootage(rootage, { mode: "default" }))
      .toThrow(/unsupported unit "pt"/);
  });

  it("잘못된 색상 값은 실패한다", () => {
    const rootage = inlineRootage("color", `    $color.palette.bad:
      values:
        theme-light: "ff6600"
`);
    expect(() => transformSeedRootage(rootage, { mode: "theme-light" }))
      .toThrow(/invalid color value/);
  });

  it("범위 밖 글꼴 굵기는 실패한다", () => {
    const rootage = inlineRootage("global", `    $font-weight.huge:
      values:
        default: 1000
`);
    expect(() => transformSeedRootage(rootage, { mode: "default" }))
      .toThrow(/invalid font weight/);
  });

  it("지원 범주 토큰의 복합 구조 값은 실패한다", () => {
    const rootage = inlineRootage("color", `    $color.palette.structured:
      values:
        theme-light:
          type: color
`);
    expect(() => transformSeedRootage(rootage, { mode: "theme-light" }))
      .toThrow(/structured value/);
  });
});

describe("BrandKit / DesignDocument 변환", () => {
  const fixture = loadFixture();

  it("theme-light: BrandKit 스키마를 통과하고 팔레트·폰트를 등록한다", () => {
    const result = transformSeedRootage(fixture, { mode: "theme-light" });
    const brandKit = result.brandKit;
    expect(brandKit).not.toBeNull();
    expect(brandKit!.id).toBe("seed-light");
    expect(brandKit!.name).toBe("SEED Rootage (theme-light)");
    expect(brandKit!.palette).toContainEqual({
      id: "color.palette.carrot-600",
      name: "carrot-600",
      value: "#ff6600",
    });
    expect(brandKit!.fonts).toEqual([{ family: "Pretendard", weights: [400, 500, 700] }]);
    expect(BrandKitSchema.parse(brandKit)).toEqual(brandKit);
  });

  it("대표 DesignDocument가 스키마·applyBrandKit·QA를 통과한다", () => {
    const result = transformSeedRootage(fixture, { mode: "theme-light" });
    const document = result.document;
    expect(document).not.toBeNull();
    expect(DesignDocumentSchema.parse(document)).toEqual(document);
    expect(applyBrandKit(document!, document!.brandKit)).toEqual(document);

    expect(document!.canvas).toMatchObject({ width: 480, height: 320, unit: "px", safeMargin: 16 });
    const text = document!.pages[0].layers.find((layer) => layer.type === "text") as TextLayer;
    expect(text).toMatchObject({
      id: "seed-copy",
      fontFamily: "Pretendard",
      fontSize: 11,
      fontWeight: 400,
      color: "#ff6600",
    });
    expect(text.lineHeight).toBeCloseTo(15 / 11, 10);

    const qa = inspectDocument(document!);
    expect(qa.passed).toBe(true);
    expect(qa.brandViolations).toEqual([]);
    expect(qa.checks.find((check) => check.name === "brand-kit-respected")?.pass).toBe(true);
  });

  it("theme-dark 문서도 QA를 통과한다", () => {
    const result = transformSeedRootage(fixture, { mode: "theme-dark" });
    expect(result.document).not.toBeNull();
    expect(inspectDocument(result.document!).passed).toBe(true);
  });

  it("같은 fixture·mode는 항상 동일한 산출물을 만든다(결정론)", () => {
    const first = transformSeedRootage(fixture, { mode: "theme-light", source: "fixture" });
    const second = transformSeedRootage(fixture, { mode: "theme-light", source: "fixture" });
    expect(second.manifest).toEqual(first.manifest);
    expect(second.brandKit).toEqual(first.brandKit);
    expect(second.typography).toEqual(first.typography);
    expect(second.spacing).toEqual(first.spacing);
    expect(second.document).toEqual(first.document);
  });
});

describe("unsupported 보고", () => {
  const fixture = loadFixture();

  it("radius·duration을 조용히 버리지 않고 manifest에 남긴다", () => {
    const result = transformSeedRootage(fixture, { mode: "theme-light" });
    const paths = result.manifest.unsupported.map((entry) => entry.path);
    expect(paths).toContain("$radius.r2");
    expect(paths).toContain("$duration.d3");

    const radius = unsupportedOf(result, "$radius.r2");
    expect(radius).toMatchObject({ collection: "global", reason: expect.stringContaining("radius") });
    const duration = unsupportedOf(result, "$duration.d3");
    expect(duration).toMatchObject({ collection: "global", reason: expect.stringContaining("duration") });
  });

  it("motion 컬렉션 토큰은 collection을 보존해 보고한다", () => {
    const rootage = inlineRootage("motion", `    $scale.s98:
      values:
        preferred: 0.98
        reduced: 1
`);
    const result = transformSeedRootage(rootage, { mode: "default" });
    expect(unsupportedOf(result, "$scale.s98")).toMatchObject({
      collection: "motion",
      reason: expect.stringContaining("scale"),
    });
    expect(result.manifest.tokens).toEqual([]);
    expect(result.brandKit).toBeNull();
  });
});
