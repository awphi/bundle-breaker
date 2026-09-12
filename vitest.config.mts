import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "bundle-breaker": import.meta.dirname,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...configDefaults.exclude, "e2e/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["e2e/**/*.spec.ts"],
          globalSetup: ["./e2e/global-setup.ts"],
        },
      },
    ],
  },
});
