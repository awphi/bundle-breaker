#!/usr/bin/env node
import { program } from "commander";
import path from "path";
import fs from "fs/promises";
import { ensureDirectory } from "./utils";
import { debundle } from ".";

const jsFileExtensions = new Set([".js", ".cjs", ".mjs"]);
// use require() to prevent tsc copying package.json into the dist/ folder when building
const { version, description, name } = require("../package.json");

program
  .name(name)
  .description(description)
  .version(version)
  .argument("<indir>", "Directory containing bundled webpack output")
  .argument("<outdir>", "Directory for the debundled output of this program")
  .option("-e, --entry <file>", "manually specify an entry file to the bundle")
  .option("-c, --clear", "clear the output directory before writing")
  .option(
    "-g, --graph",
    "serialize the module graph in graphology format - https://graphology.github.io/serialization.html#format"
  )
  .option(
    "-v, --visualize",
    "produce a visualization of the bundle's module graph"
  )
  .option("-ext, --extension <ext>", "file extension to use for output", "js")
  .action(async (baseInDir: string, baseOutDir: string, options: any) => {
    const inDir = path.resolve(baseInDir);
    const outDir = path.resolve(baseOutDir);
    await ensureDirectory(inDir, false, false);
    await ensureDirectory(outDir, !!options.clear, true);

    const fileNames = (await fs.readdir(inDir)).filter((a) =>
      jsFileExtensions.has(path.extname(a))
    );
    const files: Record<string, string> = {};

    await Promise.all(
      fileNames.map(async (name) => {
        const pth = path.join(inDir, name);
        const stat = await fs.stat(pth);
        if (stat.isDirectory()) {
          return;
        }

        return fs.readFile(pth).then((content) => {
          files[name] = content.toString();
        });
      })
    );

    const deb = debundle(files, options.entry);
    deb.debug();

    // visualizing requires a graph
    options.graph ||= options.visualize;

    if (options.graph) {
      deb.graph();
    }

    if (options.visualize) {
      deb.visualize();
    }

    deb.save(outDir, options.extension);
  });

program.parse();
