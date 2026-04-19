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
  },
});
