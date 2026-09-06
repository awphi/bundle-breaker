import fs from "fs/promises";
import { spawn } from "child_process";
import path from "path";

const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";
export const EXAMLES_DIR: string = path.resolve(
  import.meta.dirname,
  "examples"
);
export const ALL_EXAMPLES: string[] = (await fs.readdir(EXAMLES_DIR)).map(
  exampleDir
);

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

export function exampleDir(example: string): string {
  return path.resolve(EXAMLES_DIR, example, "out");
}

export function exampleName(outDir: string): string {
  return path.basename(path.dirname(outDir));
}

export async function buildAllExamples(): Promise<void> {
  const promises = [];
  const fail: string[] = [];
  const success: string[] = [];

  for (const example of ALL_EXAMPLES) {
    const ex = path.dirname(example);
    promises.push(
      buildExample(ex, true)
        .then(() => success.push(ex))
        .catch(() => fail.push(ex))
    );
  }

  console.log(`Building ${promises.length} example(s)...`);

  await Promise.all(promises);

  console.log(`Built ${success.length} example(s):`);
  for (const ex of success) {
    console.log(` - ${ex}`);
  }
  if (fail.length > 0) {
    throw new Error(
      `Failed to build ${fail.length} example(s): ${JSON.stringify(fail)}`
    );
  }
}
