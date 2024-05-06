import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsFileExtensions = new Set([".js", ".cjs", ".mjs"]);

export function resolveExample(ex: string): string {
  return path.resolve(__dirname, "..", "examples", ex);
}

export function listExamples(...dirs: string[]): string[] {
  const result: string[] = [];
  for (const dir of dirs.map(resolveExample)) {
    for (const name of fs.readdirSync(dir)) {
      const ex = resolveExample(path.join(dir, name));
      if (name !== "node_modules" && fs.lstatSync(ex).isDirectory()) {
        result.push(ex);
      }
    }
  }

  return result;
}

// simple example implementation of how a user may choose to read/filter their bundle files
export function readBundle(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const content = fs.readdirSync(dir);
  for (const file of content) {
    if (jsFileExtensions.has(path.extname(file))) {
      result[file] = fs.readFileSync(path.join(dir, file)).toString();
    }
  }
  return result;
}
