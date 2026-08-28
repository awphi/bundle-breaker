import { describe, expect, it } from "vitest";
import * as t from "@babel/types";
import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import { replace } from "./visitor";

function program(
  strings: TemplateStringsArray,
  ...values: unknown[]
): t.Program {
  const code = String.raw({ raw: strings }, ...values);
  return parser.parse(code, { sourceType: "unambiguous" }).program;
}

describe("replace", () => {
  it("replaces the targeted node in place", () => {
    const ast = program`foo(a, b);`;
    const call = (ast.body[0] as t.ExpressionStatement)
      .expression as t.CallExpression;
    const target = call.arguments[0] as t.Node;
    const replacement = t.identifier("c");

    traverse(ast, replace(target, replacement));

    expect(call.arguments[0]).toBe(replacement);
  });

  it("only replaces the exact node instance, not other nodes of the same type", () => {
    const ast = program`foo(a, a);`;
    const call = (ast.body[0] as t.ExpressionStatement)
      .expression as t.CallExpression;
    const first = call.arguments[0] as t.Node;
    const second = call.arguments[1] as t.Node;
    const replacement = t.identifier("c");

    traverse(ast, replace(first, replacement));

    expect(call.arguments[0]).toBe(replacement);
    expect(call.arguments[1]).toBe(second);
  });

  it("does nothing when the target node isn't present in the tree", () => {
    const ast = program`foo(a, b);`;
    const call = (ast.body[0] as t.ExpressionStatement)
      .expression as t.CallExpression;
    const [first, second] = call.arguments;
    const stray = t.identifier("z");
    const replacement = t.identifier("c");

    traverse(ast, replace(stray, replacement));

    expect(call.arguments[0]).toBe(first);
    expect(call.arguments[1]).toBe(second);
  });
});
