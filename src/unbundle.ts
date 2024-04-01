import path from "path";
import fs from "fs/promises";
import type {
  AnyFunctionExpression,
  Chunk,
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
  replaceAstNode,
} from "./utils";
const n = recast.types.namedTypes;
const b = recast.types.builders;

function findRuntimeChunk(
  chunks: IterableIterator<Chunk>
): WebpackRuntimeChunkInfo {
  for (const chunk of chunks) {
    try {
      // attempt to make an object, simply try the next chunk if we get an error
      const info: WebpackRuntimeChunkInfo = {
        chunk,
        requireFn: findWebpackRequireFn(chunk),
        moduleMap: findEntryModuleMap(chunk),
      };
      return info;
    } catch {}
  }

  throw new Error("Failed to auto-detect entry file.");
}

// create a bundle object to store ASTs, file paths and sizes
export async function makeBundle(
  dir: string,
  entryIn?: string
): Promise<WebpackBundle> {
  await ensureDirectory(dir, false);

  // TODO should use a glob
  const fileNames = await fs.readdir(dir);

  if (fileNames.length === 0) {
    throw new Error(`Directory '${dir}' is empty.`);
  }

  const files: WebpackBundle["files"] = new Map();
  let size: number = 0;

  await Promise.all(
    fileNames.map(async (name) => {
      try {
        await fs.readFile(path.join(dir, name)).then((content) => {
          const code = content.toString();
          files.set(name, {
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
    entryIn && files.has(entryIn)
      ? [files.get(entryIn)].values()
      : files.values();
  const runtimeChunkInfo = findRuntimeChunk(potentitalRuntimeChunks);

  const modules: WebpackBundle["modules"] = new Map();
  for (const { ast, name: fileName } of files.values()) {
    const findModuleMapFn =
      fileName === runtimeChunkInfo.chunk.name
        ? findEntryModuleMap
        : findAdditionalChunkModuleMap;
    const newModules = Object.entries(findModuleMapFn(ast).modules);

    for (const [key, value] of newModules) {
      if (modules.has(key)) {
        throw new Error(`Encountered module ID clash '${key}'.`);
      }

      modules.set(key, {
        name: key,
        fn: value,
      });
    }
  }

  return {
    files,
    size,
    runtimeChunkInfo,
    modules,
  };
}

function findWebpackRequireFn({
  ast,
  name: fileName,
}: Chunk): WebpackRequireFnInfo {
  let functionDec: r.FunctionDeclaration | undefined = undefined;
  let moduleMapMemberExpr: r.MemberExpression | undefined = undefined;

  recast.visit(ast, {
    visitCallExpression(path) {
      const node = path.node;
      // ExpressionStatement > BlockStatement > FunctionDeclaration
      const funcParent = path.parent?.parent?.parent?.node;
      // expect something like function(e) { something[e].call(arg1, arg2, arg3, arg4) }
      // and return a ref to that function and that something[e] member expression
      if (
        funcParent &&
        r.MemberExpression.check(node.callee) &&
        r.MemberExpression.check(node.callee.object) &&
        node.callee.object.computed === true &&
        r.Identifier.check(node.callee.object.property) &&
        r.Identifier.check(node.callee.property) &&
        node.callee.property.name === "call" &&
        node.arguments.length === 4 &&
        r.FunctionDeclaration.check(funcParent) &&
        funcParent.params.length === 1 &&
        r.Identifier.check(funcParent.params[0]) &&
        funcParent.params[0].name === node.callee.object.property.name
      ) {
        functionDec = funcParent;
        moduleMapMemberExpr = node.callee.object;
        return false;
      }
      this.traverse(path);
    },
  });

  if (functionDec === undefined || moduleMapMemberExpr === undefined) {
    throw new Error(`Unable to find webpack require function in '${fileName}'`);
  }

  return {
    declaration: functionDec,
    moduleMapMemberExpr,
  };
}

function findEntryModuleMap({ ast }: Chunk): WebpackModuleMap {
  const modules: Record<string, AnyFunctionExpression> = {};
  let expr: r.ObjectExpression | r.ArrayExpression;

  if (isSingleExpressionProgram(ast.program)) {
    const iife = ast.program.body[ast.body.length - 1];
    if (isIIFE(iife)) {
      // it's webpack 4 (or 5 with an iife)
      // TODO check if webpack 5 (by looking for a lack of args to the iife - otherwise we can re-use the logic below for webpack 5 without an iife)
    }
  } else {
    // it's webpack 5 (without an iife)
    // TODO extract modules out
  }

  return {
    modules,
    expr,
  };
}

function findAdditionalChunkModuleMap({ ast }: Chunk): WebpackModuleMap {
  const modules: Record<string, AnyFunctionExpression> = {};
  let expr: r.ObjectExpression | r.ArrayExpression;

  // look for a single expression program with a .push(arg) - could tighten this up but seems to get the job done for now
  if (isSingleExpressionProgram(ast)) {
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
      // TODO finish this up - check exact structure of the params of a webpack5 .push() call
    }
  }

  return { modules, expr };
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
    chunk: { ast },
    requireFn: { moduleMapMemberExpr },
    moduleMap: { expr: moduleMapExpr },
  } = bundle.runtimeChunkInfo;

  // replace the `moduleMap[e]` in the require function with `require(moduleMap[e])`
  replaceAstNode(
    moduleMapMemberExpr,
    b.callExpression(b.identifier("require"), [moduleMapMemberExpr])
  );

  // replace the actual module map expression with our mapping from module ID -> file name
  const modules: [string, r.Literal][] = [...bundle.modules.entries()].map(
    ([k, m]) => [k, b.literal(path.join(modulesDirName, `${m.name}.${ext}`))]
  );
  const newModuleMapExpr = n.ArrayExpression.check(moduleMapExpr)
    ? b.arrayExpression(modules.map(([_, v]) => v))
    : b.objectExpression(
        modules.map(([k, v]) => b.property("init", b.literal(k), v))
      );
  replaceAstNode(moduleMapExpr, newModuleMapExpr);

  const { code } = recast.prettyPrint(ast.program, recastOpts);
  await fs.writeFile(path.join(outDir, `index.${ext}`), code);
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
  ]);
}
