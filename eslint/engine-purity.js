// Closes the no-magic-numbers gap for engine modules. The core rule allows a
// numeric literal used as a variable initializer (`const DODGE_CHANCE = 0.065`),
// which is how game numbers are written today. Those still have to fail lint
// until they move into data/constants.js (#7).

const ALLOWED = new Set([0, 1, -1]);

function fullNumber(node) {
  const parent = node.parent;
  if (
    parent &&
    parent.type === "UnaryExpression" &&
    (parent.operator === "-" || parent.operator === "+") &&
    parent.argument === node
  ) {
    const value = parent.operator === "-" ? -node.value : node.value;
    return { node: parent, value, raw: `${parent.operator}${node.raw}` };
  }
  return { node, value: node.value, raw: node.raw };
}

function isAllowed(value) {
  return ALLOWED.has(value) || Object.is(value, -0);
}

const noNumericLiteral = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow numeric literals as variable initializers in engine modules, except 0, 1, and -1.",
    },
    schema: [],
    messages: {
      literal:
        "Numeric literal {{raw}} is not allowed in engine code. Read game numbers from data/constants.js. Allowed literals are 0, 1, and -1.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "number") {
          return;
        }
        const number = fullNumber(node);
        const declarator = number.node.parent;
        if (
          !declarator ||
          declarator.type !== "VariableDeclarator" ||
          declarator.init !== number.node
        ) {
          return;
        }
        if (isAllowed(number.value)) {
          return;
        }
        context.report({
          node: number.node,
          messageId: "literal",
          data: { raw: number.raw },
        });
      },
    };
  },
};

const plugin = {
  meta: {
    name: "engine-purity",
    version: "1.0.0",
  },
  rules: {
    "no-numeric-literal": noNumericLiteral,
  },
};

export default plugin;
