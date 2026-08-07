import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildPdf,
  exportDocument,
  parseDesignDocument,
  renderPageToSvg,
} from "../src/design/index.js";

interface PdfMetadata {
  author: string | null;
  title: string | null;
}

function documentFor(title: string, pageCount = 1) {
  return parseDesignDocument({
    id: "pdf-test",
    title,
    canvas: { width: 100, height: 50 },
    pages: Array.from({ length: pageCount }, (_, index) => ({
      id: `page-${index + 1}`,
      name: `Page ${index + 1}`,
      background: "#FFFFFF",
      layers: [],
    })),
  });
}

function utf16BeHex(value: string): string {
  let hex = "";
  for (let index = 0; index < value.length; index += 1) {
    hex += value.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  }
  return hex;
}

/** Read metadata through pypdf when present; byte checks remain the portable fallback. */
async function readPdfMetadata(pdf: Buffer): Promise<PdfMetadata | undefined> {
  const directory = await mkdtemp(path.join(tmpdir(), "teguma-pdf-"));
  const file = path.join(directory, "document.pdf");
  await writeFile(file, pdf);

  try {
    const output = execFileSync(
      "python3",
      [
        "-c",
        [
          "from pypdf import PdfReader",
          "import json, sys",
          "metadata = PdfReader(sys.argv[1]).metadata",
          "print(json.dumps({'title': metadata.title, 'author': metadata.author}, ensure_ascii=False))",
        ].join("\n"),
        file,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(output) as PdfMetadata;
  } catch {
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function expectXrefTargets(pdf: Buffer): void {
  const text = pdf.toString("latin1");
  const startxref = text.lastIndexOf("startxref\n");
  expect(startxref).toBeGreaterThanOrEqual(0);
  const xrefOffset = Number(text.slice(startxref + "startxref\n".length).match(/^(\d+)\n%%EOF/)?.[1]);
  expect(Number.isSafeInteger(xrefOffset)).toBe(true);
  expect(pdf.subarray(xrefOffset, xrefOffset + 5).toString("ascii")).toBe("xref\n");

  const lines = pdf.subarray(xrefOffset).toString("latin1").split("\n");
  const count = Number(lines[1].match(/^0\s+(\d+)$/)?.[1]);
  expect(Number.isSafeInteger(count)).toBe(true);

  for (let object = 1; object < count; object += 1) {
    const offset = Number(lines[object + 2].match(/^(\d{10}) 00000 n $/)?.[1]);
    expect(Number.isSafeInteger(offset)).toBe(true);
    expect(pdf.subarray(offset, offset + `${object} 0 obj`.length).toString("ascii")).toBe(
      `${object} 0 obj`,
    );
  }
}

describe("PDF export safety", () => {
  it("round-trips Korean metadata through a PDF parser", async () => {
    const title = "충전비";
    const result = await exportDocument(documentFor(title), { format: "pdf", width: 100 });
    const metadata = await readPdfMetadata(result.files[0].data);

    if (metadata) {
      expect(metadata.title).toBe(title);
    } else {
      expect(result.files[0].data.toString("ascii")).toContain(`<FEFF${utf16BeHex(title)}>`);
    }
  }, 15_000);

  it("cannot inject metadata keys through Unicode low bytes", async () => {
    const title = "\u0129 /Author (INJECTED) \u0128";
    const result = await exportDocument(documentFor(title), { format: "pdf", width: 100 });
    const metadata = await readPdfMetadata(result.files[0].data);

    if (metadata) {
      expect(metadata.title).toBe(title);
      expect(metadata.author).toBeNull();
    } else {
      const text = result.files[0].data.toString("ascii");
      expect(text).toContain(`<FEFF${utf16BeHex(title)}>`);
      expect(text).not.toContain("/Author");
    }
  }, 15_000);

  it("safely preserves ASCII literal-string punctuation", async () => {
    const title = "literal (parentheses) and \\ backslash";
    const result = await exportDocument(documentFor(title), { format: "pdf", width: 100 });
    const metadata = await readPdfMetadata(result.files[0].data);

    if (metadata) {
      expect(metadata.title).toBe(title);
    } else {
      const text = result.files[0].data.toString("ascii");
      expect(text).toContain("literal \\(parentheses\\) and \\\\ backslash");
    }
  }, 15_000);

  it("writes structurally valid xrefs and exact Flate stream lengths", () => {
    const pdf = buildPdf(
      [
        { width: 2, height: 1, rgb: Buffer.from([255, 0, 0, 0, 255, 0]) },
        { width: 2, height: 1, rgb: Buffer.from([0, 0, 255, 255, 255, 255]) },
      ],
      { width: 10, height: 5 },
      "two pages",
    );
    const text = pdf.toString("latin1");

    expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expectXrefTargets(pdf);

    const streamHeaders = [...text.matchAll(/\/Filter \/FlateDecode\s*\/Length (\d+) >>\nstream\n/g)];
    expect(streamHeaders).toHaveLength(2);
    for (const header of streamHeaders) {
      if (header.index === undefined) throw new Error("Missing stream header offset");
      const length = Number(header[1]);
      const streamStart = header.index + header[0].length;
      const streamEnd = streamStart + length;
      expect(pdf.subarray(streamEnd, streamEnd + 10).toString("ascii")).toBe("\nendstream");
      expect(inflateSync(pdf.subarray(streamStart, streamEnd))).toHaveLength(6);
    }
  });

  it("rejects fractional and oversized raster widths", async () => {
    const document = documentFor("width");
    await expect(exportDocument(document, { format: "png", width: 1.5 })).rejects.toThrow(
      /positive and finite integer/,
    );
    await expect(exportDocument(document, { format: "png", width: 8_193 })).rejects.toThrow(
      /must not exceed 8192/,
    );
  });

  it("keeps SVG dimensions native instead of reporting an ignored width", async () => {
    const document = documentFor("svg");
    const native = await exportDocument(document, { format: "svg" });
    expect(native).toMatchObject({ width: 100, height: 50 });
    expect(native.files[0].data.toString("utf8")).toContain('width="100" height="50"');
    await expect(exportDocument(document, { format: "svg", width: 40 })).rejects.toThrow(
      /preserve native canvas dimensions/,
    );
  });

  it("rejects resolver output that could escape an SVG href attribute", async () => {
    const document = parseDesignDocument({
      id: "image-test",
      title: "image",
      canvas: { width: 100, height: 50 },
      pages: [
        {
          id: "page-1",
          name: "Page 1",
          background: "#FFFFFF",
          layers: [
            {
              id: "image-1",
              type: "image",
              source: "asset.png",
              frame: { x: 0, y: 0, width: 10, height: 10 },
            },
          ],
        },
      ],
    });

    await expect(
      renderPageToSvg(
        document,
        document.pages[0],
        async () => 'data:image/png;base64,AAAA"><script>alert(1)</script>',
      ),
    ).rejects.toThrow(/unsupported data URI/);
  });
});
