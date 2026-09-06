import { describe, expect, it } from "vitest";
import * as parser from "@babel/parser";
import generate from "@babel/generator";
import { rewriteRequireCalls, fileRequires } from "./rewrite";

function parseFile(code: string) {
  return parser.parse(code, { sourceType: "unambiguous" });
}

function rewrite(
  code: string,
  requireFnName: string,
  ids: Record<string, string>,
  shimPath = "./__webpack_runtime.js"
): string {
  const file = parseFile(code);
  rewriteRequireCalls(file, requireFnName, (id) => ids[id], shimPath);
  return generate(file).code;
}

describe("rewriteRequireCalls", () => {
  it("rewrites a literal-id call to a resolved require", () => {
    const out = rewrite(`__webpack_require__(293);`, "__webpack_require__", {
      "293": "./293.js",
    });
    expect(out).toBe('require("./293.js");');
  });

  it("routes an unresolvable literal id through the shim", () => {
    const out = rewrite(`__webpack_require__(999);`, "__webpack_require__", {});
    expect(out).toBe('require("./__webpack_runtime.js")(999);');
  });

  it("routes a computed argument through the shim", () => {
    const out = rewrite(
      `__webpack_require__(webpackContextResolve(req));`,
      "__webpack_require__",
      {}
    );
    expect(out).toBe(
      'require("./__webpack_runtime.js")(webpackContextResolve(req));'
    );
  });

  it("routes a member access through the shim", () => {
    const out = rewrite(`__webpack_require__.n(mod);`, "__webpack_require__", {});
    expect(out).toBe('require("./__webpack_runtime.js").n(mod);');
  });

  it("routes a bare reference passed by value through the shim", () => {
    const out = rewrite(
      `__webpack_require__.t.bind(__webpack_require__, 293, 23);`,
      "__webpack_require__",
      {}
    );
    expect(out).toBe(
      'require("./__webpack_runtime.js").t.bind(require("./__webpack_runtime.js"), 293, 23);'
    );
  });

  it("does not re-wrap an inserted require() when requireFnName is itself \"require\"", () => {
    // the common case: module params are renamed to module/exports/require
    // before this runs, so the require function's own name literally is
    // "require" - the shim calls this rewrite inserts must not be
    // mistaken for further references to it
    const out = rewrite(`require.n(mod);`, "require", {});
    expect(out).toBe('require("./__webpack_runtime.js").n(mod);');
  });

  it("leaves unrelated calls and identifiers untouched", () => {
    const out = rewrite(
      `const isOdd = require(619); module.exports = isOdd;`,
      "require",
      { "619": "./619.js" }
    );
    expect(out).toBe(
      'const isOdd = require("./619.js");\nmodule.exports = isOdd;'
    );
  });
});

describe("fileRequires", () => {
  it("finds a matching require call", () => {
    const file = parseFile('const x = require("./target.js");');
    expect(fileRequires(file, "./target.js")).toBe(true);
  });

  it("returns false when the path doesn't match", () => {
    const file = parseFile('const x = require("./other.js");');
    expect(fileRequires(file, "./target.js")).toBe(false);
  });

  it("returns false when there's no require call at all", () => {
    const file = parseFile("const x = 1;");
    expect(fileRequires(file, "./target.js")).toBe(false);
  });
});
