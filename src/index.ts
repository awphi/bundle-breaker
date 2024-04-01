#!/usr/bin/env node
import { Command } from "commander";
import { makeBundle, writeBundle } from "./unbundle";
import path from "path";
import { version, description, name } from "../package.json";
import { formatBytes } from "./utils";

const program = new Command();

async function unbundle(
  baseInDir: string,
  baseOutDir: string,
  options: any
): Promise<void> {
  const inDir = path.resolve(baseInDir);
  const outDir = path.resolve(baseOutDir);

  const bundle = await makeBundle(inDir, options.entry);
  const fileNames = [...bundle.files.keys()];
  console.log(`Loaded ${fileNames.length} file(s) from ${inDir}.`);
  console.log(` - Files (${fileNames.length}): ${fileNames.join(", ")}`);
  console.log(` - Runtime Chunk: ${bundle.runtimeChunkInfo.chunk.name}`);
  console.log(` - Total size: ${formatBytes(bundle.size)}`);
  console.log(` - Unique modules: ${bundle.modules.size}`);

  await writeBundle(outDir, bundle, !!options.clear, options.extension);
}

program.name(name).description(description).version(version);

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
