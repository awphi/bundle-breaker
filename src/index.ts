#!/usr/bin/env node
import { Command } from "commander";
import {
  ensureDirectory,
  formatBytes,
  makeBundle as processBundle,
  writeEntry,
  writeModulesDirectory,
} from "./utils";
import path from "path";
import { version } from "../package.json";

const program = new Command();

async function unbundle(
  baseInDir: string,
  baseOutDir: string,
  options: any
): Promise<void> {
  const inDir = path.resolve(baseInDir);
  const outDir = path.resolve(baseOutDir);
  const moduleDir = path.join(outDir, "modules");

  await Promise.all([
    ensureDirectory(inDir, false),
    ensureDirectory(outDir, !!options.clear).then(() =>
      ensureDirectory(moduleDir, !!options.clear)
    ),
  ]);

  const bundle = await processBundle(inDir, options.entry);
  const fileNames = [...bundle.files.keys()];
  console.log(`Loaded ${fileNames.length} file(s) from ${bundle.dir}.`);
  console.log(` - Files: ${fileNames.join(", ")}`);
  console.log(
    ` - Entry: ${bundle.entry}` + (options.entry ? "" : " (auto-detected)")
  );
  console.log(` - Total size: ${formatBytes(bundle.size)}`);
  console.log(` - Unique modules: ${bundle.modules.size}`);

  await Promise.all([
    writeModulesDirectory(bundle, moduleDir, options.extension),
    writeEntry(bundle, outDir, options.extension),
  ]);
}

program
  .name("webpack-unbundle")
  .description("Utilities to reverse-engineer built webpack bundles.")
  .version(version);

program
  .command("unbundle")
  .description("Unbundle a bundled webpack project into separate files.")
  .argument("<indir>", "Directory containing bundled webpack output")
  .argument("<outdir>", "Directory for the unbundled output of this program")
  .option("-e, --entry <file>", "manually specify an entry file to the bundle")
  .option("-c, --clear", "clear the output directory before writing", true)
  .option("-ext, --extension <ext>", "file extension to use for output", "js")
  .action(unbundle);

program.parse();
