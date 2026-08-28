import type { NodePath, Visitor } from "@babel/traverse";
import * as t from "@babel/types";

export function replace<R extends t.Node>(
  old: t.Node,
  replacement: R
): Visitor {
  // since the referential equality might not be broken by replaceWith we can keep track
  // of if we've replaced the node and skip if so to avoid an expensive shallow equality check
  let replaced = false;

  return {
    [old.type]: function (path: NodePath) {
      if (path.node === old && !replaced) {
        path.replaceWith(replacement);
        replaced = true;
      }
    },
  };
}
