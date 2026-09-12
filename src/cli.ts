#!/usr/bin/env node
import { program } from "commander";
import { version, description, name } from "../package.json";
import { load, save, split } from ".";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-GB", { timeStyle: "medium" });
}

function log(message: string): void {
  console.error(`${timestamp()} ${message}`);
}

// TODO be a better behaved CLI tool - only log to stderr, something useful in stdout, log-level, colors?
// TODO CLI nice-to-haves - e.g. clear output directory, types for options
program
  .name(name)
  .description(description)
  .version(version)
  .requiredOption("-o, --out <directory>", "output directory")
  .argument("<directory>", "bundle directory")
  .action(async (input: string, options: any) => {
    log(`loading: loading bundle from ${input}`);
    const rawBundle = await load(input);
    log(`load: loaded ${rawBundle.files.size} file(s)`);

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
