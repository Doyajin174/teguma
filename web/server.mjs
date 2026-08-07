/** Local-only bridge between the static editor and the Node design engine. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const design = await import("../dist/design/index.js");
const imageResolver = design.createImageResolver({ root });
const port = Number(process.env.PORT ?? 4173);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ttf": "font/ttf",
};

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw new Error("요청 본문은 2MB를 넘을 수 없습니다.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicTemplates() {
  return design.listTemplates().map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    requiredSlots: template.requiredSlots,
    optionalSlots: template.optionalSlots,
    exampleInput: template.exampleInput,
  }));
}

async function state(document, pageId) {
  const parsed = design.parseDesignDocument(document);
  const page = parsed.pages.find((candidate) => candidate.id === pageId) ?? parsed.pages[0];
  return {
    document: parsed,
    pageId: page.id,
    qa: design.inspectDocument(parsed),
    svg: await design.renderPageToSvg(parsed, page, imageResolver),
  };
}

function staticFile(url) {
  if (url === "/") return path.join(here, "index.html");
  if (url.startsWith("/web/")) return path.join(root, url);
  if (url.startsWith("/assets/fonts/")) return path.join(root, url);
  return undefined;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      const template = design.requireTemplate("card-news-cover");
      const initial = design.instantiateTemplate(template.id, template.exampleInput).document;
      json(response, 200, { ...await state(initial, initial.pages[0].id), templates: publicTemplates(), presets: design.listSizePresets() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/state") {
      const input = await body(request);
      json(response, 200, await state(input.document, input.pageId));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/resize") {
      const input = await body(request);
      const document = design.resizeDocument(design.parseDesignDocument(input.document), input.target);
      json(response, 200, await state(document, input.pageId));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/template") {
      const input = await body(request);
      const result = design.instantiateTemplate(input.templateId, input.slots);
      json(response, 200, await state(result.document, result.document.pages[0].id));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/export") {
      const input = await body(request);
      const document = design.parseDesignDocument(input.document);
      const exported = await design.exportDocument(document, { format: input.format, resolveImage: imageResolver });
      json(response, 200, {
        format: exported.format,
        files: exported.files.map((file, index) => ({
          name: `${document.id}-${file.pageId || index + 1}.${exported.format}`,
          data: file.data.toString("base64"),
        })),
      });
      return;
    }
    if (request.method === "GET") {
      const target = staticFile(url.pathname);
      if (!target) throw Object.assign(new Error("찾을 수 없습니다."), { status: 404 });
      const data = await readFile(target);
      jsonOrFile(response, 200, MIME_TYPES[path.extname(target)] ?? "application/octet-stream", data);
      return;
    }
    throw Object.assign(new Error("지원하지 않는 요청입니다."), { status: 405 });
  } catch (error) {
    json(response, error.status ?? 400, { error: error instanceof Error ? error.message : "알 수 없는 오류" });
  }
});

function jsonOrFile(response, status, type, data) {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(data);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`teguma 웹 에디터: http://127.0.0.1:${port}`);
});
