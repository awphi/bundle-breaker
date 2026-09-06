import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
  findEnclosingStatement,
  getIifeBody,
  isNormalMemberExpression,
  referencesBinding,
  type IdentifiedFunctionDeclaration,
} from "../ast";

/**
 * Checks whether `valuePath` references anything besides true globals, the
 * require function itself, or its own locally-bound identifiers - i.e.
 * whether it's safe to relocate verbatim into the runtime shim without
 * dragging along bundler-local closure state (the module registry, cache,
 * chunk-loading tables, ...).
 */
function isSelfContained(
  valuePath: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): boolean {
  let ok = true;

  function check(idPath: NodePath): void {
    if (!ok || !idPath.isReferencedIdentifier()) return;
    if (referencesBinding(idPath, requireFn)) return; // self-reference

    const binding = idPath.scope.getBinding(idPath.node.name);
    if (!binding) return; // true global

    let boundInsideValue = false;
    let p: NodePath | null = binding.path;
    while (p) {
      if (p.node === valuePath.node) {
        boundInsideValue = true;
        break;
      }
      p = p.parentPath;
    }
    if (!boundInsideValue) ok = false;
  }

  if (valuePath.isIdentifier()) {
    check(valuePath);
  } else {
    valuePath.traverse({ Identifier: check });
  }

  return ok;
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
 * whole-statement granularity, falling back to the narrower per-assignment
 * check only when the wrapping statement also contains other, non-
 * declaration statements (i.e. real eager side effects we don't want to
 * drag along, as opposed to safe passive declarations).
 */
export function findRelocatableHelperStatements(
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

      const stmt = findEnclosingStatement(path, topLevelBody);
      if (!stmt) return;

      const list = assignmentsByStatement.get(stmt) ?? [];
      list.push(path);
      assignmentsByStatement.set(stmt, list);
    },
  });

  // reconstruct a self-contained assignment as its own bare statement,
  // rather than cloning its original enclosing statement wholesale - a
  // minifier may have combined several assignments into one comma-sequenced
  // statement, only some of which are self-contained
  function relocateIfSelfContained(
    assignPath: NodePath<t.AssignmentExpression>,
    out: t.Statement[]
  ): void {
    if (isSelfContained(assignPath.get("right") as NodePath, requireFn)) {
      out.push(t.expressionStatement(t.cloneNode(assignPath.node, true)));
    }
  }

  const result: t.Statement[] = [];

  for (const [stmt, assignments] of assignmentsByStatement) {
    const iifeBody = getIifeBody(stmt);

    if (!iifeBody) {
      // a bare `<requireFn>.X = value;` at the top level (WP4's flat shape)
      for (const assignPath of assignments) {
        relocateIfSelfContained(assignPath, result);
      }
      continue;
    }

    const ownAssignmentStatements = new Set(
      assignments
        .map((p) => findEnclosingStatement(p, iifeBody))
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
        relocateIfSelfContained(assignPath, result);
      }
    }
  }

  return result;
}
