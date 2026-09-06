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
  /** Whole top-level statements, self-contained enough to relocate verbatim
   * into the runtime shim - either a bare `<requireFn>.X = value;` or (when
   * the property closes over private sibling state, e.g. a memoization
   * cache) the whole wrapping IIFE that declares that state alongside it. */
  readonly helperStatements: readonly t.Statement[];
  readonly entryId: string | undefined;
  /** Top-level statements left over once the require function declaration,
   * module map declaration, helper property assignments and chunk-registration
   * boilerplate are all accounted for. Only meaningful when no entry id is
   * found anywhere in the bundle (see entry.ts shape B). */
  readonly trailingStatements: readonly t.Statement[];
}

export interface AdditionalChunkInfo {
  readonly path: string;
  readonly moduleMap: WebpackModuleMap;
  readonly entryId: string | undefined;
}
