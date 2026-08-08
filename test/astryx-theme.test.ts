import { describe, it, expect } from "vitest";
import fixture from "./fixtures/astryx-penpot-tokens.json";
import {
  convertPenpotTokensToAstryx,
  type AstryxThemeInput,
} from "../src/design/astryx-theme.js";

function convert(input: AstryxThemeInput) {
  return convertPenpotTokensToAstryx(input);
}

describe("Penpot 토큰 → Astryx 테마 초안 변환 (POC, issue #23)", () => {
  it("fixture: 역할이 확인된 색상만 Astryx 변수에 배정하고 값을 보존한다", () => {
    const draft = convert(fixture as AstryxThemeInput);

    expect(draft.baseTheme).toBe("neutral");

    expect(draft.light).toEqual({
      "--color-text-primary": "#1f2937",
      "--color-text-secondary": "#6b7280",
      "--color-background-surface": "#ffffff",
      "--color-background-elevated": "#f9fafb",
      "--color-state-warning": "#d97706",
      "--color-text-link": "#2563eb",
      "--color-state-error": "#dc2626",
      "--spacing-1": "4px",
      "--spacing-2": "8px",
      "--spacing-4": "16px",
      "--spacing-6": "24px",
      "--spacing-8": "32px",
      "--spacing-12": "48px",
    });

    expect(draft.dark).toEqual({
      "--color-text-primary": "#f3f4f6",
      "--color-text-secondary": "#9ca3af",
      "--color-background-surface": "#111827",
      "--color-background-elevated": "#1f2937",
      "--color-border-default": "#374151",
      "--color-state-warning": "#f59e0b",
      "--spacing-1": "4px",
      "--spacing-2": "8px",
      "--spacing-4": "16px",
      "--spacing-6": "24px",
      "--spacing-8": "32px",
      "--spacing-12": "48px",
    });

    // 충돌로 light의 --color-border-default는 생략(override 생략), dark는 단일 토큰이라 유지
    expect(draft.light?.["--color-border-default"]).toBeUndefined();
    expect(draft.dark?.["--color-border-default"]).toBe("#374151");

    // 추측 생성 금지: 검증되지 않은 역할·빈 역할에 대한 임의 변수 없음
    expect(Object.keys(draft.light ?? {}).some((k) => k.includes("brand"))).toBe(false);
    expect(Object.keys(draft.dark ?? {}).some((k) => k.includes("brand"))).toBe(false);
  });

  it("fixture: 타이포그래피를 light 우선으로 CSS 변수 초안에 매핑한다", () => {
    const draft = convert(fixture as AstryxThemeInput);

    expect(draft.typography).toEqual({
      "--font-family-inter": "Inter",
      "--font-family-noto-sans-kr": "Noto Sans KR",
      "--font-size-display": "40px",
      "--font-weight-display": 700,
      "--line-height-display": 1.2,
      "--font-size-body": "16px",
      "--font-weight-body": 400,
      "--line-height-body": 1.6,
      "--font-size-base": "16px",
    });
  });

  it("fixture: 매핑 보고에 mapped/unmapped/conflict 상태와 근거를 담는다", () => {
    const draft = convert(fixture as AstryxThemeInput);

    const mapped = draft.mapping.filter((m) => m.status === "mapped");
    const unmapped = draft.mapping.filter((m) => m.status === "unmapped");
    const conflicted = draft.mapping.filter((m) => m.status === "conflict");

    expect(mapped.length).toBe(34); // 색상 13(light 7 + dark 6) + spacing 12 + typography 9
    expect(unmapped.length).toBe(4); // brand(light/dark) + graph-bg + success-badge(실 coarse role) — 후보 목록
    expect(conflicted.length).toBe(2); // line + divider

    expect(
      draft.mapping.find((m) => m.sourceToken === "ink" && m.mode === "light"),
    ).toEqual({
      sourceToken: "ink",
      mode: "light",
      astryxToken: "--color-text-primary",
      status: "mapped",
      rationale: "role 'text-primary' → --color-text-primary",
    });

    const line = draft.mapping.find((m) => m.sourceToken === "line" && m.mode === "light");
    const divider = draft.mapping.find((m) => m.sourceToken === "divider" && m.mode === "light");
    expect(line?.status).toBe("conflict");
    expect(divider?.status).toBe("conflict");
    expect(line?.astryxToken).toBe("--color-border-default");
    expect(divider?.astryxToken).toBe("--color-border-default");

    const brand = draft.mapping.find((m) => m.sourceToken === "brand" && m.mode === "light");
    expect(brand?.status).toBe("unmapped");
    expect(brand?.astryxToken).toBeUndefined();
    expect(brand?.rationale).toContain("brand-primary");

    // 실 get_tokens coarse role('semantic')은 Astryx 변수로 추측하지 않는다 (H1)
    const successBadge = draft.mapping.find(
      (m) => m.sourceToken === "success-badge" && m.mode === "light",
    );
    expect(successBadge?.status).toBe("unmapped");
    expect(successBadge?.astryxToken).toBeUndefined();
    expect(draft.light?.["--color-state-success"]).toBeUndefined();

    // roleOverrides가 유일한 교두보: coarse role 토큰을 Astryx 역할로 명시 매핑
    const dangerBadge = draft.mapping.find(
      (m) => m.sourceToken === "danger-badge" && m.mode === "light",
    );
    expect(dangerBadge).toEqual({
      sourceToken: "danger-badge",
      mode: "light",
      astryxToken: "--color-state-error",
      status: "mapped",
      rationale: "role 'state-error' → --color-state-error",
    });
  });

  it("fixture: 누락·미지원 보고 — MISSING_ROLE/UNSUPPORTED_TOKEN만, 임의 토큰 없음", () => {
    const draft = convert(fixture as AstryxThemeInput);

    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_ROLE", sourceToken: "graph-bg" }),
        expect.objectContaining({ code: "UNSUPPORTED_TOKEN", sourceToken: "brand" }),
        expect.objectContaining({ code: "UNSUPPORTED_TOKEN", sourceToken: "success-badge" }),
      ]),
    );
    expect(draft.warnings.some((w) => w.code === "MISSING_DARK_MODE")).toBe(false);
    // 후보 목록 유지: 임의 semantic 변수 생성 금지
    expect(draft.mapping.filter((m) => m.status === "unmapped").every((m) => !m.astryxToken)).toBe(
      true,
    );
  });

  it("결정론: 동일 fixture를 두 번 변환하면 매핑·경고가 바이트 단위로 동일하다", () => {
    const first = convert(fixture as AstryxThemeInput);
    const second = convert(fixture as AstryxThemeInput);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.mapping.map((m) => m.sourceToken)).toEqual(second.mapping.map((m) => m.sourceToken));
    expect(first.warnings.map((w) => w.code)).toEqual(second.warnings.map((w) => w.code));
  });

  it("한 모드(light)만 있으면 기준 테마 유지 — dark 미생성 + MISSING_DARK_MODE 경고", () => {
    const draft = convert({
      baseTheme: "stone",
      modes: {
        light: {
          colors: [
            { name: "ink", value: "#1f2937", role: "text-primary" },
            { name: "hero", value: "#2563eb" },
          ],
        },
      },
    });

    expect(draft.dark).toBeUndefined();
    expect(draft.light?.["--color-text-primary"]).toBe("#1f2937");
    expect(draft.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MISSING_DARK_MODE" })]),
    );
    // role 없는 hero는 후보 목록 + MISSING_ROLE, 변수 미생성
    expect(draft.light?.["--color-text-link"]).toBeUndefined();
    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_ROLE", sourceToken: "hero" }),
      ]),
    );
    expect(draft.mapping.find((m) => m.sourceToken === "hero")?.status).toBe("unmapped");
  });

  it("dark만 있으면 MISSING_LIGHT_MODE 경고와 함께 dark를 출력한다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        dark: {
          colors: [{ name: "ink", value: "#f3f4f6", role: "text-primary" }],
        },
      },
    });

    expect(draft.light).toBeUndefined();
    expect(draft.dark?.["--color-text-primary"]).toBe("#f3f4f6");
    expect(draft.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MISSING_LIGHT_MODE" })]),
    );
  });

  it("같은 변수에 다른 값을 가진 두 토큰은 충돌로 override를 생략한다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          colors: [
            { name: "a", value: "#111111", role: "text-primary" },
            { name: "b", value: "#222222", role: "text-primary" },
          ],
        },
      },
    });

    expect(draft.light?.["--color-text-primary"]).toBeUndefined();
    expect(draft.mapping.filter((m) => m.status === "conflict").length).toBe(2);
    expect(draft.warnings.some((w) => w.code === "UNSUPPORTED_TOKEN")).toBe(false);
  });

  it("충돌로 생략된 변수는 이후 같은 값을 가진 토큰으로도 복원되지 않는다 (3토큰 충돌)", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          colors: [
            { name: "a", value: "#111111", role: "text-primary" },
            { name: "b", value: "#222222", role: "text-primary" },
            { name: "c", value: "#111111", role: "text-primary" },
          ],
        },
      },
    });

    expect(draft.light?.["--color-text-primary"]).toBeUndefined();
    expect(draft.mapping.filter((m) => m.status === "conflict").length).toBe(3);
    expect(draft.mapping.filter((m) => m.status === "mapped").length).toBe(0);
    // 세 번째 토큰도 복원이 아닌 충돌로 기록된다
    const c = draft.mapping.find((m) => m.sourceToken === "c" && m.mode === "light");
    expect(c?.status).toBe("conflict");
    expect(c?.rationale).toContain("복원 금지");
  });

  it("타이포그래피 충돌 변수도 이후 동일 값으로 복원되지 않는다 (3-emit 충돌)", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          typography: {
            scale: [
              { name: "body", size: 16, weight: 400, lineHeight: 1.5 },
              { name: "Body", size: 14, weight: 400, lineHeight: 1.5 },
              { name: "body", size: 16, weight: 400, lineHeight: 1.5 },
            ],
            baseSize: 16,
          },
        },
      },
    });

    expect(draft.typography?.["--font-size-body"]).toBeUndefined();
    const sizeConflicts = draft.mapping.filter(
      (m) => m.astryxToken === "--font-size-body" && m.status === "conflict",
    );
    expect(sizeConflicts.length).toBe(3);
    // 같은 값인 weight·lineHeight는 충돌 없이 유지된다
    expect(draft.typography?.["--font-weight-body"]).toBe(400);
    expect(draft.typography?.["--line-height-body"]).toBe(1.5);
  });

  it("이름 없는 색상은 INVALID_VALUE 경고와 함께 건너뛴다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          colors: [
            { name: "", value: "#ffffff", role: "text-primary" },
            { name: "ink", value: "#1f2937", role: "text-primary" },
          ],
        },
      },
    });

    expect(draft.light?.["--color-text-primary"]).toBe("#1f2937");
    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_VALUE", sourceToken: "colors[0]" }),
      ]),
    );
    expect(draft.mapping.find((m) => m.sourceToken === "colors[0]")?.status).toBe("unmapped");
  });

  it("유효하지 않은 색 값은 INVALID_VALUE 경고 후 생략한다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          colors: [{ name: "broken", value: "#zzzzzz", role: "text-primary" }],
        },
      },
    });

    expect(draft.light?.["--color-text-primary"]).toBeUndefined();
    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_VALUE", sourceToken: "broken" }),
      ]),
    );
    expect(draft.mapping.find((m) => m.sourceToken === "broken")?.status).toBe("unmapped");
  });

  it("불투명도 접미사(@NN%) 값은 지원 범위 밖으로 보고한다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          colors: [{ name: "faded", value: "#1f2937 @50%", role: "text-primary" }],
        },
      },
    });

    expect(draft.light?.["--color-text-primary"]).toBeUndefined();
    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_TOKEN", sourceToken: "faded" }),
      ]),
    );
  });

  it("일반 Penpot role(primary 등)은 구체적 Astryx 역할로 추측하지 않는다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          colors: [{ name: "brand", value: "#0f766e", role: "primary" }],
        },
      },
    });

    expect(draft.light?.["--color-primary"]).toBeUndefined();
    expect(draft.light?.["--color-text-primary"]).toBeUndefined();
    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_TOKEN", sourceToken: "brand" }),
      ]),
    );
  });

  it("호환 불가 spacing baseUnit은 경고 후 매핑을 생략한다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          spacing: { baseUnit: 3, scale: [3, 6, 9] },
        },
      },
    });

    expect(Object.keys(draft.light ?? {}).some((k) => k.startsWith("--spacing-"))).toBe(false);
    expect(draft.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_TOKEN" })]),
    );
  });

  it("비단조 또는 비양수 spacing scale은 INVALID_VALUE 경고 후 생략한다", () => {
    const nonMonotonic = convert({
      baseTheme: "neutral",
      modes: {
        light: { spacing: { baseUnit: 4, scale: [4, 2, 8] } },
      },
    });
    expect(Object.keys(nonMonotonic.light ?? {}).some((k) => k.startsWith("--spacing-"))).toBe(
      false,
    );
    expect(nonMonotonic.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "INVALID_VALUE" })]),
    );

    const nonPositive = convert({
      baseTheme: "neutral",
      modes: {
        light: { spacing: { baseUnit: 4, scale: [4, -8] } },
      },
    });
    expect(Object.keys(nonPositive.light ?? {}).some((k) => k.startsWith("--spacing-"))).toBe(
      false,
    );
    expect(nonPositive.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "INVALID_VALUE" })]),
    );
  });

  it("baseUnit 배수가 아닌 scale 값은 --spacing-<n> 접미사 산출 불가로 경고한다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: { spacing: { baseUnit: 4, scale: [4, 7, 16] } },
      },
    });

    expect(Object.keys(draft.light ?? {}).some((k) => k.startsWith("--spacing-"))).toBe(false);
    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_TOKEN", sourceToken: "spacing:7px" }),
      ]),
    );
  });

  it("잘못된 타이포그래피 값은 해당 변수만 생략하고 나머지는 매핑한다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: {
          typography: {
            families: ["Inter"],
            scale: [{ name: "body", size: 0, weight: 400, lineHeight: 1.5 }],
            baseSize: 16,
          },
        },
      },
    });

    expect(draft.typography?.["--font-size-body"]).toBeUndefined();
    expect(draft.typography?.["--font-weight-body"]).toBe(400);
    expect(draft.typography?.["--line-height-body"]).toBe(1.5);
    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_VALUE", sourceToken: "typography:size:body" }),
      ]),
    );
  });

  it("mode 없는 roleOverride는 모든 모드에 적용된다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: { colors: [{ name: "link-blue", value: "#2563eb" }] },
        dark: { colors: [{ name: "link-blue", value: "#60a5fa" }] },
      },
      roleOverrides: [{ token: "link-blue", role: "text-link" }],
    });

    expect(draft.light?.["--color-text-link"]).toBe("#2563eb");
    expect(draft.dark?.["--color-text-link"]).toBe("#60a5fa");
    expect(draft.warnings.some((w) => w.code === "MISSING_ROLE")).toBe(false);
  });

  it("roleOverride 대상 토큰이 없으면 INVALID_VALUE 경고를 낸다", () => {
    const draft = convert({
      baseTheme: "neutral",
      modes: {
        light: { colors: [{ name: "ink", value: "#1f2937", role: "text-primary" }] },
      },
      roleOverrides: [{ token: "ghost", mode: "light", role: "text-link" }],
    });

    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_VALUE", sourceToken: "ghost" }),
      ]),
    );
  });

  it("빈 baseTheme는 neutral로 대체하고 INVALID_VALUE 경고를 낸다", () => {
    const draft = convert({
      baseTheme: "  ",
      modes: {
        light: { colors: [{ name: "ink", value: "#1f2937", role: "text-primary" }] },
      },
    });

    expect(draft.baseTheme).toBe("neutral");
    expect(draft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_VALUE", sourceToken: "baseTheme" }),
      ]),
    );
  });
});
