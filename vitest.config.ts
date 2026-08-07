import { defineConfig } from "vitest/config";

/**
 * Design-engine tests rasterize real PNG and PDF output through resvg, which is
 * far slower than the default 5s per-test budget on cold caches and in CI.
 * The timeout is raised explicitly so a slow machine reports a real failure
 * rather than a spurious timeout.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
