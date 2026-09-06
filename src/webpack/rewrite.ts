import traverse from "@babel/traverse";
import * as t from "@babel/types";

function literalId(node: t.Node | null | undefined): string | undefined {
  if (node && (t.isStringLiteral(node) || t.isNumericLiteral(node))) {
    return String(node.value);
  }
  return undefined;
}

/**
 * Rewrites every reference to `requireFnName` within `file`:
 *  - a direct call `requireFnName(<literal id>)` becomes `require("<path>")`
 *    when `resolveModuleId` can resolve the id to a relative module path
 *  - anything else - a direct call with an unresolvable/computed argument, a
 *    member access like `.n`/`.d`/`.t`, or a bare reference passed by value
 *    (`.bind(requireFnName, ...)`) - is routed through the runtime shim
 *    instead, by replacing the reference inline with `require("<shimPath>")`.
 *
 * Node caches modules by resolved path, so calling `require("<shimPath>")`
 * more than once in the same file behaves exactly like requiring it once and
 * reusing a variable - this way there's never an unused shim import sitting
 * around to track or clean up: if nothing in a file needs the shim, nothing
 * in that file ever mentions it.
 *
 * `file` is expected to already be a flattened, standalone module file (no
 * surrounding webpack module wrapper function) - i.e. this runs *after*
 * positional param renaming and body hoisting, not on the original function.
 */
export function rewriteRequireCalls(
  file: t.File,
  requireFnName: string,
  resolveModuleId: (id: string) => string | undefined,
  shimRequirePath: string
): void {
  const requireShim = (): t.CallExpression =>
    t.callExpression(t.identifier("require"), [t.stringLiteral(shimRequirePath)]);

  traverse(file, {
    CallExpression(path) {
      const node = path.node;
      if (
        !t.isIdentifier(node.callee, { name: requireFnName }) ||
        node.arguments.length !== 1 ||
        !t.isExpression(node.arguments[0])
      ) {
        return;
      }

      const arg = node.arguments[0] as t.Expression;
      const id = literalId(arg);
      const resolved = id !== undefined ? resolveModuleId(id) : undefined;

      path.replaceWith(
        resolved !== undefined
          ? t.callExpression(t.identifier("require"), [t.stringLiteral(resolved)])
          : t.callExpression(requireShim(), [arg])
      );
      path.skip();
    },
    Identifier(path) {
      if (path.node.name !== requireFnName || !path.isReferencedIdentifier()) return;
      path.replaceWith(requireShim());
      // `replaceWith` re-queues the new node for traversal - without this,
      // when requireFnName is "require" (the common case, post param-
      // rename), the `require(...)` call we just inserted would immediately
      // be re-matched as if it were itself a reference to the require
      // function, wrapping it in another shim call.
      path.skip();
    },
  });
}
