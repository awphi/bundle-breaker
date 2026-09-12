import path from "path";
import fs from "fs/promises";
import type { FileNode } from "./types";
import generate from "@babel/generator";

export const JS_EXTENSIONS: Set<string> = new Set([".js", ".cjs", ".mjs"]);

export function isJsFile(pth: string): boolean {
  return JS_EXTENSIONS.has(path.extname(pth));
}

export async function readSourceFile(
  input: string,
  filePath: string
): Promise<[string, string]> {
  const code = await fs.readFile(path.join(input, filePath), "utf-8");
  return [filePath, code];
}

export async function saveFile(out: string, file: FileNode): Promise<void> {
  const filePath = path.resolve(out, file.path);
  const code = generate(file.ast).code;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, code);
}
