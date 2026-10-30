import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { abilityCatalogue } from "./abilities.js";
import { AURAS } from "./auras.js";
import { CONDITION_PARAMS, conditionErrors } from "./rotation-conditions.js";
import {
  conditionShapeErrors,
  describeValue,
  formatErrors,
  rotationError,
  rotationTopShape,
  ruleShape,
} from "./rotation-schema.js";
import {
  builtinTag,
  isOrdinaryObject,
  withArticle,
} from "./ordinary-object.js";
import { RESOURCE_DEFINITIONS } from "./resource-data.js";
import { talentGrantedAbilities } from "./talent-build.js";

// The rotation validator (roadmap R4, issue #141). A rotation arrives from a
// preset, an import file or the builder, so a bad one must be refused with a
// message that says which rule and what is wrong, before a fight starts. The
// interpreter (js/rotation-interpreter.js) calls this when it compiles a
// rotation, so createFight and runFight reject an invalid rotation before the
// simulation, and with it the rng, exists.
//
// validateRotation(rotation, context) returns every error as a frozen
// { code, path, message, ...data } (#212). The code is a stable name for the
// kind of error, for a view to switch on (docs/rotation.md, "Error codes",
// lists them with their data). The path says where
// (`rules[2].conditions[0].aura`; "" is the rotation as a whole) and the
// message says what, without saying where (the message contract, #214):
// rotationProblems and assertValidRotation, the string and throwing forms,
// write each error as its path and then its message (formatError), and a view
// puts a readable place before the message. An empty list means the rotation
// is valid. The forms report the same errors; a caller picks one.
//
// What it checks, in this order:
//   1. The shape (js/rotation-schema.js): the version, the name, the three
//      limits, the rule and condition shapes, no unknown fields. Only two
//      shape errors stop the check: a rotation that is not an object, and
//      another schemaVersion. Otherwise it carries on past shape errors
//      (#212), so an empty name does not hide the rules' errors: a rule whose
//      action or conditions cannot be read (not an object, a missing field,
//      an action that is not an id, conditions that are not an array or over
//      the limit) is skipped after its shape errors, and the rules after it
//      are still checked, as is every condition of the right shape.
//   2. The rule list is not empty: a rotation with no rules casts nothing.
//      A rules list that is not an array, or over the limit, is not read.
//   3. Each rule's action is an ability the rogue can cast.
//   4. Each condition: a known type, the params it takes, each of the right
//      type (js/rotation-conditions.js), and then the params' meaning: an
//      aura, debuff or ability id that exists, and a number in its range.
//   5. A rule that casts an ability a talent grants (talentGrantedAbilities,
//      read from the talent effects data, issue #188) has a condition that
//      guards it, so a build without the talent never casts it. Cold Blood
//      needs `abilityGranted` (issue #155). Until issue #199 the others take
//      `abilityGranted` or `abilityUnlocked`; see TRANSITIONAL below.
// It does not check whether a rule is reachable or sensible (an order that
// never casts something). Nothing here knows a step or a frame.
//
// This module is pure: no DOM, no clock, no random numbers. It reads the
// ability data and the aura definitions. A message names ids. The talent guard
// (rule 5) is shown in the import UI, so its message also writes the ability's
// display name beside the id (abilityLabel, issue #203); the name is only ever
// written out, never compared or branched on.

// What a rotation is validated against: which ids exist. Every list is of ids.
//
//   abilities  the abilities in the spell data. An id outside it is unknown.
//   castable   the abilities the rogue casts (a subset of `abilities`). An id
//              in the spell data but not here is a rogue spell the engine does
//              not cast yet.
//   auras      the self buffs a condition may name (auraActive, auraRemaining)
//   debuffs    the target debuffs a condition may name, as { id: maxStacks }
//   talentGrantedAbilities
//              the abilities a talent grants, whose rules need a guard (rule
//              5). An array or a Set of id strings; the engine's is
//              talentGrantedAbilities from js/talent-build.js, from the talent
//              effects data. Anything else is a TypeError (#207): a string
//              would be read as its characters and guard nothing.
//
// A context may give any of these; what it leaves out is the engine's own.
const ENGINE_ABILITIES = Object.freeze(
  abilityCatalogue.abilities.map((ability) => ability.id),
);
const ENGINE_CASTABLE = Object.freeze(
  ABILITY_DEFINITIONS.map((definition) => definition.id),
);
const ENGINE_TALENT_GRANTED = Object.freeze([...talentGrantedAbilities]);
const auraList = Object.values(AURAS);
const ENGINE_AURAS = Object.freeze(
  auraList.filter((aura) => aura.target === "self").map((aura) => aura.id),
);
const ENGINE_DEBUFFS = Object.freeze(
  Object.fromEntries(
    auraList
      .filter((aura) => aura.target === "target")
      .map((aura) => [aura.id, aura.maxStacks]),
  ),
);

// What a bad value is, for a message: null, the string itself, or its type.
function described(value) {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string") {
    return `the string ${JSON.stringify(value)}`;
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (typeof value === "object" && !isOrdinaryObject(value)) {
    return withArticle(builtinTag(value));
  }
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

// A context's list of ability ids (#207) as a frozen array: `fallback` when it
// is left out (undefined), else a copy of an array or a Set of id strings.
// Anything else is a TypeError naming the function (`where`), the field and
// what was given, so a string is refused, not spread into its characters, and
// null or {} do not fail later as "not iterable". js/rotation-warnings.js
// reads its lists through this too.
export function idList(where, field, given, fallback, kind = "ability") {
  // null is taken as absent, as the other lists' `??` takes it (Kira's QA
  // on #215): it must not throw before the rotation's own errors come back.
  if (given === undefined || given === null) {
    return fallback;
  }
  if (!Array.isArray(given) && !(given instanceof Set)) {
    throw new TypeError(
      `${where}: ${field} must be an array or a Set of ${kind} ids, not ${described(given)}.`,
    );
  }
  const list = [...given];
  const bad = list.findIndex((id) => typeof id !== "string");
  if (bad !== -1) {
    throw new TypeError(
      `${where}: ${field} must hold ${kind} id strings, not ${described(list[bad])}.`,
    );
  }
  return Object.freeze(list);
}

// A context (validateRotation's, rotationWarnings') as an object to read:
// none, undefined or null, is the engine's; anything else that is not an
// ordinary object (a string, an array, a Set, a Map, a WeakMap) is a
// TypeError naming `where` (#210). A Map (#238 QA), a WeakMap or another
// built-in (#248 QA) is refused as its debuffs are: its contents are not properties,
// so read as an object it would quietly be the defaults.
export function contextObject(where, given) {
  if (given === undefined || given === null) {
    return {};
  }
  if (!isOrdinaryObject(given)) {
    throw new TypeError(
      `${where}: the context must be an object, not ${described(given)}.`,
    );
  }
  return given;
}

// The debuffs a context gives: the engine's when left out (undefined or
// null), else an object of debuff id to its most stacks (#210).
function debuffMap(given) {
  if (given === undefined || given === null) {
    return ENGINE_DEBUFFS;
  }
  if (!isOrdinaryObject(given)) {
    throw new TypeError(
      `rotationContext: debuffs must be an object of debuff id to its most stacks, not ${described(given)}.`,
    );
  }
  return given;
}

// The ids and debuffs a rotation is checked against. Each list is read
// through idList (an array or a Set, #210), so a Set works wherever the
// validator reads it and a string is refused, not spread.
export function rotationContext(context) {
  const given = contextObject("rotationContext", context);
  const list = (field, fallback, kind) =>
    idList("rotationContext", field, given[field], fallback, kind);
  return {
    abilities: list("abilities", ENGINE_ABILITIES),
    castable: list("castable", ENGINE_CASTABLE),
    auras: list("auras", ENGINE_AURAS, "aura"),
    debuffs: debuffMap(given.debuffs),
    talentGrantedAbilities: idList(
      "rotationContext",
      "talentGrantedAbilities",
      given.talentGrantedAbilities,
      ENGINE_TALENT_GRANTED,
    ),
  };
}

const POOL_MAX = Object.freeze(
  Object.fromEntries(
    RESOURCE_DEFINITIONS.map((definition) => [
      definition.id,
      { max: k(definition.max), whole: definition.whole === true },
    ]),
  ),
);

// Which param of each type names something, from CONDITION_PARAMS (#214):
// the id param and what it names (its `of`). An "ability" must be an ability
// the rogue casts; an "aura" a self buff; a "debuff" a target debuff.
const ID_PARAM = Object.freeze(
  Object.fromEntries(
    Object.entries(CONDITION_PARAMS).flatMap(([type, params]) =>
      Object.entries(params)
        .filter(([, spec]) => spec.kind === "id")
        .map(([name, spec]) => [type, Object.freeze({ name, of: spec.of })]),
    ),
  ),
);

// Types whose `value` is seconds of fight time. A negative time is never
// reached, so a comparison with one is a mistake: "at least -2 s" always holds
// and "below -2 s" never does.
const SECONDS = Object.freeze([
  "auraRemaining",
  "debuffRemaining",
  "fightTime",
  "fightTimeRemaining",
  "energyToCap",
]);

const list = (ids) => ids.join(", ");

function abilityIdError(id, path, context) {
  if (!context.abilities.includes(id)) {
    return rotationError(
      "unknownAbility",
      path,
      `${describeValue(id)} is not an ability in the spell data. The rogue casts: ${list(context.castable)}.`,
    );
  }
  if (!context.castable.includes(id)) {
    return rotationError(
      "notCastYet",
      path,
      `${describeValue(id)} is a rogue spell the engine does not cast yet. The rogue casts: ${list(context.castable)}.`,
    );
  }
  return null;
}

function auraIdError(id, of, path, context) {
  if (of === "aura" && !context.auras.includes(id)) {
    const isDebuff = Object.hasOwn(context.debuffs, id);
    return isDebuff
      ? rotationError(
          "debuffAsBuff",
          path,
          `${describeValue(id)} is a debuff on the target; use debuffActive, debuffRemaining or debuffStacks for it. Self buffs: ${list(context.auras)}.`,
        )
      : rotationError(
          "notSelfBuff",
          path,
          `${describeValue(id)} is not a self buff. Self buffs: ${list(context.auras)}.`,
        );
  }
  if (of === "debuff" && !Object.hasOwn(context.debuffs, id)) {
    const isBuff = context.auras.includes(id);
    return isBuff
      ? rotationError(
          "buffAsDebuff",
          path,
          `${describeValue(id)} is a self buff; use auraActive or auraRemaining for it. Target debuffs: ${list(Object.keys(context.debuffs))}.`,
        )
      : rotationError(
          "notDebuff",
          path,
          `${describeValue(id)} is not a debuff on the target. Target debuffs: ${list(Object.keys(context.debuffs))}.`,
        );
  }
  return null;
}

// The ids and numbers of a condition that is already the right shape.
function conditionMeaningErrors(condition, where, context) {
  const { type } = condition;
  const errors = [];
  const idParam = ID_PARAM[type];
  if (idParam !== undefined) {
    const { name, of } = idParam;
    const path = `${where}.${name}`;
    const error =
      of === "ability"
        ? abilityIdError(condition[name], path, context)
        : auraIdError(condition[name], of, path, context);
    if (error !== null) {
      errors.push(error);
    }
  }
  if (!Object.hasOwn(condition, "value")) {
    return errors;
  }
  const { value } = condition;
  const path = `${where}.value`;
  const pool = type === "comboPoints" ? "comboPoints" : condition.resource;
  if (Object.hasOwn(POOL_MAX, pool)) {
    const { max, whole } = POOL_MAX[pool];
    if (whole && !Number.isInteger(value)) {
      errors.push(
        rotationError(
          "notWhole",
          path,
          `The value must be a whole number for ${pool}, got ${describeValue(value)}.`,
          { resource: pool },
        ),
      );
    }
    if (value < 0 || value > max) {
      errors.push(
        rotationError(
          "outOfRange",
          path,
          `The value must be between 0 and ${max} for ${pool}, got ${describeValue(value)}.`,
          { resource: pool, max },
        ),
      );
    }
  } else if (SECONDS.includes(type) && value < 0) {
    errors.push(
      rotationError(
        "negativeSeconds",
        path,
        `The value is seconds and must be 0 or more, got ${describeValue(value)}.`,
      ),
    );
  } else if (type === "debuffStacks") {
    const max = context.debuffs[condition.debuff];
    if (!Number.isInteger(value) || value < 0) {
      errors.push(
        rotationError(
          "badStacks",
          path,
          `The value is a stack count and must be a whole number, 0 or more, got ${describeValue(value)}.`,
        ),
      );
    } else if (max !== undefined && value > max) {
      errors.push(
        rotationError(
          "tooManyStacks",
          path,
          `The value is ${describeValue(value)} stacks but ${describeValue(condition.debuff)} stacks to at most ${max}.`,
          { max },
        ),
      );
    }
  }
  return errors;
}

// Rule 5 (issues #155 and #188). A rule that casts an ability a talent grants
// must hold only when the build has the talent, so it needs a condition on that
// same ability that says so. Which condition types count:
//
//   STRICT        only abilityGranted. Cold Blood, as since #155 (James's
//                 decision in #201).
//   TRANSITIONAL  abilityGranted or abilityUnlocked. Every other talent
//                 ability, until issue #199: the default rotation and the
//                 combat-swords preset guard Blade Flurry and Adrenaline Rush
//                 with abilityUnlocked. Since #199 the engine passes over a
//                 talent ability the fight lacks, with no build too
//                 (host.usable), so the guard no longer decides a cast; the
//                 list stays as it is, and whether to tighten it is its own
//                 change.
//
// A rule with no such guard is an error, not a warning. Which abilities this
// covers comes from the data (context.talentGrantedAbilities), not from a list
// here, so a talent that grants a new ability is covered when it is added.
const STRICT = Object.freeze(["abilityGranted"]);
const TRANSITIONAL = Object.freeze(["abilityGranted", "abilityUnlocked"]);
const STRICT_TALENT_ABILITIES = Object.freeze(["cold-blood"]);
const guardTypes = (id) =>
  STRICT_TALENT_ABILITIES.includes(id) ? STRICT : TRANSITIONAL;

const guardText = (type, id) => `{ "type": "${type}", "ability": "${id}" }`;

// How a message writes an ability: its display name from the catalogue and
// then its id, "Cold Blood (cold-blood)", or the id alone when the catalogue has
// no name for it. Output only: nothing reads the name back or tests it.
export function abilityLabel(id) {
  const name = abilityCatalogue.get(id)?.name;
  return name === undefined ? id : `${name} (${id})`;
}

function talentGuardError(rule, path, context) {
  const id = rule.action;
  if (!context.talentGrantedAbilities.includes(id)) {
    return null;
  }
  const types = guardTypes(id);
  // A condition that is not an object (already an error of its own) guards
  // nothing; it must not stop the check.
  const guarded = rule.conditions.some(
    (condition) =>
      condition !== null &&
      typeof condition === "object" &&
      types.includes(condition.type) &&
      condition.ability === id,
  );
  if (guarded) {
    return null;
  }
  const wanted = types.map((type) => guardText(type, id)).join(" or ");
  return rotationError(
    "talentGuard",
    `${path}.conditions`,
    `${abilityLabel(id)} comes from a talent, so its rule needs a talent check. Add ${wanted} to its conditions.`,
    { ability: id },
  );
}

// Every error in a rotation, as { code, path, message, ...data }
// (rotationError, #212), in reading order. An empty list means the rotation is
// valid. See the top of this file for the checks.
export function validateRotation(rotation, context) {
  const top = rotationTopShape(rotation);
  if (top.stop) {
    return top.errors;
  }
  const where = rotationContext(context);
  const errors = [...top.errors];
  const { rules } = top;
  if (rules === null) {
    return errors;
  }
  if (rules.length === 0) {
    errors.push(
      rotationError(
        "noRules",
        "rules",
        "There are no rules: a rotation needs at least one rule, or it never casts anything.",
      ),
    );
    return errors;
  }
  rules.forEach((rule, index) => {
    const path = `rules[${index}]`;
    const shape = ruleShape(rule, path);
    errors.push(...shape.errors);
    // Conditions that cannot be read skip the rule. A bad action skips only
    // the checks that need it, the action id and the talent guard: the
    // conditions are still checked (Kira's QA on #215).
    if (!shape.conditionsReadable) {
      return;
    }
    if (shape.actionReadable) {
      const action = abilityIdError(rule.action, `${path}.action`, where);
      if (action !== null) {
        errors.push(action);
      }
    }
    rule.conditions.forEach((condition, at) => {
      const here = `${path}.conditions[${at}]`;
      const shapeOfCondition = conditionShapeErrors(condition, here);
      if (shapeOfCondition.length > 0) {
        errors.push(...shapeOfCondition);
        return;
      }
      const shaped = conditionErrors(condition, here);
      errors.push(
        ...(shaped.length > 0
          ? shaped
          : conditionMeaningErrors(condition, here, where)),
      );
    });
    const guard = shape.actionReadable
      ? talentGuardError(rule, path, where)
      : null;
    if (guard !== null) {
      errors.push(guard);
    }
  });
  return errors;
}

// validateRotation as strings, each the path and then the message
// (formatError). An empty list means the rotation is valid.
export function rotationProblems(rotation, context) {
  return formatErrors(validateRotation(rotation, context));
}

// Returns the rotation when it is valid. Otherwise it throws a RangeError
// whose message lists every error, one per line, as rotationProblems does.
export function assertValidRotation(rotation, context) {
  const problems = rotationProblems(rotation, context);
  if (problems.length > 0) {
    throw new RangeError(`Bad rotation:\n${problems.join("\n")}`);
  }
  return rotation;
}
