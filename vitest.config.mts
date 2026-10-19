import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Tests share one local database: run files one after another.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        // Real API calls with the keys in the environment (a few hundred tokens per model). Run on demand.
        test: { name: "smoke", include: ["tests/smoke/**/*.test.ts"], environment: "node", testTimeout: 60_000 },
      },
    ],
  },
});
