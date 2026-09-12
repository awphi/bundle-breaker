import path from "path";
import traverse from "@babel/traverse";
import template from "@babel/template";
import * as t from "@babel/types";
import { stripComments, wrapForTraversal, type AnyFunctionExpression } from "../ast";
import type { FileNode } from "../types";
import { rewriteRequireCalls } from "./rewrite";

const MODULES_DIR = "modules";
export const ENTRY_PATH = "index.js";
export const RUNTIME_SHIM_PATH: string = path.posix.join(
  MODULES_DIR,
  "__webpack_runtime.js"
);

const MODULE_PARAM_NAMES = ["module", "exports", "require"];

function sanitizeModuleId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return sanitized.length > 0 ? sanitized : "_";
}

export function modulePath(id: string): string {
  return path.posix.join(MODULES_DIR, `${sanitizeModuleId(id)}.js`);
}

export function relativeRequirePath(fromPath: string, toPath: string): string {
  const fromDir = path.posix.dirname(fromPath);
  let rel = path.posix.relative(fromDir, toPath);
  if (!rel.startsWith(".")) {
    rel = "./" + rel;
  }
  return rel;
}

function renameParamsPositionally(fn: AnyFunctionExpression): void {
  const wrapper = wrapForTraversal(t.expressionStatement(fn));
  traverse(wrapper, {
    Function(fnPath) {
      if (fnPath.node !== fn) {
        return;
      }
      for (let i = 0; i < fnPath.node.params.length; i++) {
        const param = fnPath.node.params[i];
        const newName = MODULE_PARAM_NAMES[i];
        if (newName && t.isIdentifier(param) && param.name !== newName) {
          fnPath.scope.rename(param.name, newName);
        }
      }
      fnPath.stop();
    },
  });
}

function hoistModuleBody(fn: AnyFunctionExpression): t.Statement[] {
  const cloned = t.cloneNode(fn, true) as AnyFunctionExpression;
  stripComments(cloned);
  renameParamsPositionally(cloned);

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
  return {
    path: filePath,
    ast: rewriteRequireCalls(file, requireFnName, resolveModuleId, shimRequirePath),
  };
}

export function createModuleFile(
  fn: AnyFunctionExpression,
  filePath: string,
  resolveModuleId: (id: string) => string | undefined
): FileNode {
  return createFile(filePath, hoistModuleBody(fn), "require", resolveModuleId);
}

export function createEntryFileFromTrailingCode(
  statements: readonly t.Statement[],
  requireFnName: string,
  resolveModuleId: (id: string) => string | undefined
): FileNode {
  const cloned: t.Statement[] = [];
  for (const statement of statements) {
    const copy = t.cloneNode(statement, true);
    stripComments(copy);
    cloned.push(copy);
  }
  return createFile(ENTRY_PATH, cloned, requireFnName, resolveModuleId);
}

const SHIM_FUNCTION_NAME = "__wp";

function renameToShimFunction(
  stmt: t.Statement,
  requireFnName: string
): t.Statement {
  const cloned = t.cloneNode(stmt, true);
  stripComments(cloned);

  traverse(wrapForTraversal(cloned), {
    Identifier(path) {
      if (path.node.name === requireFnName && path.isReferencedIdentifier()) {
        path.node.name = SHIM_FUNCTION_NAME;
      }
    },
  });

  return cloned;
}

const buildShimPrelude = template.statements(`
  const ID_TO_PATH = %%idToPathTable%%;
  function %%shimName%%(id) {
    const resolved = ID_TO_PATH[id];
    if (resolved === undefined) {
      throw new Error("Unknown webpack module id: " + id);
    }
    return require(resolved);
  }
  module.exports = %%shimName%%;
`);

export function createRuntimeShimFile(
  helperStatements: readonly t.Statement[],
  requireFnName: string,
  idToPath: ReadonlyMap<string, string>,
  shimPath: string
): FileNode {
  const properties: t.ObjectProperty[] = [];
  for (const [id, relativePath] of idToPath) {
    properties.push(t.objectProperty(t.stringLiteral(id), t.stringLiteral(relativePath)));
  }
  const idToPathTable = t.objectExpression(properties);
  const shimName = t.identifier(SHIM_FUNCTION_NAME);
  const [idToPathDecl, shimFn, exportStmt] = buildShimPrelude({
    idToPathTable,
    shimName,
  });

  const statements = [idToPathDecl, shimFn];
  for (const statement of helperStatements) {
    statements.push(renameToShimFunction(statement, requireFnName));
  }
  statements.push(exportStmt);

  return { path: shimPath, ast: t.file(t.program(statements)) };
}
