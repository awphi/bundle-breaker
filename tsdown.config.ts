import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/cli.ts",
    // v2 - will replace above
    "./src/v2/index.ts",
    "./src/v2/webpack/index.ts",
    "./src/v2/cli.ts",
  ],
  outDir: "./dist",
  format: ["esm"],
});
