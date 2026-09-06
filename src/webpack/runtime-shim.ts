import traverse from "@babel/traverse";
import * as t from "@babel/types";
import type { FileNode } from "../types";
import { stripComments } from "../ast";
import { SHIM_IDENTIFIER } from "./rewrite";

/**
 * Clones `stmt` and renames every reference to `requireFnName` within it to
 * the shim's own identifier - a relocated property that calls back into "the
 * require function" (e.g. `.t`'s `this(value)` branch, or `.O`'s recursive
 * `__webpack_require__.O` self-reference) now means the shim's callable
 * id->path require function instead.
 */
function renameRequireFnRefs(stmt: t.Statement, requireFnName: string): t.Statement {
  const cloned = t.cloneNode(stmt, true);
  stripComments(cloned);
  const wrapper = t.file(t.program([cloned]));

  traverse(wrapper, {
    Identifier(path) {
      if (path.node.name === requireFnName && path.isReferencedIdentifier()) {
        path.node.name = SHIM_IDENTIFIER;
      }
    },
  });

  return cloned;
}

/**
 * Builds the shared `__webpack_runtime.js` file: the relocated
 * `<requireFn>.X = ...` helper statements (verbatim, whatever `X` turned out
 * to be), plus a real callable require-shim backed by an id->relative-path
 * lookup table covering every module in the whole bundle. This is what both
 * the relocated properties (closing back over "the require function") and
 * dynamic/computed require calls elsewhere route through.
 */
export function createRuntimeShimFile(
  helperStatements: readonly t.Statement[],
  requireFnName: string,
  idToPath: ReadonlyMap<string, string>,
  shimPath: string
): FileNode {
  const idToPathTable = t.objectExpression(
    [...idToPath.entries()].map(([id, relativePath]) =>
      t.objectProperty(t.stringLiteral(id), t.stringLiteral(relativePath))
    )
  );

  const statements: t.Statement[] = [
    t.variableDeclaration("const", [
      t.variableDeclarator(t.identifier("ID_TO_PATH"), idToPathTable),
    ]),
    t.functionDeclaration(
      t.identifier(SHIM_IDENTIFIER),
      [t.identifier("id")],
      t.blockStatement([
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier("resolved"),
            t.memberExpression(
              t.identifier("ID_TO_PATH"),
              t.identifier("id"),
              true
            )
          ),
        ]),
        t.ifStatement(
          t.binaryExpression(
            "===",
            t.identifier("resolved"),
            t.identifier("undefined")
          ),
          t.throwStatement(
            t.newExpression(t.identifier("Error"), [
              t.binaryExpression(
                "+",
                t.stringLiteral("Unknown webpack module id: "),
                t.identifier("id")
              ),
            ])
          )
        ),
        t.returnStatement(
          t.callExpression(t.identifier("require"), [t.identifier("resolved")])
        ),
      ])
    ),
  ];

  for (const stmt of helperStatements) {
    statements.push(renameRequireFnRefs(stmt, requireFnName));
  }

  statements.push(
    t.expressionStatement(
      t.assignmentExpression(
        "=",
        t.memberExpression(t.identifier("module"), t.identifier("exports")),
        t.identifier(SHIM_IDENTIFIER)
      )
    )
  );

  return { path: shimPath, ast: t.file(t.program(statements)) };
}
