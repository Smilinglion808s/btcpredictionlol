import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Archived model suites (e.g. archive/v6-tests) are kept for history only and
// must never run: their source modules were decommissioned with the model.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}", "services/**/*.test.js"],
    // node:test suites (run with `tsx --test`), not vitest suites.
    exclude: [
      "node_modules/**",
      "archive/**",
      "dist/**",
      ".output/**",
      "src/lib/v12/contract.test.ts",
      "src/lib/v12/execution.test.ts",
      "src/lib/v12/live.test.ts",
      "src/lib/v12/freshness.test.ts",
    ],
  },
});
