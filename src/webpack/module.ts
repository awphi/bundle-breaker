import path from "path";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { stripComments, type AnyFunctionExpression } from "../ast";
import type { FileNode } from "../types";
import { applyRequireRewrite, SHIM_IDENTIFIER } from "./rewrite";

const MODULES_DIR = "modules";
export const ENTRY_PATH = "index.js";
export const RUNTIME_SHIM_PATH: string = path.posix.join(
  MODULES_DIR,
  "__webpack_runtime.js"
);

const PARAM_NAMES = ["module", "exports", "require"];

/** Module ids can be plain numbers or short hashed strings - sanitize before
 * using as a filename. */
export function sanitizeModuleId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return sanitized.length > 0 ? sanitized : "_";
}

export function modulePath(id: string): string {
  return path.posix.join(MODULES_DIR, `${sanitizeModuleId(id)}.js`);
}

export function relativeRequirePath(fromPath: string, toPath: string): string {
  const fromDir = path.posix.dirname(fromPath);
  let rel = path.posix.relative(fromDir, toPath);
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

/**
 * Positionally renames a webpack module function's params to
 * `module`/`exports`/`require` (ignoring their original, possibly-minified
 * names) and hoists its body to a flat statement list, ready to become a
 * standalone file's Program body. Uses babel's own scope-aware rename so
 * every reference (including in nested closures) is updated correctly, not
 * just the declaration.
 */
function extractModuleBodyStatements(fn: AnyFunctionExpression): t.Statement[] {
  const cloned = t.cloneNode(fn, true) as AnyFunctionExpression;
  stripComments(cloned);
  const wrapper = t.file(t.program([t.expressionStatement(cloned)]));

  traverse(wrapper, {
    Function(fnPath) {
      if (fnPath.node !== cloned) return;
      fnPath.node.params.forEach((param, i) => {
        const newName = PARAM_NAMES[i];
        if (newName && t.isIdentifier(param) && param.name !== newName) {
          fnPath.scope.rename(param.name, newName);
        }
      });
      fnPath.stop();
    },
  });

  const body = cloned.body;
  return t.isBlockStatement(body) ? body.body : [t.expressionStatement(body)];
}

function finalizeFile(
  filePath: string,
  bodyStatements: t.Statement[],
  requireFnName: string,
  resolveId: (id: string) => string | undefined
): FileNode {
  const file = t.file(t.program(bodyStatements));
  const { usesShim } = applyRequireRewrite(file, requireFnName, resolveId);

  if (usesShim) {
    const shimRequirePath = relativeRequirePath(filePath, RUNTIME_SHIM_PATH);
    file.program.body.unshift(
      t.variableDeclaration("const", [
        t.variableDeclarator(
          t.identifier(SHIM_IDENTIFIER),
          t.callExpression(t.identifier("require"), [
            t.stringLiteral(shimRequirePath),
          ])
        ),
      ])
    );
  }

  return { path: filePath, ast: file };
}

/** Builds a regular module file (`index.js` or `modules/<id>.js`) from its
 * original webpack module function. */
export function buildModuleFile(
  fn: AnyFunctionExpression,
  filePath: string,
  resolveId: (id: string) => string | undefined
): FileNode {
  const bodyStatements = extractModuleBodyStatements(fn);
  return finalizeFile(filePath, bodyStatements, "require", resolveId);
}

/** Builds `index.js` from the runtime chunk's own leftover top-level
 * statements, for bundles with no numbered entry module at all (shape B). */
export function buildEntryFileFromTrailingStatements(
  statements: readonly t.Statement[],
  requireFnName: string,
  resolveId: (id: string) => string | undefined
): FileNode {
  const cloned = statements.map((stmt) => t.cloneNode(stmt, true));
  cloned.forEach(stripComments);
  return finalizeFile(ENTRY_PATH, cloned, requireFnName, resolveId);
}
