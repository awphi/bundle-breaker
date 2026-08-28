import type { Bundle, FileNode, RawBundle } from "../types";
import { createStrippedAdditionalChunk } from "./additional-chunks";
import type { WebpackModuleMap } from "./types";
import { createPatchedRuntimeChunk } from "./runtime-chunk";
import { createModuleFilesFromMaps, updateRequireCalls } from "./module";

export const name = "webpack";
const MODULE_MAPPING_CHUNK_NAME = "module_mapping.js";

export function detect(bundle: RawBundle): number {
  // TODO
  return 1;
}

export function rename(
  bundle: Bundle,
  renames: ReadonlyMap<string, string>
): Bundle {
  const files = new Map(bundle.files.entries());
  const oldToNew = new Map<string, string>();
  const seenNewNames = new Set<string>();

  for (const [id, file] of files.entries()) {
    const newName = renames.get(id);
    if (!newName) {
      continue;
    }
    if (seenNewNames.has(newName)) {
      throw new Error(
        `Duplicate new name: ${newName}. New file names must be unique.`
      );
    }
    seenNewNames.add(newName);
    files.set(id, { ...file, path: newName });
    oldToNew.set(file.path, newName);
  }

  for (const file of files.values()) {
    updateRequireCalls(file.ast, oldToNew);
  }

  return { ...bundle, files };
}

export function split(bundle: RawBundle): Bundle {
  const runtime = createPatchedRuntimeChunk(
    bundle.files.values(),
    MODULE_MAPPING_CHUNK_NAME
  );

  const moduleMaps = new Map<string, WebpackModuleMap>();
  moduleMaps.set(runtime.chunk.path, runtime.moduleMap);

  const files = new Map<string, FileNode>();
  files.set(runtime.chunk.path, runtime.chunk);

  for (const [path, chunk] of bundle.files) {
    if (path === runtime.chunk.path) {
      continue;
    }

    const stripped = createStrippedAdditionalChunk(chunk);
    moduleMaps.set(path, stripped.moduleMap);
    files.set(stripped.chunk.path, stripped.chunk);
  }

  const moduleFiles = createModuleFilesFromMaps(
    moduleMaps,
    MODULE_MAPPING_CHUNK_NAME
  );
  for (const [path, file] of moduleFiles) {
    files.set(path, file);
  }

  return {
    adapter: name,
    files,
  };
}
