import * as t from "@babel/types";

export type AnyFunctionExpression =
  | t.ArrowFunctionExpression
  | t.FunctionExpression;

export interface IifeExpression extends t.ExpressionStatement {
  expression: t.CallExpression & { callee: AnyFunctionExpression };
}

export interface Chunk {
  name: string;
  code: string;
  ast: t.File;
}

export interface Module {
  ast: t.Program;
  name: string;
  src: Chunk;
}

export interface Debundle {
  chunks: Map<string, Chunk>;
  size: number;
  modules: Map<string, Module>;
}

export interface WebpackModuleMap {
  moduleFns: Record<string, t.ArrowFunctionExpression | t.FunctionExpression>;
  moduleMapExpr: t.ObjectExpression | t.ArrayExpression | undefined;
}

export interface WebpackRuntimeChunkInfo {
  chunk: Chunk;
  requireFn: WebpackRequireFnInfo;
}

export interface WebpackRequireFnInfo {
  functionDec: t.FunctionDeclaration;
  moduleMapMemberExpr: t.MemberExpression;
}
