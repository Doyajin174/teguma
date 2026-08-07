import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

async function connectClient(exportRoot?: string) {
  const server = createServer({
    penpotBaseUrl: "http://localhost:9001",
    penpotToken: "test-token",
    ...(exportRoot ? { exportRoot } : {}),
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => client.close() };
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content.map((item) => item.text).join("\n");
}

describe("MCP Server", () => {
  it("creates server with valid config", () => {
    const server = createServer({
      penpotBaseUrl: "http://localhost:9001",
      penpotToken: "test-token",
    });
    expect(server).toBeDefined();
  });

  it("creates server without token (session auth)", () => {
    const server = createServer({
      penpotBaseUrl: "http://localhost:9001",
    });
    expect(server).toBeDefined();
  });

  it("registers the design engine tools alongside the Penpot tools", async () => {
    const { client, close } = await connectClient();

    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);

      expect(names).toContain("list_size_presets");
      expect(names).toContain("create_design_document");
      expect(names).toContain("resize_design_document");
      expect(names).toContain("export_design_document");
      expect(names).toContain("get_design_context");
    } finally {
      await close();
    }
  });

  it("serves presets, QA, resize, and export end to end over MCP", async () => {
    const exportRoot = await mkdtemp(path.join(tmpdir(), "teguma-mcp-"));
    const { client, close } = await connectClient(exportRoot);

    const document = {
      id: "smoke",
      title: "smoke",
      canvas: { width: 1080, height: 1080, safeMargin: 40 },
      pages: [
        {
          id: "p1",
          name: "P1",
          background: "#FFFFFF",
          layers: [
            {
              id: "title",
              type: "text",
              frame: { x: 80, y: 400, width: 920, height: 200 },
              text: "테스트",
              fontFamily: "IBM Plex Sans KR",
              fontSize: 90,
              fontWeight: 600,
              color: "#11191D",
            },
          ],
        },
      ],
    };

    try {
      const presets = JSON.parse(
        textOf(await client.callTool({ name: "list_size_presets", arguments: { category: "video" } })),
      );
      expect(presets.presets.map((preset: { id: string }) => preset.id)).toContain(
        "youtube-thumbnail",
      );

      const created = JSON.parse(
        textOf(await client.callTool({ name: "create_design_document", arguments: { document } })),
      );
      expect(created.qa.passed).toBe(true);

      const resized = JSON.parse(
        textOf(
          await client.callTool({
            name: "resize_design_document",
            arguments: { document, preset: "youtube-thumbnail", mode: "adapt" },
          }),
        ),
      );
      expect(resized.to).toEqual({ width: 1280, height: 720 });

      const exported = JSON.parse(
        textOf(
          await client.callTool({
            name: "export_design_document",
            arguments: { document, format: "svg", outputDirectory: "smoke" },
          }),
        ),
      );
      expect(exported.files).toHaveLength(1);
      expect(await readdir(path.join(exportRoot, "smoke"))).toEqual(["smoke-01-p1.svg"]);
    } finally {
      await close();
      await rm(exportRoot, { recursive: true, force: true });
    }
  });

  it("reports a tool error instead of throwing when export escapes the root", async () => {
    const exportRoot = await mkdtemp(path.join(tmpdir(), "teguma-mcp-escape-"));
    const { client, close } = await connectClient(exportRoot);

    try {
      const result = await client.callTool({
        name: "export_design_document",
        arguments: {
          document: {
            id: "esc",
            title: "esc",
            canvas: { width: 100, height: 100 },
            pages: [{ id: "p1", name: "P1", layers: [] }],
          },
          format: "svg",
          outputDirectory: "../outside",
        },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/escapes the export root/);
    } finally {
      await close();
      await rm(exportRoot, { recursive: true, force: true });
    }
  });
});
