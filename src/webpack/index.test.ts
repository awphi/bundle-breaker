import { describe, expect, it } from "vitest";
import generate from "@babel/generator";
import { parse } from "../index";
import { split } from "./index";

const runtime = `
  (function(modules) {
    function r(id) { return modules[id](); }
    r(r.s = 0);
  })({ 0: function(module) { module.exports = 42; } });
`;

function chunk(id: number, entryId = 0): string {
  return `self.chunks.push([[1], { ${id}: function() {} }, [[${entryId}]]]);`;
}

describe("webpack split", () => {
  it("merges chunks with the same entry without changing the source ASTs", () => {
    const input = parse({ "runtime.js": runtime, "chunk.js": chunk(1) });
    const sourceCode = () => {
      const code: string[] = [];
      for (const file of input.files.values()) {
        code.push(generate(file.ast).code);
      }
      return code;
    };
    const before = sourceCode();

    const output = split(input);

    expect([...output.files.keys()]).toEqual(["index.js", "modules/1.js"]);
    expect(sourceCode()).toEqual(before);
    expect(split(input)).toEqual(output);
  });

  it("rejects duplicate module ids", () => {
    expect(() => split(parse({ "runtime.js": runtime, "chunk.js": chunk(0) })))
      .toThrow("Encountered module ID clash '0'");
  });

  it("rejects conflicting entry ids", () => {
    expect(() => split(parse({ "runtime.js": runtime, "chunk.js": chunk(1, 1) })))
      .toThrow("Found multiple candidate entry ids: '0' and '1'");
  });

  it("rejects an entry id missing from the module map", () => {
    expect(() => split(parse({ "runtime.js": runtime.replace("r.s = 0", "r.s = 2") })))
      .toThrow("Detected entry id '2' but no module with that id was found");
  });
});
