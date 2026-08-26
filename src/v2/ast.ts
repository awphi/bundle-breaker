import * as t from "@babel/types";

export type AnyFunctionExpression =
  | t.ArrowFunctionExpression
  | t.FunctionExpression;

export interface IifeCallExpression extends t.CallExpression {
  callee: AnyFunctionExpression;
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
