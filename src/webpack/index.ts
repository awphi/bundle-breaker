import type { AnyFunctionExpression } from "../ast";
import type { AdditionalChunkInfo, ModuleFnMap, RuntimeChunkInfo } from "./types";
import type { Bundle, FileNode, RawBundle } from "../types";
import {
  readAdditionalChunk,
  readRuntimeChunk,
  findRuntimeChunkFile,
} from "./chunks";
import {
  createEntryFileFromTrailingCode,
  createModuleFile,
  createRuntimeShimFile,
  ENTRY_PATH,
  modulePath,
  relativeRequirePath,
  RUNTIME_SHIM_PATH,
} from "./output";
import { fileRequires } from "./rewrite";

export const name = "webpack";

export function detect(bundle: RawBundle): number {
  try {
    findRuntimeChunkFile([...bundle.files.values()]);
    return 1;
  } catch {
    return 0;
  }
}

function mergeModuleMaps(chunks: readonly AdditionalChunkInfo[]): ModuleFnMap {
  const modules = new Map<string, AnyFunctionExpression>();
  for (const chunk of chunks) {
    for (const [id, fn] of chunk.moduleFns) {
      if (modules.has(id)) {
        throw new Error(
          `Encountered module ID clash '${id}' while merging chunk ${chunk.path}`
        );
      }
      modules.set(id, fn);
    }
  }
  return modules;
}

function findEntryModuleId(
  chunks: readonly AdditionalChunkInfo[]
): string | undefined {
  let entryId: string | undefined;
  for (const chunk of chunks) {
    if (chunk.entryId === undefined) {
      continue;
    }
    if (entryId !== undefined && entryId !== chunk.entryId) {
      throw new Error(
        `Found multiple candidate entry ids: '${entryId}' and '${chunk.entryId}'`
      );
    }
    entryId = chunk.entryId;
  }
  return entryId;
}

function createModuleIdResolver(
  idToPath: ReadonlyMap<string, string>,
  fromPath: string
): (id: string) => string | undefined {
  return (id) => {
    const targetPath = idToPath.get(id);
    return targetPath === undefined
      ? undefined
      : relativeRequirePath(fromPath, targetPath);
  };
}

export function split(bundle: RawBundle): Bundle {
  const files = [...bundle.files.values()];
  const runtimeChunkFile = findRuntimeChunkFile(files);
  const runtimeInfo = readRuntimeChunk(runtimeChunkFile);
  const chunks: AdditionalChunkInfo[] = [runtimeInfo];
  for (const file of files) {
    if (file.path === runtimeChunkFile.path) {
      continue;
    }
    const chunk = readAdditionalChunk(file);
    if (chunk) {
      chunks.push(chunk);
    }
  }
  const moduleFns = mergeModuleMaps(chunks);
  const entryModuleId = findEntryModuleId(chunks);

  return {
    adapter: name,
    files: createOutputFiles(runtimeInfo, moduleFns, entryModuleId),
  };
}

function createOutputFiles(
  runtimeInfo: RuntimeChunkInfo,
  moduleFns: ModuleFnMap,
  entryModuleId: string | undefined
): Map<string, FileNode> {
  if (entryModuleId !== undefined && !moduleFns.has(entryModuleId)) {
    throw new Error(
      `Detected entry id '${entryModuleId}' but no module with that id was found`
    );
  }

  if (
    entryModuleId === undefined &&
    runtimeInfo.entryTrailingCode.length === 0
  ) {
    throw new Error(
      `Failed to find an entry point anywhere in the bundle (file: ${runtimeInfo.path})`
    );
  }

  const idToPath = new Map<string, string>();
  for (const id of moduleFns.keys()) {
    idToPath.set(id, id === entryModuleId ? ENTRY_PATH : modulePath(id));
  }

  const outFiles = new Map<string, FileNode>();

  for (const [id, fn] of moduleFns) {
    const filePath = idToPath.get(id)!;
    const file = createModuleFile(
      fn, filePath, createModuleIdResolver(idToPath, filePath)
    );
    outFiles.set(file.path, file);
  }

  if (entryModuleId === undefined) {
    const file = createEntryFileFromTrailingCode(
      runtimeInfo.entryTrailingCode,
      runtimeInfo.requireFnName,
      createModuleIdResolver(idToPath, ENTRY_PATH)
    );
    outFiles.set(file.path, file);
  }

  let shimIsNeeded = false;
  for (const file of outFiles.values()) {
    if (fileRequires(file.ast, relativeRequirePath(file.path, RUNTIME_SHIM_PATH))) {
      shimIsNeeded = true;
      break;
    }
  }

  if (shimIsNeeded) {
    const shimIdToPath = new Map<string, string>();
    for (const [id, targetPath] of idToPath) {
      shimIdToPath.set(id, relativeRequirePath(RUNTIME_SHIM_PATH, targetPath));
    }
    const shimFile = createRuntimeShimFile(
      runtimeInfo.relocatableHelperStatements,
      runtimeInfo.requireFnName,
      shimIdToPath,
      RUNTIME_SHIM_PATH
    );
    outFiles.set(shimFile.path, shimFile);
  }

  return outFiles;
}
