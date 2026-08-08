/**
 * Open Design handoff 번들 계약 v0.1.0 (명세 5장).
 *
 * - 번들은 결정적이다: 동일 입력 → 동일 직렬화 → 동일 contentHash.
 *   타임스탬프는 source.createdAt(소스 메타데이터)에만 존재하고 번들
 *   직렬화·hash 계산에는 포함하지 않는다.
 * - 정규화 직렬화(5.3): 파일 순서 path 오름차순(locale 무관 바이트 순),
 *   각 파일 path + "\n" + 바이트 그대로. manifest는 직렬화 대상 제외.
 * - contentHash = sha256(연결된 파일 바이트), 표기 "sha256:<64hex>".
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";

export const HANDBOFF_BUNDLE_SCHEMA_VERSION = "0.1.0";

export const SHA256_PREFIX_RE = /^sha256:[0-9a-f]{64}$/;
export const SHA256_FULL_RE = /^[0-9a-f]{64}$/;

export const BundleSourceSchema = z.object({
  id: z.string().min(1),
  hash: z.string().regex(SHA256_PREFIX_RE),
  createdAt: z.string().datetime({ offset: true }),
  tool: z.string(),
  toolVersion: z.string(),
  mode: z.enum(["cloud", "local-codex", "byok", "user-handoff"]),
  projectId: z.string().optional(),
  runId: z.string().optional(),
  agentMessageTail: z.string().optional(),
  truncated: z.boolean().default(false),
});

export const BundleFileSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["svg", "css", "html", "json", "markdown", "jsx", "js", "other"]),
  hash: z.string().regex(SHA256_PREFIX_RE),
  bytes: z.number().int().nonnegative(),
});

export const HandoffManifestSchema = z.object({
  schemaVersion: z.literal(HANDBOFF_BUNDLE_SCHEMA_VERSION),
  source: BundleSourceSchema,
  files: z.array(BundleFileSchema).min(1),
  note: z.string().optional(),
});

export type HandoffManifest = z.infer<typeof HandoffManifestSchema>;
export type BundleSource = HandoffManifest["source"];
export type BundleFileEntry = HandoffManifest["files"][number];

/** 파일 종류 — 경로 확장자 기반 (manifest가 없을 때 추정용). */
export function kindForPath(filePath: string): BundleFileEntry["kind"] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".svg")) return "svg";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".jsx") || lower.endsWith(".tsx")) return "jsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".ts")) return "js";
  return "other";
}

/** sha256 hex → "sha256:<64hex>" 표기 (5.3 — prefix 포함). */
export function withSha256Prefix(hex: string): string {
  return `sha256:${hex}`;
}

/** "sha256:<64hex>" → 64hex. 형식이 다르면 null. */
export function stripSha256Prefix(hash: string): string | null {
  const match = SHA256_PREFIX_RE.exec(hash);
  return match === null ? null : hash.slice("sha256:".length);
}

export function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * 5.3 정규화 직렬화 — path 오름차순(바이트 순)으로
 * `path + "\n" + 바이트`를 연결한 Buffer를 돌려준다.
 */
export function normalizeBundleBytes(files: Array<{ path: string; bytes: Buffer }>): Buffer {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8")));
  const chunks: Buffer[] = [];
  for (const file of sorted) {
    chunks.push(Buffer.from(file.path, "utf8"), Buffer.from("\n", "utf8"), file.bytes);
  }
  return Buffer.concat(chunks);
}

/** 5.3 — 번들 content hash ("sha256:<64hex>"). */
export function computeBundleContentHash(files: Array<{ path: string; bytes: Buffer }>): string {
  return withSha256Prefix(sha256Hex(normalizeBundleBytes(files)));
}

/** 5.3 — source.id 규칙: user-handoff는 "handoff:sha256:<64hex>", MCP는 "open-design:...". */
export function validateSourceId(source: BundleSource): string | null {
  if (source.mode === "user-handoff") {
    if (source.id.startsWith("handoff:sha256:")) return null;
    return `user-handoff source.id는 "handoff:sha256:<64hex>" 형식이어야 합니다: ${source.id}`;
  }
  if (!source.id.startsWith("open-design:")) {
    return `cloud/local-codex/byok source.id는 "open-design:<runId>:<entryPath>" 형식이어야 합니다: ${source.id}`;
  }
  return null;
}

export interface LoadedBundle {
  rootDir: string;
  manifest: HandoffManifest;
  files: Array<{ entry: BundleFileEntry; bytes: Buffer }>;
}

export interface LoadBundleOptions {
  /** 번들 디렉터리 경로. */
  bundleDir: string;
}

function assertInside(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel.startsWith("/") || rel === "") {
    throw new Error(`번들 파일 경로가 디렉터리 밖을 참조합니다: ${candidate}`);
  }
}

/**
 * 번들 검증 (명세 6.2 — 부분 성공 금지): schema 검증 → 파일 존재·크기·hash
 * 대조 → contentHash 재계산·대조 → source.id 형식 → SVG 엔트리 ≥ 1.
 */
export async function loadBundle(options: LoadBundleOptions): Promise<LoadedBundle> {
  const rootDir = resolve(options.bundleDir);
  const manifestPath = join(rootDir, "manifest.json");

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error(`번들 검증 실패: ${manifestPath} 없음`);
  }

  const parsed = HandoffManifestSchema.safeParse(JSON.parse(manifestRaw) as unknown);
  if (!parsed.success) {
    throw new Error(`번들 검증 실패: manifest.json 스키마 위반 — ${formatZodError(parsed.error)}`);
  }
  const manifest = parsed.data;

  const idIssue = validateSourceId(manifest.source);
  if (idIssue !== null) throw new Error(`번들 검증 실패: ${idIssue}`);

  const loaded: Array<{ entry: BundleFileEntry; bytes: Buffer }> = [];
  for (const entry of manifest.files) {
    const filePath = join(rootDir, ...entry.path.split("/"));
    assertInside(rootDir, filePath);
    const bytes = await readFile(filePath).catch(() => null);
    if (bytes === null) throw new Error(`번들 검증 실패: 파일 없음 — ${entry.path}`);
    if (bytes.length !== entry.bytes) {
      throw new Error(`번들 검증 실패: 크기 불일치 — ${entry.path} (manifest ${entry.bytes}, 실제 ${bytes.length})`);
    }
    const actualHash = withSha256Prefix(sha256Hex(bytes));
    if (actualHash !== entry.hash) {
      throw new Error(`번들 검증 실패: hash 불일치 — ${entry.path} (manifest ${entry.hash}, 실제 ${actualHash})`);
    }
    loaded.push({ entry, bytes });
  }

  const computedHash = computeBundleContentHash(loaded.map(({ entry, bytes }) => ({ path: entry.path, bytes })));
  if (computedHash !== manifest.source.hash) {
    throw new Error(`번들 검증 실패: contentHash 불일치 — manifest ${manifest.source.hash}, 재계산 ${computedHash}`);
  }

  const svgEntries = loaded.filter(({ entry }) => entry.kind === "svg");
  if (svgEntries.length === 0) {
    throw new Error("번들 검증 실패: SVG 엔트리가 없음 (5.5 — 0개는 전체 실패)");
  }

  return { rootDir, manifest, files: loaded };
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** source.id → 파일명 안전 슬러그 (10장 — `od-<sourceId12>`, MCP는 entryPath 슬러그 결합). */
export function sourceIdSlug(sourceId: string): string {
  const id12 = sourceId12(sourceId);
  if (!sourceId.startsWith("open-design:")) return `od-${id12}`;
  const entryPath = sourceId.slice("open-design:".length);
  const afterRun = entryPath.indexOf(":");
  const entry = afterRun === -1 ? "" : entryPath.slice(afterRun + 1);
  const entrySlug = entry
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .join("-")
    .toLowerCase();
  return entrySlug === "" ? `od-${id12}` : `od-${id12}-${entrySlug}`;
}

/** 12.1 — sourceId12 = sha256(source id) 앞 12hex. */
export function sourceId12(sourceId: string): string {
  return sha256Hex(sourceId).slice(0, 12);
}
