import path from "path";
import * as parser from "@babel/parser";
import generate from "@babel/generator";
import fs from "fs/promises";
import { Chunk, DeobfsucateOpts, Module, NamedAST } from "../types";
import {
  GRAPH_FILE,
  MODULES_DIR,
  cyrb64Hash,
  ensureDirectory,
  formatBytes,
} from "../utils";
import { DirectedGraph } from "graphology";
import gexf from "graphology-gexf";
import traverse, { Visitor } from "@babel/traverse";
import * as deobfuscate from "../visitor/deobfuscate";
import * as t from "@babel/types";

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
  private chunks: Map<string, Readonly<Chunk>> = new Map();
  private modules: Map<string, Readonly<Module>> = new Map();
  protected pendingAstMods: Map<NamedAST, Visitor<unknown>[]> = new Map();
  protected id: string;

  protected moduleGraph: DirectedGraph | undefined = undefined;

  constructor(chunks: Record<string, string>, readonly ext: string) {
    for (const name of Object.keys(chunks)) {
      this.addChunk(name, chunks[name]);
    }
    this.updateId();
  }

  private updateId(): void {
    const allModulesAndChunks = [...this.allModulesAllChunks()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    // generating the code and hashing the resultant string is faster than trying to hash a js object with hash-sum or object-hash :o
    this.id = cyrb64Hash(
      allModulesAndChunks.map((a) => generate(a.ast)).join("-")
    );
  }

  getId(): string {
    return this.id;
  }

  totalChunkSize(): number {
    let c = 0;
    for (const v of this.chunks.values()) {
      c += v.bytes;
    }
    return c;
  }

  getChunk(id: string): Readonly<Chunk> | undefined {
    return this.chunks.get(id);
  }

  getModule(id: string): Readonly<Module> | undefined {
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

  addChunk(id: string, content: string | t.File): Readonly<Chunk> {
    const textEncoder = new TextEncoder();
    const code = typeof content === "string" ? content : "";
    const ast = typeof content === "string" ? parser.parse(code) : content;
    const name = this.formatModuleOrChunkName(id);

    const chunk: Readonly<Chunk> = {
      type: "chunk",
      bytes: textEncoder.encode(code).byteLength,
      ast,
      name,
    };

    // chunks are indexed by their formatted name as it doesn't change
    this.chunks.set(name, chunk);
    return chunk;
  }

  addModule(
    id: string,
    baseName: string,
    src: Chunk,
    ast: t.File
  ): Readonly<Module> {
    const name = path.posix.join(
      MODULES_DIR,
      this.formatModuleOrChunkName(baseName)
    );
    const mod: Readonly<Module> = {
      type: "module",
      ast,
      name,
      src,
      originalId: id,
    };

    // the module cache is indexed by the original ID from the source bundle rather than our custom name
    this.modules.set(id, mod);

    return mod;
  }

  private formatModuleOrChunkName(name: string): string {
    const extLength = path.extname(name).length;
    const basename = extLength > 0 ? name.slice(0, -extLength) : name;
    return `${basename}.${this.ext}`;
  }

  async save(outDir: string): Promise<void> {
    const moduleDir = path.resolve(outDir, MODULES_DIR);

    const promises: Promise<void>[] = [];
    await ensureDirectory(moduleDir, false, true);

    this.commitAstMods();

    for (const item of this.allModulesAllChunks()) {
      const { ast, name } = item;
      const outputCode = generate(ast).code;
      promises.push(fs.writeFile(path.join(outDir, name), outputCode));
    }

    const { moduleGraph: graph } = this;
    if (graph !== undefined) {
      const graphStr = gexf.write(graph);
      promises.push(fs.writeFile(path.join(outDir, GRAPH_FILE), graphStr));
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

  *allModules() {
    yield* this.modules.values();
  }

  *allChunks() {
    yield* this.chunks.values();
  }

  *allModulesAllChunks() {
    yield* this.allModules();
    yield* this.allChunks();
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
