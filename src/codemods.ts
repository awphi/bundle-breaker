import type {
  AnyNode,
  ArrowFunctionExpression,
  BlockStatement,
  ExpressionStatement,
  FunctionExpression,
  ObjectExpression,
  Program,
} from "acorn";
import type { WebpackModuleMapExpression } from "./types.js";

export function isIIFE(node: AnyNode): node is ExpressionStatement {
  if (node.type === "ExpressionStatement") {
    if (node.expression.type === "UnaryExpression") {
      return isIIFE(node.expression.argument);
    } else if (node.expression.type === "CallExpression") {
      return isIIFE(node.expression);
    } else {
      return false;
    }
  }

  return (
    node.type === "CallExpression" &&
    (node.callee.type === "FunctionExpression" ||
      node.callee.type === "ArrowFunctionExpression") &&
    node.callee.id == null
  );
}

export function isSingleExpressionProgram(
  ast: Program | BlockStatement
): boolean {
  return (
    ast.body.length === 1 ||
    (ast.body.length === 2 &&
      ast.body[0].type === "ExpressionStatement" &&
      ast.body[0].directive === "use strict")
  );
}

// wrap a webpack module function up as an IIFE with the required arguments to work in node/cjs bundlers (require, module.exports etc.)
export function iifefyWebpackModuleFn(
  moduleFn: ArrowFunctionExpression | FunctionExpression
): ExpressionStatement {
  return {
    type: "ExpressionStatement",
    start: 0,
    end: 79,
    expression: {
      type: "CallExpression",
      start: 0,
      end: 78,
      callee: {
        type: "MemberExpression",
        start: 0,
        end: 29,
        object: moduleFn,
        property: {
          type: "Identifier",
          start: 25,
          end: 29,
          name: "call",
        },
        computed: false,
        optional: false,
      },
      arguments: [
        {
          type: "MemberExpression",
          start: 30,
          end: 44,
          object: {
            type: "Identifier",
            start: 30,
            end: 36,
            name: "module",
          },
          property: {
            type: "Identifier",
            start: 37,
            end: 44,
            name: "exports",
          },
          computed: false,
          optional: false,
        },
        {
          type: "Identifier",
          start: 46,
          end: 52,
          name: "module",
        },
        {
          type: "MemberExpression",
          start: 54,
          end: 68,
          object: {
            type: "Identifier",
            start: 54,
            end: 60,
            name: "module",
          },
          property: {
            type: "Identifier",
            start: 61,
            end: 68,
            name: "exports",
          },
          computed: false,
          optional: false,
        },
        {
          type: "Identifier",
          start: 70,
          end: 77,
          name: "require",
        },
      ],
      optional: false,
    },
  };
}

export function isWebpackModuleMap(
  node: ObjectExpression
): node is WebpackModuleMapExpression {
  return (
    node.properties.length > 0 &&
    node.properties.every((prop) => {
      return (
        prop.type === "Property" &&
        prop.key.type === "Literal" &&
        prop.key.raw &&
        !Number.isNaN(Number.parseInt(prop.key.raw)) &&
        (prop.value.type === "ArrowFunctionExpression" ||
          prop.value.type === "FunctionExpression") &&
        prop.value.params.length <= 3
      );
    })
  );
}

// true if a contains b
export function astNodeContains(a: AnyNode, b: AnyNode): boolean {
  return b.start > a.start && b.end < a.end;
}
