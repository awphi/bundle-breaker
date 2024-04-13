import path from "path";
import fs from "fs/promises";
import type { AnyFunctionExpression, IifeExpression } from "./types";

import traverse from "@babel/traverse";
import * as t from "@babel/types";

export function isAnyFunctionExpression(
  node: t.Node
): node is AnyFunctionExpression {
  return t.isFunctionExpression(node) || t.isArrowFunctionExpression(node);
}

export function isIIFE(node: t.Node): node is IifeExpression {
  if (t.isExpressionStatement(node)) {
    if (t.isUnaryExpression(node.expression)) {
      return isIIFE(node.expression.argument);
    } else if (t.isCallExpression(node.expression)) {
      return isIIFE(node.expression);
    } else {
      return false;
    }
  }

  return (
    t.isCallExpression(node) &&
    (t.isArrowFunctionExpression(node.callee) ||
      (t.isFunctionExpression(node.callee) && node.callee.id == null))
  );
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

// ensure a directory exists, is a directory, and optionally empty it or create it
export async function ensureDirectory(
  pth: string,
  clear: boolean = false,
  create: boolean = true
): Promise<void> {
  let exists = false;
  try {
    const stat = await fs.stat(pth);
    if (!stat.isDirectory()) {
      await fs.rm(pth, { recursive: true });
    } else {
      exists = true;
    }
  } catch (e) {}

  if (!exists && create) {
    await fs.mkdir(pth, { recursive: true });
  }

  if (clear) {
    const contents = await fs.readdir(pth);
    await Promise.all(
      contents.map((name) => fs.rm(path.join(pth, name), { recursive: true }))
    );
  }
}

export function replaceAstNodes(
  parent: t.Node,
  replacements: Map<t.Node, t.Node>
): void {
  traverse(parent, {
    enter(path) {
      if (replacements.has(path.node)) {
        const v = replacements.get(path.node);
        replacements.delete(path.node);
        path.replaceWith(v);
        if (replacements.size === 0) {
          path.stop();
        }
      }
    },
  });
}

export function maybeUnwrapTopLevelIife(program: t.Program): t.Statement[] {
  // try to extract the actual top-level meat of the program - this should be the require fn, module cache and entry user code IIFE etc.
  if (program.body.length === 1) {
    const iife = program.body[0];
    if (isIIFE(iife) && t.isBlockStatement(iife.expression.callee.body)) {
      return iife.expression.callee.body.body;
    }
  }

  return program.body;
}
