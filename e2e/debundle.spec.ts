import { expect, test, describe, beforeAll } from "vitest";
import { load, split, save } from "../src";
import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ALL_EXAMPLES, buildAllExamples } from "./example";

const HAPPY_DOM_ENV = path.resolve(import.meta.dirname, "happy-dom-env.mjs");
const DOM_SUFFIX = "-dom";

async function tmpOutDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "bundle-breaker-e2e-"));
}

beforeAll(() => buildAllExamples());

describe.each(ALL_EXAMPLES)("Debundle %s", async (example) => {
  const inputFiles = await load(example);
  const bundle = split(inputFiles);

  test(`${example} can be split`, () => {
    expect(bundle.adapter).toMatch(/.+/);
    expect(bundle.files.size).toBeGreaterThan(0);
    const files = [...bundle.files.keys()];
    expect(files).toContain("index.js");
    expect(files).toEqual(
      expect.arrayContaining([expect.stringMatching(/modules\/.+\.js/)])
    );
  });

  test(`${example} split output is executable`, async () => {
    const outDir = await tmpOutDir();
    await save(outDir, bundle);
    const entry = path.join(outDir, "index.js");

    const nodeArgs = example.endsWith(DOM_SUFFIX)
      ? ["--import", HAPPY_DOM_ENV, entry]
      : [entry];
    expect(() => {
      const stdout = execFileSync("node", nodeArgs, { encoding: "utf-8" });
      expect(stdout.toLowerCase()).not.toContain("error"); // purposefully broad
    }).not.toThrow();
  });
});
