import type { AnyFunctionExpression } from "../ast";
import type { Bundle, FileNode, RawBundle } from "../types";
import { readAdditionalChunk, readRuntimeChunk, findRuntimeChunkFile } from "./chunks";
import {
  createEntryFileFromTrailingCode,
  createModuleFile,
  createRuntimeShimFile,
  ENTRY_PATH,
  modulePath,
  relativeRequirePath,
  RUNTIME_SHIM_PATH,
} from "./output";

export const name = "webpack";

export function detect(bundle: RawBundle): number {
  try {
    findRuntimeChunkFile([...bundle.files.values()]);
    return 1;
  } catch {
    return 0;
  }
}

export function split(bundle: RawBundle): Bundle {
  const files = [...bundle.files.values()];
  const runtimeChunkFile = findRuntimeChunkFile(files);
  const runtimeInfo = readRuntimeChunk(runtimeChunkFile);

  const moduleFns = new Map<string, AnyFunctionExpression>(
    runtimeInfo.moduleMap.moduleFns
  );
  let entryId = runtimeInfo.entryId;

  for (const file of files) {
    if (file.path === runtimeChunkFile.path) continue;

    const additional = readAdditionalChunk(file);
    if (!additional) continue;

    for (const [id, fn] of additional.moduleMap.moduleFns) {
      if (moduleFns.has(id)) {
        throw new Error(
          `Encountered module ID clash '${id}' while merging chunk ${file.path}`
        );
      }
      moduleFns.set(id, fn);
    }

    if (additional.entryId !== undefined) {
      if (entryId !== undefined && entryId !== additional.entryId) {
        throw new Error(
          `Found multiple candidate entry ids: '${entryId}' and '${additional.entryId}'`
        );
      }
      entryId = additional.entryId;
    }
  }

  if (entryId !== undefined && !moduleFns.has(entryId)) {
    throw new Error(
      `Detected entry id '${entryId}' but no module with that id was found`
    );
  }

  const usingTrailingStatements = entryId === undefined;
  if (usingTrailingStatements && runtimeInfo.trailingStatements.length === 0) {
    throw new Error(
      `Failed to find an entry point anywhere in the bundle (file: ${runtimeChunkFile.path})`
    );
  }

  const idToPath = new Map<string, string>();
  for (const id of moduleFns.keys()) {
    idToPath.set(id, id === entryId ? ENTRY_PATH : modulePath(id));
  }

  function makeResolveId(fromPath: string): (id: string) => string | undefined {
    return (id) => {
      const targetPath = idToPath.get(id);
      return targetPath ? relativeRequirePath(fromPath, targetPath) : undefined;
    };
  }

  const outFiles = new Map<string, FileNode>();

  for (const [id, fn] of moduleFns) {
    const filePath = idToPath.get(id)!;
    const file = createModuleFile(fn, filePath, makeResolveId(filePath));
    outFiles.set(file.path, file);
  }

  if (usingTrailingStatements) {
    const file = createEntryFileFromTrailingCode(
      runtimeInfo.trailingStatements,
      runtimeInfo.requireFnName,
      makeResolveId(ENTRY_PATH)
    );
    outFiles.set(file.path, file);
  }

  const shimIdToPath = new Map<string, string>();
  for (const [id, targetPath] of idToPath) {
    shimIdToPath.set(id, relativeRequirePath(RUNTIME_SHIM_PATH, targetPath));
  }
  const shimFile = createRuntimeShimFile(
    runtimeInfo.helperStatements,
    runtimeInfo.requireFnName,
    shimIdToPath,
    RUNTIME_SHIM_PATH
  );
  outFiles.set(shimFile.path, shimFile);

  return { adapter: name, files: outFiles };
}
