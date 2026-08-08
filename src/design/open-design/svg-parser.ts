/**
 * SVG 파싱 → IR (명세 7.2-2·8장).
 *
 * - 지원 요소 enum: svg(루트) · g · rect · circle · ellipse · path · text ·
 *   image · defs(색·그라디언트 참조용). 이 밖의 요소는 변환기에서
 *   unsupported-element로 보고한다.
 * - viewBox → px 좌표 스케일 (8.1): preserveAspectRatio
 *   none(sx/sy 독립) · meet(s=min + 중앙 offset) · slice(s=max + 중앙 offset).
 * - 길이 단위: px·숫자 → px. rem/em/% → px 정규화(손실 기록 포함),
 *   vw/vh 등 비표준 단위는 unsupported(8장). 각도·기타 단위도 unsupported.
 * - 속성 상속(CSS): fill · stroke · stroke-width · opacity · fill-opacity ·
 *   stroke-opacity · font-family · font-size · font-weight · text-anchor ·
 *   dominant-baseline · letter-spacing.
 */

import { textContent, styleToAttrs, type XmlNode } from "./xml.js";

export type SvgElementKind =
  | "svg" | "g" | "rect" | "circle" | "ellipse" | "path" | "text" | "image" | "defs"
  | "unsupported";

export const SUPPORTED_SVG_ELEMENTS: ReadonlySet<string> = new Set([
  "svg", "g", "rect", "circle", "ellipse", "path", "text", "image", "defs",
]);

export interface SvgElement {
  kind: SvgElementKind;
  /** 태그 이름 (지원 밖 요소의 원본 태그). */
  tag: string;
  attrs: Record<string, string>;
  children: SvgElement[];
  /** `svg://g[1]/rect[0]` 형태의 요소 경로 (11장 손실 path). */
  path: string;
  /** 상속 병합 후 유효 속성. */
  effective: Record<string, string>;
  /** 요소 태그 사이의 직접 텍스트 (tspan 분해용). */
  directText: string;
  /** 전체 텍스트 콘텐츠 (직접 + 자손). */
  text: string;
}

export interface SvgViewport {
  /** preserveAspectRatio 해석 결과. */
  mode: "meet" | "slice" | "none";
  /** viewBox 부재 여부 (8.1 — x/y=0, width/height 속성 그대로). */
  hasViewBox: boolean;
  viewBox: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  /** viewBox → px 변환 파라미터 (8.1). */
  scale: { sx: number; sy: number; ox: number; oy: number };
}

export interface SvgDocument {
  root: SvgElement;
  viewport: SvgViewport;
  /** px 단위로 정규화한 루트 프레임 크기. */
  frameWidth: number;
  frameHeight: number;
  /** rem/em/% → px 정규화·비표준 단위 보고용 길이 손실 목록. */
  lengthLosses: LengthLoss[];
  /** viewport-cropped 여부 (slice). */
  cropped: boolean;
}

export interface LengthLoss {
  path: string;
  raw: string;
  kind: "converted" | "unsupported";
  /** converted일 때 px 값. */
  px?: number;
  /** converted일 때 원문 단위. */
  unit?: string;
}

const INHERITED_ATTRS = [
  "fill", "stroke", "stroke-width", "stroke-opacity", "fill-opacity", "opacity",
  "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline",
  "letter-spacing",
] as const;

export function parseSvg(xml: XmlNode): SvgDocument {
  if (xml.tag !== "svg") {
    throw new Error(`SVG 루트는 <svg>여야 합니다: <${xml.tag}>`);
  }
  const root = convertNode(xml, "svg://", {});
  const viewport = resolveViewport(root, xml);
  const lengthLosses: LengthLoss[] = [];
  const cropped = viewport.mode === "slice";
  return {
    root,
    viewport,
    frameWidth: viewport.width,
    frameHeight: viewport.height,
    lengthLosses,
    cropped,
  };
}

function convertNode(xml: XmlNode, path: string, inherited: Record<string, string>): SvgElement {
  const attrs = styleToAttrs(xml);
  const kind: SvgElementKind = SUPPORTED_SVG_ELEMENTS.has(xml.tag)
    ? xml.tag as Exclude<SvgElementKind, "unsupported">
    : "unsupported";

  // CSS 상속 — 자식 고유 속성이 우선.
  const effective: Record<string, string> = {};
  const inheritInto = kind !== "defs" && kind !== "svg";
  if (inheritInto) {
    for (const name of INHERITED_ATTRS) {
      if (inherited[name] !== undefined) effective[name] = inherited[name];
    }
  }
  for (const [name, value] of Object.entries(attrs)) {
    effective[name] = value;
  }

  const children = xml.children.map((child, index) => {
    const separator = path.endsWith("//") ? "" : "/";
    const childPath = `${path}${separator}${child.tag}[${indexOfTagSibling(xml.children, child, index)}]`;
    return convertNode(child, childPath, effective);
  });
  return {
    kind,
    tag: xml.tag,
    attrs,
    children,
    path,
    effective,
    directText: xml.text,
    text: textContent(xml),
  };
}

/** 형제 중 같은 태그 기준 인덱스 (11장 경로 표기). */
function indexOfTagSibling(siblings: XmlNode[], target: XmlNode, index: number): number {
  let count = 0;
  for (let i = 0; i <= index; i += 1) {
    if (siblings[i].tag === target.tag) count += 1;
  }
  return count - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// viewport (8.1)
// ─────────────────────────────────────────────────────────────────────────────

interface RawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function parseViewBox(value: string | undefined): RawRect | null {
  if (value === undefined) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

export function resolveViewport(root: SvgElement, xml: XmlNode): SvgViewport {
  const rawWidth = root.attrs["width"];
  const rawHeight = root.attrs["height"];
  const viewBox = parseViewBox(root.attrs["viewBox"]);

  const width = viewBox === null ? parsePositiveLength(rawWidth, null, "width") : parsePositiveLength(rawWidth, viewBox.width, "width");
  const height = viewBox === null ? parsePositiveLength(rawHeight, null, "height") : parsePositiveLength(rawHeight, viewBox.height, "height");

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`SVG 크기 해석 불가: width=${rawWidth ?? "(없음)"} height=${rawHeight ?? "(없음)"}`);
  }

  const par = parsePreserveAspectRatio(root.attrs["preserveAspectRatio"]);
  if (viewBox === null) {
    return {
      mode: par.mode,
      hasViewBox: false,
      viewBox: { x: 0, y: 0, width, height },
      width,
      height,
      scale: { sx: 1, sy: 1, ox: 0, oy: 0 },
    };
  }

  const vb = viewBox;
  // L4 — 0 이하 viewBox 크기는 스케일 분모가 0이 되어 NaN/Infinity 좌표를
  // 만들 수 있다. 크기 해석 불가로 전체 실패 (width/height 규칙과 동일).
  if (vb.width <= 0 || vb.height <= 0) {
    throw new Error(`SVG 크기 해석 불가: viewBox="0 0 ${vb.width} ${vb.height}"`);
  }
  if (par.mode === "none") {
    return {
      mode: "none",
      hasViewBox: true,
      viewBox: vb,
      width,
      height,
      scale: { sx: width / vb.width, sy: height / vb.height, ox: 0, oy: 0 },
    };
  }

  if (par.mode === "slice") {
    const s = Math.max(width / vb.width, height / vb.height);
    return {
      mode: "slice",
      hasViewBox: true,
      viewBox: vb,
      width,
      height,
      scale: { sx: s, sy: s, ox: alignOffset(par.alignX, width - vb.width * s), oy: alignOffset(par.alignY, height - vb.height * s) },
    };
  }

  const s = Math.min(width / vb.width, height / vb.height);
  return {
    mode: "meet",
    hasViewBox: true,
    viewBox: vb,
    width,
    height,
    scale: { sx: s, sy: s, ox: alignOffset(par.alignX, width - vb.width * s), oy: alignOffset(par.alignY, height - vb.height * s) },
  };
}

interface ParsedPreserveAspectRatio {
  mode: "meet" | "slice" | "none";
  alignX: "min" | "mid" | "max";
  alignY: "min" | "mid" | "max";
}

function parsePreserveAspectRatio(value: string | undefined): ParsedPreserveAspectRatio {
  const parsed: ParsedPreserveAspectRatio = { mode: "meet", alignX: "mid", alignY: "mid" };
  if (value === undefined) return parsed;
  const parts = value.trim().split(/\s+/);
  if (parts[0] === "none") {
    parsed.mode = "none";
    return parsed;
  }
  const align = parts[0];
  const xMatch = /x(Min|Mid|Max)/.exec(align);
  const yMatch = /Y(Min|Mid|Max)/.exec(align);
  if (xMatch !== null) parsed.alignX = xMatch[1].toLowerCase() as "min" | "mid" | "max";
  if (yMatch !== null) parsed.alignY = yMatch[1].toLowerCase() as "min" | "mid" | "max";
  if (parts[1] === "slice") parsed.mode = "slice";
  else if (parts[1] === "meet") parsed.mode = "meet";
  return parsed;
}

function alignOffset(align: "min" | "mid" | "max", remainder: number): number {
  if (align === "min") return 0;
  if (align === "max") return remainder;
  return remainder / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// 길이 (8.1)
// ─────────────────────────────────────────────────────────────────────────────

const LENGTH_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|vw|vh|vmin|vmax|cm|mm|in|pt|pc)?$/i;

/**
 * 절대 길이 → px (기본 단위는 px). viewport 기준 % 해석.
 * rem/em → 16px 루트 기준 px 정규화 (lossy conversion — 호출자가 기록).
 * 비표준 단위(vw·vh·cm·mm·in·pt·pc) → NaN (호출자가 unsupported 보고).
 */
export function parseLengthToPx(
  raw: string | undefined,
  base: number,
  axis: "x" | "y",
): { value: number; unit: string | null; lossy: boolean } | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  const match = LENGTH_RE.exec(text);
  if (match === null) return null;
  const number = Number.parseFloat(match[1]);
  const unit = (match[2] ?? "px").toLowerCase();
  switch (unit) {
    case "px": return { value: number, unit: "px", lossy: false };
    case "" : return { value: number, unit: "px", lossy: false };
    case "%": return { value: (number / 100) * base, unit: "%", lossy: true };
    case "rem": return { value: number * 16, unit: "rem", lossy: true };
    case "em": return { value: number * 16, unit: "em", lossy: true };
    default: return { value: NaN, unit, lossy: true };
  }
}

/** width/height 속성 — %는 viewport 기준이 아니라 값 자체로 해석이 애매하므로 px/단위 없음만 지원하고 %는 viewBox 우선. */
function parsePositiveLength(raw: string | undefined, viewBoxFallback: number | null, name: string): number {
  if (raw === undefined) {
    if (viewBoxFallback !== null) return viewBoxFallback;
    return NaN;
  }
  const text = raw.trim();
  if (text.endsWith("%")) {
    // viewBox가 있으면 viewBox 크기, 없으면 해석 불가 (8.1 — width/height 속성값 사용).
    if (viewBoxFallback !== null) return viewBoxFallback;
    return NaN;
  }
  const match = LENGTH_RE.exec(text);
  if (match === null) return NaN;
  const unit = (match[2] ?? "px").toLowerCase();
  if (unit === "px" || unit === "") return Number.parseFloat(match[1]);
  return NaN;
}

/** viewBox 좌표계 → px (8.1 공식). */
export function toPx(viewport: SvgViewport, x: number, y: number): { x: number; y: number } {
  const { sx, sy, ox, oy } = viewport.scale;
  return { x: x * sx + ox, y: y * sy + oy };
}

/** viewBox 사각형 → px 사각형. */
export function rectToPx(viewport: SvgViewport, rect: RawRect): { x: number; y: number; width: number; height: number } {
  const p1 = toPx(viewport, rect.x, rect.y);
  const p2 = toPx(viewport, rect.x + rect.width, rect.y + rect.height);
  return { x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y };
}
