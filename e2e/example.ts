import fs from "fs/promises";
import path from "path";

export const EXAMPLES_DIR: string = path.resolve(
  import.meta.dirname,
  "examples"
);
export const ALL_EXAMPLES: string[] = (await fs.readdir(EXAMPLES_DIR)).map(
  exampleDir
);

export function exampleDir(example: string): string {
  return path.resolve(EXAMPLES_DIR, example, "out");
}

export function exampleName(outDir: string): string {
  return path.basename(path.dirname(outDir));
}
