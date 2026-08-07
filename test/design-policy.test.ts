import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DesignPolicySchema,
  evaluatePolicy,
  inspectDocument,
  parseDesignDocument,
  transitionApproval,
  type DesignDocument,
} from "../src/design/index.js";
import { checkDesignPolicyTool } from "../src/tools/design-engine.js";
import { createServer } from "../src/server.js";

function documentWith(overrides: Partial<DesignDocument> = {}): DesignDocument {
  return parseDesignDocument({
    id: "policy-doc",
    title: "Policy document",
    canvas: { width: 1080, height: 1080 },
    brandKit: {
      id: "kit",
      name: "Kit",
      palette: [
        { id: "paper", name: "Paper", value: "#FFFFFF" },
        { id: "ink", name: "Ink", value: "#111111" },
      ],
      fonts: [{ family: "IBM Plex Sans KR", weights: [400] }],
    },
    pages: [{
      id: "p1",
      name: "Page 1",
      background: "#FFFFFF",
      layers: [{
        id: "copy",
        type: "text",
        frame: { x: 0, y: 0, width: 1080, height: 200 },
        text: "Approved launch copy",
        fontFamily: "IBM Plex Sans KR",
        fontSize: 24,
        color: "#111111",
      }],
    }],
    ...overrides,
  });
}

describe("design policy", () => {
  it("reports a banned substring with its page and layer", () => {
    const document = documentWith({
      pages: [{
        id: "p1",
        name: "Page 1",
        layers: [{
          id: "copy",
          type: "text",
          frame: { x: 0, y: 0, width: 1080, height: 200 },
          text: "This launch is secret",
          fontFamily: "IBM Plex Sans KR",
          fontSize: 24,
          color: "#111111",
        }],
      }],
    });

    expect(evaluatePolicy(document, { bannedTerms: [{ pattern: "secret" }] })).toContainEqual(
      expect.objectContaining({ pageId: "p1", layerId: "copy", kind: "banned-term" }),
    );
  });

  it("matches case-insensitively after Unicode compatibility normalization", () => {
    const document = documentWith({
      pages: [{
        id: "p1",
        name: "Page 1",
        layers: [{
          id: "copy",
          type: "text",
          frame: { x: 0, y: 0, width: 1080, height: 200 },
          text: "foo \u1100\u1161",
          fontFamily: "IBM Plex Sans KR",
          fontSize: 24,
          color: "#111111",
        }],
      }],
    });

    const violations = evaluatePolicy(document, {
      bannedTerms: [{ pattern: "ＦＯＯ" }, { pattern: "가" }],
    });

    expect(violations.filter((violation) => violation.kind === "banned-term")).toHaveLength(2);
  });

  it("joins explicit line breaks within one text layer before matching", () => {
    const document = documentWith({
      pages: [{
        id: "p1",
        name: "Page 1",
        layers: [{
          id: "copy",
          type: "text",
          frame: { x: 0, y: 0, width: 1080, height: 200 },
          text: "ban\nned",
          fontFamily: "IBM Plex Sans KR",
          fontSize: 24,
          color: "#111111",
        }],
      }],
    });

    expect(evaluatePolicy(document, { bannedTerms: [{ pattern: "banned" }] })).toHaveLength(1);
  });

  it("reports missing required terms", () => {
    const violations = evaluatePolicy(documentWith(), { requiredTerms: ["Legal disclaimer"] });

    expect(violations).toContainEqual(expect.objectContaining({ kind: "required-term", pageId: "p1" }));
  });

  it("rejects dangerous regexes before they can run", () => {
    const startedAt = performance.now();
    expect(() => DesignPolicySchema.parse({
      bannedTerms: [{ pattern: "(a+)+$", mode: "regex" }],
    })).toThrow(/unescaped '\('/);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });

  it("uses an exhaustive allowlist for regex constructs", () => {
    const cases: Array<{ pattern: string; accepted: boolean; construct: string }> = [
      { pattern: ".", accepted: false, construct: "unescaped '.'" },
      { pattern: "*", accepted: false, construct: "unescaped '*'" },
      { pattern: "+", accepted: false, construct: "unescaped '+'" },
      { pattern: "?", accepted: false, construct: "unescaped '?'" },
      { pattern: "|", accepted: false, construct: "unescaped '|'" },
      { pattern: "(", accepted: false, construct: "unescaped '('" },
      { pattern: ")", accepted: false, construct: "unescaped ')'" },
      { pattern: "[", accepted: false, construct: "empty character class" },
      { pattern: "]", accepted: false, construct: "unescaped ']'" },
      { pattern: "{", accepted: false, construct: "unterminated repetition" },
      { pattern: "}", accepted: false, construct: "unescaped '}'" },
      { pattern: "^", accepted: true, construct: "start anchor" },
      { pattern: "$", accepted: true, construct: "end anchor" },
      { pattern: "\\", accepted: false, construct: "dangling escape" },
      { pattern: String.raw`\d`, accepted: false, construct: "escape sequence \\d" },
      { pattern: String.raw`\w`, accepted: false, construct: "escape sequence \\w" },
      { pattern: String.raw`\s`, accepted: false, construct: "escape sequence \\s" },
      { pattern: String.raw`\b`, accepted: false, construct: "escape sequence \\b" },
      { pattern: String.raw`\B`, accepted: false, construct: "escape sequence \\B" },
      { pattern: String.raw`\p{L}`, accepted: false, construct: "escape sequence \\p" },
      { pattern: String.raw`\u{41}`, accepted: false, construct: "escape sequence \\u" },
      { pattern: String.raw`\x41`, accepted: false, construct: "escape sequence \\x" },
      { pattern: String.raw`\1`, accepted: false, construct: "escape sequence \\1" },
      { pattern: String.raw`\.`, accepted: true, construct: "escaped literal period" },
      { pattern: "a{2}", accepted: true, construct: "fixed repetition" },
      { pattern: "a{2,}", accepted: false, construct: "repetition {2,}" },
      { pattern: "a{2,3}", accepted: false, construct: "repetition {2,3}" },
    ];

    for (const { pattern, accepted, construct } of cases) {
      const result = DesignPolicySchema.safeParse({
        bannedTerms: [{ pattern, mode: "regex" }],
      });
      expect(result.success, `${pattern} (${construct})`).toBe(accepted);
      if (!accepted && !result.success) {
        expect(result.error.issues[0]?.message, `${pattern} (${construct})`).toContain(construct);
        expect(result.error.issues[0]?.message, `${pattern} (${construct})`).toMatch(/position \d+/);
      }
    }
  });

  it("allows only simple, explicit character-class contents", () => {
    for (const pattern of ["[a-zA-Z0-9]", "[^a-z]", String.raw`[\]\-]`]) {
      expect(DesignPolicySchema.safeParse({
        bannedTerms: [{ pattern, mode: "regex" }],
      }).success, pattern).toBe(true);
    }

    for (const [pattern, construct] of [
      ["[]", "empty character class"],
      ["[a-]", "incomplete character-class range"],
      ["[a[b]", "nested character class"],
      ["[a^b]", "unescaped '^' inside character class"],
      [String.raw`[\d]`, "escape sequence \\d"],
    ]) {
      const result = DesignPolicySchema.safeParse({
        bannedTerms: [{ pattern, mode: "regex" }],
      });
      expect(result.success, pattern).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toContain(construct);
    }
  });

  it("treats escaped periods as literals, not wildcards", () => {
    const matchesPeriod = evaluatePolicy(documentWith(), {
      bannedTerms: [{ pattern: String.raw`\.`, mode: "regex" }],
    });
    const otherCharacter = documentWith({
      pages: [{
        id: "p1",
        name: "Page 1",
        layers: [{
          id: "copy",
          type: "text",
          frame: { x: 0, y: 0, width: 1080, height: 200 },
          text: "Approved launch copy X",
          fontFamily: "IBM Plex Sans KR",
          fontSize: 24,
          color: "#111111",
        }],
      }],
    });

    expect(matchesPeriod).toHaveLength(0);
    expect(evaluatePolicy(otherCharacter, {
      bannedTerms: [{ pattern: String.raw`\.`, mode: "regex" }],
    })).toHaveLength(0);
    expect(evaluatePolicy(documentWith({
      pages: [{
        id: "p1",
        name: "Page 1",
        layers: [{
          id: "copy",
          type: "text",
          frame: { x: 0, y: 0, width: 1080, height: 200 },
          text: "Approved launch copy.",
          fontFamily: "IBM Plex Sans KR",
          fontSize: 24,
          color: "#111111",
        }],
      }],
    }), { bannedTerms: [{ pattern: String.raw`\.`, mode: "regex" }] })).toHaveLength(1);
  });

  it("allows only the stated approval transitions", () => {
    const draft = DesignPolicySchema.parse({});
    const reviewed = transitionApproval(draft, "in-review");
    const approved = transitionApproval(reviewed, "approved");

    expect(approved.approval.state).toBe("approved");
    expect(() => transitionApproval(draft, "approved")).toThrow(
      "Illegal approval transition: draft -> approved",
    );
    expect(() => transitionApproval(approved, "in-review")).toThrow(
      "Illegal approval transition: approved -> in-review",
    );
    const rejected = transitionApproval(reviewed, "rejected");
    expect(() => transitionApproval(rejected, "in-review")).toThrow(
      "Illegal approval transition: rejected -> in-review",
    );
  });

  it("gates export only when approval is required", () => {
    const document = documentWith();

    expect(JSON.parse(checkDesignPolicyTool({
      document,
      policy: { approval: { state: "draft", requireApprovalForExport: true } },
    })).exportPermitted).toBe(false);
    expect(JSON.parse(checkDesignPolicyTool({
      document,
      policy: { approval: { state: "draft", requireApprovalForExport: false } },
    })).exportPermitted).toBe(true);
  });

  it("enforces declared image, color, canvas, and page restrictions", () => {
    const document = documentWith({
      canvas: { width: 999, height: 777, unit: "px", safeMargin: 0 },
      pages: [
        {
          id: "p1",
          name: "Page 1",
          background: "#FFFFFF",
          layers: [
            {
              id: "off-kit",
              type: "rect",
              frame: { x: 0, y: 0, width: 100, height: 100 },
              fill: "#FF0000",
            },
            {
              id: "photo",
              type: "image",
              frame: { x: 100, y: 0, width: 100, height: 100 },
              source: "assets/photo.png",
            },
          ],
        },
        { id: "p2", name: "Page 2", layers: [] },
      ],
    });

    const violations = evaluatePolicy(document, {
      restrictedCapabilities: {
        disallowImageLayers: true,
        requireBrandKitColors: true,
        requireRegisteredCanvasPreset: true,
        maxPages: 1,
      },
    });

    expect(violations.map((violation) => violation.kind)).toEqual(expect.arrayContaining([
      "image-layer",
      "non-brand-kit-color",
      "unregistered-canvas",
      "page-limit",
    ]));
    expect(inspectDocument(document, {
      restrictedCapabilities: { disallowImageLayers: true },
    }).checks.find((check) => check.name === "policy-restricted-capabilities")?.pass).toBe(false);
  });

  it("leaves reports exactly unchanged when no policy is supplied", () => {
    const document = documentWith();
    const report = inspectDocument(document);

    expect(report).toEqual(inspectDocument(document, undefined));
    expect(report).not.toHaveProperty("policyViolations");
    expect(report.checks.map((check) => check.name)).toEqual([
      "layers-inside-canvas",
      "content-respects-safe-area",
      "text-contrast-at-least-4.5",
      "text-fits-frame-width",
      "text-fits-frame-height",
      "text-not-occluded-by-later-opaque-layer",
      "image-layers-have-source",
      "brand-kit-respected",
    ]);
  });

  it("returns policy violations and export permission through the MCP tool", async () => {
    const server = createServer({ penpotBaseUrl: "http://localhost:9001", penpotToken: "test-token" });
    const client = new Client({ name: "policy-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const result = await client.callTool({
        name: "check_design_policy",
        arguments: {
          document: documentWith(),
          policy: {
            bannedTerms: [{ pattern: "launch" }],
            approval: { state: "draft", requireApprovalForExport: true },
          },
        },
      });
      const text = (result.content as Array<{ type: string; text: string }>)
        .map((item) => item.text)
        .join("\n");
      const body = JSON.parse(text);

      expect(body.approvalState).toBe("draft");
      expect(body.exportPermitted).toBe(false);
      expect(body.violations.map((violation: { kind: string }) => violation.kind)).toEqual(
        expect.arrayContaining(["banned-term", "approval-required"]),
      );
    } finally {
      await client.close();
    }
  });
});
