import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  DESIGN_TEMPLATES,
  createImageResolver,
  estimateTextWidth,
  exportDocument,
  findSizePreset,
  instantiateTemplate,
  measureTextBlock,
  renderDocumentToSvg,
  type BrandKit,
} from "../src/design/index.js";
import {
  BUNDLED_DEFAULT_FONT_FILES,
  getFontMetricsDiagnosticsForTesting,
} from "../src/design/fonts.js";
import { createServer } from "../src/server.js";

const FONT_FILES = [
  path.join(process.cwd(), "experiments/company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-Regular.ttf"),
  path.join(process.cwd(), "experiments/company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-SemiBold.ttf"),
];

const NEW_TEMPLATE_IDS = [
  "card-news-closing",
  "presentation-agenda",
  "presentation-metric",
  "instagram-square-quote",
  "blog-header",
  "event-notice",
] as const;

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content.map((item) => item.text).join("\n");
}

function adversarialInput(template: typeof DESIGN_TEMPLATES[number], denseCopy: string) {
  const input = { ...template.exampleInput } as Record<string, unknown>;
  const nonCopySlots = new Set(["imageSource", "accentColor", "bandColor", "panelColor"]);

  for (const slot of [...template.requiredSlots, ...template.optionalSlots]) {
    if (!nonCopySlots.has(slot) && typeof input[slot] === "string") input[slot] = denseCopy;
  }
  return input;
}

function denseAdversarialInputs(): Record<string, Record<string, string>> {
  const denseCopy = "운영 데이터와 현장 맥락을 함께 검토해 다음 행동을 결정합니다. WWWWW 😀\n다음 문장도 같은 넓은 글리프로 검증합니다. ".repeat(24);
  return Object.fromEntries(DESIGN_TEMPLATES.map((template) => [
    template.id,
    adversarialInput(template, denseCopy),
  ])) as Record<string, Record<string, string>>;
}

/**
 * Measure occupied layer frames instead of fixed coordinates so a later scale
 * change still proves that a layout reaches the lower composition zone.
 */
function occupiedBounds(document: ReturnType<typeof instantiateTemplate>["document"]) {
  const frames = document.pages.flatMap((page) => page.layers.map((layer) => layer.frame));
  return {
    bottom: Math.max(...frames.map((frame) => frame.y + frame.height)),
    left: Math.min(...frames.map((frame) => frame.x)),
    right: Math.max(...frames.map((frame) => frame.x + frame.width)),
    top: Math.min(...frames.map((frame) => frame.y)),
  };
}

async function connectClient() {
  const server = createServer({ penpotBaseUrl: "http://localhost:9001" });
  const client = new Client({ name: "template-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => client.close() };
}

describe("design templates", () => {
  it("instantiates every registered template from its Korean example with passing QA", () => {
    for (const template of DESIGN_TEMPLATES) {
      const result = instantiateTemplate(template.id, template.exampleInput);
      expect(result.qa.passed, template.id).toBe(true);
      expect(result.document.canvas).toMatchObject({
        width: findSizePreset(template.canvas)?.width,
        height: findSizePreset(template.canvas)?.height,
      });
    }
  });

  it("names a missing required slot", () => {
    expect(() => instantiateTemplate("card-news-cover", { headline: "제목", body: "본문" }))
      .toThrow(/eyebrow/);
  });

  it("rejects an unknown slot", () => {
    expect(() => instantiateTemplate("youtube-thumbnail", { hook: "한 문장", unknown: true }))
      .toThrow(/unknown/i);
  });

  it("keeps every new template strict while optional copy may be omitted", () => {
    for (const templateId of NEW_TEMPLATE_IDS) {
      const template = DESIGN_TEMPLATES.find((candidate) => candidate.id === templateId);
      expect(template, templateId).toBeDefined();
      if (!template) continue;

      for (const requiredSlot of template.requiredSlots) {
        const missing = { ...template.exampleInput } as Record<string, unknown>;
        delete missing[requiredSlot];
        expect(() => instantiateTemplate(templateId, missing), `${templateId}/${requiredSlot}`)
          .toThrow(new RegExp(requiredSlot));
      }

      expect(() => instantiateTemplate(templateId, { ...template.exampleInput, unknown: true }), templateId)
        .toThrow(/unknown/i);

      const requiredOnly = Object.fromEntries(template.requiredSlots.map((slot) => [
        slot,
        template.exampleInput[slot],
      ]));
      expect(instantiateTemplate(templateId, requiredOnly).qa.passed, `${templateId} optional defaults`).toBe(true);
    }
  });

  it("uses unique ids and only real size presets", () => {
    const ids = DESIGN_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of DESIGN_TEMPLATES) {
      expect(findSizePreset(template.canvas), template.id).toBeDefined();
    }
  });

  it("normalizes an optional brand kit before returning the document", () => {
    const kit: BrandKit = {
      id: "test-kit",
      name: "테스트 브랜드",
      palette: [
        { id: "ink", name: "Ink", value: "#11191D" },
        { id: "paper", name: "Paper", value: "#FFFFFF" },
        { id: "green", name: "Green", value: "#00A653" },
      ],
      fonts: [{ family: "Brand Sans", weights: [400, 700] }],
      logos: [],
    };
    const result = instantiateTemplate("card-news-cover", {
      ...DESIGN_TEMPLATES.find((template) => template.id === "card-news-cover")?.exampleInput,
      brandKit: kit,
    });

    expect(result.document.brandKit).toEqual(kit);
    expect(result.qa.passed).toBe(true);
    for (const layer of result.document.pages[0].layers) {
      if (layer.type === "text") {
        expect(layer.fontFamily).toBe("Brand Sans");
        expect(kit.fonts[0].weights).toContain(layer.fontWeight);
        expect(kit.palette.map((color) => color.value)).toContain(layer.color);
      }
    }
  });

  it("keeps long agent copy within QA-safe text frames through autolayout", () => {
    const result = instantiateTemplate("instagram-story", {
      eyebrow: "SEVASA 에너지 운영 리포트",
      headline: "충전 계획을 더 정확하게 세우는 방법을 현장에서 확인했습니다",
      body: "충전 이력과 시간대별 요금을 함께 보면 같은 전력량에서도 다음 달 비용을 줄일 수 있습니다. ".repeat(10),
    });
    expect(result.qa.passed).toBe(true);
    expect(result.qa.checks.find((check) => check.name === "text-fits-frame-height")?.pass).toBe(true);
  });

  it("gives presentation metric context real line-box headroom", () => {
    const result = instantiateTemplate("presentation-metric", {
      ...DESIGN_TEMPLATES.find((template) => template.id === "presentation-metric")?.exampleInput,
      context: "예약 가능 시간을 먼저 보여준 충전소에서 평균 변화가 확인됐습니다.\n현장 운영 흐름과 예약 전환율을 함께 검토했습니다.\n다음 주 운영 계획에 반영할 수 있는 근거입니다.",
    });
    const context = result.document.pages[0].layers.find((layer) => layer.id === "context");
    expect(context?.type).toBe("text");
    if (context?.type !== "text") throw new Error("presentation metric context is missing");

    const measurement = measureTextBlock(context.text, {
      fontSize: context.fontSize,
      lineHeight: context.lineHeight,
      letterSpacing: context.letterSpacing,
    });
    expect(context.fontSize).toBe(34);
    expect(context.frame.height - measurement.height).toBeGreaterThanOrEqual(32);
  });

  it("keeps event logistics captions on their distributed value columns", () => {
    const template = DESIGN_TEMPLATES.find((candidate) => candidate.id === "event-notice");
    const result = instantiateTemplate("event-notice", template?.exampleInput);
    const layers = result.document.pages[0].layers;
    const layerById = (id: string) => layers.find((layer) => layer.id === id);
    const time = layerById("time");
    const place = layerById("place");
    const timeCaption = layerById("time-caption");
    const placeCaption = layerById("place-caption");

    for (const layer of [time, place, timeCaption, placeCaption]) {
      expect(layer?.type).toBe("text");
    }
    if (!time || !place || !timeCaption || !placeCaption) throw new Error("event logistics layers are missing");

    expect(timeCaption.frame.x).toBe(time.frame.x);
    expect(timeCaption.frame.width).toBe(time.frame.width);
    expect(placeCaption.frame.x).toBe(place.frame.x);
    expect(placeCaption.frame.width).toBe(place.frame.width);
  });

  it("keeps every template QA-clean with dense adversarial copy", () => {
    const adversarialInputs = denseAdversarialInputs();
    const started = process.cpuUsage();

    for (const template of DESIGN_TEMPLATES) {
      const result = instantiateTemplate(template.id, adversarialInputs[template.id]);
      expect(result.qa.passed, template.id).toBe(true);

      if (template.id === "presentation-metric") {
        const context = result.document.pages[0].layers.find((layer) => layer.id === "context");
        expect(context?.type).toBe("text");
        if (context?.type !== "text") throw new Error("presentation metric context is missing");
        const measurement = measureTextBlock(context.text, {
          fontSize: context.fontSize,
          lineHeight: context.lineHeight,
          letterSpacing: context.letterSpacing,
        });
        // Dense slot data must retain a visible buffer, not merely clear QA's
        // zero-height-overflow threshold.
        expect(context.frame.height - measurement.height).toBeGreaterThanOrEqual(16);
      }
    }

    const cpu = process.cpuUsage(started);
    // This is deliberately CPU time rather than wall time: Vitest runs this
    // file beside raster/PDF/JPEG/GIF/PPTX encoders, whose CPU contention can
    // inflate elapsed time without making template layout slower. Cold layout
    // uses at most 1s CPU locally; 5s leaves more than 5x headroom but still
    // rejects the known 15.8s regression from repeated sfnt parsing and wrap
    // rescans. The parse-count assertion below locks the primary root cause.
    expect(cpu.user + cpu.system).toBeLessThan(5_000_000);
  });

  it("parses each bundled font table at most once across dense template layout", () => {
    const inputs = denseAdversarialInputs();
    for (const template of DESIGN_TEMPLATES) {
      instantiateTemplate(template.id, inputs[template.id]);
    }

    const parseCounts = getFontMetricsDiagnosticsForTesting().parseCounts;
    for (const file of BUNDLED_DEFAULT_FONT_FILES) {
      expect(parseCounts.get(file), file).toBe(1);
    }
  });

  it("retains the reviewed bundled-font estimates for the ink samples", () => {
    const samples = [
      ["WWWWW", 445.5, 444],
      ["가W가W가W", 534.9, 528],
      ["iiiii", 125, 111],
      ["가나다라마", 446, 440],
      ["0123456789", 600, 588],
    ] as const;

    for (const [text, expectedEstimate, ink] of samples) {
      const estimate = estimateTextWidth(text, 100, 0, {
        fontFamily: "IBM Plex Sans KR",
        fontWeight: 400,
      });
      expect(estimate, text).toBeCloseTo(expectedEstimate, 1);
      expect(estimate, text).toBeGreaterThanOrEqual(ink);
    }
  });

  it("anchors card-news and Story compositions into their lower canvas regions", () => {
    for (const templateId of ["card-news-cover", "card-news-slide", "instagram-story"] as const) {
      const template = DESIGN_TEMPLATES.find((candidate) => candidate.id === templateId);
      expect(template, templateId).toBeDefined();
      const result = instantiateTemplate(templateId, template?.exampleInput);
      const bounds = occupiedBounds(result.document);

      expect(bounds.bottom / result.document.canvas.height, templateId).toBeGreaterThan(0.85);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(result.document.canvas.width);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every new template a measured, intentional canvas footprint", () => {
    for (const templateId of NEW_TEMPLATE_IDS) {
      const template = DESIGN_TEMPLATES.find((candidate) => candidate.id === templateId);
      expect(template, templateId).toBeDefined();
      if (!template) continue;

      const result = instantiateTemplate(templateId, template.exampleInput);
      const bounds = occupiedBounds(result.document);
      const occupiedWidth = (bounds.right - bounds.left) / result.document.canvas.width;
      const occupiedHeight = (bounds.bottom - bounds.top) / result.document.canvas.height;

      expect(occupiedWidth, `${templateId} width`).toBeGreaterThan(0.55);
      expect(occupiedHeight, `${templateId} height`).toBeGreaterThan(0.65);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(result.document.canvas.width);
      expect(bounds.bottom).toBeLessThanOrEqual(result.document.canvas.height);
    }
  });

  it("keeps generated template SVG free of banned visual grammar", async () => {
    const forbiddenGrammar = /<(?:linearGradient|radialGradient|filter)\b|\bfilter=|drop-shadow|\bstroke=|\srx=/;
    const resolveImage = createImageResolver({ root: process.cwd() });

    for (const template of DESIGN_TEMPLATES) {
      const document = instantiateTemplate(template.id, template.exampleInput).document;
      const [svg] = await renderDocumentToSvg(document, resolveImage);
      expect(svg, template.id).not.toMatch(forbiddenGrammar);
    }
  });

  it("renders the Naver thumbnail to a valid 104px PNG", async () => {
    const { document, qa } = instantiateTemplate(
      "naver-blog-thumbnail",
      DESIGN_TEMPLATES.find((template) => template.id === "naver-blog-thumbnail")?.exampleInput,
    );
    expect(qa.passed).toBe(true);

    const exported = await exportDocument(document, {
      format: "png",
      width: 104,
      fontFiles: FONT_FILES,
      resolveImage: createImageResolver({ root: process.cwd() }),
    });
    const png = PNG.sync.read(exported.files[0].data);
    expect(png).toMatchObject({ width: 104, height: 104 });
  });

  it("returns a passing QA report over the create_from_template MCP tool", async () => {
    const { client, close } = await connectClient();
    try {
      const response = await client.callTool({
        name: "create_from_template",
        arguments: {
          templateId: "youtube-thumbnail",
          input: { hook: "충전비, 절반으로", eyebrow: "SEVASA 실험실" },
        },
      });
      const result = JSON.parse(textOf(response));
      expect(result.qa.passed).toBe(true);
      expect(result.filledSlots).toEqual(["hook", "eyebrow"]);
    } finally {
      await close();
    }
  });
});
