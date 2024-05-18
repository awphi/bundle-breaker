import * as parser from "@babel/parser";
import generate from "@babel/generator";
import { Chunk, DeobfsucateOpts, Module, Mutable, NamedAST } from "../types";
import { DEFAULT_DEOB_OPTS, MODULES_DIR, cyrb64Hash } from "../utils";
import { DirectedGraph } from "graphology";
import traverse, { Visitor } from "@babel/traverse";
import * as deobfuscate from "../visitor/deobfuscate";
import * as t from "@babel/types";
import path from "path/posix";

export abstract class Debundle {
  private chunks: Map<string, Readonly<Chunk>> = new Map();

  // `moduleAliases` maps onto the same module items as the main `modules` map but its keys don't change and are only used internally
  private moduleAliases: Map<string, Readonly<Module>> = new Map();
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

  getChunk(id: string): Readonly<Chunk> | undefined {
    return this.chunks.get(id);
  }

  getModule(id: string): Readonly<Module> | undefined {
    return this.modules.get(id) ?? this.moduleAliases.get(id);
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
    const code = typeof content === "string" ? content : "";
    const ast = typeof content === "string" ? parser.parse(code) : content;
    const name = this.formatModuleOrChunkName(id);

    const chunk: Readonly<Chunk> = {
      type: "chunk",
      ast,
      name,
    };

    this.chunks.set(name, chunk);
    return chunk;
  }

  addModule(
    baseName: string,
    src: Chunk,
    ast: t.File,
    aliases: string[] = []
  ): Readonly<Module> {
    const name = path.join(MODULES_DIR, this.formatModuleOrChunkName(baseName));
    const mod: Readonly<Module> = {
      type: "module",
      ast,
      name,
      src,
    };

    this.modules.set(name, mod);

    // some types of bundles have internal module IDs that it's useful to be able to index so we support
    // aliasing these here - they should always be unique
    for (const alias of aliases) {
      this.moduleAliases.set(alias, mod);
    }

    return mod;
  }

  updateNames(renames: Record<string, string>): void {
    // keep track of the changed names
    const changedNames = new Map<string, string>();

    for (const [from, to] of Object.entries(renames)) {
      const item: Mutable<Module | Chunk> =
        this.getModule(from) ?? this.getChunk(from);
      if (!item) {
        continue;
      }

      const map = item.type === "module" ? this.modules : this.chunks;

      let newName = this.formatModuleOrChunkName(to);
      if (item.type === "module") {
        newName = path.join(MODULES_DIR, newName);
      }

      // update the map key and the name
      changedNames.set(item.name, newName);
      map.delete(item.name);
      item.name = newName;
      map.set(item.name, item as any);
    }

    this.updateNamesInternal(changedNames);
  }

  protected updateNamesInternal(_renames: Map<string, string>) {}

  private formatModuleOrChunkName(name: string): string {
    const extLength = path.extname(name).length;
    const basename = extLength > 0 ? name.slice(0, -extLength) : name;
    return `${basename}.${this.ext}`;
  }

  graph(useCache: boolean = true): DirectedGraph {
    if (useCache && this.hasGraph()) {
      return this.moduleGraph;
    }

    this.moduleGraph = this.graphInternal();
    return this.moduleGraph;
  }

  hasGraph(): boolean {
    return this.moduleGraph !== undefined;
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
  }

  protected abstract graphInternal(): DirectedGraph;
}
