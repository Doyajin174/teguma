/**
 * idempotency 정책 (명세 12장).
 *
 * - 페이지 이름: `od-handoff-<sourceId12>-<hash12>` (12.1).
 *   다중 SVG(5.5)는 엔트리 slug를 결합: `od-handoff-<sourceId12>-<hash12>-<slug>`.
 * - resolveImportAction은 순수 함수 — CI에서 unchanged/replaced/created/force
 *   시나리오를 검증한다 (14.2).
 */

import { sourceId12, stripSha256Prefix } from "./bundle.js";

export type ImportAction = "unchanged" | "replaced" | "created";

export interface ExistingPage {
  id: string;
  name: string;
}

export interface ResolvedImportAction {
  action: ImportAction;
  /** 대상 페이지 이름 (새로 만들거나 유지할). */
  pageName: string;
  /** 같은 source id 계열(prefix 매칭) 기존 페이지 id — replaced면 교체 대상. */
  stalePageIds: string[];
  /** replaced 시 이전 페이지 id (결과·import 기록에 포함 — 12.2). */
  previousPageId?: string;
}

export function handoffPagePrefix(sourceId: string): string {
  return `od-handoff-${sourceId12(sourceId)}-`;
}

/** 12.1 — 페이지 이름. hash는 "sha256:<64hex>" 형식. */
export function handoffPageName(sourceId: string, contentHash: string, slug?: string): string {
  const hash12 = hash12Of(contentHash);
  const base = `od-handoff-${sourceId12(sourceId)}-${hash12}`;
  return slug === undefined ? base : `${base}-${slug}`;
}

export function hash12Of(contentHash: string): string {
  const hex = stripSha256Prefix(contentHash) ?? contentHash;
  return hex.slice(0, 12);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 12.3 — 순수 결정 함수.
 *
 * @param sourceId 산출물 논리 identity (5.3)
 * @param contentHash 번들 content hash ("sha256:<64hex>")
 * @param existingPages 파일의 페이지 목록
 * @param force 기본 false — true면 같은 hash여도 삭제·재생성 (12.2)
 * @param slug 다중 SVG 엔트리 slug (5.5, 단일 엔트리는 생략)
 */
export function resolveImportAction(
  sourceId: string,
  contentHash: string,
  existingPages: ExistingPage[],
  force = false,
  slug?: string,
): ResolvedImportAction {
  const id12 = sourceId12(sourceId);
  const hash12 = hash12Of(contentHash);
  const pageName = handoffPageName(sourceId, contentHash, slug);

  const pattern = slug === undefined
    ? new RegExp(`^od-handoff-${id12}-[0-9a-f]{12}$`)
    : new RegExp(`^od-handoff-${id12}-[0-9a-f]{12}-${escapeRegExp(slug)}$`);
  const matches = existingPages
    .filter((page) => pattern.test(page.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  if (force) {
    return {
      action: "replaced",
      pageName,
      stalePageIds: matches.map((page) => page.id),
      previousPageId: matches[0]?.id,
    };
  }
  if (matches.some((page) => page.name === pageName)) {
    return { action: "unchanged", pageName, stalePageIds: [], previousPageId: undefined };
  }
  if (matches.length > 0) {
    return {
      action: "replaced",
      pageName,
      stalePageIds: matches.map((page) => page.id),
      previousPageId: matches[0]?.id,
    };
  }
  return { action: "created", pageName, stalePageIds: [], previousPageId: undefined };
}

/** 12.4 — 백업 페이지 이름. */
export function backupPageName(pageName: string, epochMs: number): string {
  return `${pageName}-backup-${epochMs}`;
}

/** 여러 엔트리(SVG)의 결정 결과를 번들 수준 action으로 결합 (5.5). */
export function combineEntryActions(actions: ImportAction[]): ImportAction {
  if (actions.length === 0) return "created";
  if (actions.every((action) => action === "unchanged")) return "unchanged";
  if (actions.some((action) => action === "replaced")) return "replaced";
  return "created";
}
