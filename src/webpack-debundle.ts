import type {
  Chunk,
  Debundle,
  WebpackModuleMap,
  WebpackRequireFnInfo,
  WebpackRuntimeChunkInfo,
} from "./types";
import * as recast from "recast";
import r = recast.types.namedTypes;
import {
  isIIFE,
  isSingleExpressionProgram,
  createEmptyDebundleFromDir,
  maybeUnwrapTopLevelIife,
  replaceAstNodes,
  modulesDirName,
  isAnyFunctionExpression,
} from "./utils";
import { createHash } from "crypto";

const n = recast.types.namedTypes;
const b = recast.types.builders;

const moduleExportsExpr = b.memberExpression(
  b.identifier("module"),
  b.identifier("exports")
);

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
  let functionDec: r.FunctionDeclaration | undefined = undefined;
  let moduleMapMemberExpr: r.MemberExpression | undefined = undefined;
  const body = maybeUnwrapTopLevelIife(ast.program);

  const functionDecs = body.filter((v) =>
    n.FunctionDeclaration.check(v)
  ) as r.FunctionDeclaration[];

  // most bundles will just have one function declaration (the require fn), however some webpack4 configs with
  // runtime chunk splitting will have multiple, with the *last* function declaration being the require fn
  if (functionDecs.length > 0) {
    functionDec = functionDecs[functionDecs.length - 1];

    // now find the first call expression on a member expression
    // in WP5 this looks like __webpack_modules__[moduleId](module, module.exports, __webpack_require__)
    // in WP4 this looks like modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
    recast.visit(functionDec, {
      visitCallExpression(path) {
        const { node } = path;

        if (n.MemberExpression.check(node.callee)) {
          if (
            n.MemberExpression.check(node.callee.object) &&
            n.Identifier.check(node.callee.property) &&
            node.callee.property.name === "call"
          ) {
            moduleMapMemberExpr = node.callee.object;
          } else {
            moduleMapMemberExpr = node.callee;
          }
          return false;
        }

        this.traverse(path);
      },
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

function makeModuleMap(expr?: r.ASTNode): WebpackModuleMap {
  const result: WebpackModuleMap = {
    moduleMapExpr: undefined,
    moduleFns: {},
  };

  if (n.ObjectExpression.check(expr)) {
    result.moduleMapExpr = expr;
    for (const prop of expr.properties) {
      if (
        n.Property.check(prop) &&
        n.Literal.check(prop.key) &&
        isAnyFunctionExpression(prop.value)
      ) {
        result.moduleFns[prop.key.value.toString()] = prop.value;
      }
    }
  } else if (n.ArrayExpression.check(expr)) {
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

function findRuntimeChunkModuleMap({ ast, name }: Chunk): WebpackModuleMap {
  const maybeIife = ast.program.body[ast.program.body.length - 1];
  if (
    isSingleExpressionProgram(ast.program.body) &&
    isIIFE(maybeIife) &&
    maybeIife.expression.arguments.length == 1
  ) {
    // webpack 4  - the modules included in the runtime chunk are passed as the first and only arg to the main iife
    return makeModuleMap(maybeIife.expression.arguments[0]);
  } else {
    // webpack 5 - there exists a __webpack_modules__ variable in the body
    const body = maybeUnwrapTopLevelIife(ast.program);
    const variableDecs = body.filter((v) =>
      n.VariableDeclaration.check(v)
    ) as r.VariableDeclaration[];

    // assumes the __webpack_modules__ declaration always comes first
    if (variableDecs.length >= 1 && variableDecs[0].declarations.length >= 1) {
      const dec = variableDecs[0].declarations[0];
      if (
        n.VariableDeclarator.check(dec) &&
        n.ObjectExpression.check(dec.init)
      ) {
        return makeModuleMap(dec.init);
      }
    }
  }

  throw new Error(`Failed to locate module map in chunk ${name}`);
}

function findAdditionalChunkModuleMap({ ast, name }: Chunk): WebpackModuleMap {
  // look for a single expression program with a .push(arg) - could tighten this up but seems to get the job done for now
  if (isSingleExpressionProgram(ast.program.body)) {
    const call = ast.program.body[ast.program.body.length - 1];
    if (
      n.ExpressionStatement.check(call) &&
      n.CallExpression.check(call.expression) &&
      call.expression.arguments.length === 1 &&
      n.MemberExpression.check(call.expression.callee) &&
      n.Identifier.check(call.expression.callee.property) &&
      call.expression.callee.property.name === "push"
    ) {
      const param = call.expression.arguments[0];

      // webpack 4 uses 3 args and webpack 5 uses 2 - the second is always the actual module map (arr or obj)
      // this check is quite loose for brevity but could be tightened
      if (n.ArrayExpression.check(param) && param.elements.length >= 2) {
        return makeModuleMap(param.elements[1]);
      }
    }
  }

  throw new Error(`Failed to locate module map in chunk ${name}`);
}

export async function createDebundle(
  dir: string,
  runtimeChunkIn?: string
): Promise<Debundle> {
  const deb = await createEmptyDebundleFromDir(dir);

  const potentitalRuntimeChunks =
    runtimeChunkIn && deb.chunks.has(runtimeChunkIn)
      ? [deb.chunks.get(runtimeChunkIn)].values()
      : deb.chunks.values();
  const runtimeChunkInfo = findRuntimeChunk(potentitalRuntimeChunks);
  const runtimeChunkModuleMap = findRuntimeChunkModuleMap(
    runtimeChunkInfo.chunk
  );

  for (const chunk of deb.chunks.values()) {
    const { name } = chunk;
    const isRuntimeChunk = chunk === runtimeChunkInfo.chunk;
    const { moduleFns, moduleMapExpr } = isRuntimeChunk
      ? runtimeChunkModuleMap
      : findAdditionalChunkModuleMap(chunk);

    for (const [moduleId, moduleFn] of Object.entries(moduleFns)) {
      if (deb.modules.has(moduleId)) {
        throw new Error(
          `Encountered module ID clash '${moduleId}' - found in ${
            deb.modules.get(moduleId).src
          } and ${name}.`
        );
      }

      // TODO is re-hashing the key the most efficient way to make it URL compliant?
      const hash = createHash("shake256", { outputLength: 4 });
      hash.update(moduleId);
      deb.modules.set(moduleId, {
        // TODO optional content-based naming via heuristic static analysis - does't have to be very accurate just decent
        name: hash.digest("base64url"),
        ast: b.program([
          b.expressionStatement(
            b.assignmentExpression("=", moduleExportsExpr, moduleFn)
          ),
        ]),
        src: chunk,
      });
    }

    if (!isRuntimeChunk) {
      const newModuleMapExpr = n.ArrayExpression.check(moduleMapExpr)
        ? b.arrayExpression([])
        : b.objectExpression([]);

      replaceAstNodes(
        chunk.ast.program,
        // replace the module map in the additional chunk with an empty expression of the same type
        // this ensures chunks are still loaded the same, but modules are not as they are split out
        new Map([[moduleMapExpr, newModuleMapExpr]])
      );
    }
  }

  // now that all the modules have been collected we can codemod the module map expression in the runtime chunk
  const moduleEntries: [string, string][] = [...deb.modules.entries()].map(
    ([k, m]) => [k, `${modulesDirName}/${m.name}`]
  );
  const { moduleMapMemberExpr: runtimeModuleMapMemberExpr } =
    runtimeChunkInfo.requireFn;
  const newRuntimeModuleMapMemberExpr = n.ArrayExpression.check(
    runtimeModuleMapMemberExpr
  )
    ? b.arrayExpression(moduleEntries.map(([_, v]) => b.literal(v)))
    : b.objectExpression(
        moduleEntries.map(([k, v]) =>
          b.property("init", b.literal(k), b.literal(v))
        )
      );

  replaceAstNodes(
    runtimeChunkInfo.chunk.ast.program,
    new Map<r.Node, r.Node>([
      // replace the module map member expression in the require function with require(...)
      [
        runtimeModuleMapMemberExpr,
        b.callExpression(b.identifier("require"), [runtimeModuleMapMemberExpr]),
      ],
      // replace the actual module map expression with our mapping from module ID -> file name
      [runtimeModuleMapMemberExpr, newRuntimeModuleMapMemberExpr],
    ])
  );

  return deb;
}
