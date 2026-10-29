// The rotation condition vocabulary (roadmap R2, issue #139). A rule in a
// RotationRule list (js/rotation-schema.js, docs/rotation.md) has an AND list
// of conditions, each `{ type, ...params }`. This module says which types
// exist and what params each takes, checks a condition (conditionProblems,
// assertCondition), and evaluates one against a state (evaluate).
//
// evaluate(condition, state) is pure. It reads the condition and a state view,
// both plain data, and nothing else: no Rogue, no Simulation, no clock. The
// state view is built from a fight by js/rotation-state.js, so a condition can
// never reach an engine internal, and the validator (R4) and the builder can
// use this module without an engine. The view is described there.
//
// Time is in seconds of fight time, never in steps. Comparisons are exact (no
// tolerance), so a threshold at a boundary behaves as the code rotation's
// `<=` does (Rogue.rotation: Slice and Dice at 10 s left). Ids in params are
// the ids of the ability data and the aura definitions ("slice-and-dice"),
// never display names. Whether an ability or aura id exists, and whether a
// number is in range, is the validator's check (js/rotation-validator.js, R4).
//
// An aura, debuff or cooldown that is not in the state counts as 0 s remaining
// (and a debuff as 0 stacks), so "missing or at most 10 s left" is one
// condition: auraRemaining <= 10.
import { RESOURCE_DEFINITIONS } from "./resource-data.js";
import { describeValue, memberPath, rotationError } from "./rotation-schema.js";

// The comparison operators of every condition that compares a number.
export const OPERATORS = Object.freeze([">=", ">", "<=", "<", "=="]);

const COMPARE = Object.freeze({
  ">=": (actual, value) => actual >= value,
  ">": (actual, value) => actual > value,
  "<=": (actual, value) => actual <= value,
  "<": (actual, value) => actual < value,
  "==": (actual, value) => actual === value,
});

// What an id param looks like: lowercase words joined by hyphens, as in the
// rotation schema's `action`. A display name ("Slice and Dice") fails it.
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const RESOURCE_IDS = Object.freeze(
  RESOURCE_DEFINITIONS.map((definition) => definition.id),
);

// A param is { kind, optional? }. kind is one of the checks below.
const KINDS = {
  id: (value) => typeof value === "string" && ID.test(value),
  operator: (value) => OPERATORS.includes(value),
  number: (value) => Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
  resource: (value) => RESOURCE_IDS.includes(value),
};

const KIND_HINT = {
  id: 'an id such as "slice-and-dice" (lowercase words joined by hyphens, not a display name)',
  operator: `one of ${OPERATORS.join(" ")}`,
  number: "a finite number",
  boolean: "true or false",
  resource: `one of ${RESOURCE_IDS.join(", ")}`,
};

const op = { kind: "operator" };
const value = { kind: "number" };
const compare = { op, value };

// Every type: its params, and how it reads the state. `read` gives the number
// a comparison uses, or `test` gives the answer outright.
const TYPES = {
  // A resource pool's current value ("energy >= 40").
  resource: {
    params: { resource: { kind: "resource" }, ...compare },
    read: (c, state) => state.resources[c.resource].value,
  },
  // Combo points: the same as resource with resource "comboPoints".
  comboPoints: {
    params: compare,
    read: (c, state) => state.resources.comboPoints.value,
  },
  // A self buff is up. `active` is true by default; false means "is not up".
  auraActive: {
    params: {
      aura: { kind: "id" },
      active: { kind: "boolean", optional: true },
    },
    test: (c, state) =>
      Object.hasOwn(state.auras, c.aura) === (c.active ?? true),
  },
  // Seconds left on a self buff. Not up counts as 0.
  auraRemaining: {
    params: { aura: { kind: "id" }, ...compare },
    read: (c, state) =>
      Object.hasOwn(state.auras, c.aura) ? state.auras[c.aura].remaining : 0,
  },
  // A debuff on the target is up.
  debuffActive: {
    params: {
      debuff: { kind: "id" },
      active: { kind: "boolean", optional: true },
    },
    test: (c, state) =>
      Object.hasOwn(state.debuffs, c.debuff) === (c.active ?? true),
  },
  // Seconds left on a target debuff. Not up counts as 0.
  debuffRemaining: {
    params: { debuff: { kind: "id" }, ...compare },
    read: (c, state) =>
      Object.hasOwn(state.debuffs, c.debuff)
        ? state.debuffs[c.debuff].remaining
        : 0,
  },
  // Stacks of a target debuff. Not up counts as 0.
  debuffStacks: {
    params: { debuff: { kind: "id" }, ...compare },
    read: (c, state) =>
      Object.hasOwn(state.debuffs, c.debuff)
        ? state.debuffs[c.debuff].stacks
        : 0,
  },
  // The ability's own cooldown is over. `ready` is true by default; false
  // means "is on cooldown". It says nothing about the GCD or the energy.
  cooldownReady: {
    params: {
      ability: { kind: "id" },
      ready: { kind: "boolean", optional: true },
    },
    test: (c, state) =>
      (!Object.hasOwn(state.cooldowns, c.ability) ||
        state.cooldowns[c.ability] <= 0) === (c.ready ?? true),
  },
  // Seconds of fight time that have passed.
  fightTime: { params: compare, read: (c, state) => state.time },
  // Seconds of fight left. With no fight length in the state it is Infinity.
  fightTimeRemaining: {
    params: compare,
    read: (c, state) =>
      state.duration === null
        ? Infinity
        : Math.max(0, state.duration - state.time),
  },
  // Seconds until energy reaches its cap at the current regeneration rate: 0
  // at the cap, Infinity when it does not regenerate.
  energyToCap: {
    params: compare,
    read: (c, state) => {
      const { value: energy, max, regenPerSecond } = state.resources.energy;
      if (energy >= max) {
        return 0;
      }
      // Below the cap, a rate of 0 divides to Infinity: it never gets there.
      return (max - energy) / regenPerSecond;
    },
  },
  // The build or the host grants the ability (Blade Flurry, Adrenaline Rush
  // and Cold Blood come from talents). Strict: with no build selected and no
  // host grant nothing is granted, so a talent ability is not.
  abilityGranted: {
    params: { ability: { kind: "id" } },
    test: (c, state) => state.granted.includes(c.ability),
  },
  // The build does not hold the ability back. False only when a build is
  // selected, a talent grants the ability, and the build does not have it. With
  // no build selected it is true, so the fight before talents casts everything,
  // as the code rotation does (Rogue.lockedByBuild).
  abilityUnlocked: {
    params: { ability: { kind: "id" } },
    test: (c, state) =>
      !(
        state.build.selected &&
        state.talentAbilities.includes(c.ability) &&
        !state.granted.includes(c.ability)
      ),
  },
};

export const CONDITION_TYPES = Object.freeze(Object.keys(TYPES));

function isPlainObject(candidate) {
  if (candidate === null || typeof candidate !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(candidate);
  return proto === Object.prototype || proto === null;
}

// Every error in a condition, as { code, path, message, ...data } (#212; the
// codes are conditionNotObject, unknownConditionType, and missingParam,
// badParam and unknownParam with { param }): the path names the param
// ("rules[0].conditions[1].aura"; the condition's own path for a problem with
// the condition as a whole) and the message names the same place. An empty
// list means it is a known type with every required param right and no other
// param. `where` is the condition's path, and the prefix of the messages.
export function conditionErrors(condition, where = "The condition") {
  if (!isPlainObject(condition)) {
    return [
      rotationError(
        "conditionNotObject",
        where,
        `${where} must be an object { type, ...params }.`,
      ),
    ];
  }
  const { type } = condition;
  if (typeof type !== "string" || !Object.hasOwn(TYPES, type)) {
    return [
      rotationError(
        "unknownConditionType",
        memberPath(where, "type"),
        `${where} has unknown type ${describeValue(type)}. Known: ${CONDITION_TYPES.join(", ")}.`,
      ),
    ];
  }
  const { params } = TYPES[type];
  const errors = [];
  for (const [name, spec] of Object.entries(params)) {
    if (!Object.hasOwn(condition, name)) {
      if (spec.optional !== true) {
        errors.push(
          rotationError(
            "missingParam",
            memberPath(where, name),
            `${where} (${type}) is missing "${name}": ${KIND_HINT[spec.kind]}.`,
            { param: name },
          ),
        );
      }
    } else if (!KINDS[spec.kind](condition[name])) {
      errors.push(
        rotationError(
          "badParam",
          memberPath(where, name),
          `${where} (${type}) has a bad "${name}": needs ${KIND_HINT[spec.kind]}, got ${describeValue(condition[name])}.`,
          { param: name },
        ),
      );
    }
  }
  for (const name of Object.keys(condition)) {
    if (name !== "type" && !Object.hasOwn(params, name)) {
      errors.push(
        rotationError(
          "unknownParam",
          memberPath(where, name),
          `${where} (${type}) has unknown param "${name}". Allowed: ${Object.keys(params).join(", ") || "none"}.`,
          { param: name },
        ),
      );
    }
  }
  return errors;
}

// Every problem with a condition, as strings: the messages of conditionErrors.
export function conditionProblems(condition, where = "The condition") {
  return conditionErrors(condition, where).map((error) => error.message);
}

// True when `actual` compares to `value` by `op`, as a condition does. Exposed
// so that a summary can say whether a missing aura (0 s left) satisfies one.
export function compareNumbers(op, actual, value) {
  return COMPARE[op](actual, value);
}

// Returns the condition, or throws a RangeError that lists the problems.
export function assertCondition(condition) {
  const problems = conditionProblems(condition);
  if (problems.length > 0) {
    throw new RangeError(`Bad rotation condition:\n${problems.join("\n")}`);
  }
  return condition;
}

// True when the condition holds in `state`, with no check of the condition
// itself. Only for a condition that has already passed assertCondition: the
// interpreter (js/rotation-interpreter.js) checks every condition of a
// rotation once, when it loads it, and then calls this at every decision point
// (R3, #140). A bad condition here is not a RangeError; it is whatever its
// bad shape makes of the state read.
export function evaluateTrusted(condition, state) {
  const type = TYPES[condition.type];
  if (type.test !== undefined) {
    return type.test(condition, state);
  }
  return COMPARE[condition.op](type.read(condition, state), condition.value);
}

// A function of the state that answers what evaluateTrusted(condition, state)
// answers, with the type and the comparison looked up once instead of at every
// call. For a condition that has already passed assertCondition, and which is
// not changed afterwards (the interpreter compiles from its frozen copy). The
// interpreter calls it at every decision point of a fight (R3, #140).
export function compileCondition(condition) {
  const type = TYPES[condition.type];
  if (type.test !== undefined) {
    const { test } = type;
    return (state) => test(condition, state);
  }
  const { read } = type;
  const compare = COMPARE[condition.op];
  const { value } = condition;
  return (state) => compare(read(condition, state), value);
}

// True when the condition holds in `state`. A bad condition is a RangeError
// (assertCondition); evaluate never changes the condition or the state. It
// checks the condition on every call, which is for a one-off read: a caller
// that evaluates the same conditions again and again checks them once and
// uses evaluateTrusted.
export function evaluate(condition, state) {
  assertCondition(condition);
  return evaluateTrusted(condition, state);
}

// True when every condition holds. An empty list is true: the rule always
// applies (docs/rotation.md, "An empty conditions list").
export function evaluateAll(conditions, state) {
  return conditions.every((condition) => evaluate(condition, state));
}
