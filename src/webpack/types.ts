import type { AnyFunctionExpression } from "../ast";
import type * as t from "@babel/types";

export interface WebpackModuleMap {
  readonly moduleFns: ReadonlyMap<string, AnyFunctionExpression>;
  readonly expression: t.ObjectExpression | t.ArrayExpression;
}

export interface RuntimeChunkInfo {
  readonly path: string;
  readonly requireFnName: string;
  readonly moduleMap: WebpackModuleMap;
  readonly relocatableHelperStatements: readonly t.Statement[];
  readonly entryId: string | undefined;
  readonly resolveEntryTrailingCode: () => readonly t.Statement[];
}

export interface AdditionalChunkInfo {
  readonly path: string;
  readonly moduleMap: WebpackModuleMap;
  readonly entryId: string | undefined;
}
