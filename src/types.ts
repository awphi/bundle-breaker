import * as recast from "recast";
import r = recast.types.namedTypes;

export interface Chunk {
  code: string;
  ast: any;
}

export interface Bundle {
  dir: string;
  files: Map<string, Chunk>;
  size: number;
  entry: string;
  modules: Map<
    string,
    {
      fn: AnyFunctionExpression;
      name: string;
    }
  >;
}

export type AnyFunctionExpression =
  | r.ArrowFunctionExpression
  | r.FunctionExpression;
