/** Shared color primitives for brand normalization and design QA. */

export type RgbColor = [number, number, number];

/**
 * Convert the document model's validated #RRGGBB color into RGB channels.
 * Keeping this here prevents brand matching and QA from drifting numerically.
 */
export function hexToRgb(hex: string): RgbColor {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Calculate WCAG relative luminance from RGB channels. */
export function relativeLuminanceFromRgb(channels: RgbColor): number {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

/** Calculate WCAG contrast ratio between two validated document colors. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminanceFromRgb(hexToRgb(foreground));
  const b = relativeLuminanceFromRgb(hexToRgb(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
