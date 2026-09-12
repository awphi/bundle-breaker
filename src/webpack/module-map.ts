import type { ModuleFnMap } from "./types";
import type { AnyFunctionExpression } from "../ast";
import * as t from "@babel/types";
import {
  extractObjectMethodFunction,
  isAnyFunctionExpression,
  isNormalMemberExpression,
} from "../ast";

export function getJsonpPushedArray(
  stmt: t.Statement
): t.ArrayExpression | undefined {
  if (!t.isExpressionStatement(stmt) || !t.isCallExpression(stmt.expression)) {
    return undefined;
  }
  const { callee, arguments: args } = stmt.expression;
  if (
    !isNormalMemberExpression(callee) ||
    !t.isIdentifier(callee.property, { name: "push" }) ||
    args.length !== 1 ||
    !t.isArrayExpression(args[0])
  ) {
    return undefined;
  }
  return args[0];
}

function makeModuleMapFromObject(expr: t.ObjectExpression): ModuleFnMap {
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
      moduleFns.set(moduleId, extractObjectMethodFunction(prop));
    }
  }

  return moduleFns;
}

function makeModuleMapFromArray(expr: t.ArrayExpression): ModuleFnMap {
  const moduleFns = new Map<string, AnyFunctionExpression>();
  for (let i = 0; i < expr.elements.length; i++) {
    const fn = expr.elements[i];
    if (fn && isAnyFunctionExpression(fn)) {
      moduleFns.set(i.toString(), fn);
    }
  }

  return moduleFns;
}

export function makeModuleMap(expr?: t.Node): ModuleFnMap {
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
