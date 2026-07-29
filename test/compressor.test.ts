import { describe, it, expect } from "vitest";
import { compressBrandContext, serializeForLLM } from "../src/compressor.js";
import type { PenpotFile } from "../src/penpot/types.js";

const mockFile: PenpotFile = {
  id: "file-1",
  name: "Acme Design System",
  pages: [
    {
      id: "page-1",
      name: "Components",
      children: [
        {
          id: "frame-1",
          type: "frame",
          name: "Buttons",
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
          layout: {
            type: "flex",
            direction: "column",
            gap: 16,
            padding: { top: 24, right: 24, bottom: 24, left: 24 },
          },
        },
        {
          id: "frame-2",
          type: "frame",
          name: "Cards",
          x: 1500,
          y: 0,
          width: 1440,
          height: 1200,
        },
      ],
    },
    {
      id: "page-2",
      name: "Screens",
      children: [
        {
          id: "frame-3",
          type: "frame",
          name: "Dashboard",
          x: 0,
          y: 0,
          width: 1440,
          height: 1024,
        },
      ],
    },
  ],
  components: [
    {
      id: "comp-1",
      name: "Button",
      path: "ui/button",
      variantProperties: { size: ["sm", "md", "lg"], variant: ["primary", "secondary", "ghost"] },
    },
    {
      id: "comp-2",
      name: "Input",
      path: "ui/form/input",
      variantProperties: { state: ["default", "focus", "error"] },
    },
    {
      id: "comp-3",
      name: "Card",
      path: "ui/card",
    },
  ],
  colors: [
    { id: "c1", name: "Primary 500", path: "brand", color: "#6366f1" },
    { id: "c2", name: "Neutral 100", path: "base", color: "#f5f5f5" },
    { id: "c3", name: "Error", color: "#ef4444" },
    { id: "c4", name: "Text Primary", path: "semantic", color: "#1a1a1a" },
  ],
  typographies: [
    { id: "t1", name: "Heading 1", fontFamily: "Inter", fontSize: "32", fontWeight: "700", lineHeight: "1.2" },
    { id: "t2", name: "Body", fontFamily: "Inter", fontSize: "16", fontWeight: "400", lineHeight: "1.5" },
    { id: "t3", name: "Caption", fontFamily: "Inter", fontSize: "12", fontWeight: "400", lineHeight: "1.4" },
  ],
};

describe("compressBrandContext", () => {
  it("extracts file metadata", () => {
    const ctx = compressBrandContext(mockFile);
    expect(ctx.fileName).toBe("Acme Design System");
    expect(ctx.summary).toContain("2 pages");
    expect(ctx.summary).toContain("3 components");
    expect(ctx.summary).toContain("4 colors");
  });

  it("compresses colors with role inference", () => {
    const ctx = compressBrandContext(mockFile);
    const colors = ctx.tokens.colors;

    expect(colors).toHaveLength(4);

    const primary = colors.find((c) => c.name.includes("Primary"));
    expect(primary?.role).toBe("primary");
    expect(primary?.value).toBe("#6366f1");

    const neutral = colors.find((c) => c.name.includes("Neutral"));
    expect(neutral?.role).toBe("neutral");

    const error = colors.find((c) => c.name.includes("Error"));
    expect(error?.role).toBe("semantic");
  });

  it("compresses typography into scale", () => {
    const ctx = compressBrandContext(mockFile);
    const typo = ctx.tokens.typography;

    expect(typo.families).toEqual(["Inter"]);
    expect(typo.scale).toHaveLength(3);
    expect(typo.scale[0].name).toBe("Caption"); // smallest first
    expect(typo.scale[0].size).toBe(12);
    expect(typo.scale[2].name).toBe("Heading 1");
    expect(typo.scale[2].size).toBe(32);
  });

  it("infers spacing from layout data", () => {
    const ctx = compressBrandContext(mockFile);
    const spacing = ctx.tokens.spacing;

    expect(spacing.baseUnit).toBe(8);
    expect(spacing.scale).toContain(16);
    expect(spacing.scale).toContain(24);
  });

  it("compresses components with variants", () => {
    const ctx = compressBrandContext(mockFile);
    expect(ctx.components).toHaveLength(3);

    const button = ctx.components.find((c) => c.name === "Button");
    expect(button?.path).toBe("ui/button");
    expect(button?.variants?.size).toEqual(["sm", "md", "lg"]);
  });

  it("compresses pages with frame info", () => {
    const ctx = compressBrandContext(mockFile);
    expect(ctx.pages).toHaveLength(2);

    const componentsPage = ctx.pages[0];
    expect(componentsPage.name).toBe("Components");
    expect(componentsPage.frameCount).toBe(2);
    expect(componentsPage.topLevelFrames[0].name).toBe("Buttons");
  });

  it("infers layout constraints", () => {
    const ctx = compressBrandContext(mockFile);
    expect(ctx.constraints.breakpoints).toEqual([375, 768, 1024, 1440]);
    expect(ctx.constraints.maxContentWidth).toBe(1440);
  });

  it("respects maxComponents option", () => {
    const ctx = compressBrandContext(mockFile, { maxComponents: 2 });
    expect(ctx.components).toHaveLength(2);
  });
});

describe("serializeForLLM", () => {
  it("produces compact text output", () => {
    const ctx = compressBrandContext(mockFile);
    const text = serializeForLLM(ctx);

    expect(text).toContain("# Acme Design System");
    expect(text).toContain("## Colors");
    expect(text).toContain("brand/Primary 500: #6366f1 (primary)");
    expect(text).toContain("## Typography");
    expect(text).toContain("Families: Inter");
    expect(text).toContain("## Components");
    expect(text).toContain("ui/button [size:sm|md|lg, variant:primary|secondary|ghost]");
    expect(text).toContain("## Layout Constraints");
    expect(text).toContain("Breakpoints: 375, 768, 1024, 1440px");
  });

  it("is significantly shorter than raw JSON", () => {
    const ctx = compressBrandContext(mockFile);
    const compact = serializeForLLM(ctx);
    const raw = JSON.stringify(mockFile);

    // Compact should be shorter than raw file data
    // (with small mocks the ratio is modest; real files compress ~10x)
    expect(compact.length).toBeLessThan(raw.length * 0.8);
  });
});
