/**
 * UI/UX Pro Max profile gate (POC for issue #24).
 *
 * The ui-ux-pro-max skill is a read-only local knowledge base, not a runtime
 * dependency. This POC copies exactly one selected profile into a small,
 * version-fixed constant and checks a profile-enabled document against it.
 * Plain `inspectDocument` callers never see these checks: the profile and the
 * role expectations are POC-private inputs supplied by tests (the public
 * `DesignDocument` schema has no role metadata yet).
 *
 * The existing `text-contrast-at-least-4.5` check stays the single contrast
 * authority; this gate references its result instead of re-computing ratios.
 */

import type { DesignDocument, DesignLayer } from "./document.js";
import type { QaCheck, QaReport } from "./qa.js";

export type UiuxPaletteRoleKey =
  | "page-background"
  | "page-foreground"
  | "primary"
  | "on-primary"
  | "accent"
  | "on-accent";

export interface UiuxPaletteRole {
  /** Role key from the `colors.csv` `Micro SaaS` row. */
  role: UiuxPaletteRoleKey;
  color: string;
}

export interface UiuxProfile {
  name: string;
  /** Provenance: skill DB rows the constant was copied from. */
  source: string;
  palette: UiuxPaletteRole[];
  headingFont: string;
  bodyFont: string;
  /** Allowed type scale in px (ux-guidelines.csv No. 74). */
  typeScale: readonly number[];
  /** Body minimum font size in px (quick-reference.md). */
  bodyMinFontSize: number;
  /** Body line-height range (ux-guidelines.csv No. 72). */
  bodyLineHeight: readonly [number, number];
  /** Normal-text contrast floor (ux-guidelines.csv No. 36). */
  contrastThreshold: number;
}

/**
 * Fixed POC profile: Micro SaaS palette + Korean Modern typography.
 *
 * Values copied verbatim from the skill data rows verified on 2026-08-08 in
 * docs/research/016-uiux-pro-max-integration.md#검증-보강:
 * - colors.csv `Micro SaaS`: Primary #6366F1, On Primary #FFFFFF,
 *   Accent #059669, Background #F5F3FF, Foreground #1E1B4B
 *   (On Accent #FFFFFF is the accent role pair per the POC spec).
 * - typography.csv `Korean Modern`: Heading Font/Body Font = Noto Sans KR.
 * - ux-guidelines.csv No. 36 (4.5:1 contrast), No. 72 (line height
 *   1.5-1.75), No. 74 (type scale 12/14/16/18/24/32).
 */
export const MICRO_SAAS_KOREAN_PROFILE: UiuxProfile = {
  name: "micro-saas-korean",
  source:
    "ui-ux-pro-max skill data: colors.csv `Micro SaaS` row, "
    + "typography.csv `Korean Modern` row, ux-guidelines.csv No. 36/72/74",
  palette: [
    { role: "primary", color: "#6366F1" },
    { role: "on-primary", color: "#FFFFFF" },
    { role: "accent", color: "#059669" },
    { role: "on-accent", color: "#FFFFFF" },
    { role: "page-background", color: "#F5F3FF" },
    { role: "page-foreground", color: "#1E1B4B" },
  ],
  headingFont: "Noto Sans KR",
  bodyFont: "Noto Sans KR",
  typeScale: [12, 14, 16, 18, 24, 32],
  bodyMinFontSize: 16,
  bodyLineHeight: [1.5, 1.75],
  contrastThreshold: 4.5,
};

export type UiuxTextRole = "heading" | "body" | "on-primary" | "on-accent";
export type UiuxSurfaceRole = "primary-surface" | "accent-surface";
export type UiuxRole = UiuxTextRole | UiuxSurfaceRole;

/**
 * POC-private role assignment. The public schema has no role metadata yet, so
 * the test fixture declares which layer plays which profile role.
 */
export interface UiuxRoleExpectation {
  pageId: string;
  layerId: string;
  role: UiuxRole;
}

export const UIUX_CHECK_NAMES = {
  palette: "uiux-palette-role-consistency",
  fontPairing: "uiux-font-pairing",
  typeScale: "uiux-type-scale",
  guidelineViolations: "uiux-guideline-violations",
} as const;

const TEXT_ROLE_COLOR: Record<UiuxTextRole, UiuxPaletteRoleKey> = {
  heading: "page-foreground",
  body: "page-foreground",
  "on-primary": "on-primary",
  "on-accent": "on-accent",
};

const SURFACE_ROLE_COLOR: Record<UiuxSurfaceRole, UiuxPaletteRoleKey> = {
  "primary-surface": "primary",
  "accent-surface": "accent",
};

function normalizeHex(color: string): string {
  return color.toLowerCase();
}

function profileColor(profile: UiuxProfile, role: UiuxPaletteRoleKey): string | undefined {
  return profile.palette.find((entry) => entry.role === role)?.color;
}

function findLayer(
  document: DesignDocument,
  pageId: string,
  layerId: string,
): DesignLayer | undefined {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  return page?.layers.find((layer) => layer.id === layerId);
}

function isTextRole(role: UiuxRole): role is UiuxTextRole {
  return role === "heading"
    || role === "body"
    || role === "on-primary"
    || role === "on-accent";
}

/**
 * Allowed color list. A brand kit takes precedence over the profile as the
 * permitted list; the profile is a recommendation and never overrides the
 * customer's brand (POC contract 5).
 */
function allowedColors(document: DesignDocument, profile: UiuxProfile): string[] {
  const brandKit = document.brandKit;
  const colors = brandKit !== undefined
    ? brandKit.palette.map((swatch) => normalizeHex(swatch.value))
    : profile.palette.map((entry) => normalizeHex(entry.color));
  return [...new Set(colors)];
}

function allowedFonts(document: DesignDocument, fallback: string): string[] {
  const brandKit = document.brandKit;
  return brandKit !== undefined
    ? brandKit.fonts.map((font) => font.family)
    : [fallback];
}

/**
 * `uiux-palette-role-consistency`: every declared role must carry the
 * profile's role color, and every color field must belong to the allowed
 * palette (brand kit first). Actual contrast stays with the existing
 * `text-contrast-at-least-4.5` check; this check never re-computes ratios.
 */
function paletteRoleConsistencyCheck(
  document: DesignDocument,
  profile: UiuxProfile,
  roles: readonly UiuxRoleExpectation[],
): QaCheck {
  const violations: string[] = [];

  for (const expectation of roles) {
    const layer = findLayer(document, expectation.pageId, expectation.layerId);
    const label = `${expectation.pageId}/${expectation.layerId}`;
    if (layer === undefined) {
      violations.push(`${label} (role ${expectation.role}: no such layer)`);
      continue;
    }

    if (expectation.role === "primary-surface" || expectation.role === "accent-surface") {
      const expected = profileColor(profile, SURFACE_ROLE_COLOR[expectation.role]);
      if (layer.type !== "rect") {
        violations.push(
          `${label} (role ${expectation.role}: expected a rect layer, found ${layer.type})`,
        );
      } else if (expected !== undefined && normalizeHex(layer.fill) !== normalizeHex(expected)) {
        violations.push(
          `${label} (rect fill ${layer.fill}: expected ${expectation.role} ${expected} from ${profile.name})`,
        );
      }
      continue;
    }

    const expected = profileColor(profile, TEXT_ROLE_COLOR[expectation.role]);
    if (layer.type !== "text") {
      violations.push(
        `${label} (role ${expectation.role}: expected a text layer, found ${layer.type})`,
      );
    } else if (expected !== undefined && normalizeHex(layer.color) !== normalizeHex(expected)) {
      violations.push(
        `${label} (text color ${layer.color}: expected ${expectation.role} ${expected} from ${profile.name})`,
      );
    }
  }

  const allowed = allowedColors(document, profile);
  const allowedLabel = allowed.map((color) => color.toUpperCase()).join(", ");
  const allowedSource = document.brandKit !== undefined ? "brand kit" : profile.name;

  for (const page of document.pages) {
    if (!allowed.includes(normalizeHex(page.background))) {
      violations.push(
        `${page.id} (page background ${page.background}: not in ${allowedSource} allowed colors [${allowedLabel}])`,
      );
    }
    for (const layer of page.layers) {
      const label = `${page.id}/${layer.id}`;
      if (layer.type === "rect" && !allowed.includes(normalizeHex(layer.fill))) {
        violations.push(
          `${label} (rect fill ${layer.fill}: not in ${allowedSource} allowed colors [${allowedLabel}])`,
        );
      }
      if (layer.type === "text" && !allowed.includes(normalizeHex(layer.color))) {
        violations.push(
          `${label} (text color ${layer.color}: not in ${allowedSource} allowed colors [${allowedLabel}])`,
        );
      }
    }
  }

  return {
    name: UIUX_CHECK_NAMES.palette,
    pass: violations.length === 0,
    ...(violations.length > 0 ? { detail: violations.join(", ") } : {}),
  };
}

/**
 * `uiux-font-pairing`: heading/body layers must use the profile pairing
 * (Korean Modern = Noto Sans KR) or, when a brand kit is present, a brand kit
 * family. Layers without a heading/body expectation are not checked, and a
 * profile run without any heading/body roles reports not-applicable.
 */
function fontPairingCheck(
  document: DesignDocument,
  profile: UiuxProfile,
  roles: readonly UiuxRoleExpectation[],
): QaCheck {
  const relevant = roles.filter((role) => role.role === "heading" || role.role === "body");
  if (relevant.length === 0) {
    return {
      name: UIUX_CHECK_NAMES.fontPairing,
      pass: true,
      detail: "not-applicable: no heading/body role expectations",
    };
  }

  const violations: string[] = [];
  const allowedHeading = allowedFonts(document, profile.headingFont);
  const allowedBody = allowedFonts(document, profile.bodyFont);

  for (const expectation of relevant) {
    const layer = findLayer(document, expectation.pageId, expectation.layerId);
    const label = `${expectation.pageId}/${expectation.layerId}`;
    if (layer === undefined) {
      violations.push(`${label} (role ${expectation.role}: no such layer)`);
      continue;
    }
    if (layer.type !== "text") {
      violations.push(
        `${label} (role ${expectation.role}: expected a text layer, found ${layer.type})`,
      );
      continue;
    }

    const allowed = expectation.role === "heading" ? allowedHeading : allowedBody;
    const matches = allowed.some(
      (family) => family.toLowerCase() === layer.fontFamily.toLowerCase(),
    );
    if (!matches) {
      violations.push(
        `${label} (${expectation.role}: font family "${layer.fontFamily}" not in ${profile.name} pairing [${allowed.join(", ")}])`,
      );
    }
  }

  return {
    name: UIUX_CHECK_NAMES.fontPairing,
    pass: violations.length === 0,
    ...(violations.length > 0 ? { detail: violations.join(", ") } : {}),
  };
}

/**
 * `uiux-type-scale`: every role-specified text layer must use a size from the
 * fixed scale; body layers must additionally meet the 16px minimum and the
 * 1.5-1.75 line-height range. One detail entry per violating layer keeps the
 * violation count per layer deterministic.
 */
function typeScaleCheck(
  document: DesignDocument,
  profile: UiuxProfile,
  roles: readonly UiuxRoleExpectation[],
): QaCheck {
  const relevant = roles.filter((role) => isTextRole(role.role));
  if (relevant.length === 0) {
    return {
      name: UIUX_CHECK_NAMES.typeScale,
      pass: true,
      detail: "not-applicable: no text role expectations",
    };
  }

  const violations: string[] = [];
  const scaleLabel = profile.typeScale.join("/");

  for (const expectation of relevant) {
    const layer = findLayer(document, expectation.pageId, expectation.layerId);
    const label = `${expectation.pageId}/${expectation.layerId}`;
    if (layer === undefined) {
      violations.push(`${label} (role ${expectation.role}: no such layer)`);
      continue;
    }
    if (layer.type !== "text") {
      violations.push(
        `${label} (role ${expectation.role}: expected a text layer, found ${layer.type})`,
      );
      continue;
    }

    const issues: string[] = [];
    if (!profile.typeScale.includes(layer.fontSize)) {
      issues.push(`font size ${layer.fontSize}px not in scale ${scaleLabel}`);
    }
    if (expectation.role === "body") {
      if (layer.fontSize < profile.bodyMinFontSize) {
        issues.push(`below ${profile.bodyMinFontSize}px body minimum`);
      }
      const [min, max] = profile.bodyLineHeight;
      if (layer.lineHeight < min || layer.lineHeight > max) {
        issues.push(`line height ${layer.lineHeight} outside ${min}-${max}`);
      }
    }
    if (issues.length > 0) {
      violations.push(`${label} (${expectation.role}): ${issues.join("; ")}`);
    }
  }

  return {
    name: UIUX_CHECK_NAMES.typeScale,
    pass: violations.length === 0,
    ...(violations.length > 0 ? { detail: violations.join(", ") } : {}),
  };
}

function countDetailEntries(detail: string | undefined): number {
  if (detail === undefined || detail.length === 0) return 0;
  return detail.split(", ").length;
}

/**
 * `uiux-guideline-violations`: summary over the implemented ux-guidelines.csv
 * rules (No. 36 contrast, No. 72 line height, No. 74 type scale). It
 * references the existing contrast check and the type-scale check instead of
 * re-determining contrast, and each violation is counted in exactly one kind.
 */
function guidelineViolationsCheck(baseReport: QaReport, typeScale: QaCheck): QaCheck {
  const contrast = baseReport.checks.find(
    (check) => check.name === "text-contrast-at-least-4.5",
  );
  const contrastCount = contrast !== undefined && !contrast.pass
    ? countDetailEntries(contrast.detail)
    : 0;
  const typographyCount = typeScale.pass ? 0 : countDetailEntries(typeScale.detail);
  const total = contrastCount + typographyCount;

  return {
    name: UIUX_CHECK_NAMES.guidelineViolations,
    pass: total === 0,
    ...(total > 0
      ? { detail: `color contrast: ${contrastCount}, typography: ${typographyCount}` }
      : {}),
  };
}

/**
 * Run the four profile-gate checks for a profile-enabled POC document.
 * Check names and order are fixed so identical input always yields the same
 * report: palette consistency, font pairing, type scale, guideline summary.
 */
export function runUiuxGateChecks(
  document: DesignDocument,
  baseReport: QaReport,
  profile: UiuxProfile,
  roles: readonly UiuxRoleExpectation[],
): QaCheck[] {
  const palette = paletteRoleConsistencyCheck(document, profile, roles);
  const fontPairing = fontPairingCheck(document, profile, roles);
  const typeScale = typeScaleCheck(document, profile, roles);
  const guidelineViolations = guidelineViolationsCheck(baseReport, typeScale);
  return [palette, fontPairing, typeScale, guidelineViolations];
}
