import type { Bundle, FileNode, ParseBundleOptions, RawBundle } from "./types";
import * as webpack from "./webpack";
import { findDebundler, type Debundler } from "./debundler";
import * as parser from "@babel/parser";
import path from "path";

const JS_EXTENSIONS = [".js", ".cjs", ".mjs"];
const DEBUNDLERS: Debundler[] = [webpack];

// TODO implementation doesn't feel at the right level of abstraction quite yet
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
    files.set(filePath, {
      path: filePath,
      ast: parser.parse(code, {
        sourceType: "unambiguous",
      }),
    });
  }
  return { files };
}

export function split(bundle: RawBundle): Bundle {
  return findDebundler(bundle, DEBUNDLERS).split(bundle);
}

export * from "./types";
