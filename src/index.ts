#!/usr/bin/env node
import { Command } from "commander";
import { createDebundle as createWebpackDebundle } from "./webpack-debundle";
import path from "path";
import { logDebundleInfo } from "./utils";
import { loadDebundle, saveDebundle } from "./io";

// use require() to prevent tsc copying package.json into the dist/ folder when building
const { version, description, name } = require("../package.json");
const program = new Command();

program.name(name).description(description).version(version);

program
  .command("debundle")
  .aliases(["unbundle", "debund", "unbund"])
  .description("Create a debundle from an existing bundled JS project")
  .argument("<indir>", "Directory containing bundled webpack output")
  .argument("<outdir>", "Directory for the debundled output of this program")
  .option("-e, --entry <file>", "manually specify an entry file to the bundle")
  .option("-c, --clear", "clear the output directory before writing", true)
  .option("-ext, --extension <ext>", "file extension to use for output", "js")
  .action(async (baseInDir: string, baseOutDir: string, options: any) => {
    const inDir = path.resolve(baseInDir);
    const outDir = path.resolve(baseOutDir);

    const debundle = await createWebpackDebundle(inDir, options.entry);
    console.log(`Debundled '${inDir}':`);
    logDebundleInfo(debundle);

    await saveDebundle(outDir, debundle, !!options.clear, options.extension);
    console.log(`\nSaved debundle to '${outDir}'`);
  });

program
  .command("visualize")
  .aliases(["visualise", "viz", "vis"])
  .description("Create a visualization of a debundle")
  .argument("<infile>", "Directory containing a debundle to visualise")
  .argument("<outfile>", "File to output visualization to")
  .action(async (baseInDir: string, baseOutFile: string, options: any) => {
    const inDir = path.resolve(baseInDir);
    const outFile = path.resolve(baseOutFile);

    const debundle = await loadDebundle(inDir);
    console.log(`Loaded debundle from '${inDir}':`);
    logDebundleInfo(debundle);

    // TODO build a module graph, visualize with d3/d3-force etc. and save a picture to disk
  });

program.parse();
