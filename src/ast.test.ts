import { describe, expect, it } from "vitest";
import * as t from "@babel/types";
import * as parser from "@babel/parser";
import {
  isAnyFunctionExpression,
  getIifeCallExpression,
  maybeUnwrapTopLevelIife,
  extractObjectMethodFunction,
} from "./ast";

function program(
  strings: TemplateStringsArray,
  ...values: unknown[]
): t.Program {
  const code = String.raw({ raw: strings }, ...values);
  return parser.parse(code, { sourceType: "unambiguous" }).program;
}

function stmt(
  strings: TemplateStringsArray,
  ...values: unknown[]
): t.Statement {
  return program(strings, ...values).body[0];
}

function expr(
  strings: TemplateStringsArray,
  ...values: unknown[]
): t.Expression {
  const statement = stmt(strings, ...values);
  if (!t.isExpressionStatement(statement)) {
    throw new Error("expected an expression statement");
  }
  return statement.expression;
}

describe("isAnyFunctionExpression", () => {
  it("accepts function expressions", () => {
    expect(isAnyFunctionExpression(expr`(function () {})`)).toBe(true);
  });

  it("accepts arrow function expressions", () => {
    expect(isAnyFunctionExpression(expr`() => {}`)).toBe(true);
  });

  it("rejects other node types", () => {
    expect(isAnyFunctionExpression(expr`x`)).toBe(false);
    expect(isAnyFunctionExpression(stmt`function foo() {}`)).toBe(false);
  });
});

describe("getIifeCallExpression", () => {
  it("finds a plain iife", () => {
    const result = getIifeCallExpression(stmt`(function () {})();`);
    expect(result).toBeDefined();
    expect(isAnyFunctionExpression(result!.callee)).toBe(true);
  });

  it("finds an arrow iife", () => {
    const result = getIifeCallExpression(stmt`(() => {})();`);
    expect(result).toBeDefined();
  });

  it("finds a unary-wrapped iife", () => {
    const result = getIifeCallExpression(stmt`!function () {}();`);
    expect(result).toBeDefined();
  });

  it("returns undefined for a call to a named function", () => {
    expect(getIifeCallExpression(stmt`foo();`)).toBeUndefined();
  });

  it("returns undefined for a call whose callee is itself a call", () => {
    expect(getIifeCallExpression(stmt`foo()();`)).toBeUndefined();
  });

  it("returns undefined for non-expression statements", () => {
    expect(getIifeCallExpression(stmt`var x = 1;`)).toBeUndefined();
  });
});

describe("maybeUnwrapTopLevelIife", () => {
  it("unwraps the body of a single top-level iife", () => {
    const result = maybeUnwrapTopLevelIife(
      program`(function () { foo(); bar(); })();`
    );
    expect(result).toHaveLength(2);
  });

  it("leaves the program untouched when there are multiple statements", () => {
    const src = program`(function () { foo(); })(); bar();`;
    expect(maybeUnwrapTopLevelIife(src)).toBe(src.body);
  });

  it("leaves the program untouched when the sole statement isn't an iife", () => {
    const src = program`foo();`;
    expect(maybeUnwrapTopLevelIife(src)).toBe(src.body);
  });

  it("leaves the program untouched when the iife body isn't a block", () => {
    const src = program`(() => 1)();`;
    expect(maybeUnwrapTopLevelIife(src)).toBe(src.body);
  });
});

describe("extractObjectMethodFunction", () => {
  it("converts a shorthand method into an equivalent function expression", () => {
    const obj = expr`({ foo(a, b) { return a + b; } })` as t.ObjectExpression;
    const method = obj.properties[0] as t.ObjectMethod;

    const fn = extractObjectMethodFunction(method);

    expect(t.isFunctionExpression(fn)).toBe(true);
    expect(fn.params).toBe(method.params);
    expect(fn.body).toBe(method.body);
  });

  it("preserves async/generator flags", () => {
    const obj = expr`({ async *foo() {} })` as t.ObjectExpression;
    const method = obj.properties[0] as t.ObjectMethod;

    const fn = extractObjectMethodFunction(method);

    expect(fn.async).toBe(true);
    expect(fn.generator).toBe(true);
  });
});
