import { abilityCatalogue } from "./abilities.js";
import { AURAS } from "./auras.js";
import { compareNumbers } from "./rotation-conditions.js";

// The readable form of a rotation (roadmap R4, issue #141): one line of plain
// text per rule, for the builder, a preset's description and an error report.
//
//   Sinister Strike if Energy >= 40
//   Rupture if CP >= 5
//   Slice and Dice if CP >= 5 and Slice and Dice missing or <= 3s left
//
// A rotation is ids all the way down (docs/rotation.md), and this is the one
// place that turns them into names. The names are read from the ability
// catalogue (js/abilities.js) and the aura definitions (js/auras.js) when a
// line is written, never written here, so a name stays where it is defined.
// This is a display-edge helper: the engine does not import it, and nothing
// that decides what to cast depends on it. An id with no display name is
// written as it is.
//
// The summary does not validate. It reads a rotation that has passed the shape
// check (js/rotation-schema.js) and writes a line for every rule and every
// condition type; it does not say whether an id exists or a number is in range
// (js/rotation-validator.js does). A condition type it does not know is written
// as `unknown condition "type"`, so a draft in a builder can still be shown.
// Something that is not a rotation, a rule or a condition object is a
// TypeError.
//
// This module is pure: no DOM, no clock, no random numbers.

// What a resource is called in a line. A resource without an entry is written
// by its id.
const RESOURCE_LABELS = Object.freeze({ energy: "Energy", comboPoints: "CP" });

function abilityName(id) {
  return abilityCatalogue.get(id)?.name ?? id;
}

function auraName(id) {
  return Object.values(AURAS).find((aura) => aura.id === id)?.name ?? id;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// "Energy >= 40", "CP == 5".
function resourceLine(resource, condition) {
  const label = RESOURCE_LABELS[resource] ?? resource;
  return `${label} ${condition.op} ${condition.value}`;
}

// "missing or <= 3s left" for a comparison that a thing that is not there (0 s
// left) satisfies, and "has >= 10s left" for one it does not.
function remainingLine(subject, condition) {
  const missingCounts = compareNumbers(condition.op, 0, condition.value);
  return missingCounts
    ? `${subject} missing or ${condition.op} ${condition.value}s left`
    : `${subject} has ${condition.op} ${condition.value}s left`;
}

// Each type's words. `active` and `ready` are true when they are left out.
const LINES = {
  resource: (c) => resourceLine(c.resource, c),
  comboPoints: (c) => resourceLine("comboPoints", c),
  auraActive: (c) =>
    `${auraName(c.aura)} is ${(c.active ?? true) ? "up" : "not up"}`,
  auraRemaining: (c) => remainingLine(auraName(c.aura), c),
  debuffActive: (c) =>
    `${auraName(c.debuff)} is ${(c.active ?? true) ? "up" : "not up"} on the target`,
  debuffRemaining: (c) =>
    remainingLine(`${auraName(c.debuff)} on the target`, c),
  debuffStacks: (c) =>
    `${auraName(c.debuff)} on the target has ${c.op} ${c.value} stacks`,
  cooldownReady: (c) =>
    `${abilityName(c.ability)} is ${(c.ready ?? true) ? "ready" : "on cooldown"}`,
  fightTime: (c) => `fight time ${c.op} ${c.value}s`,
  fightTimeRemaining: (c) => `fight time left ${c.op} ${c.value}s`,
  energyToCap: (c) => `time to energy cap ${c.op} ${c.value}s`,
  abilityGranted: (c) => `${abilityName(c.ability)} is granted`,
  abilityUnlocked: (c) =>
    `${abilityName(c.ability)} is not locked by the build`,
};

// One condition as text: "CP >= 5", "Slice and Dice is up".
export function summarizeCondition(condition) {
  if (!isObject(condition)) {
    throw new TypeError("summarizeCondition needs a condition object.");
  }
  const line = Object.hasOwn(LINES, condition.type)
    ? LINES[condition.type]
    : undefined;
  return line === undefined
    ? `unknown condition ${JSON.stringify(condition.type)}`
    : line(condition);
}

// One rule as a line: the ability, then "if" and its conditions joined by
// "and". A rule with no conditions is always cast when it can be.
export function summarizeRule(rule) {
  if (!isObject(rule) || !Array.isArray(rule.conditions)) {
    throw new TypeError("summarizeRule needs a rule { action, conditions }.");
  }
  const name = abilityName(rule.action);
  return rule.conditions.length === 0
    ? `${name} (always)`
    : `${name} if ${rule.conditions.map(summarizeCondition).join(" and ")}`;
}

// A whole rotation as text: its name, then a numbered line for each rule in
// priority order, highest first.
export function summarizeRotation(rotation) {
  if (!isObject(rotation) || !Array.isArray(rotation.rules)) {
    throw new TypeError("summarizeRotation needs a rotation { name, rules }.");
  }
  return [
    String(rotation.name),
    ...rotation.rules.map(
      (rule, index) => `${index + 1}. ${summarizeRule(rule)}`,
    ),
  ].join("\n");
}
