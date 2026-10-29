import { abilityCatalogue } from "./abilities.js";
import { AURAS } from "./auras.js";
import { abilityFacts } from "./rotation-edit.js";

// The rotation builder's words (Phase 4, #217; Fran's U7 spec sections 3 to
// 6, D4, D6 and D11). The spec puts this copy "in the view" (wiring note 9);
// it is here instead because a view may not import the engine (#150) and the
// copy names abilities, auras and talents from the data. js/rotation-builder.js
// builds the view model with it; the view draws only strings.
//
// Every message is chosen by its `code` and placed by its `path` (D4, section
// 5): nothing here reads or matches an engine message. A code with no short
// line falls back to the engine's own message.

export const nameOf = (id) => abilityCatalogue.get(id)?.name ?? id;

export const auraName = (id) =>
  Object.values(AURAS).find((aura) => aura.id === id)?.name ?? id;

export const count = (n, word, plural = `${word}s`) =>
  `${n} ${n === 1 ? word : plural}`;

// The condition types, by the labels and groups of section 3.
export const TYPE_LABELS = Object.freeze({
  resource: "Resource",
  comboPoints: "Combo points",
  energyToCap: "Time to energy cap",
  auraActive: "Buff is up",
  auraRemaining: "Buff time left",
  debuffActive: "Debuff is up",
  debuffRemaining: "Debuff time left",
  debuffStacks: "Debuff stacks",
  cooldownReady: "Cooldown ready",
  abilityGranted: "Talent: ability granted",
  abilityUnlocked: "Talent: ability not locked",
  fightTime: "Fight time",
  fightTimeRemaining: "Fight time left",
});

export const TYPE_GROUPS = Object.freeze([
  ["Resources", ["comboPoints", "resource", "energyToCap"]],
  ["Your buffs", ["auraActive", "auraRemaining"]],
  ["Target debuffs", ["debuffActive", "debuffRemaining", "debuffStacks"]],
  [
    "Abilities and talents",
    ["cooldownReady", "abilityGranted", "abilityUnlocked"],
  ],
  ["Fight", ["fightTime", "fightTimeRemaining"]],
]);

// The group a condition type no TYPE_GROUPS group names goes in.
export const OTHER_TYPES = "Other";

// A boolean param's control, by param name; one the table does not name is
// worded plainly (booleanText).
export const BOOLEAN_TEXT = Object.freeze({
  active: { label: "up or not", yes: "is up", no: "is not up" },
  ready: { label: "ready or not", yes: "is ready", no: "is on cooldown" },
});
export const booleanText = (param) =>
  Object.hasOwn(BOOLEAN_TEXT, param)
    ? BOOLEAN_TEXT[param]
    : { label: param, yes: "yes", no: "no" };

// D12: fight time left is a normal condition since #209.
export const TYPE_NOTES = Object.freeze({
  fightTimeRemaining:
    "Seconds left in the fight. The length is Fight length (s) on the Run bar.",
});

export const OP_TEXT = Object.freeze({
  ">=": "at least",
  ">": "more than",
  "<=": "at most",
  "<": "less than",
  "==": "exactly",
});

export const RESOURCE_LABELS = Object.freeze({
  energy: "Energy",
  comboPoints: "Combo points",
});

const SECONDS = Object.freeze([
  "auraRemaining",
  "debuffRemaining",
  "fightTime",
  "fightTimeRemaining",
  "energyToCap",
]);

// The suffix of a condition's value field and the words of its label.
export function valueUnit(condition) {
  const pool =
    condition.type === "comboPoints"
      ? "comboPoints"
      : condition.type === "resource"
        ? condition.resource
        : null;
  if (pool === "comboPoints") {
    return { unit: "CP", words: "combo points", whole: true };
  }
  if (pool === "energy") {
    return { unit: "energy", words: "energy", whole: false };
  }
  if (SECONDS.includes(condition.type)) {
    return { unit: "s", words: "seconds", whole: false };
  }
  if (condition.type === "debuffStacks") {
    return { unit: "stacks", words: "stacks", whole: true };
  }
  return { unit: "", words: "", whole: false };
}

// D11: the pooling hint on every card (chip) and in the open editor (long).
export function poolingHint(action) {
  const facts = abilityFacts(action);
  const name = facts.name;
  if (!facts.onGcd) {
    return {
      chip: "Off the GCD: skipped if not ready",
      long: `${name} is off the global cooldown. When its conditions hold but it can't be cast, the walk skips it and goes on to the next rule.`,
    };
  }
  const dagger = facts.requires.includes("dagger")
    ? " It needs a dagger in the main hand; with any other weapon the rule is passed over."
    : "";
  if (facts.energy > 0) {
    return {
      chip: `Waits for ${facts.energy} energy`,
      long: `When its conditions all hold, the walk stops here until ${name} can be cast: nothing below it is cast while it waits for ${facts.energy} energy or the global cooldown.${dagger}`,
    };
  }
  return {
    chip: "On the GCD",
    long: `When its conditions all hold, the walk stops here until ${name} can be cast: nothing below it is cast while the global cooldown runs.${dagger}`,
  };
}

// Section 1: the "New rule casts" groups. Talent abilities say so.
export function abilityGroups(ids) {
  const groups = [
    ["Builders", (f) => f.onGcd && !f.finisher && !f.cooldown],
    ["Finishers", (f) => f.finisher],
    ["Cooldowns", (f) => f.onGcd && f.cooldown && !f.finisher],
    ["Off the global cooldown", (f) => !f.onGcd],
  ];
  const facts = ids.map(abilityFacts);
  return groups
    .map(([label, test]) => ({
      label,
      options: facts.filter(test).map((f) => ({
        value: f.id,
        text: f.talent ? `${f.name} (talent)` : f.name,
      })),
    }))
    .filter((group) => group.options.length > 0);
}

// Section 5: where a path points. 0-based indexes.
const PATH =
  /^rules\[(?<rule>\d+)\](?:\.(?<part>action|conditions)(?:\[(?<condition>\d+)\](?:\.(?<param>\w+))?)?)?$/;

export function placeOf(path) {
  if (path === "name") {
    return { at: "name" };
  }
  const match = PATH.exec(path);
  if (match === null) {
    return { at: "list" };
  }
  const { part, condition, param } = match.groups;
  const rule = Number(match.groups.rule);
  if (part === "action") {
    return { at: "action", rule };
  }
  if (part === "conditions" && condition !== undefined) {
    return {
      at: "condition",
      rule,
      condition: Number(condition),
      param: param ?? null,
    };
  }
  if (part === "conditions") {
    return { at: "conditions", rule };
  }
  return { at: "rule", rule };
}

// The jump link's name: "Rule 4: Cold Blood, condition 3".
export function jumpLabel(entry, rotation) {
  const place = placeOf(entry.path);
  if (place.at === "name") {
    return "Rotation name";
  }
  if (place.at === "list") {
    return "Rules";
  }
  const rule = rotation.rules[place.rule];
  const what =
    place.at === "condition"
      ? `, condition ${place.condition + 1}`
      : place.at === "conditions"
        ? ", conditions"
        : "";
  return `Rule ${place.rule + 1}: ${nameOf(rule?.action)}${what}`;
}

const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const UNITS = Object.freeze({ comboPoints: "combo points", energy: "energy" });

// The short copy, by code (section 4).
const COPY = {
  nameEmpty: () => "Give the rotation a name.",
  nameTooLong: (entry) => `Use at most ${entry.max} characters.`,
  noRules: () =>
    "Add at least one rule: with none, the rotation never casts anything.",
  missingParam: (entry) =>
    entry.param === "value" ? "Enter a number." : `Choose a ${entry.param}.`,
  notWhole: (entry) =>
    `Use a whole number of ${UNITS[entry.resource] ?? entry.resource}.`,
  outOfRange: (entry) =>
    `Use 0 to ${entry.max} ${UNITS[entry.resource] ?? entry.resource}.`,
  negativeSeconds: () => "Use 0 seconds or more.",
  badStacks: () => "Use a whole number of stacks, 0 or more.",
  tooManyStacks: (entry) => `It stacks to at most ${entry.max}.`,
  talentGuard: (entry, rule) =>
    `${nameOf(entry.ability ?? rule?.action)} comes from a talent, so this rule needs a talent check. Without one it never casts with a build that lacks the talent, and holds back every rule below it.`,
  finisherNoComboPoints: (entry, rule) =>
    entry.condition === null || entry.condition === undefined
      ? `${nameOf(rule?.action)} is a finisher. With no combo points it can't be cast, so it holds back every rule below it.`
      : `${nameOf(rule?.action)} is a finisher, and condition ${entry.condition + 1} still holds at 0 combo points. With none it can't be cast, so it holds back every rule below it.`,
  cooldownNotChecked: (entry, rule) =>
    `${nameOf(rule?.action)} has a cooldown. While it's on cooldown it holds back every rule below it.`,
  starves: (entry, rule, rotation) =>
    `Nothing in this rule can fail, so ${nameOf(rule?.action)} is cast or waited for whenever the global cooldown is clear. Never cast: ${entry.below
      .map((j) => `rule ${j + 1}, ${nameOf(rotation.rules[j]?.action)}`)
      .join(
        "; ",
      )}.${entry.reason === "alwaysHolds" ? " Change its conditions so they are sometimes false." : ""}`,
  duplicateRule: (entry) =>
    `Never reached: same as rule ${entry.same + 1}. Change its conditions or delete it.`,
  // Not in the spec's table (Open question for Fran): the two #214 warnings.
  grantedNotTalent: (entry) =>
    `${nameOf(entry.ability)} doesn't come from a talent, so "is granted" is never true and this rule never casts.`,
  unlockedNotTalent: (entry) =>
    `${nameOf(entry.ability)} doesn't come from a talent, so "is not locked by the build" is always true and does nothing.`,
};

// The builder's line for an entry; the engine's message for a code it has
// no line for.
export function entryText(entry, rotation) {
  const place = placeOf(entry.path);
  const rule = place.rule === undefined ? null : rotation.rules[place.rule];
  const line = COPY[entry.code];
  return line === undefined
    ? capitalised(String(entry.message))
    : line(entry, rule, rotation);
}

export const STALE_BANNER =
  "Run and Export are off until they're fixed. Until then the sim keeps your last valid version.";
export const WARNINGS_SUMMARY = "What to check";
export const HELP =
  "Rules are tried from the top. The first rule whose conditions all hold is cast. Every condition in a rule must hold (and); for “or”, duplicate the rule as an alternative and change its conditions.";
export const GRIP_HELP =
  "Press Space to pick the rule up, then the up and down arrows to move it, Space to drop it, or Escape to cancel.";
export const EMPTY =
  "No rules yet. Add one below, or pick a preset in Rotation to start from it.";
