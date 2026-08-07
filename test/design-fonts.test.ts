import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  BUNDLED_DEFAULT_FONT_FILES,
  collectDocumentFontFamilies,
  exportDocument,
  measureTextBlock,
  parseDesignDocument,
  resolveDocumentFonts,
} from "../src/design/index.js";

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

function plexDocument(
  fontFamily = "IBM Plex Sans KR",
  geometry = { canvasWidth: 320, headlineWidth: 280 },
) {
  return parseDesignDocument({
    id: "font-card",
    title: "Font card",
    canvas: { width: geometry.canvasWidth, height: 160 },
    pages: [{
      id: "page-1",
      name: "Page 1",
      background: "#FFFFFF",
      layers: [{
        id: "headline",
        type: "text",
        frame: { x: 20, y: 28, width: geometry.headlineWidth, height: 100 },
        text: "한글 텍스트",
        fontFamily,
        fontWeight: 600,
        fontSize: 46,
        color: "#11191D",
      }],
    }],
  });
}

describe("design font registry", () => {
  it("resolves bundled Plex faces and renders non-background Korean pixels by default", async () => {
    const document = plexDocument();
    const resolved = resolveDocumentFonts(document);
    expect(resolved).toEqual({
      fontFiles: [...BUNDLED_DEFAULT_FONT_FILES],
      defaultFontFamily: "IBM Plex Sans KR",
      missing: [],
    });
    await Promise.all(resolved.fontFiles.map((fontFile) => access(fontFile)));
    await expect(readFile(path.join(path.dirname(resolved.fontFiles[0]), "OFL.txt"), "utf8"))
      .resolves.toContain("SIL OPEN FONT LICENSE");

    const exported = await exportDocument(document, { format: "png", width: 320 });
    const png = PNG.sync.read(exported.files[0].data);
    let nonBackgroundPixels = 0;
    for (let index = 0; index < png.data.length; index += 4) {
      if (png.data[index] < 245 || png.data[index + 1] < 245 || png.data[index + 2] < 245) {
        nonBackgroundPixels += 1;
      }
    }
    expect(nonBackgroundPixels).toBeGreaterThan(500);
  });

  it("reports unregistered families and follows the selected missing-font policy", async () => {
    // The 3em fallback measures this headline at 713px, so 720px is an honest QA-safe frame.
    const document = plexDocument("Unregistered Sans", { canvasWidth: 760, headlineWidth: 720 });
    const fallbackWidth = measureTextBlock("한글 텍스트", {
      fontFamily: "Unregistered Sans",
      fontWeight: 600,
      fontSize: 46,
      lineHeight: 1.2,
      letterSpacing: 0,
    }).width;

    expect(fallbackWidth).toBe(713);
    expect(fallbackWidth).toBeGreaterThan(280);
    expect(fallbackWidth).toBeLessThanOrEqual(720);
    expect(() => resolveDocumentFonts(document)).toThrow("No registered font files for: Unregistered Sans");

    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveDocumentFonts(document, { onMissingFont: "warn" })).toMatchObject({
      missing: ["Unregistered Sans"],
    });
    expect(warning).toHaveBeenCalledWith("No registered font files for: Unregistered Sans");
    warning.mockRestore();

    expect(resolveDocumentFonts(document, { onMissingFont: "ignore" })).toMatchObject({
      missing: ["Unregistered Sans"],
    });
    await expect(exportDocument(document, { format: "png", width: 320 })).rejects.toThrow(
      "No registered font files for: Unregistered Sans",
    );
  });

  it("lets explicit caller font files override registry resolution", async () => {
    // The external family still receives the 713px conservative metric before explicit files resolve it.
    const exported = await exportDocument(plexDocument("External Licensed Font", {
      canvasWidth: 760,
      headlineWidth: 720,
    }), {
      format: "png",
      width: 320,
      fontFiles: [BUNDLED_DEFAULT_FONT_FILES[1]],
    });
    // A 760px-wide fixture fitted to 320px preserves its 760:160 aspect ratio.
    expect(PNG.sync.read(exported.files[0].data)).toMatchObject({ width: 320, height: 67 });
  });

  it("rejects nonexistent and non-font paths before invoking resvg", async () => {
    await expect(exportDocument(plexDocument(), {
      format: "png",
      width: 320,
      fontFiles: ["/definitely/not/a/font.ttf"],
    })).rejects.toThrow("Font file is not readable: /definitely/not/a/font.ttf");

    const directory = await mkdtemp(path.join(tmpdir(), "teguma-font-"));
    temporaryDirectories.push(directory);
    const junk = path.join(directory, "junk.ttf");
    await writeFile(junk, "this is not a font");
    await expect(exportDocument(plexDocument(), {
      format: "png",
      width: 320,
      fontFiles: [junk],
    })).rejects.toThrow(`Font file is not a supported sfnt font: ${junk}`);
  });

  it("deduplicates families across pages in first-use order", () => {
    const document = parseDesignDocument({
      id: "families",
      title: "Families",
      canvas: { width: 100, height: 100 },
      pages: [
        { id: "one", name: "One", layers: [{ id: "a", type: "text", text: "A", fontFamily: "IBM Plex Sans KR", fontSize: 10, frame: { x: 0, y: 0, width: 40, height: 20 }, color: "#000000" }] },
        { id: "two", name: "Two", layers: [{ id: "b", type: "text", text: "B", fontFamily: "External", fontSize: 10, frame: { x: 0, y: 0, width: 40, height: 20 }, color: "#000000" }, { id: "c", type: "text", text: "C", fontFamily: "IBM Plex Sans KR", fontSize: 10, frame: { x: 0, y: 20, width: 40, height: 20 }, color: "#000000" }] },
      ],
    });
    expect(collectDocumentFontFamilies(document)).toEqual(["IBM Plex Sans KR", "External"]);
  });

  it("produces byte-identical raster exports with registry-resolved fonts", async () => {
    const document = plexDocument();
    const first = await exportDocument(document, { format: "png", width: 320 });
    const second = await exportDocument(document, { format: "png", width: 320 });
    expect(first.files[0].data.equals(second.files[0].data)).toBe(true);
  });
});
