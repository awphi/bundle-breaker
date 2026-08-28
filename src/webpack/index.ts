import type { Bundle, FileNode, RawBundle } from "../types";
import {
  createStrippedAdditionalChunk,
  findAdditionalChunkModuleMap,
} from "./additional-chunks";
import type { WebpackModuleMap } from "./types";
import { createPatchedRuntimeChunk, findRuntimeChunk } from "./runtime-chunk";
import { createModuleFilesFromMaps, updateRequireCalls } from "./module";

export const name = "webpack";

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
  const originalRuntime = findRuntimeChunk(bundle.files.values());

  const moduleMaps = new Map<FileNode, WebpackModuleMap>();
  for (const files of bundle.files.values()) {
    const isRuntimeChunk = files === originalRuntime.chunk;
    const moduleMap = isRuntimeChunk
      ? originalRuntime.moduleMap
      : findAdditionalChunkModuleMap(files);
    moduleMaps.set(files, moduleMap);
  }

  const { files, mapping } = createModuleFilesFromMaps(moduleMaps);

  for (const [chunk, moduleMap] of moduleMaps.entries()) {
    if (chunk === originalRuntime.chunk) {
      continue;
    }

    const newChunk = createStrippedAdditionalChunk(chunk, moduleMap);
    files.set(newChunk.path, newChunk);
  }

  const newRuntime = createPatchedRuntimeChunk(originalRuntime, mapping.path);
  files.set(newRuntime.path, newRuntime);

  return {
    adapter: name,
    files,
  };
}
