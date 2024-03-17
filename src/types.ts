import * as recast from "recast";
import r = recast.types.namedTypes;

export interface Chunk {
  code: string;
  ast: any;
}

export interface Bundle {
  dir: string;
  files: Record<string, Chunk>;
  size: number;
  entry: string;
}

export type AnyFunctionExpression =
  | r.ArrowFunctionExpression
  | r.FunctionExpression;

export interface WebpackModuleMapProperty
  extends recast.types.namedTypes.Property {
  key: r.Literal & { value: number };
  value: AnyFunctionExpression;
}

export interface WebpackModuleMapExpression extends r.ObjectExpression {
  properties: Array<WebpackModuleMapProperty>;
}

export type ModuleFnMap = Record<
  string,
  {
    fn: AnyFunctionExpression;
    name: string;
  }
>;
