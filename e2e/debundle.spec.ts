import { expect, test, describe } from "vitest";
import { load, split } from "bundle-breaker";
import fs from "fs";
import path from "path";

const examplesDir = path.resolve(import.meta.dirname, "..", "examples");
const examples = fs.readdirSync(examplesDir);

describe.each(examples)("Debundle %s", async (example) => {
  const inputFiles = await load(path.join(examplesDir, example, "out"));

  test(`${example} can be debundled`, () => {
    const bundle = split(inputFiles);

    expect(bundle.adapter).toMatch(/.+/);
    expect(bundle.files.size).toBeGreaterThan(0);
    const files = [...bundle.files.keys()];
    expect(files).toContain("index.js");
    expect(files).toEqual(
      expect.arrayContaining([expect.stringMatching(/modules\/.+\.js/)])
    );
  });
});
