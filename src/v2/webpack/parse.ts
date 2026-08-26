import * as t from "@babel/types";
import type { FileNode } from "../types";
import traverse from "@babel/traverse";
import {
  extractObjectMethodFunction,
  getIifeCallExpression,
  isAnyFunctionExpression,
  maybeUnwrapTopLevelIife,
  type AnyFunctionExpression,
} from "../ast";

// TODO test this file

export interface WebpackModuleMap {
  moduleFns: Map<string, AnyFunctionExpression>;
  expression: t.ObjectExpression | t.ArrayExpression;
}

export interface WebpackRequireFnInfo {
  functionDec: t.FunctionDeclaration & { id: t.Identifier };
  moduleMapMemberExpr: t.MemberExpression;
}

export interface WebpackRuntimeChunkInfo {
  file: string;
  requireFn: WebpackRequireFnInfo;
  moduleMap: WebpackModuleMap;
}

export function findRuntimeChunk(
  files: IterableIterator<FileNode>
): WebpackRuntimeChunkInfo {
  for (const file of files) {
    try {
      const requireFn = findWebpackRequireFn(file);
      const moduleMap = findRuntimeChunkModuleMap(file);

      return {
        file: file.path,
        requireFn,
        moduleMap,
      };
    } catch (_) {}
  }

  throw new Error("Failed to auto-detect runtime chunk.");
}

// TODO this function can 100% be tidied up
function findWebpackRequireFn({ ast, path }: FileNode): WebpackRequireFnInfo {
  let functionDec: t.FunctionDeclaration | undefined = undefined;
  let moduleMapMemberExpr: t.MemberExpression | undefined = undefined;
  const body = maybeUnwrapTopLevelIife(ast.program);

  const functionDecs = body.filter((v) => t.isFunctionDeclaration(v));

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
    throw new Error(`Unable to find webpack require function in file ${path}`);
  }

  return {
    functionDec: functionDec as WebpackRequireFnInfo["functionDec"],
    moduleMapMemberExpr,
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

function makeModuleMapFromObject(expr: t.ObjectExpression): WebpackModuleMap {
  const moduleFns = new Map<string, AnyFunctionExpression>();
  for (const prop of expr.properties) {
    if (t.isSpreadElement(prop)) {
      continue;
    }

    const key = prop.key;

    if (!t.isStringLiteral(key) && !t.isNumericLiteral(key)) {
      continue;
    }

    const moduleId = key.value.toString();

    if (t.isObjectProperty(prop) && isAnyFunctionExpression(prop.value)) {
      moduleFns.set(moduleId, prop.value);
    } else if (t.isObjectMethod(prop, { kind: "method" })) {
      // recent webpack5 versions render module wrapper functions as ES6 shorthand
      // methods (e.g. `207(module) {...}`) rather than `207: (module) => {...}`
      const fn = extractObjectMethodFunction(prop);
      moduleFns.set(moduleId, fn);
    }
  }

  return { expression: expr, moduleFns };
}

function makeModuleMapFromArray(expr: t.ArrayExpression): WebpackModuleMap {
  const moduleFns = new Map<string, AnyFunctionExpression>();
  for (let i = 0; i < expr.elements.length; i++) {
    const fn = expr.elements[i];
    if (fn && isAnyFunctionExpression(fn)) {
      moduleFns.set(i.toString(), fn);
    }
  }

  return { expression: expr, moduleFns };
}

function makeModuleMap(expr?: t.Node): WebpackModuleMap {
  if (t.isObjectExpression(expr)) {
    return makeModuleMapFromObject(expr);
  }

  if (t.isArrayExpression(expr)) {
    return makeModuleMapFromArray(expr);
  }

  throw new Error(
    `Cannot construct module map from node of type ${expr?.type}`
  );
}
