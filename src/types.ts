import * as recast from "recast";
import r = recast.types.namedTypes;

export interface Chunk {
  code: string;
  ast: any;
}

export interface ModuleFn {
  fn: AnyFunctionExpression;
  name: string;
}

export interface Bundle {
  files: Map<string, Chunk>;
  size: number;
  entry: string;
  modules: Map<string, ModuleFn>;
}

export interface RequireFnInfo {
  functionDec: r.FunctionDeclaration;
  moduleMapMemberExpr: r.MemberExpression;
}

export type AnyFunctionExpression =
  | r.ArrowFunctionExpression
  | r.FunctionExpression;

export interface ModuleMap {
  modules: Record<string, AnyFunctionExpression>;
  expr: r.ObjectExpression | r.ArrayExpression | undefined;
}
