/**
 * Figma REST API client.
 * Used for M3: importing Figma design systems into Penpot.
 */

export interface FigmaClientConfig {
  accessToken: string;
}

export interface FigmaFile {
  name: string;
  lastModified: string;
  document: FigmaNode;
  components: Record<string, FigmaComponent>;
  styles: Record<string, FigmaStyle>;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  effects?: FigmaEffect[];
  style?: FigmaTextStyle;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  cornerRadius?: number;
}

export interface FigmaPaint {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "IMAGE";
  color?: { r: number; g: number; b: number; a: number };
  opacity?: number;
}

export interface FigmaEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
  radius: number;
  color?: { r: number; g: number; b: number; a: number };
  offset?: { x: number; y: number };
}

export interface FigmaTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeightPx: number;
  letterSpacing: number;
}

export interface FigmaComponent {
  key: string;
  name: string;
  description: string;
  containingFrame?: { name: string; pageName: string };
}

export interface FigmaStyle {
  key: string;
  name: string;
  description: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
}

export class FigmaClient {
  private readonly headers: Record<string, string>;
  private readonly baseUrl = "https://api.figma.com/v1";

  constructor(config: FigmaClientConfig) {
    this.headers = {
      "X-Figma-Token": config.accessToken,
      "Content-Type": "application/json",
    };
  }

  async getFile(fileKey: string): Promise<FigmaFile> {
    const res = await fetch(`${this.baseUrl}/files/${fileKey}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FigmaApiError(res.status, `files/${fileKey}`, body);
    }
    return (await res.json()) as FigmaFile;
  }

  async getFileStyles(fileKey: string): Promise<Record<string, FigmaStyle>> {
    const res = await fetch(`${this.baseUrl}/files/${fileKey}/styles`, {
      headers: this.headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FigmaApiError(res.status, `styles`, body);
    }
    const data = (await res.json()) as any;
    return data?.meta?.styles ?? {};
  }

  async getFileComponents(fileKey: string): Promise<Record<string, FigmaComponent>> {
    const res = await fetch(`${this.baseUrl}/files/${fileKey}/components`, {
      headers: this.headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FigmaApiError(res.status, `components`, body);
    }
    const data = (await res.json()) as any;
    return data?.meta?.components ?? {};
  }
}

export class FigmaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly body: string,
  ) {
    super(`Figma API error [${status}] on ${endpoint}: ${body.slice(0, 200)}`);
    this.name = "FigmaApiError";
  }
}
