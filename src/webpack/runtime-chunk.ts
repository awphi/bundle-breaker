import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
  getIifeCallExpression,
  isIdentifiedFunctionDeclaration,
  isNormalMemberExpression,
  maybeUnwrapTopLevelIife,
  referencesBinding,
  type IdentifiedFunctionDeclaration,
} from "../ast";
import type { FileNode } from "../types";
import type { RuntimeChunkInfo, WebpackModuleMap } from "./types";
import { makeModuleMap } from "./module-map";
import { findShapeAEntryId, findShapeCEntryId } from "./entry";

/**
 * Finds the module-execution call inside the require function's body -
 * confirms this function really is a webpack require function, structurally,
 * without caring what anything is named. Two shapes are matched:
 *  - WP5 (no `.call`): `__webpack_modules__[moduleId](module, exports, require)`
 *    - a direct call whose callee is itself a *computed* member expression
 *      (indexing the module map by a variable id)
 *  - WP4 (`.call`): `modules[moduleId].call(module.exports, module, exports, require)`
 *    - a call to `.call` (non-computed) on a computed member expression
 * The returned member expression (the module-map lookup itself) isn't used
 * by callers today - this only needs to throw when no match is found.
 */
function findModuleMapMemberExprInRequireFn(
  fn: IdentifiedFunctionDeclaration
): t.MemberExpression {
  let result: t.MemberExpression | undefined;

  traverse.cheap(fn, (node) => {
    if (result || !t.isCallExpression(node)) {
      return;
    }
    const callee = node.callee;

    if (t.isMemberExpression(callee, { computed: true })) {
      result = callee;
      return;
    }

    if (
      isNormalMemberExpression(callee) &&
      t.isIdentifier(callee.property, { name: "call" }) &&
      t.isMemberExpression(callee.object, { computed: true })
    ) {
      result = callee.object;
    }
  });

  if (result) {
    return result;
  }

  throw new Error(
    `Unable to find module map member expression in function ${fn.id.name}`
  );
}

function findWebpackRequireFn({
  ast,
  path,
}: FileNode): IdentifiedFunctionDeclaration {
  const body = maybeUnwrapTopLevelIife(ast.program);

  const functionDecs = body.filter((v) => isIdentifiedFunctionDeclaration(v));
  if (functionDecs.length === 0) {
    throw new Error(`Unable to find webpack require function in file ${path}`);
  }

  // most bundles will just have one function declaration (the require fn), however some webpack4 configs with
  // runtime chunk splitting will have multiple, with the *last* function declaration being the require fn
  const functionDec = functionDecs[functionDecs.length - 1];
  findModuleMapMemberExprInRequireFn(functionDec);

  return functionDec;
}

function findRuntimeChunkModuleMap({ ast, path }: FileNode): WebpackModuleMap {
  const iife = getIifeCallExpression(ast.program.body[0]);
  if (ast.program.body.length === 1 && iife && iife.arguments.length == 1) {
    // webpack 4  - the modules included in the runtime chunk are passed as the first and only arg to the main iife
    return makeModuleMap(iife.arguments[0]);
  } else {
    // webpack 5 - there exists a __webpack_modules__ variable in the body
    const body = maybeUnwrapTopLevelIife(ast.program);
    const firstVariableDec = body.find((v) => t.isVariableDeclaration(v));

    // we expect the module map expression to be in the first non-empty variable declaration
    // within that declaration we will look for the first object definition declarator
    if (firstVariableDec) {
      for (const declarator of firstVariableDec.declarations) {
        if (t.isObjectExpression(declarator.init)) {
          return makeModuleMap(declarator.init);
        }
      }
    }
  }

  throw new Error(`Failed to locate module map in file ${path}`);
}

export function findRuntimeChunk(files: readonly FileNode[]): FileNode {
  for (const file of files) {
    try {
      findWebpackRequireFn(file);
      findRuntimeChunkModuleMap(file);
      return file;
    } catch (_) {}
  }

  const names = files.map((f) => f.path).join(", ");
  throw new Error(`Failed to find runtime file in files: ${names}`);
}

/**
 * Checks whether `right` (an assignment's value) references anything besides
 * true globals, the require function itself, or its own locally-bound
 * identifiers - i.e. whether it's safe to relocate verbatim into the runtime
 * shim without dragging along bundler-local closure state (the module
 * registry, cache, chunk-loading tables, ...).
 */
function isSelfContained(
  rightPath: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): boolean {
  let ok = true;

  function check(idPath: NodePath): void {
    if (!ok || !idPath.isReferencedIdentifier()) return;
    if (referencesBinding(idPath, requireFn)) return; // self-reference

    const binding = idPath.scope.getBinding(idPath.node.name);
    if (!binding) return; // true global

    let withinSubtree = false;
    let p: NodePath | null = binding.path;
    while (p) {
      if (p.node === rightPath.node) {
        withinSubtree = true;
        break;
      }
      p = p.parentPath;
    }
    if (!withinSubtree) ok = false;
  }

  if (rightPath.isIdentifier()) {
    check(rightPath);
  } else {
    rightPath.traverse({ Identifier: check });
  }

  return ok;
}

/** Walks up from `path` to the nearest ancestor statement that is itself an
 * element of `body` (a specific, known list of top-level statements). */
function findEnclosingStatementIn(
  path: NodePath,
  body: readonly t.Statement[]
): t.Statement | undefined {
  const stmtPath = path.find(
    (p) => t.isStatement(p.node) && body.includes(p.node as t.Statement)
  );
  return stmtPath ? (stmtPath.node as t.Statement) : undefined;
}

/** If `stmt` is a no-argument IIFE call with a block body, returns that
 * block's own statement list. */
function getIifeBlockBody(stmt: t.Statement): t.Statement[] | undefined {
  const iife = getIifeCallExpression(stmt);
  if (iife && iife.arguments.length === 0 && t.isBlockStatement(iife.callee.body)) {
    return iife.callee.body.body;
  }
  return undefined;
}

/**
 * Structurally collects whole top-level statements safe to relocate verbatim
 * into the runtime shim - wherever a `<requireFn>.<key> = <value>`
 * assignment is found (any depth of wrapping, webpack5 typically wraps each
 * in its own "runtime module" IIFE), no property name is ever checked, only
 * assignment shape and value closure - this holds regardless of webpack
 * version or a custom runtime template renaming/adding/removing properties.
 * `requireFn` identity is checked via scope binding, not name - minifiers
 * routinely reuse the same short name across unrelated scopes.
 *
 * Some properties (e.g. `.t`'s memoization cache, `.O`'s deferred queue)
 * close over private sibling state declared alongside them in the same
 * wrapping IIFE, not just the assignment's own value - so this operates at
 * whole-statement granularity, not bare-assignment granularity, falling back
 * to the narrower per-assignment check only when the wrapping statement also
 * contains other, non-declaration statements (i.e. real eager side effects
 * we don't want to drag along, as opposed to safe passive declarations).
 */
function collectHelperStatements(
  ast: t.File,
  requireFn: IdentifiedFunctionDeclaration,
  topLevelBody: readonly t.Statement[]
): t.Statement[] {
  const assignmentsByStatement = new Map<
    t.Statement,
    NodePath<t.AssignmentExpression>[]
  >();

  traverse(ast, {
    AssignmentExpression(path) {
      const { left, operator } = path.node;
      if (operator !== "=") return;
      if (!isNormalMemberExpression(left)) return;

      const objPath = path.get("left.object") as NodePath;
      if (!objPath.isIdentifier() || !referencesBinding(objPath, requireFn)) {
        return;
      }

      const stmt = findEnclosingStatementIn(path, topLevelBody);
      if (!stmt) return;

      const list = assignmentsByStatement.get(stmt) ?? [];
      list.push(path);
      assignmentsByStatement.set(stmt, list);
    },
  });

  const result: t.Statement[] = [];

  for (const [stmt, assignments] of assignmentsByStatement) {
    const iifeBody = getIifeBlockBody(stmt);

    if (!iifeBody) {
      // a bare `<requireFn>.X = value;` at the top level (WP4's flat shape).
      // Reconstruct from the individual assignment node rather than cloning
      // `stmt` wholesale - a minifier may have combined several assignments
      // into one comma-sequenced statement, and only some of them may be
      // self-contained.
      for (const assignPath of assignments) {
        if (isSelfContained(assignPath.get("right") as NodePath, requireFn)) {
          result.push(
            t.expressionStatement(t.cloneNode(assignPath.node, true))
          );
        }
      }
      continue;
    }

    const ownAssignmentStatements = new Set(
      assignments
        .map((p) => findEnclosingStatementIn(p, iifeBody))
        .filter((s): s is t.Statement => s !== undefined)
    );
    const onlyPassiveDeclarationSiblings = iifeBody.every(
      (s) =>
        ownAssignmentStatements.has(s) ||
        t.isVariableDeclaration(s) ||
        t.isFunctionDeclaration(s)
    );

    if (onlyPassiveDeclarationSiblings) {
      // safe to relocate the whole IIFE - its private sibling declarations
      // (a cache, a small utility) travel with it, in their own scope
      result.push(t.cloneNode(stmt, true));
    } else {
      // the wrapper has other, non-declaration statements (real eager side
      // effects) we don't want to drag along - fall back to relocating only
      // the individual assignments that are independently self-contained
      for (const assignPath of assignments) {
        if (isSelfContained(assignPath.get("right") as NodePath, requireFn)) {
          result.push(
            t.expressionStatement(t.cloneNode(assignPath.node, true))
          );
        }
      }
    }
  }

  return result;
}

/**
 * Walks a (possibly multi-level, possibly computed) member expression chain
 * down to its root and checks that root resolves to `requireFn` - i.e.
 * whether `expr` is `<requireFn>.a.b.c...` for any depth/shape, not just one
 * level deep.
 */
function isRootedAtRequireFn(
  path: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): boolean {
  let current = path;
  while (current.isMemberExpression()) {
    current = current.get("object") as NodePath;
  }
  return current.isIdentifier() && referencesBinding(current, requireFn);
}

/**
 * Whatever top-level statements remain once the require function
 * declaration, module map declaration, helper property assignments and
 * chunk-registration boilerplate (the `import * as X from "./chunk.js";
 * <requireFn>.C(X);` pair used by `chunkFormat: "module"`) are accounted
 * for. Only meaningful when no entry id was found anywhere in the bundle -
 * see entry.ts shape B.
 */
function computeTrailingStatements(
  ast: t.File,
  requireFn: IdentifiedFunctionDeclaration,
  body: readonly t.Statement[]
): t.Statement[] {
  const moduleMapDeclaration = body.find(
    (stmt) =>
      t.isVariableDeclaration(stmt) &&
      stmt.declarations.some((d) => t.isObjectExpression(d.init))
  );

  const namespaceImportLocals = new Set<string>();
  for (const stmt of body) {
    if (t.isImportDeclaration(stmt)) {
      for (const spec of stmt.specifiers) {
        if (t.isImportNamespaceSpecifier(spec)) {
          namespaceImportLocals.add(spec.local.name);
        }
      }
    }
  }

  const boilerplate = new Set<t.Statement>();
  function markBoilerplate(path: NodePath): void {
    const stmt = findEnclosingStatementIn(path, body);
    if (stmt) boilerplate.add(stmt);
  }

  traverse(ast, {
    AssignmentExpression(path) {
      const leftPath = path.get("left") as NodePath;
      if (leftPath.isMemberExpression() && isRootedAtRequireFn(leftPath, requireFn)) {
        markBoilerplate(path);
      }
    },
    CallExpression(path) {
      const calleePath = path.get("callee") as NodePath;
      if (!calleePath.isMemberExpression()) return;
      if (!isRootedAtRequireFn(calleePath, requireFn)) return;

      const args = path.node.arguments;
      const arg = args[0];
      if (args.length === 1 && t.isIdentifier(arg) && namespaceImportLocals.has(arg.name)) {
        markBoilerplate(path);
      }
    },
  });

  return body.filter((stmt) => {
    if (stmt === (requireFn as t.Statement)) return false;
    if (stmt === moduleMapDeclaration) return false;
    // webpack's own compiled output never contains a literal `import` unless
    // it's chunk-registration boilerplate for `chunkFormat: "module"` -
    // source-level imports are always already compiled to require() calls.
    if (t.isImportDeclaration(stmt)) return false;
    if (boilerplate.has(stmt)) return false;
    return true;
  });
}

export function extractRuntimeChunk(file: FileNode): RuntimeChunkInfo {
  const requireFn = findWebpackRequireFn(file);
  const moduleMap = findRuntimeChunkModuleMap(file);
  const topLevelBody = maybeUnwrapTopLevelIife(file.ast.program);
  const helperStatements = collectHelperStatements(
    file.ast,
    requireFn,
    topLevelBody
  );
  const entryId =
    findShapeAEntryId(file.ast, requireFn) ??
    findShapeCEntryId(file.ast, requireFn);
  const trailingStatements =
    entryId === undefined
      ? computeTrailingStatements(file.ast, requireFn, topLevelBody)
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
