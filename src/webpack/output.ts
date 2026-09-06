import path from "path";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { stripComments, type AnyFunctionExpression } from "../ast";
import type { FileNode } from "../types";
import { rewriteRequireCalls } from "./rewrite";

const MODULES_DIR = "modules";
export const ENTRY_PATH = "index.js";
export const RUNTIME_SHIM_PATH: string = path.posix.join(
  MODULES_DIR,
  "__webpack_runtime.js"
);

const MODULE_PARAM_NAMES = ["module", "exports", "require"];

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
function hoistModuleBody(fn: AnyFunctionExpression): t.Statement[] {
  const cloned = t.cloneNode(fn, true) as AnyFunctionExpression;
  stripComments(cloned);
  const wrapper = t.file(t.program([t.expressionStatement(cloned)]));

  traverse(wrapper, {
    Function(fnPath) {
      if (fnPath.node !== cloned) return;
      fnPath.node.params.forEach((param, i) => {
        const newName = MODULE_PARAM_NAMES[i];
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

function createFile(
  filePath: string,
  bodyStatements: t.Statement[],
  requireFnName: string,
  resolveModuleId: (id: string) => string | undefined
): FileNode {
  const file = t.file(t.program(bodyStatements));
  const shimRequirePath = relativeRequirePath(filePath, RUNTIME_SHIM_PATH);
  rewriteRequireCalls(file, requireFnName, resolveModuleId, shimRequirePath);
  return { path: filePath, ast: file };
}

/** Builds a regular module file (`index.js` or `modules/<id>.js`) from its
 * original webpack module function. */
export function createModuleFile(
  fn: AnyFunctionExpression,
  filePath: string,
  resolveModuleId: (id: string) => string | undefined
): FileNode {
  return createFile(filePath, hoistModuleBody(fn), "require", resolveModuleId);
}

/** Builds `index.js` from the runtime chunk's own leftover top-level
 * statements, for bundles with no numbered entry module at all. */
export function createEntryFileFromTrailingCode(
  statements: readonly t.Statement[],
  requireFnName: string,
  resolveModuleId: (id: string) => string | undefined
): FileNode {
  const cloned = statements.map((stmt) => t.cloneNode(stmt, true));
  cloned.forEach(stripComments);
  return createFile(ENTRY_PATH, cloned, requireFnName, resolveModuleId);
}

// ---------------------------------------------------------------------------
// The runtime shim
// ---------------------------------------------------------------------------

const SHIM_FUNCTION_NAME = "__wp";

/**
 * Clones `stmt` and renames every reference to `requireFnName` within it to
 * the shim's own function name - a relocated property that calls back into
 * "the require function" (e.g. `.t`'s `this(value)` branch, or `.O`'s
 * recursive `__webpack_require__.O` self-reference) now means the shim's own
 * callable id->path require function instead.
 */
function renameToShimFunction(
  stmt: t.Statement,
  requireFnName: string
): t.Statement {
  const cloned = t.cloneNode(stmt, true);
  stripComments(cloned);
  const wrapper = t.file(t.program([cloned]));

  traverse(wrapper, {
    Identifier(path) {
      if (path.node.name === requireFnName && path.isReferencedIdentifier()) {
        path.node.name = SHIM_FUNCTION_NAME;
      }
    },
  });

  return cloned;
}

/**
 * Builds the shared `__webpack_runtime.js` file: the relocated
 * `<requireFn>.X = ...` helper statements (verbatim, whatever `X` turned out
 * to be), plus a real callable require-shim backed by an id->relative-path
 * lookup table covering every module in the whole bundle. This is what both
 * the relocated properties (closing back over "the require function") and
 * dynamic/computed require calls elsewhere route through.
 */
export function createRuntimeShimFile(
  helperStatements: readonly t.Statement[],
  requireFnName: string,
  idToPath: ReadonlyMap<string, string>,
  shimPath: string
): FileNode {
  const idToPathTable = t.objectExpression(
    [...idToPath.entries()].map(([id, relativePath]) =>
      t.objectProperty(t.stringLiteral(id), t.stringLiteral(relativePath))
    )
  );

  const statements: t.Statement[] = [
    t.variableDeclaration("const", [
      t.variableDeclarator(t.identifier("ID_TO_PATH"), idToPathTable),
    ]),
    t.functionDeclaration(
      t.identifier(SHIM_FUNCTION_NAME),
      [t.identifier("id")],
      t.blockStatement([
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier("resolved"),
            t.memberExpression(
              t.identifier("ID_TO_PATH"),
              t.identifier("id"),
              true
            )
          ),
        ]),
        t.ifStatement(
          t.binaryExpression(
            "===",
            t.identifier("resolved"),
            t.identifier("undefined")
          ),
          t.throwStatement(
            t.newExpression(t.identifier("Error"), [
              t.binaryExpression(
                "+",
                t.stringLiteral("Unknown webpack module id: "),
                t.identifier("id")
              ),
            ])
          )
        ),
        t.returnStatement(
          t.callExpression(t.identifier("require"), [t.identifier("resolved")])
        ),
      ])
    ),
    ...helperStatements.map((stmt) => renameToShimFunction(stmt, requireFnName)),
    t.expressionStatement(
      t.assignmentExpression(
        "=",
        t.memberExpression(t.identifier("module"), t.identifier("exports")),
        t.identifier(SHIM_FUNCTION_NAME)
      )
    ),
  ];

  return { path: shimPath, ast: t.file(t.program(statements)) };
}
