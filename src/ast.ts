import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type { FileNode } from "./types";

export type AnyFunctionExpression =
  | t.ArrowFunctionExpression
  | t.FunctionExpression;

export interface IifeCallExpression extends t.CallExpression {
  callee: AnyFunctionExpression;
}

export interface IdentifiedFunctionDeclaration extends t.FunctionDeclaration {
  id: t.Identifier;
}

export interface NormalMemberExpression extends t.MemberExpressionNonComputed {
  property: t.Identifier;
}

export function isAnyFunctionExpression(
  node: t.Node
): node is AnyFunctionExpression {
  return t.isFunctionExpression(node) || t.isArrowFunctionExpression(node);
}

function isIifeCallExpression(node: t.Node): node is IifeCallExpression {
  return t.isCallExpression(node) && isAnyFunctionExpression(node.callee);
}

export function getIifeCallExpression(
  node: t.Node
): IifeCallExpression | undefined {
  if (t.isExpressionStatement(node)) {
    const expr = node.expression;
    if (t.isUnaryExpression(expr) && isIifeCallExpression(expr.argument)) {
      return expr.argument;
    }
    if (isIifeCallExpression(expr)) {
      return expr;
    }
  }

  return undefined;
}

export function maybeUnwrapTopLevelIife(program: t.Program): t.Statement[] {
  if (program.body.length === 1) {
    const iife = getIifeCallExpression(program.body[0]);
    if (iife && t.isBlockStatement(iife.callee.body)) {
      return iife.callee.body.body;
    }
  }

  return program.body;
}

export function extractObjectMethodFunction(
  method: t.ObjectMethod
): AnyFunctionExpression {
  const { params, body, async, generator } = method;
  return t.functionExpression(null, params, body, generator, async);
}

export function isIdentifiedFunctionDeclaration(
  node: t.Statement
): node is IdentifiedFunctionDeclaration {
  return t.isFunctionDeclaration(node) && node.id !== null;
}

export function isNormalMemberExpression(
  node: t.Node
): node is NormalMemberExpression {
  return (
    t.isMemberExpression(node, { computed: false }) &&
    t.isIdentifier(node.property)
  );
}

export function isSameBinding(idPath: NodePath, target: t.Node): boolean {
  if (!idPath.isReferencedIdentifier()) return false;
  const binding = idPath.scope.getBinding(idPath.node.name);
  return binding !== undefined && binding.path.node === target;
}

export function stripComments(node: t.Node): void {
  t.traverseFast(node, (n) => {
    n.leadingComments = null;
    n.trailingComments = null;
    n.innerComments = null;
  });
}

export function findEnclosingStatementAmong(
  path: NodePath,
  candidates: readonly t.Statement[]
): t.Statement | undefined {
  const stmtPath = path.find(
    (p) => t.isStatement(p.node) && candidates.includes(p.node as t.Statement)
  );
  return stmtPath ? (stmtPath.node as t.Statement) : undefined;
}

export function getNoArgIifeBody(stmt: t.Statement): t.Statement[] | undefined {
  const iife = getIifeCallExpression(stmt);
  if (iife && iife.arguments.length === 0 && t.isBlockStatement(iife.callee.body)) {
    return iife.callee.body.body;
  }
  return undefined;
}

export function cloneFileNode(node: FileNode): FileNode {
  return {
    path: node.path,
    ast: t.cloneNode(node.ast, true),
  };
}
