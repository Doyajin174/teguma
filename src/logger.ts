/**
 * Structured logger for teguma MCP server.
 * Outputs JSON lines to stderr (stdout is reserved for MCP protocol).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env.TEGUMA_LOG_LEVEL as LogLevel) ?? "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function createLogger(context: string) {
  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      context,
      msg: message,
      ...data,
    };

    // MCP uses stdout for protocol — logs go to stderr
    process.stderr.write(JSON.stringify(entry) + "\n");
  }

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  };
}
