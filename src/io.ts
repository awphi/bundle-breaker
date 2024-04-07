import path from "path";
import { Debundle } from "./types";
import { ensureDirectory, modulesDirName } from "./utils";
import fs from "fs/promises";
import generate from "@babel/generator";

export async function saveDebundle(
  outDir: string,
  bundle: Debundle,
  clear: boolean,
  ext: string
): Promise<void> {
  const moduleDir = path.resolve(outDir, modulesDirName);
  const promises: Promise<void>[] = [];
  await ensureDirectory(outDir, clear);
  await ensureDirectory(moduleDir, clear);

  for (const { ast, name } of bundle.chunks.values()) {
    const outputCode = generate(ast).code;
    const outFile = `${name.slice(0, -path.extname(name).length)}.${ext}`;
    promises.push(fs.writeFile(path.join(outDir, outFile), outputCode));
  }

  for (const { ast, name } of bundle.modules.values()) {
    const outputCode = generate(ast).code;
    const outFile = `${name}.${ext}`;
    promises.push(fs.writeFile(path.join(moduleDir, outFile), outputCode));
  }

  // TODO write meta file

  await Promise.all(promises);
}

export async function loadDebundle(metaFile: string): Promise<Debundle> {
  // TODO load from meta file
  throw new Error("Not implemented yet");
}
