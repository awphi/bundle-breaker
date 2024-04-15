import { NodePath, Visitor } from "@babel/traverse";
import * as t from "@babel/types";

export function replace<T extends t.Node, R extends t.Node>(
  old: T,
  replacement: R
): Visitor<T> {
  const type = old.type;
  // since the referential equality might not be broken by replaceWith we can keep track
  // of if we've replaced the node and skip if so to avoid an expensive shallow equality check
  let replaced = false;

  return {
    [type]: function (path: NodePath<T>) {
      if (path.node === old && !replaced) {
        path.replaceWith(replacement);
        replaced = true;
      }
    },
  };
}
