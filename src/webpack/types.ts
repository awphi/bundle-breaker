import type {
  AnyFunctionExpression,
  IdentifiedFunctionDeclaration,
  NormalMemberExpression,
} from "../ast";
import type * as t from "@babel/types";
import type { FileNode } from "../types";

export interface WebpackModuleMap {
  moduleFns: Map<string, AnyFunctionExpression>;
  expression: t.ObjectExpression | t.ArrayExpression;
}

export interface WebpackRequireFnInfo {
  functionDec: IdentifiedFunctionDeclaration;
  moduleMapMemberExpr: NormalMemberExpression;
}

export interface WebpackRuntimeChunkInfo {
  chunk: FileNode;
  requireFn: WebpackRequireFnInfo;
  moduleMap: WebpackModuleMap;
}
