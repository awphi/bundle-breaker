#!/usr/bin/env node
import { program } from "commander";
import {
  ensureDirectory,
  formatBytes,
  makeBundle as processBundle,
  writeEntry,
  writeModulesDirectory,
} from "./utils";
import path from "path";

program
  .description("Unbundle a bundled webpack project into separate files.")
  .argument("<indir>", "Directory containing bundled webpack output")
  .argument("<outdir>", "Directory for the unbundled output of this program")
  .option("-e, --entry <file>", "manually specify an entry file to the bundle")
  .option("-c, --clear", "clear the output directory before writing", true)
  .option("-ext, --extension <ext>", "file extension to use for output", "js");

program.parse();

async function main(): Promise<void> {
  const options = program.opts();
  const [directoryIn, directoryOut] = program.args.map((a) => path.resolve(a));
  const moduleDirectory = path.join(directoryOut, "modules");

  await ensureDirectory(directoryOut, !!options.clear);
  await ensureDirectory(moduleDirectory, !!options.clear);

  const bundle = await processBundle(directoryIn, options.entry);
  const fileNames = [...bundle.files.keys()];
  console.log(`Loaded ${fileNames.length} file(s) from ${bundle.dir}.`);
  console.log(` - Files: ${fileNames.join(", ")}`);
  console.log(
    ` - Entry: ${bundle.entry}` + (options.entry ? "" : " (auto-detected)")
  );
  console.log(` - Total size: ${formatBytes(bundle.size)}`);
  console.log(` - Unique modules: ${bundle.modules.size}`);

  await writeModulesDirectory(bundle, moduleDirectory, options.extension);
  await writeEntry(bundle, directoryOut, options.extension);
}

main();
