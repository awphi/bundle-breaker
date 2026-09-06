import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
  findEnclosingStatement,
  isNormalMemberExpression,
  referencesBinding,
  type IdentifiedFunctionDeclaration,
} from "../ast";

function literalId(node: t.Node | null | undefined): string | undefined {
  if (node && (t.isStringLiteral(node) || t.isNumericLiteral(node))) {
    return String(node.value);
  }
  return undefined;
}

function extractRequireCallId(
  callPath: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  if (!callPath.isCallExpression() || callPath.node.arguments.length !== 1) {
    return undefined;
  }
  const calleePath = callPath.get("callee") as NodePath;
  if (!calleePath.isIdentifier() || !referencesBinding(calleePath, requireFn)) {
    return undefined;
  }
  return literalId(callPath.node.arguments[0]);
}

/**
 * A direct call to the require function whose single argument is itself a
 * self-referential assignment onto one of its own properties, e.g.
 * `__webpack_require__(__webpack_require__.s = 0)`. This distinguishes a
 * true entry invocation from an ordinary dependency call like
 * `__webpack_require__(1)` (passes the id directly, no wrapping assignment) -
 * the latter shows up verbatim when there's no numbered entry module at all,
 * and must never be mistaken for one.
 */
function findDirectEntryCall(
  chunkAst: t.File,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  let found: string | undefined;

  traverse(chunkAst, {
    CallExpression(path) {
      if (found) return;

      const calleePath = path.get("callee") as NodePath;
      if (!calleePath.isIdentifier() || !referencesBinding(calleePath, requireFn))
        return;
      if (path.node.arguments.length !== 1) return;

      const arg = path.node.arguments[0];
      if (!t.isAssignmentExpression(arg) || !isNormalMemberExpression(arg.left)) {
        return;
      }

      const argPath = path.get("arguments.0") as NodePath;
      const objPath = argPath.get("left.object") as NodePath;
      if (objPath.isIdentifier() && referencesBinding(objPath, requireFn)) {
        found = literalId(arg.right);
      }
    },
  });

  return found;
}

/**
 * A call to some member function hung off the require function (matched
 * structurally, whatever it's actually named - historically `.O`), one of
 * whose arguments is a zero-arg function/arrow whose body is (or returns) a
 * direct call to the require function with a literal id, e.g.
 * `__webpack_require__.O(undefined, [293], () => (__webpack_require__(761)))`.
 * Used when the entry itself has synchronous split-chunk dependencies that
 * must be ready before it runs.
 */
function findDeferredEntryCall(
  chunkAst: t.File,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  let found: string | undefined;

  traverse(chunkAst, {
    CallExpression(path) {
      if (found) return;

      const calleePath = path.get("callee") as NodePath;
      if (!calleePath.isMemberExpression()) return;
      const objPath = calleePath.get("object") as NodePath;
      if (!objPath.isIdentifier() || !referencesBinding(objPath, requireFn)) return;

      for (const argPath of path.get("arguments") as NodePath[]) {
        if (found) break;
        if (!argPath.isFunction() || argPath.node.params.length !== 0) continue;

        const bodyPath = argPath.get("body") as NodePath;
        if (bodyPath.isCallExpression()) {
          found = extractRequireCallId(bodyPath, requireFn);
        } else if (bodyPath.isBlockStatement()) {
          for (const stmtPath of bodyPath.get("body") as NodePath[]) {
            if (found) break;
            if (!stmtPath.isReturnStatement()) continue;
            const returnArgPath = stmtPath.get("argument") as NodePath;
            if (returnArgPath.node) {
              found = extractRequireCallId(returnArgPath, requireFn);
            }
          }
        }
      }
    },
  });

  return found;
}

/**
 * Tries every known shape for a numbered entry module invoked directly by
 * the runtime chunk itself. Returns undefined if there is none - some
 * bundles inline the entry's own code directly instead of ever numbering it
 * (see `findEntryTrailingCode` below).
 */
export function findEntryIdInRuntimeChunk(
  chunkAst: t.File,
  requireFn: IdentifiedFunctionDeclaration
): string | undefined {
  return (
    findDirectEntryCall(chunkAst, requireFn) ??
    findDeferredEntryCall(chunkAst, requireFn)
  );
}

/**
 * The entry module and its id can also live in an additional chunk rather
 * than the runtime chunk. The chunk's "add these modules" call (jsonp
 * `.push([chunkIds, modules, executeModules])`) has a trailing
 * array-of-arrays argument - the "deferred modules" table - whose first
 * entry's first element is the entry id. Not tied to any particular require
 * function identity - matched purely by the shape of the pushed payload.
 */
export function findEntryIdInAdditionalChunk(
  program: t.Program
): string | undefined {
  for (const stmt of program.body) {
    if (!t.isExpressionStatement(stmt) || !t.isCallExpression(stmt.expression))
      continue;

    const call = stmt.expression;
    const callee = call.callee;
    if (
      !isNormalMemberExpression(callee) ||
      !t.isIdentifier(callee.property, { name: "push" }) ||
      call.arguments.length !== 1 ||
      !t.isArrayExpression(call.arguments[0])
    ) {
      continue;
    }

    const pushed = call.arguments[0];
    const deferredTable = pushed.elements[2];
    if (!deferredTable || !t.isArrayExpression(deferredTable)) continue;

    const firstEntry = deferredTable.elements[0];
    if (!firstEntry || !t.isArrayExpression(firstEntry)) continue;

    const id = literalId(firstEntry.elements[0]);
    if (id) return id;
  }

  return undefined;
}

/**
 * Walks a (possibly multi-level, possibly computed) member expression chain
 * down to its root and checks that root resolves to `requireFn` - i.e.
 * whether `expr` is `<requireFn>.a.b.c...` for any depth/shape, not just one
 * level deep.
 */
function isRootedAtRequireFn(
  path: NodePath,
  requireFn: IdentifiedFunctionDeclaration
): boolean {
  let current = path;
  while (current.isMemberExpression()) {
    current = current.get("object") as NodePath;
  }
  return current.isIdentifier() && referencesBinding(current, requireFn);
}

/**
 * When neither `findEntryIdInRuntimeChunk` nor `findEntryIdInAdditionalChunk`
 * find anything anywhere in the bundle, there is no numbered entry module at
 * all - webpack inlined the entry's own code directly into the runtime
 * chunk. This returns that code: whatever top-level statements remain once
 * the require function declaration, module map declaration, helper property
 * assignments and chunk-registration boilerplate (the
 * `import * as X from "./chunk.js"; <requireFn>.C(X);` pair used by
 * `chunkFormat: "module"`) are accounted for.
 */
export function findEntryTrailingCode(
  ast: t.File,
  requireFn: IdentifiedFunctionDeclaration,
  body: readonly t.Statement[]
): t.Statement[] {
  const moduleMapDeclaration = body.find(
    (stmt) =>
      t.isVariableDeclaration(stmt) &&
      stmt.declarations.some((d) => t.isObjectExpression(d.init))
  );

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
    const stmt = findEnclosingStatement(path, body);
    if (stmt) boilerplate.add(stmt);
  }

  traverse(ast, {
    AssignmentExpression(path) {
      const leftPath = path.get("left") as NodePath;
      if (leftPath.isMemberExpression() && isRootedAtRequireFn(leftPath, requireFn)) {
        markBoilerplate(path);
      }
    },
    CallExpression(path) {
      const calleePath = path.get("callee") as NodePath;
      if (!calleePath.isMemberExpression()) return;
      if (!isRootedAtRequireFn(calleePath, requireFn)) return;

      const args = path.node.arguments;
      const arg = args[0];
      if (args.length === 1 && t.isIdentifier(arg) && namespaceImportLocals.has(arg.name)) {
        markBoilerplate(path);
      }
    },
  });

  return body.filter((stmt) => {
    if (stmt === (requireFn as t.Statement)) return false;
    if (stmt === moduleMapDeclaration) return false;
    // webpack's own compiled output never contains a literal `import` unless
    // it's chunk-registration boilerplate for `chunkFormat: "module"` -
    // source-level imports are always already compiled to require() calls.
    if (t.isImportDeclaration(stmt)) return false;
    if (boilerplate.has(stmt)) return false;
    return true;
  });
}
