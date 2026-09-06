import * as t from "@babel/types";
import { isNormalMemberExpression } from "../ast";
import type { FileNode } from "../types";
import type { AdditionalChunkInfo } from "./types";
import { tryMakeModuleMap } from "./module-map";
import { findShapeDEntryId } from "./entry";

/**
 * Collects every expression in `program` that *could* be the chunk's module
 * map, across all three known chunk shapes:
 *  - jsonp: `(jsonpArray).push([chunkIds, modules, executeModules?])`
 *  - commonjs (`chunkFormat: "commonjs"`): `exports.<name> = <value>;`
 *  - module (`chunkFormat: "module"`): `export const <name> = <value>;`
 * Candidates are matched by shape only - which property/declaration actually
 * holds the module map is decided later, by content (`tryMakeModuleMap`), not
 * by name.
 */
function getModuleMapCandidates(program: t.Program): t.Expression[] {
  const candidates: t.Expression[] = [];

  for (const stmt of program.body) {
    if (t.isExpressionStatement(stmt)) {
      const expr = stmt.expression;

      if (
        t.isAssignmentExpression(expr) &&
        expr.operator === "=" &&
        isNormalMemberExpression(expr.left)
      ) {
        candidates.push(expr.right);
      }

      if (
        t.isCallExpression(expr) &&
        isNormalMemberExpression(expr.callee) &&
        t.isIdentifier(expr.callee.property, { name: "push" }) &&
        expr.arguments.length === 1 &&
        t.isArrayExpression(expr.arguments[0])
      ) {
        for (const el of expr.arguments[0].elements) {
          if (el && t.isExpression(el)) candidates.push(el);
        }
      }
    }

    if (t.isExportNamedDeclaration(stmt) && t.isVariableDeclaration(stmt.declaration)) {
      for (const decl of stmt.declaration.declarations) {
        if (decl.init) candidates.push(decl.init);
      }
    }
  }

  return candidates;
}

export function extractAdditionalChunk(
  chunk: FileNode
): AdditionalChunkInfo | undefined {
  const candidates = getModuleMapCandidates(chunk.ast.program);

  let moduleMap: AdditionalChunkInfo["moduleMap"] | undefined;
  for (const candidate of candidates) {
    const map = tryMakeModuleMap(candidate);
    if (!map) continue;
    if (moduleMap) {
      throw new Error(
        `Found multiple candidate module maps in chunk ${chunk.path}`
      );
    }
    moduleMap = map;
  }

  if (!moduleMap) return undefined;

  return {
    path: chunk.path,
    moduleMap,
    entryId: findShapeDEntryId(chunk.ast.program),
  };
}
