import { createHash } from "crypto";
import type { FileNode } from "./types";
import * as parser from "@babel/parser";

export function parseFile(filePath: string, code: string): FileNode {
  const id = createHash("sha1").update(filePath).digest("hex");
  return {
    id,
    path: filePath,
    ast: parser.parse(code),
  };
}
