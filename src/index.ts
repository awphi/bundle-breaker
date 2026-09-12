import type { Bundle, FileNode, RawBundle } from "./types";
import * as webpack from "./webpack";
import { findDebundler, type Debundler } from "./debundler";
import * as parser from "@babel/parser";
import fs from "fs/promises";
import { isJsFile } from "./fs";
import path from "path";
import generate from "@babel/generator";

const DEBUNDLERS: Debundler[] = [webpack];

async function readSourceFile(
  input: string,
  filePath: string
): Promise<[string, string]> {
  const code = await fs.readFile(path.join(input, filePath), "utf-8");
  return [filePath, code];
}

export async function read(input: string): Promise<Record<string, string>> {
  const paths = await fs.readdir(input, { recursive: true });
  const reads: Promise<[string, string]>[] = [];
  for (const filePath of paths) {
    if (isJsFile(filePath)) {
      reads.push(readSourceFile(input, filePath));
    }
  }
  return Object.fromEntries(await Promise.all(reads));
}

async function saveFile(out: string, file: FileNode): Promise<void> {
  const filePath = path.resolve(out, file.path);
  const code = generate(file.ast).code;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, code);
}

export async function save(out: string, bundle: Bundle): Promise<void> {
  const writes: Promise<void>[] = [];
  for (const file of bundle.files.values()) {
    writes.push(saveFile(out, file));
  }
  await Promise.all(writes);
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
