import { Visitor } from "@babel/traverse";
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
    "&",
    "|",
    "^",
  ])
);

export function flipLiterals(): Visitor<t.BinaryExpression> {
  return {
    BinaryExpression: function (path) {
      const {
        node: { right, left, operator },
      } = path;

      if (
        !t.isIdentifier(left) &&
        !t.isPrivateName(left) &&
        t.isIdentifier(right) &&
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

export function decimalNumericLiterals(): Visitor<t.NumericLiteral> {
  return {
    NumericLiteral: function (path) {
      const {
        node: { extra, value },
      } = path;
      if (
        typeof extra.raw === "string" &&
        typeof extra.rawValue === "number" &&
        extra.raw !== extra.rawValue.toString()
      ) {
        path.addComment("inner", extra.raw.toString());
        extra.raw = value.toString();
      }
    },
  };
}

export function breakSequenceExpressions(): Visitor<t.SequenceExpression> {
  return {
    ExpressionStatement: function (path) {
      if (t.isSequenceExpression(path.node.expression)) {
        const { expressions } = path.node.expression;
        path.replaceWithMultiple(
          expressions.map((expr) => t.expressionStatement(expr))
        );
      }
    },
  };
}

export function enforceBlockStatementsOnIfs(): Visitor<t.IfStatement> {
  return {
    IfStatement: function (path) {
      for (const key of ["alternate", "consequent"] as const) {
        const subPath = path.get(key);
        if (subPath.node !== null && !t.isBlockStatement(subPath.node)) {
          subPath.replaceWith(t.blockStatement([subPath.node]));
        }
      }
    },
  };
}

export function splitVariableDeclarators(): Visitor<t.VariableDeclaration> {
  return {
    VariableDeclaration: function (path) {
      const decs = path.node.declarations;
      if (decs.length > 1) {
        const parent = path.parentPath;
        // it would be nice to pull irrelevant declarations out of the init section of for loops in the future
        if (!t.isForStatement(parent.node)) {
          path.replaceWithMultiple(
            decs.map((d) => t.variableDeclaration(path.node.kind, [d]))
          );
        }
      }
    },
  };
}
