import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDesignContext } from "../src/tools/get-design-context.js";
import { getTokens } from "../src/tools/get-tokens.js";
import { getComponents } from "../src/tools/get-components.js";
import { getConstraints } from "../src/tools/get-constraints.js";
import type { PenpotClient } from "../src/penpot/client.js";
import type { PenpotFile } from "../src/penpot/types.js";

const mockFile: PenpotFile = {
  id: "file-1",
  name: "Test DS",
  pages: [
    {
      id: "page-1",
      name: "Main",
      children: [
        { id: "f1", type: "frame", name: "Hero", x: 0, y: 0, width: 1440, height: 800 },
      ],
    },
  ],
  components: [
    { id: "c1", name: "Button", path: "ui/button", variantProperties: { size: ["sm", "lg"] } },
    { id: "c2", name: "Card", path: "ui/card" },
  ],
  colors: [
    { id: "col1", name: "Primary", path: "brand", color: "#6366f1" },
    { id: "col2", name: "Error", color: "#ef4444" },
  ],
  typographies: [
    { id: "t1", name: "H1", fontFamily: "Inter", fontSize: "32", fontWeight: "700", lineHeight: "1.2" },
    { id: "t2", name: "Body", fontFamily: "Inter", fontSize: "16", fontWeight: "400", lineHeight: "1.5" },
  ],
};

function createMockClient(): PenpotClient {
  return {
    getFile: vi.fn().mockResolvedValue(mockFile),
    getComponents: vi.fn().mockResolvedValue(mockFile.components),
    getColors: vi.fn().mockResolvedValue(mockFile.colors),
    getTypographies: vi.fn().mockResolvedValue(mockFile.typographies),
    listFiles: vi.fn().mockResolvedValue([{ id: "file-1", name: "Test DS" }]),
    getPage: vi.fn().mockResolvedValue(mockFile.pages[0]),
    getFilePages: vi.fn().mockResolvedValue([{ id: "page-1", name: "Main" }]),
    commitChanges: vi.fn().mockResolvedValue(undefined),
  } as unknown as PenpotClient;
}

describe("get_design_context tool", () => {
  let client: PenpotClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("returns compact text by default", async () => {
    const result = await getDesignContext(client, { fileId: "file-1", format: "compact" });
    expect(result).toContain("# Test DS");
    expect(result).toContain("## Colors");
    expect(result).toContain("brand/Primary: #6366f1 (primary)");
    expect(result).toContain("## Components");
    expect(result).toContain("ui/button [size:sm|lg]");
  });

  it("returns JSON when requested", async () => {
    const result = await getDesignContext(client, { fileId: "file-1", format: "json" });
    const parsed = JSON.parse(result);
    expect(parsed.fileName).toBe("Test DS");
    expect(parsed.tokens.colors).toHaveLength(2);
    expect(parsed.components).toHaveLength(2);
  });
});

describe("get_tokens tool", () => {
  let client: PenpotClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("returns all token categories", async () => {
    const result = await getTokens(client, { fileId: "file-1", category: "all" });
    const parsed = JSON.parse(result);
    expect(parsed.colors).toBeDefined();
    expect(parsed.typography).toBeDefined();
    expect(parsed.spacing).toBeDefined();
  });

  it("filters to colors only", async () => {
    const result = await getTokens(client, { fileId: "file-1", category: "colors" });
    const parsed = JSON.parse(result);
    expect(parsed.colors).toHaveLength(2);
    expect(parsed.typography).toBeUndefined();
    expect(parsed.spacing).toBeUndefined();
  });

  it("infers color roles", async () => {
    const result = await getTokens(client, { fileId: "file-1", category: "colors" });
    const parsed = JSON.parse(result);
    const primary = parsed.colors.find((c: any) => c.name.includes("Primary"));
    expect(primary.role).toBe("primary");
    const error = parsed.colors.find((c: any) => c.name.includes("Error"));
    expect(error.role).toBe("semantic");
  });
});

describe("get_components tool", () => {
  let client: PenpotClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("lists all components", async () => {
    const result = await getComponents(client, { fileId: "file-1" });
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(2);
    expect(parsed.components[0].path).toBe("ui/button");
    expect(parsed.components[0].variants.size).toEqual(["sm", "lg"]);
  });

  it("filters by name", async () => {
    const result = await getComponents(client, { fileId: "file-1", filter: "button" });
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.components[0].name).toBe("Button");
  });

  it("returns empty for no match", async () => {
    const result = await getComponents(client, { fileId: "file-1", filter: "nonexistent" });
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(0);
  });
});

describe("get_constraints tool", () => {
  let client: PenpotClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("returns guardrails with MUST/MUST NOT rules", async () => {
    const result = await getConstraints(client, { fileId: "file-1" });
    const parsed = JSON.parse(result);
    expect(parsed.guardrails).toBeDefined();
    expect(parsed.guardrails.some((g: string) => g.startsWith("MUST:"))).toBe(true);
    expect(parsed.guardrails.some((g: string) => g.startsWith("MUST NOT:"))).toBe(true);
  });

  it("includes available components list", async () => {
    const result = await getConstraints(client, { fileId: "file-1" });
    const parsed = JSON.parse(result);
    expect(parsed.availableComponents).toContain("ui/button");
    expect(parsed.availableComponents).toContain("ui/card");
  });

  it("includes breakpoints", async () => {
    const result = await getConstraints(client, { fileId: "file-1" });
    const parsed = JSON.parse(result);
    expect(parsed.breakpoints).toEqual([375, 768, 1024, 1440]);
  });
});
