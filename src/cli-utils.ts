import fs from "fs/promises";
import { Debundle } from "./debundle/debundle";
import generate from "@babel/generator";
import gexf from "graphology-gexf";
import path from "path";
import { GRAPH_FILE, MODULES_DIR } from "./utils";

// ensure a directory exists, is a directory, and optionally empty it or create it
export async function ensureDirectory(
  pth: string,
  clear: boolean,
  create: boolean
): Promise<void> {
  let exists = false;
  try {
    const stat = await fs.stat(pth);
    if (!stat.isDirectory()) {
      await fs.rm(pth, { recursive: true });
    } else {
      exists = true;
    }
  } catch (e) {}

  if (!exists && create) {
    await fs.mkdir(pth, { recursive: true });
  }

  if (clear) {
    const contents = await fs.readdir(pth);
    await Promise.all(
      contents.map((name) => fs.rm(path.join(pth, name), { recursive: true }))
    );
  }
}

export async function saveDebundle(
  outDir: string,
  deb: Debundle
): Promise<void> {
  const moduleDir = path.resolve(outDir, MODULES_DIR);

  const promises: Promise<void>[] = [];
  await ensureDirectory(moduleDir, false, true);

  deb.commitAstMods();

  for (const item of deb.allModulesAllChunks()) {
    const { ast, name } = item;
    const outputCode = generate(ast).code;
    promises.push(fs.writeFile(path.join(outDir, name), outputCode));
  }

  if (deb.hasGraph()) {
    const graphStr = gexf.write(deb.graph());
    promises.push(fs.writeFile(path.join(outDir, GRAPH_FILE), graphStr));
  }

  await Promise.all(promises);
}
