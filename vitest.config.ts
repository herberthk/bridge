import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    reporters: "default",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
