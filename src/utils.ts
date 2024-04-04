import path from "path";
import fs from "fs/promises";
import type { AnyFunctionExpression, IifeExpression } from "./types";
import * as recast from "recast";

import r = recast.types.namedTypes;
const n = recast.types.namedTypes;

export function isAnyFunctionExpression(
  node: r.ASTNode
): node is AnyFunctionExpression {
  return (
    n.FunctionExpression.check(node) || n.ArrowFunctionExpression.check(node)
  );
}

export function isIIFE(node: r.ASTNode): node is IifeExpression {
  if (n.ExpressionStatement.check(node)) {
    if (n.UnaryExpression.check(node.expression)) {
      return isIIFE(node.expression.argument);
    } else if (n.CallExpression.check(node.expression)) {
      return isIIFE(node.expression);
    } else {
      return false;
    }
  }

  return (
    n.CallExpression.check(node) &&
    isAnyFunctionExpression(node.callee) &&
    node.callee.id == null
  );
}

export function isSingleExpressionProgram(body: r.Program["body"]): boolean {
  if (body.length === 1) {
    return true;
  }

  if (body.length === 2) {
    const first = body[0];
    if ("directive" in first) {
      return (
        typeof first.directive === "string" && first.directive === "use strict"
      );
    }
  }

  return false;
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

// ensure a directory exists, is a directory and optionall is empty
export async function ensureDirectory(
  pth: string,
  clear: boolean = false,
  create: boolean = true
): Promise<void> {
  let exists = false;
  try {
    const stat = await fs.lstat(pth);
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
  parent: r.ASTNode,
  replacements: Map<r.Node, r.Node>
): void {
  recast.visit(parent, {
    visitNode(path) {
      if (replacements.has(path.node)) {
        const v = replacements.get(path.node);
        replacements.delete(path.node);
        path.replace(v);
        if (replacements.size === 0) {
          return false;
        }
      }

      this.traverse(path);
    },
  });
}
