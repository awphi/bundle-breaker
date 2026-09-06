import traverse from "@babel/traverse";
import * as t from "@babel/types";

/** Local binding name given to the runtime shim wherever a module needs it. */
export const SHIM_IDENTIFIER = "__wp";

function literalId(node: t.Node | null | undefined): string | undefined {
  if (node && (t.isStringLiteral(node) || t.isNumericLiteral(node))) {
    return String(node.value);
  }
  return undefined;
}

export interface RequireRewriteResult {
  readonly usesShim: boolean;
}

/**
 * Rewrites every reference to `requireFnName` within `file`:
 *  - a direct call `requireFnName(<literal id>)` becomes `require("<path>")`
 *    when `resolveId` can resolve the id to a relative module path
 *  - a direct call with an unresolvable/computed argument becomes
 *    `__wp(<arg>)` instead - routed through the runtime shim's own id->path
 *    table, which covers dynamic/computed requires (e.g. `require.context`)
 *  - any other bare reference (member access like `.n`/`.d`/`.t`, or passed
 *    by value as in `.bind(requireFnName, ...)`) is renamed onto the shim
 *    identifier in place - `requireFnName.X(...)` becomes `__wp.X(...)`,
 *    `.bind(requireFnName, ...)` becomes `.bind(__wp, ...)`. Plain identifier
 *    renaming covers both without needing to special-case either: JS method-
 *    call semantics (`__wp.X(...)`) mean `this` inside a relocated helper is
 *    `__wp` for free, satisfying helpers like `.t` that call back into "the
 *    require function" via `this`.
 *
 * `file` is expected to already be a flattened, standalone module file (no
 * surrounding webpack module wrapper function) - i.e. this runs *after*
 * positional param renaming and body hoisting, not on the original function.
 */
export function applyRequireRewrite(
  file: t.File,
  requireFnName: string,
  resolveId: (id: string) => string | undefined
): RequireRewriteResult {
  let usesShim = false;

  traverse(file, {
    CallExpression(callPath) {
      const node = callPath.node;
      if (
        !t.isIdentifier(node.callee, { name: requireFnName }) ||
        node.arguments.length !== 1 ||
        !t.isExpression(node.arguments[0])
      ) {
        return;
      }

      const arg = node.arguments[0] as t.Expression;
      const id = literalId(arg);
      const resolved = id !== undefined ? resolveId(id) : undefined;

      if (resolved !== undefined) {
        callPath.replaceWith(
          t.callExpression(t.identifier("require"), [
            t.stringLiteral(resolved),
          ])
        );
      } else {
        usesShim = true;
        callPath.replaceWith(
          t.callExpression(t.identifier(SHIM_IDENTIFIER), [arg])
        );
      }
      callPath.skip();
    },
    Identifier(idPath) {
      if (idPath.node.name !== requireFnName) return;
      if (!idPath.isReferencedIdentifier()) return;
      usesShim = true;
      idPath.node.name = SHIM_IDENTIFIER;
    },
  });

  return { usesShim };
}
