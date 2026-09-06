import type { Bundle, FileNode, RawBundle } from "./types";
import * as webpack from "./webpack";
import { findDebundler, type Debundler } from "./debundler";
import * as parser from "@babel/parser";
import fs from "fs/promises";
import { ensureDirectory, isJsFile } from "./fs";
import path from "path";
import generate from "@babel/generator";

const DEBUNDLERS: Debundler[] = [webpack];

export async function read(input: string): Promise<Record<string, string>> {
  const paths = await fs.readdir(input, { recursive: true });

  const files: Record<string, string> = {};
  await Promise.all(
    paths.filter(isJsFile).map(async (pth) => {
      const content = await fs.readFile(path.join(input, pth), {
        encoding: "utf-8",
      });
      files[pth] = content;
    })
  );

  return files;
}

export async function save(out: string, bundle: Bundle): Promise<void> {
  await Promise.all(
    [...bundle.files.values()].map(async (file) => {
      const pth = path.resolve(out, file.path);
      const code = generate(file.ast).code;
      await ensureDirectory(path.dirname(pth));
      await fs.writeFile(pth, code);
    })
  );
}

export function parse(inputFiles: Record<string, string>): RawBundle {
  const files = new Map<string, FileNode>();
  for (const [filePath, code] of Object.entries(inputFiles)) {
    if (!isJsFile(filePath)) {
      continue;
    }
    files.set(filePath, {
      path: filePath,
      ast: parser.parse(code, {
        sourceType: "unambiguous",
      }),
    });
  }
  return { files };
}

export async function load(input: string): Promise<RawBundle> {
  return parse(await read(input));
}

export function split(bundle: RawBundle): Bundle {
  return findDebundler(bundle, DEBUNDLERS).split(bundle);
}

export * from "./types";
