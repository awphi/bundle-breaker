import traverse from "@babel/traverse";
import {
  cloneFileNode,
  getIifeCallExpression,
  isIdentifiedFunctionDeclaration,
  isNormalMemberExpression,
  maybeUnwrapTopLevelIife,
  type IdentifiedFunctionDeclaration,
  type NormalMemberExpression,
} from "../ast";
import type { FileNode } from "../types";
import type {
  WebpackModuleMap,
  WebpackRequireFnInfo,
  WebpackRuntimeChunkInfo,
} from "./types";
import * as t from "@babel/types";
import { makeModuleMap } from "./module-map";
import { replace } from "../visitor";

function findModuleMapMemberExprInRequireFn(
  fn: IdentifiedFunctionDeclaration
): NormalMemberExpression {
  // now find the first call expression on a member expression
  // in WP5 this looks like __webpack_modules__[moduleId](module, module.exports, __webpack_require__)
  // in WP4 this looks like modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
  let result: NormalMemberExpression | undefined;
  traverse.cheap(fn, (node) => {
    if (t.isCallExpression(node)) {
      if (isNormalMemberExpression(node.callee)) {
        if (
          isNormalMemberExpression(node.callee.object) &&
          t.isIdentifier(node.callee.property, { name: "call" })
        ) {
          result = node.callee.object;
        } else {
          result = node.callee;
        }
      }
    }
  });

  if (result) {
    return result;
  }

  throw new Error(
    `Unable to find module map member expression in function ${fn.id.name}`
  );
}

function findWebpackRequireFn({ ast, path }: FileNode): WebpackRequireFnInfo {
  const body = maybeUnwrapTopLevelIife(ast.program);

  const functionDecs = body.filter((v) => isIdentifiedFunctionDeclaration(v));
  if (functionDecs.length === 0) {
    throw new Error(`Unable to find webpack require function in file ${path}`);
  }

  // most bundles will just have one function declaration (the require fn), however some webpack4 configs with
  // runtime chunk splitting will have multiple, with the *last* function declaration being the require fn
  const functionDec = functionDecs[functionDecs.length - 1];

  return {
    functionDec,
    moduleMapMemberExpr: findModuleMapMemberExprInRequireFn(functionDec),
  };
}

function findRuntimeChunkModuleMap({ ast, path }: FileNode): WebpackModuleMap {
  const iife = getIifeCallExpression(ast.program.body[0]);
  if (ast.program.body.length === 1 && iife && iife.arguments.length == 1) {
    // webpack 4  - the modules included in the runtime chunk are passed as the first and only arg to the main iife
    return makeModuleMap(iife.arguments[0]);
  } else {
    // webpack 5 - there exists a __webpack_modules__ variable in the body
    const body = maybeUnwrapTopLevelIife(ast.program);
    const firstVariableDec = body.find((v) => t.isVariableDeclaration(v));

    // we expect the module map expression to be in the first non-empty variable declaration
    // within that declaration we will look for the first object definition declarator
    if (firstVariableDec) {
      for (const declarator of firstVariableDec.declarations) {
        if (t.isObjectExpression(declarator.init)) {
          return makeModuleMap(declarator.init);
        }
      }
    }
  }

  throw new Error(`Failed to locate module map in file ${path}`);
}

export function findRuntimeChunk(
  files: IterableIterator<FileNode>
): WebpackRuntimeChunkInfo {
  for (const file of files) {
    try {
      const requireFn = findWebpackRequireFn(file);
      const moduleMap = findRuntimeChunkModuleMap(file);

      return {
        chunk: file,
        requireFn,
        moduleMap,
      };
    } catch (_) {}
  }

  const names = Array.from(files)
    .map((f) => f.path)
    .join(", ");
  throw new Error(`Failed to find runtime file in files: ${names}`);
}

export function createPatchedRuntimeChunk(
  original: WebpackRuntimeChunkInfo,
  moduleMappingChunkName: string
): FileNode {
  const moduleMapMemberExpr = original.requireFn.moduleMapMemberExpr;
  const newRuntime = cloneFileNode(original.chunk);

  // look in module_mapping first to deal with computed IDs and unprocessed require calls
  // if not found then we've probably modified it so we can assume it's a module file on disk
  // this boils down to something like `require(__webpack_modules__[moduleId] || "./modules/" + moduleId)(...)`
  const moduleMapMemberExprWithFallback = t.logicalExpression(
    "||",
    moduleMapMemberExpr,
    moduleMapMemberExpr.property
  );

  const requireIdentifier = t.identifier("require");

  traverse(
    newRuntime.ast,
    replace(
      original.requireFn.moduleMapMemberExpr,
      t.callExpression(requireIdentifier, [moduleMapMemberExprWithFallback])
    )
  );

  traverse(
    newRuntime.ast,
    replace(
      original.moduleMap.expression,
      t.callExpression(requireIdentifier, [
        t.stringLiteral(moduleMappingChunkName),
      ])
    )
  );

  return newRuntime;
}
