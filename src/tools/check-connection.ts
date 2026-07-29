import type { PenpotClient } from "../penpot/client.js";

/**
 * Health check tool — verifies Penpot connectivity and auth.
 * Useful for debugging setup issues.
 */
export async function checkConnection(client: PenpotClient) {
  const start = Date.now();

  try {
    const files = await client.listFiles();
    const latency = Date.now() - start;

    return JSON.stringify({
      status: "connected",
      latencyMs: latency,
      filesAccessible: files.length,
      files: files.slice(0, 5).map((f) => ({ id: f.id, name: f.name })),
      hint: files.length === 0
        ? "Connected but no files found. Check team membership or create a file in Penpot."
        : "Ready. Use list_files to see all files, then get_design_context to extract brand context.",
    }, null, 2);
  } catch (err) {
    const latency = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    let suggestion = "Check PENPOT_URL and PENPOT_TOKEN environment variables.";
    if (message.includes("401") || message.includes("403")) {
      suggestion = "Authentication failed. Regenerate your MCP key in Penpot: Account → Integrations → MCP Server.";
    } else if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      suggestion = "Cannot reach Penpot server. Verify PENPOT_URL is correct and the server is running.";
    } else if (message.includes("timeout")) {
      suggestion = "Connection timed out. The Penpot server may be overloaded or unreachable.";
    }

    return JSON.stringify({
      status: "error",
      latencyMs: latency,
      error: message,
      suggestion,
    }, null, 2);
  }
}
