import { Command } from "commander";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

type CommandDefinition = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

function resolveExample(example: string): string {
  return path.resolve(import.meta.dirname, "..", "examples", example);
}

function getBuildCommand(exampleName: string): CommandDefinition {
  const env = { ...process.env };
  const match = exampleName.match(/^webpack(\d+)/);
  if (!match) {
    throw new Error(`Unsupported example type '${exampleName}'.`);
  }

  if (match[1] === "4") {
    env.NODE_OPTIONS = "--openssl-legacy-provider";
  }

  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["webpack", "-c", "./webpack.config.js"],
    env,
  };
}

async function buildExample(dir: string, silent: boolean): Promise<void> {
  if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) {
    throw new Error(`Example at '${dir}' is not a directory.`);
  }

  const { command, args, env } = getBuildCommand(path.basename(dir));

  return new Promise((res, rej) => {
    const proc = spawn(command, args, {
      cwd: dir,
      env,
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

    for (const name of fs.readdirSync(examplesRoot)) {
      const ex = resolveExample(name);
      if (name !== "node_modules" && fs.lstatSync(ex).isDirectory()) {
        promises.push(
          buildExample(ex, true)
            .then(() => success.push(ex))
            .catch(() => fail.push(ex))
        );
      }
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
