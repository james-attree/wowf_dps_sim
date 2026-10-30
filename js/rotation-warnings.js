import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { abilityCatalogue } from "./abilities.js";
import { CONDITION_PARAMS, compareNumbers } from "./rotation-conditions.js";
import { rotationError } from "./rotation-schema.js";
import {
  abilityLabel,
  contextObject,
  idList,
  rotationContext,
  validateRotation,
} from "./rotation-validator.js";

// Rotation warnings (issue #189): pooling traps in a rotation that is valid.
// The interpreter (js/rotation-interpreter.js) holds the walk at an on-GCD
// rule whose conditions hold but which cannot be cast, by design (the #183
// review). A rule that holds when its ability cannot be cast therefore stops
// every rule below it. These warnings point at the rules that do that by
// accident. They are advice, never a refusal: validateRotation is unchanged,
// a rotation with warnings still imports and runs, and nothing here changes
// what a fight casts.
//
// rotationWarnings(rotation, context) returns every warning as a frozen
// { code, path, message, ...data }, like the validator's errors (#214): the
// code says which trap, the path where (`rules[2].conditions`), and the
// message what, without saying where (the message contract; formatError in
// js/rotation-schema.js writes the path in front). An empty list means no
// trap was found. A rotation the validator refuses gets [] here: its errors
// come first.
//
// It warns, per rule, in rule order (docs/rotation.md, "Warnings", has the
// codes and their data):
//   duplicateRule  The rule is the same as an earlier one, once both are
//      normalised (sameRuleKey): it is never reached. This is the only warning
//      such a rule gets, and it is left out of every starves `below`.
//   finisherNoComboPoints  A finisher (it spends combo points) with no combo
//      points condition that needs a combo point. A `resource` condition on
//      comboPoints counts, as a comboPoints one does. It is cast with one
//      combo point, and with none it holds back the rules below.
//   cooldownNotChecked  An on-GCD ability with a cooldown and no
//      cooldownReady condition for it. While it is on cooldown it holds back
//      the rules below.
//   grantedNotTalent  An abilityGranted condition on an ability no talent
//      grants. The fight grants only talent and host abilities (Rogue), so it
//      is never true and the rule never casts (Kira's QA on #216; one per such
//      condition). A rule that never casts holds nothing back: it gets no
//      other warning, and it is not counted as starved by a rule above it.
//   unlockedNotTalent  An abilityUnlocked condition on an ability no talent
//      grants. Only a talent ability can be locked, so it is always true and
//      does nothing (one per such condition).
//   duplicateCondition  A condition the same as an earlier one of its rule
//      (conditionKey): it changes nothing (one per repeat; an
//      unlockedNotTalent one has that warning instead, #215).
//
// duplicateRule compares rules as sameRuleKey does, less what changes
// nothing: a repeated condition counts once and an unlockedNotTalent one
// not at all (Kira's QA on #216), so SS() then SS(abilityUnlocked SS) is one
// rule twice. sameRuleKey itself, which draftEdited uses, is unchanged.
//   starves  An on-GCD rule whose conditions always hold (none, or only the
//      cheap cases of alwaysHolds and unlockedNotTalent checks, which are
//      always true) that has an on-GCD rule below it. Whenever the GCD is
//      clear it is cast or pooled for, so no on-GCD rule below it
//      is ever cast (an off-GCD rule below still is, while the GCD runs). The
//      last on-GCD rule, the usual builder, may have none. Not given to a
//      finisher that has finisherNoComboPoints and no rule above it that can
//      cast on the GCD: it waits at 0 combo points, one warning for one cause
//      (#207). With such a rule above to build points it does cast, and does
//      starve the rules below, so it gets both (Kira's QA on #216).
// The wording is Fran's (issue #207), with #214's message contract.
// A message names an ability by display name and id (abilityLabel, as the
// talent guard does, #203). The name is only ever written out, never compared
// or branched on.
//
// What the warnings read, as lists of ability ids. A context may give any of
// them (and the validator's own context fields) as an array or a Set of ids;
// what it leaves out is the engine's. Anything else (a string, null, {}) is a
// TypeError that says what was given (idList, #207):
//
//   finishers  the abilities that spend combo points (ability-data `spend`)
//   cooldowns  the abilities with a cooldown (their constants row's
//              `cooldown` is above 0)
//   onGcd      the abilities whose cast starts the GCD (the catalogue's
//              startsGcd, abilities.offGcd)
//
// grantedNotTalent and unlockedNotTalent read the validator's
// talentGrantedAbilities (rotationContext), so a context gives the same list
// to both.
//
// This module is pure: no DOM, no clock, no random numbers.
const ENGINE_FINISHERS = Object.freeze(
  ABILITY_DEFINITIONS.filter(
    (definition) => definition.spend?.resource === "comboPoints",
  ).map((definition) => definition.id),
);
const ENGINE_COOLDOWNS = Object.freeze(
  ABILITY_DEFINITIONS.filter(
    (definition) => (k(definition.row).cooldown ?? 0) > 0,
  ).map((definition) => definition.id),
);
const ENGINE_ON_GCD = Object.freeze(
  ABILITY_DEFINITIONS.filter(
    (definition) => abilityCatalogue.get(definition.id)?.startsGcd === true,
  ).map((definition) => definition.id),
);

export function warningContext(context) {
  const given = contextObject("warningContext", context);
  const list = (field, fallback) =>
    idList("warningContext", field, given[field], fallback);
  return {
    finishers: list("finishers", ENGINE_FINISHERS),
    cooldowns: list("cooldowns", ENGINE_COOLDOWNS),
    onGcd: list("onGcd", ENGINE_ON_GCD),
  };
}

const conditionText = (fields) =>
  `{ ${Object.entries(fields)
    .map(([key, value]) => `"${key}": ${JSON.stringify(value)}`)
    .join(", ")} }`;

// "A", "A and B", "A, B and C".
const joined = (items) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// A condition on combo points: the comboPoints type, or a resource condition
// on the comboPoints pool, which reads the same number (#210's QA).
const onComboPoints = (condition) =>
  condition.type === "comboPoints" ||
  (condition.type === "resource" && condition.resource === "comboPoints");

// A combo points condition that fails at 0 combo points: the rule needs at
// least one (`comboPoints >= 0` does not, and hides nothing).
const needsComboPoint = (condition) =>
  onComboPoints(condition) && !compareNumbers(condition.op, 0, condition.value);

// Types whose number is never below 0. `>=` 0 (or less) on one holds always,
// so the condition holds back nothing (`fightTime >= 0`). A `>` never does:
// the validator refuses a value below 0. Only these cheap cases are caught; a
// rule that holds always by other means is not.
const NEVER_NEGATIVE = new Set([
  "comboPoints",
  "resource",
  "fightTime",
  "fightTimeRemaining",
]);
const alwaysHolds = (condition) =>
  NEVER_NEGATIVE.has(condition.type) &&
  condition.op === ">=" &&
  condition.value <= 0;

// What a rule waiting at its ability does to the rest of the rotation: the
// rules below wait too, or, with no on-GCD rule below that can cast, there
// are none to hold back (#210's QA: "every rule below it" read wrong on a
// last rule; Kira's on #216: nor on one with only off-GCD rules below).
const heldBack = (hasBelow) =>
  hasBelow ? "it holds back every rule below it" : "the rotation waits at it";

// A rule as a string that is the same for two rules exactly when one can
// never do anything the other does not (#214, duplicateRule): the action and
// the conditions in any order, each with its keys in any order and with a
// param that is written out at its default (`active: true`, `ready: true`,
// CONDITION_PARAMS) left out.
function conditionKey(condition) {
  const params = CONDITION_PARAMS[condition.type];
  const kept = Object.keys(condition)
    .filter(
      (name) =>
        !(
          Object.hasOwn(params, name) &&
          Object.hasOwn(params[name], "default") &&
          condition[name] === params[name].default
        ),
    )
    .sort()
    .map((name) => [name, condition[name]]);
  return JSON.stringify(kept);
}

// Exported for draftEdited (config-form.js), which compares a draft with its preset.
export function sameRuleKey(rule) {
  return JSON.stringify([
    rule.action,
    rule.conditions.map(conditionKey).sort(),
  ]);
}

// A rule's key for duplicateRule: sameRuleKey's, with each condition once
// and the unlockedNotTalent ones left out (#215, #216).
function warningRuleKey(rule, talentGranted) {
  const kept = rule.conditions
    .filter((condition) => !unlockedNotTalent(condition, talentGranted))
    .map(conditionKey);
  return JSON.stringify([rule.action, [...new Set(kept)].sort()]);
}

// A duplicateCondition for each condition the same as an earlier one of the
// rule, in condition order (#215). An unlockedNotTalent repeat already has
// its own warning, one per condition.
function duplicateConditionWarnings(rule, path, talentGranted) {
  const seen = new Map();
  const warnings = [];
  rule.conditions.forEach((condition, at) => {
    const key = conditionKey(condition);
    if (!seen.has(key)) {
      seen.set(key, at);
      return;
    }
    if (unlockedNotTalent(condition, talentGranted)) {
      return;
    }
    warnings.push(
      rotationError(
        "duplicateCondition",
        `${path}.conditions[${at}]`,
        `This condition is the same as an earlier one in the rule for ${abilityLabel(rule.action)}, so it changes nothing. Delete it.`,
        { ability: rule.action, condition: at, same: seen.get(key) },
      ),
    );
  });
  return warnings;
}

function finisherWarning(rule, path, hasBelow, context) {
  if (
    !context.finishers.includes(rule.action) ||
    rule.conditions.some(needsComboPoint)
  ) {
    return null;
  }
  // The advice fits the case: a combo points condition that is there but
  // holds at 0 is changed, not added to.
  const at = rule.conditions.findIndex(onComboPoints);
  const lacks =
    at >= 0
      ? "its combo points condition still holds at 0 combo points"
      : "its rule has no combo points condition";
  const example = conditionText({
    type: "comboPoints",
    op: ">=",
    value: k("rotation.finisherComboPoints"),
  });
  const advice =
    at >= 0
      ? `Change it to need at least one, such as ${example}.`
      : `Add one, such as ${example}.`;
  return rotationError(
    "finisherNoComboPoints",
    `${path}.conditions`,
    `${abilityLabel(rule.action)} is a finisher, but ${lacks}. It is cast at one combo point, and with none it can't be cast, so ${heldBack(hasBelow)}. ${advice}`,
    { ability: rule.action, condition: at >= 0 ? at : null },
  );
}

function cooldownWarning(rule, path, hasBelow, context) {
  const id = rule.action;
  if (
    !context.onGcd.includes(id) ||
    !context.cooldowns.includes(id) ||
    rule.conditions.some(
      (condition) =>
        condition.type === "cooldownReady" && condition.ability === id,
    )
  ) {
    return null;
  }
  const wanted = conditionText({ type: "cooldownReady", ability: id });
  return rotationError(
    "cooldownNotChecked",
    `${path}.conditions`,
    `${abilityLabel(id)} has a cooldown and starts the global cooldown, but its rule doesn't check that it's ready. While it is on cooldown ${heldBack(hasBelow)}. Add ${wanted} to its conditions.`,
    { ability: id },
  );
}

// An abilityGranted condition on an ability no talent grants: never true.
const grantedNotTalent = (condition, talentGranted) =>
  condition.type === "abilityGranted" &&
  !talentGranted.includes(condition.ability);

// An abilityUnlocked condition on an ability no talent grants: always true.
const unlockedNotTalent = (condition, talentGranted) =>
  condition.type === "abilityUnlocked" &&
  !talentGranted.includes(condition.ability);

const TALENT_MESSAGES = {
  grantedNotTalent: (label) =>
    `${label} isn't granted by a talent, so 'is granted' is never true here and this rule never casts.`,
  unlockedNotTalent: (label) =>
    `${label} doesn't need a talent, so 'is unlocked' is always true and does nothing.`,
};

function talentWarnings(rule, path, talentGranted) {
  const warnings = [];
  rule.conditions.forEach((condition, at) => {
    for (const [code, matches] of [
      ["grantedNotTalent", grantedNotTalent],
      ["unlockedNotTalent", unlockedNotTalent],
    ]) {
      if (matches(condition, talentGranted)) {
        warnings.push(
          rotationError(
            code,
            `${path}.conditions[${at}]`,
            TALENT_MESSAGES[code](abilityLabel(condition.ability)),
            { ability: condition.ability, condition: at },
          ),
        );
      }
    }
  });
  return warnings;
}

// A condition that never holds anything back: a cheap always-true number
// (alwaysHolds), or an unlockedNotTalent check, which is always true (Scout's
// call on Kira's QA of #216).
const holdsAlways = (condition, talentGranted) =>
  alwaysHolds(condition) || unlockedNotTalent(condition, talentGranted);

function starvesWarning(rules, index, path, below, context, talentGranted) {
  const rule = rules[index];
  if (
    !rule.conditions.every((condition) =>
      holdsAlways(condition, talentGranted),
    ) ||
    !context.onGcd.includes(rule.action) ||
    below.length === 0
  ) {
    return null;
  }
  const reason = rule.conditions.length === 0 ? "noConditions" : "alwaysHolds";
  // The advice fits the case: conditions that always hold are changed, not
  // added to (#207).
  const lacks =
    reason === "noConditions"
      ? "its rule has no conditions"
      : "none of its rule's conditions can fail";
  const one = below.length === 1;
  const advice =
    reason === "noConditions"
      ? `Give it conditions or move it below ${one ? "that rule" : "them"}.`
      : "Change its conditions so they are sometimes false.";
  const names = joined([
    ...new Set(below.map((other) => abilityLabel(rules[other].action))),
  ]);
  const starved = one
    ? `The rule below it for ${names} never casts. ${advice}`
    : `The ${below.length} rules below it for ${names} never cast. ${advice}`;
  return rotationError(
    "starves",
    path,
    `${abilityLabel(rule.action)} starts the global cooldown and ${lacks}, so it is cast or waited for whenever the global cooldown is clear. ${starved}`,
    { ability: rule.action, below: Object.freeze(below), reason },
  );
}

export function rotationWarnings(rotation, context) {
  if (validateRotation(rotation, context).length > 0) {
    return [];
  }
  const given = warningContext(context);
  const { talentGrantedAbilities } = rotationContext(context);
  const { rules } = rotation;
  // The first rule with each key, and every rule that repeats one.
  const first = new Map();
  const same = new Map();
  rules.forEach((rule, index) => {
    const key = warningRuleKey(rule, talentGrantedAbilities);
    if (first.has(key)) {
      same.set(index, first.get(key));
    } else {
      first.set(key, index);
    }
  });
  // The rules that never cast: a duplicate is never reached, and a rule with
  // a grantedNotTalent condition never holds. Neither holds anything back, nor
  // is it counted as starved.
  const silent = new Set(same.keys());
  rules.forEach((rule, index) => {
    if (
      rule.conditions.some((condition) =>
        grantedNotTalent(condition, talentGrantedAbilities),
      )
    ) {
      silent.add(index);
    }
  });
  // The on-GCD rules below each rule that can cast, and whether one above can.
  const castsOnGcd = (index) =>
    !silent.has(index) && given.onGcd.includes(rules[index].action);
  const onGcdBelow = (index) =>
    rules.flatMap((rule, other) =>
      other > index && castsOnGcd(other) ? [other] : [],
    );
  const onGcdAbove = (index) =>
    rules.some((rule, other) => other < index && castsOnGcd(other));
  const warnings = [];
  rules.forEach((rule, index) => {
    const path = `rules[${index}]`;
    if (same.has(index)) {
      const earlier = same.get(index);
      warnings.push(
        rotationError(
          "duplicateRule",
          path,
          `${abilityLabel(rule.action)} is never reached: a rule above it casts it under the same conditions. Delete this one.`,
          { ability: rule.action, same: earlier },
        ),
      );
      return;
    }
    const talent = [
      ...talentWarnings(rule, path, talentGrantedAbilities),
      ...duplicateConditionWarnings(rule, path, talentGrantedAbilities),
    ];
    if (silent.has(index)) {
      warnings.push(...talent);
      return;
    }
    const below = onGcdBelow(index);
    const hasBelow = below.length > 0;
    const finisher = finisherWarning(rule, path, hasBelow, given);
    for (const warning of [
      finisher,
      cooldownWarning(rule, path, hasBelow, given),
      ...talent,
      // One warning per trap: a finisher that waits at 0 combo points with
      // nothing above to build them is told so once, not again as starving
      // the rules below. With an on-GCD rule above it does cast, and does
      // starve them.
      finisher === null || onGcdAbove(index)
        ? starvesWarning(
            rules,
            index,
            path,
            below,
            given,
            talentGrantedAbilities,
          )
        : null,
    ]) {
      if (warning !== null) {
        warnings.push(warning);
      }
    }
  });
  return warnings;
}
