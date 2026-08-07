/**
 * Configurable workspace policy checks for declarative design documents.
 *
 * Policy remains separate from DesignDocument so a document stays portable
 * between workspaces; the caller chooses which workspace policy to apply.
 */

import { z } from "zod";
import type { DesignDocument } from "./document.js";
import { SIZE_PRESETS } from "./presets.js";

export const ApprovalStateSchema = z.enum(["draft", "in-review", "approved", "rejected"]);

export const PolicyTermSchema = z.object({
  pattern: z.string().min(1).max(256),
  mode: z.enum(["substring", "regex"]).default("substring"),
}).strict().superRefine((term, context) => {
  if (term.mode === "regex") {
    const normalizedPattern = normalizePolicyText(term.pattern);
    const validationError = validateRestrictedRegexPattern(normalizedPattern);
    if (validationError !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: validationError,
        path: ["pattern"],
      });
      return;
    }
    try {
      new RegExp(normalizedPattern, "iu");
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Regex policy pattern is not valid after Unicode normalization",
        path: ["pattern"],
      });
    }
  }
});

const ApprovalSchema = z.object({
  state: ApprovalStateSchema.default("draft"),
  requireApprovalForExport: z.boolean().default(false),
}).strict().default({});

export const RestrictedCapabilitiesSchema = z.object({
  disallowImageLayers: z.boolean().default(false),
  requireBrandKitColors: z.boolean().default(false),
  requireRegisteredCanvasPreset: z.boolean().default(false),
  maxPages: z.number().int().positive().optional(),
}).strict().default({});

export const DesignPolicySchema = z.object({
  bannedTerms: z.array(PolicyTermSchema).default([]),
  requiredTerms: z.array(z.string().min(1).max(256)).default([]),
  approval: ApprovalSchema,
  restrictedCapabilities: RestrictedCapabilitiesSchema,
}).strict();

export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type PolicyTerm = z.infer<typeof PolicyTermSchema>;
export type RestrictedCapabilities = z.infer<typeof RestrictedCapabilitiesSchema>;
export type DesignPolicy = z.infer<typeof DesignPolicySchema>;

export interface PolicyViolation {
  pageId: string;
  layerId?: string;
  kind:
    | "banned-term"
    | "required-term"
    | "approval-required"
    | "image-layer"
    | "non-brand-kit-color"
    | "unregistered-canvas"
    | "page-limit";
  detail: string;
  severity: "error";
}

const LEGAL_APPROVAL_TRANSITIONS: Readonly<Record<ApprovalState, readonly ApprovalState[]>> = {
  draft: ["in-review"],
  "in-review": ["approved", "rejected"],
  approved: [],
  rejected: [],
};

/**
 * Policy regexes use an exhaustive grammar allowlist, rather than a blacklist,
 * because a missed JavaScript operator can silently change a workspace ban into
 * a broad match. Permitted atoms are literal text, character classes, and ^/$
 * anchors; a literal or class may have one fixed {n} repetition (0 through 64).
 * Classes allow an optional leading ^ negation, literal characters (with regex
 * syntax escaped), and simple ranges. Nothing else is passed to Node's engine,
 * so grouping, alternation, lookaround assertions, escape classes, and unbounded matching
 * cannot introduce backtracking behavior beyond this linear subset.
 */
export function isSafeRegexPattern(pattern: string): boolean {
  return validateRestrictedRegexPattern(pattern) === undefined;
}

const REGEX_SYNTAX_CHARACTERS = ".*+?|()[]{}^$\\";
const ESCAPABLE_LITERAL_CHARACTERS = ".*+?|()[]{}^$\\";

function regexValidationError(message: string, position: number): string {
  return `Regex policy pattern rejects ${message} at position ${position}`;
}

function readCharacterClassAtom(pattern: string, position: number): number | string {
  const character = pattern[position];
  if (character === "\\") {
    const escaped = pattern[position + 1];
    if (escaped === undefined) return regexValidationError("dangling escape", position);
    if (!ESCAPABLE_LITERAL_CHARACTERS.includes(escaped) && escaped !== "-") {
      return regexValidationError(`escape sequence \\${escaped}`, position);
    }
    return position + 2;
  }
  if (character === "[") return regexValidationError("nested character class '['", position);
  if (character === "^") return regexValidationError("unescaped '^' inside character class", position);
  if (character === "-") return regexValidationError("unescaped '-' outside a character-class range", position);
  if (character === undefined || character === "]") {
    return regexValidationError("incomplete character-class range", position);
  }
  return position + 1;
}

function readCharacterClass(pattern: string, openingPosition: number): number | string {
  let position = openingPosition + 1;
  if (pattern[position] === "^") position += 1;
  if (pattern[position] === "]" || position >= pattern.length) {
    return regexValidationError("empty character class '['", openingPosition);
  }

  let hasAtom = false;
  while (position < pattern.length && pattern[position] !== "]") {
    const atomEnd = readCharacterClassAtom(pattern, position);
    if (typeof atomEnd === "string") return atomEnd;
    hasAtom = true;
    position = atomEnd;

    if (pattern[position] === "-") {
      const rangePosition = position;
      position += 1;
      if (position >= pattern.length || pattern[position] === "]") {
        return regexValidationError("incomplete character-class range", rangePosition);
      }
      const rangeEnd = readCharacterClassAtom(pattern, position);
      if (typeof rangeEnd === "string") return rangeEnd;
      position = rangeEnd;
    }
  }

  if (!hasAtom || pattern[position] !== "]") {
    return regexValidationError("unterminated character class '['", openingPosition);
  }
  return position + 1;
}

function validateRestrictedRegexPattern(pattern: string): string | undefined {
  if (pattern.length === 0) return "Regex policy pattern rejects an empty pattern at position 0";
  if (pattern.length > 256) return "Regex policy pattern rejects a pattern longer than 256 characters at position 256";

  let canRepeat = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      const escaped = pattern[index + 1];
      if (escaped === undefined) return regexValidationError("dangling escape", index);
      if (!ESCAPABLE_LITERAL_CHARACTERS.includes(escaped)) {
        return regexValidationError(`escape sequence \\${escaped}`, index);
      }
      index += 1;
      canRepeat = true;
      continue;
    }

    if (character === "[") {
      const classEnd = readCharacterClass(pattern, index);
      if (typeof classEnd === "string") return classEnd;
      index = classEnd - 1;
      canRepeat = true;
      continue;
    }

    if (character === "{") {
      const closing = pattern.indexOf("}", index + 1);
      if (closing === -1) return regexValidationError("unterminated repetition '{'", index);
      const count = pattern.slice(index + 1, closing);
      if (!canRepeat || !/^\d+$/u.test(count) || Number(count) > 64) {
        return regexValidationError(`repetition {${count}}`, index);
      }
      index = closing;
      canRepeat = false;
      continue;
    }

    if (character === "^" || character === "$") {
      canRepeat = false;
      continue;
    }
    if (REGEX_SYNTAX_CHARACTERS.includes(character)) {
      return regexValidationError(`unescaped '${character}'`, index);
    }
    canRepeat = true;
  }

  return undefined;
}

/** Normalize compatibility forms and line breaks before policy matching. */
export function normalizePolicyText(value: string): string {
  return value.normalize("NFKC").replace(/[\r\n\u2028\u2029]/gu, "");
}

function plainSubstringMatches(text: string, pattern: string): boolean {
  return new RegExp(escapeRegex(normalizePolicyText(pattern)), "iu").test(text);
}

function termMatches(text: string, term: PolicyTerm): boolean {
  const normalizedText = normalizePolicyText(text);
  if (term.mode === "substring") return plainSubstringMatches(normalizedText, term.pattern);
  return new RegExp(normalizePolicyText(term.pattern), "iu").test(normalizedText);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function firstPageId(document: DesignDocument): string {
  return document.pages[0].id;
}

function colorIsInBrandKit(document: DesignDocument, color: string): boolean {
  return document.brandKit?.palette.some((swatch) =>
    swatch.value.toUpperCase() === color.toUpperCase()) ?? false;
}

function policyViolation(
  pageId: string,
  kind: PolicyViolation["kind"],
  detail: string,
  layerId?: string,
): PolicyViolation {
  return { pageId, ...(layerId === undefined ? {} : { layerId }), kind, detail, severity: "error" };
}

type RestrictionEvaluator = (document: DesignDocument, value: boolean | number) => PolicyViolation[];

/**
 * Keeping enabled restrictions in this registry makes the workspace policy
 * declarative: adding a capability does not require policy decisions at every
 * rendering or export call site.
 */
const RESTRICTION_EVALUATORS: Record<keyof RestrictedCapabilities, RestrictionEvaluator> = {
  disallowImageLayers: (document) => document.pages.flatMap((page) =>
    page.layers.filter((layer) => layer.type === "image").map((layer) => policyViolation(
      page.id,
      "image-layer",
      "Image layers are disabled by this workspace policy",
      layer.id,
    ))),
  requireBrandKitColors: (document) => {
    if (!document.brandKit) {
      return [policyViolation(
        firstPageId(document),
        "non-brand-kit-color",
        "Brand-kit color restriction requires document.brandKit",
      )];
    }

    const violations: PolicyViolation[] = [];
    for (const page of document.pages) {
      if (!colorIsInBrandKit(document, page.background)) {
        violations.push(policyViolation(
          page.id,
          "non-brand-kit-color",
          `Page background ${page.background} is not in brand kit ${document.brandKit.id}`,
        ));
      }
      for (const layer of page.layers) {
        const color = layer.type === "rect" ? layer.fill : layer.type === "text" ? layer.color : undefined;
        if (color !== undefined && !colorIsInBrandKit(document, color)) {
          violations.push(policyViolation(
            page.id,
            "non-brand-kit-color",
            `${layer.type === "rect" ? "Fill" : "Text color"} ${color} is not in brand kit ${document.brandKit.id}`,
            layer.id,
          ));
        }
      }
    }
    return violations;
  },
  requireRegisteredCanvasPreset: (document) => SIZE_PRESETS.some((preset) =>
    preset.width === document.canvas.width
      && preset.height === document.canvas.height
      && preset.unit === document.canvas.unit)
    ? []
    : [policyViolation(
      firstPageId(document),
      "unregistered-canvas",
      `Canvas ${document.canvas.width}x${document.canvas.height}${document.canvas.unit} is not a registered preset`,
    )],
  maxPages: (document, maxPages) => document.pages.slice(Number(maxPages)).map((page) => policyViolation(
    page.id,
    "page-limit",
    `Page ${page.id} exceeds the workspace maximum of ${maxPages} pages`,
  )),
};

/**
 * Evaluate violations without throwing for ordinary policy failures.
 *
 * Matching removes explicit line breaks within each individual text layer, so
 * a banned or required term split by authored wrapping is still found. Layers
 * are never concatenated: their geometric reading order is not reliable enough
 * to treat adjacent or overlapping layers as one sentence.
 */
export function evaluatePolicy(document: DesignDocument, policy: unknown): PolicyViolation[] {
  const parsed = DesignPolicySchema.parse(policy);
  const violations: PolicyViolation[] = [];

  for (const page of document.pages) {
    for (const layer of page.layers) {
      if (layer.type !== "text") continue;
      for (const term of parsed.bannedTerms) {
        if (termMatches(layer.text, term)) {
          violations.push(policyViolation(
            page.id,
            "banned-term",
            `Banned ${term.mode} matched: ${term.pattern}`,
            layer.id,
          ));
        }
      }
    }
  }

  for (const term of parsed.requiredTerms) {
    const present = document.pages.some((page) => page.layers.some((layer) =>
      layer.type === "text" && plainSubstringMatches(normalizePolicyText(layer.text), term)));
    if (!present) {
      violations.push(policyViolation(
        firstPageId(document),
        "required-term",
        `Required term is missing: ${term}`,
      ));
    }
  }

  if (parsed.approval.requireApprovalForExport && parsed.approval.state !== "approved") {
    violations.push(policyViolation(
      firstPageId(document),
      "approval-required",
      `Export requires approval; current state is ${parsed.approval.state}`,
    ));
  }

  for (const [capability, value] of Object.entries(parsed.restrictedCapabilities) as Array<
    [keyof RestrictedCapabilities, boolean | number | undefined]
  >) {
    if (value === false || value === undefined) continue;
    violations.push(...RESTRICTION_EVALUATORS[capability](document, value));
  }

  return violations;
}

/** Return whether the state machine permits a direct approval-state transition. */
export function canTransitionApproval(from: ApprovalState, to: ApprovalState): boolean {
  return LEGAL_APPROVAL_TRANSITIONS[from].includes(to);
}

/**
 * Move policy approval forward only along the published review workflow.
 * Rejected and approved policies are terminal; create a new policy revision to
 * start another review instead of silently reopening an approved artifact.
 */
export function transitionApproval(policy: unknown, nextState: ApprovalState): DesignPolicy {
  const parsed = DesignPolicySchema.parse(policy);
  if (!canTransitionApproval(parsed.approval.state, nextState)) {
    throw new Error(`Illegal approval transition: ${parsed.approval.state} -> ${nextState}`);
  }
  return { ...parsed, approval: { ...parsed.approval, state: nextState } };
}

/** Export is permitted only when all policy violations, including approval, are absent. */
export function isExportPermitted(document: DesignDocument, policy: unknown): boolean {
  return evaluatePolicy(document, policy).length === 0;
}
