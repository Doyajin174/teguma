import { lstat, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  MAX_PROJECT_ID_LENGTH,
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
} from "../src/design/index.js";
import { createServer } from "../src/server.js";

let projectRoot: string;
let outside: string;

function project(id: string) {
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id,
    title: `${id} title`,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    document: {
      id: `${id}-document`,
      title: `${id} document`,
      canvas: { width: 100, height: 100 },
      pages: [
        {
          id: "page",
          name: "Page",
          layers: [
            {
              id: "label",
              type: "text",
              frame: { x: 10, y: 10, width: 80, height: 30 },
              text: "Draft",
              fontFamily: "Inter",
              fontSize: 16,
              color: "#111111",
            },
          ],
        },
      ],
    },
  };
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content.map((item) => item.text).join("\n");
}

async function connectClient(root: string) {
  const server = createServer({
    penpotBaseUrl: "http://localhost:9001",
    projectRoot: root,
  });
  const client = new Client({ name: "project-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => client.close() };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "teguma-projects-"));
  outside = await mkdtemp(path.join(tmpdir(), "teguma-projects-outside-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("design project store", () => {
  it("round-trips a saved project with every document default normalized", async () => {
    const saved = await saveProject({ root: projectRoot }, project("round-trip"));
    const loaded = await loadProject({ root: projectRoot }, "round-trip");

    expect(loaded).toEqual(saved);
    expect(loaded.document.canvas).toMatchObject({ unit: "px", safeMargin: 0 });
    expect(loaded.document.pages[0]).toMatchObject({ background: "#FFFFFF" });
    expect(loaded.document.pages[0].layers[0]).toMatchObject({
      opacity: 1,
      fontWeight: 400,
      align: "start",
      lineHeight: 1.3,
      letterSpacing: 0,
    });
  });

  it("lists saved projects in deterministic id order", async () => {
    await saveProject({ root: projectRoot }, project("zeta"));
    await saveProject({ root: projectRoot }, project("alpha"));
    await saveProject({ root: projectRoot }, project("middle"));

    expect((await listProjects({ root: projectRoot })).map((saved) => saved.id)).toEqual([
      "alpha",
      "middle",
      "zeta",
    ]);
  });

  it("deletes only the requested project", async () => {
    await saveProject({ root: projectRoot }, project("keep"));
    await saveProject({ root: projectRoot }, project("remove"));

    await deleteProject({ root: projectRoot }, "remove");

    await expect(loadProject({ root: projectRoot }, "remove")).rejects.toThrow(/not found/);
    expect((await loadProject({ root: projectRoot }, "keep")).id).toBe("keep");
  });

  it("rejects traversal, hidden, empty, absolute, and overlong ids", async () => {
    const invalid = [
      "..",
      "a/b",
      path.join(projectRoot, "absolute"),
      ".hidden",
      "",
      "a".repeat(MAX_PROJECT_ID_LENGTH + 1),
    ];

    for (const id of invalid) {
      await expect(saveProject({ root: projectRoot }, project(id))).rejects.toThrow();
    }
  });

  it("refuses a symlinked project-store path component", async () => {
    const linkedStore = path.join(projectRoot, "linked");
    await symlink(outside, linkedStore);

    await expect(saveProject({ root: linkedStore }, project("blocked"))).rejects.toThrow(
      /store root is a symlink/,
    );
    await expect(lstat(path.join(outside, "blocked.json"))).rejects.toThrow();
  });

  it("refuses to overwrite a symlink at the final project path", async () => {
    const victim = path.join(outside, "victim.json");
    await writeFile(victim, "ORIGINAL");
    await symlink(victim, path.join(projectRoot, "protected.json"));

    await expect(saveProject({ root: projectRoot }, project("protected"))).rejects.toThrow(
      /Refusing to overwrite a symlink/,
    );
    expect(await readFile(victim, "utf8")).toBe("ORIGINAL");
  });

  it("rejects projects written by a newer schema version with an upgrade action", async () => {
    const newer = { ...project("newer"), schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION + 1 };
    await writeFile(path.join(projectRoot, "newer.json"), JSON.stringify(newer));

    await expect(loadProject({ root: projectRoot }, "newer")).rejects.toThrow(
      /newer than this server supports.*Upgrade teguma/i,
    );
  });

  it("reports truncated or corrupt project JSON clearly", async () => {
    await writeFile(path.join(projectRoot, "corrupt.json"), '{"schemaVersion":');

    await expect(loadProject({ root: projectRoot }, "corrupt")).rejects.toThrow(
      /invalid JSON.*truncated or corrupt/i,
    );
  });

  it("uses atomic replacement without leaving temporary files", async () => {
    await saveProject({ root: projectRoot }, project("atomic"));

    expect((await readdir(projectRoot)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(await readFile(path.join(projectRoot, "atomic.json"), "utf8")).toContain("\n  \"document\"");
  });

  it("saves, loads, and lists a QA-failing draft over MCP", async () => {
    const { client, close } = await connectClient(projectRoot);
    const draft = {
      id: "draft",
      title: "Draft",
      canvas: { width: 100, height: 100 },
      pages: [
        {
          id: "page",
          name: "Page",
          layers: [
            {
              id: "outside",
              type: "rect",
              frame: { x: 95, y: 10, width: 20, height: 20 },
              fill: "#111111",
            },
          ],
        },
      ],
    };

    try {
      const saved = JSON.parse(
        textOf(
          await client.callTool({
            name: "save_design_project",
            arguments: { id: "draft", title: "Draft", document: draft },
          }),
        ),
      );
      expect(saved.qa.passed).toBe(false);

      const loaded = JSON.parse(
        textOf(await client.callTool({ name: "load_design_project", arguments: { id: "draft" } })),
      );
      expect(loaded.project.id).toBe("draft");
      expect(loaded.project.document.pages[0].layers[0].opacity).toBe(1);

      const listed = JSON.parse(
        textOf(await client.callTool({ name: "list_design_projects", arguments: {} })),
      );
      expect(listed.projects.map((savedProject: { id: string }) => savedProject.id)).toEqual(["draft"]);
    } finally {
      await close();
    }
  });
});
