#!/usr/bin/env node
import { program } from "commander";
import path from "path";
import fs from "fs/promises";
import { debundle } from ".";
import {
  saveDebundle,
  ensureDirectory,
  formatBytes,
  formatTime,
} from "./cli-utils";
import { DEFAULT_DEOB_OPTS } from "./utils";
import pc from "picocolors";
import { OpenAIAssistant } from "./openai/client";

const jsFileExtensions = new Set([".js", ".cjs", ".mjs"]);
// use require() to prevent tsc copying package.json into the dist/ folder when building
const { version, description, name } = require("../package.json");

const productName = pc.bold(name);

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
  .option(
    "-f, --filenames <type>",
    "file renaming behaviour. set to a path to a JSON file to use pre-computed renames or 'auto' to use GPT-powered renaming."
  )
  .option("-s, --silent", "silence terminal logging for all operations")
  .option("-v, --verbose", "add extra detail to terminal logging")
  .action(async (baseInDir: string, baseOutDir: string, options: any) => {
    const log = options.silent === true ? () => {} : console.log;
    let time = performance.now();
    const startTime = time;

    function logTask(
      name: string,
      details: [string, string | number][] = []
    ): void {
      const shouldLogDetail = options.verbose;
      log(`${name} ${pc.yellow(`(${formatTime(time)})`)}`);
      if (shouldLogDetail) {
        for (const detail of details) {
          log(pc.gray(`  ↳ ${detail[0]}: ${detail[1]}`));
        }
      }
    }

    const inDir = path.resolve(baseInDir);
    const outDir = path.resolve(baseOutDir);
    await ensureDirectory(inDir, false, false);
    await ensureDirectory(outDir, !!options.clear, true);

    time = performance.now();
    const fileNames = (await fs.readdir(inDir)).filter((a) =>
      jsFileExtensions.has(path.extname(a))
    );
    const files: Record<string, string> = {};
    let totalFileSize = 0;

    await Promise.all(
      fileNames.map(async (name) => {
        const pth = path.join(inDir, name);
        const stat = await fs.stat(pth);
        if (stat.isDirectory()) {
          return;
        }

        return fs.readFile(pth).then((content) => {
          totalFileSize += content.byteLength;
          files[name] = content.toString();
        });
      })
    );
    logTask(`loaded ${Object.keys(files).length} file(s)`, [
      ["src", pc.underline(inDir)],
      ["total size", formatBytes(totalFileSize)],
    ]);

    time = performance.now();
    const deb = debundle(files, options.extension, options.entry);
    logTask(`debundled`, [
      ["chunks", [...deb.allChunks()].length],
      ["modules", [...deb.allModules()].length],
    ]);

    if (options.deobfuscate) {
      let codemodsApplied = 0;
      const opts = DEFAULT_DEOB_OPTS;
      for (const opt in opts) {
        if (opts[opt]) {
          codemodsApplied++;
        }
      }
      time = performance.now();
      deb.deobfuscate();
      logTask(`deobfuscated`, [["codemods applied", codemodsApplied]]);
    }

    if (options.graph) {
      time = performance.now();
      const graph = deb.graph();
      logTask(`graphed`, [
        ["size", graph.size],
        ["order", graph.order],
      ]);
    }

    if (options.filenames === "auto") {
      const openAiClient = new OpenAIAssistant();
      const vs = await openAiClient.getOrCreateVectorStore(deb);
      const renames = await openAiClient.computeFileRenames(vs);
      deb.updateNames(renames);
      logTask("renamed", [["src", `auto (openai: ${openAiClient.model})`]]);
    } else if (options.filenames) {
      // TODO - read precomputed filenames in and apply as needed
    }

    time = performance.now();
    await saveDebundle(outDir, deb);
    logTask(`saved ${[...deb.allModulesAllChunks()].length} file(s)`, [
      ["dst", pc.underline(outDir)],
      ["final uid", deb.getId()],
    ]);

    log(
      pc.blue(`${productName} finished`),
      pc.yellow(`(${formatTime(startTime)})`)
    );
  });

program.parse();
