import path from "path";
import * as parser from "@babel/parser";
import generate from "@babel/generator";
import fs from "fs/promises";
import { Chunk, DeobfsucateOpts, Module, NamedAST } from "./types";
import { GRAPH_FILE, MODULES_DIR, ensureDirectory, formatBytes } from "./utils";
import { DirectedGraph } from "graphology";
import gexf from "graphology-gexf";
import traverse, { Visitor } from "@babel/traverse";
import * as astMods from "./ast-mods";
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
  protected chunks: Map<string, Chunk> = new Map();
  protected modules: Map<string, Module> = new Map();
  protected pendingAstMods: Map<NamedAST, Visitor<unknown>[]> = new Map();
  protected id: string;

  protected moduleGraph: DirectedGraph | undefined = undefined;

  private computeId(): string {
    return hash([...this.allModulesAllChunks()].map((a) => a.ast));
  }

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
    this.id = this.computeId();
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
    for (const [ast, mods] of this.pendingAstMods.entries()) {
      const visitors = traverse.visitors.merge(mods);
      traverse(ast.ast, visitors);
    }

    if (this.pendingAstMods.size > 0) {
      this.id = this.computeId();
      this.pendingAstMods.clear();
    }
  }

  async save(dir: string, ext: string): Promise<void> {
    const moduleDir = path.resolve(dir, MODULES_DIR);

    const promises: Promise<void>[] = [];
    await ensureDirectory(moduleDir, false, true);

    this.commitAstMods();

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
      if (key in astMods && enabled) {
        const codemod = astMods[key]();

        for (const chunk of this.allModulesAllChunks()) {
          this.addAstMods(chunk, codemod);
        }
      }
    }

    this.commitAstMods();
    // TODO do LLM-powered renaming as appropriate
  }

  abstract graphInternal(): DirectedGraph;
}
