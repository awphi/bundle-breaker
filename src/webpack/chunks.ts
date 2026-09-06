import traverse from "@babel/traverse";
import * as t from "@babel/types";
import {
  getIifeCallExpression,
  isIdentifiedFunctionDeclaration,
  isNormalMemberExpression,
  maybeUnwrapTopLevelIife,
  type IdentifiedFunctionDeclaration,
} from "../ast";
import type { FileNode } from "../types";
import type {
  AdditionalChunkInfo,
  RuntimeChunkInfo,
  WebpackModuleMap,
} from "./types";
import { makeModuleMap, tryMakeModuleMap } from "./module-map";
import { findEntryIdInAdditionalChunk, findEntryIdInRuntimeChunk, findEntryTrailingCode } from "./entry";
import { findRelocatableHelperStatements } from "./helpers";

/**
 * Confirms `fn` really is a webpack require function by finding the
 * module-execution call inside its body, structurally, without caring what
 * anything is named. Two shapes are matched:
 *  - WP5 (no `.call`): `__webpack_modules__[moduleId](module, exports, require)`
 *    - a direct call whose callee is itself a *computed* member expression
 *      (indexing the module map by a variable id)
 *  - WP4 (`.call`): `modules[moduleId].call(module.exports, module, exports, require)`
 *    - a call to `.call` (non-computed) on a computed member expression
 * Throws if neither shape is found anywhere in `fn`.
 */
function assertLooksLikeRequireFunction(
  fn: IdentifiedFunctionDeclaration
): void {
  let found = false;

  traverse.cheap(fn, (node) => {
    if (found || !t.isCallExpression(node)) return;
    const callee = node.callee;

    if (t.isMemberExpression(callee, { computed: true })) {
      found = true;
      return;
    }
    if (
      isNormalMemberExpression(callee) &&
      t.isIdentifier(callee.property, { name: "call" }) &&
      t.isMemberExpression(callee.object, { computed: true })
    ) {
      found = true;
    }
  });

  if (!found) {
    throw new Error(
      `Unable to find module map member expression in function ${fn.id.name}`
    );
  }
}

function findRequireFunction({
  ast,
  path,
}: FileNode): IdentifiedFunctionDeclaration {
  const body = maybeUnwrapTopLevelIife(ast.program);
  const functionDecs = body.filter(isIdentifiedFunctionDeclaration);
  if (functionDecs.length === 0) {
    throw new Error(`Unable to find webpack require function in file ${path}`);
  }

  // most bundles have just one function declaration (the require fn),
  // however some webpack4 configs with runtime chunk splitting have
  // multiple, with the *last* one being the require fn
  const functionDec = functionDecs[functionDecs.length - 1];
  assertLooksLikeRequireFunction(functionDec);
  return functionDec;
}

function findModuleMapInRuntimeChunk({
  ast,
  path,
}: FileNode): WebpackModuleMap {
  const iife = getIifeCallExpression(ast.program.body[0]);
  if (ast.program.body.length === 1 && iife && iife.arguments.length === 1) {
    // webpack 4 - the modules included in the runtime chunk are passed as
    // the first and only arg to the main iife
    return makeModuleMap(iife.arguments[0]);
  }

  // webpack 5 - there exists a __webpack_modules__ variable in the body; we
  // expect the module map expression to be the first object-initialized
  // declarator in the first non-empty variable declaration
  const body = maybeUnwrapTopLevelIife(ast.program);
  const firstVariableDec = body.find((v) => t.isVariableDeclaration(v));
  for (const declarator of firstVariableDec?.declarations ?? []) {
    if (t.isObjectExpression(declarator.init)) {
      return makeModuleMap(declarator.init);
    }
  }

  throw new Error(`Failed to locate module map in file ${path}`);
}

export function findRuntimeChunkFile(files: readonly FileNode[]): FileNode {
  for (const file of files) {
    try {
      findRequireFunction(file);
      findModuleMapInRuntimeChunk(file);
      return file;
    } catch {
      // not the runtime chunk - keep looking
    }
  }

  const names = files.map((f) => f.path).join(", ");
  throw new Error(`Failed to find runtime file in files: ${names}`);
}

export function readRuntimeChunk(file: FileNode): RuntimeChunkInfo {
  const requireFn = findRequireFunction(file);
  const moduleMap = findModuleMapInRuntimeChunk(file);
  const topLevelBody = maybeUnwrapTopLevelIife(file.ast.program);
  const helperStatements = findRelocatableHelperStatements(
    file.ast,
    requireFn,
    topLevelBody
  );
  const entryId = findEntryIdInRuntimeChunk(file.ast, requireFn);
  const trailingStatements =
    entryId === undefined
      ? findEntryTrailingCode(file.ast, requireFn, topLevelBody)
      : [];

  return {
    path: file.path,
    requireFnName: requireFn.id.name,
    moduleMap,
    helperStatements,
    entryId,
    trailingStatements,
  };
}

/**
 * Collects every expression in `program` that *could* be the chunk's module
 * map, across all three known chunk shapes:
 *  - jsonp: `(jsonpArray).push([chunkIds, modules, executeModules?])`
 *  - commonjs (`chunkFormat: "commonjs"`): `exports.<name> = <value>;`
 *  - module (`chunkFormat: "module"`): `export const <name> = <value>;`
 * Candidates are matched by shape only - which property/declaration actually
 * holds the module map is decided later, by content (`tryMakeModuleMap`), not
 * by name.
 */
function findModuleMapCandidates(program: t.Program): t.Expression[] {
  const candidates: t.Expression[] = [];

  for (const stmt of program.body) {
    if (t.isExpressionStatement(stmt)) {
      const expr = stmt.expression;

      if (
        t.isAssignmentExpression(expr) &&
        expr.operator === "=" &&
        isNormalMemberExpression(expr.left)
      ) {
        candidates.push(expr.right);
      }

      if (
        t.isCallExpression(expr) &&
        isNormalMemberExpression(expr.callee) &&
        t.isIdentifier(expr.callee.property, { name: "push" }) &&
        expr.arguments.length === 1 &&
        t.isArrayExpression(expr.arguments[0])
      ) {
        for (const el of expr.arguments[0].elements) {
          if (el && t.isExpression(el)) candidates.push(el);
        }
      }
    }

    if (
      t.isExportNamedDeclaration(stmt) &&
      t.isVariableDeclaration(stmt.declaration)
    ) {
      for (const decl of stmt.declaration.declarations) {
        if (decl.init) candidates.push(decl.init);
      }
    }
  }

  return candidates;
}

export function readAdditionalChunk(
  chunk: FileNode
): AdditionalChunkInfo | undefined {
  const candidates = findModuleMapCandidates(chunk.ast.program);

  let moduleMap: WebpackModuleMap | undefined;
  for (const candidate of candidates) {
    const map = tryMakeModuleMap(candidate);
    if (!map) continue;
    if (moduleMap) {
      throw new Error(
        `Found multiple candidate module maps in chunk ${chunk.path}`
      );
    }
    moduleMap = map;
  }

  if (!moduleMap) return undefined;

  return {
    path: chunk.path,
    moduleMap,
    entryId: findEntryIdInAdditionalChunk(chunk.ast.program),
  };
}
