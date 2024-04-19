import { NodePath, Visitor } from "@babel/traverse";
import * as t from "@babel/types";

type BinaryOperator = t.BinaryExpression["operator"];

const operatorFlips: Partial<Record<BinaryOperator, BinaryOperator>> = {
  "<": ">",
  ">=": "<=",
  "<=": ">=",
  ">": "<",
};

for (const [k, v] of Object.entries(operatorFlips)) {
  operatorFlips[v] = operatorFlips[k];
}

const flippableOperations = new Set<BinaryOperator>(
  // all the operators we have a flip for and all the commutative operators
  Object.values(operatorFlips).concat([
    "!==",
    "!=",
    "===",
    "==",
    "*",
    "+",
    "&",
    "|",
    "^",
  ])
);

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

export function flipLiterals(): Visitor<t.BinaryExpression> {
  return {
    BinaryExpression: function (path) {
      const {
        node: { right, left, operator },
      } = path;
      if (
        t.isLiteral(left) &&
        !t.isLiteral(right) &&
        flippableOperations.has(operator)
      ) {
        path.node.left = right;
        path.node.right = left;

        if (operator in operatorFlips) {
          path.node.operator = operatorFlips[operator];
        }
      }
    },
  };
}

export function voidLiteralToUndefined(): Visitor<t.UnaryExpression> {
  return {
    UnaryExpression: function (path) {
      if (path.node.operator === "void" && t.isLiteral(path.node.argument)) {
        path.replaceWith(t.identifier("undefined"));
      }
    },
  };
}

export function verboseTrueFalse(): Visitor<t.UnaryExpression> {
  return {
    UnaryExpression: function (path) {
      const {
        node: { operator, argument },
      } = path;
      if (operator === "!" && t.isNumericLiteral(argument)) {
        path.replaceWith(
          argument.value === 0
            ? t.booleanLiteral(true)
            : t.booleanLiteral(false)
        );
      }
    },
  };
}
