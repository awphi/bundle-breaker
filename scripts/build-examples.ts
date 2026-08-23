import { Command } from "commander";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";

const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";

function resolveExample(example: string): string {
  return path.resolve(import.meta.dirname, "..", "examples", example);
}

async function buildExample(dir: string, silent: boolean): Promise<void> {
  if (!(await fs.lstat(dir)).isDirectory()) {
    throw new Error(`Example at '${dir}' is not a directory.`);
  }

  return new Promise((res, rej) => {
    const proc = spawn(NPX_COMMAND, ["webpack", "-c", "./webpack.config.js"], {
      cwd: dir,
      env: { ...process.env },
    });

    proc.stderr.on("data", (err) => console.error(err.toString("utf-8")));

    if (!silent) {
      proc.stdout.on("data", (err) => console.log(err.toString("utf-8")));
    }

    proc.on("exit", (code) => {
      if (code === 0) {
        res();
      } else {
        rej();
      }
    });
  });
}

const program = new Command();

program
  .name("example-builder")
  .description("Builds test bundles for bundle-breaker.");

program
  .command("build")
  .description("Build a specific example")
  .argument(
    "<example>",
    "Directory containing the example to build relative to the cwd."
  )
  .action(async (ex) => {
    await buildExample(resolveExample(ex), false);
    console.log(`Built example '${ex}'`);
  });

program
  .command("build-all")
  .description("Build all examples")
  .action(async () => {
    const examplesRoot = resolveExample(".");
    const promises = [];
    const fail: string[] = [];
    const success: string[] = [];

    const entries = await fs.readdir(examplesRoot);
    for (const name of entries) {
      const ex = resolveExample(name);
      promises.push(
        buildExample(ex, true)
          .then(() => success.push(ex))
          .catch(() => fail.push(ex))
      );
    }

    console.log(`Building ${promises.length} example(s)...`);

    await Promise.all(promises);

    console.log(`\nBuilt ${success.length} example(s):`);
    for (const ex of success) {
      console.log(` - ${ex}`);
    }
    if (fail.length > 0) {
      console.log(`Failed to build ${fail.length} example(s):`);
      for (const ex of fail) {
        console.log(` - ${ex}`);
      }
    }
  });

program.parse();
