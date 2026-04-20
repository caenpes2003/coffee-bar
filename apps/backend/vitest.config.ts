import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@coffee-bar/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    root: path.resolve(__dirname),
    include: ["test/**/*.test.ts"],
    globals: true,
    // Integration tests (*.integration.test.ts) share the dev DB and tables,
    // so they cannot run in parallel. File-level parallelism is disabled.
    fileParallelism: false,
  },
});
