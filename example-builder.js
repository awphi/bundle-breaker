#!/usr/bin/env node
const { Command } = require("commander");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

function resolveExample(ex) {
  return path.resolve(__dirname, "examples", ex);
}

function getBuildCommand(type) {
  const env = { ...process.env };
  if (type.startsWith("webpack")) {
    if (type === "webpack4") {
      env.NODE_OPTIONS = "--openssl-legacy-provider";
    }

    return {
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["webpack", "-c", "./webpack.config.js"],
      env,
    };
  } else {
    throw new Error(`Unsupported example type '${type}'.`);
  }
}

async function buildExample(dir, silent) {
  if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) {
    throw new Error(`Example at '${dir}' is not a directory.`);
  }

  const type = path.basename(path.dirname(dir));
  const { command, args, env } = getBuildCommand(type);

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
    const exampleDirs = ["webpack4", "webpack5"].map(resolveExample);
    const promises = [];
    const fail = [];
    const success = [];

    for (const dir of exampleDirs) {
      for (const name of fs.readdirSync(dir)) {
        const ex = resolveExample(path.join(dir, name));
        if (name !== "node_modules" && fs.lstatSync(ex).isDirectory()) {
          promises.push(
            buildExample(ex, true)
              .then(() => success.push(ex))
              .catch(() => fail.push(ex))
          );
        }
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
