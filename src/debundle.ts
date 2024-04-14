import path from "path";
import * as parser from "@babel/parser";
import generate from "@babel/generator";
import fs from "fs/promises";
import { Chunk, Module } from "./types";
import { GRAPH_FILE, MODULES_DIR, ensureDirectory, formatBytes } from "./utils";
import Graph from "graphology";

export abstract class Debundle {
  protected chunks: Map<string, Chunk> = new Map();
  protected modules: Map<string, Module> = new Map();
  protected moduleGraph: Graph | undefined = undefined;

  constructor(chunks: Record<string, string>) {
    const textEncoder = new TextEncoder();
    for (const name of Object.keys(chunks)) {
      const code = chunks[name];
      const ast = parser.parse(code);
      this.chunks.set(name, {
        ast,
        name,
        bytes: textEncoder.encode(code).byteLength,
      });
    }
  }

  totalChunkSize(): number {
    let c = 0;
    for (const v of this.chunks.values()) {
      c += v.bytes;
    }
    return c;
  }

  getChunk(id: string): Chunk | undefined {
    return this.chunks.get(id);
  }

  getModule(id: string): Module | undefined {
    return this.modules.get(id);
  }

  debug(): void {
    const chunkNames = [...this.chunks.keys()];
    console.log(` - Chunks (${chunkNames.length}): ${chunkNames.join(", ")}`);
    console.log(
      ` - Total chunk(s) size: ${formatBytes(this.totalChunkSize())}`
    );
    console.log(` - Unique modules: ${this.modules.size}`);
  }

  async save(dir: string, ext: string): Promise<void> {
    const moduleDir = path.resolve(dir, MODULES_DIR);

    const promises: Promise<void>[] = [];
    await ensureDirectory(moduleDir, false, true);

    for (const { ast, name } of this.chunks.values()) {
      const outputCode = generate(ast).code;
      const outFile = `${name.slice(0, -path.extname(name).length)}.${ext}`;
      promises.push(fs.writeFile(path.join(dir, outFile), outputCode));
    }

    for (const { ast, name } of this.modules.values()) {
      const outputCode = generate(ast).code;
      const outFile = `${name}.${ext}`;
      promises.push(fs.writeFile(path.join(moduleDir, outFile), outputCode));
    }

    const graph = this.moduleGraph;
    if (graph !== undefined) {
      const graphStr = JSON.stringify(graph.export(), undefined, 2);
      promises.push(fs.writeFile(path.join(dir, GRAPH_FILE), graphStr));
    }

    await Promise.all(promises);
  }

  visualize(): void {
    // TODO
  }

  graph(useCache: boolean = true): Graph {
    if (useCache && this.moduleGraph !== undefined) {
      return this.moduleGraph;
    }

    this.moduleGraph = this.graphInternal();
    return this.moduleGraph;
  }

  abstract graphInternal(): Graph;
}