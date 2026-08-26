import type * as t from "@babel/types";

export interface FileNode {
  readonly path: string;
  readonly ast: t.File;
}

export interface RawBundle {
  readonly files: ReadonlyMap<string, FileNode>;
}

export interface Bundle {
  readonly adapter: string;
  readonly entry: string;
  readonly files: ReadonlyMap<string, FileNode>;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface Graph {
  readonly nodes: ReadonlySet<string>;
  readonly edges: readonly GraphEdge[];
}

export interface ParseBundleOptions {
  extension?: string[];
}
