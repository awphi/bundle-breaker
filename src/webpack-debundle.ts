import { createHash } from "crypto";
import * as t from "@babel/types";
import traverse from "@babel/traverse";
import { Debundle, modulesDirName } from "./debundle";
import { Chunk, Graph } from "./types";
import {
  isAnyFunctionExpression,
  isIIFE,
  maybeUnwrapTopLevelIife,
  replaceAstNodes,
} from "./utils";

export interface WebpackModuleMap {
  moduleFns: Record<string, t.ArrowFunctionExpression | t.FunctionExpression>;
  moduleMapExpr: t.ObjectExpression | t.ArrayExpression | undefined;
}

export interface WebpackRuntimeChunkInfo {
  chunk: Chunk;
  requireFn: WebpackRequireFnInfo;
}

export interface WebpackRequireFnInfo {
  functionDec: t.FunctionDeclaration;
  moduleMapMemberExpr: t.MemberExpression;
}

const moduleExportsExpr = t.memberExpression(
  t.identifier("module"),
  t.identifier("exports")
);

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
      return {
        chunk,
        requireFn,
      };
    } catch {}
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

  if (functionDec === undefined || moduleMapMemberExpr === undefined) {
    throw new Error(`Unable to find webpack require function in '${name}'`);
  }

  return {
    functionDec,
    moduleMapMemberExpr,
  };
}

function findRuntimeChunkModuleMap({ ast, name }: Chunk): WebpackModuleMap {
  const maybeIife = ast.program.body[0];
  if (
    ast.program.body.length === 1 &&
    isIIFE(maybeIife) &&
    maybeIife.expression.arguments.length == 1
  ) {
    // webpack 4  - the modules included in the runtime chunk are passed as the first and only arg to the main iife
    return makeModuleMap(maybeIife.expression.arguments[0]);
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

export class WebpackDebundle extends Debundle {
  constructor(files: Record<string, string>, knownEntry?: string) {
    super(files);

    const potentialRuntimeChunks =
      knownEntry && this.chunks.has(knownEntry)
        ? [this.chunks.get(knownEntry)].values()
        : this.chunks.values();

    const runtimeChunkInfo = findRuntimeChunk(potentialRuntimeChunks);
    const runtimeChunkModuleMap = findRuntimeChunkModuleMap(
      runtimeChunkInfo.chunk
    );

    const allModuleMapExprs: (t.ArrayExpression | t.ObjectExpression)[] = [];

    for (const chunk of this.chunks.values()) {
      const { name } = chunk;
      const isRuntimeChunk = chunk === runtimeChunkInfo.chunk;
      const { moduleFns, moduleMapExpr } = isRuntimeChunk
        ? runtimeChunkModuleMap
        : findAdditionalChunkModuleMap(chunk);
      allModuleMapExprs.push(moduleMapExpr);

      for (const [moduleId, moduleFn] of Object.entries(moduleFns)) {
        if (this.modules.has(moduleId)) {
          throw new Error(
            `Encountered module ID clash '${moduleId}' - found in ${
              this.modules.get(moduleId).src
            } and ${name}.`
          );
        }

        moduleFn.leadingComments = [];
        const hash = createHash("shake256", { outputLength: 4 });
        hash.update(moduleId);
        this.modules.set(moduleId, {
          name: "bb_" + hash.digest("base64url"),
          ast: t.file(
            t.program([
              t.expressionStatement(
                t.assignmentExpression("=", moduleExportsExpr, moduleFn)
              ),
            ])
          ),
          src: chunk,
        });
      }

      if (!isRuntimeChunk) {
        const newModuleMapExpr = t.isArrayExpression(moduleMapExpr)
          ? t.arrayExpression([])
          : t.objectExpression([]);

        replaceAstNodes(
          chunk.ast,
          // replace the module map in the additional chunk with an empty expression of the same type
          // this ensures chunks are still loaded the same, but modules are not as they are split out
          new Map([[moduleMapExpr, newModuleMapExpr]])
        );
      }
    }

    // now that all the modules have been collected we can codemod the module map expression in the runtime chunk
    const moduleEntries: [string, string][] = [...this.modules.entries()].map(
      ([k, m]) => [k, `${modulesDirName}/${m.name}`]
    );
    const { moduleMapMemberExpr: runtimeModuleMapMemberExpr } =
      runtimeChunkInfo.requireFn;
    const { moduleMapExpr: runtimeModuleMapExpr } = runtimeChunkModuleMap;

    const newRuntimeModuleMapExpr = allModuleMapExprs.every((v) =>
      t.isArrayExpression(v)
    )
      ? t.arrayExpression(moduleEntries.map(([_, v]) => t.stringLiteral(v)))
      : t.objectExpression(
          moduleEntries.map(([k, v]) =>
            t.objectProperty(t.stringLiteral(k), t.stringLiteral(v))
          )
        );

    replaceAstNodes(
      runtimeChunkInfo.chunk.ast,
      new Map<t.Node, t.Node>([
        // replace the module map member expression in the require function with require(...)
        [
          runtimeModuleMapMemberExpr,
          t.callExpression(t.identifier("require"), [
            runtimeModuleMapMemberExpr,
          ]),
        ],
        // replace the actual module map expression with our mapping from module ID -> file name
        [runtimeModuleMapExpr, newRuntimeModuleMapExpr],
      ])
    );
  }

  graph(): Graph<any, any> {
    const { moduleGraph, modules } = this;
    for (const { ast, name } of this.modules.values()) {
      moduleGraph.nodes[name] = {};
      const expr = ast.program.body[0];
      if (
        t.isExpressionStatement(expr) &&
        t.isAssignmentExpression(expr.expression) &&
        isAnyFunctionExpression(expr.expression.right) &&
        expr.expression.right.params.length >= 3 &&
        t.isIdentifier(expr.expression.right.params[2])
      ) {
        const requireFnId = expr.expression.right.params[2];
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
              const realModuleId = args[0].value.toString();
              if (!modules.has(realModuleId)) {
                throw new Error(
                  `Could not find module '${realModuleId}' in cache. Imported by module '${name}'.`
                );
              }
              const moduleId = modules.get(realModuleId)!.name;
              moduleGraph.edges.push({
                source: moduleId,
                target: name,
              });
            }
          },
        });
      }
    }

    return moduleGraph;
  }
}
