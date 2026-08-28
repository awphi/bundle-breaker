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
import type { PatchedRuntimeChunk, WebpackModuleMap } from "./types";
import * as t from "@babel/types";
import { makeModuleMap } from "./module-map";

function findModuleMapMemberExprInRequireFn(
  fn: IdentifiedFunctionDeclaration
): NormalMemberExpression {
  // find the first call expression on a member expression
  // in WP5 this looks like __webpack_modules__[moduleId](module, module.exports, __webpack_require__)
  // in WP4 this looks like modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
  let result: NormalMemberExpression | undefined;
  traverse.cheap(fn, (node) => {
    if (result || !t.isCallExpression(node)) {
      return;
    }
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
  });

  if (result) {
    return result;
  }

  throw new Error(
    `Unable to find module map member expression in function ${fn.id.name}`
  );
}

function findWebpackRequireFn({
  ast,
  path,
}: FileNode): IdentifiedFunctionDeclaration {
  const body = maybeUnwrapTopLevelIife(ast.program);

  const functionDecs = body.filter((v) => isIdentifiedFunctionDeclaration(v));
  if (functionDecs.length === 0) {
    throw new Error(`Unable to find webpack require function in file ${path}`);
  }

  // most bundles will just have one function declaration (the require fn), however some webpack4 configs with
  // runtime chunk splitting will have multiple, with the *last* function declaration being the require fn
  const functionDec = functionDecs[functionDecs.length - 1];
  findModuleMapMemberExprInRequireFn(functionDec);

  return functionDec;
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

function findRuntimeChunk(files: readonly FileNode[]): FileNode {
  for (const file of files) {
    try {
      findWebpackRequireFn(file);
      findRuntimeChunkModuleMap(file);
      return file;
    } catch (_) {}
  }

  const names = files.map((f) => f.path).join(", ");
  throw new Error(`Failed to find runtime file in files: ${names}`);
}

function patchRuntimeChunk(
  chunk: FileNode,
  moduleMappingChunkName: string
): PatchedRuntimeChunk {
  const newRuntime = cloneFileNode(chunk);
  const requireIdentifier = t.identifier("require");
  const body = maybeUnwrapTopLevelIife(newRuntime.ast.program);
  const functionDec = findWebpackRequireFn(newRuntime);

  // in WP5 this looks like __webpack_modules__[moduleId](module, module.exports, __webpack_require__)
  // in WP4 this looks like modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
  let patchedRequireCall = false;
  traverse.cheap(functionDec, (node) => {
    if (patchedRequireCall || !t.isCallExpression(node)) {
      return;
    }
    if (isNormalMemberExpression(node.callee)) {
      const callee = node.callee;

      // look in module_mapping first to deal with computed IDs and unprocessed require calls
      // if not found then we've probably modified it so we can assume it's a module file on disk
      // this boils down to something like `require(__webpack_modules__[moduleId] || "./modules/" + moduleId)(...)`
      if (
        isNormalMemberExpression(callee.object) &&
        t.isIdentifier(callee.property, { name: "call" })
      ) {
        const target = callee.object;
        const withFallback = t.logicalExpression(
          "||",
          t.cloneNode(target, true),
          t.cloneNode(target.property, true)
        );
        callee.object = t.callExpression(requireIdentifier, [withFallback]);
      } else {
        const withFallback = t.logicalExpression(
          "||",
          t.cloneNode(callee, true),
          t.cloneNode(callee.property, true)
        );
        node.callee = t.callExpression(requireIdentifier, [withFallback]);
      }
      patchedRequireCall = true;
    }
  });
  if (!patchedRequireCall) {
    throw new Error(
      `Unable to find module map member expression in function ${functionDec.id.name}`
    );
  }

  const mappingRequireCall = t.callExpression(requireIdentifier, [
    t.stringLiteral(moduleMappingChunkName),
  ]);
  let moduleMap: WebpackModuleMap | undefined;
  const iife = getIifeCallExpression(newRuntime.ast.program.body[0]);
  if (
    newRuntime.ast.program.body.length === 1 &&
    iife &&
    iife.arguments.length == 1
  ) {
    // webpack 4 - the modules included in the runtime chunk are passed as the first and only arg to the main iife
    const arg = iife.arguments[0];
    if (t.isExpression(arg)) {
      moduleMap = makeModuleMap(arg);
      iife.arguments[0] = mappingRequireCall;
    }
  } else {
    // webpack 5 - there exists a __webpack_modules__ variable in the body; we expect the module map
    // expression to be the first object-initialized declarator in the first non-empty variable declaration
    const firstVariableDec = body.find((v) => t.isVariableDeclaration(v));
    for (const declarator of firstVariableDec?.declarations ?? []) {
      if (t.isObjectExpression(declarator.init)) {
        moduleMap = makeModuleMap(declarator.init);
        declarator.init = mappingRequireCall;
        break;
      }
    }
  }

  if (!moduleMap) {
    throw new Error(`Failed to locate module map in file ${newRuntime.path}`);
  }

  return { chunk: newRuntime, moduleMap };
}

export function createPatchedRuntimeChunk(
  files: IterableIterator<FileNode>,
  moduleMappingChunkName: string
): PatchedRuntimeChunk {
  const chunk = findRuntimeChunk(Array.from(files));
  return patchRuntimeChunk(chunk, moduleMappingChunkName);
}
