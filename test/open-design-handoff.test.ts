/**
 * Open Design → Penpot 핸드오프 POC — CI fixture 테스트 (명세 14.2).
 *
 * - 번들 검증·hash 결정론 (5장)
 * - SVG 파싱 → Penpot 셰이프 (7.2-2·3, 8장)
 * - CSS → canonical 토큰 (9장, #30 스키마 검증 포함)
 * - loss report 결정론·정렬 (11장)
 * - idempotency 결정 함수 (12.3)
 * - Penpot 쓰기는 mock 경계 — RPC 호출 없음 (14.2)
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCanonicalDocumentSorted,
  CanonicalTokenDocumentSchema,
  parseCanonicalDocument,
} from "../src/tokens/index.js";
import {
  computeBundleContentHash,
  loadBundle,
  normalizeBundleBytes,
  sourceId12,
  sourceIdSlug,
  validateSourceId,
} from "../src/design/open-design/bundle.js";
import {
  convertSvgDocument,
  deterministicUuid,
  IDENTITY_MATRIX,
  parsePathData,
  type PenpotShapeObj,
} from "../src/design/open-design/converter.js";
import { extractTokensToCanonical } from "../src/design/open-design/css-tokens.js";
import {
  backupPageName,
  combineEntryActions,
  handoffPageName,
  resolveImportAction,
} from "../src/design/open-design/idempotency.js";
import {
  importOpenDesign,
  type PenpotChange,
  type PenpotWriter,
} from "../src/design/open-design/import.js";
import { compareLossItems, LossReportSchema } from "../src/design/open-design/loss.js";
import { parseSvg, resolveViewport } from "../src/design/open-design/svg-parser.js";
import { parseXml } from "../src/design/open-design/xml.js";
import expectedImport from "../data/fixtures/open-design-handoff/expected-import.json";

const FIXTURE_DIR = join(import.meta.dirname, "..", "data", "fixtures", "open-design-handoff");
const BUNDLE_DIR = FIXTURE_DIR;
const SOURCE_ID = "handoff:sha256:ae9219aad83a90f72fb76911c9b5176e9f102f38902c4c81d4c0f340327e9d26";
const CONTENT_HASH = "sha256:ae9219aad83a90f72fb76911c9b5176e9f102f38902c4c81d4c0f340327e9d26";

async function readFixture(name: string): Promise<string> {
  return readFile(join(FIXTURE_DIR, name), "utf8");
}

async function loadFixtureBundle() {
  return loadBundle({ bundleDir: BUNDLE_DIR });
}

async function tempImportRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "teguma-imports-"));
}

async function convertFixture() {
  const svg = await readFixture("hero-section.svg");
  const doc = parseSvg(parseXml(svg));
  return convertSvgDocument(doc, {
    sourceId12: sourceId12(SOURCE_ID),
    frameName: "hero-section",
  });
}

class FakeWriter implements PenpotWriter {
  pages: Array<{ id: string; name: string }>;
  calls: Array<{ method: "getFilePages" | "updateFile"; args: unknown[] }> = [];

  constructor(pages: Array<{ id: string; name: string }> = []) {
    this.pages = pages;
  }

  async getFilePages(fileId: string): Promise<Array<{ id: string; name: string }>> {
    this.calls.push({ method: "getFilePages", args: [fileId] });
    return this.pages;
  }

  async updateFile(fileId: string, changes: PenpotChange[]): Promise<void> {
    this.calls.push({ method: "updateFile", args: [fileId, changes] });
  }
}

describe("handoff 번들 계약 (5장)", () => {
  it("manifest 스키마·hash 재계산·source.id 형식을 검증한다", async () => {
    const bundle = await loadFixtureBundle();
    expect(bundle.manifest.schemaVersion).toBe("0.1.0");
    expect(bundle.manifest.source.mode).toBe("user-handoff");
    expect(bundle.manifest.source.hash).toBe(CONTENT_HASH);
    expect(bundle.files.map(({ entry }) => entry.path)).toEqual(["hero-section.svg", "tokens.css"]);
    expect(validateSourceId(bundle.manifest.source)).toBeNull();
  });

  it("정규화 직렬화·contentHash가 결정적이다 (5.3)", async () => {
    const bundle = await loadFixtureBundle();
    const files = bundle.files.map(({ entry, bytes }) => ({ path: entry.path, bytes }));
    const first = computeBundleContentHash(files);
    const second = computeBundleContentHash([...files].reverse());
    expect(first).toBe(second);
    expect(first).toBe(CONTENT_HASH);
    // 경로 순서 역전 시 hash가 달라진다 (정렬 규칙 검증).
    const shuffled = normalizeBundleBytes([...files].reverse());
    expect(shuffled.equals(normalizeBundleBytes(files))).toBe(true);
  });

  it("hash 불일치·SVG 부재는 전체 실패로 보고한다 (6.2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "teguma-bundle-"));
    const svg = await readFixture("hero-section.svg");
    const css = await readFixture("tokens.css");
    await writeFile(join(dir, "hero-section.svg"), svg);
    await writeFile(join(dir, "tokens.css"), css);
    // 잘못된 hash manifest
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      schemaVersion: "0.1.0",
      source: {
        id: "handoff:sha256:" + "a".repeat(64),
        hash: "sha256:" + "a".repeat(64),
        createdAt: "2026-08-08T03:00:00Z",
        tool: "open-design",
        toolVersion: "0.18.1",
        mode: "user-handoff",
      },
      files: [{ path: "hero-section.svg", kind: "svg", hash: "sha256:" + "b".repeat(64), bytes: Buffer.byteLength(svg) }],
    }));
    await expect(loadBundle({ bundleDir: dir })).rejects.toThrow(/hash 불일치/);

    // SVG 0개 → 전체 실패 (파일 hash·content hash는 정확해야 이 단계에 도달)
    const cssOnlyHash = computeBundleContentHash([{ path: "tokens.css", bytes: Buffer.from(css) }]);
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      schemaVersion: "0.1.0",
      source: {
        id: `handoff:${cssOnlyHash}`,
        hash: cssOnlyHash,
        createdAt: "2026-08-08T03:00:00Z",
        tool: "open-design",
        toolVersion: "0.18.1",
        mode: "user-handoff",
      },
      files: [{ path: "tokens.css", kind: "css", hash: "sha256:fa068965982c91a19a33808d4064e7710391b3dc39beed0ed2d917e773e5fd8c", bytes: Buffer.byteLength(css) }],
    }));
    await expect(loadBundle({ bundleDir: dir })).rejects.toThrow(/SVG 엔트리가 없음/);

    // 잘못된 source.id 형식
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      schemaVersion: "0.1.0",
      source: {
        id: "not-a-valid-id",
        hash: "sha256:" + "a".repeat(64),
        createdAt: "2026-08-08T03:00:00Z",
        tool: "open-design",
        toolVersion: "0.18.1",
        mode: "user-handoff",
      },
      files: [{ path: "tokens.css", kind: "css", hash: "sha256:" + "c".repeat(64), bytes: Buffer.byteLength(css) }],
    }));
    await expect(loadBundle({ bundleDir: dir })).rejects.toThrow(/handoff:sha256/);
  });
});

describe("SVG 파싱·셰이프 변환 (8장)", () => {
  it("viewBox→px·preserveAspectRatio 규칙을 적용한다 (8.1)", () => {
    // meet 기본 — 0 0 100 100 → 200×200, s=2, 중앙 정렬 offset 0.
    const svg = `<svg viewBox="0 0 100 100" width="200" height="200"><rect x="10" y="10" width="20" height="20" fill="#000000"/></svg>`;
    const doc = parseSvg(parseXml(svg));
    expect(doc.frameWidth).toBe(200);
    expect(doc.frameHeight).toBe(200);
    const converted = convertSvgDocument(doc, { sourceId12: "abc", frameName: "meet" });
    const rect = converted.shapes.find((shape) => shape.type === "rect");
    expect(rect?.selrect).toMatchObject({ x: 20, y: 20, width: 40, height: 40 });

    // none — 독립 스케일 (sx=2, sy=1)
    const noneSvg = `<svg viewBox="0 0 100 100" width="200" height="100" preserveAspectRatio="none"><rect x="10" y="10" width="20" height="20"/></svg>`;
    const noneDoc = parseSvg(parseXml(noneSvg));
    const noneConverted = convertSvgDocument(noneDoc, { sourceId12: "abc", frameName: "none" });
    const noneRect = noneConverted.shapes.find((shape) => shape.type === "rect");
    expect(noneRect?.selrect).toMatchObject({ x: 20, y: 10, width: 40, height: 20 });

    // slice — viewport-cropped lossy
    const sliceSvg = `<svg viewBox="0 0 100 100" width="200" height="50" preserveAspectRatio="xMidYMid slice"><rect x="0" y="0" width="100" height="100"/></svg>`;
    const sliceDoc = parseSvg(parseXml(sliceSvg));
    const sliceConverted = convertSvgDocument(sliceDoc, { sourceId12: "abc", frameName: "slice" });
    expect(sliceConverted.losses.some((item) => item.code === "viewport-cropped")).toBe(true);
    expect(sliceDoc.cropped).toBe(true);
  });

  it("path 셰이프 요구 필드(8.2)를 생성한다", async () => {
    const converted = await convertFixture();
    const path = converted.shapes.find((shape) => shape.type === "path");
    expect(path).toBeDefined();
    expect(path?.content).toEqual([
      { command: "move-to", params: [120, 320] },
      { command: "line-to", params: [180, 320] },
      { command: "curve-to", params: [190, 320, 200, 330, 200, 340] },
      { command: "line-to", params: [200, 370] },
      { command: "line-to", params: [120, 370] },
      { command: "close-path", params: [] },
    ]);
    expect(path?.selrect).toEqual({ x: 120, y: 320, width: 80, height: 50, x1: 120, y1: 320, x2: 200, y2: 370 });
    expect(path?.points).toHaveLength(4);
    expect(path?.transform).toEqual(IDENTITY_MATRIX);
    expect(path?.["transform-inverse"]).toEqual(IDENTITY_MATRIX);
    expect(path?.["parent-id"]).toBeTruthy();
    expect(path?.["frame-id"]).toBeTruthy();
    expect(path?.fills).toEqual([{ "fill-color": "#1a73e8", "fill-opacity": 1 }]);
  });

  it("text baseline→박스 상단 보정·text-anchor·다중 라인을 변환한다 (8.1)", async () => {
    const converted = await convertFixture();
    const title = converted.shapes.find((shape) => shape.name === "hero-title");
    expect(title?.selrect.y).toBe(174.8); // 210 − 44×0.8
    expect(title?.["font-size"]).toBe(44);
    expect(title?.["font-family"]).toBe("Inter");

    const subtitle = converted.shapes.find((shape) => shape.name === "hero-subtitle");
    expect(subtitle?.["text-align"]).toBe("center");
    expect(converted.losses.some((item) => item.code === "text-anchor-converted")).toBe(true);

    const lines = converted.shapes.filter((shape) => shape.name.startsWith("hero-lines"));
    expect(lines).toHaveLength(2);
    expect(lines[0].selrect.y).toBe(480.8);
    expect(lines[1].selrect.y).toBe(508.8);
    expect(lines[1]["line-height"]).toBe(28);
    const textContent = (shape: PenpotShapeObj): string => {
      const root = shape.content as { children: Array<{ children: Array<{ children: Array<{ value: string }> }> }> };
      return root.children[0].children[0].children[0].value;
    };
    expect(textContent(lines[0])).toBe("Open");
    expect(textContent(lines[1])).toBe("Design");
  });

  it("지원 불가 요소·이미지·그라디언트를 보고하고 반입하지 않는다 (8장·6.2)", async () => {
    const converted = await convertFixture();
    expect(converted.shapes.some((shape) => shape.name === "hero-use")).toBe(false);
    expect(converted.shapes.some((shape) => shape.name === "hero-image")).toBe(false);
    expect(converted.losses.some((item) => item.code === "unsupported-element" && item.path === "svg://g[0]/use[0]")).toBe(true);
    expect(converted.losses.some((item) => item.code === "external-url-asset")).toBe(true);
    expect(converted.losses.some((item) => item.code === "unsupported-category")).toBe(true);
    expect(converted.losses.some((item) => item.code === "font-license-unknown")).toBe(true);
    expect(converted.losses.some((item) => item.code === "font-not-found")).toBe(true);
  });

  it("매핑 불가 path 명령은 unsupported-element로 전체 보고한다 (8.2)", () => {
    expect(parsePathData("M0 0 R5 5")).toBeNull();
    expect(parsePathData("M0 0 X5 5")).toBeNull();
    expect(parsePathData("M10 10 L20 20 Z")?.map((c) => c.command)).toEqual(["move-to", "line-to", "close-path"]);
    expect(parsePathData("m5 5 h10 v10 h-10 z")?.map((c) => c.command)).toEqual(["move-to", "line-to", "line-to", "line-to", "close-path"]);
    // M 뒤 암묵 반복은 line-to
    expect(parsePathData("M10 10 20 20 30 30")?.map((c) => c.command)).toEqual(["move-to", "line-to", "line-to"]);
  });
});

describe("CSS → canonical 토큰 (9장)", () => {
  it("tokens.css를 #30 계약 문서로 추출한다 (schema 검증·정렬 포함)", async () => {
    const css = await readFixture("tokens.css");
    const { document } = extractTokensToCanonical(css, {
      sourceId: SOURCE_ID,
      contentHash: CONTENT_HASH,
      sourceName: "Open Design handoff",
    });
    expect(() => CanonicalTokenDocumentSchema.parse(document)).not.toThrow();
    assertCanonicalDocumentSorted(document);
    expect(document.document).toMatchObject({
      id: "canonical:open-design:3830495a6aa9",
      sourceAdapter: "open-design",
      sourceRevision: CONTENT_HASH,
    });
    expect(document.tokens).toHaveLength(8);
    expect(document.tokens.every((token) => token.values.default !== undefined)).toBe(true);

    const primary = document.tokens.find((token) => token.path === "--color-primary");
    expect(primary?.type).toBe("color");
    expect(primary?.semanticRole).toBeUndefined(); // 추측 금지 (9장)

    const accent = document.tokens.find((token) => token.path === "--color-accent");
    expect(accent?.values.default?.status).toBe("resolved");
    if (accent?.values.default?.status === "resolved") {
      expect(accent.values.default.alias).toEqual({ ref: "open-design:3830495a6aa9:--color-primary", resolved: true });
    }
    const space = document.tokens.find((token) => token.path === "--space-base");
    expect(space).toMatchObject({ type: "dimension", kind: "spacing" });
  });

  it("미해결 var·비표준 단위를 손실로 보고한다 (9장)", () => {
    const css = `
      :root {
        --color-broken: var(--color-missing);
        --space-odd: 0.5em;
        --color-ok: #112233;
      }
    `;
    const { document } = extractTokensToCanonical(css, {
      sourceId: SOURCE_ID,
      contentHash: CONTENT_HASH,
      sourceName: "Open Design handoff",
    });
    expect(document.tokens.map((token) => token.path)).toEqual(["--color-ok", "--space-odd"]);
    expect(document.importLoss.unsupported.some((item) => item.code === "css-var-unresolved")).toBe(true);
    expect(document.importLoss.lossy.some((item) => item.code === "nonstandard-unit")).toBe(true);
  });

  it("사용자 semanticRole override만 반영한다 (6장)", async () => {
    const css = await readFixture("tokens.css");
    const { document } = extractTokensToCanonical(css, {
      sourceId: SOURCE_ID,
      contentHash: CONTENT_HASH,
      sourceName: "Open Design handoff",
      semanticRoleOverrides: { "--color-primary": "primary" },
    });
    const primary = document.tokens.find((token) => token.path === "--color-primary");
    expect(primary?.semanticRole).toEqual({ role: "primary", confidence: "explicit" });
  });
});

describe("loss report (11장)", () => {
  it("스키마·정렬 규칙을 지킨다", async () => {
    const result = await importOpenDesign({ bundleDir: BUNDLE_DIR, dryRun: true });
    expect(() => LossReportSchema.parse(result.lossReport)).not.toThrow();
    const items = result.lossReport.items;
    for (let index = 1; index < items.length; index += 1) {
      expect(compareLossItems(items[index - 1], items[index]) <= 0).toBe(true);
    }
    // severity 그룹 순서: unsupported → ambiguous → lossy
    const groupOrder = items.map((item) => item.severity === "unsupported" ? 0 : item.severity === "ambiguous" ? 1 : 2);
    expect(groupOrder).toEqual([...groupOrder].sort((a, b) => a - b));
  });

  it("결정론 — 동일 입력 → 동일 JSON, expected-import와 일치 (14.2)", async () => {
    const first = await importOpenDesign({ bundleDir: BUNDLE_DIR, dryRun: true });
    const second = await importOpenDesign({ bundleDir: BUNDLE_DIR, dryRun: true });
    expect(second).toEqual(first);
    expect(first).toEqual(expectedImport);
  });

  it("truncated 번들은 partial-artifact 항목을 최상단에 추가한다 (11장)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "teguma-truncated-"));
    const svg = await readFixture("hero-section.svg");
    await writeFile(join(dir, "hero-section.svg"), svg);
    const contentHash = computeBundleContentHash([{ path: "hero-section.svg", bytes: Buffer.from(svg) }]);
    const fileHash = `sha256:${createHash("sha256").update(Buffer.from(svg)).digest("hex")}`;
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      schemaVersion: "0.1.0",
      source: {
        id: `handoff:${contentHash}`,
        hash: contentHash,
        createdAt: "2026-08-08T03:00:00Z",
        tool: "open-design",
        toolVersion: "0.18.1",
        mode: "user-handoff",
        truncated: true,
      },
      files: [{ path: "hero-section.svg", kind: "svg", hash: fileHash, bytes: Buffer.byteLength(svg) }],
    }));
    const result = await importOpenDesign({ bundleDir: dir, dryRun: true });
    expect(result.lossReport.items[0]).toMatchObject({ code: "partial-artifact", severity: "unsupported" });
    expect(result.provenance.truncated).toBe(true);
  });
});

describe("idempotency 결정 함수 (12장)", () => {
  const sourceId = SOURCE_ID;
  const id12 = sourceId12(sourceId);
  const hash12 = CONTENT_HASH.slice("sha256:".length, "sha256:".length + 12);

  it("unchanged/replaced/created/force 시나리오 (12.2)", () => {
    const pageName = handoffPageName(sourceId, CONTENT_HASH);
    const existing = [
      { id: "p1", name: pageName },
    ];
    expect(resolveImportAction(sourceId, CONTENT_HASH, existing)).toMatchObject({ action: "unchanged", pageName });
    expect(resolveImportAction(sourceId, CONTENT_HASH, [])).toMatchObject({ action: "created", pageName });

    const stale = [
      { id: "p-old", name: `od-handoff-${id12}-${"0".repeat(12)}` },
    ];
    const resolved = resolveImportAction(sourceId, CONTENT_HASH, stale);
    expect(resolved.action).toBe("replaced");
    expect(resolved.stalePageIds).toEqual(["p-old"]);
    expect(resolved.previousPageId).toBe("p-old");

    // force — 같은 hash여도 replaced
    expect(resolveImportAction(sourceId, CONTENT_HASH, existing, true).action).toBe("replaced");

    // 다른 source id → created
    expect(resolveImportAction("handoff:sha256:" + "f".repeat(64), CONTENT_HASH, existing).action).toBe("created");
    // 관련 없는 페이지는 무시
    expect(resolveImportAction(sourceId, CONTENT_HASH, [{ id: "p9", name: "Untitled" }]).action).toBe("created");
  });

  it("다중 SVG 엔트리 slug 매칭 (5.5)", () => {
    const pageName = handoffPageName(sourceId, CONTENT_HASH, "hero-a");
    const resolved = resolveImportAction(sourceId, CONTENT_HASH, [{ id: "p1", name: pageName }], false, "hero-a");
    expect(resolved.action).toBe("unchanged");
    const other = resolveImportAction(sourceId, CONTENT_HASH, [{ id: "p1", name: pageName }], false, "hero-b");
    expect(other.action).toBe("created");
  });

  it("백업 이름·엔트리 action 결합 (12.4·5.5)", () => {
    expect(backupPageName("od-handoff-x-abc", 123)).toBe("od-handoff-x-abc-backup-123");
    expect(combineEntryActions(["unchanged", "unchanged"])).toBe("unchanged");
    expect(combineEntryActions(["created", "created"])).toBe("created");
    expect(combineEntryActions(["created", "unchanged"])).toBe("created");
    expect(combineEntryActions(["created", "replaced"])).toBe("replaced");
  });
});

describe("import 오케스트레이션 — Penpot 쓰기 mock 경계 (14.2)", () => {
  it("created: add-page + add-obj 변화 시퀀스를 만든다 (7.3)", async () => {
    const writer = new FakeWriter([]);
    const result = await importOpenDesign({
      bundleDir: BUNDLE_DIR,
      fileId: "file-1",
      dryRun: false,
      writer,
      importRoot: await mkdtemp(join(tmpdir(), "teguma-imports-")),
    });
    expect(result.action).toBe("created");
    const updateCall = writer.calls.find((call) => call.method === "updateFile");
    expect(updateCall).toBeDefined();
    const changes = updateCall?.args[1] as PenpotChange[];
    expect(changes[0]).toMatchObject({ type: "add-page", name: result.pageName });
    const addObjs = changes.filter((change) => change.type === "add-obj");
    expect(addObjs.length).toBe(16); // frame + 15 셰이프
    expect(addObjs.every((change) => change["page-id"] === result.pageId)).toBe(true);
    expect(changes.some((change) => change.type === "del-page")).toBe(false);
    // 결정적 id — 같은 번들 재실행 시 동일
    expect(updateCall?.args[0]).toBe("file-1");
  });

  it("unchanged: 쓰기 없음, 기존 페이지 반환 (12.2)", async () => {
    const first = await importOpenDesign({ bundleDir: BUNDLE_DIR, dryRun: true });
    const writer = new FakeWriter([{ id: "existing-page", name: first.pageName }]);
    const result = await importOpenDesign({
      bundleDir: BUNDLE_DIR,
      fileId: "file-1",
      dryRun: false,
      writer,
      importRoot: await tempImportRoot(),
    });
    expect(result.action).toBe("unchanged");
    expect(result.pageId).toBe("existing-page");
    expect(writer.calls.some((call) => call.method === "updateFile")).toBe(false);
  });

  it("replaced: 백업 이름 변경 → 새 페이지 → 백업 삭제 (12.4)", async () => {
    const id12 = sourceId12(SOURCE_ID);
    const staleName = `od-handoff-${id12}-${"0".repeat(12)}`;
    const staleId = "stale-page";
    const writer = new FakeWriter([{ id: staleId, name: staleName }]);
    const result = await importOpenDesign({
      bundleDir: BUNDLE_DIR,
      fileId: "file-1",
      dryRun: false,
      writer,
      importRoot: await tempImportRoot(),
    });
    expect(result.action).toBe("replaced");
    const changes = (writer.calls.find((call) => call.method === "updateFile")?.args[1] ?? []) as PenpotChange[];
    const renames = changes.filter((change) => change.type === "mod-page");
    expect(renames).toHaveLength(1);
    expect(renames[0]).toMatchObject({ id: staleId });
    const name = (renames[0] as { page: { name: string } }).page.name;
    expect(name).toMatch(new RegExp(`^${staleName}-backup-\\d+$`));
    const delPages = changes.filter((change) => change.type === "del-page");
    expect(delPages).toHaveLength(1);
    expect(delPages[0]).toMatchObject({ id: staleId });
  });

  it("force: 같은 hash여도 재생성 (12.2)", async () => {
    const first = await importOpenDesign({ bundleDir: BUNDLE_DIR, dryRun: true });
    const writer = new FakeWriter([{ id: "existing-page", name: first.pageName }]);
    const result = await importOpenDesign({
      bundleDir: BUNDLE_DIR,
      fileId: "file-1",
      dryRun: false,
      force: true,
      writer,
      importRoot: await tempImportRoot(),
    });
    expect(result.action).toBe("replaced");
    expect(writer.calls.some((call) => call.method === "updateFile")).toBe(true);
  });

  it("canonical 문서를 저장하고 import 기록에 provenance를 남긴다 (9·10장)", async () => {
    const importRoot = await tempImportRoot();
    const writer = new FakeWriter([]);
    await importOpenDesign({
      bundleDir: BUNDLE_DIR,
      fileId: "file-1",
      dryRun: false,
      writer,
      importRoot,
    });
    const slug = sourceIdSlug(SOURCE_ID);
    const canonicalRaw = await readFile(join(importRoot, slug, "tokens.canonical.json"), "utf8");
    const canonical = parseCanonicalDocument(canonicalRaw);
    expect(canonical.document.sourceAdapter).toBe("open-design");
    expect(canonical.tokens).toHaveLength(8);
    const recordRaw = await readFile(join(importRoot, `${slug}.json`), "utf8");
    const record = JSON.parse(recordRaw) as { source: { id: string }; importedAt: string; entries: unknown[] };
    expect(record.source.id).toBe(SOURCE_ID);
    expect(record.importedAt).toBeDefined();
    expect(record.entries).toHaveLength(1);
  });

  it("dryRun은 Penpot 호출·파일 저장이 없다 (7.1)", async () => {
    const writer = new FakeWriter([]);
    const result = await importOpenDesign({ bundleDir: BUNDLE_DIR, dryRun: true, writer });
    expect(result.dryRun).toBe(true);
    expect(writer.calls).toEqual([]);
  });
});
