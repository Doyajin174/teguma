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

function parseArgs(): { penpotUrl: string; penpotToken?: string } {
  const args = process.argv.slice(2);
  let penpotUrl = process.env.PENPOT_URL ?? "";
  let penpotToken = process.env.PENPOT_TOKEN;

  for (let i = 0; i < args.length; i++) {
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

const { penpotUrl, penpotToken } = parseArgs();

startServer({ penpotBaseUrl: penpotUrl, penpotToken }).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
