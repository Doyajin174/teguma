import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  exportDocument,
  parseDesignDocument,
  type DesignDocument,
} from "../src/design/index.js";
import { exportDesignDocumentTool } from "../src/tools/design-engine.js";

function resolveCommand(command: string): string | undefined {
  try {
    return execFileSync("which", [command], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const hasLibreOffice = resolveCommand("soffice") && resolveCommand("pdftoppm");
const describePptx = hasLibreOffice ? describe : describe.skip;

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "teguma-pptx-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function presentationDocument(pageCount = 1): DesignDocument {
  return parseDesignDocument({
    id: "editable-slides",
    title: "편집 가능한 발표 자료",
    canvas: { width: 1200, height: 675 },
    pages: Array.from({ length: pageCount }, (_, index) => ({
      id: `slide-${index + 1}`,
      name: `슬라이드 ${index + 1}`,
      background: "#FFFFFF",
      layers: [
        {
          id: `headline-${index + 1}`,
          type: "text",
          frame: { x: 60, y: 50, width: 1080, height: 100 },
          text: index === 0 ? "한국어 헤드라인" : `페이지 ${index + 1} 텍스트`,
          fontFamily: "IBM Plex Sans KR",
          fontSize: 48,
          fontWeight: 600,
          color: "#11191D",
          align: "middle",
          letterSpacing: 2,
        },
        {
          id: `accent-${index + 1}`,
          type: "rect",
          frame: { x: 60, y: 560, width: 1080, height: 40 },
          fill: "#00A653",
        },
      ],
    })),
  });
}

async function materializePptx(data: Buffer, name: string): Promise<string> {
  const filePath = path.join(workspace, name);
  await writeFile(filePath, data);
  return filePath;
}

function readZipPart(filePath: string, partName: string): string {
  return execFileSync(
    "python3",
    ["-c", "import sys, zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))", filePath, partName],
    { encoding: "utf8" },
  );
}

/**
 * Rasterize through LibreOffice so this suite detects visual losses that ZIP
 * and XML validation cannot see, such as an omitted slide background.
 */
async function renderFirstSlideWithLibreOffice(filePath: string): Promise<PNG> {
  execFileSync("soffice", [
    "--headless",
    "--convert-to",
    "pdf:impress_pdf_Export",
    "--outdir",
    workspace,
    filePath,
  ], { encoding: "utf8" });
  const pdfPath = path.join(workspace, `${path.parse(filePath).name}.pdf`);
  const pngBase = path.join(workspace, `${path.parse(filePath).name}-slide`);
  execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-png", "-r", "96", pdfPath, pngBase]);
  return PNG.sync.read(await readFile(`${pngBase}.png`));
}

function pixelAt(png: PNG, x: number, y: number): [number, number, number, number] {
  const offset = ((y * png.width) + x) * 4;
  return [png.data[offset], png.data[offset + 1], png.data[offset + 2], png.data[offset + 3]];
}

function hasWhitePixel(png: PNG, x: number, y: number, width: number, height: number): boolean {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const [red, green, blue] = pixelAt(png, column, row);
      if (red > 240 && green > 240 && blue > 240) return true;
    }
  }
  return false;
}

function pngDataUri(png: PNG): string {
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

/** A 2:1 source whose red edge bands make crop-vs-stretch observable in pixels. */
function stripedImage(): string {
  const png = new PNG({ width: 160, height: 80 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = ((y * png.width) + x) * 4;
      const isEdge = x < 40 || x >= 120;
      png.data.set(isEdge ? [255, 0, 0, 255] : [0, 0, 255, 255], offset);
    }
  }
  return pngDataUri(png);
}

function fitDocument(fit: "cover" | "contain"): DesignDocument {
  return parseDesignDocument({
    id: `fit-${fit}`,
    title: `${fit} fidelity`,
    canvas: { width: 100, height: 100 },
    pages: [{
      id: "page",
      name: "Page",
      background: "#123456",
      layers: [{
        id: "image",
        type: "image",
        source: "striped.png",
        frame: { x: 10, y: 10, width: 80, height: 80 },
        fit,
      }],
    }],
  });
}

/** Rasterize our SVG serializer separately from the PPTX/LibreOffice path. */
async function renderFirstSlideFromSvg(document: DesignDocument, dataUri: string): Promise<PNG> {
  const svg = await exportDocument(document, {
    format: "svg",
    resolveImage: async () => dataUri,
  });
  return PNG.sync.read(Buffer.from(new Resvg(svg.files[0].data).render().asPng()));
}

function expectPixelFromBothRenderers(
  pptx: PNG,
  svg: PNG,
  x: number,
  y: number,
  expected: [number, number, number, number],
): void {
  const pptxPixel = pixelAt(pptx, x, y);
  expect(pixelAt(svg, x, y)).toEqual(expected);
  // LibreOffice's PDF color conversion can quantize a saturated channel by 1.
  // The SVG raster stays exact while this still proves the two outputs agree.
  for (const [index, value] of pptxPixel.entries()) {
    expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(1);
  }
}

function jpegHeader(width: number, height: number): string {
  const data = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xFF, width >> 8, width & 0xFF,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xFF, 0xD9,
  ]);
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}

function webpVp8xHeader(width: number, height: number): string {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(22, 4);
  data.write("WEBPVP8X", 8, "ascii");
  data.writeUInt32LE(10, 16);
  data[20] = 0;
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return `data:image/webp;base64,${data.toString("base64")}`;
}

/**
 * Python validates ZIP checksums and XML parsing independently from our ZIP
 * writer, then checks the two relationship failures that make PPTX corrupt.
 */
function inspectWithPython(filePath: string): string {
  const script = String.raw`
import sys
import zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]
relationship_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
package_relationship_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
content_types_ns = "http://schemas.openxmlformats.org/package/2006/content-types"

with zipfile.ZipFile(path) as archive:
    names = archive.namelist()
    bad = archive.testzip()
    assert bad is None, f"bad ZIP entry: {bad}"
    xml_names = [name for name in names if name.endswith(".xml") or name.endswith(".rels") or name == "[Content_Types].xml"]
    xml_parts = {name: ET.fromstring(archive.read(name)) for name in xml_names}
    content_types = xml_parts["[Content_Types].xml"]
    overrides = content_types.findall(f"{{{content_types_ns}}}Override")
    for override in overrides:
        part_name = override.attrib["PartName"].lstrip("/")
        assert part_name in names, f"missing Override target: {part_name}"
    checked_references = 0
    for slide_name in [name for name in names if name.startswith("ppt/slides/slide") and name.endswith(".xml")]:
        rels_name = slide_name.rsplit("/", 1)[0] + "/_rels/" + slide_name.rsplit("/", 1)[1] + ".rels"
        assert rels_name in names, f"missing slide relationships: {rels_name}"
        relationships = ET.fromstring(archive.read(rels_name))
        rel_ids = {relationship.attrib["Id"] for relationship in relationships.findall(f"{{{package_relationship_ns}}}Relationship")}
        slide = xml_parts[slide_name]
        for element in slide.iter():
            for attribute in (f"{{{relationship_ns}}}id", f"{{{relationship_ns}}}embed"):
                if attribute in element.attrib:
                    checked_references += 1
                    assert element.attrib[attribute] in rel_ids, f"dangling relationship: {slide_name} {element.attrib[attribute]}"
    print(f"zipfile: ZIP_OK parts={len(names)}")
    print(f"xml: XML_OK parts={len(xml_names)}")
    print(f"ooxml: OVERRIDES_OK count={len(overrides)} SLIDE_REFERENCES_OK count={checked_references}")
`;
  return execFileSync("python3", ["-c", script, filePath], { encoding: "utf8" });
}

describePptx("editable PPTX export", () => {
  it("creates a deterministic, valid OOXML package with editable Korean text", async () => {
    const document = presentationDocument();
    const first = await exportDocument(document, { format: "pptx" });
    const second = await exportDocument(document, { format: "pptx" });

    expect(first.files).toHaveLength(1);
    expect(first.files[0].pageId).toBe(document.id);
    expect(first.files[0].data.equals(second.files[0].data)).toBe(true);
    expect(first.width).toBe(1200);
    expect(first.height).toBe(675);

    const pptx = await materializePptx(first.files[0].data, "editable.pptx");
    const inspection = inspectWithPython(pptx);
    expect(inspection).toContain("zipfile: ZIP_OK");
    expect(inspection).toContain("xml: XML_OK");
    expect(inspection).toContain("ooxml: OVERRIDES_OK");

    const slide = readZipPart(pptx, "ppt/slides/slide1.xml");
    expect(slide).toContain("<a:t>한국어 헤드라인</a:t>");
    expect(slide).toContain("<p:sp>");
    expect(slide).toContain("<a:rPr lang=\"ko-KR\" sz=\"3600\" b=\"1\"");
    expect(slide).toContain("spc=\"150\"");
    expect(slide).toContain("<a:srgbClr val=\"11191D\"");
    expect(slide).toContain("algn=\"ctr\"");
    expect(slide).toContain("<a:prstGeom prst=\"rect\"");

    const presentation = readZipPart(pptx, "ppt/presentation.xml");
    // 1200px * 9,525 and 675px * 9,525 at 96dpi.
    expect(presentation).toContain("<p:sldSz cx=\"11430000\" cy=\"6429375\"");
  });

  it("creates a valid blank slide for an empty page", async () => {
    const document = parseDesignDocument({
      id: "empty-slide",
      title: "Empty slide",
      canvas: { width: 320, height: 180 },
      pages: [{ id: "empty", name: "Empty", background: "#FFFFFF", layers: [] }],
    });
    const result = await exportDocument(document, { format: "pptx" });
    const pptx = await materializePptx(result.files[0].data, "empty.pptx");

    expect(inspectWithPython(pptx)).toContain("ZIP_OK");
    const slide = readZipPart(pptx, "ppt/slides/slide1.xml");
    expect(slide).toContain("<p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"FFFFFF\"></a:srgbClr></a:solidFill><a:effectLst/></p:bgPr></p:bg>");
    expect(slide.indexOf("<p:bg>")).toBeLessThan(slide.indexOf("<p:spTree>"));
  });

  it("preserves a distinctive page background through LibreOffice rasterization", async () => {
    const document = parseDesignDocument({
      id: "red-background",
      title: "Red background",
      canvas: { width: 320, height: 180 },
      pages: [{ id: "red", name: "Red", background: "#D71920", layers: [] }],
    });
    const result = await exportDocument(document, { format: "pptx" });
    const pptx = await materializePptx(result.files[0].data, "red-background.pptx");
    const raster = await renderFirstSlideWithLibreOffice(pptx);

    expect(pixelAt(raster, 5, 5)).toEqual([215, 25, 32, 255]);
  });

  it("keeps white text visible on the QA-approved dark page background after conversion", async () => {
    const document = parseDesignDocument({
      id: "dark-text-regression",
      title: "Dark text regression",
      canvas: { width: 720, height: 405 },
      pages: [{
        id: "dark", name: "Dark", background: "#123456",
        layers: [{
          id: "white-copy", type: "text", frame: { x: 10, y: 96, width: 700, height: 144 },
          text: "VISIBLE", fontFamily: "Arial", fontSize: 20, color: "#FFFFFF", align: "middle",
        }],
      }],
    });
    const result = await exportDocument(document, { format: "pptx" });
    const pptx = await materializePptx(result.files[0].data, "dark-text-regression.pptx");
    const raster = await renderFirstSlideWithLibreOffice(pptx);

    expect(pixelAt(raster, 5, 5)).toEqual([18, 52, 86, 255]);
    expect(hasWhitePixel(raster, 10, 96, 700, 144)).toBe(true);
  });

  it("maps A4 millimetres to the exact PresentationML EMU slide size", async () => {
    const document = parseDesignDocument({
      id: "a4-slide",
      title: "A4",
      canvas: { width: 210, height: 297, unit: "mm" },
      pages: [{ id: "a4", name: "A4", background: "#FFFFFF", layers: [] }],
    });
    const result = await exportDocument(document, { format: "pptx" });
    const pptx = await materializePptx(result.files[0].data, "a4.pptx");
    const presentation = readZipPart(pptx, "ppt/presentation.xml");

    // ISO A4: 210mm * 36,000 and 297mm * 36,000 EMU.
    expect(presentation).toContain("<p:sldSz cx=\"7560000\" cy=\"10692000\"");
    expect(inspectWithPython(pptx)).toContain("XML_OK");
  });

  it("creates one editable slide and text part for every document page", async () => {
    const result = await exportDocument(presentationDocument(3), { format: "pptx" });
    const pptx = await materializePptx(result.files[0].data, "three-slides.pptx");

    for (const index of [1, 2, 3]) {
      const slide = readZipPart(pptx, `ppt/slides/slide${index}.xml`);
      expect(slide).toContain(index === 1 ? "한국어 헤드라인" : `페이지 ${index} 텍스트`);
    }
    expect(inspectWithPython(pptx)).toContain("parts=15");
  });

  it("embeds image media and resolves the picture relationship", async () => {
    const png = new PNG({ width: 1, height: 1 });
    png.data.set([0, 166, 83, 255]);
    const dataUri = pngDataUri(png);
    const document = parseDesignDocument({
      id: "image-slide",
      title: "Image",
      canvas: { width: 160, height: 90 },
      pages: [{
        id: "image-page",
        name: "Image",
        background: "#FFFFFF",
        layers: [{
          id: "image",
          type: "image",
          source: "pixel.png",
          frame: { x: 0, y: 0, width: 160, height: 90 },
        }],
      }],
    });
    const result = await exportDocument(document, {
      format: "pptx",
      resolveImage: async () => dataUri,
    });
    const pptx = await materializePptx(result.files[0].data, "image.pptx");
    const slide = readZipPart(pptx, "ppt/slides/slide1.xml");
    const rels = readZipPart(pptx, "ppt/slides/_rels/slide1.xml.rels");

    expect(readZipPart(pptx, "ppt/media/image1.png").length).toBeGreaterThan(0);
    expect(slide).toContain("<p:pic>");
    expect(slide).toContain("r:embed=\"rId2\"");
    expect(rels).toContain("Id=\"rId2\"");
    expect(rels).toContain("Target=\"../media/image1.png\"");
    expect(inspectWithPython(pptx)).toContain("SLIDE_REFERENCES_OK count=1");
  });

  it("matches SVG cover cropping in emitted XML and LibreOffice pixels", async () => {
    const dataUri = stripedImage();
    const document = fitDocument("cover");
    const result = await exportDocument(document, {
      format: "pptx",
      resolveImage: async () => dataUri,
    });
    const pptx = await materializePptx(result.files[0].data, "cover-fit.pptx");
    const slide = readZipPart(pptx, "ppt/slides/slide1.xml");
    const [raster, svg] = await Promise.all([
      renderFirstSlideWithLibreOffice(pptx),
      renderFirstSlideFromSvg(document, dataUri),
    ]);

    // A 160×80 source in an 80×80 frame retains its middle 80px: (1 - 1/2) / 2.
    expect(slide).toContain("<a:srcRect l=\"25000\" r=\"25000\"/>");
    expect(slide).toContain("<a:stretch><a:fillRect/></a:stretch>");
    // Old PPTX output stretched the red edge bands into this point. Both renderers crop them.
    expectPixelFromBothRenderers(raster, svg, 15, 50, [0, 0, 255, 255]);
    expectPixelFromBothRenderers(raster, svg, 85, 50, [0, 0, 255, 255]);
  });

  it("matches SVG contain letterboxing in emitted XML and LibreOffice pixels", async () => {
    const dataUri = stripedImage();
    const document = fitDocument("contain");
    const result = await exportDocument(document, {
      format: "pptx",
      resolveImage: async () => dataUri,
    });
    const pptx = await materializePptx(result.files[0].data, "contain-fit.pptx");
    const slide = readZipPart(pptx, "ppt/slides/slide1.xml");
    const [raster, svg] = await Promise.all([
      renderFirstSlideWithLibreOffice(pptx),
      renderFirstSlideFromSvg(document, dataUri),
    ]);

    // `meet` is represented by an 80×40 inner picture at y=30, not by cropping.
    expect(slide).not.toContain("<a:srcRect");
    expect(slide).toContain("<a:off x=\"95250\" y=\"285750\"/>");
    expect(slide).toContain("<a:ext cx=\"762000\" cy=\"381000\"/>");
    expectPixelFromBothRenderers(raster, svg, 15, 50, [255, 0, 0, 255]);
    expectPixelFromBothRenderers(raster, svg, 50, 15, [18, 52, 86, 255]);
    expectPixelFromBothRenderers(raster, svg, 50, 85, [18, 52, 86, 255]);
  });

  it("reads PNG, JPEG, and WebP headers for image fitting and rejects SVG dimensions clearly", async () => {
    const document = parseDesignDocument({
      id: "format-dimensions",
      title: "Format dimensions",
      canvas: { width: 100, height: 100 },
      pages: [{
        id: "page", name: "Page", background: "#FFFFFF", layers: [
          { id: "png", type: "image", source: "png", frame: { x: 0, y: 0, width: 100, height: 100 } },
          { id: "jpeg", type: "image", source: "jpeg", frame: { x: 0, y: 0, width: 100, height: 100 } },
          { id: "webp", type: "image", source: "webp", frame: { x: 0, y: 0, width: 100, height: 100 } },
        ],
      }],
    });
    const png = new PNG({ width: 200, height: 100 });
    const sources = new Map([
      ["png", pngDataUri(png)],
      ["jpeg", jpegHeader(200, 100)],
      ["webp", webpVp8xHeader(200, 100)],
    ]);
    const result = await exportDocument(document, {
      format: "pptx",
      resolveImage: async (source) => sources.get(source)!,
    });
    const pptx = await materializePptx(result.files[0].data, "format-dimensions.pptx");
    const slide = readZipPart(pptx, "ppt/slides/slide1.xml");

    expect((slide.match(/<a:srcRect l="25000" r="25000"\/>/g) ?? [])).toHaveLength(3);
    await expect(exportDocument(parseDesignDocument({
      id: "svg-image", title: "SVG image", canvas: { width: 10, height: 10 },
      pages: [{ id: "page", name: "Page", background: "#FFFFFF", layers: [{
        id: "svg", type: "image", source: "svg", frame: { x: 0, y: 0, width: 10, height: 10 },
      }] }],
    }), {
      format: "pptx",
      resolveImage: async () => "data:image/svg+xml;base64,PHN2Zy8+",
    })).rejects.toThrow("PPTX image fit supports PNG, JPEG, and WebP images; layer svg is SVG");
  });

  it("matches SVG rounded corners in emitted XML and LibreOffice pixels", async () => {
    const document = parseDesignDocument({
      id: "rounded-rectangle",
      title: "Rounded rectangle",
      canvas: { width: 100, height: 100 },
      pages: [{
        id: "page", name: "Page", background: "#123456", layers: [
          { id: "rounded", type: "rect", frame: { x: 10, y: 10, width: 80, height: 80 }, fill: "#FF0000", radius: 20 },
          { id: "capped", type: "rect", frame: { x: 0, y: 90, width: 40, height: 10 }, fill: "#00FF00", radius: 99 },
        ],
      }],
    });
    const result = await exportDocument(document, { format: "pptx" });
    const pptx = await materializePptx(result.files[0].data, "rounded-rectangle.pptx");
    const slide = readZipPart(pptx, "ppt/slides/slide1.xml");
    const [raster, svg] = await Promise.all([
      renderFirstSlideWithLibreOffice(pptx),
      renderFirstSlideFromSvg(document, "data:image/png;base64,iVBORw0KGgo="),
    ]);

    expect(slide).toContain("<a:prstGeom prst=\"roundRect\"><a:avLst><a:gd name=\"adj\" fmla=\"val 50000\"/></a:avLst></a:prstGeom>");
    expect(slide).toContain("<a:gd name=\"adj\" fmla=\"val 100000\"/>");
    // The rounded corner leaves the page visible; the shape centre stays filled.
    expectPixelFromBothRenderers(raster, svg, 11, 11, [18, 52, 86, 255]);
    expectPixelFromBothRenderers(raster, svg, 50, 50, [255, 0, 0, 255]);
  });

  it("writes one document-level .pptx file through the MCP tool", async () => {
    const payload = await exportDesignDocumentTool(
      { document: presentationDocument(2), format: "pptx", outputDirectory: "pptx" },
      { outputRoot: workspace },
    );
    const result = JSON.parse(payload) as { files: Array<{ file: string; bytes: number }> };
    expect(result.files).toHaveLength(1);
    expect(result.files[0].file).toBe("editable-slides.pptx");
    const data = await readFile(path.join(workspace, "pptx", result.files[0].file));
    expect(inspectWithPython(await materializePptx(data, "tool-copy.pptx"))).toContain("ZIP_OK");
  });
});
