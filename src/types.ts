import * as t from "@babel/types";

export type AnyFunctionExpression =
  | t.ArrowFunctionExpression
  | t.FunctionExpression;

export interface IifeCallExpression extends t.CallExpression {
  callee: AnyFunctionExpression;
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

export interface DeobfsucateOpts {
  flipLiterals?: boolean;
  voidLiteralToUndefined?: boolean;
  verboseTrueFalse?: boolean;
  decimalNumericLiterals?: boolean;
  breakSequenceExpressions?: boolean;
}
