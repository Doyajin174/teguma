/**
 * UI/UX Pro Max QA gate POC (issue #24).
 *
 * Pins the fixed micro-saas-korean profile fixture from
 * docs/specs/016-uiux-qa-gate.md: the existing contrast check must report the
 * two weak pairs, the profile checks must report the type-scale and palette
 * violations separately, and profile-less documents must keep the historic
 * QaReport shape.
 */

import { describe, expect, it } from "vitest";
import { inspectDocument, parseDesignDocument } from "../src/design/index.js";
import {
  inspectDocumentWithUiuxProfile,
  MICRO_SAAS_KOREAN_PROFILE,
  type UiuxGateInput,
  type UiuxRoleExpectation,
} from "../src/design/qa.js";

const BASE_CHECK_NAMES = [
  "layers-inside-canvas",
  "content-respects-safe-area",
  "text-contrast-at-least-4.5",
  "text-fits-frame-width",
  "text-fits-frame-height",
  "text-not-occluded-by-later-opaque-layer",
  "image-layers-have-source",
  "brand-kit-respected",
] as const;

/**
 * Single repro fixture from the POC plan. `bad-contrast-1` is primary-colored
 * text on the page background (4.07:1), `bad-contrast-2` is on-accent text on
 * the accent band (3.77:1), `body-off-scale` is 15px body copy, and
 * `profile-palette-off` is an accent-surface rect in a color outside the
 * palette. `compliant-body` matches every rule.
 */
function fixtureDocument() {
  return parseDesignDocument({
    id: "uiux-poc-fixture",
    title: "UI/UX Pro Max POC fixture",
    canvas: { width: 1080, height: 1080 },
    pages: [{
      id: "p1",
      name: "P1",
      background: "#F5F3FF",
      layers: [
        {
          id: "bad-contrast-1",
          type: "text",
          frame: { x: 40, y: 40, width: 1000, height: 100 },
          text: "Primary",
          fontFamily: "Noto Sans KR",
          fontSize: 24,
          color: "#6366F1",
        },
        {
          id: "accent-band",
          type: "rect",
          frame: { x: 40, y: 200, width: 1000, height: 120 },
          fill: "#059669",
        },
        {
          id: "bad-contrast-2",
          type: "text",
          frame: { x: 60, y: 220, width: 960, height: 80 },
          text: "White",
          fontFamily: "Noto Sans KR",
          fontSize: 14,
          color: "#FFFFFF",
        },
        {
          id: "body-off-scale",
          type: "text",
          frame: { x: 40, y: 360, width: 1000, height: 80 },
          text: "Body 15",
          fontFamily: "Noto Sans KR",
          fontSize: 15,
          lineHeight: 1.5,
          color: "#1E1B4B",
        },
        {
          id: "profile-palette-off",
          type: "rect",
          frame: { x: 40, y: 500, width: 400, height: 120 },
          fill: "#DC2626",
        },
        {
          id: "compliant-body",
          type: "text",
          frame: { x: 40, y: 700, width: 1000, height: 80 },
          text: "Body 16",
          fontFamily: "Noto Sans KR",
          fontSize: 16,
          lineHeight: 1.5,
          color: "#1E1B4B",
        },
      ],
    }],
  });
}

const FIXTURE_ROLES: UiuxRoleExpectation[] = [
  { pageId: "p1", layerId: "bad-contrast-2", role: "on-accent" },
  { pageId: "p1", layerId: "body-off-scale", role: "body" },
  { pageId: "p1", layerId: "profile-palette-off", role: "accent-surface" },
  { pageId: "p1", layerId: "compliant-body", role: "body" },
];

const FIXTURE_INPUT: UiuxGateInput = {
  profile: MICRO_SAAS_KOREAN_PROFILE,
  roles: FIXTURE_ROLES,
};

function check(report: ReturnType<typeof inspectDocument>, name: string) {
  return report.checks.find((candidate) => candidate.name === name);
}

describe("ui-ux-pro-max QA gate POC", () => {
  it("reports contrast, type-scale, and palette violations as separate checks", () => {
    const report = inspectDocumentWithUiuxProfile(fixtureDocument(), FIXTURE_INPUT);

    // Existing contrast authority: exactly the two weak pairs, nothing more.
    const contrast = check(report, "text-contrast-at-least-4.5");
    expect(contrast).toMatchObject({ pass: false });
    expect(contrast?.detail?.split(", ")).toHaveLength(2);
    expect(contrast?.detail).toContain("p1/bad-contrast-1 (4.07:1)");
    expect(contrast?.detail).toContain("p1/bad-contrast-2 (3.77:1)");
    expect(contrast?.detail).not.toContain("compliant-body");

    // Palette role consistency: role mismatch plus out-of-kit color, both
    // pointing at the layer, the actual color, and the expected role.
    const palette = check(report, "uiux-palette-role-consistency");
    expect(palette).toMatchObject({ pass: false });
    expect(palette?.detail).toContain(
      "p1/profile-palette-off (rect fill #DC2626: expected accent-surface #059669 from micro-saas-korean)",
    );
    expect(palette?.detail).toContain(
      "p1/profile-palette-off (rect fill #DC2626: not in micro-saas-korean allowed colors [#6366F1, #FFFFFF, #059669, #F5F3FF, #1E1B4B])",
    );

    // Font pairing: both body layers use the Korean Modern pairing.
    expect(check(report, "uiux-font-pairing")).toMatchObject({ pass: true });

    // Type scale: exactly one violating layer.
    const typeScale = check(report, "uiux-type-scale");
    expect(typeScale).toMatchObject({ pass: false });
    expect(typeScale?.detail?.split(", ")).toHaveLength(1);
    expect(typeScale?.detail).toBe(
      "p1/body-off-scale (body): font size 15px not in scale 12/14/16/18/24/32; below 16px body minimum",
    );

    // UX guideline summary references the existing contrast check and the
    // type-scale check without re-counting anything twice.
    expect(check(report, "uiux-guideline-violations")).toEqual({
      name: "uiux-guideline-violations",
      pass: false,
      detail: "color contrast: 2, typography: 1",
    });

    expect(report.passed).toBe(false);
  });

  it("keeps the base checks identical to a plain profile-less inspection", () => {
    const plain = inspectDocument(fixtureDocument());
    const gated = inspectDocumentWithUiuxProfile(fixtureDocument(), FIXTURE_INPUT);

    expect(gated.checks.slice(0, plain.checks.length)).toEqual(plain.checks);
    expect(gated.checks.map((item) => item.name)).toEqual([
      ...BASE_CHECK_NAMES,
      "uiux-palette-role-consistency",
      "uiux-font-pairing",
      "uiux-type-scale",
      "uiux-guideline-violations",
    ]);
    expect(gated.passed).toBe(false);
  });

  it("returns an identical report for identical input", () => {
    const first = inspectDocumentWithUiuxProfile(fixtureDocument(), FIXTURE_INPUT);
    const second = inspectDocumentWithUiuxProfile(fixtureDocument(), FIXTURE_INPUT);
    expect(second).toEqual(first);
  });

  it("adds no profile checks to a plain document", () => {
    const report = inspectDocument(fixtureDocument());
    expect(report.checks.map((item) => item.name)).toEqual([...BASE_CHECK_NAMES]);
    expect(report.checks.some((item) => item.name.startsWith("uiux-"))).toBe(false);
  });

  it("keeps existing fail-closed contrast for indeterminate backdrops under the gate", () => {
    const imageBackdrop = parseDesignDocument({
      id: "uiux-image-backdrop",
      title: "image backdrop",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#FFFFFF",
        layers: [
          {
            id: "photo",
            type: "image",
            frame: { x: 0, y: 0, width: 200, height: 200 },
            source: "assets/black.png",
          },
          {
            id: "headline",
            type: "text",
            frame: { x: 20, y: 50, width: 160, height: 60 },
            text: "A",
            fontFamily: "Noto Sans KR",
            fontSize: 16,
            lineHeight: 1.6,
            color: "#1E1B4B",
          },
        ],
      }],
    });

    const imageReport = inspectDocumentWithUiuxProfile(imageBackdrop, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [{ pageId: "p1", layerId: "headline", role: "body" }],
    });
    expect(check(imageReport, "text-contrast-at-least-4.5")).toMatchObject({ pass: false });
    expect(check(imageReport, "text-contrast-at-least-4.5")?.detail).toContain(
      "indeterminate image backdrop",
    );

    const roundedBackdrop = parseDesignDocument({
      id: "uiux-rounded-backdrop",
      title: "rounded backdrop",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#FFFFFF",
        layers: [
          {
            id: "panel",
            type: "rect",
            frame: { x: 0, y: 0, width: 200, height: 200 },
            fill: "#6366F1",
            radius: 40,
          },
          {
            id: "headline",
            type: "text",
            frame: { x: 10, y: 10, width: 100, height: 40 },
            text: "A",
            fontFamily: "Noto Sans KR",
            fontSize: 16,
            lineHeight: 1.6,
            color: "#FFFFFF",
          },
        ],
      }],
    });

    const roundedReport = inspectDocumentWithUiuxProfile(roundedBackdrop, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [],
    });
    expect(check(roundedReport, "text-contrast-at-least-4.5")).toMatchObject({ pass: false });
    expect(check(roundedReport, "text-contrast-at-least-4.5")?.detail).toContain(
      "indeterminate rounded rect backdrop",
    );
  });

  it("reports not-applicable for profile runs without heading/body roles", () => {
    const document = parseDesignDocument({
      id: "uiux-no-roles",
      title: "no roles",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#F5F3FF",
        layers: [{
          id: "swatch",
          type: "rect",
          frame: { x: 20, y: 20, width: 100, height: 100 },
          fill: "#6366F1",
        }],
      }],
    });

    const report = inspectDocumentWithUiuxProfile(document, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [],
    });
    expect(check(report, "uiux-palette-role-consistency")).toMatchObject({ pass: true });
    expect(check(report, "uiux-font-pairing")).toEqual({
      name: "uiux-font-pairing",
      pass: true,
      detail: "not-applicable: no heading/body role expectations",
    });
    expect(check(report, "uiux-type-scale")).toEqual({
      name: "uiux-type-scale",
      pass: true,
      detail: "not-applicable: no text role expectations",
    });
    expect(check(report, "uiux-guideline-violations")).toMatchObject({ pass: true });
  });

  it("lets an active brand kit win as the allowed color and font list", () => {
    const document = parseDesignDocument({
      id: "uiux-brand-precedence",
      title: "brand precedence",
      canvas: { width: 1080, height: 1080 },
      brandKit: {
        id: "kit",
        name: "Kit",
        palette: [
          { id: "paper", name: "Paper", value: "#F5F3FF" },
          { id: "ink", name: "Ink", value: "#1E1B4B" },
          { id: "brand-red", name: "Brand red", value: "#DC2626" },
        ],
        fonts: [{ family: "Noto Sans KR", weights: [400, 700] }],
      },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#F5F3FF",
        layers: [
          {
            id: "brand-red-band",
            type: "rect",
            frame: { x: 40, y: 40, width: 400, height: 120 },
            fill: "#DC2626",
          },
          {
            id: "copy",
            type: "text",
            frame: { x: 40, y: 700, width: 1000, height: 80 },
            text: "Body 16",
            fontFamily: "Noto Sans KR",
            fontSize: 16,
            lineHeight: 1.6,
            color: "#1E1B4B",
          },
        ],
      }],
    });

    const report = inspectDocumentWithUiuxProfile(document, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [{ pageId: "p1", layerId: "copy", role: "body" }],
    });

    // #DC2626 is outside the profile palette but inside the brand kit, so the
    // profile gate must not flag it, and the brand-kit check must pass.
    expect(check(report, "uiux-palette-role-consistency")).toMatchObject({ pass: true });
    expect(check(report, "uiux-font-pairing")).toMatchObject({ pass: true });
    expect(check(report, "uiux-type-scale")).toMatchObject({ pass: true });
    expect(check(report, "brand-kit-respected")).toMatchObject({ pass: true });
    expect(report.passed).toBe(true);
  });

  it("fails font pairing for a heading outside the profile pairing", () => {
    const document = parseDesignDocument({
      id: "uiux-font-violation",
      title: "font violation",
      canvas: { width: 1080, height: 1080 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#F5F3FF",
        layers: [{
          id: "heading-off",
          type: "text",
          frame: { x: 40, y: 40, width: 1000, height: 100 },
          text: "Heading",
          fontFamily: "Arial",
          fontSize: 24,
          lineHeight: 1.5,
          color: "#1E1B4B",
        }],
      }],
    });

    const report = inspectDocumentWithUiuxProfile(document, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [{ pageId: "p1", layerId: "heading-off", role: "heading" }],
    });

    expect(check(report, "uiux-font-pairing")).toEqual({
      name: "uiux-font-pairing",
      pass: false,
      detail:
        'p1/heading-off (heading: font family "Arial" not in micro-saas-korean pairing [Noto Sans KR])',
    });
    expect(check(report, "uiux-palette-role-consistency")).toMatchObject({ pass: true });
    expect(check(report, "uiux-type-scale")).toMatchObject({ pass: true });
  });

  it("fails type scale for a body line height outside 1.5-1.75", () => {
    const document = parseDesignDocument({
      id: "uiux-line-height-violation",
      title: "line height violation",
      canvas: { width: 1080, height: 1080 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#F5F3FF",
        layers: [{
          id: "body-tight",
          type: "text",
          frame: { x: 40, y: 40, width: 1000, height: 80 },
          text: "Body 16",
          fontFamily: "Noto Sans KR",
          fontSize: 16,
          lineHeight: 1.3,
          color: "#1E1B4B",
        }],
      }],
    });

    const report = inspectDocumentWithUiuxProfile(document, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [{ pageId: "p1", layerId: "body-tight", role: "body" }],
    });

    expect(check(report, "uiux-type-scale")).toEqual({
      name: "uiux-type-scale",
      pass: false,
      detail: "p1/body-tight (body): line height 1.3 outside 1.5-1.75",
    });
    expect(check(report, "uiux-font-pairing")).toMatchObject({ pass: true });
    expect(check(report, "uiux-guideline-violations")).toEqual({
      name: "uiux-guideline-violations",
      pass: false,
      detail: "color contrast: 0, typography: 1",
    });
  });

  it("checks heading roles against the fixed scale", () => {
    const document = parseDesignDocument({
      id: "uiux-heading-roles",
      title: "heading roles",
      canvas: { width: 1080, height: 1080 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#F5F3FF",
        layers: [
          {
            id: "heading-ok",
            type: "text",
            frame: { x: 40, y: 40, width: 1000, height: 100 },
            text: "Heading 24",
            fontFamily: "Noto Sans KR",
            fontSize: 24,
            lineHeight: 1.5,
            color: "#1E1B4B",
          },
          {
            id: "heading-off-scale",
            type: "text",
            frame: { x: 40, y: 200, width: 1000, height: 80 },
            text: "Heading 13",
            fontFamily: "Noto Sans KR",
            fontSize: 13,
            lineHeight: 1.5,
            color: "#1E1B4B",
          },
        ],
      }],
    });

    const report = inspectDocumentWithUiuxProfile(document, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [
        { pageId: "p1", layerId: "heading-ok", role: "heading" },
        { pageId: "p1", layerId: "heading-off-scale", role: "heading" },
      ],
    });

    expect(check(report, "uiux-palette-role-consistency")).toMatchObject({ pass: true });
    expect(check(report, "uiux-font-pairing")).toMatchObject({ pass: true });
    expect(check(report, "uiux-type-scale")).toEqual({
      name: "uiux-type-scale",
      pass: false,
      detail: "p1/heading-off-scale (heading): font size 13px not in scale 12/14/16/18/24/32",
    });
  });

  it("reports role expectations that point at a missing layer in every role check", () => {
    const document = parseDesignDocument({
      id: "uiux-missing-layer",
      title: "missing layer",
      canvas: { width: 200, height: 200 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#F5F3FF",
        layers: [],
      }],
    });

    const report = inspectDocumentWithUiuxProfile(document, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [{ pageId: "p1", layerId: "ghost", role: "body" }],
    });

    const missing = "p1/ghost (role body: no such layer)";
    expect(check(report, "uiux-palette-role-consistency")).toEqual({
      name: "uiux-palette-role-consistency",
      pass: false,
      detail: missing,
    });
    expect(check(report, "uiux-font-pairing")).toEqual({
      name: "uiux-font-pairing",
      pass: false,
      detail: missing,
    });
    expect(check(report, "uiux-type-scale")).toEqual({
      name: "uiux-type-scale",
      pass: false,
      detail: missing,
    });
  });

  it("reports text/surface role expectations on the wrong layer type", () => {
    const document = parseDesignDocument({
      id: "uiux-type-mismatch",
      title: "type mismatch",
      canvas: { width: 1080, height: 1080 },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#F5F3FF",
        layers: [
          {
            id: "square",
            type: "rect",
            frame: { x: 40, y: 40, width: 400, height: 120 },
            fill: "#6366F1",
          },
          {
            id: "words",
            type: "text",
            frame: { x: 40, y: 700, width: 1000, height: 80 },
            text: "Body 16",
            fontFamily: "Noto Sans KR",
            fontSize: 16,
            lineHeight: 1.6,
            color: "#1E1B4B",
          },
        ],
      }],
    });

    const report = inspectDocumentWithUiuxProfile(document, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [
        { pageId: "p1", layerId: "square", role: "heading" },
        { pageId: "p1", layerId: "words", role: "primary-surface" },
      ],
    });

    expect(check(report, "uiux-palette-role-consistency")).toEqual({
      name: "uiux-palette-role-consistency",
      pass: false,
      detail:
        "p1/square (role heading: expected a text layer, found rect), "
        + "p1/words (role primary-surface: expected a rect layer, found text)",
    });
    expect(check(report, "uiux-font-pairing")).toEqual({
      name: "uiux-font-pairing",
      pass: false,
      detail: "p1/square (role heading: expected a text layer, found rect)",
    });
    expect(check(report, "uiux-type-scale")).toEqual({
      name: "uiux-type-scale",
      pass: false,
      detail: "p1/square (role heading: expected a text layer, found rect)",
    });
  });

  it("reports a role mismatch for a brand kit color that is allowed but not the profile role color", () => {
    const document = parseDesignDocument({
      id: "uiux-brand-role-conflict",
      title: "brand role conflict",
      canvas: { width: 1080, height: 1080 },
      brandKit: {
        id: "kit",
        name: "Kit",
        palette: [
          { id: "paper", name: "Paper", value: "#F5F3FF" },
          { id: "ink", name: "Ink", value: "#1E1B4B" },
          { id: "brand-red", name: "Brand red", value: "#DC2626" },
        ],
        fonts: [{ family: "Noto Sans KR", weights: [400, 700] }],
      },
      pages: [{
        id: "p1",
        name: "P1",
        background: "#F5F3FF",
        layers: [
          {
            id: "red-band",
            type: "rect",
            frame: { x: 40, y: 40, width: 400, height: 120 },
            fill: "#DC2626",
          },
          {
            id: "copy",
            type: "text",
            frame: { x: 40, y: 700, width: 1000, height: 80 },
            text: "Body 16",
            fontFamily: "Noto Sans KR",
            fontSize: 16,
            lineHeight: 1.6,
            color: "#1E1B4B",
          },
        ],
      }],
    });

    const report = inspectDocumentWithUiuxProfile(document, {
      profile: MICRO_SAAS_KOREAN_PROFILE,
      roles: [
        { pageId: "p1", layerId: "red-band", role: "primary-surface" },
        { pageId: "p1", layerId: "copy", role: "body" },
      ],
    });

    // #DC2626 is inside the brand kit (allowed) but differs from the profile's
    // primary #6366F1: the mixed scenario is "inside the kit, role mismatch".
    const palette = check(report, "uiux-palette-role-consistency");
    expect(palette).toMatchObject({ pass: false });
    expect(palette?.detail).toBe(
      "p1/red-band (rect fill #DC2626: expected primary-surface #6366F1 from micro-saas-korean)",
    );
    expect(palette?.detail).not.toContain("not in");
    expect(check(report, "brand-kit-respected")).toMatchObject({ pass: true });
    expect(check(report, "uiux-font-pairing")).toMatchObject({ pass: true });
    expect(check(report, "uiux-type-scale")).toMatchObject({ pass: true });
  });
});
