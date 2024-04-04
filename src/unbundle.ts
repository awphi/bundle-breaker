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
  replaceAstNodes,
} from "./utils";
const n = recast.types.namedTypes;
const b = recast.types.builders;

function findRuntimeChunk(
  chunks: IterableIterator<Chunk>
): WebpackRuntimeChunkInfo {
  for (const chunk of chunks) {
    try {
      // attempt to make an object, simply try the next chunk if we get an error
      const requireFn = findWebpackRequireFn(chunk);
      const moduleMap = findEntryModuleMap(chunk);
      return {
        chunk,
        requireFn,
        moduleMap,
      };
    } catch {}
  }

  throw new Error("Failed to auto-detect entry file.");
}

// create a bundle object to store ASTs, file paths and sizes
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
  for (const chunk of files.values()) {
    const findModuleMapFn =
      chunk.name === runtimeChunkInfo.chunk.name
        ? findEntryModuleMap
        : findAdditionalChunkModuleMap;
    const newModules = Object.entries(findModuleMapFn(chunk).modules);

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
  let body: r.Program["body"] = [];

  // try to extract the actual top-level meat of the program - this should be the require fn, module cache and entry user code IIFE etc.
  if (isSingleExpressionProgram(ast.program.body)) {
    const iife = ast.program.body[ast.program.body.length - 1];
    if (isIIFE(iife) && n.BlockStatement.check(iife.expression.callee.body)) {
      body = iife.expression.callee.body.body;
    }
  } else {
    body = ast.program.body;
  }

  const functionDecs = body.filter((v) =>
    n.FunctionDeclaration.check(v)
  ) as r.FunctionDeclaration[];

  // most bundles will just have one function declaration (the require fn), however some webpack4 configs with
  // runtime chunk splitting will have multiple, with the *last* function declaration being the require fn
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

  // TODO we may be able to re-use some logic from findWebpackRequireFn and passing in here
  if (isSingleExpressionProgram(ast.program.body)) {
    const iife = ast.program.body[ast.program.body.length - 1];
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
