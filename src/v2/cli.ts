#!/usr/bin/env node
import { program } from "commander";
import { version, description, name } from "../../package.json";
import { parse, read, save, split } from ".";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-GB", { timeStyle: "medium" });
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

// TODO be a better behaved CLI tool - only log to stderr, something useful in stdout, log-level
// TODO CLI nice-to-haves - e.g. clear output directory
program
  .name(name)
  .description(description)
  .version(version)
  .requiredOption("-o, --out", "output directory")
  .argument("<input>", "bundle directory")
  .action(async (input: string, options: any) => {
    log(`read: reading bundle from ${input}`);
    const files = await read(input);
    log(`read: read ${Object.keys(files).length} file(s)`);

    log(`parse: parsing started`);
    const rawBundle = parse(files);
    log(`parse: parsing complete`);

    log(`split: splitting bundle into modules`);
    const bundle = split(rawBundle);
    log(`split: identified bundle type: ${bundle.adapter}`);
    log(`split: split bundle into ${bundle.files.size} file(s)`);

    if (options.out) {
      log(`save: writing output to ${options.out}`);
      await save(options.out, bundle);
      log(`save: wrote ${bundle.files.size} file(s)`);
    }
  });

program.parse();
