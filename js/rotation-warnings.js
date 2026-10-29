import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { abilityCatalogue } from "./abilities.js";
import { compareNumbers } from "./rotation-conditions.js";
import { abilityLabel, validateRotation } from "./rotation-validator.js";

// Rotation warnings (issue #189): pooling traps in a rotation that is valid.
// The interpreter (js/rotation-interpreter.js) holds the walk at an on-GCD
// rule whose conditions hold but which cannot be cast, by design (the #183
// review). A rule that holds when its ability cannot be cast therefore stops
// every rule below it. These warnings point at the rules that do that by
// accident. They are advice, never a refusal: validateRotation is unchanged,
// a rotation with warnings still imports and runs, and nothing here changes
// what a fight casts.
//
// rotationWarnings(rotation, context) returns every warning as
// { path, message }, like the validator's errors: the path says where
// (`rules[2].conditions`), and the message names the same place and reads on
// its own. An empty list means no trap was found. A rotation the validator
// refuses gets [] here: its errors come first.
//
// It warns, per rule, in rule order:
//   1. A finisher (it spends combo points) with no comboPoints condition. It is
//      cast with one combo point, and with none it holds back the rules below.
//   2. An on-GCD ability with a cooldown and no cooldownReady condition for it.
//      While it is on cooldown it holds back the rules below.
//   3. An on-GCD rule with no conditions that has an on-GCD rule below it.
//      Whenever the GCD is clear it is cast or pooled for, so no on-GCD rule
//      below it is ever reached (an off-GCD rule below still is, while the GCD
//      runs). The last on-GCD rule, the usual builder, may have none.
// A message names the ability by display name and id (abilityLabel, as the
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

// A comboPoints condition that fails at 0 combo points: the rule needs at
// least one (`comboPoints >= 0` does not, and hides nothing).
const needsComboPoint = (condition) =>
  condition.type === "comboPoints" &&
  !compareNumbers(condition.op, 0, condition.value);

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

function finisherWarning(rule, path, context) {
  if (
    !context.finishers.includes(rule.action) ||
    rule.conditions.some(needsComboPoint)
  ) {
    return null;
  }
  const lacks = rule.conditions.some(({ type }) => type === "comboPoints")
    ? "its comboPoints condition does not need a combo point"
    : "its rule has no comboPoints condition";
  const example = conditionText({
    type: "comboPoints",
    op: ">=",
    value: k("rotation.finisherComboPoints"),
  });
  return {
    path: `${path}.conditions`,
    message: `${path}: ${abilityLabel(rule.action)} is a finisher, but ${lacks}. It is cast at one combo point, and with none it can't be cast, so it holds back every rule below it. Add a comboPoints condition, such as ${example}.`,
  };
}

function cooldownWarning(rule, path, context) {
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
  return {
    path: `${path}.conditions`,
    message: `${path}: ${abilityLabel(id)} has a cooldown and starts the global cooldown, but its rule has no cooldownReady check. While it is on cooldown it holds back every rule below it. Add ${wanted} to its conditions.`,
  };
}

function starvesWarning(rules, index, path, context) {
  const rule = rules[index];
  if (
    !rule.conditions.every(alwaysHolds) ||
    !context.onGcd.includes(rule.action)
  ) {
    return null;
  }
  const lacks =
    rule.conditions.length === 0
      ? "its rule has no conditions"
      : "its rule's conditions always hold";
  const below = [
    ...new Set(
      rules
        .slice(index + 1)
        .map((other) => other.action)
        .filter((id) => context.onGcd.includes(id)),
    ),
  ];
  if (below.length === 0) {
    return null;
  }
  return {
    path,
    message: `${path}: ${abilityLabel(rule.action)} starts the global cooldown and ${lacks}, so it is cast or waited for whenever the global cooldown is clear. These rules below it are never cast: ${below.map(abilityLabel).join(", ")}. Give it conditions or move it below them.`,
  };
}

export function rotationWarnings(rotation, context = {}) {
  if (validateRotation(rotation, context).length > 0) {
    return [];
  }
  const given = warningContext(context);
  const warnings = [];
  rotation.rules.forEach((rule, index) => {
    const path = `rules[${index}]`;
    for (const warning of [
      finisherWarning(rule, path, given),
      cooldownWarning(rule, path, given),
      starvesWarning(rotation.rules, index, path, given),
    ]) {
      if (warning !== null) {
        warnings.push(warning);
      }
    }
  });
  return warnings;
}
