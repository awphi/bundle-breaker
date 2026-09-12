import type { AnyFunctionExpression } from "../ast";
import type * as t from "@babel/types";

export type ModuleFnMap = ReadonlyMap<string, AnyFunctionExpression>;

export interface RuntimeChunkInfo {
  readonly path: string;
  readonly requireFnName: string;
  readonly moduleFns: ModuleFnMap;
  readonly relocatableHelperStatements: readonly t.Statement[];
  readonly entryId: string | undefined;
  readonly entryTrailingCode: readonly t.Statement[];
}

export interface AdditionalChunkInfo {
  readonly path: string;
  readonly moduleFns: ModuleFnMap;
  readonly entryId: string | undefined;
}
