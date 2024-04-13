import path from "path";
import * as parser from "@babel/parser";
import generate from "@babel/generator";
import fs from "fs/promises";
import { Chunk, Graph, Module } from "./types";
import { ensureDirectory, formatBytes } from "./utils";

export const modulesDirName = "./modules";

export abstract class Debundle {
  chunks: Map<string, Chunk> = new Map();
  modules: Map<string, Module> = new Map();
  moduleGraph: Graph<any, any> | undefined = undefined;

  constructor(chunks: Record<string, string>) {
    const textEncoder = new TextEncoder();
    for (const name of Object.keys(chunks)) {
      const code = chunks[name];
      const ast = parser.parse(code);
      this.chunks.set(name, {
        code,
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

  debug(): void {
    const chunkNames = [...this.chunks.keys()];
    console.log(` - Chunks (${chunkNames.length}): ${chunkNames.join(", ")}`);
    console.log(
      ` - Total chunk(s) size: ${formatBytes(this.totalChunkSize())}`
    );
    console.log(` - Unique modules: ${this.modules.size}`);
  }

  async save(dir: string, ext: string, clear: boolean): Promise<void> {
    const moduleDir = path.resolve(dir, modulesDirName);

    const promises: Promise<void>[] = [];
    await ensureDirectory(dir, clear);
    await ensureDirectory(moduleDir, clear);

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

    await Promise.all(promises);
  }

  visualize(): void {
    // TODO visualize this.moduleGraph using d3 etc.
    throw new Error("Method not implemented.");
  }

  abstract graph(): void;
}
