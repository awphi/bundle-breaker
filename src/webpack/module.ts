import path from "path";
import * as t from "@babel/types";
import type { AnyFunctionExpression } from "../ast";
import type { WebpackModuleMap } from "./types";
import type { FileNode } from "../types";

const MODULES_DIR = "modules";
const MODULE_MAPPING_CHUNK_NAME = "module_mapping.js";

export function createModuleMappingChunk(
  oldToNew: Map<string, string>
): FileNode {
  // objects and arrays are indexed in the same way so just use an object for simplicity's sake
  const moduleMapObjectExpr = t.objectExpression(
    [...oldToNew.entries()].map(([originalId, newPath]) =>
      t.objectProperty(t.stringLiteral(originalId), t.stringLiteral(newPath))
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

function createFileForModule(
  sourcePath: string,
  moduleId: string,
  moduleFn: AnyFunctionExpression
): FileNode {
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
  };
}

export function updateRequireCalls(
  ast: t.File,
  oldToNew: Map<string, string>
): void {
  // TODO implement this function to update require calls in the AST based on the provided module map
  // This will involve traversing the AST and replacing require calls with the corresponding paths from the module map
  // basically a mirror of updateNamesInternal
}

export function createModuleFilesFromMaps(
  moduleMaps: Map<FileNode, WebpackModuleMap>
): { files: Map<string, FileNode>; mapping: FileNode } {
  const files = new Map<string, FileNode>();
  const oldToNew = new Map<string, string>();

  for (const [chunk, { moduleFns }] of moduleMaps.entries()) {
    for (const [moduleId, moduleFn] of moduleFns.entries()) {
      if (oldToNew.has(moduleId)) {
        throw new Error(
          `Encountered module ID clash '${moduleId}' - found in ${oldToNew.get(
            moduleId
          )} and ${chunk.path}.`
        );
      }

      const module = createFileForModule(chunk.path, moduleId, moduleFn);
      files.set(module.path, module);
      oldToNew.set(moduleId, module.path);
    }
  }

  for (const module of files.values()) {
    updateRequireCalls(module.ast, oldToNew);
  }

  const mapping = createModuleMappingChunk(oldToNew);
  files.set(mapping.path, mapping);

  return { files, mapping };
}
