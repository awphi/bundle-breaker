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
  type: "chunk";
}

export interface Module extends NamedAST {
  src: Chunk;
  type: "module";
}

export interface DeobfsucateOpts {
  flipLiterals?: boolean;
  voidLiteralToUndefined?: boolean;
  verboseTrueFalse?: boolean;
  decimalNumericLiterals?: boolean;
  breakSequenceExpressions?: boolean;
  enforceBlockStatementsOnIfs?: boolean;
  splitVariableDeclarators?: boolean;
}

export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};
