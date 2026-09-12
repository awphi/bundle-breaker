import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
  findEnclosingStatementAmong,
  isNormalMemberExpression,
  isSameBinding,
  literalId,
  type IdentifiedFunctionDeclaration,
} from "../ast";
import { getJsonpPushedArray } from "./module-map";

function extractRequireCallId(
  callPath: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  if (!callPath.isCallExpression() || callPath.node.arguments.length !== 1) {
    return undefined;
  }
  const calleePath = callPath.get("callee") as NodePath;
  if (!calleePath.isIdentifier() || !isSameBinding(calleePath, requireFn)) {
    return undefined;
  }
  return literalId(callPath.node.arguments[0]);
}

function isMemberChainRootedAtRequireFn(
  path: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): boolean {
  let current = path;
  while (current.isMemberExpression()) {
    current = current.get("object") as NodePath;
  }
  return current.isIdentifier() && isSameBinding(current, requireFn);
}

function findEntryCallWithSelfAssignedArg(
  chunkAst: t.File,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  let found: string | undefined;

  traverse(chunkAst, {
    CallExpression(path) {
      if (found) {
        return;
      }

      const calleePath = path.get("callee") as NodePath;
      if (!calleePath.isIdentifier() || !isSameBinding(calleePath, requireFn)) {
        return;
      }
      if (path.node.arguments.length !== 1) {
        return;
      }

      const arg = path.node.arguments[0];
      if (!t.isAssignmentExpression(arg) || !isNormalMemberExpression(arg.left)) {
        return;
      }

      const argPath = path.get("arguments.0") as NodePath;
      const objPath = argPath.get("left.object") as NodePath;
      if (objPath.isIdentifier() && isSameBinding(objPath, requireFn)) {
        found = literalId(arg.right);
      }
    },
  });

  return found;
}

function findReturnedRequireId(
  callback: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  if (!callback.isFunction() || callback.node.params.length !== 0) {
    return undefined;
  }
  const body = callback.get("body") as NodePath;
  if (body.isCallExpression()) {
    return extractRequireCallId(body, requireFn);
  }
  if (!body.isBlockStatement()) {
    return undefined;
  }

  for (const statement of body.get("body")) {
    if (!statement.isReturnStatement()) {
      continue;
    }
    const argument = statement.get("argument");
    if (!argument.node) {
      continue;
    }
    const id = extractRequireCallId(argument as NodePath, requireFn);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

function findEntryCallInDeferredCallback(
  chunkAst: t.File,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  let found: string | undefined;

  traverse(chunkAst, {
    CallExpression(path) {
      if (found) {
        return;
      }

      const calleePath = path.get("callee") as NodePath;
      if (!calleePath.isMemberExpression()) {
        return;
      }
      if (!isMemberChainRootedAtRequireFn(calleePath, requireFn)) {
        return;
      }

      for (const argument of path.get("arguments")) {
        found = findReturnedRequireId(argument, requireFn);
        if (found !== undefined) {
          path.stop();
          return;
        }
      }
    },
  });

  return found;
}

export function findEntryIdInRuntimeChunk(
  chunkAst: t.File,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  return (
    findEntryCallWithSelfAssignedArg(chunkAst, requireFn) ??
    findEntryCallInDeferredCallback(chunkAst, requireFn)
  );
}

export function findEntryIdInAdditionalChunk(
  program: t.Program
): string | undefined {
  for (const stmt of program.body) {
    const pushed = getJsonpPushedArray(stmt);
    if (!pushed) {
      continue;
    }

    const deferredTable = pushed.elements[2];
    if (!deferredTable || !t.isArrayExpression(deferredTable)) {
      continue;
    }

    const firstEntry = deferredTable.elements[0];
    if (!firstEntry || !t.isArrayExpression(firstEntry)) {
      continue;
    }

    const id = literalId(firstEntry.elements[0]);
    if (id) {
      return id;
    }
  }

  return undefined;
}

function findModuleMapDeclaration(
  body: readonly t.Statement[]
): t.VariableDeclaration | undefined {
  for (const statement of body) {
    if (!t.isVariableDeclaration(statement)) {
      continue;
    }
    for (const declaration of statement.declarations) {
      if (t.isObjectExpression(declaration.init)) {
        return statement;
      }
    }
  }
  return undefined;
}

export function findEntryTrailingCode(
  ast: t.File,
  requireFn: IdentifiedFunctionDeclaration,
  body: readonly t.Statement[]
): t.Statement[] {
  const moduleMapDeclaration = findModuleMapDeclaration(body);

  const namespaceImportLocals = new Set<string>();
  for (const stmt of body) {
    if (t.isImportDeclaration(stmt)) {
      for (const spec of stmt.specifiers) {
        if (t.isImportNamespaceSpecifier(spec)) {
          namespaceImportLocals.add(spec.local.name);
        }
      }
    }
  }

  const boilerplate = new Set<t.Statement>();
  function markBoilerplate(path: NodePath): void {
    const stmt = findEnclosingStatementAmong(path, body);
    if (stmt) {
      boilerplate.add(stmt);
    }
  }

  traverse(ast, {
    AssignmentExpression(path) {
      const leftPath = path.get("left") as NodePath;
      if (leftPath.isMemberExpression() && isMemberChainRootedAtRequireFn(leftPath, requireFn)) {
        markBoilerplate(path);
      }
    },
    CallExpression(path) {
      const calleePath = path.get("callee") as NodePath;
      if (!calleePath.isMemberExpression()) {
        return;
      }
      if (!isMemberChainRootedAtRequireFn(calleePath, requireFn)) {
        return;
      }

      const args = path.node.arguments;
      const arg = args[0];
      if (args.length === 1 && t.isIdentifier(arg) && namespaceImportLocals.has(arg.name)) {
        markBoilerplate(path);
      }
    },
  });

  const statements: t.Statement[] = [];
  for (const statement of body) {
    if (
      statement !== requireFn &&
      statement !== moduleMapDeclaration &&
      !t.isImportDeclaration(statement) &&
      !boilerplate.has(statement)
    ) {
      statements.push(statement);
    }
  }
  return statements;
}
