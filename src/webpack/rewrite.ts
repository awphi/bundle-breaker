import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { literalId } from "../ast";

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
      path.skip();
    },
  });
}

export function fileRequires(file: t.File, requirePath: string): boolean {
  let found = false;

  traverse(file, {
    CallExpression(path) {
      if (found) return;
      const [arg] = path.node.arguments;
      if (
        t.isIdentifier(path.node.callee, { name: "require" }) &&
        t.isStringLiteral(arg, { value: requirePath })
      ) {
        found = true;
      }
    },
  });

  return found;
}
