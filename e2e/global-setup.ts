import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);
const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export default async function setup(): Promise<void> {
  console.log("Building all examples...");
  await execFileAsync(
    PNPM_COMMAND,
    ["--filter", "./e2e/examples/*", "--parallel", "run", "build"],
    { cwd: path.resolve(import.meta.dirname, "..") }
  );
}
