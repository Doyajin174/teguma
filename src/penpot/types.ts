/**
 * Penpot data types — subset relevant to teguma's brand context extraction.
 */

export interface PenpotColor {
  id: string;
  name: string;
  path?: string;
  color: string;
  opacity?: number;
  gradient?: {
    type: "linear" | "radial";
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    stops: Array<{ color: string; opacity: number; offset: number }>;
  };
}

export interface PenpotTypography {
  id: string;
  name: string;
  path?: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing?: string;
  textTransform?: string;
}

export interface PenpotComponent {
  id: string;
  name: string;
  path: string;
  mainInstanceId?: string;
  variantProperties?: Record<string, string[]>;
  children?: PenpotShape[];
}

export interface PenpotShape {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children?: PenpotShape[];
  layout?: {
    type: "flex" | "grid";
    direction?: "row" | "column";
    gap?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
    alignItems?: string;
    justifyContent?: string;
  };
  fills?: Array<{ color: string; opacity?: number }>;
  strokes?: Array<{ color: string; width: number }>;
  fontSize?: string;
  fontFamily?: string;
}

export interface PenpotPage {
  id: string;
  name: string;
  children: PenpotShape[];
}

export interface PenpotFile {
  id: string;
  name: string;
  pages: PenpotPage[];
  components: PenpotComponent[];
  colors: PenpotColor[];
  typographies: PenpotTypography[];
}

/** Compressed brand context — what teguma actually sends to the AI */
export interface BrandContext {
  fileName: string;
  summary: string;
  tokens: {
    colors: CompressedColor[];
    typography: CompressedTypography;
    spacing: CompressedSpacing;
  };
  components: CompressedComponent[];
  pages: CompressedPage[];
  constraints: LayoutConstraints;
}

export interface CompressedColor {
  name: string;
  value: string;
  role?: string; // "primary" | "secondary" | "neutral" | "semantic"
}

export interface CompressedTypography {
  families: string[];
  scale: Array<{ name: string; size: number; weight: number; lineHeight: number }>;
  baseSize: number;
}

export interface CompressedSpacing {
  baseUnit: number;
  scale: number[];
}

export interface CompressedComponent {
  name: string;
  path: string;
  variants?: Record<string, string[]>;
  props?: string[];
}

export interface CompressedPage {
  name: string;
  frameCount: number;
  topLevelFrames: Array<{ name: string; width: number; height: number }>;
}

export interface LayoutConstraints {
  breakpoints: number[];
  maxContentWidth?: number;
  gridColumns?: number;
  gridGutter?: number;
}
