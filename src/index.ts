#!/usr/bin/env node
import { program } from "commander";
import {
  ensureDirectory,
  formatBytes,
  getWebpackModuleMaps,
  makeBundle,
  writeEntry,
  writeModulesDirectory,
} from "./utils.js";
import type { ModuleFnMap } from "./types.js";
import path from "path";

program
  .description("Unbundle a bundled webpack project into separate files.")
  .argument("<indir>", "Directory containing bundled webpack output")
  .argument("<outdir>", "Directory for the unbundled output of this program")
  .option("-e, --entry <file>", "manually specify an entry file to the bundle")
  .option("-c, --clear", "clear the output directory before writing");

program.parse();

const options = program.opts();
const [directoryIn, directoryOut] = program.args.map((a) => path.resolve(a));
const moduleDirectory = path.join(directoryOut, "modules");

await ensureDirectory(directoryOut, !!options.clear);
await ensureDirectory(moduleDirectory, !!options.clear);

const bundle = await makeBundle(directoryIn, options.entry);
const fileNames = Object.keys(bundle.files);
console.log(`Loaded ${fileNames.length} file(s) from ${bundle.dir}.`);
console.log(` - Files: ${fileNames.join(", ")}`);
console.log(
  ` - Entry: ${bundle.entry}` + (options.entry ? "" : " (auto-detected)")
);
console.log(` - Total size: ${formatBytes(bundle.size)}`);

const moduleMap: ModuleFnMap = {};
for (const file of fileNames) {
  const { ast } = bundle.files[file];
  const maps = getWebpackModuleMaps(ast);
  if (maps.length === 0) {
    console.warn(
      `Failed to detect any webpack module maps in file '${file}'. Skipping...`
    );
    continue;
  } else if (maps.length > 1) {
    throw new Error(
      `Detected more than one webpack module map in file '${file}'. This is likely a bug.`
    );
  }

  for (const prop of maps[0].properties) {
    if (prop.key.raw in moduleMap) {
      console.warn(
        `Encountered collision on module ID '${prop.key.raw}'. Skipping...`
      );
      continue;
    }
    moduleMap[prop.key.raw] = prop.value;
  }
}

console.log(` - Unique modules: ${Object.keys(moduleMap).length}`);

await writeModulesDirectory(moduleMap, moduleDirectory);
await writeEntry(bundle, directoryOut);
