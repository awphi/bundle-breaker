#!/usr/bin/env node
import { program } from "commander";
import path from "path";
import fs from "fs/promises";
import { ensureDirectory } from "./utils";
import { WebpackDebundle, debundle } from ".";

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
  .option("-g, --graph", "serialize the module graph in GEXF format")
  .option(
    "-d, --deobfuscate",
    "apply code transformations on the output to reverse common obfuscation techniques"
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

    if (options.deobfuscate) {
      deb.deobfuscate();
      if (deb instanceof WebpackDebundle) {
        deb.rewriteImports();
      }
    }

    if (options.graph) {
      deb.graph();
    }

    deb.debug();
    deb.save(outDir, options.extension);
  });

program.parse();
