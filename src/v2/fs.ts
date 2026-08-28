import type { Stats } from "fs";
import fs from "fs/promises";
import path from "path";

export const JS_EXTENSIONS: Set<string> = new Set([".js", ".cjs", ".mjs"]);

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export async function ensureDirectory(pth: string): Promise<void> {
  let stats: Stats;
  try {
    stats = await fs.stat(pth);
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") {
      await fs.mkdir(pth, { recursive: true });
      return;
    }

    throw e;
  }

  if (!stats.isDirectory()) {
    throw new Error(`${pth} is not a directory`);
  }
}

export function isJsFile(pth: string): boolean {
  return JS_EXTENSIONS.has(path.extname(pth));
}
