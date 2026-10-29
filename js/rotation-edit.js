import { k } from "../data/constants.js";
import { abilityCatalogue } from "./abilities.js";
import { CONDITION_PARAMS } from "./rotation-conditions.js";
import { ROTATION_SCHEMA_VERSION } from "./rotation-schema.js";
import { rotationContext } from "./rotation-validator.js";
import { warningContext } from "./rotation-warnings.js";
import { talentGrantedAbilities } from "./talent-build.js";

// The rotation builder's edits (Phase 4, #217, roadmap task U7; Fran's spec
// in the U7 design folder, wiring note 1). Pure: every function takes plain
// data and returns new arrays and objects, never changing what it was given,
// and nothing here reads the DOM or a clock. js/rotation-builder.js calls
// these; the tests use the presets.
//
// A draft is the rotation the builder edits:
//
//   { name, rules: [{ uid, action, conditions: [{ uid, type, ...params }] }],
//     raw: { condition uid: the number text typed in its value field } }
//
// The uids only tell rules and conditions apart while they move. The raw text
// keeps what was typed ("4." or "") as the field shows it. Neither reaches
// the rotation: draftRotation() strips them, and the validator, the warnings
// and the config only ever see that.
//
// Every number here comes from data/constants.js (rotation.builderDefaults
// and the rotation limits), and every id from the ability data, the aura and
// debuff definitions (rotationContext) and the talent effects.

// The condition types whose `ability` names the rule's own ability: they
// follow it when the rule's ability changes (D8, retarget).
const SELF_TYPES = Object.freeze([
  "cooldownReady",
  "abilityGranted",
  "abilityUnlocked",
]);

// The talent checks (the validator's talent guard, #199/#203).
const GUARD_TYPES = Object.freeze(["abilityGranted", "abilityUnlocked"]);

export const isGuard = (condition) => GUARD_TYPES.includes(condition.type);

// What the builder needs to know about an ability: whether a talent grants it,
// whether it starts the global cooldown, has a cooldown or is a finisher, and
// its energy cost (0 when it costs none).
export function abilityFacts(id) {
  const ability = abilityCatalogue.get(id);
  const given = warningContext();
  const cost = ability?.cost;
  return Object.freeze({
    id,
    name: ability?.name ?? id,
    talent: talentGrantedAbilities.has(id),
    onGcd: given.onGcd.includes(id),
    cooldown: given.cooldowns.includes(id),
    finisher: given.finishers.includes(id),
    energy: cost?.resource === "energy" ? cost.amount : 0,
    requires: Object.freeze([...(ability?.requires ?? [])]),
  });
}

// The abilities a rule can cast, in the order the validator knows them.
export function castableAbilities() {
  return [...rotationContext().castable];
}

// The rotation a draft describes: what the validator, the warnings and the
// config see. No uids and no raw text.
export function draftRotation(draft) {
  return {
    schemaVersion: ROTATION_SCHEMA_VERSION,
    name: draft.name,
    rules: draft.rules.map((rule) => ({
      action: rule.action,
      conditions: rule.conditions.map(withoutUid),
    })),
  };
}

function withoutUid(condition) {
  return Object.fromEntries(
    Object.entries(condition).filter(([key]) => key !== "uid"),
  );
}

// A draft of a rotation, each rule and condition with a uid from `nextUid`.
export function draftOf(rotation, nextUid) {
  return {
    name: String(rotation.name),
    rules: rotation.rules.map((rule) => ({
      uid: nextUid(),
      action: rule.action,
      conditions: rule.conditions.map((condition) => ({
        ...condition,
        uid: nextUid(),
      })),
    })),
    raw: {},
  };
}

// Rule edits. `from`, `to` and `at` are indexes into the list.
export function moveRule(rules, from, to) {
  const next = [...rules];
  const [rule] = next.splice(from, 1);
  next.splice(to, 0, rule);
  return next;
}

export function insertRule(rules, at, rule) {
  const next = [...rules];
  next.splice(at, 0, rule);
  return next;
}

export function removeRule(rules, at) {
  return rules.filter((rule, index) => index !== at);
}

// A copy of rule `at`, new uids throughout, right below it (D1).
export function duplicateRule(rules, at, nextUid) {
  return insertRule(rules, at + 1, copyRule(rules[at], nextUid));
}

// The draft's half-typed number text (`raw`, by condition uid) with the
// text of each condition of `from` copied to the same condition of `to`, a
// copyRule of it (Scout's review of #218: a copy showed NaN without it).
export function copyRawText(raw, from, to) {
  const next = { ...raw };
  from.conditions.forEach((condition, at) => {
    if (Object.hasOwn(raw, condition.uid)) {
      next[to.conditions[at].uid] = raw[condition.uid];
    }
  });
  return next;
}

// The draft's `raw` without the text of `rule`'s conditions (a deleted rule).
export function dropRawText(raw, rule) {
  const gone = new Set(rule.conditions.map((condition) => condition.uid));
  return Object.fromEntries(
    Object.entries(raw).filter(([uid]) => !gone.has(uid)),
  );
}

export function copyRule(rule, nextUid) {
  return {
    uid: nextUid(),
    action: rule.action,
    conditions: rule.conditions.map((condition) => ({
      ...condition,
      uid: nextUid(),
    })),
  };
}

// The condition a new condition of `type` starts as, for a rule that casts
// `action` (§3: a type change resets the params to these). The ids come from
// the data: the first self buff, the first debuff, the first debuff that
// stacks; the numbers from rotation.builderDefaults.
export function defaultCondition(type, action) {
  const defaults = k("rotation.builderDefaults");
  const context = rotationContext();
  const facts = abilityFacts(action);
  const [aura] = context.auras;
  const debuffs = Object.keys(context.debuffs);
  const stacking =
    debuffs.find((id) => context.debuffs[id] > 1) ?? debuffs.at(-1);
  const finisherPoints = k("rotation.finisherComboPoints");
  switch (type) {
    case "resource":
      return {
        type,
        resource: "energy",
        op: ">=",
        value: facts.energy > 0 ? facts.energy : defaults.energy,
      };
    case "comboPoints":
      return { type, op: ">=", value: finisherPoints };
    case "auraActive":
      return { type, aura };
    case "auraRemaining":
      return { type, aura, op: "<", value: defaults.buffSeconds };
    case "debuffActive":
      return { type, debuff: debuffs[0] };
    case "debuffRemaining":
      return {
        type,
        debuff: debuffs[0],
        op: "<",
        value: defaults.debuffSeconds,
      };
    case "debuffStacks":
      return {
        type,
        debuff: stacking,
        op: "<",
        value: context.debuffs[stacking],
      };
    case "cooldownReady":
      return {
        type,
        ability: facts.cooldown ? action : cooldownAbilities()[0],
      };
    case "abilityGranted":
    case "abilityUnlocked":
      return { type, ability: facts.talent ? action : talentAbilities()[0] };
    case "energyToCap":
      return { type, op: "<", value: defaults.energyToCapSeconds };
    case "fightTime":
      return { type, op: ">=", value: defaults.fightTimeSeconds };
    case "fightTimeRemaining":
      return { type, op: "<", value: defaults.fightTimeLeftSeconds };
    default:
      throw new RangeError(`Unknown condition type ${JSON.stringify(type)}.`);
  }
}

// The abilities a cooldownReady condition can name: the castable ones with a
// cooldown. The ones a talent check can name: the talent abilities (Fran, Q6).
export function cooldownAbilities() {
  const { cooldowns } = warningContext();
  return castableAbilities().filter((id) => cooldowns.includes(id));
}

export function talentAbilities() {
  return castableAbilities().filter((id) => talentGrantedAbilities.has(id));
}

const onComboPoints = (condition) =>
  condition.type === "comboPoints" ||
  (condition.type === "resource" && condition.resource === "comboPoints");

// What Add condition adds (§3): CP >= 5 to a finisher with no combo points
// condition, otherwise Energy >= the ability's cost.
export function nextConditionType(rule) {
  return abilityFacts(rule.action).finisher &&
    !rule.conditions.some(onComboPoints)
    ? "comboPoints"
    : "resource";
}

// A new rule for `action`, with the checks its ability needs already in it
// (D7): the talent guard (abilityGranted, the #199 direction), cooldownReady
// for an on-GCD cooldown, and CP >= 5 for a finisher.
export function newRule(action, nextUid) {
  const facts = abilityFacts(action);
  const conditions = [];
  if (facts.talent) {
    conditions.push({ type: "abilityGranted", ability: action });
  }
  if (facts.onGcd && facts.cooldown) {
    conditions.push({ type: "cooldownReady", ability: action });
  }
  if (facts.finisher) {
    conditions.push(defaultCondition("comboPoints", action));
  }
  return {
    uid: nextUid(),
    action,
    conditions: conditions.map((condition) => ({
      ...condition,
      uid: nextUid(),
    })),
  };
}

// The rule cast `action` instead (D8). Its own cooldown and talent checks
// follow the ability; a talent guard is added when the new ability comes from
// a talent and has none, and dropped when it doesn't. Returns { rule, added }
// where added is the guard put in, or null.
export function retarget(rule, action, nextUid) {
  const facts = abilityFacts(action);
  const old = rule.action;
  let conditions = rule.conditions
    .map((condition) =>
      SELF_TYPES.includes(condition.type) && condition.ability === old
        ? { ...condition, ability: action }
        : condition,
    )
    .filter(
      (condition) =>
        facts.talent || !(isGuard(condition) && condition.ability === action),
    );
  let added = null;
  if (
    facts.talent &&
    !conditions.some(
      (condition) => isGuard(condition) && condition.ability === action,
    )
  ) {
    added = { type: "abilityGranted", ability: action, uid: nextUid() };
    conditions = [added, ...conditions];
  }
  return { rule: { ...rule, action, conditions }, added };
}

// Condition edits on one rule. Each returns the new rule.
export function addCondition(rule, condition, at = rule.conditions.length) {
  const conditions = [...rule.conditions];
  conditions.splice(at, 0, condition);
  return { ...rule, conditions };
}

export function removeCondition(rule, at) {
  return {
    ...rule,
    conditions: rule.conditions.filter((condition, index) => index !== at),
  };
}

export function replaceCondition(rule, at, condition) {
  return {
    ...rule,
    conditions: rule.conditions.map((old, index) =>
      index === at ? condition : old,
    ),
  };
}

// A number field's text that reads as a number: a plain decimal, with an
// optional sign and point ("40", "-1", "+2.5", "2.", ".5"). Hex ("0x10"),
// exponents ("1e1"), "Infinity", separators and spaces inside are not
// numbers here, though Number() reads some of them (Scout's review of #218).
const PLAIN_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

// The condition with one param set from what its control holds. A value
// field's text: empty leaves the value out (the validator then says it is
// missing), a plain decimal is the number it reads as, and anything else is
// NaN, so the validator says it is not a number. A boolean param (its CONDITION_PARAMS
// kind) reads "true"/"false", and is left out at its spec default.
export function withParam(condition, param, text) {
  const next = { ...condition };
  if (param === "value") {
    const trimmed = String(text).trim();
    if (trimmed === "") {
      delete next.value;
    } else {
      next.value = PLAIN_DECIMAL.test(trimmed) ? Number(trimmed) : Number.NaN;
    }
    return next;
  }
  const spec = CONDITION_PARAMS[condition.type]?.[param];
  if (spec?.kind === "boolean") {
    const value = text === "true" || text === true;
    if (Object.hasOwn(spec, "default") && value === spec.default) {
      delete next[param];
    } else {
      next[param] = value;
    }
    return next;
  }
  next[param] = text;
  return next;
}
