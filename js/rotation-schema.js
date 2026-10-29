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
// This is a shape check and not validation (R4, js/rotation-validator.js). It
// says whether a value has the right top-level shape, rule shape and condition
// shape. It does not know the condition vocabulary (R2, #139), which ability
// ids exist, or whether a condition's params make sense, so a rotation can pass
// it and still be rejected by R4. The model has no step, frame or tick in it, so it does not
// depend on the engine's clock.
//
// This module is pure: no DOM, no clock, no random numbers.
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

// A value as a message shows it. JSON.stringify makes NaN and Infinity into
// "null", drops undefined and functions, and throws on a bigint or a cycle, so
// those are written out as what they are instead. Everything else is its JSON.
export function describeValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : String(value);
  }
  if (value === undefined || typeof value === "function") {
    return typeof value;
  }
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return `a ${typeof value} that cannot be written as JSON`;
  }
}

// The path of a member of the thing at `path`: "rules[0]" and "action" make
// "rules[0].action". The path of the rotation itself is "".
export function memberPath(path, member) {
  return path === "" ? member : `${path}.${member}`;
}

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
// and the ones that are not allowed. `where` is how the messages name the
// object, `path` where it is.
function keyErrors(object, allowed, where, path) {
  const errors = [];
  for (const key of allowed) {
    if (!Object.hasOwn(object, key)) {
      errors.push({
        path: memberPath(path, key),
        message: `${where} is missing "${key}".`,
      });
    }
  }
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      errors.push({
        path: memberPath(path, key),
        message: `${where} has unknown field "${key}". Allowed: ${allowed.join(", ")}.`,
      });
    }
  }
  return errors;
}

function conditionShapeErrors(condition, path) {
  if (!isPlainObject(condition)) {
    return [
      { path, message: `${path} must be an object { type, ...params }.` },
    ];
  }
  if (!isNonEmptyString(condition[CONDITION_TYPE_KEY])) {
    return [
      {
        path: memberPath(path, CONDITION_TYPE_KEY),
        message: `${path} needs a non-empty string "${CONDITION_TYPE_KEY}".`,
      },
    ];
  }
  return [];
}

function ruleShapeErrors(rule, path) {
  if (!isPlainObject(rule)) {
    return [
      { path, message: `${path} must be an object { action, conditions }.` },
    ];
  }
  const errors = keyErrors(rule, RULE_KEYS, path, path);
  if (
    Object.hasOwn(rule, "action") &&
    !(typeof rule.action === "string" && ABILITY_ID.test(rule.action))
  ) {
    errors.push({
      path: memberPath(path, "action"),
      message: `${path}.action must be an ability id such as "sinister-strike", not a display name (got ${describeValue(rule.action)}).`,
    });
  }
  if (Object.hasOwn(rule, "conditions")) {
    const { conditions } = rule;
    const at = memberPath(path, "conditions");
    if (!Array.isArray(conditions)) {
      errors.push({
        path: at,
        message: `${at} must be an array ([] means always).`,
      });
    } else if (conditions.length > k("rotation.maxConditionsPerRule")) {
      errors.push({
        path: at,
        message: `${at} has ${conditions.length} conditions; the most allowed is ${k("rotation.maxConditionsPerRule")}.`,
      });
    } else {
      conditions.forEach((condition, index) => {
        errors.push(...conditionShapeErrors(condition, `${at}[${index}]`));
      });
    }
  }
  return errors;
}

// Every shape error in `rotation`, in reading order, as { path, message }: the
// path says where ("rules[2].conditions[0].type"; "" is the rotation itself)
// and the message says what, and names the same place. The version is checked
// first: a file written for another version is not read any further, because
// its other fields may mean something else.
export function rotationShapeErrors(rotation) {
  if (!isPlainObject(rotation)) {
    return [
      {
        path: "",
        message: "A rotation must be an object { schemaVersion, name, rules }.",
      },
    ];
  }
  if (
    Object.hasOwn(rotation, "schemaVersion") &&
    rotation.schemaVersion !== ROTATION_SCHEMA_VERSION
  ) {
    return [
      {
        path: "schemaVersion",
        message: `schemaVersion ${describeValue(rotation.schemaVersion)} is not supported; this build reads schemaVersion ${ROTATION_SCHEMA_VERSION}.`,
      },
    ];
  }
  const errors = keyErrors(rotation, ROTATION_KEYS, "The rotation", "");
  if (Object.hasOwn(rotation, "name")) {
    const { name } = rotation;
    if (!isNonEmptyString(name)) {
      errors.push({
        path: "name",
        message: "name must be a non-empty string.",
      });
    } else if (name.length > k("rotation.maxNameLength")) {
      errors.push({
        path: "name",
        message: `name has ${name.length} characters; the most allowed is ${k("rotation.maxNameLength")}.`,
      });
    }
  }
  if (Object.hasOwn(rotation, "rules")) {
    const { rules } = rotation;
    if (!Array.isArray(rules)) {
      errors.push({
        path: "rules",
        message: "rules must be an array, highest priority first.",
      });
    } else if (rules.length > k("rotation.maxRules")) {
      errors.push({
        path: "rules",
        message: `rules has ${rules.length} rules; the most allowed is ${k("rotation.maxRules")}.`,
      });
    } else {
      rules.forEach((rule, index) => {
        errors.push(...ruleShapeErrors(rule, `rules[${index}]`));
      });
    }
  }
  return errors;
}

// Every shape problem as a string, in reading order. The messages of
// rotationShapeErrors. An empty list means the shape is right.
export function rotationShapeProblems(rotation) {
  return rotationShapeErrors(rotation).map((error) => error.message);
}

// True when the shape is right.
export function isRotationShape(rotation) {
  return rotationShapeErrors(rotation).length === 0;
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
