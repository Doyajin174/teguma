/**
 * SVG IR → Penpot 셰이프 변환 (명세 8장).
 *
 * - viewBox→px 좌표 스케일(8.1), text baseline→박스 상단 보정, text-anchor 변환.
 * - rect/circle/ellipse/path/text 지원 — path는 실측 요구 필드(8.2):
 *   content·selrect·points(4)·transform/transform-inverse·parent-id/frame-id.
 * - 지원 불가 요소는 unsupported-element로 보고하고 반입하지 않는다 (부분 성공 금지).
 * - 결정적 id: sha256(sourceId12 + 요소 경로) 기반 uuid.
 */

import { createHash } from "node:crypto";
import { parseSvgColor, parseOpacity, clampAlpha } from "./color.js";
import {
  parseLengthToPx,
  rectToPx,
  toPx,
  type SvgDocument,
  type SvgElement,
  type SvgViewport,
} from "./svg-parser.js";
import { type LossSummary, emptySummary, addToSummary } from "./loss.js";
import { type LossItem, buildLossItem } from "./loss-item.js";

export interface PenpotMatrix {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

export const IDENTITY_MATRIX: PenpotMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export interface PenpotSelrect {
  x: number; y: number; width: number; height: number;
  x1: number; y1: number; x2: number; y2: number;
}

export type PenpotShapeObj = {
  id: string;
  // ellipse는 Penpot 스키마에 없는 타입 — convertEllipse가 circle로 매핑한다
  // (live smoke 실측 2026-08-08). 유니온에 ellipse를 두지 않는다.
  type: "frame" | "group" | "rect" | "circle" | "path" | "text";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selrect: PenpotSelrect;
  points: Array<{ x: number; y: number }>;
  transform: PenpotMatrix;
  "transform-inverse": PenpotMatrix;
  "parent-id": string;
  "frame-id": string;
  fills?: Array<Record<string, unknown>>;
  strokes?: Array<Record<string, unknown>>;
  shapes?: string[];
  rx?: number;
  ry?: number;
  content?: unknown;
  "font-family"?: string;
  "font-size"?: number;
  "font-weight"?: string | number;
  "line-height"?: number;
  "text-align"?: "left" | "center" | "right";
};

export interface PathCommand {
  command: string;
  params: number[];
}

export interface ConvertedSvg {
  frame: PenpotShapeObj;
  /** 쓰기 순서 (부모 우선): frame → 직속 → 자손. */
  shapes: PenpotShapeObj[];
  textShapes: number;
  summary: LossSummary;
  losses: LossItem[];
  fontFamilies: Array<{ family: string; path: string }>;
}

export interface ConvertOptions {
  sourceId12: string;
  frameName: string;
  /** 다중 SVG(5.5) — 손실 path를 "svg://<entryPath>#..."로 표기. */
  entryPath?: string;
}

interface ConvertContext {
  options: ConvertOptions;
  viewport: SvgViewport;
  losses: LossItem[];
  summary: LossSummary;
  fontTracker: Map<string, string>;
  colorTracker: Map<string, { success: boolean }>;
  textShapes: number;
}

interface ElementEnv {
  parentId: string;
  frameId: string;
  shapes: PenpotShapeObj[];
}

export function convertSvgDocument(doc: SvgDocument, options: ConvertOptions): ConvertedSvg {
  const ctx: ConvertContext = {
    options,
    viewport: doc.viewport,
    losses: [],
    summary: emptySummary(),
    fontTracker: new Map<string, string>(),
    colorTracker: new Map<string, { success: boolean }>(),
    textShapes: 0,
  };

  addToSummary(ctx.summary, "frames", { source: 1 });
  const frameId = deterministicUuid(`${options.sourceId12}:frame`);
  const frameName = rootName(doc.root) ?? options.frameName;
  const frame: PenpotShapeObj = {
    id: frameId,
    type: "frame",
    name: frameName,
    x: 0,
    y: 0,
    width: doc.frameWidth,
    height: doc.frameHeight,
    selrect: selrectFor(0, 0, doc.frameWidth, doc.frameHeight),
    points: pointsFor(0, 0, doc.frameWidth, doc.frameHeight),
    transform: IDENTITY_MATRIX,
    "transform-inverse": IDENTITY_MATRIX,
    "parent-id": "00000000-0000-0000-0000-000000000000",
    "frame-id": "00000000-0000-0000-0000-000000000000",
    fills: [],
    shapes: [],
  };
  addToSummary(ctx.summary, "frames", { imported: 1 });

  if (doc.cropped) {
    ctx.losses.push(buildLossItem({
      category: "frame",
      severity: "lossy",
      code: "viewport-cropped",
      path: pathOf(ctx, "svg://"),
      reason: "preserveAspectRatio=slice — viewport 밖 영역 크롭",
      original: {
        viewBox: doc.viewport.viewBox,
        width: doc.frameWidth,
        height: doc.frameHeight,
        preserveAspectRatio: "slice",
      },
    }));
  }

  const shapes: PenpotShapeObj[] = [];
  const env: ElementEnv = { parentId: frameId, frameId, shapes };
  for (const child of doc.root.children) {
    convertElement(child, ctx, env);
  }
  frame.shapes = shapes.filter((shape) => shape["parent-id"] === frameId).map((shape) => shape.id);

  // 길이 손실 (parseSvg에서 수집 — viewBox 단위) → loss items.
  for (const loss of doc.lengthLosses) {
    const category = loss.path === "svg://" ? "frame" : "layer";
    if (loss.kind === "converted") {
      ctx.losses.push(buildLossItem({
        category,
        severity: "lossy",
        code: "nonstandard-unit",
        path: pathOf(ctx, loss.path),
        reason: `${loss.raw} → ${round4(loss.px as number)}px (${loss.unit} → px 정규화, 루트 16px 기준)`,
        original: { value: loss.raw },
        converted: { value: round4(loss.px as number), unit: "px" },
      }));
    } else {
      ctx.losses.push(buildLossItem({
        category,
        severity: "unsupported",
        code: "nonstandard-unit",
        path: pathOf(ctx, loss.path),
        reason: `비표준 단위 ${loss.unit} — px 변환 불가`,
        original: { value: loss.raw },
      }));
    }
  }

  // 폰트 손실 (가족 단위 — 첫 등장 요소 경로).
  for (const [family, firstPath] of ctx.fontTracker) {
    const classification = classifyFont(family);
    if (classification === "system") {
      addToSummary(ctx.summary, "fonts", { source: 1, imported: 1 });
      continue;
    }
    if (classification === "unknown") {
      ctx.losses.push(buildLossItem({
        category: "font",
        severity: "unsupported",
        code: "font-license-unknown",
        path: pathOf(ctx, firstPath),
        reason: `"${family}" 라이선스 미확인 — 사용자 확인 전 자동 임베드 금지`,
        original: { fontFamily: family },
      }));
      addToSummary(ctx.summary, "fonts", { source: 1, unsupported: 1 });
      continue;
    }
    ctx.losses.push(buildLossItem({
      category: "font",
      severity: "lossy",
      code: "font-not-found",
      path: pathOf(ctx, firstPath),
      reason: `"${family}" 미설치 — fallback 'Inter' 렌더`,
      original: { fontFamily: family },
    }));
    addToSummary(ctx.summary, "fonts", { source: 1, lossy: 1 });
  }

  return {
    frame,
    shapes: [frame, ...shapes],
    textShapes: ctx.textShapes,
    summary: ctx.summary,
    losses: ctx.losses,
    fontFamilies: [...ctx.fontTracker.entries()].map(([family, path]) => ({ family, path })),
  };
}

const SKIP_TAGS = new Set(["defs", "title", "desc", "metadata"]);
const UNSUPPORTED_VISUAL_TAGS = new Set(["style", "script", "filter", "clipPath", "mask", "symbol", "use", "pattern", "marker"]);

function convertElement(element: SvgElement, ctx: ConvertContext, env: ElementEnv): void {
  if (SKIP_TAGS.has(element.tag)) return;

  switch (element.kind) {
    case "g": return convertGroup(element, ctx, env);
    case "rect": return convertRect(element, ctx, env);
    case "circle": return convertCircle(element, ctx, env);
    case "ellipse": return convertEllipse(element, ctx, env);
    case "path": return convertPath(element, ctx, env);
    case "text": return convertText(element, ctx, env);
    case "image": return convertImage(element, ctx, env);
    case "svg":
    case "unsupported": {
      reportUnsupportedElement(element, ctx);
      return;
    }
  }
}

function reportUnsupportedElement(element: SvgElement, ctx: ConvertContext): void {
  addToSummary(ctx.summary, "layers", { source: 1, unsupported: 1 });
  const visual = UNSUPPORTED_VISUAL_TAGS.has(element.tag) || element.kind === "svg";
  const reason = visual
    ? `<${element.tag}>는 v0.1 지원 요소 밖 — 서브트리 전체 미반입(평탄화 없음)`
    : `<${element.tag}>는 비시각적 요소 — 미반입`;
  ctx.losses.push(buildLossItem({
    category: "layer",
    severity: "unsupported",
    code: "unsupported-element",
    path: pathOf(ctx, element.path),
    reason,
    original: { tag: element.tag },
  }));
}

function convertGroup(element: SvgElement, ctx: ConvertContext, env: ElementEnv): void {
  addToSummary(ctx.summary, "layers", { source: 1 });
  reportTransform(element, ctx);
  const name = elementName(element, ctx, element.path, "layer");
  const group: PenpotShapeObj = {
    id: deterministicUuid(`${ctx.options.sourceId12}:${element.path}`),
    type: "group",
    name,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    selrect: selrectFor(0, 0, 0, 0),
    points: pointsFor(0, 0, 0, 0),
    transform: IDENTITY_MATRIX,
    "transform-inverse": IDENTITY_MATRIX,
    "parent-id": env.parentId,
    "frame-id": env.frameId,
    shapes: [],
  };
  const childShapes: PenpotShapeObj[] = [];
  for (const child of element.children) {
    convertElement(child, ctx, { parentId: group.id, frameId: env.frameId, shapes: childShapes });
  }
  group.shapes = childShapes.filter((shape) => shape["parent-id"] === group.id).map((shape) => shape.id);
  env.shapes.push(group, ...childShapes);
  addToSummary(ctx.summary, "layers", { imported: 1 });
}

function convertRect(element: SvgElement, ctx: ConvertContext, env: ElementEnv): void {
  addToSummary(ctx.summary, "layers", { source: 1 });
  reportTransform(element, ctx);
  const rect = pxRect(element, ctx);
  const shape: PenpotShapeObj = baseShape(ctx, element, "rect", env, rect);
  const rx = resolveLengthPx(element, ctx, "rx", "x");
  const ry = resolveLengthPx(element, ctx, "ry", "y");
  const radius = Math.min(rx ?? ry ?? 0, Math.min(rect.width, rect.height) / 2);
  if (radius > 0) {
    shape.rx = round4(radius);
    shape.ry = round4(radius);
  }
  applyPaint(element, ctx, shape);
  env.shapes.push(shape);
  addToSummary(ctx.summary, "layers", { imported: 1 });
}

function convertCircle(element: SvgElement, ctx: ConvertContext, env: ElementEnv): void {
  addToSummary(ctx.summary, "layers", { source: 1 });
  reportTransform(element, ctx);
  const r = resolveLengthPx(element, ctx, "r", "x") ?? 0;
  const cx = resolveLengthPx(element, ctx, "cx", "x") ?? 0;
  const cy = resolveLengthPx(element, ctx, "cy", "y") ?? 0;
  const shape: PenpotShapeObj = baseShape(ctx, element, "circle", env, {
    x: cx - r, y: cy - r, width: r * 2, height: r * 2,
  });
  applyPaint(element, ctx, shape);
  env.shapes.push(shape);
  addToSummary(ctx.summary, "layers", { imported: 1 });
}

function convertEllipse(element: SvgElement, ctx: ConvertContext, env: ElementEnv): void {
  addToSummary(ctx.summary, "layers", { source: 1 });
  reportTransform(element, ctx);
  const rx = resolveLengthPx(element, ctx, "rx", "x") ?? 0;
  const ry = resolveLengthPx(element, ctx, "ry", "y") ?? 0;
  const cx = resolveLengthPx(element, ctx, "cx", "x") ?? 0;
  const cy = resolveLengthPx(element, ctx, "cy", "y") ?? 0;
  // Penpot 셰이프 스키마에는 ellipse 타입이 없다 — circle로 매핑 (rx/ry는
  // selrect 크기로 표현. 실측: 서버 type 디스패치가 circle만 수용).
  const shape: PenpotShapeObj = baseShape(ctx, element, "circle", env, {
    x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2,
  });
  applyPaint(element, ctx, shape);
  env.shapes.push(shape);
  addToSummary(ctx.summary, "layers", { imported: 1 });
}

function convertPath(element: SvgElement, ctx: ConvertContext, env: ElementEnv): void {
  addToSummary(ctx.summary, "layers", { source: 1 });
  reportTransform(element, ctx);
  const d = element.effective["d"];
  if (d === undefined) {
    reportUnsupportedPath(element, ctx, "<path>에 d 속성 없음", undefined);
    return;
  }
  const commands = parsePathData(d);
  if (commands === null) {
    reportUnsupportedPath(element, ctx, "SVG path d에 Penpot path 명령으로 매핑 불가한 명령 포함", d);
    return;
  }
  const bbox = pathBBox(commands);
  if (bbox === null) {
    reportUnsupportedPath(element, ctx, "path d에서 좌표를 해석할 수 없음", d);
    return;
  }
  // 8.1 — path bbox도 viewBox 좌표계 → px 스케일 (rect와 동일 규칙).
  const shape = baseShape(ctx, element, "path", env, rectToPx(ctx.viewport, bbox));
  // 실측 (live smoke 2026-08-08): 서버는 path content를 명령 배열이 아니라
  // 정규화된 path 문자열로 저장한다 — 원본 d를 그대로 전달 (서버가 정규화).
  shape.content = d;
  applyPaint(element, ctx, shape);
  env.shapes.push(shape);
  addToSummary(ctx.summary, "layers", { imported: 1 });
}

function reportUnsupportedPath(element: SvgElement, ctx: ConvertContext, reason: string, d: string | undefined): void {
  ctx.losses.push(buildLossItem({
    category: "layer",
    severity: "unsupported",
    code: "unsupported-element",
    path: pathOf(ctx, element.path),
    reason,
    ...(d !== undefined ? { original: { d } } : {}),
  }));
  addToSummary(ctx.summary, "layers", { unsupported: 1 });
}

function convertImage(element: SvgElement, ctx: ConvertContext, _env: ElementEnv): void {
  addToSummary(ctx.summary, "images", { source: 1, unsupported: 1 });
  const href = element.effective["href"] ?? element.effective["xlink:href"];
  if (href !== undefined && href.startsWith("data:")) {
    ctx.losses.push(buildLossItem({
      category: "image",
      severity: "unsupported",
      code: "embedded-image-v0.2",
      path: pathOf(ctx, element.path),
      reason: "data URI 이미지는 v0.2 후보 — 미반입",
      original: { href: dataUriSummary(href) },
    }));
    return;
  }
  ctx.losses.push(buildLossItem({
    category: "image",
    severity: "unsupported",
    code: "external-url-asset",
    path: pathOf(ctx, element.path),
    reason: "외부 URL 이미지 미반입 — 라이선스·가용성 사용자 확인 필요",
    original: { href: href ?? "(없음)" },
  }));
}

function convertText(element: SvgElement, ctx: ConvertContext, env: ElementEnv): void {
  addToSummary(ctx.summary, "text", { source: 1 });
  reportTransform(element, ctx);
  const name = elementName(element, ctx, element.path, "text");

  const fontSize = resolveLengthPx(element, ctx, "font-size", "y") ?? 16;
  const family = element.effective["font-family"];
  if (family !== undefined) {
    const primary = primaryFamily(family);
    if (!ctx.fontTracker.has(primary)) ctx.fontTracker.set(primary, element.path);
  }

  const baseline = element.effective["dominant-baseline"] ?? "auto";
  const anchor = element.effective["text-anchor"] ?? "start";
  const letterSpacing = element.effective["letter-spacing"];
  const paint = textPaint(element, ctx);

  const lines = resolveTextLines(element, ctx);
  const lineShapes: PenpotShapeObj[] = [];
  let elementLossy = false;
  // H1 — viewBox 좌표계 → px 스케일 (8.1, rect/circle/ellipse/path와 동일 규칙).
  // fontSize·line-height는 세로 계열 길이이므로 sy를 적용한다.
  const fontSizePx = fontSize * ctx.viewport.scale.sy;

  lines.forEach((line, index) => {
    const pos = toPx(ctx.viewport, line.x, line.y);
    const lineHeightPx = line.lineHeight === undefined
      ? undefined
      : line.lineHeight * ctx.viewport.scale.sy;
    // baseline·line-height 보정은 스케일 적용 후 계산한다 (H1).
    const top = baselineTopY(pos.y, baseline, fontSizePx);
    const baselineExact = baseline === "middle" || baseline === "central"
      || baseline === "hanging" || baseline === "text-before-edge";
    if (!baselineExact) {
      ctx.losses.push(buildLossItem({
        category: "text", severity: "lossy", code: "baseline-estimated",
        path: pathOf(ctx, element.path),
        reason: `baseline → 박스 상단 보정 (ascent ≈ font-size × 0.8 = ${round4(fontSizePx * 0.8)}px 보수 추정)`,
        original: { x: round4(line.x), y: round4(line.y), fontSize: round4(fontSize), dominantBaseline: baseline },
        converted: { value: round4(top), unit: "px" },
      }));
      elementLossy = true;
    }

    const shape: PenpotShapeObj = {
      id: deterministicUuid(`${ctx.options.sourceId12}:${element.path}:line-${index}`),
      type: "text",
      name: lines.length === 1 ? name : `${name}-line-${index + 1}`,
      x: round4(pos.x),
      y: round4(top),
      width: 0,
      height: round4(fontSizePx),
      selrect: selrectFor(pos.x, top, 0, fontSizePx),
      points: pointsFor(pos.x, top, 0, fontSizePx),
      transform: IDENTITY_MATRIX,
      "transform-inverse": IDENTITY_MATRIX,
      "parent-id": env.parentId,
      "frame-id": env.frameId,
      content: textContentTree(line.text),
    };
    if (family !== undefined) shape["font-family"] = family;
    shape["font-size"] = round4(fontSizePx);
    const weight = element.effective["font-weight"];
    if (weight !== undefined) shape["font-weight"] = weight;
    if (lineHeightPx !== undefined) shape["line-height"] = round4(lineHeightPx);
    if (anchor !== "start") {
      shape["text-align"] = anchor === "middle" ? "center" : "right";
      ctx.losses.push(buildLossItem({
        category: "text", severity: "lossy", code: "text-anchor-converted",
        path: pathOf(ctx, element.path),
        reason: `text-anchor "${anchor}" → text-align "${shape["text-align"]}" 변환`,
        original: { textAnchor: anchor },
        converted: { value: shape["text-align"] },
      }));
      elementLossy = true;
    }
    if (letterSpacing !== undefined && letterSpacing !== "normal" && letterSpacing !== "0") {
      ctx.losses.push(buildLossItem({
        category: "text", severity: "lossy", code: "dropped-property",
        path: pathOf(ctx, element.path),
        reason: "letter-spacing 미지원 — 속성 탈락",
        original: { letterSpacing },
      }));
      elementLossy = true;
    }
    if (paint.fills !== undefined) shape.fills = paint.fills;
    if (paint.strokes !== undefined) shape.strokes = paint.strokes;
    lineShapes.push(shape);
  });

  ctx.textShapes += lineShapes.length;
  env.shapes.push(...lineShapes);
  addToSummary(ctx.summary, "text", { imported: lineShapes.length > 0 ? 1 : 0 });
  if (elementLossy) addToSummary(ctx.summary, "text", { lossy: 1 });
}

interface TextPaint {
  fills?: Array<Record<string, unknown>>;
  strokes?: Array<Record<string, unknown>>;
}

function textPaint(element: SvgElement, ctx: ConvertContext): TextPaint {
  const opacity = parseOpacity(element.effective["opacity"]) * parseOpacity(element.effective["fill-opacity"]);
  const fillRaw = element.effective["fill"];
  const fill = parseSvgColor(fillRaw);
  const paint: TextPaint = {};
  if (fill !== null) {
    paint.fills = [{ "fill-color": fill.hex, "fill-opacity": clampAlpha(fill.alpha * opacity) }];
    trackColor(ctx, element, fillRaw as string, true);
  } else if (fillRaw !== undefined && fillRaw !== "none" && fillRaw !== "transparent") {
    trackColor(ctx, element, fillRaw, false);
    reportUnsupportedColor(ctx, element, "fill", fillRaw);
  }
  const strokeRaw = element.effective["stroke"];
  const stroke = parseSvgColor(strokeRaw);
  if (stroke !== null) {
    const width = resolveLengthPx(element, ctx, "stroke-width", "x") ?? 1;
    paint.strokes = [{
      "stroke-color": stroke.hex,
      "stroke-opacity": clampAlpha(stroke.alpha * opacity * parseOpacity(element.effective["stroke-opacity"])),
      "stroke-width": round4(width),
    }];
    trackColor(ctx, element, strokeRaw as string, true);
  } else if (strokeRaw !== undefined && strokeRaw !== "none" && strokeRaw !== "transparent") {
    trackColor(ctx, element, strokeRaw, false);
    reportUnsupportedColor(ctx, element, "stroke", strokeRaw);
  }
  return paint;
}

// ─────────────────────────────────────────────────────────────────────────────
// 텍스트 라인 분해 (8.1)
// ─────────────────────────────────────────────────────────────────────────────

interface TextLine {
  x: number;
  y: number;
  text: string;
  lineHeight?: number;
}

function resolveTextLines(element: SvgElement, ctx: ConvertContext): TextLine[] {
  const rootX = resolveLengthPx(element, ctx, "x", "x") ?? 0;
  const rootY = resolveLengthPx(element, ctx, "y", "y") ?? 0;
  const tspans = element.children.filter((child) => child.tag === "tspan");
  if (tspans.length === 0) {
    return [{ x: rootX, y: rootY, text: element.text.trim() }];
  }

  const lines: TextLine[] = [];
  let cursor: TextLine = { x: rootX, y: rootY, text: "" };
  let pending = element.directText.trim();
  const flush = (): void => {
    if (pending !== "") {
      lines.push({ ...cursor, text: pending });
      pending = "";
    }
  };

  for (const tspan of tspans) {
    const text = tspan.text.trim();
    if (text === "") continue;
    const xAttr = tspan.effective["x"];
    const yAttr = tspan.effective["y"];
    const dxAttr = tspan.effective["dx"];
    const dyAttr = tspan.effective["dy"];
    if (xAttr !== undefined || yAttr !== undefined) {
      const x = resolveLengthPx(tspan, ctx, "x", "x");
      const y = resolveLengthPx(tspan, ctx, "y", "y");
      if (x === null || y === null) {
        ctx.losses.push(buildLossItem({
          category: "text", severity: "ambiguous", code: "tspan-unresolved",
          path: pathOf(ctx, tspan.path),
          reason: "tspan x/y 오프셋을 px로 해석할 수 없음 — 부모 위치로 폴백",
          original: { x: xAttr, y: yAttr },
        }));
        pending = `${pending}${text}`.trim();
        continue;
      }
      flush();
      cursor = { x, y, text: "" };
      pending = text;
      continue;
    }
    if (dxAttr !== undefined || dyAttr !== undefined) {
      const dx = parseLengthPxOnly(dxAttr);
      const dy = parseLengthPxOnly(dyAttr);
      if (dx === null || dy === null) {
        ctx.losses.push(buildLossItem({
          category: "text", severity: "ambiguous", code: "tspan-unresolved",
          path: pathOf(ctx, tspan.path),
          reason: "tspan dx/dy 오프셋을 px로 해석할 수 없음 — 부모 위치로 폴백",
          original: { dx: dxAttr, dy: dyAttr },
        }));
        pending = `${pending}${text}`.trim();
        continue;
      }
      flush();
      cursor = { x: cursor.x + dx, y: cursor.y + dy, text: "", lineHeight: dy };
      pending = text;
      continue;
    }
    // 위치 속성 없음 — 현재 라인에 이어붙이기.
    pending = `${pending}${text}`.trim();
  }
  flush();
  if (lines.length === 0) {
    return [{ x: rootX, y: rootY, text: element.text.trim() }];
  }
  return lines;
}

function parseLengthPxOnly(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px)?$/i.exec(raw.trim());
  return match === null ? null : Number.parseFloat(match[1]);
}

function baselineTopY(baselineY: number, baseline: string, fontSize: number): number {
  switch (baseline) {
    case "middle":
    case "central":
      return baselineY - fontSize / 2;
    case "hanging":
    case "text-before-edge":
      return baselineY;
    case "auto":
    case "alphabetic":
    default:
      return baselineY - fontSize * 0.8;
  }
}

function textContentTree(text: string): unknown {
  return {
    type: "root",
    children: [{
      type: "paragraph-set",
      children: [{
        type: "paragraph",
        // 실측 (live smoke 2026-08-08): Penpot text 리프 노드는 `value`가
        // 아니라 `text` 키다 (`[:text :string]` — malli missing-key 실측).
        children: [{ type: "text", text }],
      }],
    }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// path 데이터 (8.2)
// ─────────────────────────────────────────────────────────────────────────────

const PATH_TOKEN_RE = /([A-Za-z])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
const VALID_PATH_COMMANDS = new Set("MmLlHhVvCcSsQqTtAaZz".split(""));

export function parsePathData(d: string): PathCommand[] | null {
  const tokens: Array<{ type: "cmd"; value: string } | { type: "num"; value: number }> = [];
  for (const match of d.matchAll(PATH_TOKEN_RE)) {
    if (match[1] !== undefined) {
      if (!VALID_PATH_COMMANDS.has(match[1])) return null; // 매핑 불가 명령
      tokens.push({ type: "cmd", value: match[1] });
    }
    else if (match[2] !== undefined) tokens.push({ type: "num", value: Number.parseFloat(match[2]) });
  }
  if (tokens.length === 0 || tokens[0].type !== "cmd") return null;

  const commands: PathCommand[] = [];
  let cursor = 0;
  let x = 0;
  let y = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  let lastCommand = "";
  let lastQuadControl: { x: number; y: number } | null = null;

  const readNumber = (): number | null => {
    const token = tokens[cursor];
    if (token === undefined || token.type !== "num") return null;
    const value = token.value;
    cursor += 1;
    return value;
  };
  const readPair = (): { x: number; y: number } | null => {
    const xValue = readNumber();
    const yValue = readNumber();
    if (xValue === null || yValue === null) return null;
    return { x: xValue, y: yValue };
  };
  const push = (command: string, params: number[]): void => {
    commands.push({ command, params });
  };
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.type === "cmd") {
      lastCommand = token.value;
      cursor += 1;
    } else if (lastCommand === "") {
      return null;
    }

    const cmd = lastCommand;
    // M/m 뒤 숫자가 이어지면 암묵 line-to (SVG 1.1).
    const effective = (cmd === "M" || cmd === "m") && token.type === "num"
      ? (cmd === "M" ? "L" : "l")
      : cmd;
    const relative = effective !== "Z" && effective === effective.toLowerCase();
    const upper = effective.toUpperCase();

    if (upper === "Z") {
      push("close-path", []);
      x = subpathStartX;
      y = subpathStartY;
      lastQuadControl = null;
      continue;
    }
    if (upper === "M") {
      const point = readPair();
      if (point === null) return null;
      const target = relative ? { x: x + point.x, y: y + point.y } : point;
      push("move-to", [target.x, target.y]);
      x = target.x;
      y = target.y;
      subpathStartX = x;
      subpathStartY = y;
      lastQuadControl = null;
      continue;
    }
    if (upper === "L") {
      const point = readPair();
      if (point === null) return null;
      const target = relative ? { x: x + point.x, y: y + point.y } : point;
      push("line-to", [target.x, target.y]);
      x = target.x;
      y = target.y;
      continue;
    }
    if (upper === "H") {
      const xValue = readNumber();
      if (xValue === null) return null;
      const targetX = relative ? x + xValue : xValue;
      push("line-to", [targetX, y]);
      x = targetX;
      continue;
    }
    if (upper === "V") {
      const yValue = readNumber();
      if (yValue === null) return null;
      const targetY = relative ? y + yValue : yValue;
      push("line-to", [x, targetY]);
      y = targetY;
      continue;
    }
    if (upper === "C") {
      const c1 = readPair();
      const c2 = readPair();
      const end = readPair();
      if (c1 === null || c2 === null || end === null) return null;
      const p1 = relative ? { x: x + c1.x, y: y + c1.y } : c1;
      const p2 = relative ? { x: x + c2.x, y: y + c2.y } : c2;
      const p3 = relative ? { x: x + end.x, y: y + end.y } : end;
      push("curve-to", [p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]);
      x = p3.x;
      y = p3.y;
      continue;
    }
    if (upper === "S") {
      const c2 = readPair();
      const end = readPair();
      if (c2 === null || end === null) return null;
      const p2 = relative ? { x: x + c2.x, y: y + c2.y } : c2;
      const p3 = relative ? { x: x + end.x, y: y + end.y } : end;
      // 예외 정책 (020 3.1): S 반사 제어점은 원래부터 미적용 상태 — lint 정리로
      // write-only 변수만 제거, 기존 동작 유지 (후속 개선 후보).
      push("smooth-curve-to", [p2.x, p2.y, p3.x, p3.y]);
      x = p3.x;
      y = p3.y;
      continue;
    }
    if (upper === "Q") {
      const control = readPair();
      const end = readPair();
      if (control === null || end === null) return null;
      const p1 = relative ? { x: x + control.x, y: y + control.y } : control;
      const p2 = relative ? { x: x + end.x, y: y + end.y } : end;
      push("quadratic-bezier-curve-to", [p1.x, p1.y, p2.x, p2.y]);
      lastQuadControl = p1;
      x = p2.x;
      y = p2.y;
      continue;
    }
    if (upper === "T") {
      const end = readPair();
      if (end === null) return null;
      const reflected: { x: number; y: number } = lastQuadControl !== null
        ? { x: 2 * x - lastQuadControl.x, y: 2 * y - lastQuadControl.y }
        : { x, y };
      const p2 = relative ? { x: x + end.x, y: y + end.y } : end;
      push("smooth-quadratic-bezier-curve-to", [p2.x, p2.y]);
      lastQuadControl = reflected;
      x = p2.x;
      y = p2.y;
      continue;
    }
    if (upper === "A") {
      const rx = readNumber();
      const ry = readNumber();
      const rot = readNumber();
      const laf = readNumber();
      const sf = readNumber();
      const end = readPair();
      if (rx === null || ry === null || rot === null || laf === null || sf === null || end === null) return null;
      const p2 = relative ? { x: x + end.x, y: y + end.y } : end;
      push("arc", [rx, ry, rot, laf, sf, p2.x, p2.y]);
      x = p2.x;
      y = p2.y;
      continue;
    }
    return null; // 매핑 불가 명령
  }
  return commands;
}

/**
 * path 바운딩 박스 (8.2 — 결정적·보수적).
 *
 * - on-curve + 컨트롤 포인트 포함 (베지어는 컨벡스 헐 내부 — 보수적).
 * - S/T 반사 제어점은 parsePathData와 동일 규칙으로 재구성해 포함 (M2).
 * - arc는 endpoint→중심 파라미터화(SVG F.6.5)로 타원 극값 각도를 계산하고,
 *   해당 각도가 호에 포함될 때만 흡수 — endpoint±(rx,ry) 근사 제거 (M1).
 */
function pathBBox(commands: PathCommand[]): { x: number; y: number; width: number; height: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let hasPoint = false;
  // 커서 상태 — S/T 반사 제어점·arc 시작점 계산용 (parsePathData와 동일 규칙).
  let x = 0;
  let y = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  let lastCubicControl: { x: number; y: number } | null = null;
  let lastQuadControl: { x: number; y: number } | null = null;
  const absorb = (px: number, py: number): void => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    hasPoint = true;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };
  for (const command of commands) {
    const p = command.params;
    switch (command.command) {
      case "move-to":
        absorb(p[0], p[1]);
        x = p[0];
        y = p[1];
        subpathStartX = x;
        subpathStartY = y;
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      case "line-to":
        absorb(p[0], p[1]);
        x = p[0];
        y = p[1];
        break;
      case "curve-to":
        absorb(p[0], p[1]);
        absorb(p[2], p[3]);
        absorb(p[4], p[5]);
        lastCubicControl = { x: p[2], y: p[3] };
        x = p[4];
        y = p[5];
        break;
      case "smooth-curve-to": {
        const reflected: { x: number; y: number } = lastCubicControl === null
          ? { x, y }
          : { x: 2 * x - lastCubicControl.x, y: 2 * y - lastCubicControl.y };
        absorb(reflected.x, reflected.y);
        absorb(p[0], p[1]);
        absorb(p[2], p[3]);
        lastCubicControl = { x: p[0], y: p[1] };
        x = p[2];
        y = p[3];
        break;
      }
      case "quadratic-bezier-curve-to":
        absorb(p[0], p[1]);
        absorb(p[2], p[3]);
        lastQuadControl = { x: p[0], y: p[1] };
        x = p[2];
        y = p[3];
        break;
      case "smooth-quadratic-bezier-curve-to": {
        const reflected: { x: number; y: number } = lastQuadControl === null
          ? { x, y }
          : { x: 2 * x - lastQuadControl.x, y: 2 * y - lastQuadControl.y };
        absorb(reflected.x, reflected.y);
        absorb(p[0], p[1]);
        lastQuadControl = reflected;
        x = p[0];
        y = p[1];
        break;
      }
      case "arc": {
        absorbArc(absorb, x, y, p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
        x = p[5];
        y = p[6];
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case "close-path":
        x = subpathStartX;
        y = subpathStartY;
        lastCubicControl = null;
        lastQuadControl = null;
        break;
    }
  }
  if (!hasPoint) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const TWO_PI = Math.PI * 2;

/**
 * arc 참값 bbox — endpoint→중심 파라미터화 (SVG F.6.5) 후 타원 극값 각도
 * (dx/dθ=0·dy/dθ=0)가 호의 각도 스팬에 포함되는지 판정한다.
 * rx=0/ry=0(직선, F.6.6.3)·비유한수 입력은 endpoint만 흡수한다.
 */
function absorbArc(
  absorb: (px: number, py: number) => void,
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): void {
  absorb(x1, y1);
  absorb(x2, y2);
  if (rx === 0 || ry === 0) return;
  if (![rx, ry, phiDeg, largeArc, sweep, x1, y1, x2, y2].every(Number.isFinite)) return;

  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  let rxAbs = Math.abs(rx);
  let ryAbs = Math.abs(ry);
  // F.6.6.2 — 반지름 확대 보정 (lambda > 1이면 rx·ry를 비례 확대).
  const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rxAbs *= s;
    ryAbs *= s;
  }
  const denom = rxAbs * rxAbs * y1p * y1p + ryAbs * ryAbs * x1p * x1p;
  const coef = denom === 0 ? 0 : Math.sqrt(Math.max(0, (rxAbs * rxAbs * ryAbs * ryAbs - denom) / denom));
  const sign = largeArc === sweep ? -1 : 1;
  const cxp = sign * coef * ((rxAbs * y1p) / ryAbs);
  const cyp = sign * coef * ((-ryAbs * x1p) / rxAbs);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const theta1 = Math.atan2((y1p - cyp) / ryAbs, (x1p - cxp) / rxAbs);
  const theta2 = Math.atan2((-y1p - cyp) / ryAbs, (-x1p - cxp) / rxAbs);
  // F.6.5.5 — 부호 있는 각도 스팬 (sweep=1: 양의 방향, sweep=0: 음의 방향).
  const delta = sweep === 1
    ? ((theta2 - theta1) % TWO_PI + TWO_PI) % TWO_PI
    : -(((theta1 - theta2) % TWO_PI + TWO_PI) % TWO_PI);
  const onArc = (theta: number): boolean => {
    const t = ((theta - theta1) % TWO_PI + TWO_PI) % TWO_PI;
    return delta >= 0 ? t <= delta : t >= TWO_PI + delta;
  };
  const pointAt = (theta: number): { x: number; y: number } => ({
    x: cx + rxAbs * Math.cos(theta) * cosPhi - ryAbs * Math.sin(theta) * sinPhi,
    y: cy + rxAbs * Math.cos(theta) * sinPhi + ryAbs * Math.sin(theta) * cosPhi,
  });
  // 극값 후보 각도 (θ, θ+π) — dx/dθ=0·dy/dθ=0.
  const candidates = [
    Math.atan2(-ryAbs * sinPhi, rxAbs * cosPhi),
    Math.atan2(ryAbs * cosPhi, rxAbs * sinPhi),
  ];
  for (const theta of candidates) {
    for (const candidate of [theta, theta + Math.PI]) {
      if (onArc(candidate)) {
        const point = pointAt(candidate);
        absorb(point.x, point.y);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 공용 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function baseShape(
  ctx: ConvertContext,
  element: SvgElement,
  type: PenpotShapeObj["type"],
  env: ElementEnv,
  rect: { x: number; y: number; width: number; height: number },
): PenpotShapeObj {
  return {
    id: deterministicUuid(`${ctx.options.sourceId12}:${element.path}`),
    type,
    name: elementName(element, ctx, element.path, type === "text" ? "text" : "layer"),
    x: round4(rect.x),
    y: round4(rect.y),
    width: round4(rect.width),
    height: round4(rect.height),
    selrect: selrectFor(rect.x, rect.y, rect.width, rect.height),
    points: pointsFor(rect.x, rect.y, rect.width, rect.height),
    transform: IDENTITY_MATRIX,
    "transform-inverse": IDENTITY_MATRIX,
    "parent-id": env.parentId,
    "frame-id": env.frameId,
  };
}

function elementName(element: SvgElement, ctx: ConvertContext, path: string, category: "text" | "layer"): string {
  const id = element.effective["id"];
  if (id !== undefined && id !== "") return id;
  const auto = path.split("/").pop() ?? path;
  ctx.losses.push(buildLossItem({
    category,
    severity: "lossy",
    code: "dropped-property",
    path: pathOf(ctx, path),
    reason: "이름 없음 — 자동 이름 지정",
    original: { name: auto },
  }));
  return auto;
}

function rootName(root: SvgElement): string | null {
  const id = root.effective["id"];
  if (id !== undefined && id !== "") return id;
  for (const child of root.children) {
    if (child.tag === "title" && child.text.trim() !== "") return child.text.trim();
  }
  return null;
}

function reportTransform(element: SvgElement, ctx: ConvertContext): void {
  const transform = element.effective["transform"];
  if (transform === undefined) return;
  ctx.losses.push(buildLossItem({
    category: element.kind === "text" ? "text" : "layer",
    severity: "lossy",
    code: "dropped-property",
    path: pathOf(ctx, element.path),
    reason: "transform 속성 미지원 — 좌표 미변환 (원문 좌표 유지)",
    original: { transform },
  }));
}

function applyPaint(element: SvgElement, ctx: ConvertContext, shape: PenpotShapeObj): void {
  const paint = textPaint(element, ctx);
  if (paint.fills !== undefined) shape.fills = paint.fills;
  if (paint.strokes !== undefined) shape.strokes = paint.strokes;
}

function reportUnsupportedColor(ctx: ConvertContext, element: SvgElement, property: "fill" | "stroke", raw: string): void {
  ctx.losses.push(buildLossItem({
    category: "color",
    severity: "unsupported",
    code: "unsupported-category",
    path: pathOf(ctx, element.path),
    reason: `${property} "${raw}" 해석 불가 — v0.1은 hex/rgb/기본 색상 이름만 지원`,
    original: { [property]: raw },
  }));
}

function trackColor(ctx: ConvertContext, element: SvgElement, raw: string, success: boolean): void {
  const key = raw.trim();
  const existing = ctx.colorTracker.get(key);
  if (existing === undefined) {
    ctx.colorTracker.set(key, { success });
    addToSummary(ctx.summary, "colors", {
      source: 1,
      ...(success ? { imported: 1 } : { unsupported: 1 }),
    });
    return;
  }
  if (success && !existing.success) {
    // 같은 raw 값의 파싱 결과는 결정적이므로 도달하지 않는다 (방어적 보정).
    ctx.colorTracker.set(key, { success });
    addToSummary(ctx.summary, "colors", { imported: 1, unsupported: -1 });
  }
}

function pxRect(element: SvgElement, ctx: ConvertContext): { x: number; y: number; width: number; height: number } {
  const rect = {
    x: resolveLengthPx(element, ctx, "x", "x") ?? 0,
    y: resolveLengthPx(element, ctx, "y", "y") ?? 0,
    width: resolveLengthPx(element, ctx, "width", "x") ?? 0,
    height: resolveLengthPx(element, ctx, "height", "y") ?? 0,
  };
  return rectToPx(ctx.viewport, rect);
}

function lengthBase(ctx: ConvertContext, attr: string): number {
  if (attr === "font-size") return 16;
  return ctx.viewport.hasViewBox ? ctx.viewport.viewBox.width : ctx.viewport.width;
}

function resolveLengthPx(element: SvgElement, ctx: ConvertContext, attr: string, axis: "x" | "y"): number | null {
  const raw = element.effective[attr];
  if (raw === undefined) return null;
  const parsed = parseLengthToPx(raw, lengthBase(ctx, attr), axis);
  if (parsed === null) return null;
  if (parsed.unit === null || parsed.unit === "px") return parsed.value;
  if (Number.isNaN(parsed.value)) {
    ctx.losses.push(buildLossItem({
      category: element.kind === "text" ? "text" : "layer",
      severity: "unsupported",
      code: "nonstandard-unit",
      path: pathOf(ctx, element.path),
      reason: `비표준 단위 "${parsed.unit}" — ${attr} px 변환 불가`,
      original: { [attr]: raw },
    }));
    return null;
  }
  ctx.losses.push(buildLossItem({
    category: element.kind === "text" ? "text" : "layer",
    severity: "lossy",
    code: "nonstandard-unit",
    path: pathOf(ctx, element.path),
    reason: `${raw} → ${round4(parsed.value)}px (${parsed.unit} → px 정규화, 루트 16px 기준)`,
    original: { [attr]: raw },
    converted: { value: round4(parsed.value), unit: "px" },
  }));
  return parsed.value;
}

function primaryFamily(familyList: string): string {
  const first = familyList.split(",")[0]?.trim();
  return first === "" ? familyList : first;
}

const SYSTEM_FONTS = new Set([
  "arial", "helvetica", "tahoma", "verdana", "georgia", "times new roman",
  "courier new", "courier", "system-ui", "sans-serif", "serif", "monospace",
  "-apple-system", "segoe ui", "trebuchet ms", "lucida grande", "geneva",
  "garamond", "palatino", "bookman", "ms sans serif", "ms serif", "cursive",
  "fantasy", "avenir", "gill sans", "futura", "century gothic", "optima",
  "didot", "baskerville", "rockwell", "consolas", "cambria", "calibri",
  "candara", "constantia", "corbel", "franklin gothic medium", "gabriola",
  "inter",
]);

const OPEN_LICENSE_FONTS = new Set([
  "inter", "roboto", "open sans", "poppins", "montserrat", "lato",
  "source sans 3", "source sans pro", "noto sans", "noto serif", "noto sans kr",
  "work sans", "space grotesk", "jetbrains mono", "fira sans", "fira code",
  "ibm plex sans", "ibm plex mono", "dm sans", "manrope", "plus jakarta sans",
  "outfit", "archivo", "nunito", "nunito sans", "raleway", "oswald",
  "bebas neue", "playfair display", "merriweather", "crimson text",
  "libre franklin", "figtree", "urbanist", "sora", "epilogue", "fraunces",
  "instrument serif", "newsreader", "public sans", "chivo",
  "bricolage grotesque", "schibsted grotesk", "onest", "pretendard",
  "pretendard variable", "nanum gothic", "nanum myeongjo",
  "nanum square", "nanum square round", "gmarket sans", "gmarket sans ttf",
]);

type FontClassification = "system" | "open-license" | "unknown";

export function classifyFont(family: string): FontClassification {
  const key = family.trim().toLowerCase();
  if (key === "") return "unknown";
  if (SYSTEM_FONTS.has(key)) return "system";
  if (OPEN_LICENSE_FONTS.has(key)) return "open-license";
  return "unknown";
}

function selrectFor(x: number, y: number, width: number, height: number): PenpotSelrect {
  return {
    x: round4(x), y: round4(y), width: round4(width), height: round4(height),
    x1: round4(x), y1: round4(y), x2: round4(x + width), y2: round4(y + height),
  };
}

function pointsFor(x: number, y: number, width: number, height: number): Array<{ x: number; y: number }> {
  return [
    { x: round4(x), y: round4(y) },
    { x: round4(x + width), y: round4(y) },
    { x: round4(x + width), y: round4(y + height) },
    { x: round4(x), y: round4(y + height) },
  ];
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`, hex.slice(20, 32),
  ].join("-");
}

function pathOf(ctx: ConvertContext, path: string): string {
  if (ctx.options.entryPath === undefined) return path;
  return `svg://${ctx.options.entryPath}#${path.slice("svg://".length)}`;
}

function dataUriSummary(href: string): string {
  const comma = href.indexOf(",");
  const head = comma === -1 ? href : href.slice(0, comma);
  return `${head.slice(0, 64)}… (data URI, ${href.length} bytes)`;
}
