import traverse from "@babel/traverse";
import * as t from "@babel/types";
import {
  getIifeCallExpression,
  isIdentifiedFunctionDeclaration,
  isNormalMemberExpression,
  maybeUnwrapTopLevelIife,
  type IdentifiedFunctionDeclaration,
} from "../ast";
import type { FileNode } from "../types";
import type {
  AdditionalChunkInfo,
  RuntimeChunkInfo,
  ModuleFnMap,
} from "./types";
import {
  getJsonpPushedArray,
  makeModuleMap,
  tryMakeModuleMap,
} from "./module-map";
import {
  findEntryIdInAdditionalChunk,
  findEntryIdInRuntimeChunk,
  findEntryTrailingCode,
} from "./entry";
import { findRelocatableHelperStatements } from "./helpers";

function isComputedMemberCall(callee: t.Node): boolean {
  return t.isMemberExpression(callee, { computed: true });
}

function isDotCallOnComputedMember(callee: t.Node): boolean {
  return (
    isNormalMemberExpression(callee) &&
    t.isIdentifier(callee.property, { name: "call" }) &&
    t.isMemberExpression(callee.object, { computed: true })
  );
}

function containsModuleExecutionCall(
  fn: IdentifiedFunctionDeclaration
): boolean {
  let found = false;

  traverse.cheap(fn, (node) => {
    if (found || !t.isCallExpression(node)) return;
    found =
      isComputedMemberCall(node.callee) ||
      isDotCallOnComputedMember(node.callee);
  });

  return found;
}

function findLastFunctionDeclaration(
  body: readonly t.Statement[]
): IdentifiedFunctionDeclaration | undefined {
  const decs = body.filter(isIdentifiedFunctionDeclaration);
  return decs.at(-1);
}

function findRequireFunction({
  ast,
  path,
}: FileNode): IdentifiedFunctionDeclaration {
  const body = maybeUnwrapTopLevelIife(ast.program);
  const candidate = findLastFunctionDeclaration(body);
  if (!candidate || !containsModuleExecutionCall(candidate)) {
    throw new Error(`Unable to find webpack require function in file ${path}`);
  }
  return candidate;
}

function findModuleMapFromIifeArgument(
  program: t.Program
): ModuleFnMap | undefined {
  const iife = getIifeCallExpression(program.body[0]);
  if (program.body.length === 1 && iife && iife.arguments.length === 1) {
    return makeModuleMap(iife.arguments[0]);
  }
  return undefined;
}

function findModuleMapFromVariableDeclaration(
  body: readonly t.Statement[]
): ModuleFnMap | undefined {
  const firstVariableDec = body.find((v) => t.isVariableDeclaration(v));
  for (const declarator of firstVariableDec?.declarations ?? []) {
    if (t.isObjectExpression(declarator.init)) {
      return makeModuleMap(declarator.init);
    }
  }
  return undefined;
}

function findModuleMapInRuntimeChunk({ ast, path }: FileNode): ModuleFnMap {
  const moduleMap =
    findModuleMapFromIifeArgument(ast.program) ??
    findModuleMapFromVariableDeclaration(maybeUnwrapTopLevelIife(ast.program));
  if (!moduleMap) {
    throw new Error(`Failed to locate module map in file ${path}`);
  }
  return moduleMap;
}

function isRuntimeChunk(file: FileNode): boolean {
  try {
    findRequireFunction(file);
    findModuleMapInRuntimeChunk(file);
    return true;
  } catch {
    return false;
  }
}

export function findRuntimeChunkFile(files: readonly FileNode[]): FileNode {
  const file = files.find(isRuntimeChunk);
  if (!file) {
    const names = files.map((f) => f.path).join(", ");
    throw new Error(`Failed to find runtime file in files: ${names}`);
  }
  return file;
}

export function readRuntimeChunk(file: FileNode): RuntimeChunkInfo {
  const requireFn = findRequireFunction(file);
  const moduleFns = findModuleMapInRuntimeChunk(file);
  const topLevelBody = maybeUnwrapTopLevelIife(file.ast.program);

  return {
    path: file.path,
    requireFnName: requireFn.id.name,
    moduleFns,
    relocatableHelperStatements: findRelocatableHelperStatements(
      file.ast,
      requireFn,
      topLevelBody
    ),
    entryId: findEntryIdInRuntimeChunk(file.ast, requireFn),
    entryTrailingCode: findEntryTrailingCode(file.ast, requireFn, topLevelBody),
  };
}

function findModuleMapCandidates(program: t.Program): t.Expression[] {
  const candidates: t.Expression[] = [];

  for (const stmt of program.body) {
    if (
      t.isExpressionStatement(stmt) &&
      t.isAssignmentExpression(stmt.expression) &&
      stmt.expression.operator === "=" &&
      isNormalMemberExpression(stmt.expression.left)
    ) {
      candidates.push(stmt.expression.right);
    }

    const pushed = getJsonpPushedArray(stmt);
    for (const el of pushed?.elements ?? []) {
      if (el && t.isExpression(el)) candidates.push(el);
    }

    if (
      t.isExportNamedDeclaration(stmt) &&
      t.isVariableDeclaration(stmt.declaration)
    ) {
      for (const decl of stmt.declaration.declarations) {
        if (decl.init) candidates.push(decl.init);
      }
    }
  }

  return candidates;
}

export function readAdditionalChunk(
  chunk: FileNode
): AdditionalChunkInfo | undefined {
  const candidates = findModuleMapCandidates(chunk.ast.program);

  let moduleFns: ModuleFnMap | undefined;
  for (const candidate of candidates) {
    const map = tryMakeModuleMap(candidate);
    if (!map) continue;
    if (moduleFns) {
      throw new Error(
        `Found multiple candidate module maps in chunk ${chunk.path}`
      );
    }
    moduleFns = map;
  }

  if (!moduleFns) return undefined;

  return {
    path: chunk.path,
    moduleFns,
    entryId: findEntryIdInAdditionalChunk(chunk.ast.program),
  };
}
