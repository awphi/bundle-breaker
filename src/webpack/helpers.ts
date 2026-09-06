import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
  findEnclosingStatementAmong,
  getNoArgIifeBody,
  isNormalMemberExpression,
  isSameBinding,
  type IdentifiedFunctionDeclaration,
} from "../ast";

function isFreeOfOuterReferences(
  valuePath: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): boolean {
  let ok = true;

  function check(idPath: NodePath): void {
    if (!ok || !idPath.isReferencedIdentifier()) return;
    if (isSameBinding(idPath, requireFn)) return;

    const binding = idPath.scope.getBinding(idPath.node.name);
    if (!binding) return;

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

function findRequireFnPropertyAssignments(
  ast: t.File,
  requireFn: IdentifiedFunctionDeclaration,
  topLevelBody: readonly t.Statement[]
): Map<t.Statement, NodePath<t.AssignmentExpression>[]> {
  const byStatement = new Map<t.Statement, NodePath<t.AssignmentExpression>[]>();

  traverse(ast, {
    AssignmentExpression(path) {
      const { left, operator } = path.node;
      if (operator !== "=") return;
      if (!isNormalMemberExpression(left)) return;

      const objPath = path.get("left.object") as NodePath;
      if (!objPath.isIdentifier() || !isSameBinding(objPath, requireFn)) {
        return;
      }

      const stmt = findEnclosingStatementAmong(path, topLevelBody);
      if (!stmt) return;

      const list = byStatement.get(stmt) ?? [];
      list.push(path);
      byStatement.set(stmt, list);
    },
  });

  return byStatement;
}

function relocateAssignmentsIfFree(
  assignments: readonly NodePath<t.AssignmentExpression>[],
  requireFn: IdentifiedFunctionDeclaration,
  out: t.Statement[]
): void {
  for (const assignPath of assignments) {
    if (isFreeOfOuterReferences(assignPath.get("right") as NodePath, requireFn)) {
      out.push(t.expressionStatement(t.cloneNode(assignPath.node, true)));
    }
  }
}

function iifeHasOnlyPassiveDeclarationSiblings(
  iifeBody: readonly t.Statement[],
  assignments: readonly NodePath<t.AssignmentExpression>[]
): boolean {
  const ownAssignmentStatements = new Set(
    assignments
      .map((p) => findEnclosingStatementAmong(p, iifeBody))
      .filter((s): s is t.Statement => s !== undefined)
  );
  return iifeBody.every(
    (s) =>
      ownAssignmentStatements.has(s) ||
      t.isVariableDeclaration(s) ||
      t.isFunctionDeclaration(s)
  );
}

export function findRelocatableHelperStatements(
  ast: t.File,
  requireFn: IdentifiedFunctionDeclaration,
  topLevelBody: readonly t.Statement[]
): t.Statement[] {
  const assignmentsByStatement = findRequireFnPropertyAssignments(
    ast,
    requireFn,
    topLevelBody
  );
  const result: t.Statement[] = [];

  for (const [stmt, assignments] of assignmentsByStatement) {
    const iifeBody = getNoArgIifeBody(stmt);

    if (!iifeBody) {
      relocateAssignmentsIfFree(assignments, requireFn, result);
    } else if (iifeHasOnlyPassiveDeclarationSiblings(iifeBody, assignments)) {
      result.push(t.cloneNode(stmt, true));
    } else {
      relocateAssignmentsIfFree(assignments, requireFn, result);
    }
  }

  return result;
}
