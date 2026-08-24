import { expect, test, describe, beforeEach } from "vitest";
import { debundle, Debundle, WebpackDebundle } from "bundle-breaker";
import fs from "fs";
import path from "path";
import mockChunk from "./mock-chunk.json";

const examplesDir = path.resolve(import.meta.dirname, "..", "examples");
const jsFileExtensions = new Set([".js", ".cjs", ".mjs"]);

function resolveExampleBundle(example: string): string {
  return path.resolve(examplesDir, example, "out");
}

// simple example implementation of how a user may choose to read/filter their bundle files
function readBundle(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const content = fs.readdirSync(dir);
  for (const file of content) {
    if (jsFileExtensions.has(path.extname(file))) {
      result[file] = fs.readFileSync(path.join(dir, file)).toString();
    }
  }
  return result;
}

describe.each(fs.readdirSync(examplesDir))("Debundle %s", (example) => {
  const files = readBundle(resolveExampleBundle(example));

  // checks if correct class was instantiated, the debundle has a valid ID and contains some modules/chunks
  test("is basically valid", () => {
    const deb = debundle(files, "js");
    const id = deb.getId();

    expect(deb).toBeInstanceOf(WebpackDebundle);
    expect([...deb.allModules()].length).toBeGreaterThan(0);
    expect([...deb.allChunks()].length).toBeGreaterThan(0);
    expect(id).toBeTypeOf("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("can be deobfuscated", () => {
    const deb = debundle(files, "js");
    const { ast } = deb.addChunk(
      "mock-chunk",
      structuredClone(mockChunk) as any
    );
    expect(ast).toBeDefined();
    deb.deobfuscate();
    expect(ast).not.toMatchObject(mockChunk);
  });

  test("can be graphed", () => {
    const deb = debundle(files, "js");
    const graph = deb.graph();
    expect(graph.order).toBeGreaterThan(0);
    expect(graph.size).toBeGreaterThan(0);
  });

  test("files can be renamed", () => {
    const deb = debundle(files, "js");
    const originalFileNames = [...deb.allModulesAllChunks()].map((a) => a.name);
    const renames: Record<string, string> = Object.fromEntries(
      originalFileNames.map((a, i) => [a, `newName_${i}`])
    );
    deb.updateNames(renames);
    const newFileNames = [...deb.allModulesAllChunks()].map((a) => a.name);
    console.log(originalFileNames, newFileNames);
    expect(originalFileNames).not.toStrictEqual(newFileNames);
    for (const newName of newFileNames) {
      expect(newName).toMatch(/^((modules\/)?newName_.*)|module_mapping\.js$/);
    }
  });

  test("module and chunk IDs are correctly formatted", () => {
    const deb = debundle(files, "cjs");

    // chunks should all be on the top-level dir
    for (const file of deb.allChunks()) {
      expect(file.name).not.toMatch(/\//);
    }

    // modules should all live in the modules dir with a custom name
    for (const file of deb.allModules()) {
      expect(file.name).toMatch(/^modules.*/);
    }

    // all chunks AND modules should respect the passed extension
    for (const file of deb.allModulesAllChunks()) {
      expect(file.name).toMatch(/^(.*)\.cjs$/);
    }
  });
});

describe("Webpack", () => {
  const webpack4Simple = readBundle(resolveExampleBundle("webpack4_47-simple"));

  test("renaming files modifies ASTs", () => {
    const deb = debundle(webpack4Simple, "js");
    const originalModules = [...deb.allModules()];
    const originalAsts = originalModules.map((a) => structuredClone(a.ast));
    const renames: Record<string, string> = Object.fromEntries(
      originalModules.map((a, i) => [a.name, `newName_${i}`])
    );
    deb.updateNames(renames);
    const newAsts = originalModules.map((a) => structuredClone(a.ast));
    expect(newAsts).not.toStrictEqual(originalAsts);
  });

  test("immutable chunks shouldn't be able to be renamed", () => {
    const deb = debundle(webpack4Simple, "js");
    const chunk = deb.addChunk("name.js", "", true);
    const originalName = chunk.name;
    deb.updateNames({ [originalName]: "newname.js" });
    expect(chunk.name).toBe(originalName);
  });
});
