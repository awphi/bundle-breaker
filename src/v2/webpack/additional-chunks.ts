import * as t from "@babel/types";
import type { FileNode } from "../types";
import type { WebpackModuleMap } from "./types";
import { makeModuleMap } from "./module-map";

export function findAdditionalChunkModuleMap({
  ast,
  path,
}: FileNode): WebpackModuleMap {
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
      if (
        t.isArrayExpression(param) &&
        param.elements.length >= 2 &&
        t.isExpression(param.elements[1])
      ) {
        return makeModuleMap(param.elements[1]);
      }
    }
  }

  throw new Error(`Failed to locate module map in file ${path}`);
}
