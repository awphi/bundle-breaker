import { expect, test, describe, beforeEach } from "vitest";
import { debundle, Debundle, WebpackDebundle } from "bundle-breaker";
import { listExamples, readBundle } from "./helpers";
import path from "path";
import mockChunk from "./mock-chunk.json";

describe.each(["webpack4", "webpack5"])("Debundle %s", (bundler) => {
  const examples = listExamples(bundler).map((a) => path.join(a, "out"));
  describe.each(examples)(`%s`, (dir) => {
    const files = readBundle(dir);
    let deb: Debundle;
    beforeEach(() => {
      deb = debundle(files, "js");
    });

    // checks if correct class was instantiated, the debundle has a valid ID and contains some modules/chunks
    test("is basically valid", () => {
      const id = deb.getId();

      expect(deb).toBeInstanceOf(WebpackDebundle);
      expect([...deb.allModules()].length).toBeGreaterThan(0);
      expect([...deb.allChunks()].length).toBeGreaterThan(0);
      expect(id).toBeTypeOf("string");
      expect(id.length).toBeGreaterThan(0);
    });

    test("can be deobfuscated", () => {
      const { ast } = deb.addChunk(
        "mock-chunk",
        structuredClone(mockChunk) as any
      );
      expect(ast).toBeDefined();
      deb.deobfuscate();
      expect(ast).not.toMatchObject(mockChunk);
    });

    test("can be graphed", () => {
      const graph = deb.graph();
      expect(graph.order).toBeGreaterThan(0);
      expect(graph.size).toBeGreaterThan(0);
    });

    test("module and chunk IDs are correctly formatted", () => {
      deb = debundle(files, "cjs");

      // chunks should all be on the top-level dir
      for (const file of deb.allChunks()) {
        expect(file.name).not.toMatch(/\//);
      }

      // modules should all live in the modules dir with a custom name
      for (const file of deb.allModules()) {
        expect(file.name).toMatch(/^modules.*/);
        expect(file.name).not.toBe(file.originalId);
      }

      // all chunks AND modules should respect the passed extension
      for (const file of deb.allModulesAllChunks()) {
        expect(file.name).toMatch(/^(.*)\.cjs$/);
      }
    });
  });
});
