import type { AnyFunctionExpression, IifeCallExpression } from "./types";
import * as t from "@babel/types";

export const MODULES_DIR = "modules";
export const GRAPH_FILE = "graph.gexf";

export function isAnyFunctionExpression(
  node: t.Node
): node is AnyFunctionExpression {
  return t.isFunctionExpression(node) || t.isArrowFunctionExpression(node);
}

export function getIifeCallExpression(
  node: t.Node
): IifeCallExpression | undefined {
  if (t.isExpressionStatement(node)) {
    if (
      t.isUnaryExpression(node.expression) &&
      t.isCallExpression(node.expression.argument) &&
      isAnyFunctionExpression(node.expression.argument.callee)
    ) {
      return node.expression.argument as IifeCallExpression;
    } else if (
      t.isCallExpression(node.expression) &&
      isAnyFunctionExpression(node.expression.callee)
    ) {
      return node.expression as IifeCallExpression;
    }
  }

  return undefined;
}

/**
 * Format bytes as human-readable text.
 * https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 */
export function formatBytes(bytes: number, si = false, dp = 1): string {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return bytes.toFixed(dp) + " " + units[u];
}

export function maybeUnwrapTopLevelIife(program: t.Program): t.Statement[] {
  // try to extract the actual top-level meat of the program - this should be the require fn, module cache and entry user code IIFE etc.
  if (program.body.length === 1) {
    const iife = getIifeCallExpression(program.body[0]);
    if (t.isBlockStatement(iife.callee.body)) {
      return iife.callee.body.body;
    }
  }

  return program.body;
}

// An improved alternative:

// cyrb53 (c) 2018 bryc (github.com/bryc). License: Public domain. Attribution appreciated.
// A fast and simple 64-bit (or 53-bit) string hash function with decent collision resistance.
// Largely inspired by MurmurHash2/3, but with a focus on speed/simplicity.
// See https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript/52171480#52171480
// https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
// An improved, *insecure* 64-bit hash that's short, fast, and has no dependencies.
// Output is always 14 characters.
export function cyrb64Hash(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // For a single 53-bit numeric return value we could return
  // 4294967296 * (2097151 & h2) + (h1 >>> 0);
  // but we instead return the full 64-bit value:
  h2 = h2 >>> 0;
  h1 = h1 >>> 0;
  return h2.toString(36).padStart(7, "0") + h1.toString(36).padStart(7, "0");
}

// simple platform-agnostic (mostly backwards compatible) path.extname
export function extname(pth: string): string {
  const parts = pth.split(".");
  if (parts.length === 1) {
    return "";
  }

  const base = parts.slice(0, -1).join(".");
  const ext = parts[parts.length - 1];

  if (base.length == 0) {
    return "";
  }

  return "." + ext;
}
