/**
 * Original, parameterized starter layouts for common publishing channels.
 *
 * The registry deliberately favours a small number of legible layouts over a
 * copied asset catalogue: callers supply their own licensed copy and imagery.
 */

import { z } from "zod";
import { autoLayoutDocument } from "./autolayout.js";
import { applyBrandKit } from "./brand-kit.js";
import {
  BrandKitSchema,
  parseDesignDocument,
  type DesignDocument,
  type DesignLayer,
  type Frame,
  type TextLayer,
} from "./document.js";
import {
  alignLayers,
  distributeLayers,
  distributeVerticalRhythm,
  stackLayers,
} from "./layout.js";
import { requireSizePreset } from "./presets.js";
import { inspectDocument, type QaReport } from "./qa.js";
import { measureTextBlock, wrapText } from "./text-metrics.js";

const FONT_FAMILY = "IBM Plex Sans KR";
const INK = "#11191D";
const PAPER = "#FFFFFF";
const MIST = "#F1F3F2";
const ACCENT = "#00A653";

const ContentSchema = z.string().trim().min(1);
const ColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be #RRGGBB");

export type TemplateInput = Record<string, unknown>;

export interface DesignTemplate {
  id: string;
  name: string;
  description: string;
  category: "blog" | "social" | "video" | "presentation";
  /** Size preset id; using the catalogue prevents channel-specific drift. */
  canvas: string;
  requiredSlots: readonly string[];
  optionalSlots: readonly string[];
  /** Strictly validates the declared slots before a layout sees their values. */
  inputSchema: z.AnyZodObject;
  /** A Korean example keeps registry-wide QA checks deterministic and useful. */
  exampleInput: TemplateInput;
  build(input: TemplateInput): DesignDocument;
}

export interface TemplateInstantiation {
  document: DesignDocument;
  qa: QaReport;
  filledSlots: string[];
}

interface TextOptions {
  fontSize: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  minFontSize?: number;
  maxLines?: number;
  color?: string;
}

function content(input: TemplateInput, name: string): string {
  const value = input[name];
  if (typeof value !== "string") throw new Error(`Template slot \"${name}\" must be a string`);
  return value.trim();
}

function optionalColor(input: TemplateInput, name: string, fallback: string): string {
  const value = input[name];
  return typeof value === "string" ? value : fallback;
}

function optionalContent(input: TemplateInput, name: string, fallback: string): string {
  const value = input[name];
  return typeof value === "string" ? value.trim() : fallback;
}

function canvasFor(presetId: string, safeMargin: number) {
  const preset = requireSizePreset(presetId);
  return {
    width: preset.width,
    height: preset.height,
    unit: preset.unit,
    safeMargin,
  };
}

/**
 * Preserve all reasonable copy by wrapping it before QA measures hard lines.
 * If an agent supplies more than a channel can responsibly display, the final
 * line is ellipsized instead of allowing clipped text to reach an export.
 */
function fitText(value: string, frame: Frame, options: TextOptions) {
  const lineHeight = options.lineHeight ?? 1.25;
  const letterSpacing = options.letterSpacing ?? 0;
  const minFontSize = options.minFontSize ?? Math.max(16, Math.round(options.fontSize * 0.55));

  for (let fontSize = options.fontSize; fontSize >= minFontSize; fontSize -= 1) {
    const wrapped = wrapText(value, { fontSize, letterSpacing, maxWidth: frame.width });
    const measurement = measureTextBlock(wrapped.lines.join("\n"), {
      fontSize,
      lineHeight,
      letterSpacing,
    });
    if (measurement.height <= frame.height) {
      return { text: wrapped.lines.join("\n"), fontSize, lineHeight, letterSpacing };
    }
  }

  const fontSize = minFontSize;
  const maxLines = options.maxLines ?? Math.max(1, Math.floor(frame.height / (fontSize * lineHeight)));
  const wrapped = wrapText(value, { fontSize, letterSpacing, maxWidth: frame.width, maxLines });
  return { text: wrapped.lines.join("\n"), fontSize, lineHeight, letterSpacing };
}

function textLayer(id: string, value: string, frame: Frame, options: TextOptions): TextLayer {
  const fitted = fitText(value, frame, options);
  return {
    id,
    type: "text" as const,
    frame,
    text: fitted.text,
    fontFamily: FONT_FAMILY,
    fontSize: fitted.fontSize,
    fontWeight: options.fontWeight ?? 400,
    color: options.color ?? INK,
    opacity: 1,
    align: "start",
    lineHeight: fitted.lineHeight,
    letterSpacing: fitted.letterSpacing,
  };
}

function rectLayer(id: string, frame: Frame, fill: string): Extract<DesignLayer, { type: "rect" }> {
  return { id, type: "rect", frame, fill, opacity: 1, radius: 0 };
}

function imageLayer(id: string, frame: Frame, source: string): Extract<DesignLayer, { type: "image" }> {
  return { id, type: "image", frame, source, fit: "cover", opacity: 1 };
}

/**
 * Keep the closing marker in the declared slot model so the lower canvas has
 * editorial intent without baking a campaign-specific string into the layout.
 */
function cardPage(input: TemplateInput, id: string, name: string, background: string, footer: string) {
  const accent = optionalColor(input, "accentColor", ACCENT);
  return {
    id,
    name,
    background,
    layers: [
      { id: "accent-bar", type: "rect", frame: { x: 80, y: 144, width: 96, height: 12 }, fill: accent },
      textLayer("eyebrow", content(input, "eyebrow"), { x: 80, y: 192, width: 920, height: 56 }, {
        fontSize: 30, fontWeight: 600, letterSpacing: 1,
      }),
      textLayer("headline", content(input, "headline"), { x: 80, y: 336, width: 920, height: 390 }, {
        fontSize: 112, fontWeight: 600, lineHeight: 1.18, letterSpacing: -3, minFontSize: 48,
      }),
      textLayer("body", content(input, "body"), { x: 80, y: 874, width: 920, height: 210 }, {
        fontSize: 40, lineHeight: 1.42, minFontSize: 24,
      }),
      { id: "footer-rule", type: "rect", frame: { x: 80, y: 1184, width: 920, height: 2 }, fill: accent },
      textLayer("footer", footer, { x: 80, y: 1218, width: 920, height: 48 }, {
        fontSize: 24, fontWeight: 600, letterSpacing: 1.2,
      }),
    ],
  };
}

function cardTemplate(
  id: "card-news-cover" | "card-news-slide",
  name: string,
  description: string,
  background: string,
): DesignTemplate {
  const inputSchema = z.object({
    eyebrow: ContentSchema,
    headline: ContentSchema,
    body: ContentSchema,
    footer: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict();
  return {
    id,
    name,
    description,
    category: "social",
    canvas: "instagram-portrait",
    requiredSlots: ["eyebrow", "headline", "body"],
    optionalSlots: ["footer", "accentColor", "brandKit"],
    inputSchema,
    exampleInput: {
      eyebrow: id === "card-news-cover" ? "SEVASA 에너지 노트" : "01 시간대 요금",
      headline: id === "card-news-cover" ? "충전비\n줄이는 법" : "경부하 시간에\n충전하기",
      body: "같은 전력량이라도 충전 시간대에 따라\n월 요금이 달라집니다.",
      footer: id === "card-news-cover" ? "SEVASA / ENERGY NOTE" : "SEVASA / 01",
      accentColor: ACCENT,
    },
    build(input) {
      const footer = optionalContent(
        input,
        "footer",
        id === "card-news-cover" ? "SEVASA / ENERGY NOTE" : "SEVASA / 01",
      );
      return parseDesignDocument({
        id,
        title: name,
        canvas: canvasFor("instagram-portrait", 64),
        pages: [cardPage(input, id === "card-news-cover" ? "cover" : "slide", name, background, footer)],
      });
    },
  };
}

const naverBlogThumbnail: DesignTemplate = {
  id: "naver-blog-thumbnail",
  name: "네이버 블로그 썸네일",
  description: "한 장면, 한 문구를 104px 목록에서도 읽히게 하는 사진형 썸네일입니다.",
  category: "blog",
  canvas: "naver-blog-thumbnail",
  requiredSlots: ["hook", "imageSource"],
  optionalSlots: ["bandColor", "accentColor", "brandKit"],
  inputSchema: z.object({
    hook: ContentSchema,
    imageSource: ContentSchema,
    bandColor: ColorSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    hook: "충전비 줄이는 법",
    imageSource: "experiments/company-promo-naver-v3/assets/backgrounds/sevasa.jpg",
    bandColor: INK,
    accentColor: ACCENT,
  },
  build(input) {
    const bandColor = optionalColor(input, "bandColor", INK);
    const accent = optionalColor(input, "accentColor", ACCENT);
    return parseDesignDocument({
      id: "naver-blog-thumbnail",
      title: "네이버 블로그 썸네일",
      // The photo must fill the canvas; the text band itself retains the v3 48px inset.
      canvas: canvasFor("naver-blog-thumbnail", 0),
      pages: [{
        id: "thumbnail",
        name: "썸네일",
        background: PAPER,
        layers: [
          { id: "photo", type: "image", frame: { x: 0, y: 0, width: 800, height: 800 }, source: content(input, "imageSource"), fit: "cover" },
          { id: "text-band", type: "rect", frame: { x: 36, y: 480, width: 728, height: 136 }, fill: bandColor },
          { id: "accent-rule", type: "rect", frame: { x: 36, y: 480, width: 92, height: 8 }, fill: accent },
          textLayer("hook", content(input, "hook"), { x: 72, y: 508, width: 656, height: 84 }, {
            fontSize: 96, minFontSize: 80, maxLines: 1, fontWeight: 600, lineHeight: 1, color: PAPER,
          }),
        ],
      }],
    });
  },
};

const youtubeThumbnail: DesignTemplate = {
  id: "youtube-thumbnail",
  name: "유튜브 썸네일",
  description: "작은 화면에서도 한 개의 강한 훅이 남는 고대비 영상 썸네일입니다.",
  category: "video",
  canvas: "youtube-thumbnail",
  requiredSlots: ["hook"],
  optionalSlots: ["eyebrow", "footer", "accentColor", "brandKit"],
  inputSchema: z.object({
    hook: ContentSchema,
    eyebrow: ContentSchema.optional(),
    footer: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    hook: "충전비, 절반으로", eyebrow: "SEVASA 실험실", footer: "SEVASA / WATCH NOW", accentColor: ACCENT,
  },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const eyebrow = optionalContent(input, "eyebrow", "현장 리포트");
    const footer = optionalContent(input, "footer", "SEVASA / WATCH NOW");
    return parseDesignDocument({
      id: "youtube-thumbnail",
      title: "유튜브 썸네일",
      canvas: canvasFor("youtube-thumbnail", 48),
      pages: [{
        id: "thumbnail",
        name: "썸네일",
        background: INK,
        layers: [
          { id: "accent-rail", type: "rect", frame: { x: 72, y: 72, width: 14, height: 576 }, fill: accent },
          textLayer("eyebrow", eyebrow, { x: 120, y: 104, width: 1088, height: 58 }, {
            fontSize: 32, fontWeight: 600, letterSpacing: 1.2, color: PAPER,
          }),
          textLayer("hook", content(input, "hook"), { x: 120, y: 224, width: 1038, height: 330 }, {
            fontSize: 164, minFontSize: 68, fontWeight: 600, lineHeight: 1.04, letterSpacing: -4, color: PAPER,
          }),
          { id: "footer-rule", type: "rect", frame: { x: 120, y: 612, width: 1038, height: 2 }, fill: accent },
          textLayer("footer", footer, { x: 120, y: 634, width: 1038, height: 34 }, {
            fontSize: 20, fontWeight: 600, letterSpacing: 1.1, color: PAPER,
          }),
        ],
      }],
    });
  },
};

const instagramStory: DesignTemplate = {
  id: "instagram-story",
  name: "인스타그램 스토리",
  description: "상하 UI 여백을 보장하는 세로형 안내 카드입니다.",
  category: "social",
  canvas: "instagram-story",
  requiredSlots: ["eyebrow", "headline", "body"],
  optionalSlots: ["footer", "accentColor", "brandKit"],
  inputSchema: z.object({
    eyebrow: ContentSchema,
    headline: ContentSchema,
    body: ContentSchema,
    footer: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    eyebrow: "SEVASA 에너지 노트",
    headline: "오늘 밤\n충전하기",
    body: "경부하 시간대를 확인하면\n다음 달 요금을 줄일 수 있습니다.",
    footer: "SEVASA / ENERGY NOTE",
    accentColor: ACCENT,
  },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const footer = optionalContent(input, "footer", "SEVASA / ENERGY NOTE");
    return parseDesignDocument({
      id: "instagram-story",
      title: "인스타그램 스토리",
      canvas: canvasFor("instagram-story", 72),
      pages: [{
        id: "story",
        name: "스토리",
        background: MIST,
        layers: [
          { id: "accent-bar", type: "rect", frame: { x: 88, y: 276, width: 96, height: 12 }, fill: accent },
          textLayer("eyebrow", content(input, "eyebrow"), { x: 88, y: 328, width: 904, height: 60 }, {
            fontSize: 32, fontWeight: 600, letterSpacing: 1,
          }),
          textLayer("headline", content(input, "headline"), { x: 88, y: 626, width: 904, height: 510 }, {
            fontSize: 126, minFontSize: 52, fontWeight: 600, lineHeight: 1.16, letterSpacing: -3,
          }),
          textLayer("body", content(input, "body"), { x: 88, y: 1326, width: 904, height: 244 }, {
            fontSize: 44, minFontSize: 24, lineHeight: 1.45,
          }),
          { id: "footer-rule", type: "rect", frame: { x: 88, y: 1652, width: 904, height: 2 }, fill: accent },
          textLayer("footer", footer, { x: 88, y: 1690, width: 904, height: 48 }, {
            fontSize: 24, fontWeight: 600, letterSpacing: 1.2,
          }),
        ],
      }],
    });
  },
};

const presentationTitle: DesignTemplate = {
  id: "presentation-title",
  name: "프레젠테이션 제목",
  description: "절제된 제목·부제·발표자 정보로 시작하는 16:9 표지입니다.",
  category: "presentation",
  canvas: "presentation-16-9",
  requiredSlots: ["headline", "body"],
  optionalSlots: ["eyebrow", "accentColor", "brandKit"],
  inputSchema: z.object({
    headline: ContentSchema,
    body: ContentSchema,
    eyebrow: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: { headline: "충전 운영의\n다음 기준", body: "SEVASA 에너지 운영 리포트 · 2026", eyebrow: "FIELD REPORT", accentColor: ACCENT },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const eyebrow = typeof input.eyebrow === "string" ? input.eyebrow : "PRESENTATION";
    return parseDesignDocument({
      id: "presentation-title",
      title: "프레젠테이션 제목",
      canvas: canvasFor("presentation-16-9", 96),
      pages: [{
        id: "title",
        name: "표지",
        background: PAPER,
        layers: [
          { id: "accent-rule", type: "rect", frame: { x: 144, y: 242, width: 148, height: 16 }, fill: accent },
          textLayer("eyebrow", eyebrow, { x: 144, y: 310, width: 1632, height: 72 }, {
            fontSize: 38, fontWeight: 600, letterSpacing: 2,
          }),
          textLayer("headline", content(input, "headline"), { x: 144, y: 490, width: 1450, height: 390 }, {
            fontSize: 164, minFontSize: 64, fontWeight: 600, lineHeight: 1.12, letterSpacing: -4,
          }),
          textLayer("body", content(input, "body"), { x: 144, y: 900, width: 1632, height: 84 }, {
            fontSize: 38, minFontSize: 24, lineHeight: 1.35,
          }),
        ],
      }],
    });
  },
};

/**
 * End a card-news sequence with a single takeaway and an unmissable next step,
 * rather than leaving a useful series without a conversion moment.
 */
const cardNewsClosing: DesignTemplate = {
  id: "card-news-closing",
  name: "카드뉴스 마무리",
  description: "핵심 요약과 다음 행동을 함께 제시해 카드뉴스를 자연스럽게 닫는 마지막 장입니다.",
  category: "social",
  canvas: "instagram-portrait",
  requiredSlots: ["headline", "summary", "cta"],
  optionalSlots: ["eyebrow", "footer", "accentColor", "brandKit"],
  inputSchema: z.object({
    headline: ContentSchema,
    summary: ContentSchema,
    cta: ContentSchema,
    eyebrow: ContentSchema.optional(),
    footer: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    eyebrow: "SEVASA 에너지 노트",
    headline: "오늘의 기준을\n운영에 적용하세요",
    summary: "예약·요금·점검 데이터를 같은 화면에서 보면 다음 주의 운영 결정을 더 빨리 내릴 수 있습니다.",
    cta: "운영 진단 받기 →",
    footer: "SEVASA / ENERGY NOTE",
    accentColor: ACCENT,
  },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const layers: DesignLayer[] = [
      rectLayer("accent-bar", { x: 64, y: 0, width: 132, height: 14 }, accent),
      textLayer("eyebrow", optionalContent(input, "eyebrow", "KEY TAKEAWAY"), { x: 64, y: 0, width: 952, height: 48 }, {
        fontSize: 28, minFontSize: 18, fontWeight: 600, letterSpacing: 1.3, color: PAPER,
      }),
      textLayer("headline", content(input, "headline"), { x: 64, y: 0, width: 850, height: 330 }, {
        fontSize: 106, minFontSize: 48, maxLines: 4, fontWeight: 600, lineHeight: 1.12, letterSpacing: -3, color: PAPER,
      }),
      textLayer("summary", content(input, "summary"), { x: 64, y: 0, width: 840, height: 170 }, {
        fontSize: 38, minFontSize: 23, maxLines: 4, lineHeight: 1.45, color: MIST,
      }),
      rectLayer("cta-rule", { x: 64, y: 0, width: 952, height: 2 }, accent),
      textLayer("cta", content(input, "cta"), { x: 64, y: 0, width: 952, height: 54 }, {
        fontSize: 32, minFontSize: 20, maxLines: 1, fontWeight: 600, letterSpacing: 0.4, color: PAPER,
      }),
      textLayer("footer", optionalContent(input, "footer", "SEVASA / FOLLOW UP"), { x: 64, y: 0, width: 952, height: 36 }, {
        fontSize: 20, minFontSize: 16, maxLines: 1, fontWeight: 600, letterSpacing: 1.2, color: MIST,
      }),
    ];
    const placed = distributeVerticalRhythm(layers, { x: 0, y: 0, width: 1080, height: 1350 }, {
      safeMargin: 64,
      anchors: ["top", "top", "upper-middle", "remaining-space", "bottom", "bottom", "bottom"],
    });

    return parseDesignDocument({
      id: "card-news-closing",
      title: "카드뉴스 마무리",
      canvas: canvasFor("instagram-portrait", 64),
      pages: [{ id: "closing", name: "마무리", background: INK, layers: placed }],
    });
  },
};

/**
 * Make the opening route through a B2B presentation legible at a glance, so
 * speakers can establish a shared map before introducing detailed content.
 */
const presentationAgenda: DesignTemplate = {
  id: "presentation-agenda",
  name: "프레젠테이션 아젠다",
  description: "번호와 얇은 규칙으로 발표의 네 구간을 빠르게 훑게 하는 16:9 아젠다 슬라이드입니다.",
  category: "presentation",
  canvas: "presentation-16-9",
  requiredSlots: ["title", "item1", "item2", "item3"],
  optionalSlots: ["item4", "eyebrow", "accentColor", "brandKit"],
  inputSchema: z.object({
    title: ContentSchema,
    item1: ContentSchema,
    item2: ContentSchema,
    item3: ContentSchema,
    item4: ContentSchema.optional(),
    eyebrow: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    eyebrow: "2026 H2 BUSINESS REVIEW",
    title: "오늘 이야기할 네 가지",
    item1: "시장과 고객의 변화",
    item2: "운영 데이터에서 찾은 기회",
    item3: "다음 분기의 실행 기준",
    item4: "팀이 바로 시작할 일",
    accentColor: ACCENT,
  },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const title = alignLayers([
      textLayer("title", content(input, "title"), { x: 0, y: 204, width: 1240, height: 120 }, {
        fontSize: 86, minFontSize: 42, maxLines: 2, fontWeight: 600, lineHeight: 1.12, letterSpacing: -2,
      }),
    ], { x: 0, y: 0, width: 1920, height: 1080 }, { horizontal: "center" })[0];
    const items = [
      content(input, "item1"),
      content(input, "item2"),
      content(input, "item3"),
      optionalContent(input, "item4", "다음 실행 계획"),
    ];
    const rowText = distributeLayers(items.map((item, index) => textLayer(
      `item-${index + 1}`,
      item,
      { x: 510, y: 0, width: 1110, height: 72 },
      { fontSize: 46, minFontSize: 25, maxLines: 2, fontWeight: 600, lineHeight: 1.18, letterSpacing: -0.8 },
    )), { x: 0, y: 438, width: 1920, height: 382 }, { axis: "y", mode: "space-around" });
    const rows = rowText.flatMap((row, index) => [
      textLayer(`number-${index + 1}`, `0${index + 1}`, { x: 292, y: row.frame.y, width: 128, height: 58 }, {
        fontSize: 28, minFontSize: 20, fontWeight: 600, letterSpacing: 1.2,
      }),
      rectLayer(`row-rule-${index + 1}`, { x: 458, y: row.frame.y + 34, width: 24, height: 2 }, accent),
      row,
    ]);

    return parseDesignDocument({
      id: "presentation-agenda",
      title: "프레젠테이션 아젠다",
      canvas: canvasFor("presentation-16-9", 96),
      pages: [{
        id: "agenda",
        name: "아젠다",
        background: PAPER,
        layers: [
          rectLayer("accent-rule", { x: 144, y: 114, width: 156, height: 14 }, accent),
          textLayer("eyebrow", optionalContent(input, "eyebrow", "AGENDA"), { x: 144, y: 150, width: 1632, height: 44 }, {
            fontSize: 26, minFontSize: 18, fontWeight: 600, letterSpacing: 1.5,
          }),
          title,
          ...rows,
          rectLayer("footer-rule", { x: 292, y: 916, width: 1328, height: 2 }, INK),
        ],
      }],
    });
  },
};

/**
 * Give the most common B2B proof point its own slide: one large number, its
 * meaning, and enough context for the audience to trust the claim.
 */
const presentationMetric: DesignTemplate = {
  id: "presentation-metric",
  name: "프레젠테이션 핵심 지표",
  description: "큰 수치와 짧은 해석을 분리해 성과 근거를 또렷하게 전달하는 16:9 지표 슬라이드입니다.",
  category: "presentation",
  canvas: "presentation-16-9",
  requiredSlots: ["metric", "label", "context"],
  optionalSlots: ["eyebrow", "footer", "accentColor", "brandKit"],
  inputSchema: z.object({
    metric: ContentSchema,
    label: ContentSchema,
    context: ContentSchema,
    eyebrow: ContentSchema.optional(),
    footer: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    eyebrow: "OPERATIONAL IMPACT",
    metric: "38%",
    label: "예약 전환율 상승",
    context: "예약 가능 시간을 먼저 보여준 충전소에서 8주 동안 확인한 평균 변화입니다.",
    footer: "SEVASA 운영 데이터 · 2026.08",
    accentColor: ACCENT,
  },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const metricStack = stackLayers([
      textLayer("metric", content(input, "metric"), { x: 216, y: 0, width: 1250, height: 270 }, {
        fontSize: 250, minFontSize: 60, maxLines: 4, fontWeight: 600, lineHeight: 0.94, letterSpacing: -8,
      }),
      textLayer("label", content(input, "label"), { x: 216, y: 0, width: 1040, height: 88 }, {
        fontSize: 52, minFontSize: 28, maxLines: 2, fontWeight: 600, lineHeight: 1.2, letterSpacing: -1,
      }),
      /**
       * Three full-size Korean lines need more than the old 150px frame once
       * rasterizer line boxes are considered; this reserve prevents a
       * numerically passing context block from looking clipped in export.
       */
      textLayer("context", content(input, "context"), { x: 216, y: 0, width: 940, height: 204 }, {
        fontSize: 34, minFontSize: 21, maxLines: 4, lineHeight: 1.45,
      }),
    ], {
      origin: { x: 216, y: 294 },
      axis: "y",
      gap: 42,
      container: { x: 0, y: 0, width: 1920, height: 1080 },
      safeMargin: 96,
    });

    return parseDesignDocument({
      id: "presentation-metric",
      title: "프레젠테이션 핵심 지표",
      canvas: canvasFor("presentation-16-9", 96),
      pages: [{
        id: "metric",
        name: "핵심 지표",
        background: MIST,
        layers: [
          rectLayer("accent-rail", { x: 144, y: 144, width: 14, height: 792 }, accent),
          textLayer("eyebrow", optionalContent(input, "eyebrow", "KEY METRIC"), { x: 216, y: 152, width: 1460, height: 44 }, {
            fontSize: 26, minFontSize: 18, fontWeight: 600, letterSpacing: 1.5,
          }),
          ...metricStack,
          rectLayer("footer-rule", { x: 216, y: 908, width: 1460, height: 2 }, accent),
          textLayer("footer", optionalContent(input, "footer", "INTERNAL REVIEW · 2026"), { x: 216, y: 934, width: 1460, height: 36 }, {
            fontSize: 20, minFontSize: 16, maxLines: 1, fontWeight: 600, letterSpacing: 1.1,
          }),
        ],
      }],
    });
  },
};

/**
 * Turn a customer or founder statement into a shareable square without
 * diluting the words with decorative effects or a generic quotation card.
 */
const instagramSquareQuote: DesignTemplate = {
  id: "instagram-square-quote",
  name: "인스타그램 정사각 인용",
  description: "인용문과 출처에 시선을 모으는 정방형 소셜 포스트입니다.",
  category: "social",
  canvas: "instagram-square",
  requiredSlots: ["quote", "attribution"],
  optionalSlots: ["role", "eyebrow", "accentColor", "brandKit"],
  inputSchema: z.object({
    quote: ContentSchema,
    attribution: ContentSchema,
    role: ContentSchema.optional(),
    eyebrow: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    eyebrow: "PARTNER VOICE",
    quote: "좋은 운영은 고객에게\n기다림을 설명하지 않습니다.",
    attribution: "김은서",
    role: "SEVASA 파트너 운영 리드",
    accentColor: ACCENT,
  },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const centred = alignLayers(stackLayers([
      textLayer("quote-mark", "“", { x: 0, y: 0, width: 820, height: 156 }, {
        fontSize: 176, minFontSize: 100, fontWeight: 600, lineHeight: 0.9, color: INK,
      }),
      textLayer("quote", content(input, "quote"), { x: 0, y: 0, width: 820, height: 390 }, {
        fontSize: 78, minFontSize: 34, maxLines: 6, fontWeight: 600, lineHeight: 1.22, letterSpacing: -2, color: INK,
      }),
      textLayer("attribution", content(input, "attribution"), { x: 0, y: 0, width: 820, height: 52 }, {
        fontSize: 30, minFontSize: 20, maxLines: 1, fontWeight: 600, letterSpacing: 0.3,
      }),
      textLayer("role", optionalContent(input, "role", "INTERVIEWEE"), { x: 0, y: 0, width: 820, height: 38 }, {
        fontSize: 21, minFontSize: 16, maxLines: 1, letterSpacing: 0.6,
      }),
    ], {
      origin: { x: 130, y: 142 },
      axis: "y",
      gap: 24,
      container: { x: 0, y: 0, width: 1080, height: 1080 },
      safeMargin: 72,
    }), { x: 0, y: 0, width: 1080, height: 1080 }, { horizontal: "center" });

    return parseDesignDocument({
      id: "instagram-square-quote",
      title: "인스타그램 정사각 인용",
      canvas: canvasFor("instagram-square", 72),
      pages: [{
        id: "quote",
        name: "인용",
        background: MIST,
        layers: [
          textLayer("eyebrow", optionalContent(input, "eyebrow", "FIELD NOTE"), { x: 130, y: 82, width: 820, height: 36 }, {
            fontSize: 20, minFontSize: 16, fontWeight: 600, letterSpacing: 1.2, color: INK,
          }),
          ...centred,
          rectLayer("footer-rule", { x: 130, y: 942, width: 820, height: 2 }, accent),
        ],
      }],
    });
  },
};

/**
 * Pair an owned image with an opaque editorial panel so a long-form article
 * has a recognisable 16:9 entry image while every word stays readable.
 */
const blogHeader: DesignTemplate = {
  id: "blog-header",
  name: "블로그 아티클 헤더",
  description: "사진과 확실한 제목 패널을 나란히 두는 네이버 블로그 공유용 16:9 헤더입니다.",
  category: "blog",
  canvas: "naver-blog-share",
  requiredSlots: ["headline", "imageSource"],
  optionalSlots: ["category", "byline", "accentColor", "panelColor", "brandKit"],
  inputSchema: z.object({
    headline: ContentSchema,
    imageSource: ContentSchema,
    category: ContentSchema.optional(),
    byline: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    panelColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    headline: "작은 팀이\n반복 가능한 콘텐츠를 만드는 법",
    imageSource: "experiments/company-promo-naver-v3/assets/backgrounds/sevasa.jpg",
    category: "CREATOR OPERATIONS",
    byline: "SEVASA 인사이트 팀 · 2026.08",
    accentColor: ACCENT,
    panelColor: PAPER,
  },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const panelColor = optionalColor(input, "panelColor", PAPER);
    const copy = stackLayers([
      textLayer("category", optionalContent(input, "category", "ARTICLE NOTE"), { x: 80, y: 0, width: 500, height: 34 }, {
        fontSize: 20, minFontSize: 16, fontWeight: 600, letterSpacing: 1.1,
      }),
      textLayer("headline", content(input, "headline"), { x: 80, y: 0, width: 500, height: 300 }, {
        fontSize: 62, minFontSize: 29, maxLines: 6, fontWeight: 600, lineHeight: 1.14, letterSpacing: -1.8,
      }),
      textLayer("byline", optionalContent(input, "byline", "TEGUMA EDITORIAL"), { x: 80, y: 0, width: 500, height: 54 }, {
        fontSize: 20, minFontSize: 16, maxLines: 2, lineHeight: 1.35, letterSpacing: 0.2,
      }),
    ], {
      origin: { x: 80, y: 116 },
      axis: "y",
      gap: 28,
      container: { x: 0, y: 0, width: 660, height: 675 },
    });

    return parseDesignDocument({
      id: "blog-header",
      title: "블로그 아티클 헤더",
      canvas: canvasFor("naver-blog-share", 0),
      pages: [{
        id: "header",
        name: "헤더",
        background: PAPER,
        layers: [
          imageLayer("photo", { x: 0, y: 0, width: 1200, height: 675 }, content(input, "imageSource")),
          rectLayer("copy-panel", { x: 0, y: 0, width: 660, height: 675 }, panelColor),
          rectLayer("accent-rail", { x: 48, y: 116, width: 12, height: 416 }, accent),
          ...copy,
          rectLayer("panel-footer-rule", { x: 80, y: 560, width: 500, height: 2 }, accent),
        ],
      }],
    });
  },
};

/**
 * Consolidate the four details people look for in an event notice into a
 * poster-like hierarchy: invitation first, logistics in a firm lower band.
 */
const eventNotice: DesignTemplate = {
  id: "event-notice",
  name: "이벤트 안내 포스터",
  description: "행사 제목과 일시·시간·장소를 한 장에서 바로 확인하게 하는 세로형 공지 포스터입니다.",
  category: "social",
  canvas: "instagram-portrait",
  requiredSlots: ["headline", "date", "time", "place"],
  optionalSlots: ["eyebrow", "cta", "accentColor", "brandKit"],
  inputSchema: z.object({
    headline: ContentSchema,
    date: ContentSchema,
    time: ContentSchema,
    place: ContentSchema,
    eyebrow: ContentSchema.optional(),
    cta: ContentSchema.optional(),
    accentColor: ColorSchema.optional(),
    brandKit: BrandKitSchema.optional(),
  }).strict(),
  exampleInput: {
    eyebrow: "SEVASA OPEN SESSION",
    headline: "현장 운영자를 위한\n데이터 활용 워크숍",
    date: "2026. 08. 21. THU",
    time: "14:00–16:00",
    place: "성수 스테이션 3F",
    cta: "사전 신청은 프로필 링크에서",
    accentColor: ACCENT,
  },
  build(input) {
    const accent = optionalColor(input, "accentColor", ACCENT);
    const details = distributeLayers([
      textLayer("time", content(input, "time"), { x: 96, y: 1074, width: 340, height: 64 }, {
        fontSize: 30, minFontSize: 18, maxLines: 2, fontWeight: 600, lineHeight: 1.2, color: PAPER,
      }),
      textLayer("place", content(input, "place"), { x: 644, y: 1074, width: 340, height: 64 }, {
        fontSize: 30, minFontSize: 18, maxLines: 2, fontWeight: 600, lineHeight: 1.2, color: PAPER,
      }),
    ], { x: 96, y: 1074, width: 856, height: 64 }, { axis: "x", mode: "space-between" });
    /**
     * Captions inherit distributed value frames so a later column-width or
     * gutter change cannot leave labels visually detached from their values.
     */
    const detailCaptions = details.map((detail) => textLayer(
      `${detail.id}-caption`,
      detail.id === "time" ? "TIME" : "PLACE",
      { x: detail.frame.x, y: 1204, width: detail.frame.width, height: 24 },
      {
        fontSize: 15, minFontSize: 14, maxLines: 1, fontWeight: 600, letterSpacing: 1.3, color: MIST,
      },
    ));

    return parseDesignDocument({
      id: "event-notice",
      title: "이벤트 안내 포스터",
      canvas: canvasFor("instagram-portrait", 64),
      pages: [{
        id: "notice",
        name: "이벤트 안내",
        background: MIST,
        layers: [
          rectLayer("accent-rail", { x: 0, y: 0, width: 32, height: 1350 }, accent),
          textLayer("eyebrow", optionalContent(input, "eyebrow", "EVENT NOTICE"), { x: 96, y: 128, width: 888, height: 44 }, {
            fontSize: 25, minFontSize: 18, fontWeight: 600, letterSpacing: 1.3,
          }),
          textLayer("headline", content(input, "headline"), { x: 96, y: 322, width: 840, height: 440 }, {
            fontSize: 88, minFontSize: 38, maxLines: 6, fontWeight: 600, lineHeight: 1.14, letterSpacing: -2.5,
          }),
          rectLayer("headline-rule", { x: 96, y: 876, width: 888, height: 2 }, INK),
          textLayer("cta", optionalContent(input, "cta", "참여 신청은 공식 채널에서"), { x: 96, y: 912, width: 888, height: 44 }, {
            fontSize: 23, minFontSize: 17, maxLines: 1, letterSpacing: 0.3,
          }),
          rectLayer("details-band", { x: 64, y: 1010, width: 952, height: 252 }, INK),
          textLayer("date", content(input, "date"), { x: 96, y: 1034, width: 856, height: 34 }, {
            fontSize: 21, minFontSize: 16, maxLines: 1, fontWeight: 600, letterSpacing: 1.1, color: PAPER,
          }),
          ...details,
          rectLayer("details-rule", { x: 96, y: 1172, width: 856, height: 1 }, accent),
          ...detailCaptions,
        ],
      }],
    });
  },
};

export const DESIGN_TEMPLATES: readonly DesignTemplate[] = [
  naverBlogThumbnail,
  cardTemplate("card-news-cover", "카드뉴스 표지", "악센트 바와 큰 제목으로 주제를 빠르게 전달하는 카드뉴스 표지입니다.", PAPER),
  cardTemplate("card-news-slide", "카드뉴스 본문", "같은 그리드에서 핵심 한 가지를 설명하는 카드뉴스 본문입니다.", MIST),
  cardNewsClosing,
  youtubeThumbnail,
  instagramStory,
  presentationTitle,
  presentationAgenda,
  presentationMetric,
  instagramSquareQuote,
  blogHeader,
  eventNotice,
];

export function listTemplates(category?: DesignTemplate["category"]): DesignTemplate[] {
  return category ? DESIGN_TEMPLATES.filter((template) => template.category === category) : [...DESIGN_TEMPLATES];
}

export function findTemplate(id: string): DesignTemplate | undefined {
  return DESIGN_TEMPLATES.find((template) => template.id === id);
}

export function requireTemplate(id: string): DesignTemplate {
  const template = findTemplate(id);
  if (template) return template;
  throw new Error(`Unknown design template: ${id}. Available: ${DESIGN_TEMPLATES.map((item) => item.id).join(", ")}`);
}

/** Validate first so build functions never need to make policy decisions about unknown slots. */
export function instantiateTemplate(templateId: string, input: unknown): TemplateInstantiation {
  const template = requireTemplate(templateId);
  const parsed = template.inputSchema.parse(input) as TemplateInput;
  const branded = applyBrandKit(template.build(parsed), parsed.brandKit as DesignDocument["brandKit"]);
  const document = autoLayoutDocument(branded).document;
  const qa = inspectDocument(document);
  return { document, qa, filledSlots: Object.keys(parsed) };
}
