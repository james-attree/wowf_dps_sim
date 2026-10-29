import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { abilityCatalogue } from "./abilities.js";
import { CONDITION_PARAMS, compareNumbers } from "./rotation-conditions.js";
import { rotationError } from "./rotation-schema.js";
import {
  abilityLabel,
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
//      grants. It always holds, so it does nothing (one per such condition).
//   starves  An on-GCD rule whose conditions always hold (none, or only the
//      cheap cases of alwaysHolds) that has an on-GCD rule below it. Whenever
//      the GCD is clear it is cast or pooled for, so no on-GCD rule below it
//      is ever cast (an off-GCD rule below still is, while the GCD runs). The
//      last on-GCD rule, the usual builder, may have none. Not given to a rule
//      that has finisherNoComboPoints: one warning for one cause.
// A message names an ability by display name and id (abilityLabel, as the
// talent guard does, #203). The name is only ever written out, never compared
// or branched on.
//
// What the warnings read, as lists of ability ids. A context may give any of
// them (and the validator's own context fields); what it leaves out is the
// engine's:
//
//   finishers  the abilities that spend combo points (ability-data `spend`)
//   cooldowns  the abilities with a cooldown (their constants row's
//              `cooldown` is above 0)
//   onGcd      the abilities whose cast starts the GCD (the catalogue's
//              startsGcd, abilities.offGcd)
//
// grantedNotTalent reads the validator's talentGrantedAbilities
// (rotationContext), so a context gives the same list to both.
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

export function warningContext(given = {}) {
  return {
    finishers: given.finishers ?? ENGINE_FINISHERS,
    cooldowns: given.cooldowns ?? ENGINE_COOLDOWNS,
    onGcd: given.onGcd ?? ENGINE_ON_GCD,
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
// rules below wait too, or, for the last rule, there are none to hold back
// (#210's QA: "every rule below it" read wrong on a last rule).
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

function sameRuleKey(rule) {
  return JSON.stringify([
    rule.action,
    rule.conditions.map(conditionKey).sort(),
  ]);
}

function finisherWarning(rule, path, hasBelow, context) {
  if (
    !context.finishers.includes(rule.action) ||
    rule.conditions.some(needsComboPoint)
  ) {
    return null;
  }
  const at = rule.conditions.findIndex(onComboPoints);
  const lacks =
    at >= 0
      ? "its comboPoints condition does not need a combo point"
      : "its rule has no comboPoints condition";
  const example = conditionText({
    type: "comboPoints",
    op: ">=",
    value: k("rotation.finisherComboPoints"),
  });
  return rotationError(
    "finisherNoComboPoints",
    `${path}.conditions`,
    `${abilityLabel(rule.action)} is a finisher, but ${lacks}. It is cast at one combo point, and with none it can't be cast, so ${heldBack(hasBelow)}. Add a comboPoints condition, such as ${example}.`,
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
    `${abilityLabel(id)} has a cooldown and starts the global cooldown, but its rule has no cooldownReady check. While it is on cooldown ${heldBack(hasBelow)}. Add ${wanted} to its conditions.`,
    { ability: id },
  );
}

function grantedWarnings(rule, path, talentGranted) {
  const warnings = [];
  rule.conditions.forEach((condition, at) => {
    if (
      condition.type === "abilityGranted" &&
      !talentGranted.includes(condition.ability)
    ) {
      warnings.push(
        rotationError(
          "grantedNotTalent",
          `${path}.conditions[${at}]`,
          `No talent grants ${abilityLabel(condition.ability)}, so this abilityGranted check always holds and does nothing. Remove it.`,
          { ability: condition.ability, condition: at },
        ),
      );
    }
  });
  return warnings;
}

// `duplicates` holds the indexes of the rules that get duplicateRule; they
// are never reached, so they are not counted as starved.
function starvesWarning(rules, index, path, duplicates, context) {
  const rule = rules[index];
  if (
    !rule.conditions.every(alwaysHolds) ||
    !context.onGcd.includes(rule.action)
  ) {
    return null;
  }
  const below = [];
  for (let other = index + 1; other < rules.length; other += 1) {
    if (context.onGcd.includes(rules[other].action) && !duplicates.has(other)) {
      below.push(other);
    }
  }
  if (below.length === 0) {
    return null;
  }
  const reason = rule.conditions.length === 0 ? "noConditions" : "alwaysHolds";
  const lacks =
    reason === "noConditions"
      ? "its rule has no conditions"
      : "its rule's conditions always hold";
  const names = joined([
    ...new Set(below.map((other) => abilityLabel(rules[other].action))),
  ]);
  const starved =
    below.length === 1
      ? `The rule below it for ${names} never casts. Give it conditions or move it below that rule.`
      : `The ${below.length} rules below it for ${names} never cast. Give it conditions or move it below them.`;
  return rotationError(
    "starves",
    path,
    `${abilityLabel(rule.action)} starts the global cooldown and ${lacks}, so it is cast or waited for whenever the global cooldown is clear. ${starved}`,
    { ability: rule.action, below: Object.freeze(below), reason },
  );
}

export function rotationWarnings(rotation, context = {}) {
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
    const key = sameRuleKey(rule);
    if (first.has(key)) {
      same.set(index, first.get(key));
    } else {
      first.set(key, index);
    }
  });
  const duplicates = new Set(same.keys());
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
    const hasBelow = index < rules.length - 1;
    const finisher = finisherWarning(rule, path, hasBelow, given);
    for (const warning of [
      finisher,
      cooldownWarning(rule, path, hasBelow, given),
      ...grantedWarnings(rule, path, talentGrantedAbilities),
      finisher === null
        ? starvesWarning(rules, index, path, duplicates, given)
        : null,
    ]) {
      if (warning !== null) {
        warnings.push(warning);
      }
    }
  });
  return warnings;
}
