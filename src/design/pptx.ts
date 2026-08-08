/**
 * Deterministic, editable PresentationML export.
 *
 * PPTX is an OOXML ZIP package. Writing its small, stable core here keeps the
 * export editable without adding a presentation-generation dependency or
 * rasterizing the document into a single slide image.
 */

import { deflateRawSync } from "node:zlib";
import type { Canvas, DesignDocument, DesignLayer, DesignPage, Frame } from "./document.js";
import { escapeXml, type ImageResolver } from "./svg.js";

const EMU_PER_INCH = 914_400;
const PX_PER_INCH = 96;
const EMU_PER_MM = 36_000;
const POINTS_PER_INCH = 72;
const ZIP_DOS_DATE = 0x0021; // 1980-01-01, the earliest ZIP timestamp.

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xEDB8_8320 & -(value & 1));
    }
    table[index] = value >>> 0;
  }
  return table;
})();

interface ZipEntry {
  name: string;
  data: Buffer;
}

interface EmbeddedImage {
  extension: "png" | "jpeg" | "webp" | "svg";
  data: Buffer;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface SlidePart {
  page: DesignPage;
  images: Array<{ relationshipId: string; dimensions: ImageDimensions }>;
}

function crc32(data: Buffer): number {
  let crc = 0xFFFF_FFFF;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xFF];
  }
  return (crc ^ 0xFFFF_FFFF) >>> 0;
}

/**
 * Build a ZIP with fixed DOS times because ZIP otherwise records the current
 * time, which would violate the engine's byte-identical export guarantee.
 */
function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(ZIP_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x0201_4B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(ZIP_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

/**
 * Convert canvas coordinates to EMU so PowerPoint preserves the document's
 * physical size: 914,400 EMU/in ÷ 96 CSS px/in = 9,525 EMU/px, while the
 * defined metric conversion is 36,000 EMU/mm.
 */
export function canvasUnitToEmu(value: number, canvas: Canvas): number {
  const factor = canvas.unit === "mm" ? EMU_PER_MM : EMU_PER_INCH / PX_PER_INCH;
  return Math.round(value * factor);
}

/** Convert model font size to PowerPoint's hundredths of a point. */
function canvasUnitToHundredthsOfPoint(value: number, canvas: Canvas): number {
  const points = canvas.unit === "mm"
    ? value * (POINTS_PER_INCH / 25.4)
    : value * (POINTS_PER_INCH / PX_PER_INCH);
  return Math.max(1, Math.round(points * 100));
}

function hexColor(color: string): string {
  return color.slice(1).toUpperCase();
}

function alphaXml(opacity: number): string {
  return opacity === 1 ? "" : `<a:alpha val="${Math.round(opacity * 100_000)}"/>`;
}

function fillXml(color: string, opacity: number): string {
  return `<a:solidFill><a:srgbClr val="${hexColor(color)}">${alphaXml(opacity)}</a:srgbClr></a:solidFill>`;
}

/**
 * Give every slide its resolved page color instead of inheriting the blank
 * layout/master background. QA evaluates text contrast against this color, so
 * inheritance would allow a valid document to export with a different canvas.
 */
function backgroundXml(color: string): string {
  return `<p:bg><p:bgPr>${fillXml(color, 1)}<a:effectLst/></p:bgPr></p:bg>`;
}

function transformXml(frame: Frame, canvas: Canvas): string {
  return [
    "<a:xfrm>",
    `<a:off x="${canvasUnitToEmu(frame.x, canvas)}" y="${canvasUnitToEmu(frame.y, canvas)}"/>`,
    `<a:ext cx="${canvasUnitToEmu(frame.width, canvas)}" cy="${canvasUnitToEmu(frame.height, canvas)}"/>`,
    "</a:xfrm>",
  ].join("");
}

function nonVisualShapeXml(id: number, name: string): string {
  return [
    "<p:nvSpPr>",
    `<p:cNvPr id="${id}" name="${escapeXml(name)}"/>`,
    "<p:cNvSpPr/>",
    "<p:nvPr/>",
    "</p:nvSpPr>",
  ].join("");
}

function textShapeXml(
  layer: Extract<DesignLayer, { type: "text" }>,
  canvas: Canvas,
  id: number,
): string {
  const alignment = layer.align === "middle" ? "ctr" : layer.align === "end" ? "r" : "l";
  const bold = layer.fontWeight >= 600 ? " b=\"1\"" : "";
  const size = canvasUnitToHundredthsOfPoint(layer.fontSize, canvas);
  const spacing = canvasUnitToHundredthsOfPoint(layer.letterSpacing, canvas);
  const lineSpacing = Math.round(layer.lineHeight * 100_000);
  const paragraphs = layer.text.split("\n").map((line) => [
    `<a:p><a:pPr algn="${alignment}"><a:lnSpc><a:spcPct val="${lineSpacing}"/></a:lnSpc></a:pPr>`,
    `<a:r><a:rPr lang="ko-KR" sz="${size}"${bold} spc="${spacing}" typeface="${escapeXml(layer.fontFamily)}">`,
    fillXml(layer.color, layer.opacity),
    "</a:rPr>",
    `<a:t>${escapeXml(line)}</a:t></a:r></a:p>`,
  ].join(""));

  return [
    "<p:sp>",
    nonVisualShapeXml(id, `Text ${layer.id}`),
    "<p:spPr>",
    transformXml(layer.frame, canvas),
    "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>",
    "</p:spPr>",
    "<p:txBody><a:bodyPr wrap=\"square\" anchor=\"t\" lIns=\"0\" tIns=\"0\" rIns=\"0\" bIns=\"0\"/><a:lstStyle/>",
    paragraphs.join(""),
    "</p:txBody>",
    "</p:sp>",
  ].join("");
}

/**
 * Map the model's absolute radius to DrawingML's roundRect adjustment. `adj`
 * is a 0–100,000 fraction of half the shorter side, so its value is
 * radius / (min(width, height) / 2) × 100,000. Clamping the radius first
 * retains SVG's capsule behavior when callers specify an over-large value.
 */
function rectGeometryXml(layer: Extract<DesignLayer, { type: "rect" }>): string {
  if (layer.radius === 0) return "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>";
  const shorterSide = Math.min(layer.frame.width, layer.frame.height);
  const adjustment = shorterSide === 0
    ? 0
    : Math.round((Math.min(layer.radius, shorterSide / 2) / (shorterSide / 2)) * 100_000);
  return [
    "<a:prstGeom prst=\"roundRect\"><a:avLst>",
    `<a:gd name="adj" fmla="val ${adjustment}"/>`,
    "</a:avLst></a:prstGeom>",
  ].join("");
}

function rectShapeXml(
  layer: Extract<DesignLayer, { type: "rect" }>,
  canvas: Canvas,
  id: number,
): string {
  return [
    "<p:sp>",
    nonVisualShapeXml(id, `Rectangle ${layer.id}`),
    "<p:spPr>",
    transformXml(layer.frame, canvas),
    rectGeometryXml(layer),
    fillXml(layer.fill, layer.opacity),
    "</p:spPr>",
    "</p:sp>",
  ].join("");
}

/**
 * Calculate the source crop for SVG's `preserveAspectRatio="... slice"`.
 * `srcRect` measures removed source fractions in 1/100,000ths: retaining a
 * width of frameAspect / imageAspect therefore removes half of the remainder
 * from each horizontal edge (and the symmetric calculation applies vertically).
 */
function sourceCropXml(layer: Extract<DesignLayer, { type: "image" }>, dimensions: ImageDimensions): string {
  if (layer.fit !== "cover") return "";

  const frameAspect = layer.frame.width / layer.frame.height;
  const imageAspect = dimensions.width / dimensions.height;
  if (imageAspect > frameAspect) {
    const inset = Math.round(((1 - (frameAspect / imageAspect)) / 2) * 100_000);
    return `<a:srcRect l="${inset}" r="${inset}"/>`;
  }
  if (imageAspect < frameAspect) {
    const inset = Math.round(((1 - (imageAspect / frameAspect)) / 2) * 100_000);
    return `<a:srcRect t="${inset}" b="${inset}"/>`;
  }
  return "";
}

/**
 * PPTX has no transparent letterbox fill in `blipFill`. For `contain`, inset
 * the picture's frame and stretch its whole source into that same aspect ratio.
 * The exposed area remains transparent, exactly like SVG's `meet`, so earlier
 * layers or the resolved page background stay visible instead of a new fill.
 */
function pictureFrame(layer: Extract<DesignLayer, { type: "image" }>, dimensions: ImageDimensions): Frame {
  if (layer.fit === "cover") return layer.frame;

  const scale = Math.min(
    layer.frame.width / dimensions.width,
    layer.frame.height / dimensions.height,
  );
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  return {
    x: layer.frame.x + ((layer.frame.width - width) / 2),
    y: layer.frame.y + ((layer.frame.height - height) / 2),
    width,
    height,
  };
}

function pictureXml(
  layer: Extract<DesignLayer, { type: "image" }>,
  canvas: Canvas,
  id: number,
  image: SlidePart["images"][number],
): string {
  return [
    "<p:pic>",
    "<p:nvPicPr>",
    `<p:cNvPr id="${id}" name="${escapeXml(`Image ${layer.id}`)}"/>`,
    "<p:cNvPicPr/><p:nvPr/>",
    "</p:nvPicPr>",
    "<p:blipFill>",
    `<a:blip r:embed="${image.relationshipId}">${layer.opacity === 1 ? "" : `<a:alphaModFix amt="${Math.round(layer.opacity * 100_000)}"/>`}</a:blip>`,
    sourceCropXml(layer, image.dimensions),
    "<a:stretch><a:fillRect/></a:stretch>",
    "</p:blipFill>",
    "<p:spPr>",
    transformXml(pictureFrame(layer, image.dimensions), canvas),
    "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>",
    "</p:spPr>",
    "</p:pic>",
  ].join("");
}

function emptyShapeTree(): string {
  return [
    "<p:spTree>",
    "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
    "<p:grpSpPr/>",
    "</p:spTree>",
  ].join("");
}

function slideXml(part: SlidePart, canvas: Canvas): string {
  const shapes: string[] = [];
  let shapeId = 2;
  let imageIndex = 0;
  for (const layer of part.page.layers) {
    if (layer.type === "text") {
      shapes.push(textShapeXml(layer, canvas, shapeId));
    } else if (layer.type === "rect") {
      shapes.push(rectShapeXml(layer, canvas, shapeId));
    } else {
      shapes.push(pictureXml(layer, canvas, shapeId, part.images[imageIndex]));
      imageIndex += 1;
    }
    shapeId += 1;
  }

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
    `<p:cSld>${backgroundXml(part.page.background)}${emptyShapeTree().replace("</p:spTree>", `${shapes.join("")}</p:spTree>`)}</p:cSld>`,
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
    "</p:sld>",
  ].join("");
}

function relationshipsXml(relationships: Array<{ id: string; type: string; target: string }>): string {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    ...relationships.map((relationship) => `<Relationship Id="${relationship.id}" Type="${relationship.type}" Target="${relationship.target}"/>`),
    "</Relationships>",
  ].join("");
}

function presentationXml(document: DesignDocument): string {
  const masterId = 2_147_483_648;
  const slideIds = document.pages.map((_, index) =>
    `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`,
  );
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
    `<p:sldMasterIdLst><p:sldMasterId id="${masterId}" r:id="rId1"/></p:sldMasterIdLst>`,
    `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>`,
    `<p:sldSz cx="${canvasUnitToEmu(document.canvas.width, document.canvas)}" cy="${canvasUnitToEmu(document.canvas.height, document.canvas)}" type="custom"/>`,
    "<p:notesSz cx=\"6858000\" cy=\"9144000\"/>",
    "</p:presentation>",
  ].join("");
}

function contentTypesXml(slideCount: number): string {
  const slideOverrides = Array.from({ length: slideCount }, (_, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  );
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
    "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
    "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
    "<Default Extension=\"png\" ContentType=\"image/png\"/>",
    "<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>",
    "<Default Extension=\"webp\" ContentType=\"image/webp\"/>",
    "<Default Extension=\"svg\" ContentType=\"image/svg+xml\"/>",
    "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>",
    "<Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>",
    "<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>",
    "<Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>",
    ...slideOverrides,
    "</Types>",
  ].join("");
}

function slideMasterXml(): string {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<p:sldMaster xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
    `<p:cSld name="teguma">${emptyShapeTree()}</p:cSld>`,
    "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>",
    "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst>",
    "<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>",
    "</p:sldMaster>",
  ].join("");
}

function slideLayoutXml(): string {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<p:sldLayout xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" type=\"blank\" preserve=\"1\">",
    `<p:cSld name="Blank">${emptyShapeTree()}</p:cSld>`,
    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>",
    "</p:sldLayout>",
  ].join("");
}

function themeXml(): string {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"teguma\"><a:themeElements>",
    "<a:clrScheme name=\"teguma\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"1F1F1F\"/></a:dk2><a:lt2><a:srgbClr val=\"EEEEEE\"/></a:lt2><a:accent1><a:srgbClr val=\"4472C4\"/></a:accent1><a:accent2><a:srgbClr val=\"ED7D31\"/></a:accent2><a:accent3><a:srgbClr val=\"A5A5A5\"/></a:accent3><a:accent4><a:srgbClr val=\"FFC000\"/></a:accent4><a:accent5><a:srgbClr val=\"5B9BD5\"/></a:accent5><a:accent6><a:srgbClr val=\"70AD47\"/></a:accent6><a:hlink><a:srgbClr val=\"0563C1\"/></a:hlink><a:folHlink><a:srgbClr val=\"954F72\"/></a:folHlink></a:clrScheme>",
    "<a:fontScheme name=\"teguma\"><a:majorFont><a:latin typeface=\"Arial\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont><a:minorFont><a:latin typeface=\"Arial\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme>",
    "<a:fmtScheme name=\"teguma\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"50000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"35000\"><a:schemeClr val=\"phClr\"><a:tint val=\"37000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:tint val=\"15000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"1\"/></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:shade val=\"51000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs><a:gs pos=\"80000\"><a:schemeClr val=\"phClr\"><a:shade val=\"93000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"94000\"/><a:satMod val=\"135000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"0\"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w=\"6350\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln><a:ln w=\"12700\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln><a:ln w=\"19050\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"><a:tint val=\"95000\"/><a:satMod val=\"170000\"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"93000\"/><a:satMod val=\"150000\"/><a:shade val=\"98000\"/><a:lumMod val=\"102000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:tint val=\"98000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"0\"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme>",
    "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>",
  ].join("");
}

function parseEmbeddedImage(value: string, layerId: string): EmbeddedImage {
  const match = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length === 0) {
    throw new Error(`Image resolver returned an unsupported data URI for layer ${layerId}`);
  }
  return {
    extension: match[1] === "svg+xml" ? "svg" : match[1] as EmbeddedImage["extension"],
    data: Buffer.from(match[2], "base64"),
  };
}

function readImageDimensions(image: EmbeddedImage, layerId: string): ImageDimensions {
  if (image.extension === "png") return pngDimensions(image.data, layerId);
  if (image.extension === "jpeg") return jpegDimensions(image.data, layerId);
  if (image.extension === "webp") return webpDimensions(image.data, layerId);
  throw new Error(`PPTX image fit supports PNG, JPEG, and WebP images; layer ${layerId} is SVG`);
}

function validDimensions(width: number, height: number, layerId: string): ImageDimensions {
  if (width === 0 || height === 0) {
    throw new Error(`Image has zero dimensions for layer ${layerId}`);
  }
  return { width, height };
}

/** Read PNG IHDR dimensions directly so fit geometry does not decode image pixels. */
function pngDimensions(data: Buffer, layerId: string): ImageDimensions {
  const signature = "89504e470d0a1a0a";
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== signature
    || data.readUInt32BE(8) !== 13 || data.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`Invalid PNG dimensions for layer ${layerId}`);
  }
  return validDimensions(data.readUInt32BE(16), data.readUInt32BE(20), layerId);
}

/** Read JPEG SOF dimensions while skipping marker payloads; entropy data is never needed. */
function jpegDimensions(data: Buffer, layerId: string): ImageDimensions {
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) {
    throw new Error(`Invalid JPEG dimensions for layer ${layerId}`);
  }
  const startOfFrame = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
  let offset = 2;
  while (offset < data.length) {
    while (data[offset] === 0xFF) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === undefined || marker === 0xD9 || marker === 0xDA) break;
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    if (offset + 2 > data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 8 || offset + length > data.length) break;
    if (startOfFrame.has(marker)) {
      return validDimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3), layerId);
    }
    offset += length;
  }
  throw new Error(`JPEG has no supported SOF dimensions for layer ${layerId}`);
}

function littleEndian24(data: Buffer, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

/** Read WebP VP8, VP8L, or VP8X dimensions from its RIFF chunks without decoding. */
function webpDimensions(data: Buffer, layerId: string): ImageDimensions {
  if (data.length < 20 || data.subarray(0, 4).toString("ascii") !== "RIFF"
    || data.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error(`Invalid WebP dimensions for layer ${layerId}`);
  }
  const end = Math.min(data.length, data.readUInt32LE(4) + 8);
  let offset = 12;
  while (offset + 8 <= end) {
    const type = data.subarray(offset, offset + 4).toString("ascii");
    const length = data.readUInt32LE(offset + 4);
    const content = offset + 8;
    const next = content + length;
    if (next > end) break;
    if (type === "VP8 " && length >= 10 && data[content + 3] === 0x9D
      && data[content + 4] === 0x01 && data[content + 5] === 0x2A) {
      return validDimensions(data.readUInt16LE(content + 6) & 0x3FFF, data.readUInt16LE(content + 8) & 0x3FFF, layerId);
    }
    if (type === "VP8L" && length >= 5 && data[content] === 0x2F) {
      const width = 1 + data[content + 1] + ((data[content + 2] & 0x3F) << 8);
      const height = 1 + (data[content + 2] >> 6) + (data[content + 3] << 2) + ((data[content + 4] & 0x0F) << 10);
      return validDimensions(width, height, layerId);
    }
    if (type === "VP8X" && length >= 10) {
      return validDimensions(littleEndian24(data, content + 4) + 1, littleEndian24(data, content + 7) + 1, layerId);
    }
    offset = next + (length % 2);
  }
  throw new Error(`WebP has no supported VP8, VP8L, or VP8X dimensions for layer ${layerId}`);
}

/**
 * Create one editable PPTX for the entire document. Shapes remain native
 * PresentationML; only image layers are embedded binary media parts.
 */
export async function buildPptx(
  document: DesignDocument,
  resolveImage?: ImageResolver,
): Promise<Buffer> {
  const slides: SlidePart[] = [];
  let imageNumber = 1;
  const media: ZipEntry[] = [];

  for (const page of document.pages) {
    const images: SlidePart["images"] = [];
    for (const layer of page.layers) {
      if (layer.type !== "image") continue;
      if (!resolveImage) {
        throw new Error(`Image layer ${layer.id} requires an image resolver`);
      }
      const image = parseEmbeddedImage(await resolveImage(layer.source), layer.id);
      images.push({
        relationshipId: `rId${images.length + 2}`,
        dimensions: readImageDimensions(image, layer.id),
      });
      media.push({ name: `ppt/media/image${imageNumber}.${image.extension}`, data: image.data });
      imageNumber += 1;
    }
    slides.push({ page, images });
  }

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml(slides.length), "utf8") },
    {
      name: "_rels/.rels",
      data: Buffer.from(relationshipsXml([{
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        target: "ppt/presentation.xml",
      }]), "utf8"),
    },
    { name: "ppt/presentation.xml", data: Buffer.from(presentationXml(document), "utf8") },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: Buffer.from(relationshipsXml([
        {
          id: "rId1",
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
          target: "slideMasters/slideMaster1.xml",
        },
        ...slides.map((_, index) => ({
          id: `rId${index + 2}`,
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
          target: `slides/slide${index + 1}.xml`,
        })),
      ]), "utf8"),
    },
    { name: "ppt/slideMasters/slideMaster1.xml", data: Buffer.from(slideMasterXml(), "utf8") },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: Buffer.from(relationshipsXml([
        {
          id: "rId1",
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
          target: "../slideLayouts/slideLayout1.xml",
        },
        {
          id: "rId2",
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
          target: "../theme/theme1.xml",
        },
      ]), "utf8"),
    },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: Buffer.from(slideLayoutXml(), "utf8") },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: Buffer.from(relationshipsXml([{
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      }]), "utf8"),
    },
    { name: "ppt/theme/theme1.xml", data: Buffer.from(themeXml(), "utf8") },
  ];

  let mediaIndex = 0;
  for (const [index, slide] of slides.entries()) {
    entries.push({
      name: `ppt/slides/slide${index + 1}.xml`,
      data: Buffer.from(slideXml(slide, document.canvas), "utf8"),
    });
    const imageRelationships = slide.images.map(({ relationshipId }) => {
      const mediaPart = media[mediaIndex];
      mediaIndex += 1;
      return {
        id: relationshipId,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        target: `../media/${mediaPart.name.split("/").at(-1)}`,
      };
    });
    entries.push({
      name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      data: Buffer.from(relationshipsXml([
        {
          id: "rId1",
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
          target: "../slideLayouts/slideLayout1.xml",
        },
        ...imageRelationships,
      ]), "utf8"),
    });
  }

  return buildZip([...entries, ...media]);
}
