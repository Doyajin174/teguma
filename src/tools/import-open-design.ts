/**
 * import_open_design MCP 도구 (명세 019 7.1).
 *
 * handoff 번들(manifest.json + SVG + tokens.css) → Penpot 페이지 반입.
 * - dryRun 기본 true — 실제 쓰기 전 변환·loss report·action 미리보기.
 * - penpotFileId 제공 + dryRun=false일 때만 update-file 쓰기 실행 (7.3).
 * - force: true — 12.2 drift 복구용 (같은 hash여도 삭제·재생성).
 */

import { z } from "zod";
import type { PenpotClient } from "../penpot/client.js";
import {
  importOpenDesign,
  type PenpotWriter,
  type ImportResult,
} from "../design/open-design/import.js";

export const importOpenDesignSchema = {
  bundleDir: z
    .string()
    .describe("handoff 번들 디렉터리 (manifest.json + SVG 엔트리 + 선택 tokens.css)"),
  penpotFileId: z
    .string()
    .optional()
    .describe("대상 Penpot 파일 ID (미제공 시 변환 미리보기만 반환)"),
  dryRun: z
    .boolean()
    .default(true)
    .describe("true면 Penpot 쓰기·import 기록 저장 없이 미리보기"),
  force: z
    .boolean()
    .default(false)
    .describe("같은 content hash여도 삭제·재생성 (Penpot 수동 편집 drift 복구)"),
  semanticRoleOverrides: z
    .record(z.string(), z.string())
    .optional()
    .describe("canonical 토큰 semanticRole override — 키는 커스텀 프로퍼티 이름 (예: --color-primary)"),
};

export type ImportOpenDesignArgs = z.infer<z.ZodObject<typeof importOpenDesignSchema>>;

export async function importOpenDesignTool(client: PenpotClient, args: ImportOpenDesignArgs): Promise<string> {
  const writer: PenpotWriter | undefined = args.penpotFileId !== undefined ? client : undefined;
  const result = await importOpenDesign({
    bundleDir: args.bundleDir,
    fileId: args.penpotFileId,
    dryRun: args.dryRun,
    force: args.force,
    writer,
    semanticRoleOverrides: args.semanticRoleOverrides,
  });
  return JSON.stringify(result, null, 2);
}

export type { ImportResult };
