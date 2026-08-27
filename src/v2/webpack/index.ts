import path from "path";
import { cloneFileNode, type AnyFunctionExpression } from "../ast";
import type { Bundle, FileNode, RawBundle } from "../types";
import { findAdditionalChunkModuleMap, findRuntimeChunk } from "./parse";
import * as t from "@babel/types";
import traverse from "@babel/traverse";
import { replace } from "../visitor";
import type {
  ModuleFileNode,
  WebpackModuleMap,
  WebpackRuntimeChunkInfo,
} from "./types";

const MODULE_MAPPING_CHUNK_NAME = "module_mapping";
const MODULES_DIR = "modules";

export const name = "webpack";

export function detect(bundle: RawBundle): number {
  // TODO
  return 1;
}

function createModule(
  sourcePath: string,
  moduleId: string,
  moduleFn: AnyFunctionExpression
): ModuleFileNode {
  const clonedModuleFn = t.cloneNode(moduleFn, false);
  clonedModuleFn.leadingComments = [];

  const ast = t.file(
    t.program([
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(t.identifier("module"), t.identifier("exports")),
          clonedModuleFn
        )
      ),
    ])
  );
  t.addComment(
    ast,
    "leading",
    `Original module ID: '${moduleId}', source: '${sourcePath}'`
  );

  return {
    ast,
    path: path.join(MODULES_DIR, `${moduleId}${path.extname(sourcePath)}`),
    originalId: moduleId,
  };
}

function createModuleMappingChunk(
  modules: Map<string, ModuleFileNode>
): FileNode {
  // objects and arrays are indexed in the same way so just use an object for simplicity's sake
  const moduleMapObjectExpr = t.objectExpression(
    [...modules.entries()].map(([originalId, { path }]) =>
      t.objectProperty(t.stringLiteral(originalId), t.stringLiteral(path))
    )
  );

  const moduleMappingAst = t.file(
    t.program([
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(t.identifier("module"), t.identifier("exports")),
          moduleMapObjectExpr
        )
      ),
    ])
  );

  return {
    ast: moduleMappingAst,
    path: MODULE_MAPPING_CHUNK_NAME,
  };
}

function createPatchedRuntimeChunk(
  original: WebpackRuntimeChunkInfo,
  moduleMappingChunkName: string
): FileNode {
  const moduleMapMemberExpr = original.requireFn.moduleMapMemberExpr;
  const newRuntime = cloneFileNode(original.chunk);

  // look in module_mapping first to deal with computed IDs and unprocessed require calls
  // if not found then we've probably modified it so we can assume it's a module file on disk
  // this boils down to something like `require(__webpack_modules__[moduleId] || "./modules/" + moduleId)(...)`
  const moduleMapMemberExprWithFallback = t.logicalExpression(
    "||",
    moduleMapMemberExpr,
    moduleMapMemberExpr.property
  );

  const requireIdentifier = t.identifier("require");

  traverse(
    newRuntime.ast,
    replace(
      original.requireFn.moduleMapMemberExpr,
      t.callExpression(requireIdentifier, [moduleMapMemberExprWithFallback])
    )
  );

  traverse(
    newRuntime.ast,
    replace(
      original.moduleMap.expression,
      t.callExpression(requireIdentifier, [
        t.stringLiteral(moduleMappingChunkName),
      ])
    )
  );

  return newRuntime;
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

  const modules = new Map<string, ModuleFileNode>();
  for (const [chunk, { moduleFns }] of moduleMaps.entries()) {
    for (const [moduleId, moduleFn] of Object.entries(moduleFns)) {
      if (modules.has(moduleId)) {
        throw new Error(
          `Encountered module ID clash '${moduleId}' - found in ${
            modules.get(moduleId)!.path
          } and ${chunk.path}.`
        );
      }

      const module = createModule(chunk.path, moduleId, moduleFn);
      modules.set(moduleId, module);
    }
  }

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

  // TODO updateNamesInternal to update require calls with new module names

  return {
    adapter: name,
    entry: newRuntime,
    files: files,
  };
}
