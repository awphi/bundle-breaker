import path from "path";
import { Debundle } from "./types";
import {
  createEmptyDebundleFromDir,
  ensureDirectory,
  metaFileName,
  modulesDirName,
} from "./utils";
import fs from "fs/promises";
import generate from "@babel/generator";
import * as parser from "@babel/parser";

export async function saveDebundle(
  outDir: string,
  bundle: Debundle,
  clear: boolean,
  ext: string
): Promise<void> {
  const moduleDir = path.resolve(outDir, modulesDirName);
  const metaFile = path.resolve(outDir, metaFileName);

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

  const metaFileContent = {
    modules: Object.fromEntries(
      [...bundle.modules.entries()].map(([key, value]) => [
        key,
        { name: value.name, src: value.src.name },
      ])
    ),
    extension: ext,
  };

  promises.push(
    fs.writeFile(metaFile, JSON.stringify(metaFileContent, undefined, 2))
  );

  await Promise.all(promises);
}

export async function loadDebundle(inDir: string): Promise<Debundle> {
  const debundle = await createEmptyDebundleFromDir(inDir);

  const metaFile = path.resolve(inDir, metaFileName);
  const metaContent = (await fs.readFile(metaFile)).toString();
  const metadata = JSON.parse(metaContent);
  const moduleExt = metadata.extension;
  const promises: Promise<void>[] = [];

  for (const moduleId of Object.keys(metadata.modules)) {
    const { name, src } = metadata.modules[moduleId];
    if (!debundle.chunks.has(src)) {
      throw new Error(
        `Malformed debundle metadata - module '${name}' references non-existent source chunk.`
      );
    }

    const moduleFile = path.resolve(
      inDir,
      modulesDirName,
      `${name}.${moduleExt}`
    );
    promises.push(
      fs.readFile(moduleFile).then((buf) => {
        const code = buf.toString();
        debundle.modules.set(moduleId, {
          ast: parser.parse(code).program,
          name,
          src: debundle.chunks.get(src),
        });
      })
    );
  }

  await Promise.all(promises);

  return debundle;
}
