import * as t from "@babel/types";

export type AnyFunctionExpression =
  | t.ArrowFunctionExpression
  | t.FunctionExpression;

export interface IifeExpression extends t.ExpressionStatement {
  expression: t.CallExpression & { callee: AnyFunctionExpression };
}

export interface NamedAST {
  name: string;
  ast: t.File;
}

export interface Chunk extends NamedAST {
  bytes: number;
}

export interface Module extends NamedAST {
  src: Chunk;
}
