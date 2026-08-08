/**
 * teguma MCP Server
 *
 * Standalone MCP server that provides semantic design tools
 * on top of Penpot's HTTP API. No browser required.
 *
 * Differentiators vs Penpot's built-in MCP:
 * - Works without browser (HTTP API direct)
 * - Brand context compression (10x token reduction)
 * - Semantic tools instead of raw code execution
 * - Layout constraint enforcement
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { PenpotClient } from "./penpot/client.js";
import { createLogger } from "./logger.js";
import { getDesignContextSchema, getDesignContext } from "./tools/get-design-context.js";
import { getTokensSchema, getTokens } from "./tools/get-tokens.js";
import { getComponentsSchema, getComponents } from "./tools/get-components.js";
import { createElementSchema, createElement } from "./tools/create-element.js";
import { getConstraintsSchema, getConstraints } from "./tools/get-constraints.js";
import { getPageLayoutSchema, getPageLayout } from "./tools/get-page-layout.js";
import { importFigmaSchema, importFigma } from "./tools/import-figma.js";
import { importOpenDesignSchema, importOpenDesignTool } from "./tools/import-open-design.js";
import { updateElementSchema, updateElement } from "./tools/update-element.js";
import { deleteElementSchema, deleteElement } from "./tools/delete-element.js";
import { checkConnection } from "./tools/check-connection.js";
import {
  autoLayoutDesignDocumentSchema,
  autoLayoutDesignDocumentTool,
  arrangeDesignLayersSchema,
  arrangeDesignLayersTool,
  createFromTemplateSchema,
  createFromTemplateTool,
  createDesignDocumentSchema,
  createDesignDocumentTool,
  checkDesignPolicySchema,
  checkDesignPolicyTool,
  exportDesignDocumentSchema,
  exportDesignDocumentTool,
  processDesignImageSchema,
  processDesignImageTool,
  listSizePresetsSchema,
  listSizePresetsTool,
  listDesignProjectsSchema,
  listDesignProjectsTool,
  loadDesignProjectSchema,
  loadDesignProjectTool,
  resizeDesignDocumentSchema,
  resizeDesignDocumentTool,
  saveDesignProjectSchema,
  saveDesignProjectTool,
} from "./tools/design-engine.js";

export interface ServerConfig {
  penpotBaseUrl: string;
  penpotToken?: string;
  /**
   * Directory that design exports may write into.
   * Defaults to `<cwd>/teguma-exports` so a stray path cannot escape the project.
   */
  exportRoot?: string;
  /**
   * Directory that persisted design projects may use.
   * Defaults to `<cwd>/teguma-projects` to keep project state local and explicit.
   */
  projectRoot?: string;
}

export function createServer(config: ServerConfig): McpServer {
  const client = new PenpotClient({
    baseUrl: config.penpotBaseUrl,
    token: config.penpotToken,
  });
  const exportRoot = config.exportRoot ?? path.join(process.cwd(), "teguma-exports");
  const projectRoot = config.projectRoot ?? path.join(process.cwd(), "teguma-projects");

  const server = new McpServer({
    name: "teguma",
    version: "0.1.0",
  });

  // --- Tool: get_design_context ---
  server.tool(
    "get_design_context",
    "Extract compressed brand context from a Penpot file. Returns design tokens, components, pages, and layout constraints in a token-efficient format. Use this FIRST to understand the design system before generating any UI.",
    getDesignContextSchema,
    async (args) => {
      try {
        const result = await getDesignContext(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: get_tokens ---
  server.tool(
    "get_tokens",
    "Extract design tokens (colors, typography, spacing) from a Penpot file. Returns structured token data for use in code generation.",
    getTokensSchema,
    async (args) => {
      try {
        const result = await getTokens(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: get_components ---
  server.tool(
    "get_components",
    "List components in a Penpot file with their variants. Use to understand available building blocks before generating UI.",
    getComponentsSchema,
    async (args) => {
      try {
        const result = await getComponents(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: list_files ---
  server.tool(
    "list_files",
    "List Penpot files accessible to the authenticated user. Use to discover available design files.",
    {},
    async () => {
      try {
        const files = await client.listFiles();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: create_element ---
  server.tool(
    "create_element",
    "Create a shape element (rectangle, ellipse, text, board, svg) on a Penpot page. Use get_constraints FIRST to understand layout boundaries before creating elements.",
    createElementSchema,
    async (args) => {
      try {
        const result = await createElement(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: get_constraints ---
  server.tool(
    "get_constraints",
    "Get layout constraints and design guardrails for a Penpot file. Returns spacing scale, color tokens, typography scale, and MUST/MUST NOT rules. Call this BEFORE generating any UI to avoid layout overflow and brand inconsistency.",
    getConstraintsSchema,
    async (args) => {
      try {
        const result = await getConstraints(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: get_page_layout ---
  server.tool(
    "get_page_layout",
    "Get the layout structure of a Penpot page as a compact tree. Shows frame hierarchy, layout types (flex/grid), gaps, and sizing. Use to understand spatial structure before creating or modifying elements.",
    getPageLayoutSchema,
    async (args) => {
      try {
        const result = await getPageLayout(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: import_figma ---
  server.tool(
    "import_figma",
    "Import a Figma file's design system into Penpot. Converts colors, typography, components, and page structure. Use dryRun=true first to preview the conversion before writing.",
    importFigmaSchema,
    async (args) => {
      try {
        const result = await importFigma(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: import_open_design ---
  server.tool(
    "import_open_design",
    "Import an Open Design handoff bundle (manifest.json + SVG entry + optional tokens.css) into a Penpot file. Converts SVG shapes (rect/circle/ellipse/path/text), extracts CSS custom properties to canonical tokens, and reports a structured loss report. Use dryRun=true first to preview the conversion and loss items before writing.",
    importOpenDesignSchema,
    async (args) => {
      try {
        const result = await importOpenDesignTool(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: update_element ---
  server.tool(
    "update_element",
    "Update an existing shape on a Penpot page. Can modify name, position, size, fill color, corner radius, and visibility.",
    updateElementSchema,
    async (args) => {
      try {
        const result = await updateElement(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: delete_element ---
  server.tool(
    "delete_element",
    "Delete a shape from a Penpot page. Use with caution — this is irreversible.",
    deleteElementSchema,
    async (args) => {
      try {
        const result = await deleteElement(client, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: check_connection ---
  server.tool(
    "check_connection",
    "Verify Penpot connectivity and authentication. Run this first if other tools fail. Returns latency, accessible files, and troubleshooting suggestions.",
    {},
    async () => {
      const result = await checkConnection(client);
      return { content: [{ type: "text" as const, text: result }] };
    },
  );

  // --- Tool: list_size_presets ---
  server.tool(
    "list_size_presets",
    "List canvas size presets for social, video, blog, presentation, and print output. Call this before creating a design document so the canvas matches the target channel.",
    listSizePresetsSchema,
    async (args) => {
      try {
        return { content: [{ type: "text" as const, text: listSizePresetsTool(args) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: create_design_document ---
  server.tool(
    "create_design_document",
    "Validate a multi-page design document and return an automated QA report covering canvas bounds, safe area, text contrast, and brand kit compliance. Use this before exporting.",
    createDesignDocumentSchema,
    async (args) => {
      try {
        return { content: [{ type: "text" as const, text: createDesignDocumentTool(args) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: check_design_policy ---
  server.tool(
    "check_design_policy",
    "Evaluate a design document against configurable banned terms, required terms, approval, and workspace capability restrictions. Returns violations and whether export is permitted.",
    checkDesignPolicySchema,
    async (args) => {
      try {
        return { content: [{ type: "text" as const, text: checkDesignPolicyTool(args) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: create_from_template ---
  server.tool(
    "create_from_template",
    "Create an original, parameterized design document from a registered channel template. Returns the completed document, filled slots, and automated QA report.",
    createFromTemplateSchema,
    async (args) => {
      try {
        return { content: [{ type: "text" as const, text: createFromTemplateTool(args) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: autolayout_design_document ---
  server.tool(
    "autolayout_design_document",
    "Hard-wrap overflowing text, shrink it deterministically, then grow its frame inside the safe area or truncate only when requested. Returns the adjusted document, decisions, and QA report.",
    autoLayoutDesignDocumentSchema,
    async (args) => {
      try {
        return { content: [{ type: "text" as const, text: autoLayoutDesignDocumentTool(args) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: arrange_design_layers ---
  server.tool(
    "arrange_design_layers",
    "Arrange selected page layers with deterministic alignment, distribution, measured text stacking, or semantic vertical rhythm. The document canvas safe margin is always respected and the response includes fresh QA.",
    arrangeDesignLayersSchema,
    async (args) => {
      try {
        return { content: [{ type: "text" as const, text: arrangeDesignLayersTool(args) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: resize_design_document ---
  server.tool(
    "resize_design_document",
    "Resize a design document to a preset or explicit dimensions. Mode fill covers the canvas, fit keeps all content visible, original keeps layer sizes and only re-centres.",
    resizeDesignDocumentSchema,
    async (args) => {
      try {
        return { content: [{ type: "text" as const, text: resizeDesignDocumentTool(args) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: export_design_document ---
  server.tool(
    "export_design_document",
    "Export a design document to SVG, PNG, JPG, or multi-page PDF. Export is refused when automated QA fails. Files are written inside the configured export root only.",
    exportDesignDocumentSchema,
    async (args) => {
      try {
        const result = await exportDesignDocumentTool(args, { outputRoot: exportRoot });
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: process_design_image ---
  server.tool(
    "process_design_image",
    "Apply ordered deterministic image operations: exact crop, high-quality scale, solid canvas padding, flat-background flood-fill removal, and transparent-margin trimming. Background removal is classical, not AI matting.",
    processDesignImageSchema,
    async (args) => {
      try {
        const result = await processDesignImageTool(args, { outputRoot: exportRoot });
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: save_design_project ---
  server.tool(
    "save_design_project",
    "Save a reusable design project inside the configured project root. Drafts with QA failures are saved intentionally, and the response always reports their QA status.",
    saveDesignProjectSchema,
    async (args) => {
      try {
        const result = await saveDesignProjectTool(args, { projectRoot });
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: load_design_project ---
  server.tool(
    "load_design_project",
    "Load a saved design project envelope and its normalized document for further editing.",
    loadDesignProjectSchema,
    async (args) => {
      try {
        const result = await loadDesignProjectTool(args, { projectRoot });
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- Tool: list_design_projects ---
  server.tool(
    "list_design_projects",
    "List design projects saved inside the configured project root in deterministic id order.",
    listDesignProjectsSchema,
    async () => {
      try {
        const result = await listDesignProjectsTool({ projectRoot });
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

export async function startServer(config: ServerConfig): Promise<void> {
  const logger = createLogger("server");
  const server = createServer(config);
  const transport = new StdioServerTransport();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info("shutting down", { signal });
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await server.connect(transport);
  logger.info("teguma MCP server running", { penpot: config.penpotBaseUrl });
}
