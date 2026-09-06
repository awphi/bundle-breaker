import { expect, test, describe, beforeAll } from "vitest";
import { load, split, save } from "../src";
import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ALL_EXAMPLES, buildAllExamples, exampleName } from "./example";

const HAPPY_DOM_ENV = path.resolve(import.meta.dirname, "happy-dom-env.mjs");
const DOM_SUFFIX = "-dom";

async function tmpOutDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "bundle-breaker-e2e-"));
}

beforeAll(() => buildAllExamples());

const EXAMPLES = ALL_EXAMPLES.map((outDir) => ({
  name: exampleName(outDir),
  outDir,
}));

describe.each(EXAMPLES)("Debundle $name", async ({ name, outDir }) => {
  const inputFiles = await load(outDir);
  const bundle = split(inputFiles);

  test(`${name} can be split`, () => {
    expect(bundle.adapter).toMatch(/.+/);
    expect(bundle.files.size).toBeGreaterThan(0);
    const files = [...bundle.files.keys()];
    expect(files).toContain("index.js");
    expect(files).toEqual(
      expect.arrayContaining([expect.stringMatching(/modules\/.+\.js/)])
    );
  });

  test(`${name} split output is executable`, async () => {
    const dir = await tmpOutDir();
    await save(dir, bundle);
    const entry = path.join(dir, "index.js");

    const nodeArgs = name.endsWith(DOM_SUFFIX)
      ? ["--import", HAPPY_DOM_ENV, entry]
      : [entry];
    expect(() => {
      const stdout = execFileSync("node", nodeArgs, { encoding: "utf-8" });
      expect(stdout.toLowerCase()).not.toContain("error"); // purposefully broad
    }).not.toThrow();
  });
});
