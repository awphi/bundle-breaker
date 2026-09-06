import { describe, expect, it } from "vitest";
import { parse, read, save } from ".";
import fs from "fs/promises";
import os from "os";
import path from "path";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "bundle-breaker-"));
}

describe("parse", () => {
  it("should parse a bundle of files correctly", () => {
    const inputFiles = {
      "file1.js": "console.log('File 1');",
      "file2.cjs": "module.exports = {};",
    };

    const result = parse(inputFiles);

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

    const result = parse(inputFiles);

    expect(Array.from(result.files.values())).toMatchObject([
      { path: "file1.mjs" },
      { path: "file3.cjs" },
    ]);
  });

  it("should handle empty input gracefully", () => {
    const result = parse({});

    expect(result.files.size).toBe(0);
  });

  it("should throw on syntax errors in the input files", () => {
    const inputFiles = {
      "file1.js": "console.log('File 1');",
      "file2.cjs": "module.exports = {", // Syntax error: missing closing brace
    };

    expect(() => parse(inputFiles)).toThrow();
  });
});

describe("read", () => {
  it("reads JS files from a directory into a path->content map", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "a.js"), "console.log('a');");
    await fs.writeFile(path.join(dir, "b.txt"), "not js");

    const result = await read(dir);

    expect(result).toEqual({ "a.js": "console.log('a');" });
  });

  it("reads JS files nested in subdirectories, keyed by relative path", async () => {
    const dir = await tmpDir();
    await fs.mkdir(path.join(dir, "nested"));
    await fs.writeFile(
      path.join(dir, "nested", "c.cjs"),
      "module.exports = 1;"
    );

    const result = await read(dir);

    expect(result).toEqual({
      [path.join("nested", "c.cjs")]: "module.exports = 1;",
    });
  });
});

describe("save", () => {
  it("writes each file's generated code to its path under the output directory", async () => {
    const dir = await tmpDir();
    const { files } = parse({ "a.js": "const x = 1;" });

    await save(dir, { adapter: "test", files });

    const written = await fs.readFile(path.join(dir, "a.js"), "utf-8");
    expect(written).toContain("const x = 1;");
  });

  it("creates nested output directories that don't yet exist", async () => {
    const dir = await tmpDir();
    const { files } = parse({ "nested/b.js": "const y = 2;" });

    await save(dir, { adapter: "test", files });

    const written = await fs.readFile(
      path.join(dir, "nested", "b.js"),
      "utf-8"
    );
    expect(written).toContain("const y = 2;");
  });
});
