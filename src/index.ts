#!/usr/bin/env node
/**
 * teguma — AI-native design bridge
 *
 * Usage:
 *   teguma                          # uses env vars
 *   teguma --penpot-url <url>       # explicit Penpot URL
 *
 * Environment variables:
 *   PENPOT_URL    — Penpot instance URL (required)
 *   PENPOT_TOKEN  — Authentication token (required)
 */

import { startServer } from "./server.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PenpotClient } from "./penpot/client.js";
import { importOpenDesign } from "./design/open-design/import.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = getVersion();

function showHelp(): void {
  console.log(`
teguma v${VERSION} — AI-native design bridge

USAGE:
  teguma [options]

OPTIONS:
  --penpot-url <url>     Penpot instance URL (or PENPOT_URL env)
  --penpot-token <key>   Authentication token (or PENPOT_TOKEN env)
  --help, -h             Show this help
  --version, -v          Show version

ENVIRONMENT:
  PENPOT_URL             Penpot instance URL (required)
  PENPOT_TOKEN           MCP key from Penpot Integrations page

MCP TOOLS:
  get_design_context     Extract compressed brand context from a file
  get_tokens             Get design tokens (colors, typography, spacing)
  get_components         List components with variants
  get_constraints        Get layout guardrails (MUST/MUST NOT rules)
  get_page_layout        Get page structure as compact tree
  create_element         Create shapes on a Penpot page
  list_files             List accessible Penpot files
  import_open_design     Import Open Design handoff bundle (SVG + tokens.css)

CLI COMMANDS:
  teguma import-open-design --bundle <dir> [--penpot-file-id <id>] [--dry-run] [--force]

EXAMPLES:
  # Start with env vars
  PENPOT_URL=https://design.example.com PENPOT_TOKEN=xxx teguma

  # Preview Open Design handoff conversion (no writes)
  teguma import-open-design --bundle ./data/fixtures/open-design-handoff --dry-run

  # Import into a Penpot file
  PENPOT_URL=http://192.168.0.183:9001 PENPOT_SESSION_COOKIE=... teguma \\
    import-open-design --bundle ./my-bundle --penpot-file-id <file-id>

  # Claude Code MCP config (.claude/settings.json)
  {
    "mcpServers": {
      "teguma": {
        "command": "npx",
        "args": ["teguma"],
        "env": { "PENPOT_URL": "...", "PENPOT_TOKEN": "..." }
      }
    }
  }
`);
}

function parseArgs(): { penpotUrl: string; penpotToken?: string } {
  const args = process.argv.slice(2);
  let penpotUrl = process.env.PENPOT_URL ?? "";
  let penpotToken = process.env.PENPOT_TOKEN;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      showHelp();
      process.exit(0);
    }
    if (args[i] === "--version" || args[i] === "-v") {
      console.log(`teguma v${VERSION}`);
      process.exit(0);
    }
    if (args[i] === "--penpot-url" && args[i + 1]) {
      penpotUrl = args[i + 1];
      i++;
    }
    if (args[i] === "--penpot-token" && args[i + 1]) {
      penpotToken = args[i + 1];
      i++;
    }
  }

  if (!penpotUrl) {
    console.error("Error: PENPOT_URL environment variable or --penpot-url flag is required.");
    console.error("Example: PENPOT_URL=https://design.example.com PENPOT_TOKEN=xxx teguma");
    process.exit(1);
  }

  return { penpotUrl, penpotToken };
}

async function runImportOpenDesignCli(args: string[]): Promise<void> {
  let bundleDir = "";
  let penpotFileId: string | undefined;
  let dryRun = false;
  let force = false;
  const semanticRoleOverrides: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--bundle" && args[i + 1]) {
      bundleDir = args[i + 1];
      i++;
    } else if (args[i] === "--penpot-file-id" && args[i + 1]) {
      penpotFileId = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--force") {
      force = true;
    } else if (args[i] === "--semantic-role" && args[i + 1]) {
      const [name, role] = args[i + 1].split("=", 2);
      if (name && role) semanticRoleOverrides[name] = role;
      i++;
    }
  }

  if (bundleDir === "") {
    console.error("Error: --bundle <dir> is required for import-open-design");
    process.exit(1);
  }

  const penpotUrl = process.env.PENPOT_URL ?? "";
  if (penpotFileId !== undefined && penpotUrl === "") {
    console.error("Error: PENPOT_URL (또는 --penpot-url) 필요 — Penpot 쓰기 경로");
    process.exit(1);
  }
  const writer = penpotFileId !== undefined && penpotUrl !== ""
    ? new PenpotClient({
        baseUrl: penpotUrl,
        token: process.env.PENPOT_TOKEN,
        sessionCookie: process.env.PENPOT_SESSION_COOKIE,
      })
    : undefined;

  const result = await importOpenDesign({
    bundleDir,
    fileId: penpotFileId,
    dryRun,
    force,
    writer,
    semanticRoleOverrides,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[2] === "import-open-design") {
  runImportOpenDesignCli(process.argv.slice(3)).catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
} else {
const { penpotUrl, penpotToken } = parseArgs();

startServer({ penpotBaseUrl: penpotUrl, penpotToken }).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
}
