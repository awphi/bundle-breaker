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
    if (!ok || !idPath.isReferencedIdentifier()) {
      return;
    }
    if (isSameBinding(idPath, requireFn)) {
      return;
    }

    const binding = idPath.scope.getBinding(idPath.node.name);
    if (!binding) {
      return;
    }

    let current: NodePath | null = binding.path;
    while (current !== null) {
      if (current.node === valuePath.node) {
        return;
      }
      current = current.parentPath;
    }
    ok = false;
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
      if (operator !== "=") {
        return;
      }
      if (!isNormalMemberExpression(left)) {
        return;
      }

      const objPath = path.get("left.object") as NodePath;
      if (!objPath.isIdentifier() || !isSameBinding(objPath, requireFn)) {
        return;
      }

      const stmt = findEnclosingStatementAmong(path, topLevelBody);
      if (!stmt) {
        return;
      }

      const list = byStatement.get(stmt) ?? [];
      list.push(path);
      byStatement.set(stmt, list);
    },
  });

  return byStatement;
}

function relocateFreeAssignments(
  assignments: readonly NodePath<t.AssignmentExpression>[],
  requireFn: IdentifiedFunctionDeclaration
): t.Statement[] {
  const statements: t.Statement[] = [];
  for (const path of assignments) {
    if (isFreeOfOuterReferences(path.get("right"), requireFn)) {
      statements.push(t.expressionStatement(t.cloneNode(path.node, true)));
    }
  }
  return statements;
}

function iifeHasOnlyPassiveDeclarationSiblings(
  iifeBody: readonly t.Statement[],
  assignments: readonly NodePath<t.AssignmentExpression>[]
): boolean {
  const ownAssignmentStatements = new Set<t.Statement>();
  for (const path of assignments) {
    const statement = findEnclosingStatementAmong(path, iifeBody);
    if (statement) {
      ownAssignmentStatements.add(statement);
    }
  }
  for (const statement of iifeBody) {
    if (
      !ownAssignmentStatements.has(statement) &&
      !t.isVariableDeclaration(statement) &&
      !t.isFunctionDeclaration(statement)
    ) {
      return false;
    }
  }
  return true;
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
  const statements: t.Statement[] = [];
  for (const [stmt, assignments] of assignmentsByStatement) {
    const iifeBody = getNoArgIifeBody(stmt);
    if (iifeBody && iifeHasOnlyPassiveDeclarationSiblings(iifeBody, assignments)) {
      statements.push(t.cloneNode(stmt, true));
    } else {
      for (const assignment of relocateFreeAssignments(assignments, requireFn)) {
        statements.push(assignment);
      }
    }
  }
  return statements;
}
