import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/webpack/index.ts", "./src/cli.ts"],
  outDir: "./dist",
  format: ["esm"],
});
