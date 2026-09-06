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

/** Strips all comments from `node` and its descendants in place - used to
 * drop webpack's own module-boundary marker comments, which would otherwise
 * leak into extracted module bodies once they're no longer sitting inside
 * the original module-map/wrapper-function context. */
/**
 * Checks that `idPath` is a genuine reference resolving (via scope, not name
 * string comparison) to `target`'s own binding. Minifiers routinely reuse
 * short identifier names across unrelated scopes (e.g. a require function
 * named `i` and, in a completely different nested closure, an unrelated
 * local variable that also happens to be named `i`) - comparing names alone
 * would conflate the two. This is the check that keeps them apart.
 */
export function referencesBinding(idPath: NodePath, target: t.Node): boolean {
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

export function cloneFileNode(node: FileNode): FileNode {
  return {
    path: node.path,
    ast: t.cloneNode(node.ast, true),
  };
}
