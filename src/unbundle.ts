import path from "path";
import fs from "fs/promises";
import type {
  WebpackChunk,
  WebpackBundle,
  WebpackModuleMap,
  WebpackRequireFnInfo,
  WebpackRuntimeChunkInfo,
} from "./types";
import * as recast from "recast";

const recastOpts: recast.Options = { tabWidth: 2 };
const modulesDirName = "./modules";

import r = recast.types.namedTypes;
import {
  ensureDirectory,
  isIIFE,
  isSingleExpressionProgram,
  makeModuleMap,
  maybeUnwrapTopLevelIife,
  replaceAstNodes,
} from "./utils";
import { createHash } from "crypto";
const n = recast.types.namedTypes;
const b = recast.types.builders;

function findRuntimeChunk(
  chunks: IterableIterator<WebpackChunk>
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

export async function makeBundle(
  dir: string,
  entryIn?: string
): Promise<WebpackBundle> {
  await ensureDirectory(dir, false, false);

  // TODO should use a glob
  const fileNames = await fs.readdir(dir);

  if (fileNames.length === 0) {
    throw new Error(`Directory '${dir}' is empty.`);
  }

  const chunks: WebpackBundle["chunks"] = new Map();
  let size: number = 0;

  await Promise.all(
    fileNames.map(async (name) => {
      try {
        await fs.readFile(path.join(dir, name)).then((content) => {
          const code = content.toString();
          chunks.set(name, {
            code,
            ast: recast.parse(code),
            name: name,
          });
          size += content.byteLength;
        });
      } catch (e) {}
    })
  );

  const potentitalRuntimeChunks =
    entryIn && chunks.has(entryIn)
      ? [chunks.get(entryIn)].values()
      : chunks.values();
  const runtimeChunkInfo = findRuntimeChunk(potentitalRuntimeChunks);

  const modules: WebpackBundle["modules"] = new Map();
  for (const chunk of chunks.values()) {
    const findModuleMapFn =
      chunk === runtimeChunkInfo.chunk
        ? findEntryModuleMap
        : findAdditionalChunkModuleMap;
    chunk.moduleMap = findModuleMapFn(chunk);

    for (const [key, value] of Object.entries(chunk.moduleMap!.modules)) {
      if (modules.has(key)) {
        throw new Error(
          `Encountered module ID clash '${key}' - found in ${
            modules.get(key).src
          } and ${chunk.name}.`
        );
      }

      // TODO is re-hashing the key the most efficient way to make it URL compliant?
      const hash = createHash("shake256", { outputLength: 4 });
      hash.update(key);
      modules.set(key, {
        // TODO optional content-based naming via heuristic static analysis - does't have to be very accurate just decent
        name: hash.digest("base64url"),
        fn: value,
        src: chunk.name,
      });
    }
  }

  return {
    chunks,
    size,
    runtimeChunkInfo,
    modules,
  };
}

function findWebpackRequireFn({
  ast,
  name,
}: WebpackChunk): WebpackRequireFnInfo {
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

function findEntryModuleMap({ ast, name }: WebpackChunk): WebpackModuleMap {
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

function findAdditionalChunkModuleMap({
  ast,
  name,
}: WebpackChunk): WebpackModuleMap {
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

// codemod the webpack module functions and write to disk
async function writeModulesDirectory(
  bundle: WebpackBundle,
  outDir: string,
  ext: string
): Promise<void> {
  const promises: Promise<void>[] = [];

  const moduleExportsExpr = b.memberExpression(
    b.identifier("module"),
    b.identifier("exports")
  );

  for (const moduleId of bundle.modules.keys()) {
    const { fn, name } = bundle.modules.get(moduleId)!;

    const moduleProgram = b.program([
      b.expressionStatement(b.assignmentExpression("=", moduleExportsExpr, fn)),
    ]);

    const outputCode = recast.prettyPrint(moduleProgram, recastOpts).code;
    promises.push(
      fs.writeFile(path.join(outDir, `${name}.${ext}`), outputCode)
    );
  }
  await Promise.all(promises);
}

async function writeRuntimeChunk(
  bundle: WebpackBundle,
  outDir: string,
  ext: string
): Promise<void> {
  const {
    chunk,
    requireFn: { moduleMapMemberExpr },
  } = bundle.runtimeChunkInfo;
  const {
    ast,
    name,
    moduleMap: { moduleMapExpr },
  } = chunk;

  const modules: [string, r.Literal][] = [...bundle.modules.entries()].map(
    ([k, m]) => [k, b.literal(path.join(modulesDirName, `${m.name}.${ext}`))]
  );
  const newModuleMapExpr = n.ArrayExpression.check(moduleMapExpr)
    ? b.arrayExpression(modules.map(([_, v]) => v))
    : b.objectExpression(
        modules.map(([k, v]) => b.property("init", b.literal(k), v))
      );

  replaceAstNodes(
    ast.program,
    new Map<r.Node, r.Node>([
      // replace the module map member expression in the require function with require(...)
      [
        moduleMapMemberExpr,
        b.callExpression(b.identifier("require"), [moduleMapMemberExpr]),
      ],
      // replace the actual module map expression with our mapping from module ID -> file name
      [moduleMapExpr, newModuleMapExpr],
    ])
  );

  const { code } = recast.prettyPrint(ast.program, recastOpts);
  const outFile = `${name.slice(0, -path.extname(name).length)}.${ext}`;
  await fs.writeFile(path.join(outDir, outFile), code);
}

export async function writeAdditionalChunks(
  bundle: WebpackBundle,
  outDir: string,
  ext: string
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const chunk of bundle.chunks.values()) {
    if (
      chunk === bundle.runtimeChunkInfo.chunk ||
      chunk.moduleMap === undefined
    ) {
      continue;
    }

    const { ast, name } = chunk;

    const { moduleMapExpr } = chunk.moduleMap;
    const newModuleMapExpr = n.ArrayExpression.check(moduleMapExpr)
      ? b.arrayExpression([])
      : b.objectExpression([]);

    replaceAstNodes(ast.program, new Map([[moduleMapExpr, newModuleMapExpr]]));

    const outputCode = recast.prettyPrint(ast.program, recastOpts).code;
    const outFile = `${name.slice(0, -path.extname(name).length)}.${ext}`;
    promises.push(fs.writeFile(path.join(outDir, outFile), outputCode));
  }

  await Promise.all(promises);
}

export async function writeBundle(
  outDir: string,
  bundle: WebpackBundle,
  clear: boolean,
  ext: string
): Promise<void> {
  const moduleDir = path.resolve(outDir, modulesDirName);
  await ensureDirectory(outDir, clear);
  await ensureDirectory(moduleDir, clear);

  await Promise.all([
    writeModulesDirectory(bundle, moduleDir, ext),
    writeRuntimeChunk(bundle, outDir, ext),
    writeAdditionalChunks(bundle, outDir, ext),
  ]);
}
