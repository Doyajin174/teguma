/**
 * Penpot HTTP API client.
 *
 * Connects to a Penpot instance via its internal RPC API.
 * Supports both session-cookie and token-based auth.
 */

import type { PenpotFile, PenpotPage, PenpotComponent, PenpotColor, PenpotTypography } from "./types.js";

export interface PenpotClientConfig {
  /** Base URL of the Penpot instance, e.g. "https://design.example.com" */
  baseUrl: string;
  /** Authentication token (from Penpot Integrations → MCP Server → key) */
  token?: string;
  /** Session cookie for local dev */
  sessionCookie?: string;
}

export class PenpotClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: PenpotClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json" };

    if (config.token) {
      this.headers["Authorization"] = `Bearer ${config.token}`;
    }
    if (config.sessionCookie) {
      this.headers["Cookie"] = config.sessionCookie;
    }
  }

  /**
   * Penpot uses a JSON-RPC style API at /api/rpc/command/<method>
   */
  private async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.baseUrl}/api/rpc/command/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PenpotApiError(res.status, method, body);
    }

    return (await res.json()) as T;
  }

  /** List all files accessible to the authenticated user */
  async listFiles(teamId?: string): Promise<Array<{ id: string; name: string }>> {
    if (teamId) {
      return this.rpc("get-files", { "team-id": teamId });
    }
    // Fallback: list teams first, then files
    const teams = await this.rpc<Array<{ id: string; name: string }>>("get-teams");
    if (teams.length === 0) return [];
    return this.rpc("get-files", { "team-id": teams[0].id });
  }

  /** Get a single file with all pages */
  async getFile(fileId: string): Promise<PenpotFile> {
    const file = await this.rpc<any>("get-file", { id: fileId });
    return this.normalizeFile(file);
  }

  /** Get file pages (metadata only) */
  async getFilePages(fileId: string): Promise<Array<{ id: string; name: string }>> {
    const file = await this.rpc<any>("get-file", { id: fileId });
    return (file?.data?.pages ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
    }));
  }

  /** Get a specific page with full shape tree */
  async getPage(fileId: string, pageId: string): Promise<PenpotPage> {
    const page = await this.rpc<any>("get-page", { "file-id": fileId, "page-id": pageId });
    return this.normalizePage(page);
  }

  /** Get file components (library) */
  async getComponents(fileId: string): Promise<PenpotComponent[]> {
    const components = await this.rpc<any[]>("get-file-components", { "file-id": fileId });
    return (components ?? []).map((c) => this.normalizeComponent(c));
  }

  /** Get file colors (shared library) */
  async getColors(fileId: string): Promise<PenpotColor[]> {
    const file = await this.rpc<any>("get-file", { id: fileId });
    const colors = file?.data?.colors ?? {};
    return Object.values(colors).map((c: any) => this.normalizeColor(c));
  }

  /** Get file typographies (shared library) */
  async getTypographies(fileId: string): Promise<PenpotTypography[]> {
    const file = await this.rpc<any>("get-file", { id: fileId });
    const typographies = file?.data?.typographies ?? {};
    return Object.values(typographies).map((t: any) => this.normalizeTypography(t));
  }

  // --- Normalizers (Penpot internal format → teguma types) ---

  private normalizeFile(raw: any): PenpotFile {
    const data = raw?.data ?? raw ?? {};
    return {
      id: raw?.id ?? data?.id ?? "",
      name: raw?.name ?? data?.name ?? "Untitled",
      pages: (data?.pages ?? []).map((p: any) => this.normalizePage(p)),
      components: Object.values(data?.components ?? {}).map((c: any) => this.normalizeComponent(c)),
      colors: Object.values(data?.colors ?? {}).map((c: any) => this.normalizeColor(c)),
      typographies: Object.values(data?.typographies ?? {}).map((t: any) => this.normalizeTypography(t)),
    };
  }

  private normalizePage(raw: any): PenpotPage {
    const objects = raw?.objects ?? {};
    const rootId = raw?.id ?? "root";
    const children = this.extractChildren(objects, rootId);

    return {
      id: raw?.id ?? "",
      name: raw?.name ?? "Page",
      children,
    };
  }

  private extractChildren(objects: Record<string, any>, parentId: string): any[] {
    const parent = objects[parentId];
    if (!parent?.shapes) return [];

    return parent.shapes
      .map((shapeId: string) => objects[shapeId])
      .filter(Boolean)
      .map((shape: any) => ({
        id: shape.id,
        type: shape.type,
        name: shape.name,
        x: shape.x ?? 0,
        y: shape.y ?? 0,
        width: shape.width ?? 0,
        height: shape.height ?? 0,
        children: shape.shapes ? this.extractChildren(objects, shape.id) : undefined,
        layout: shape.layout ? {
          type: shape.layout === "flex" ? "flex" : "grid",
          direction: shape["layout-flex-dir"],
          gap: shape["layout-gap"]?.x,
          padding: shape["layout-padding"],
          alignItems: shape["layout-align-items"],
          justifyContent: shape["layout-justify-content"],
        } : undefined,
        fills: shape.fills,
        strokes: shape.strokes,
        fontSize: shape["font-size"],
        fontFamily: shape["font-family"],
      }));
  }

  private normalizeComponent(raw: any): PenpotComponent {
    return {
      id: raw?.id ?? "",
      name: raw?.name ?? "",
      path: raw?.path ?? "",
      mainInstanceId: raw?.["main-instance-id"],
      variantProperties: raw?.["variant-properties"],
    };
  }

  private normalizeColor(raw: any): PenpotColor {
    return {
      id: raw?.id ?? "",
      name: raw?.name ?? "",
      path: raw?.path,
      color: raw?.color ?? "#000000",
      opacity: raw?.opacity,
      gradient: raw?.gradient,
    };
  }

  private normalizeTypography(raw: any): PenpotTypography {
    return {
      id: raw?.id ?? "",
      name: raw?.name ?? "",
      path: raw?.path,
      fontFamily: raw?.["font-family"] ?? "Inter",
      fontSize: raw?.["font-size"] ?? "16",
      fontWeight: raw?.["font-weight"] ?? "400",
      lineHeight: raw?.["line-height"] ?? "1.5",
      letterSpacing: raw?.["letter-spacing"],
      textTransform: raw?.["text-transform"],
    };
  }
}

export class PenpotApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly body: string,
  ) {
    super(`Penpot API error [${status}] on ${method}: ${body.slice(0, 200)}`);
    this.name = "PenpotApiError";
  }
}
