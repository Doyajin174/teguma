/**
 * Open Design handoff 번들 → Penpot 페이지 반입 오케스트레이션 (명세 7장).
 *
 * 단계 (7.2): 번들 검증 → SVG 파싱 → 셰이프 변환 → 토큰 추출 → 쓰기
 * (idempotency 적용, update-file changes) → loss report.
 *
 * - 쓰기 경로는 update-file 기반 (7.3 실측: commit-changes 미노출).
 *   PenpotWriter 인터페이스로 격리 — CI는 mock 경계 (14.2).
 * - 부분 성공 금지 (6.2): 검증·파싱 실패는 전체 실패. update-file은 원자적 —
 *   쓰기 실패 시 백업 이름 변경·페이지 생성·삭제 어느 것도 적용되지 않으므로
 *   이전 페이지는 원상 유지 (12.4 백업 규칙과 정합). 실패 사실·계획된 백업
 *   매핑은 status: "failed" import 기록으로 남긴다 (M5).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBundle, sourceId12, sourceIdSlug } from "./bundle.js";
import { convertSvgDocument, deterministicUuid, type PenpotShapeObj } from "./converter.js";
import { extractTokensToCanonical } from "./css-tokens.js";
import {
  backupPageName,
  combineEntryActions,
  handoffPageName,
  resolveImportAction,
  type ExistingPage,
  type ImportAction,
} from "./idempotency.js";
import {
  buildLossReport,
  canonicalLossToHandoffItem,
  emptySummary,
  addToSummary,
  type LossItem,
  type LossReport,
  type LossSummary,
} from "./loss.js";
import { parseXml } from "./xml.js";
import { parseSvg } from "./svg-parser.js";
import type { CanonicalTokenDocument } from "../../tokens/schema.js";
import { serializeCanonicalDocument } from "../../tokens/canonical.js";

export const IMPORT_ADAPTER_VERSION = "0.1.0";

/** Penpot 쓰기 경계 — update-file 기반 (7.3). CI 테스트는 mock을 주입한다. */
export interface PenpotWriter {
  getFilePages(fileId: string): Promise<ExistingPage[]>;
  updateFile(fileId: string, changes: Array<Record<string, unknown>>): Promise<void>;
}

export type PenpotChange =
  | { type: "add-page"; id: string; name: string; page?: { id: string; name: string } }
  | { type: "mod-page"; id: string; page: { id: string; name: string } }
  | { type: "del-page"; id: string }
  | { type: "add-obj"; id: string; "page-id": string; "parent-id": string; "frame-id": string; obj: PenpotShapeObj }
  | { type: "del-obj"; id: string; "page-id": string };

export interface ImportEntryResult {
  entryPath: string;
  pageId: string;
  pageName: string;
  action: ImportAction;
  previousPageId?: string;
  stalePageIds: string[];
  backups?: Array<{ pageId: string; pageName: string }>;
  textShapes: number;
}

export interface ImportResult {
  action: ImportAction;
  pageId: string;
  pageName: string;
  pages: Array<{ pageId: string; pageName: string; action: ImportAction }>;
  summary: LossSummary;
  lossReport: LossReport;
  provenance: {
    sourceId: string;
    sourceHash: string;
    createdAt: string;
    tool: string;
    toolVersion: string;
    mode: string;
    truncated: boolean;
    fileId?: string;
    adapterVersion: string;
  };
  canonical: {
    tokenCount: number;
    mode: "default";
    unsupported: number;
    ambiguous: number;
    lossy: number;
    documentPath?: string;
  } | null;
  dryRun: boolean;
}

export interface ImportOpenDesignOptions {
  bundleDir: string;
  /** 대상 Penpot 파일. 없으면 미리보기 전용. */
  fileId?: string;
  dryRun?: boolean;
  /** 12.2 — 같은 hash여도 삭제·재생성. */
  force?: boolean;
  /** Penpot 쓰기 경계 — 미주입 시 미리보기. */
  writer?: PenpotWriter;
  /** canonical·import 기록 저장 루트 (기본 <cwd>/data/imports/open-design). */
  importRoot?: string;
  /** 사용자 semanticRole override — 키는 커스텀 프로퍼티 이름. */
  semanticRoleOverrides?: Record<string, string>;
}

function entrySlug(entryPath: string): string {
  const stem = entryPath.split("/").pop() ?? entryPath;
  const slug = stem
    .replace(/\.svg$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== "")
    .join("-")
    .toLowerCase();
  return slug === "" ? "entry" : slug;
}

export async function importOpenDesign(options: ImportOpenDesignOptions): Promise<ImportResult> {
  const dryRun = options.dryRun !== false && options.fileId === undefined ? true : options.dryRun === true;
  const bundle = await loadBundle({ bundleDir: options.bundleDir });
  const source = bundle.manifest.source;
  const id12 = sourceId12(source.id);

  const svgEntries = bundle.files
    .filter(({ entry }) => entry.kind === "svg")
    .sort((a, b) => (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0));

  // 1·2·3단계 — SVG 파싱·변환 (다중 SVG: path 오름차순, 5.5).
  const summary = emptySummary();
  const losses: LossItem[] = [];
  const conversions = svgEntries.map(({ entry, bytes }) => {
    const xml = parseXml(bytes.toString("utf8"));
    const doc = parseSvg(xml);
    const frameName = entry.path.split("/").pop()?.replace(/\.svg$/i, "") ?? "handoff";
    const converted = convertSvgDocument(doc, {
      sourceId12: id12,
      frameName,
      entryPath: svgEntries.length > 1 ? entry.path : undefined,
    });
    mergeSummary(summary, converted.summary);
    losses.push(...converted.losses);
    return { entry, converted };
  });

  // 4단계 — tokens.css → canonical (9장, 부재 시 생략).
  const cssFile = bundle.files.find(({ entry }) => entry.path === "tokens.css")
    ?? bundle.files.find(({ entry }) => entry.kind === "css");
  let canonical: CanonicalTokenDocument | null = null;
  if (cssFile !== undefined) {
    const extracted = extractTokensToCanonical(cssFile.bytes.toString("utf8"), {
      sourceId: source.id,
      contentHash: source.hash,
      sourceName: "Open Design handoff",
      semanticRoleOverrides: options.semanticRoleOverrides,
    });
    canonical = extracted.document;
    for (const category of ["unsupported", "ambiguous", "lossy"] as const) {
      for (const item of canonical.importLoss[category]) {
        losses.push(canonicalLossToHandoffItem(item));
      }
    }
  }

  // 5단계 — idempotency 결정 (12장).
  const fileId = options.fileId;
  const existingPages = fileId !== undefined && options.writer !== undefined
    ? await options.writer.getFilePages(fileId)
    : [];
  const multi = svgEntries.length > 1;
  const entries: ImportEntryResult[] = conversions.map(({ entry }, index) => {
    const slug = multi ? entrySlug(entry.path) : undefined;
    const resolved = resolveImportAction(source.id, source.hash, existingPages, options.force === true, slug);
    const pageName = multi ? handoffPageName(source.id, source.hash, entrySlug(entry.path)) : resolved.pageName;
    const existing = existingPages.find((page) => page.name === pageName);
    // page id는 source+entry 뿐 아니라 content hash에도 의존해야 한다 —
    // hash만 바뀐 replaced 케이스에서 같은 id가 재사용되면 백업 삭제가
    // 재생성 페이지를 파괴한다 (live smoke 실측 2026-08-08).
    const baseSeed = `${id12}:${source.hash}:page:${entry.path}`;
    // force(같은 hash)도 같은 hazard다 — 기존 id를 재사용하면 백업 삭제가
    // 재생성 페이지를 파괴한다. 시도별 fresh id를 생성한다 (리뷰 M1).
    const pageId = existing !== undefined && resolved.action === "replaced"
      ? deterministicUuid(`${baseSeed}:force-${Date.now()}`)
      : (existing?.id ?? deterministicUuid(baseSeed));
    return {
      entryPath: entry.path,
      pageId,
      pageName,
      action: resolved.action,
      previousPageId: resolved.previousPageId,
      stalePageIds: resolved.stalePageIds,
      textShapes: conversions[index].converted.textShapes,
    };
  });
  const action = combineEntryActions(entries.map((entry) => entry.action));

  // 6단계 — 쓰기 (update-file changes, atomic).
  const writes: PenpotChange[] = [];
  // 12.4 — replaced/force일 때만 기존 계열 페이지를 백업 이름으로 변경 후,
  // 성공 시 삭제. unchanged는 쓰기 없음.
  const backupRecords: Array<{ pageId: string; pageName: string }> = [];
  const epochMs = Date.now();
  for (const entry of entries) {
    if (entry.action === "unchanged") continue;
    const conversion = conversions.find((item) => item.entry.path === entry.entryPath);
    if (conversion === undefined) continue;
    const entryBackups: Array<{ pageId: string; pageName: string }> = [];
    if (entry.action === "replaced") {
      for (const staleId of entry.stalePageIds) {
        const page = existingPages.find((candidate) => candidate.id === staleId);
        if (page === undefined) continue;
        const backupName = backupPageName(page.name, epochMs);
        writes.push({ type: "mod-page", id: staleId, page: { id: staleId, name: backupName } });
        const backup = { pageId: staleId, pageName: backupName };
        entryBackups.push(backup);
        backupRecords.push(backup);
      }
    }
    // 엔트리별 백업만 기록 (다중 SVG에서 엔트리 간 배열 공유 방지 — 리뷰 N7).
    entry.backups = entryBackups;
    writes.push({
      type: "add-page",
      id: entry.pageId,
      name: entry.pageName,
    });
    for (const shape of conversion.converted.shapes) {
      writes.push({
        type: "add-obj",
        id: shape.id,
        "page-id": entry.pageId,
        "parent-id": shape["parent-id"],
        "frame-id": shape["frame-id"],
        obj: shape,
      });
    }
  }
  for (const backup of backupRecords) {
    writes.push({ type: "del-page", id: backup.pageId });
  }

  // 7단계 — loss report + 저장 (canonical 문서·import 기록, 9·10장).
  const sourceSlug = sourceIdSlug(source.id);
  const importRoot = options.importRoot ?? join(process.cwd(), "data/imports", "open-design");
  const importedAt = new Date().toISOString();
  let canonicalPath: string | undefined;

  const importing = !dryRun && fileId !== undefined && options.writer !== undefined;
  let writeError: unknown = null;
  if (importing && writes.length > 0 && options.writer !== undefined) {
    try {
      await options.writer.updateFile(fileId, writes);
    } catch (error) {
      // M5 — update-file 실패 = 아무 변경도 적용되지 않음 (원자성). 실패 사실과
      // 계획된 변경(백업 매핑 포함)을 status: "failed" 기록으로 남긴 뒤
      // 원본 오류를 다시 던진다 — 사후 복구·조사 경로를 보장한다.
      writeError = error;
    }
  }

  if (importing && canonical !== null) {
    const dir = join(importRoot, sourceSlug);
    await mkdir(dir, { recursive: true });
    canonicalPath = join(dir, "tokens.canonical.json");
    await writeFile(canonicalPath, serializeCanonicalDocument(canonical), "utf8");
  }
  if (importing) {
    const record = {
      schemaVersion: "0.1.0",
      status: writeError === null ? "ok" : "failed",
      ...(writeError !== null ? { error: errorMessage(writeError) } : {}),
      source,
      importedAt,
      adapterVersion: IMPORT_ADAPTER_VERSION,
      fileId,
      entries: entries.map((entry) => ({
        entryPath: entry.entryPath,
        pageId: entry.pageId,
        pageName: entry.pageName,
        action: entry.action,
        ...(entry.previousPageId !== undefined ? { previousPageId: entry.previousPageId } : {}),
        ...(entry.backups !== undefined && entry.backups.length > 0 ? { backups: entry.backups } : {}),
      })),
      ...(canonicalPath !== undefined && canonical !== null
        ? { canonical: { path: "tokens.canonical.json", tokenCount: canonical.tokens.length } }
        : {}),
    };
    const recordPath = join(importRoot, `${sourceSlug}.json`);
    await mkdir(importRoot, { recursive: true });
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
  if (writeError !== null) throw writeError;

  const lossReport = buildLossReport({
    source: {
      id: source.id,
      hash: source.hash,
      createdAt: source.createdAt,
      tool: source.tool,
      toolVersion: source.toolVersion,
    },
    summary,
    items: losses,
    truncated: source.truncated,
  });

  return {
    action,
    pageId: entries[0]?.pageId ?? "",
    pageName: entries[0]?.pageName ?? "",
    pages: entries.map((entry) => ({
      pageId: entry.pageId,
      pageName: entry.pageName,
      action: entry.action,
      ...(entry.previousPageId !== undefined ? { previousPageId: entry.previousPageId } : {}),
      ...(entry.backups !== undefined && entry.backups.length > 0 ? { backups: entry.backups } : {}),
    })),
    summary,
    lossReport,
    provenance: {
      sourceId: source.id,
      sourceHash: source.hash,
      createdAt: source.createdAt,
      tool: source.tool,
      toolVersion: source.toolVersion,
      mode: source.mode,
      truncated: source.truncated,
      ...(fileId !== undefined ? { fileId } : {}),
      adapterVersion: IMPORT_ADAPTER_VERSION,
    },
    canonical: canonical === null ? null : {
      tokenCount: canonical.tokens.length,
      mode: "default",
      unsupported: canonical.importLoss.unsupported.length,
      ambiguous: canonical.importLoss.ambiguous.length,
      lossy: canonical.importLoss.lossy.length,
      ...(canonicalPath !== undefined ? { documentPath: canonicalPath } : {}),
    },
    dryRun: importing === false,
  };
}

function mergeSummary(target: LossSummary, source: LossSummary): void {
  for (const category of ["layers", "text", "colors", "frames", "images", "fonts"] as const) {
    addToSummary(target, category, {
      source: source[category].source,
      imported: source[category].imported,
      unsupported: source[category].unsupported,
      lossy: source[category].lossy,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
