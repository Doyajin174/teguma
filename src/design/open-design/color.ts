/**
 * SVG 색상 값 해석 (8장 — 색상 보존 규칙).
 *
 * 지원: #rgb · #rrggbb · #rrggbbaa · rgb()/rgba()(숫자·%) · 기본 색상 이름.
 * hex 외 표현은 해석 시도 후 실패 시 null (변환기가 unsupported 보고).
 * currentColor·var()·url(#gradient) 등은 null.
 */

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", silver: "#c0c0c0", gray: "#808080", grey: "#808080",
  white: "#ffffff", maroon: "#800000", red: "#ff0000", purple: "#800080",
  fuchsia: "#ff00ff", green: "#008000", lime: "#00ff00", olive: "#808000",
  yellow: "#ffff00", navy: "#000080", blue: "#0000ff", teal: "#008080",
  aqua: "#00ffff", orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a",
  gold: "#ffd700", cyan: "#00ffff", magenta: "#ff00ff", indigo: "#4b0082",
  violet: "#ee82ee", crimson: "#dc143c", coral: "#ff7f50", salmon: "#fa8072",
  tomato: "#ff6347", orchid: "#da70d6", plum: "#dda0dd", beige: "#f5f5dc",
  ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa", mint: "#f5fffa",
  turquoise: "#40e0d0", slate: "#708090", steel: "#4682b4", sky: "#87ceeb",
  midnight: "#191970", navyblue: "#000080", "darkgray": "#a9a9a9",
  "darkgrey": "#a9a9a9", "lightgray": "#d3d3d3", "lightgrey": "#d3d3d3",
};

export interface ParsedColor {
  /** #rrggbb (소문자). */
  hex: string;
  /** 0..1. */
  alpha: number;
}

const HEX6_RE = /^#([0-9a-fA-F]{6})$/;
const HEX3_RE = /^#([0-9a-fA-F]{3})$/;
const HEX8_RE = /^#([0-9a-fA-F]{8})$/;

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * SVG 색상 문자열 → 정규 hex+alpha. 해석 불가 시 null.
 * "none"·"transparent"는 null과 구분해 반환 타입으로 처리한다 (호출자가 fill 유무 판단).
 */
export function parseSvgColor(raw: string | undefined): ParsedColor | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (text === "" || text === "none" || text === "transparent") return null;

  const hex8 = HEX8_RE.exec(text);
  if (hex8 !== null) {
    const hex = hex8[1].slice(0, 6).toLowerCase();
    const alpha = Number.parseInt(hex8[1].slice(6, 8), 16) / 255;
    return { hex: `#${hex}`, alpha };
  }
  const hex6 = HEX6_RE.exec(text);
  if (hex6 !== null) return { hex: `#${hex6[1].toLowerCase()}`, alpha: 1 };
  const hex3 = HEX3_RE.exec(text);
  if (hex3 !== null) {
    const [r, g, b] = hex3[1].split("").map((c) => `${c}${c}`);
    return { hex: `#${(r + g + b).toLowerCase()}`, alpha: 1 };
  }

  const named = NAMED_COLORS[text.toLowerCase()];
  if (named !== undefined) return { hex: named, alpha: 1 };

  const func = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(text);
  if (func !== null) {
    const parsed = parseColorFunction(func[1].toLowerCase(), func[2]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseColorFunction(name: string, body: string): ParsedColor | null {
  if (name === "rgb" || name === "rgba") {
    const parts = body.split(/[\s,]+/).filter((part) => part !== "").map((part) => part.trim());
    if (parts.length < 3 || parts.length > 4) return null;
    const channel = (part: string): number => {
      if (part.endsWith("%")) return clampChannel((Number.parseFloat(part) / 100) * 255);
      return clampChannel(Number.parseFloat(part));
    };
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if (![r, g, b].every(Number.isFinite)) return null;
    let alpha = 1;
    if (parts.length === 4) {
      const rawAlpha = Number.parseFloat(parts[3]);
      if (!Number.isFinite(rawAlpha)) return null;
      alpha = Math.max(0, Math.min(1, rawAlpha));
    }
    const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    return { hex, alpha };
  }
  // hsl() — v0.1 해석 시도 후 실패 시 null (unsupported 보고).
  const parts = body.split(/[\s,]+/).filter((part) => part !== "").map((part) => part.trim());
  if (parts.length < 3 || parts.length > 4) return null;
  const h = Number.parseFloat(parts[0]);
  const s = Number.parseFloat(parts[1]) / 100;
  const l = Number.parseFloat(parts[2]) / 100;
  if (![h, s, l].every(Number.isFinite) || s < 0 || s > 1 || l < 0 || l > 1) return null;
  const rgb = hslToRgb(((h % 360) + 360) % 360, s, l);
  let alpha = 1;
  if (parts.length === 4) {
    const rawAlpha = Number.parseFloat(parts[3]);
    if (!Number.isFinite(rawAlpha)) return null;
    alpha = Math.max(0, Math.min(1, rawAlpha));
  }
  const hex = `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return { hex, alpha };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

/** 채널 alpha(0..1) 적용 — rgba()/opacity 곱셈 결과. */
export function clampAlpha(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** 불투명도 속성 값 해석 ("0.5"·"50%"). 실패 시 1. */
export function parseOpacity(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const text = raw.trim();
  if (text.endsWith("%")) {
    const value = Number.parseFloat(text) / 100;
    return clampAlpha(Number.isFinite(value) ? value : 1);
  }
  const value = Number.parseFloat(text);
  return clampAlpha(Number.isFinite(value) ? value : 1);
}
