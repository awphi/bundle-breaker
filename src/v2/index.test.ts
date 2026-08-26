import { describe, expect, it } from "vitest";
import { parseBundle } from ".";

describe("parseBundle", () => {
  it("should parse a bundle of files correctly", () => {
    const inputFiles = {
      "file1.js": "console.log('File 1');",
      "file2.cjs": "module.exports = {};",
    };

    const result = parseBundle(inputFiles);

    expect(Array.from(result.files.values())).toMatchObject([
      { path: "file1.js" },
      { path: "file2.cjs" },
    ]);
  });

  it("should ignore files with unsupported extensions", () => {
    const inputFiles = {
      "file1.mjs": "console.log('File 1');",
      "file2.txt": "This is a text file.",
      "file3.cjs": "module.exports = {};",
    };

    const result = parseBundle(inputFiles);

    expect(Array.from(result.files.values())).toMatchObject([
      { path: "file1.mjs" },
      { path: "file3.cjs" },
    ]);
  });

  it("should handle empty input gracefully", () => {
    const result = parseBundle({});

    expect(result.files.size).toBe(0);
  });
});
