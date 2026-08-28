import type { AnyFunctionExpression } from "../ast";
import type * as t from "@babel/types";
import type { FileNode } from "../types";

export interface WebpackModuleMap {
  moduleFns: Map<string, AnyFunctionExpression>;
  expression: t.ObjectExpression | t.ArrayExpression;
}

export interface PatchedRuntimeChunk {
  chunk: FileNode;
  moduleMap: WebpackModuleMap;
}

export interface StrippedAdditionalChunk {
  chunk: FileNode;
  moduleMap: WebpackModuleMap;
}
