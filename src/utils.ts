import path from "path";
import fs from "fs/promises";
import type { AnyFunctionExpression, IifeCallExpression } from "./types";

import traverse from "@babel/traverse";
import * as t from "@babel/types";

export const MODULES_DIR = "./modules";
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

// ensure a directory exists, is a directory, and optionally empty it or create it
export async function ensureDirectory(
  pth: string,
  clear: boolean,
  create: boolean
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
