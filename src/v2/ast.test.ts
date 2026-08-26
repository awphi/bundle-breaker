import { describe, it, expect } from "vitest";
import { parseFile } from "./ast";

describe("parseFile", () => {
  it("should parse a JavaScript file correctly", () => {
    const file = "example.js";
    const code = "console.log('Hello, world!');";

    const result = parseFile(file, code);

    expect(result).toMatchObject({
      id: expect.any(String),
      path: file,
      ast: expect.any(Object),
    });
  });

  it("should throw on syntax errors", () => {
    const file = "invalid.js";
    const code = "console.log('Hello, world!';"; // Missing closing parenthesis

    expect(() => parseFile(file, code)).toThrow();
  });
});
