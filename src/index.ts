#!/usr/bin/env node
import { Command } from "commander";
import { createDebundle as createWebpackDebundle } from "./webpack-debundle";
import path from "path";
import { formatBytes } from "./utils";
import { saveDebundle } from "./io";

// use require() to prevent tsc copying package.json into the dist/ folder when building
const { version, description, name } = require("../package.json");
const program = new Command();

program.name(name).description(description).version(version);

program
  .command("debundle")
  .description("Create a debundle from an existing bundled JS project")
  .argument("<indir>", "Directory containing bundled webpack output")
  .argument("<outdir>", "Directory for the debundled output of this program")
  .option("-e, --entry <file>", "manually specify an entry file to the bundle")
  .option("-c, --clear", "clear the output directory before writing", true)
  .option("-ext, --extension <ext>", "file extension to use for output", "js")
  .action(async (baseInDir: string, baseOutDir: string, options: any) => {
    const inDir = path.resolve(baseInDir);
    const outDir = path.resolve(baseOutDir);

    const bundle = await createWebpackDebundle(inDir, options.entry);
    const fileNames = [...bundle.chunks.keys()];
    console.log(`Loaded ${fileNames.length} file(s) from ${inDir}.`);
    console.log(` - Files (${fileNames.length}): ${fileNames.join(", ")}`);
    console.log(` - Total size: ${formatBytes(bundle.size)}`);
    console.log(` - Unique modules: ${bundle.modules.size}`);

    await saveDebundle(outDir, bundle, !!options.clear, options.extension);
  });

program.parse();
