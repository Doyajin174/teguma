/**
 * Pure Penpot token → Astryx theme draft converter (POC, issue #23).
 *
 * Converts teguma's existing `get_tokens`-shaped token data (colors,
 * typography, spacing) into a reviewable Astryx CSS custom property theme
 * draft. It never fabricates semantic roles: only tokens whose role is
 * explicit in the source (or supplied via human `roleOverrides`) are
 * assigned to an Astryx variable. Everything else stays in the candidate
 * list (`mapping` entries with status `unmapped`) with structured warnings.
 *
 * Scope notes (see docs/specs/015-astryx-integration.md):
 * - Pure function only: no filesystem writes, no package installs, no CLI
 *   subprocess, no MCP registration, no changes to the get_tokens contract.
 * - The known Astryx role → CSS variable registry below is a POC candidate
 *   set based on the documented naming pattern (e.g. `--color-text-primary`,
 *   `--color-background-surface`). It must be cross-checked against the
 *   pinned `@astryxdesign/cli` manifest before being finalized.
 * - Spacing is mapped only for a strictly increasing, positive integer scale
 *   whose base unit is 4 or 8 and whose values are multiples of that base
 *   unit; the `--spacing-<n>` suffix is `value / baseUnit`. Anything else is
 *   reported and left unmapped rather than guessed.
 */

import type {
  CompressedColor,
  CompressedSpacing,
  CompressedTypography,
} from "../penpot/types.js";

export type AstryxMode = "light" | "dark";

/** One mode's tokens, matching the shape of teguma's `get_tokens` output. */
export interface AstryxModeTokens {
  colors?: CompressedColor[];
  typography?: CompressedTypography;
  spacing?: CompressedSpacing;
}

/**
 * Converter input. `modes.light`/`modes.dark` reuse the compressed token
 * shapes from `get_tokens`; `roleOverrides` are explicit human assignments
 * (POC contract extension, never inferred automatically).
 */
export interface AstryxThemeInput {
  baseTheme: string;
  modes: Partial<Record<AstryxMode, AstryxModeTokens>>;
  roleOverrides?: Array<{
    token: string;
    mode?: AstryxMode;
    role: string;
  }>;
}

export type AstryxMappingStatus = "mapped" | "unmapped" | "conflict";

export interface AstryxThemeMapping {
  sourceToken: string;
  mode?: AstryxMode;
  astryxToken?: string;
  status: AstryxMappingStatus;
  rationale: string;
}

export type AstryxWarningCode =
  | "MISSING_ROLE"
  | "UNSUPPORTED_TOKEN"
  | "MISSING_DARK_MODE"
  | "MISSING_LIGHT_MODE"
  | "INVALID_VALUE";

export interface AstryxThemeWarning {
  code: AstryxWarningCode;
  sourceToken?: string;
  message: string;
}

/**
 * Theme draft per docs/specs/015-astryx-integration.md. The `mode` field on
 * mapping entries is a small POC extension so light/dark sources stay
 * distinguishable; the warning codes add MISSING_LIGHT_MODE for symmetry.
 */
export interface AstryxThemeDraft {
  baseTheme: string;
  light?: Record<string, string>;
  dark?: Record<string, string>;
  typography?: Record<string, string | number>;
  mapping: AstryxThemeMapping[];
  warnings: AstryxThemeWarning[];
}

/**
 * POC candidate roles → Astryx CSS custom properties. Only roles verified
 * against Astryx's documented semantic token pattern live here; palette
 * roles (e.g. brand colors) are intentionally absent until the pinned CLI
 * manifest confirms their keys.
 */
const COLOR_ROLE_REGISTRY: Record<string, string> = {
  "text-primary": "--color-text-primary",
  "text-secondary": "--color-text-secondary",
  "text-muted": "--color-text-muted",
  "text-disabled": "--color-text-disabled",
  "text-inverse": "--color-text-inverse",
  "text-link": "--color-text-link",
  "background-surface": "--color-background-surface",
  "background-elevated": "--color-background-elevated",
  "background-overlay": "--color-background-overlay",
  "border-default": "--color-border-default",
  "border-strong": "--color-border-strong",
  "state-success": "--color-state-success",
  "state-warning": "--color-state-warning",
  "state-error": "--color-state-error",
  "state-info": "--color-state-info",
};

/** Base units considered compatible with Astryx/Tailwind-style grids. */
const COMPATIBLE_SPACING_BASE_UNITS = new Set([4, 8]);

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\([^()]*\)$/;

export function convertPenpotTokensToAstryx(input: AstryxThemeInput): AstryxThemeDraft {
  const warnings: AstryxThemeWarning[] = [];
  const mapping: AstryxThemeMapping[] = [];

  const baseTheme = normalizeBaseTheme(input.baseTheme, warnings);

  const light = input.modes?.light;
  const dark = input.modes?.dark;
  const hasLight = light !== undefined;
  const hasDark = dark !== undefined;

  if (hasLight && !hasDark) {
    warnings.push({
      code: "MISSING_DARK_MODE",
      message: "dark 모드 없음 — 기준 테마(baseTheme)의 dark 값을 유지하고 light만 출력",
    });
  }
  if (hasDark && !hasLight) {
    warnings.push({
      code: "MISSING_LIGHT_MODE",
      message: "light 모드 없음 — 기준 테마(baseTheme)의 light 값을 유지하고 dark만 출력",
    });
  }

  const overrides = indexRoleOverrides(input.roleOverrides, light, dark, warnings);

  const lightRecord: Record<string, string> = {};
  const darkRecord: Record<string, string> = {};

  if (light) {
    processColors(light.colors, "light", overrides, lightRecord, mapping, warnings);
    processSpacing(light.spacing, "light", lightRecord, mapping, warnings);
  }
  if (dark) {
    processColors(dark.colors, "dark", overrides, darkRecord, mapping, warnings);
    processSpacing(dark.spacing, "dark", darkRecord, mapping, warnings);
  }

  // Typography is mode-independent in the draft contract; prefer light and
  // fall back to dark so a light-only input still yields typography. The
  // reported mode always names the mode the values actually came from.
  const typographySource = light?.typography ?? dark?.typography;
  const typographyMode = light?.typography
    ? "light"
    : dark?.typography
      ? "dark"
      : undefined;
  let typography: Record<string, string | number> | undefined;
  if (typographySource && typographyMode) {
    typography = processTypography(
      typographySource,
      typographyMode,
      mapping,
      warnings,
    );
  }

  mapping.sort(compareMapping);
  warnings.sort(compareWarnings);

  const draft: AstryxThemeDraft = {
    baseTheme,
    mapping,
    warnings,
  };
  if (light) draft.light = lightRecord;
  if (dark) draft.dark = darkRecord;
  if (typography && Object.keys(typography).length > 0) draft.typography = typography;
  return draft;
}

function normalizeBaseTheme(baseTheme: string, warnings: AstryxThemeWarning[]): string {
  if (typeof baseTheme === "string" && baseTheme.trim().length > 0) return baseTheme.trim();
  warnings.push({
    code: "INVALID_VALUE",
    sourceToken: "baseTheme",
    message: `baseTheme '${String(baseTheme)}'이(가) 유효하지 않아 'neutral'로 대체`,
  });
  return "neutral";
}

function indexRoleOverrides(
  roleOverrides: AstryxThemeInput["roleOverrides"],
  light: AstryxModeTokens | undefined,
  dark: AstryxModeTokens | undefined,
  warnings: AstryxThemeWarning[],
): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const override of roleOverrides ?? []) {
    const key = `${override.mode ?? "*"}:${override.token}`;
    overrides.set(key, override.role);
    const targetExists =
      (override.mode === undefined || override.mode === "light") &&
      light?.colors?.some((c) => c.name === override.token);
    const darkExists =
      (override.mode === undefined || override.mode === "dark") &&
      dark?.colors?.some((c) => c.name === override.token);
    if (!targetExists && !darkExists) {
      warnings.push({
        code: "INVALID_VALUE",
        sourceToken: override.token,
        message: `roleOverride 대상 토큰 없음 (${key})`,
      });
    }
  }
  return overrides;
}

function processColors(
  colors: CompressedColor[] | undefined,
  mode: AstryxMode,
  overrides: Map<string, string>,
  record: Record<string, string>,
  mapping: AstryxThemeMapping[],
  warnings: AstryxThemeWarning[],
): void {
  if (!colors) return;
  const claimed = new Map<string, { sourceToken: string; value: string }>();

  for (const color of colors) {
    if (!color.name) continue;
    // A mode-less override (`*:<token>`) applies to every mode; a mode-scoped
    // override (`<mode>:<token>`) wins over the source role.
    const role =
      overrides.get(`${mode}:${color.name}`) ??
      overrides.get(`*:${color.name}`) ??
      color.role;

    if (!role) {
      mapping.push({
        sourceToken: color.name,
        mode,
        status: "unmapped",
        rationale: "semantic role 부재 — 후보 목록으로 남기고 임의 변수에 배정하지 않음",
      });
      warnings.push({
        code: "MISSING_ROLE",
        sourceToken: color.name,
        message: `역할이 없는 색상 토큰 — Astryx 변수에 배정하지 않고 후보로 남김`,
      });
      continue;
    }

    const astryxToken = COLOR_ROLE_REGISTRY[role];
    if (!astryxToken) {
      mapping.push({
        sourceToken: color.name,
        mode,
        status: "unmapped",
        rationale: `role '${role}'은(는) 검증된 Astryx 변수로 확인되지 않음 — 후보 목록 유지`,
      });
      warnings.push({
        code: "UNSUPPORTED_TOKEN",
        sourceToken: color.name,
        message: `역할 '${role}'은(는) POC 레지스트리에 없음 — 사람 검토 필요 (${mode})`,
      });
      continue;
    }

    const normalized = normalizeColorValue(color.value);
    if (!normalized.ok) {
      mapping.push({
        sourceToken: color.name,
        mode,
        status: "unmapped",
        rationale: `값 '${color.value}' 처리 불가`,
      });
      warnings.push({
        code: normalized.reason === "UNSUPPORTED" ? "UNSUPPORTED_TOKEN" : "INVALID_VALUE",
        sourceToken: color.name,
        message:
          normalized.reason === "UNSUPPORTED"
            ? `불투명도 접미사('@NN%')가 포함된 값은 POC 범위 밖 — 후보 목록 유지`
            : `'${color.value}'은(는) 유효한 CSS 색 값이 아님`,
      });
      continue;
    }

    const previous = claimed.get(astryxToken);
    if (previous && previous.value !== normalized.value) {
      delete record[astryxToken];
      markConflict(mapping, astryxToken, mode, previous.sourceToken);
      mapping.push({
        sourceToken: color.name,
        mode,
        astryxToken,
        status: "conflict",
        rationale: `'${previous.sourceToken}'과(와) 다른 값으로 같은 변수 충돌 — override 생략`,
      });
      continue;
    }

    record[astryxToken] = normalized.value;
    claimed.set(astryxToken, { sourceToken: color.name, value: normalized.value });
    mapping.push({
      sourceToken: color.name,
      mode,
      astryxToken,
      status: "mapped",
      rationale: `role '${role}' → ${astryxToken}`,
    });
  }
}

function markConflict(
  mapping: AstryxThemeMapping[],
  astryxToken: string,
  mode: AstryxMode,
  sourceToken: string,
): void {
  const entry = mapping.find(
    (m) =>
      m.astryxToken === astryxToken &&
      m.mode === mode &&
      m.sourceToken === sourceToken &&
      m.status === "mapped",
  );
  if (entry) {
    entry.status = "conflict";
    entry.rationale = `'${astryxToken}'에 다른 값을 가진 토큰과 충돌 — override 생략`;
  }
}

function normalizeColorValue(
  value: string,
): { ok: true; value: string } | { ok: false; reason: "INVALID" | "UNSUPPORTED" } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: "INVALID" };
  }
  const trimmed = value.trim();
  if (trimmed.includes(" @")) return { ok: false, reason: "UNSUPPORTED" };
  if (HEX_COLOR_RE.test(trimmed)) return { ok: true, value: normalizeHex(trimmed) };
  if (COLOR_FUNC_RE.test(trimmed)) return { ok: true, value: trimmed };
  return { ok: false, reason: "INVALID" };
}

function normalizeHex(hex: string): string {
  let normalized = hex.toLowerCase();
  if (normalized.length === 4 || normalized.length === 5) {
    const [, r, g, b, a] = normalized;
    normalized = `#${r}${r}${g}${g}${b}${b}${a ? `${a}${a}` : ""}`;
  }
  return normalized;
}

function processSpacing(
  spacing: CompressedSpacing | undefined,
  mode: AstryxMode,
  record: Record<string, string>,
  mapping: AstryxThemeMapping[],
  warnings: AstryxThemeWarning[],
): void {
  if (!spacing || !Array.isArray(spacing.scale) || spacing.scale.length === 0) return;

  const { baseUnit, scale } = spacing;

  if (!Number.isInteger(baseUnit) || baseUnit <= 0) {
    warnings.push({
      code: "INVALID_VALUE",
      sourceToken: `spacing:baseUnit`,
      message: `spacing baseUnit '${String(baseUnit)}'은(는) 양의 정수가 아님 — spacing 매핑 생략`,
    });
    return;
  }
  if (!COMPATIBLE_SPACING_BASE_UNITS.has(baseUnit)) {
    warnings.push({
      code: "UNSUPPORTED_TOKEN",
      sourceToken: `spacing:baseUnit`,
      message: `baseUnit ${baseUnit}px은(는) Astryx scale 단위(4/8px)와 호환되지 않음 — spacing 매핑 생략`,
    });
    return;
  }
  for (let i = 0; i < scale.length; i += 1) {
    const step = scale[i];
    if (!Number.isInteger(step) || step <= 0) {
      warnings.push({
        code: "INVALID_VALUE",
        sourceToken: `spacing:scale[${i}]`,
        message: `scale 값 '${String(step)}'은(는) 양의 정수가 아님 — spacing 매핑 생략`,
      });
      return;
    }
    if (i > 0 && step <= scale[i - 1]) {
      warnings.push({
        code: "INVALID_VALUE",
        sourceToken: `spacing:scale[${i}]`,
        message: `scale이 단조 증가하지 않음 (${String(scale[i - 1])} → ${String(step)}) — spacing 매핑 생략`,
      });
      return;
    }
    if (step % baseUnit !== 0) {
      warnings.push({
        code: "UNSUPPORTED_TOKEN",
        sourceToken: `spacing:${step}px`,
        message: `${step}px은(는) baseUnit ${baseUnit}px의 배수가 아님 — --spacing-<n> 접미사 산출 불가`,
      });
      return;
    }
  }

  for (const step of scale) {
    const suffix = step / baseUnit;
    const key = `--spacing-${suffix}`;
    record[key] = `${step}px`;
    mapping.push({
      sourceToken: `spacing:${step}px`,
      mode,
      astryxToken: key,
      status: "mapped",
      rationale: `baseUnit ${baseUnit}px, scale ${step}px → ${key} (${step}px / ${baseUnit}px)`,
    });
  }
}

function processTypography(
  typography: CompressedTypography,
  mode: AstryxMode,
  mapping: AstryxThemeMapping[],
  warnings: AstryxThemeWarning[],
): Record<string, string | number> {
  const record: Record<string, string | number> = {};
  const claimed = new Map<string, { sourceToken: string; value: string | number }>();

  const emit = (key: string, value: string | number, sourceToken: string): void => {
    const previous = claimed.get(key);
    if (previous && previous.value !== value) {
      delete record[key];
      markConflict(mapping, key, mode, previous.sourceToken);
      mapping.push({
        sourceToken,
        mode,
        astryxToken: key,
        status: "conflict",
        rationale: `'${previous.sourceToken}'과(와) 다른 값으로 같은 변수 충돌 — override 생략`,
      });
      return;
    }
    record[key] = value;
    claimed.set(key, { sourceToken, value });
    mapping.push({
      sourceToken,
      mode,
      astryxToken: key,
      status: "mapped",
      rationale: `타이포그래피 원천 토큰에서 변환`,
    });
  };

  for (const family of typography.families ?? []) {
    if (typeof family !== "string" || family.trim().length === 0) {
      warnings.push({
        code: "INVALID_VALUE",
        sourceToken: "typography:family",
        message: "빈 폰트 패밀리 — 건너뜀",
      });
      continue;
    }
    const key = `--font-family-${slugify(family)}`;
    emit(key, family.trim(), `typography:family:${family}`);
  }

  for (const step of typography.scale ?? []) {
    if (typeof step.name !== "string" || step.name.trim().length === 0) {
      warnings.push({
        code: "INVALID_VALUE",
        sourceToken: "typography:scale",
        message: "이름 없는 타이포그래피 스텝 — 건너뜀",
      });
      continue;
    }
    const slug = slugify(step.name);
    if (isPositiveNumber(step.size)) {
      emit(`--font-size-${slug}`, `${step.size}px`, `typography:size:${step.name}`);
    } else {
      warnings.push({
        code: "INVALID_VALUE",
        sourceToken: `typography:size:${step.name}`,
        message: `size '${String(step.size)}'이(가) 양수가 아님 — 건너뜀`,
      });
    }
    if (isPositiveNumber(step.weight)) {
      emit(`--font-weight-${slug}`, step.weight, `typography:weight:${step.name}`);
    } else {
      warnings.push({
        code: "INVALID_VALUE",
        sourceToken: `typography:weight:${step.name}`,
        message: `weight '${String(step.weight)}'이(가) 양수가 아님 — 건너뜀`,
      });
    }
    if (isPositiveNumber(step.lineHeight)) {
      emit(`--line-height-${slug}`, step.lineHeight, `typography:line-height:${step.name}`);
    } else {
      warnings.push({
        code: "INVALID_VALUE",
        sourceToken: `typography:line-height:${step.name}`,
        message: `lineHeight '${String(step.lineHeight)}'이(가) 양수가 아님 — 건너뜀`,
      });
    }
  }

  if (isPositiveNumber(typography.baseSize)) {
    emit("--font-size-base", `${typography.baseSize}px`, "typography:base");
  } else {
    warnings.push({
      code: "INVALID_VALUE",
      sourceToken: "typography:base",
      message: `baseSize '${String(typography.baseSize)}'이(가) 양수가 아님 — 건너뜀`,
    });
  }

  return record;
}

function isPositiveNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compareMapping(a: AstryxThemeMapping, b: AstryxThemeMapping): number {
  return (
    compareString(a.mode ?? "", b.mode ?? "") ||
    compareString(a.sourceToken, b.sourceToken) ||
    compareString(a.astryxToken ?? "", b.astryxToken ?? "")
  );
}

function compareWarnings(a: AstryxThemeWarning, b: AstryxThemeWarning): number {
  return (
    compareString(a.code, b.code) ||
    compareString(a.sourceToken ?? "", b.sourceToken ?? "") ||
    compareString(a.message, b.message)
  );
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
