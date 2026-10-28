// The RotationRule JSON model, as a shape check (roadmap R1, issue #138). The
// rotation the Rogue casts today is code (Rogue.rotation, js/rogue.js) with
// its numbers in data/constants.js. A rotation builder, presets and
// import/export need the same rotation as data: this file fixes what that data
// looks like. docs/rotation.md is the reference, with examples and the four
// decisions this file enforces (empty conditions, priority order,
// schemaVersion, unknown fields).
//
//   {
//     schemaVersion: 1,
//     name: "Combat (placeholder)",
//     rules: [                                  // priority order, first is highest
//       { action: "sinister-strike",            // an ability id, not a display name
//         conditions: [ { type, ...params } ]   // an AND list; [] means always
//       },
//     ],
//   }
//
// This is a shape check and not validation (R4). It says whether a value has
// the right top-level shape, rule shape and condition shape. It does not know
// the condition vocabulary (R2, #139), which ability ids exist, or whether a
// condition's params make sense, so a rotation can pass it and still be
// rejected by R4. The model has no step, frame or tick in it, so it does not
// depend on the engine's clock.
//
// This module is pure: no DOM, no clock, no random numbers. Nothing in the live
// page imports it yet; the builder and the interpreter (R3) will.
import { k } from "../data/constants.js";

// The version this build reads and writes. A file with any other version is
// rejected (docs/rotation.md, "schemaVersion"). Raise it when the shape changes
// in a way an older reader would misread.
export const ROTATION_SCHEMA_VERSION = 1;

// Every key each level may have, and all of them are required. An unknown key
// is a problem, not ignored (docs/rotation.md, "Unknown fields").
export const ROTATION_KEYS = Object.freeze(["schemaVersion", "name", "rules"]);
export const RULE_KEYS = Object.freeze(["action", "conditions"]);

// Condition objects are { type, ...params }: `type` is the only key this file
// knows, and the params are R2's.
export const CONDITION_TYPE_KEY = "type";

// What an ability id looks like: lowercase words joined by hyphens, as the
// ability catalogue's slugify makes them ("sinister-strike"). A display name
// ("Sinister Strike") fails this, which is the mistake it is here to catch.
// Whether the id is one of the abilities is R4's check.
const ABILITY_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// A plain object: what JSON.parse makes for { }. An array, null, a class
// instance or a Map is not one (their prototype is not Object.prototype).
function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Checks one object's keys against the allowed list: the ones that are missing
// and the ones that are not allowed.
function keyProblems(object, allowed, where) {
  const problems = [];
  for (const key of allowed) {
    if (!Object.hasOwn(object, key)) {
      problems.push(`${where} is missing "${key}".`);
    }
  }
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      problems.push(
        `${where} has unknown field "${key}". Allowed: ${allowed.join(", ")}.`,
      );
    }
  }
  return problems;
}

function conditionProblems(condition, where) {
  if (!isPlainObject(condition)) {
    return [`${where} must be an object { type, ...params }.`];
  }
  if (!isNonEmptyString(condition[CONDITION_TYPE_KEY])) {
    return [`${where} needs a non-empty string "${CONDITION_TYPE_KEY}".`];
  }
  return [];
}

function ruleProblems(rule, where) {
  if (!isPlainObject(rule)) {
    return [`${where} must be an object { action, conditions }.`];
  }
  const problems = keyProblems(rule, RULE_KEYS, where);
  if (
    Object.hasOwn(rule, "action") &&
    !(typeof rule.action === "string" && ABILITY_ID.test(rule.action))
  ) {
    problems.push(
      `${where}.action must be an ability id such as "sinister-strike", not a display name (got ${JSON.stringify(rule.action)}).`,
    );
  }
  if (Object.hasOwn(rule, "conditions")) {
    const { conditions } = rule;
    if (!Array.isArray(conditions)) {
      problems.push(`${where}.conditions must be an array ([] means always).`);
    } else if (conditions.length > k("rotation.maxConditionsPerRule")) {
      problems.push(
        `${where}.conditions has ${conditions.length} conditions; the most allowed is ${k("rotation.maxConditionsPerRule")}.`,
      );
    } else {
      conditions.forEach((condition, index) => {
        problems.push(
          ...conditionProblems(condition, `${where}.conditions[${index}]`),
        );
      });
    }
  }
  return problems;
}

// Every shape problem in `rotation`, in reading order. An empty list means the
// shape is right. Each message names where the problem is. The version is
// checked first: a file written for another version is not read any further,
// because its other fields may mean something else.
export function rotationShapeProblems(rotation) {
  if (!isPlainObject(rotation)) {
    return ["A rotation must be an object { schemaVersion, name, rules }."];
  }
  if (
    Object.hasOwn(rotation, "schemaVersion") &&
    rotation.schemaVersion !== ROTATION_SCHEMA_VERSION
  ) {
    return [
      `schemaVersion ${JSON.stringify(rotation.schemaVersion)} is not supported; this build reads schemaVersion ${ROTATION_SCHEMA_VERSION}.`,
    ];
  }
  const problems = keyProblems(rotation, ROTATION_KEYS, "The rotation");
  if (Object.hasOwn(rotation, "name")) {
    const { name } = rotation;
    if (!isNonEmptyString(name)) {
      problems.push("name must be a non-empty string.");
    } else if (name.length > k("rotation.maxNameLength")) {
      problems.push(
        `name has ${name.length} characters; the most allowed is ${k("rotation.maxNameLength")}.`,
      );
    }
  }
  if (Object.hasOwn(rotation, "rules")) {
    const { rules } = rotation;
    if (!Array.isArray(rules)) {
      problems.push("rules must be an array, highest priority first.");
    } else if (rules.length > k("rotation.maxRules")) {
      problems.push(
        `rules has ${rules.length} rules; the most allowed is ${k("rotation.maxRules")}.`,
      );
    } else {
      rules.forEach((rule, index) => {
        problems.push(...ruleProblems(rule, `rules[${index}]`));
      });
    }
  }
  return problems;
}

// True when the shape is right.
export function isRotationShape(rotation) {
  return rotationShapeProblems(rotation).length === 0;
}

// Returns the rotation when its shape is right, so a caller can wrap a parse in
// it. Otherwise it throws a RangeError whose message lists every problem.
export function assertRotationShape(rotation) {
  const problems = rotationShapeProblems(rotation);
  if (problems.length > 0) {
    throw new RangeError(`Not a RotationRule list:\n${problems.join("\n")}`);
  }
  return rotation;
}
