import * as recast from "recast";
import r = recast.types.namedTypes;

export interface Chunk {
  name: string;
  code: string;
  ast: any;
}

export type AnyFunctionExpression =
  | r.ArrowFunctionExpression
  | r.FunctionExpression;

export interface WebpackModuleMap {
  modules: Record<string, AnyFunctionExpression>;
  expr: r.ObjectExpression | r.ArrayExpression | undefined;
}

export interface WebpackRuntimeChunkInfo {
  chunk: Chunk;
  requireFn: WebpackRequireFnInfo;
  moduleMap: WebpackModuleMap;
}

export interface WebpackRequireFnInfo {
  declaration: r.FunctionDeclaration;
  moduleMapMemberExpr: r.MemberExpression;
}

export interface WebpackModule {
  fn: AnyFunctionExpression;
  name: string;
}

export interface WebpackBundle {
  files: Map<string, Chunk>;
  size: number;
  runtimeChunkInfo: WebpackRuntimeChunkInfo;
  modules: Map<string, WebpackModule>;
}
