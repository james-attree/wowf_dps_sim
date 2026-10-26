// Closes the no-magic-numbers gap for engine modules. The core rule allows a
// numeric literal used as a variable initializer (`const DODGE_CHANCE = 0.065`).
// Game numbers belong in data/constants.js, so that initializer still fails lint.

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

// Issue #94 (A1). A spell, aura, cooldown or weapon is identified by its
// catalogue id, never by its display name. A name appears in one place, the
// definition (js/ability.js, js/auras.js, js/weapon.js), and everything else
// reads the id. This rule reports a string that is exactly a display name, and
// an identifier key or property that is one (`activeDots.Rupture`,
// `{ Rupture: 1 }`), in a file that is not a definition site. An id such as
// "slice-and-dice" is a different string, so it passes.
const noDisplayName = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a spell, aura, or weapon display name as a string or key in engine code. Use its catalogue id.",
    },
    schema: [
      {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" } },
          // Namespace imports whose members are code identifiers (a class
          // called Rupture), not data, such as `Skills.Rupture`.
          namespaces: { type: "array", items: { type: "string" } },
        },
        required: ["names"],
        additionalProperties: false,
      },
    ],
    messages: {
      name: "{{name}} is a display name. Identify it by its catalogue id ({{id}}) so renaming it in the data cannot silently change the engine.",
    },
  },
  create(context) {
    const names = new Set(context.options[0]?.names ?? []);
    const namespaces = new Set(context.options[0]?.namespaces ?? []);
    const report = (node, name) => {
      context.report({
        node,
        messageId: "name",
        data: {
          name: JSON.stringify(name),
          id: JSON.stringify(
            name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
          ),
        },
      });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string" && names.has(node.value)) {
          report(node, node.value);
        }
      },
      TemplateElement(node) {
        if (names.has(node.value.cooked)) {
          report(node, node.value.cooked);
        }
      },
      Identifier(node) {
        if (!names.has(node.name)) {
          return;
        }
        const parent = node.parent;
        const isMember =
          parent.type === "MemberExpression" &&
          parent.property === node &&
          !parent.computed &&
          !namespaces.has(parent.object.name);
        const isKey =
          (parent.type === "Property" ||
            parent.type === "PropertyDefinition" ||
            parent.type === "MethodDefinition") &&
          parent.key === node &&
          !parent.computed;
        if (isMember || isKey) {
          report(node, node.name);
        }
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
    "no-display-name": noDisplayName,
  },
};

export default plugin;
