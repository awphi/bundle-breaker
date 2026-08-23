import fs from "fs";
import path from "path";

const jsFileExtensions = new Set([".js", ".cjs", ".mjs"]);

export function resolveExample(ex: string): string {
  return path.resolve(import.meta.dirname, "..", "examples", ex);
}

// examples/ is flat - each example is its own self-contained, version-pinned
// package named e.g. `webpack5_x-splitchunks` or `webpack5_104-terser`. Pass a
// prefix (e.g. "webpack4", "webpack5") to only list examples for that bundler.
export function listExamples(prefix?: string): string[] {
  const dir = resolveExample(".");
  const result: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || (prefix && !name.startsWith(prefix))) {
      continue;
    }
    const ex = resolveExample(name);
    if (fs.lstatSync(ex).isDirectory()) {
      result.push(ex);
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
