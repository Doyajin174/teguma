import { describe, it, expect } from "vitest";
import { createServer } from "../src/server.js";

describe("MCP Server", () => {
  it("creates server with valid config", () => {
    const server = createServer({
      penpotBaseUrl: "http://localhost:9001",
      penpotToken: "test-token",
    });
    expect(server).toBeDefined();
  });

  it("creates server without token (session auth)", () => {
    const server = createServer({
      penpotBaseUrl: "http://localhost:9001",
    });
    expect(server).toBeDefined();
  });
});
