import * as t from "@babel/types";
import traverse, { NodePath } from "@babel/traverse";
import { Debundle } from "./debundle";
import { Chunk, NamedAST } from "../types";
import { DirectedGraph } from "graphology";

import {
  MODULES_DIR,
  isAnyFunctionExpression,
  getIifeCallExpression,
  maybeUnwrapTopLevelIife,
  MODULE_MAPPING_FILE,
} from "../utils";
import { replace } from "../visitor/common";
import hash from "hash-sum";

export type WebpackRequireFnCall = t.CallExpression & {
  arguments: [t.StringLiteral | t.NumericLiteral];
};

export interface WebpackModuleMap {
  moduleFns: Record<string, t.ArrowFunctionExpression | t.FunctionExpression>;
  moduleMapExpr: t.ObjectExpression | t.ArrayExpression | undefined;
}

export interface WebpackRuntimeChunkInfo {
  chunk: Chunk;
  requireFn: WebpackRequireFnInfo;
  moduleMap: WebpackModuleMap;
}

export interface WebpackRequireFnInfo {
  functionDec: t.FunctionDeclaration & { id: t.Identifier };
  moduleMapMemberExpr: t.MemberExpression;
}

const moduleExportsExpr = t.memberExpression(
  t.identifier("module"),
  t.identifier("exports")
);
const requireId = t.identifier("require");

function makeModuleMap(expr?: t.Node): WebpackModuleMap {
  const result: WebpackModuleMap = {
    moduleMapExpr: undefined,
    moduleFns: {},
  };

  if (t.isObjectExpression(expr)) {
    result.moduleMapExpr = expr;
    for (const prop of expr.properties) {
      if (
        t.isProperty(prop) &&
        t.isLiteral(prop.key) &&
        (prop.key.type === "StringLiteral" ||
          prop.key.type === "NumericLiteral") &&
        isAnyFunctionExpression(prop.value)
      ) {
        result.moduleFns[prop.key.value.toString()] = prop.value;
      }
    }
  } else if (t.isArrayExpression(expr)) {
    result.moduleMapExpr = expr;
    for (let i = 0; i < expr.elements.length; i++) {
      const fn = expr.elements[i];
      if (isAnyFunctionExpression(fn)) {
        result.moduleFns[i.toString()] = fn;
      }
    }
  } else {
    throw new Error(
      `Cannot construct module map from node of type ${expr?.type}`
    );
  }

  return result;
}

function findRuntimeChunk(
  chunks: IterableIterator<Chunk>
): WebpackRuntimeChunkInfo {
  for (const chunk of chunks) {
    try {
      // attempt to make an object, simply try the next chunk if we get an error
      const requireFn = findWebpackRequireFn(chunk);
      const moduleMap = findRuntimeChunkModuleMap(chunk);

      return {
        chunk,
        requireFn,
        moduleMap,
      };
    } catch (_) {}
  }

  throw new Error("Failed to auto-detect runtime chunk.");
}

function findWebpackRequireFn({ ast, name }: Chunk): WebpackRequireFnInfo {
  let functionDec: t.FunctionDeclaration | undefined = undefined;
  let moduleMapMemberExpr: t.MemberExpression | undefined = undefined;
  const body = maybeUnwrapTopLevelIife(ast.program);

  const functionDecs = body.filter((v) =>
    t.isFunctionDeclaration(v)
  ) as t.FunctionDeclaration[];

  // most bundles will just have one function declaration (the require fn), however some webpack4 configs with
  // runtime chunk splitting will have multiple, with the *last* function declaration being the require fn
  if (functionDecs.length > 0) {
    functionDec = functionDecs[functionDecs.length - 1];

    // now find the first call expression on a member expression
    // in WP5 this looks like __webpack_modules__[moduleId](module, module.exports, __webpack_require__)
    // in WP4 this looks like modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
    traverse.cheap(functionDec, (node) => {
      if (t.isCallExpression(node)) {
        if (t.isMemberExpression(node.callee)) {
          if (
            t.isMemberExpression(node.callee.object) &&
            t.isIdentifier(node.callee.property, { name: "call" })
          ) {
            moduleMapMemberExpr = node.callee.object;
          } else {
            moduleMapMemberExpr = node.callee;
          }
        }
      }
    });
  }

  if (
    functionDec === undefined ||
    moduleMapMemberExpr === undefined ||
    !functionDec.id
  ) {
    throw new Error(`Unable to find webpack require function in '${name}'`);
  }

  return {
    functionDec: functionDec as WebpackRequireFnInfo["functionDec"],
    moduleMapMemberExpr,
  };
}

function findRuntimeChunkModuleMap({ ast, name }: Chunk): WebpackModuleMap {
  const iife = getIifeCallExpression(ast.program.body[0]);
  if (ast.program.body.length === 1 && iife && iife.arguments.length == 1) {
    // webpack 4  - the modules included in the runtime chunk are passed as the first and only arg to the main iife
    return makeModuleMap(iife.arguments[0]);
  } else {
    // webpack 5 - there exists a __webpack_modules__ variable in the body
    const body = maybeUnwrapTopLevelIife(ast.program);
    const variableDecs = body.filter((v) =>
      t.isVariableDeclaration(v)
    ) as t.VariableDeclaration[];

    // assumes the __webpack_modules__ declaration always comes first
    if (variableDecs.length >= 1 && variableDecs[0].declarations.length >= 1) {
      const dec = variableDecs[0].declarations[0];
      if (t.isVariableDeclarator(dec) && t.isObjectExpression(dec.init)) {
        return makeModuleMap(dec.init);
      }
    }
  }

  throw new Error(`Failed to locate module map in chunk ${name}`);
}

function findAdditionalChunkModuleMap({ ast, name }: Chunk): WebpackModuleMap {
  // look for a single expression program with a .push(arg) - could tighten this up but seems to get the job done for now
  if (ast.program.body.length === 1) {
    const call = ast.program.body[0];
    if (
      t.isExpressionStatement(call) &&
      t.isCallExpression(call.expression) &&
      call.expression.arguments.length === 1 &&
      t.isMemberExpression(call.expression.callee) &&
      t.isIdentifier(call.expression.callee.property, { name: "push" })
    ) {
      const param = call.expression.arguments[0];

      // webpack 4 uses 3 args and webpack 5 uses 2 - the second is always the actual module map (arr or obj)
      // this check is quite loose for brevity but could be tightened
      if (t.isArrayExpression(param) && param.elements.length >= 2) {
        return makeModuleMap(param.elements[1]);
      }
    }
  }

  throw new Error(`Failed to locate module map in chunk ${name}`);
}

function forEachWebpackRequireFnCall(
  { name, ast }: NamedAST,
  requireFnId: t.Identifier,
  callback: (fileName: string, path: NodePath<WebpackRequireFnCall>) => void
): void {
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (
        t.isIdentifier(callee) &&
        callee.name === requireFnId.name &&
        path.scope.getBinding(callee.name).identifier === requireFnId &&
        args.length === 1 &&
        (t.isStringLiteral(args[0]) || t.isNumericLiteral(args[0]))
      ) {
        callback(name, path as NodePath<WebpackRequireFnCall>);
      }
    },
  });
}

export class WebpackDebundle extends Debundle {
  private runtimeChunkInfo: WebpackRuntimeChunkInfo;

  constructor(files: Record<string, string>, knownEntry?: string) {
    super(files);

    const potentialRuntimeChunks =
      knownEntry && this.chunks.has(knownEntry)
        ? [this.chunks.get(knownEntry)].values()
        : this.chunks.values();

    const runtimeChunkInfo = findRuntimeChunk(potentialRuntimeChunks);
    this.runtimeChunkInfo = runtimeChunkInfo;

    for (const chunk of this.chunks.values()) {
      const { name } = chunk;
      const isRuntimeChunk = chunk === runtimeChunkInfo.chunk;
      const { moduleFns, moduleMapExpr } = isRuntimeChunk
        ? runtimeChunkInfo.moduleMap
        : findAdditionalChunkModuleMap(chunk);

      for (const [moduleId, moduleFn] of Object.entries(moduleFns)) {
        if (this.modules.has(moduleId)) {
          throw new Error(
            `Encountered module ID clash '${moduleId}' - found in ${
              this.modules.get(moduleId).src
            } and ${name}.`
          );
        }

        moduleFn.leadingComments = [];
        const ast = t.file(
          t.program([
            t.expressionStatement(
              t.assignmentExpression("=", moduleExportsExpr, moduleFn)
            ),
          ])
        );
        this.modules.set(moduleId, {
          name: hash(ast),
          ast,
          src: chunk,
        });
      }

      if (!isRuntimeChunk) {
        const newModuleMapExpr = t.isArrayExpression(moduleMapExpr)
          ? t.arrayExpression([])
          : t.objectExpression([]);

        // replace the module map in the additional chunk with an empty expression of the same type
        // this ensures chunks are still loaded the same, but modules are not as they are split out
        this.addAstMods(chunk, replace(moduleMapExpr, newModuleMapExpr));
      }
    }

    // now that all the modules have been collected we can codemod the module map expression in the runtime chunk
    const moduleEntries: [string, string][] = [...this.modules.entries()].map(
      ([k, m]) => [k, `${MODULES_DIR}/${m.name}`]
    );
    const { moduleMapMemberExpr: runtimeModuleMapMemberExpr } =
      runtimeChunkInfo.requireFn;

    // look in module_mapping first to deal with computed IDs and unprocessed require calls
    // if not found then we've probably modified it so we can assume it's a module file on disk
    // this boils down to something like `require(__webpack_modules__[moduleId] || "./modules/" + moduleId)(...)`
    const moduleMapMemberExprWithFallback = t.logicalExpression(
      "||",
      runtimeModuleMapMemberExpr,
      t.binaryExpression(
        "+",
        t.stringLiteral(MODULES_DIR + "/"),
        runtimeModuleMapMemberExpr.property as t.Expression
      )
    );

    this.addAstMods(
      runtimeChunkInfo.chunk,
      replace(
        runtimeModuleMapMemberExpr,
        t.callExpression(requireId, [moduleMapMemberExprWithFallback])
      ),
      replace(
        runtimeChunkInfo.moduleMap.moduleMapExpr,
        t.callExpression(requireId, [
          t.stringLiteral("./" + MODULE_MAPPING_FILE.slice(0, -3)),
        ])
      )
    );

    const moduleMappingAst = t.file(
      t.program([
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            moduleExportsExpr,
            // objects and arrays are indexed in the same way so just use an object for simplicity's sake
            t.objectExpression(
              moduleEntries.map(([k, v]) =>
                t.objectProperty(t.stringLiteral(k), t.stringLiteral(v))
              )
            )
          )
        ),
      ])
    );

    this.chunks.set(MODULE_MAPPING_FILE, {
      ast: moduleMappingAst,
      bytes: 0,
      name: MODULE_MAPPING_FILE,
    });

    for (const [moduleId, { ast }] of this.modules.entries()) {
      t.addComment(ast, "leading", ` Webpack module ID: '${moduleId}' `);
    }

    this.commitAstMods();
  }

  private forEachWebpackRequireFnCall(
    callback: (fileName: string, path: NodePath<WebpackRequireFnCall>) => void
  ): void {
    for (const mod of this.modules.values()) {
      const expr = mod.ast.program.body[0];
      if (
        !(
          t.isExpressionStatement(expr) &&
          t.isAssignmentExpression(expr.expression) &&
          isAnyFunctionExpression(expr.expression.right) &&
          expr.expression.right.params.length >= 3 &&
          t.isIdentifier(expr.expression.right.params[2])
        )
      ) {
        continue;
      }

      const requireFnId = expr.expression.right.params[2];
      forEachWebpackRequireFnCall(mod, requireFnId, callback);
    }

    const requireFnId = this.runtimeChunkInfo.requireFn.functionDec.id;
    forEachWebpackRequireFnCall(
      this.runtimeChunkInfo.chunk,
      requireFnId,
      callback
    );
  }

  protected graphInternal(): DirectedGraph {
    const { modules } = this;
    const graph = new DirectedGraph({ allowSelfLoops: false });
    const runtimeChunk = this.runtimeChunkInfo.chunk;
    for (const { name } of this.modules.values()) {
      graph.addNode(name, { label: name, file_type: "module" });
    }
    graph.addNode(runtimeChunk.name, {
      label: runtimeChunk.name,
      file_type: "entry",
    });

    this.forEachWebpackRequireFnCall((name, path) => {
      const id = path.node.arguments[0].value.toString();
      // check in the module cache first (which effectively stores module_mapping in memory) for the name
      // if not found then assume we're dealing with the name already (TODO might make sense to validate this assumption)
      const moduleId = modules.get(id)?.name ?? id;
      if (!graph.hasEdge(moduleId, name)) {
        graph.addDirectedEdge(moduleId, name);
      }
    });

    return graph;
  }

  rewriteImports(): void {
    this.forEachWebpackRequireFnCall((_, path) => {
      const arg = path.get("arguments")[0];
      const { name } = this.getModule(arg.node.value.toString());
      // replace with name and nothing else to avoid breaking module graph construction
      const literal = t.stringLiteral(name);
      t.addComment(literal, "inner", arg.node.value.toString());
      arg.replaceWith(literal);
    });
  }
}
