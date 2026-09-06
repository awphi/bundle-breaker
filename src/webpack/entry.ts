import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
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

/**
 * Shape A - a direct call to the require function whose single argument is
 * itself a self-referential assignment onto one of its own properties, e.g.
 * `__webpack_require__(__webpack_require__.s = 0)`. This is what
 * distinguishes a true entry invocation from an ordinary dependency call like
 * `__webpack_require__(1)` (passes the id directly, no wrapping assignment) -
 * the latter shows up verbatim in shape B bundles and must never be mistaken
 * for an entry marker.
 */
export function findShapeAEntryId(
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

function extractDirectCallId(
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
 * Shape C - a call to some member function hung off the require function
 * (matched structurally, whatever it's actually named - historically `.O`),
 * one of whose arguments is a zero-arg function/arrow whose body is (or
 * returns) a direct call to the require function with a literal id, e.g.
 * `__webpack_require__.O(undefined, [293], () => (__webpack_require__(761)))`.
 */
export function findShapeCEntryId(
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
          found = extractDirectCallId(bodyPath, requireFn);
        } else if (bodyPath.isBlockStatement()) {
          for (const stmtPath of bodyPath.get("body") as NodePath[]) {
            if (found) break;
            if (!stmtPath.isReturnStatement()) continue;
            const returnArgPath = stmtPath.get("argument") as NodePath;
            if (returnArgPath.node) {
              found = extractDirectCallId(returnArgPath, requireFn);
            }
          }
        }
      }
    },
  });

  return found;
}

/**
 * Shape D - the entry module and its id live in an additional chunk rather
 * than the runtime chunk. The chunk's "add these modules" call (jsonp
 * `.push([chunkIds, modules, executeModules])`) has a trailing
 * array-of-arrays argument - the "deferred modules" table - whose first
 * entry's first element is the entry id. Not tied to any particular require
 * function identity - matched purely by the shape of the pushed payload.
 */
export function findShapeDEntryId(program: t.Program): string | undefined {
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
