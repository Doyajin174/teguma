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
import { getDesignContextSchema, getDesignContext } from "./tools/get-design-context.js";
import { getTokensSchema, getTokens } from "./tools/get-tokens.js";
import { getComponentsSchema, getComponents } from "./tools/get-components.js";

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

  return server;
}

export async function startServer(config: ServerConfig): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`teguma MCP server running (Penpot: ${config.penpotBaseUrl})`);
}
