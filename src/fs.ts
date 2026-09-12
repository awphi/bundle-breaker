import path from "path";

export const JS_EXTENSIONS: Set<string> = new Set([".js", ".cjs", ".mjs"]);

export function isJsFile(pth: string): boolean {
  return JS_EXTENSIONS.has(path.extname(pth));
}
