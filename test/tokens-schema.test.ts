/**
 * canonical token contract v0.1.0 — 스키마 검증 테스트 (명세 4장).
 *
 * - discriminated union(4.3) 필수 동작, 폐쇄 enum(4.2·4.3·4.4), 문서 무결성.
 * - 검증 실패 케이스: status/reason/kind/type/unit 위반, 중복 id, 빈 values,
 *   버전 불일치.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertCanonicalDocumentSorted,
  parseCanonicalDocument,
} from "../src/tokens/index.js";
import {
  CanonicalTokenDocumentSchema,
  CanonicalTokenSchema,
} from "../src/tokens/schema.js";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/canonical-token-document.json", import.meta.url));

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

describe("canonical 문서 스키마", () => {
  it("명세 10장 예시 구조의 fixture를 검증·정렬 정규화한다", () => {
    const doc = parseCanonicalDocument(readFileSync(FIXTURE_PATH, "utf8"));
    expect(doc.schemaVersion).toBe("0.1.0");
    expect(doc.document).toMatchObject({
      id: "canonical:seed:seed-poc",
      sourceAdapter: "seed",
      sourceName: "Seed POC",
    });
    expect(doc.tokens.length).toBeGreaterThan(0);
    assertCanonicalDocumentSorted(doc);
  });

  it("schemaVersion은 정확히 0.1.0이어야 한다", () => {
    const doc = loadFixture() as Record<string, unknown>;
    const result = CanonicalTokenDocumentSchema.safeParse({ ...doc, schemaVersion: "0.2.0" });
    expect(result.success).toBe(false);
  });

  it("동일 logical id는 문서에 두 번 나타날 수 없다 (4.2)", () => {
    const doc = loadFixture() as { tokens: unknown[] };
    const duplicated = { ...doc, tokens: [...doc.tokens, doc.tokens[0]] };
    const result = CanonicalTokenDocumentSchema.safeParse(duplicated);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("duplicate token id"))).toBe(true);
    }
  });
});

describe("mode 값 discriminated union (4.3)", () => {
  const baseToken = {
    id: "seed:$dimension.x1",
    path: "$dimension.x1",
    type: "dimension",
    values: { default: { status: "resolved", raw: "4px", resolvedValue: { sourceValue: { value: 4, unit: "px" }, resolvedValue: { value: 4, unit: "px" } } } },
    provenance: { adapter: "seed", sourcePath: "$dimension.x1", sourceId: "seed-poc", collection: "global" },
  };

  it("resolved는 resolvedValue를 필수로 갖는다", () => {
    const result = CanonicalTokenSchema.safeParse({
      ...baseToken,
      values: { default: { status: "resolved", raw: "4px" } },
    });
    expect(result.success).toBe(false);
  });

  it("unresolved는 alias와 폐쇄 reason(circular|missing)을 필수로 갖는다", () => {
    const badReason = CanonicalTokenSchema.safeParse({
      ...baseToken,
      values: { default: { status: "unresolved", raw: "$x", alias: { ref: "seed:$x", resolved: false, reason: "unknown" } } },
    });
    expect(badReason.success).toBe(false);

    const missingAlias = CanonicalTokenSchema.safeParse({
      ...baseToken,
      values: { default: { status: "unresolved", raw: "$x" } },
    });
    expect(missingAlias.success).toBe(false);
  });

  it("알 수 없는 status는 거부된다", () => {
    const result = CanonicalTokenSchema.safeParse({
      ...baseToken,
      values: { default: { status: "pending", raw: "4px" } },
    });
    expect(result.success).toBe(false);
  });

  it("resolved alias는 resolved: true여야 한다", () => {
    const result = CanonicalTokenSchema.safeParse({
      ...baseToken,
      values: {
        default: {
          ...baseToken.values.default,
          alias: { ref: "seed:$dimension.x2", resolved: false },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("폐쇄 enum (4.2·4.3·4.4·4.5)", () => {
  const baseToken = {
    id: "seed:$dimension.x1",
    path: "$dimension.x1",
    type: "dimension",
    values: { default: { status: "resolved", raw: "4px", resolvedValue: { sourceValue: { value: 4, unit: "px" }, resolvedValue: { value: 4, unit: "px" } } } },
    provenance: { adapter: "seed", sourcePath: "$dimension.x1", sourceId: "seed-poc", collection: "global" },
  };

  it("kind는 폐쇄 enum — v0.1 외 값 거부", () => {
    for (const kind of ["shadow", "gradient", "border"]) {
      const result = CanonicalTokenSchema.safeParse({ ...baseToken, kind });
      expect(result.success).toBe(false);
    }
  });

  it("type은 v0.1 어휘 6종만 허용한다", () => {
    for (const type of ["shadow", "typography", "strokeStyle"]) {
      const result = CanonicalTokenSchema.safeParse({ ...baseToken, type });
      expect(result.success).toBe(false);
    }
  });

  it("unit은 px|rem|ms|s|% 폐쇄 union이다", () => {
    const result = CanonicalTokenSchema.safeParse({
      ...baseToken,
      values: { default: { status: "resolved", raw: "2vw", resolvedValue: { sourceValue: { value: 2, unit: "vw" }, resolvedValue: { value: 2, unit: "vw" } } } },
    });
    expect(result.success).toBe(false);
  });

  it("토큰은 최소 1개 mode 값을 가져야 한다", () => {
    const result = CanonicalTokenSchema.safeParse({ ...baseToken, values: {} });
    expect(result.success).toBe(false);
  });
});

describe("결정론 정렬 검증 (4.8)", () => {
  it("정렬 위반 문서를 거부한다", () => {
    const doc = parseCanonicalDocument(readFileSync(FIXTURE_PATH, "utf8"));
    const shuffled = { ...doc, tokens: [...doc.tokens].reverse() };
    expect(() => assertCanonicalDocumentSorted(shuffled)).toThrow(/not sorted by id/);
  });
});
