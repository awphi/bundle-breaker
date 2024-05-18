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

/**
 * Format bytes as human-readable text.
 * https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 */
export function formatBytes(bytes: number, si = false, dp = 1): string {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return bytes.toFixed(dp) + " " + units[u];
}

export function formatTime(from: number): string {
  // TODO could support other units here
  return (performance.now() - from).toFixed(0) + "ms";
}
