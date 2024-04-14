import * as t from "@babel/types";

export type AnyFunctionExpression =
  | t.ArrowFunctionExpression
  | t.FunctionExpression;

export interface IifeExpression extends t.ExpressionStatement {
  expression: t.CallExpression & { callee: AnyFunctionExpression };
}

export interface Chunk {
  name: string;
  code: string;
  ast: t.File;
  bytes: number;
}

export interface Module {
  ast: t.File;
  name: string;
  src: Chunk;
}

// https://github.com/jsongraph/json-graph-specification
export interface GraphEdge<T extends object> {
  source: string;
  target: string;
  label?: string;
  directed?: boolean;
  metadata?: T;
}

export interface Graph<V extends object, E extends object> {
  nodes: Record<string, V>;
  edges: GraphEdge<E>[];
}
