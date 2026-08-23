import fs from "fs";
import path from "path";
import { getExampleWebpackMajor } from "../scripts/example-utils";

const jsFileExtensions = new Set([".js", ".cjs", ".mjs"]);

export function resolveExample(ex: string): string {
  return path.resolve(import.meta.dirname, "..", "examples", ex);
}

// examples/ is flat - each example is its own self-contained, version-pinned
// package, e.g. `webpack5_109-splitchunks` or `webpack5_91-terser`. Pass a
// webpack major version (e.g. 4, 5) to only list examples pinned to that
// major - determined by reading each example's own package.json rather than
// its directory name, since the name is just a human-facing label.
export function listExamples(webpackMajor?: number): string[] {
  const dir = resolveExample(".");
  const result: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules") {
      continue;
    }
    const ex = resolveExample(name);
    if (!fs.lstatSync(ex).isDirectory()) {
      continue;
    }
    if (webpackMajor !== undefined && getExampleWebpackMajor(ex) !== webpackMajor) {
      continue;
    }
    result.push(ex);
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
