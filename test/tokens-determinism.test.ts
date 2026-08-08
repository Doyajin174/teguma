/**
 * 결정론 테스트 (명세 원칙 2·4.8).
 *
 * - 동일 입력 → 동일 canonical JSON 바이트 (SEED·Penpot 어댑터).
 * - 입력 순서에 무관한 고정 정렬: tokens id 바이트 순, values default→light→dark,
 *   loss category → tokenId/path → mode → code → raw → reason.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readSeedRootageFile,
  type SeedRootageFile,
} from "../src/design/seed.js";
import type { PenpotFile } from "../src/penpot/types.js";
import {
  assertCanonicalDocumentSorted,
  compareLossItems,
  sortCanonicalDocument,
  sortImportLoss,
  transformPenpotFileToCanonical,
  transformSeedRootageToCanonical,
  type CanonicalLossItem,
  type CanonicalTokenDocument,
} from "../src/tokens/index.js";
import penpotFixture from "./fixtures/penpot-canonical.json";

const SEED_FIXTURE_PATH = fileURLToPath(new URL("./fixtures/seed-rootage-canonical.yaml", import.meta.url));

describe("결정론 — 동일 입력 → 동일 JSON 바이트", () => {
  it("SEED 어댑터는 반복 호출에 대해 바이트 단위 동일 출력을 만든다", () => {
    const rootageA = readSeedRootageFile(SEED_FIXTURE_PATH);
    const rootageB = readSeedRootageFile(SEED_FIXTURE_PATH);
    const jsonA = JSON.stringify(transformSeedRootageToCanonical(rootageA), null, 2);
    const jsonB = JSON.stringify(transformSeedRootageToCanonical(rootageB), null, 2);
    expect(jsonA).toBe(jsonB);
  });

  it("Penpot 어댑터는 반복 호출에 대해 바이트 단위 동일 출력을 만든다", () => {
    const a = transformPenpotFileToCanonical(JSON.parse(JSON.stringify(penpotFixture)) as PenpotFile);
    const b = transformPenpotFileToCanonical(JSON.parse(JSON.stringify(penpotFixture)) as PenpotFile);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("결정론 — 4.8 정렬 규칙", () => {
  function buildShuffledDoc(): CanonicalTokenDocument {
    const doc = transformSeedRootageToCanonical(readSeedRootageFile(SEED_FIXTURE_PATH));
    return {
      ...doc,
      tokens: [...doc.tokens].reverse(),
      importLoss: {
        unsupported: [...doc.importLoss.unsupported].reverse(),
        ambiguous: [],
        lossy: [...doc.importLoss.lossy].reverse(),
      },
    };
  }

  it("입력 순서와 무관하게 고정 정렬로 정규화된다", () => {
    const shuffled = buildShuffledDoc();
    const sorted = sortCanonicalDocument(shuffled);
    assertCanonicalDocumentSorted(sorted);

    const expectedIds = [...shuffled.tokens].map((token) => token.id).sort();
    expect(sorted.tokens.map((token) => token.id)).toEqual(expectedIds);
  });

  it("values 키 순서는 default → light → dark", () => {
    const doc = transformSeedRootageToCanonical(readSeedRootageFile(SEED_FIXTURE_PATH));
    for (const token of doc.tokens) {
      const keys = Object.keys(token.values);
      const present = ["default", "light", "dark"].filter(
        (mode) => token.values[mode as keyof typeof token.values] !== undefined,
      );
      expect(keys).toEqual(present);
    }
  });

  it("loss 항목은 tokenId/path → mode → code → raw → reason 순으로 정렬된다", () => {
    const items: CanonicalLossItem[] = [
      { path: "B", code: "z", reason: "" },
      { path: "A", mode: "dark", code: "x", reason: "" },
      { path: "A", mode: "default", code: "y", reason: "" },
      { path: "A", mode: "light", code: "x", reason: "" },
      { path: "A", code: "m", reason: "" },
      { path: "A", mode: "light", code: "x", reason: "same-raw" },
      { path: "A", mode: "light", code: "x", raw: { n: 1 }, reason: "" },
    ];
    const sorted = [...items].sort(compareLossItems);
    expect(sorted.map((item) => [item.path, item.mode, item.code])).toEqual([
      ["A", undefined, "m"], // mode 없음이 default보다 앞(생략 규칙)
      ["A", "default", "y"],
      ["A", "light", "x"],
      ["A", "light", "x"],
      ["A", "light", "x"],
      ["A", "dark", "x"],
      ["B", undefined, "z"],
    ]);

    const manifest = sortImportLoss({ unsupported: [...items], ambiguous: [], lossy: [] });
    expect(manifest.unsupported.map((item) => item.path)).toEqual(["A", "A", "A", "A", "A", "A", "B"]);
  });

  it("동일 (path/mode/code/raw) 항목은 reason으로 tie-break된다 — 입력 순서 무관", () => {
    const items: CanonicalLossItem[] = [
      { path: "A", mode: "light", code: "x", reason: "zzz" },
      { path: "A", mode: "light", code: "x", reason: "aaa" },
    ];
    const sorted = [...items].sort(compareLossItems);
    expect(sorted.map((item) => item.reason)).toEqual(["aaa", "zzz"]);
    // 역순 입력도 동일 결과 — stable sort의 입력 순서 의존 제거
    const reversed = [...items].reverse().sort(compareLossItems);
    expect(reversed.map((item) => item.reason)).toEqual(["aaa", "zzz"]);
  });
});
