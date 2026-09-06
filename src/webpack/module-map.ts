import type { WebpackModuleMap } from "./types";
import type { AnyFunctionExpression } from "../ast";
import * as t from "@babel/types";
import { extractObjectMethodFunction, isAnyFunctionExpression } from "../ast";

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

export function makeModuleMap(expr?: t.Node): WebpackModuleMap {
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

/**
 * Like `makeModuleMap`, but never throws - returns undefined if `expr` isn't
 * an object/array expression, or if it doesn't contain any module functions.
 * Used to trial-parse candidate expressions when we don't yet know which one
 * (if any) is the real module map, matched by content rather than by which
 * declaration/property name webpack happened to wrap it in.
 */
export function tryMakeModuleMap(
  expr: t.Node | null | undefined
): WebpackModuleMap | undefined {
  if (!t.isObjectExpression(expr) && !t.isArrayExpression(expr)) {
    return undefined;
  }

  try {
    const map = makeModuleMap(expr);
    return map.moduleFns.size > 0 ? map : undefined;
  } catch {
    return undefined;
  }
}
