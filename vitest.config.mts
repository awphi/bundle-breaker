import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "bundle-breaker": import.meta.dirname,
    },
  },
});
