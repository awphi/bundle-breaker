import * as recast from "recast";
import r = recast.types.namedTypes;

export type AnyFunctionExpression =
  | r.ArrowFunctionExpression
  | r.FunctionExpression;

export interface IifeCallExpression extends r.CallExpression {
  callee: AnyFunctionExpression;
}

export interface IifeExpression extends r.ExpressionStatement {
  expression: IifeCallExpression;
}

export interface Chunk {
  name: string;
  code: string;
  ast: r.File;
}

export interface Module {
  ast: r.Program;
  name: string;
  src: Chunk;
}

export interface Debundle {
  chunks: Map<string, Chunk>;
  size: number;
  modules: Map<string, Module>;
}

export interface WebpackModuleMap {
  moduleFns: Record<string, AnyFunctionExpression>;
  moduleMapExpr: r.ObjectExpression | r.ArrayExpression | undefined;
}

export interface WebpackRuntimeChunkInfo {
  chunk: Chunk;
  requireFn: WebpackRequireFnInfo;
}

export interface WebpackRequireFnInfo {
  functionDec: r.FunctionDeclaration;
  moduleMapMemberExpr: r.MemberExpression;
}
