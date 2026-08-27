import { cloneFileNode } from "../ast";
import type { Bundle, FileNode, RawBundle } from "../types";
import { findAdditionalChunkModuleMap } from "./additional-chunks";
import * as t from "@babel/types";
import traverse from "@babel/traverse";
import { replace } from "../visitor";
import type { ModuleFileNode, WebpackModuleMap } from "./types";
import { createPatchedRuntimeChunk, findRuntimeChunk } from "./runtime-chunk";
import {
  createModuleMappingChunk,
  createModulesFromModuleMaps,
} from "./module";

export const name = "webpack";

export function detect(bundle: RawBundle): number {
  // TODO
  return 1;
}

export function split(bundle: RawBundle): Bundle {
  const originalRuntime = findRuntimeChunk(bundle.files.values());

  const moduleMaps = new Map<FileNode, WebpackModuleMap>();
  for (const files of bundle.files.values()) {
    const isRuntimeChunk = files === originalRuntime.chunk;
    const moduleMap = isRuntimeChunk
      ? originalRuntime.moduleMap
      : findAdditionalChunkModuleMap(files);
    moduleMaps.set(files, moduleMap);
  }

  const modules = createModulesFromModuleMaps(moduleMaps);
  const files = new Map<string, FileNode>([...modules.entries()]);

  const moduleMappingChunk = createModuleMappingChunk(modules);
  files.set(moduleMappingChunk.path, moduleMappingChunk);

  for (const [chunk, { expression }] of moduleMaps.entries()) {
    if (chunk === originalRuntime.chunk) {
      continue;
    }

    const newModuleMapExpr = t.isArrayExpression(expression)
      ? t.arrayExpression([])
      : t.objectExpression([]);

    const newChunk = cloneFileNode(chunk);
    traverse(newChunk.ast, replace(expression, newModuleMapExpr));
    files.set(newChunk.path, newChunk);
  }

  const newRuntime = createPatchedRuntimeChunk(
    originalRuntime,
    moduleMappingChunk.path
  );
  files.set(newRuntime.path, newRuntime);

  return {
    adapter: name,
    entry: newRuntime,
    files: files,
  };
}
