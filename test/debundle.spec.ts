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
      const mockChunkId = "mock-chunk.test.js";
      // naughty insertion of a mock chunk that we know will be deobfuscated to check that the AST is properly modified
      (deb as any).chunks.set(mockChunkId, {
        ast: structuredClone(mockChunk),
        name: mockChunkId,
        bytes: 0,
        type: "chunk",
      });
      deb.deobfuscate();
      expect(deb.getChunk(mockChunkId).ast).not.toMatchObject(mockChunk);
    });

    test("can be graphed", () => {
      const graph = deb.graph();
      expect(graph.order).toBeGreaterThan(0);
      expect(graph.size).toBeGreaterThan(0);
    });

    test("respects passed file extension", () => {
      deb = debundle(files, "cjs");
      for (const file of deb.allModulesAllChunks()) {
        expect(file.name.endsWith(".cjs")).toBe(true);
      }
    });
  });
});
