import path from "path";
import * as t from "@babel/types";
import type { AnyFunctionExpression } from "../ast";
import type { ModuleFileNode, WebpackModuleMap } from "./types";
import type { FileNode } from "../types";

const MODULES_DIR = "modules";
const MODULE_MAPPING_CHUNK_NAME = "module_mapping.js";

export function createModuleMappingChunk(
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

function updateRequireCallsWithModules(
  ast: t.File,
  moduleMap: Iterable<ModuleFileNode>
): void {
  // TODO implement this function to update require calls in the AST based on the provided module map
  // This will involve traversing the AST and replacing require calls with the corresponding paths from the module map
  // basically a mirror of updateNamesInternal
}

export function createModulesFromModuleMaps(
  moduleMaps: Map<FileNode, WebpackModuleMap>
): Map<string, ModuleFileNode> {
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

  for (const module of modules.values()) {
    updateRequireCallsWithModules(module.ast, modules.values());
  }

  return modules;
}
