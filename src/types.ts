import type {
  ArrowFunctionExpression,
  FunctionExpression,
  Literal,
  ObjectExpression,
  Property,
} from "acorn";

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

export interface WebpackModuleMapProperty extends Property {
  key: Literal & { raw: string };
  value: ArrowFunctionExpression | FunctionExpression;
}

export interface WebpackModuleMapExpression extends ObjectExpression {
  properties: Array<WebpackModuleMapProperty>;
}

export type ModuleFnMap = Record<
  string,
  FunctionExpression | ArrowFunctionExpression
>;
