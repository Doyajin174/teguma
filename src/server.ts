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
import { PenpotClient } from "./penpot/client.js";
import { createLogger } from "./logger.js";
import { getDesignContextSchema, getDesignContext } from "./tools/get-design-context.js";
import { getTokensSchema, getTokens } from "./tools/get-tokens.js";
import { getComponentsSchema, getComponents } from "./tools/get-components.js";
import { createElementSchema, createElement } from "./tools/create-element.js";
import { getConstraintsSchema, getConstraints } from "./tools/get-constraints.js";
import { getPageLayoutSchema, getPageLayout } from "./tools/get-page-layout.js";
import { importFigmaSchema, importFigma } from "./tools/import-figma.js";
import { updateElementSchema, updateElement } from "./tools/update-element.js";
import { deleteElementSchema, deleteElement } from "./tools/delete-element.js";
import { checkConnection } from "./tools/check-connection.js";

export interface ServerConfig {
  penpotBaseUrl: string;
  penpotToken?: string;
}

export function createServer(config: ServerConfig): McpServer {
  const client = new PenpotClient({
    baseUrl: config.penpotBaseUrl,
    token: config.penpotToken,
  });

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
