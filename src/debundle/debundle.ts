import path from "path";
import * as parser from "@babel/parser";
import generate from "@babel/generator";
import fs from "fs/promises";
import { Chunk, DeobfsucateOpts, Module, NamedAST } from "../types";
import {
  GRAPH_FILE,
  MODULES_DIR,
  ensureDirectory,
  formatBytes,
} from "../utils";
import { DirectedGraph } from "graphology";
import gexf from "graphology-gexf";
import traverse, { Visitor } from "@babel/traverse";
import * as deobfuscate from "../visitor/deobfuscate";
import hash from "hash-sum";

const DEFAULT_DEOB_OPTS: Required<DeobfsucateOpts> = {
  flipLiterals: true,
  voidLiteralToUndefined: true,
  verboseTrueFalse: true,
  decimalNumericLiterals: true,
  breakSequenceExpressions: true,
  enforceBlockStatementsOnIfs: true,
  splitVariableDeclarators: true,
};

export abstract class Debundle {
  protected chunks: Map<string, Readonly<Chunk>> = new Map();
  protected modules: Map<string, Readonly<Module>> = new Map();
  protected pendingAstMods: Map<NamedAST, Visitor<unknown>[]> = new Map();
  protected id: string;

  protected moduleGraph: DirectedGraph | undefined = undefined;

  constructor(
    chunks: Record<string, string>,
    readonly outputExtension: string
  ) {
    const textEncoder = new TextEncoder();
    for (const name of Object.keys(chunks)) {
      const code = chunks[name];
      const ast = parser.parse(code);
      this.chunks.set(name, {
        ast,
        name,
        type: "chunk",
        bytes: textEncoder.encode(code).byteLength,
      });
    }
    this.updateId();
  }

  private updateId(): void {
    this.id = hash([...this.allModulesAllChunks()].map((a) => a.ast));
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
    console.log(` - Debundle ID: ${this.id}`);
    console.log(` - Chunks (${chunkNames.length}): ${chunkNames.join(", ")}`);
    console.log(
      ` - Total chunk(s) size: ${formatBytes(this.totalChunkSize())}`
    );
    console.log(` - Unique modules: ${this.modules.size}`);
  }

  addAstMods(ast: NamedAST, ...mod: Visitor<unknown>[]): void {
    if (!this.pendingAstMods.has(ast)) {
      this.pendingAstMods.set(ast, []);
    }

    this.pendingAstMods.get(ast)!.push(...mod);
  }

  commitAstMods(): void {
    if (this.pendingAstMods.size > 0) {
      for (const [ast, mods] of this.pendingAstMods.entries()) {
        const visitors = traverse.visitors.merge(mods);
        traverse(ast.ast, visitors);
      }

      this.updateId();
      this.pendingAstMods.clear();
    }
  }

  protected formatFileName(name: string): string {
    const extLength = path.extname(name).length;
    return `${name.slice(0, -extLength)}.${this.outputExtension}`;
  }

  async save(dir: string): Promise<void> {
    const moduleDir = path.resolve(dir, MODULES_DIR);

    const promises: Promise<void>[] = [];
    await ensureDirectory(moduleDir, false, true);

    this.commitAstMods();

    for (const item of this.allModulesAllChunks()) {
      const { ast, name, type } = item;
      const outputCode = generate(ast).code;
      const outFile = this.formatFileName(name);
      const dir = type === "chunk" ? outFile : moduleDir;
      promises.push(fs.writeFile(path.join(dir, outFile), outputCode));
    }

    const { moduleGraph: graph } = this;
    if (graph !== undefined) {
      const graphStr = gexf.write(graph);
      promises.push(fs.writeFile(path.join(dir, GRAPH_FILE), graphStr));
    }

    await Promise.all(promises);
  }

  graph(useCache: boolean = true): DirectedGraph {
    if (useCache && this.moduleGraph !== undefined) {
      return this.moduleGraph;
    }

    this.moduleGraph = this.graphInternal();
    return this.moduleGraph;
  }

  *allModulesAllChunks() {
    yield* this.modules.values();
    yield* this.chunks.values();
  }

  deobfuscate(optsBase?: DeobfsucateOpts): void {
    const opts = Object.assign({}, DEFAULT_DEOB_OPTS, optsBase);
    for (const key of Object.keys(opts)) {
      const enabled = opts[key] ?? true;
      if (key in deobfuscate && enabled) {
        const codemod = deobfuscate[key]();

        for (const chunk of this.allModulesAllChunks()) {
          this.addAstMods(chunk, codemod);
        }
      }
    }

    this.commitAstMods();
    // TODO do LLM-powered renaming as appropriate
  }

  protected abstract graphInternal(): DirectedGraph;
}
