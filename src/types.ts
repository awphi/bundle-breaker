import * as recast from "recast";
import r = recast.types.namedTypes;

export interface WebpackChunk {
  name: string;
  code: string;
  ast: r.File;
  moduleMap?: WebpackModuleMap;
}

export type AnyFunctionExpression =
  | r.ArrowFunctionExpression
  | r.FunctionExpression;

export interface IifeCallExpression extends r.CallExpression {
  callee: AnyFunctionExpression;
}

export interface IifeExpression extends r.ExpressionStatement {
  expression: IifeCallExpression;
}

export interface WebpackModuleMap {
  modules: Record<string, AnyFunctionExpression>;
  moduleMapExpr: r.ObjectExpression | r.ArrayExpression | undefined;
}

export interface WebpackRuntimeChunkInfo {
  chunk: WebpackChunk;
  requireFn: WebpackRequireFnInfo;
}

export interface WebpackRequireFnInfo {
  functionDec: r.FunctionDeclaration;
  moduleMapMemberExpr: r.MemberExpression;
}

export interface WebpackModule {
  fn: AnyFunctionExpression;
  name: string;
  src: string;
}

export interface WebpackBundle {
  chunks: Map<string, WebpackChunk>;
  size: number;
  runtimeChunkInfo: WebpackRuntimeChunkInfo;
  modules: Map<string, WebpackModule>;
}
