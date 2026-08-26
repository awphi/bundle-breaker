import { parseFile } from "./ast";
import type { FileNode, ParseBundleOptions, RawBundle } from "./types";
import path from "path";

const JS_EXTENSIONS = [".js", ".cjs", ".mjs"];

export function parseBundle(
  inputFiles: Record<string, string>,
  opts?: ParseBundleOptions
): RawBundle {
  const exts = new Set(opts?.extension ?? JS_EXTENSIONS);
  const files = new Map<string, FileNode>();
  for (const [filePath, code] of Object.entries(inputFiles)) {
    if (!exts.has(path.extname(filePath))) {
      continue;
    }
    const node = parseFile(filePath, code);
    files.set(node.id, node);
  }
  return { files };
}

export * from "./types";
