/**
 * End-to-end MCP journeys for the design engine.
 *
 * Unit tests prove individual tools; these tests prove an AI agent can pass
 * real documents between tools, render Korean copy, persist drafts, and get
 * actionable protocol errors without leaving configured storage roots.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrandKit, DesignDocument } from "../src/design/index.js";
import { createServer } from "../src/server.js";

interface QaReport {
  passed: boolean;
  checks: Array<{ name: string; pass: boolean }>;
  brandViolations: Array<{ layerId: string; kind: string; message: string }>;
}

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

interface TemplateResult {
  filledSlots: string[];
  qa: QaReport;
  document: DesignDocument;
}

interface DocumentResult {
  qa: QaReport;
  document: DesignDocument;
}

interface ResizeResult extends DocumentResult {
  to: { width: number; height: number };
  applied: { width: number; height: number; mode: string };
}

interface ExportResult {
  format: string;
  width: number;
  height: number;
  files: Array<{ file: string; bytes: number }>;
  qa: QaReport;
}

let exportRoot: string;
let projectRoot: string;

beforeEach(async () => {
  exportRoot = await mkdtemp(path.join(tmpdir(), "teguma-workflow-export-"));
  projectRoot = await mkdtemp(path.join(tmpdir(), "teguma-workflow-project-"));
});

afterEach(async () => {
  await Promise.all([
    rm(exportRoot, { recursive: true, force: true }),
    rm(projectRoot, { recursive: true, force: true }),
  ]);
});

async function connectClient() {
  const server = createServer({
    penpotBaseUrl: "http://localhost:9001",
    penpotToken: "test-token",
    exportRoot,
    projectRoot,
  });
  const client = new Client({ name: "design-workflow-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => client.close() };
}

function textOf(result: ToolResult): string {
  return result.content.map((item) => item.text ?? "").join("\n");
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

async function callJson<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await callTool(client, name, args);
  expect(result.isError, `${name}: ${textOf(result)}`).not.toBe(true);
  return JSON.parse(textOf(result)) as T;
}

function check(report: QaReport, name: string): boolean | undefined {
  return report.checks.find((candidate) => candidate.name === name)?.pass;
}

function nonBackgroundPixels(png: PNG, background: readonly [number, number, number]): number {
  let count = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    if (
      png.data[offset] !== background[0]
      || png.data[offset + 1] !== background[1]
      || png.data[offset + 2] !== background[2]
    ) {
      count += 1;
    }
  }
  return count;
}

function overflowingDocument(): DesignDocument {
  return {
    id: "overflowing-korean-copy",
    title: "넘치는 한국어 문안",
    canvas: { width: 600, height: 500, unit: "px", safeMargin: 20 },
    pages: [{
      id: "page",
      name: "본문",
      background: "#FFFFFF",
      layers: [{
        id: "copy",
        type: "text",
        frame: { x: 40, y: 40, width: 200, height: 50 },
        text: "충전 시간과 전력 사용 패턴을 함께 확인하면 다음 달 비용을 줄일 수 있습니다.",
        fontFamily: "IBM Plex Sans KR",
        fontSize: 60,
        fontWeight: 600,
        color: "#11191D",
        opacity: 1,
        align: "start",
        lineHeight: 1.25,
        letterSpacing: 0,
      }],
    }],
  };
}

describe("design engine MCP workflows", () => {
  it("lets an agent produce and export a Korean card-news set from templates", async () => {
    const { client, close } = await connectClient();

    try {
      const presets = await callJson<{ presets: Array<{ id: string; width: number; height: number }> }>(
        client,
        "list_size_presets",
        { category: "social" },
      );
      expect(presets.presets).toContainEqual(expect.objectContaining({ id: "instagram-portrait" }));

      const cover = await callJson<TemplateResult>(client, "create_from_template", {
        templateId: "card-news-cover",
        input: {
          eyebrow: "SEVASA 에너지 노트",
          headline: "충전비를\n줄이는 세 가지 습관",
          body: "전기차 충전 시간을 바꾸는 것만으로도 다음 달 비용을 줄일 수 있습니다.",
          footer: "SEVASA / ENERGY NOTE",
        },
      });
      const slide = await callJson<TemplateResult>(client, "create_from_template", {
        templateId: "card-news-slide",
        input: {
          eyebrow: "01 시간대 요금",
          headline: "경부하 시간에\n충전하기",
          body: "앱에서 충전 시작 시간을 예약하고, 자주 쓰는 장소의 요금표를 함께 확인하세요.",
          footer: "SEVASA / 01",
        },
      });
      expect(cover.qa.passed).toBe(true);
      expect(slide.qa.passed).toBe(true);

      const document: DesignDocument = {
        ...cover.document,
        id: "korean-card-news",
        title: "충전비 절감 카드뉴스",
        pages: [...cover.document.pages, ...slide.document.pages],
      };
      const validated = await callJson<DocumentResult>(client, "create_design_document", { document });
      expect(validated.qa.passed).toBe(true);

      const pngExport = await callJson<ExportResult>(client, "export_design_document", {
        document: validated.document,
        format: "png",
        outputDirectory: "card-news/png",
        width: 540,
      });
      expect(pngExport.qa.passed).toBe(true);
      expect(pngExport.files).toHaveLength(2);
      expect({ width: pngExport.width, height: pngExport.height }).toEqual({ width: 540, height: 675 });

      const firstPng = await readFile(path.join(exportRoot, "card-news/png", pngExport.files[0].file));
      expect(firstPng.length).toBe(pngExport.files[0].bytes);
      expect(firstPng.length).toBeGreaterThan(2_000);
      const decoded = PNG.sync.read(firstPng);
      expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 540, height: 675 });
      // The cover's bars alone occupy under 1,000 pixels at this resolution;
      // this threshold proves the bundled Korean font produced painted glyphs.
      expect(nonBackgroundPixels(decoded, [255, 255, 255])).toBeGreaterThan(8_000);

      const pdfExport = await callJson<ExportResult>(client, "export_design_document", {
        document: validated.document,
        format: "pdf",
        outputDirectory: "card-news/pdf",
        width: 360,
      });
      expect(pdfExport.files).toHaveLength(1);
      const pdf = await readFile(path.join(exportRoot, "card-news/pdf", pdfExport.files[0].file));
      expect(pdf.length).toBe(pdfExport.files[0].bytes);
      expect(pdf.length).toBeGreaterThan(2_000);
      expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
      expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
    } finally {
      await close();
    }
  });

  it("repairs overflowing copy with autolayout before the QA-gated export", async () => {
    const { client, close } = await connectClient();

    try {
      const initial = await callJson<DocumentResult>(client, "create_design_document", {
        document: overflowingDocument(),
      });
      expect(initial.qa.passed).toBe(false);
      expect(check(initial.qa, "text-fits-frame-width")).toBe(false);
      expect(check(initial.qa, "text-fits-frame-height")).toBe(false);

      const laidOut = await callJson<DocumentResult & { changes: Array<{ layerId: string }> }>(
        client,
        "autolayout_design_document",
        { document: initial.document, onOverflow: "grow" },
      );
      expect(laidOut.changes).toContainEqual(expect.objectContaining({ layerId: "copy" }));
      expect(laidOut.qa.passed).toBe(true);
      expect(check(laidOut.qa, "text-fits-frame-width")).toBe(true);
      expect(check(laidOut.qa, "text-fits-frame-height")).toBe(true);

      const exported = await callJson<ExportResult>(client, "export_design_document", {
        document: laidOut.document,
        format: "png",
        outputDirectory: "autolayout",
        width: 300,
      });
      expect(exported.files).toHaveLength(1);
      expect((await readFile(path.join(exportRoot, "autolayout", exported.files[0].file))).length)
        .toBe(exported.files[0].bytes);
    } finally {
      await close();
    }
  });

  it("adapts one design for multiple channels and surfaces fill cropping through QA", async () => {
    const { client, close } = await connectClient();

    try {
      const template = await callJson<TemplateResult>(client, "create_from_template", {
        templateId: "card-news-cover",
        input: {
          eyebrow: "SEVASA 에너지 노트",
          headline: "충전 시간을\n바꾸면 달라집니다",
          body: "시간대별 요금을 확인해 다음 충전을 계획하세요.",
        },
      });
      expect(template.qa.passed).toBe(true);

      for (const mode of ["adapt", "fit"] as const) {
        const resized = await callJson<ResizeResult>(client, "resize_design_document", {
          document: template.document,
          preset: "youtube-thumbnail",
          mode,
        });
        expect(resized.applied).toMatchObject({ width: 1280, height: 720, mode });
        expect(resized.to).toEqual({ width: 1280, height: 720 });
        expect(resized.document.canvas).toMatchObject(resized.to);
        expect(resized.qa.passed, mode).toBe(true);

        const exported = await callJson<ExportResult>(client, "export_design_document", {
          document: resized.document,
          format: "png",
          outputDirectory: `channels/${mode}`,
          width: 320,
        });
        expect(exported.files).toHaveLength(1);
        const png = PNG.sync.read(await readFile(path.join(exportRoot, `channels/${mode}`, exported.files[0].file)));
        expect({ width: png.width, height: png.height }).toEqual({ width: 320, height: 180 });
      }

      const filled = await callJson<ResizeResult>(client, "resize_design_document", {
        document: template.document,
        preset: "youtube-thumbnail",
        mode: "fill",
      });
      expect(filled.applied).toMatchObject({ width: 1280, height: 720, mode: "fill" });
      expect(filled.to).toEqual({ width: 1280, height: 720 });
      expect(filled.qa.passed).toBe(false);
      expect(check(filled.qa, "layers-inside-canvas")).toBe(false);

      const refused = await callTool(client, "export_design_document", {
        document: filled.document,
        format: "png",
        outputDirectory: "channels/fill",
      });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toMatch(/Design QA failed.*layers-inside-canvas/);
    } finally {
      await close();
    }
  });

  it("persists a session through load, mutation, and save while retaining failed drafts", async () => {
    const { client, close } = await connectClient();

    try {
      const template = await callJson<TemplateResult>(client, "create_from_template", {
        templateId: "card-news-cover",
        input: {
          eyebrow: "SEVASA 에너지 노트",
          headline: "다음 충전을\n더 똑똑하게",
          body: "충전 시작 시간을 예약하면 비용 관리가 쉬워집니다.",
        },
      });
      const firstSave = await callJson<{ qa: QaReport }>(client, "save_design_project", {
        id: "session-project",
        title: "카드뉴스 작업 세션",
        document: template.document,
      });
      expect(firstSave.qa.passed).toBe(true);

      const listed = await callJson<{ projects: Array<{ id: string }> }>(client, "list_design_projects", {});
      expect(listed.projects.map((project) => project.id)).toEqual(["session-project"]);

      const loaded = await callJson<{ project: { document: DesignDocument } }>(client, "load_design_project", {
        id: "session-project",
      });
      const arranged = await callJson<DocumentResult>(client, "arrange_design_layers", {
        document: loaded.project.document,
        pageId: "cover",
        layerIds: ["accent-bar"],
        operation: { type: "align", horizontal: "center" },
      });
      expect(arranged.qa.passed).toBe(true);
      const accent = arranged.document.pages[0].layers.find((layer) => layer.id === "accent-bar");
      expect(accent?.frame.x).toBe(492);

      const secondSave = await callJson<{ qa: QaReport }>(client, "save_design_project", {
        id: "session-project",
        title: "카드뉴스 작업 세션",
        document: arranged.document,
      });
      expect(secondSave.qa.passed).toBe(true);
      const reloaded = await callJson<{ project: { document: DesignDocument } }>(client, "load_design_project", {
        id: "session-project",
      });
      expect(reloaded.project.document.pages[0].layers.find((layer) => layer.id === "accent-bar")?.frame.x)
        .toBe(492);

      const failingSave = await callJson<{ qa: QaReport }>(client, "save_design_project", {
        id: "qa-failing-draft",
        title: "고치는 중인 초안",
        document: {
          ...template.document,
          id: "qa-failing-draft-document",
          pages: template.document.pages.map((page) => ({
            ...page,
            layers: page.layers.map((layer) => layer.id === "accent-bar" && layer.type === "rect"
              ? { ...layer, frame: { ...layer.frame, x: 1_050 } }
              : layer),
          })),
        },
      });
      expect(failingSave.qa.passed).toBe(false);
    } finally {
      await close();
    }
  });

  it("reports and normalizes brand-kit violations across an MCP editing flow", async () => {
    const { client, close } = await connectClient();
    const brandKit: BrandKit = {
      id: "sevasa-kit",
      name: "SEVASA",
      palette: [
        { id: "ink", name: "Ink", value: "#11191D" },
        { id: "paper", name: "Paper", value: "#FFFFFF" },
        { id: "signal", name: "Signal Green", value: "#00A653" },
      ],
      fonts: [{ family: "IBM Plex Sans KR", weights: [400, 600] }],
      logos: [],
    };

    try {
      const template = await callJson<TemplateResult>(client, "create_from_template", {
        templateId: "card-news-cover",
        input: {
          eyebrow: "SEVASA 에너지 노트",
          headline: "브랜드 색을\n지키는 카드뉴스",
          body: "등록한 색상과 서체만 사용하면 검수가 쉬워집니다.",
          brandKit,
        },
      });
      expect(template.qa.passed).toBe(true);

      const offBrand: DesignDocument = {
        ...template.document,
        pages: template.document.pages.map((page) => ({
          ...page,
          layers: page.layers.map((layer) => layer.id === "accent-bar" && layer.type === "rect"
            ? { ...layer, fill: "#00A650" }
            : layer),
        })),
      };
      const raw = await callJson<DocumentResult>(client, "create_design_document", { document: offBrand });
      expect(raw.qa.passed).toBe(false);
      expect(raw.qa.brandViolations).toContainEqual(expect.objectContaining({
        layerId: "accent-bar",
        kind: "color",
      }));

      const normalized = await callJson<DocumentResult>(client, "create_design_document", {
        document: raw.document,
        applyBrandKitNormalization: true,
      });
      expect(normalized.qa.passed).toBe(true);
      expect(normalized.qa.brandViolations).toEqual([]);
      expect(normalized.document.pages[0].layers.find((layer) => layer.id === "accent-bar"))
        .toMatchObject({ fill: "#00A653" });
    } finally {
      await close();
    }
  });

  it("returns readable MCP tool errors for invalid requests instead of crashing", async () => {
    const { client, close } = await connectClient();
    const valid = overflowingDocument();
    const exportable = {
      id: "exportable-error-probe",
      title: "내보내기 경로 검증",
      canvas: { width: 100, height: 100 },
      pages: [{
        id: "page",
        name: "페이지",
        background: "#FFFFFF",
        layers: [{
          id: "safe-rect",
          type: "rect",
          frame: { x: 20, y: 20, width: 60, height: 60 },
          fill: "#11191D",
        }],
      }],
    };

    try {
      const cases: Array<{ name: string; args: Record<string, unknown>; message: RegExp }> = [
        {
          name: "resize_design_document",
          args: { document: valid, preset: "unknown-preset", mode: "fit" },
          message: /Unknown size preset/i,
        },
        {
          name: "create_design_document",
          args: { document: { id: "malformed" } },
          message: /Required|pages|canvas/i,
        },
        {
          name: "create_from_template",
          args: { templateId: "unknown-template", input: {} },
          message: /Unknown design template/i,
        },
        {
          name: "load_design_project",
          args: { id: "../outside" },
          message: /Project id|path separators/i,
        },
        {
          name: "export_design_document",
          args: {
            document: exportable,
            format: "png",
            outputDirectory: "../outside",
          },
          message: /escapes the export root/i,
        },
      ];

      for (const testCase of cases) {
        const result = await callTool(client, testCase.name, testCase.args);
        expect(result.isError, testCase.name).toBe(true);
        expect(textOf(result), testCase.name).toMatch(testCase.message);
      }
    } finally {
      await close();
    }
  });
});
