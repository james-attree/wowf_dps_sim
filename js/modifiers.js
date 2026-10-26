import { k } from "../data/constants.js";
import { abilityCatalogue } from "./abilities.js";

// The modifier schema and pipeline (A2). A modifier is a piece of data that
// changes one stat for the attacks it is scoped to: a talent rank, an aura
// stack, later a set bonus or a proc. The engine asks the pipeline for a stat
// (pipeline.resolve(kind, base, context)) and never names a talent, an aura
// or a tree, so a new source is new data and no new engine code.
//
//   { kind, op, value, scope?, source? }
//
//   kind    what changes (MODIFIER_KINDS)
//   op      "add" or "mult", how value joins the others of its kind. How the
//           two pools combine is the kind's stacking form (constants
//           modifiers.stacking), not a choice made at each call site.
//   value   a finite number. A mult must be above 0.
//   scope   optional conditions. Every key that is present must match the
//           attack (AND). A key holding several values matches any of them
//           (OR). A missing key is unrestricted.
//             abilities    ability ids (the catalogue slug, e.g. "backstab")
//             hands        "mainHand" and/or "offHand"
//             weaponTypes  weapon types from config.weaponTypes, the type of
//                          the weapon making the attack
//   source  an optional label for explain() and tests ("combat.precision").
//
// The context an attack passes is { ability, hand, weaponType }. A condition
// on a part the context does not have does not match. An ability's context is
// its main hand, because every skill the rogue models attacks with it.
//
// Sources combine in a fixed order: static modifiers (talents, gear) in the
// order they were given, then aura modifiers in aura registry order. A
// modifier with no effect (add 0, mult 1) is dropped when a set is built, and
// a kind with nothing in it returns its base value untouched. That keeps a
// run with no modifiers byte-identical to one without the pipeline, and a
// rank-0 talent (which expands to no modifiers) costs nothing.

export const MODIFIER_OPS = Object.freeze(["add", "mult"]);
export const SCOPE_KEYS = Object.freeze(["abilities", "hands", "weaponTypes"]);
export const HANDS = Object.freeze(["mainHand", "offHand"]);

const EVERY_SCOPE = SCOPE_KEYS;
const HAND_SCOPES = Object.freeze(["hands", "weaponTypes"]);
const NO_SCOPE = Object.freeze([]);

// Per kind: which scope keys make sense, and the lowest value a modified
// result may take (omitted: no floor; a chance is clamped by whoever rolls it).
//   attackPower     added to the character's attack power
//   critChance      fraction, added to the crit chance
//   hitChance       fraction, added to the bonus hit chance
//   dodgeReduction  fraction taken off the target's dodge chance
//   parryReduction  fraction taken off the target's parry chance
//   armorIgnore     fraction of the target's armor ignored after reductions
//   energyRegen     energy per second (add) or a multiplier (mult)
//   energyCost      energy a skill costs, never below 0
//   damage          a fraction of the attack's damage before crit and armor
//   critDamage      the crit multiplier's bonus part (2 - 1 = 1) scales
//   haste           fraction of attack speed, stacked by haste.stacking
export const MODIFIER_KINDS = Object.freeze({
  attackPower: Object.freeze({ scope: NO_SCOPE, floor: 0 }),
  critChance: Object.freeze({ scope: EVERY_SCOPE }),
  hitChance: Object.freeze({ scope: EVERY_SCOPE }),
  dodgeReduction: Object.freeze({ scope: HAND_SCOPES }),
  parryReduction: Object.freeze({ scope: HAND_SCOPES }),
  armorIgnore: Object.freeze({ scope: EVERY_SCOPE }),
  energyRegen: Object.freeze({ scope: NO_SCOPE, floor: 0 }),
  energyCost: Object.freeze({ scope: Object.freeze(["abilities"]), floor: 0 }),
  damage: Object.freeze({ scope: EVERY_SCOPE, floor: 0 }),
  critDamage: Object.freeze({ scope: EVERY_SCOPE, floor: 1 }),
  haste: Object.freeze({ scope: NO_SCOPE }),
});

export const STACKING_FORMS = Object.freeze([
  "flat",
  "percent",
  "bonus",
  "haste",
]);

// A kind without a stacking row, or a row for no kind, is a typo that would
// otherwise fail in the middle of a fight.
function checkStacking(table) {
  const kinds = Object.keys(MODIFIER_KINDS);
  for (const kind of kinds) {
    if (!Object.hasOwn(table, kind) || !STACKING_FORMS.includes(table[kind])) {
      throw new RangeError(
        `modifiers.stacking needs one of ${STACKING_FORMS.join(", ")} for "${kind}".`,
      );
    }
  }
  for (const kind of Object.keys(table)) {
    if (!Object.hasOwn(MODIFIER_KINDS, kind)) {
      throw new RangeError(`modifiers.stacking names unknown kind "${kind}".`);
    }
  }
  return table;
}

const STACKING = checkStacking(k("modifiers.stacking"));

function fail(label, message) {
  throw new RangeError(`Modifier ${label}: ${message}`);
}

function checkList(label, key, list, valid, describe) {
  if (!Array.isArray(list) || list.length === 0) {
    fail(label, `scope.${key} must be a non-empty array.`);
  }
  for (const entry of list) {
    if (!valid(entry)) {
      fail(label, `scope.${key} has ${describe(entry)}.`);
    }
  }
  return Object.freeze([...list]);
}

// Check a scope and freeze a copy. null means unrestricted: an absent scope
// and an empty one are the same thing.
export function defineScope(label, kind, scope) {
  if (scope === undefined || scope === null) {
    return null;
  }
  if (
    typeof scope !== "object" ||
    Array.isArray(scope) ||
    (Object.getPrototypeOf(scope) !== Object.prototype &&
      Object.getPrototypeOf(scope) !== null)
  ) {
    fail(label, "scope must be a plain object.");
  }
  const allowed = MODIFIER_KINDS[kind].scope;
  const checked = {};
  for (const key of Object.keys(scope)) {
    if (!SCOPE_KEYS.includes(key)) {
      fail(
        label,
        `unknown scope key "${key}". Known: ${SCOPE_KEYS.join(", ")}.`,
      );
    }
    if (!allowed.includes(key)) {
      fail(
        label,
        `a ${kind} modifier cannot be scoped by ${key}. It takes: ${allowed.join(", ") || "no scope"}.`,
      );
    }
  }
  if (Object.hasOwn(scope, "abilities")) {
    checked.abilities = checkList(
      label,
      "abilities",
      scope.abilities,
      (id) => abilityCatalogue.get(id) !== undefined,
      (id) => `an unknown ability id ${JSON.stringify(id)}`,
    );
  }
  if (Object.hasOwn(scope, "hands")) {
    checked.hands = checkList(
      label,
      "hands",
      scope.hands,
      (hand) => HANDS.includes(hand),
      (hand) => `${JSON.stringify(hand)}. Known: ${HANDS.join(", ")}`,
    );
  }
  if (Object.hasOwn(scope, "weaponTypes")) {
    checked.weaponTypes = checkList(
      label,
      "weaponTypes",
      scope.weaponTypes,
      (type) => k("config.weaponTypes").includes(type),
      (type) => `an unknown weapon type ${JSON.stringify(type)}`,
    );
  }
  return Object.keys(checked).length === 0 ? null : Object.freeze(checked);
}

// Check a modifier and freeze it. A typo fails here, when the data is loaded.
export function defineModifier(spec) {
  const label = `${spec?.source ?? spec?.kind ?? "?"}`;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    fail(label, "must be an object.");
  }
  const { kind, op = "add", value, scope, source = null } = spec;
  for (const key of Object.keys(spec)) {
    if (!["kind", "op", "value", "scope", "source"].includes(key)) {
      fail(label, `unknown field "${key}".`);
    }
  }
  if (typeof kind !== "string" || !Object.hasOwn(MODIFIER_KINDS, kind)) {
    fail(
      label,
      `unknown kind ${JSON.stringify(kind)}. Known: ${Object.keys(MODIFIER_KINDS).join(", ")}.`,
    );
  }
  if (!MODIFIER_OPS.includes(op)) {
    fail(label, `op must be one of ${MODIFIER_OPS.join(", ")}. Got ${op}.`);
  }
  if (!Number.isFinite(value)) {
    fail(label, `value must be a finite number. Got ${value}.`);
  }
  if (op === "mult" && value <= 0) {
    fail(label, `a mult value must be above 0. Got ${value}.`);
  }
  if (STACKING[kind] === "haste" && op !== "add") {
    fail(label, `haste takes op "add" (a fraction). Got ${op}.`);
  }
  if (source !== null && (typeof source !== "string" || source === "")) {
    fail(label, "source must be a non-empty string or null.");
  }
  return Object.freeze({
    kind,
    op,
    value,
    scope: defineScope(label, kind, scope),
    source,
  });
}

// Add 0 and mult 1 change nothing, so they are not worth a step in the maths.
export function isNeutral(modifier) {
  return modifier.op === "add" ? modifier.value === 0 : modifier.value === 1;
}

function typeLabel(value) {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "an array" : typeof value;
}

// A talent's modifiers by rank. The data is a rank table:
//   { kind, op, values: [rank 1, rank 2, ...], scope? }
// and the rank is the number of points spent. Rank 0 is no modifiers at all,
// so a talent the build skips adds nothing and draws nothing. The whole table
// is checked on every call, rank 0 included: a typo in a talent the build
// leaves at rank 0 fails when the table loads, not at the first build that
// spends a point in it. A missing (null or sparse) entry is a RangeError.
export function expandRank(definitions, rank, source = null) {
  if (!Array.isArray(definitions)) {
    throw new TypeError("expandRank needs an array of rank-table entries.");
  }
  if (!Number.isInteger(rank) || rank < 0) {
    throw new RangeError(
      `Rank must be a whole number, 0 or more. Got ${rank}.`,
    );
  }
  const modifiers = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    if (
      definition === null ||
      typeof definition !== "object" ||
      Array.isArray(definition)
    ) {
      fail(
        source ?? "rank table",
        `rank-table entry ${index} must be an object, not ${typeLabel(definition)}.`,
      );
    }
    const { values, ...rest } = definition;
    if (!Array.isArray(values) || values.length === 0) {
      fail(source ?? definition.kind, "a rank table needs a values array.");
    }
    if (rank > values.length) {
      fail(
        source ?? definition.kind,
        `rank ${rank} is above the table's ${values.length} ranks.`,
      );
    }
    // Define every rank's modifier so a bad value or scope at any rank is
    // found now, then keep the one for this rank (none at rank 0).
    const perRank = [];
    for (let at = 0; at < values.length; at += 1) {
      perRank.push(defineModifier({ ...rest, value: values[at], source }));
    }
    if (rank > 0) {
      modifiers.push(perRank[rank - 1]);
    }
  }
  return modifiers;
}

// How the haste of one source joins the multiplier so far (haste.stacking).
function stackHaste(multiplier, haste) {
  const stacking = k("haste.stacking");
  if (stacking === "multiplicative") {
    return multiplier * (1 + haste);
  }
  if (stacking === "additive") {
    return multiplier + haste;
  }
  throw new Error(`Unknown haste.stacking: ${stacking}`);
}

// Does the attack meet every condition in the scope? A scope of null always
// does. The context may be undefined (a stat read with no attack, like energy
// regeneration): then only an unscoped modifier matches.
function matches(scope, context) {
  if (scope === null) {
    return true;
  }
  if (
    scope.abilities !== undefined &&
    !scope.abilities.includes(context?.ability)
  ) {
    return false;
  }
  if (scope.hands !== undefined && !scope.hands.includes(context?.hand)) {
    return false;
  }
  return (
    scope.weaponTypes === undefined ||
    scope.weaponTypes.includes(context?.weaponType)
  );
}

// Apply a mult pool to a result, in the order the contributions were given.
function applyMults(result, contributions) {
  let value = result;
  for (const { modifier, stacks } of contributions) {
    if (modifier.op === "mult") {
      value *= stacks === 1 ? modifier.value : modifier.value ** stacks;
    }
  }
  return value;
}

// The sum of the add values, each once per stack. NaN when there are none, so
// the caller can tell "no adds" from "adds that sum to 0" without a second pass.
function addPool(contributions) {
  let sum = 0;
  let any = false;
  for (const { modifier, stacks } of contributions) {
    if (modifier.op === "add") {
      sum += stacks === 1 ? modifier.value : modifier.value * stacks;
      any = true;
    }
  }
  return any ? sum : Number.NaN;
}

function combineForm(form, base, contributions) {
  if (form === "haste") {
    let multiplier = base;
    for (const { modifier, stacks } of contributions) {
      for (let stack = 0; stack < stacks; stack += 1) {
        multiplier = stackHaste(multiplier, modifier.value);
      }
    }
    return multiplier;
  }
  const added = addPool(contributions);
  const hasAdd = !Number.isNaN(added);
  if (form === "flat") {
    return applyMults(hasAdd ? base + added : base, contributions);
  }
  if (form === "percent") {
    return applyMults(hasAdd ? base * (1 + added) : base, contributions);
  }
  // "bonus": the part of the value above 1 is scaled like a percent form.
  const bonus = base - 1;
  return 1 + applyMults(hasAdd ? bonus * (1 + added) : bonus, contributions);
}

// Combine contributions into one value. contributions is what
// ModifierPipeline.contributions returns: { modifier, stacks, duration,
// source }. With none, base comes back as it is.
export function combine(kind, base, contributions) {
  if (contributions.length === 0) {
    return base;
  }
  const result = combineForm(STACKING[kind], base, contributions);
  const { floor } = MODIFIER_KINDS[kind];
  return floor !== undefined && result < floor ? floor : result;
}

const NONE = Object.freeze([]);

// A static set of modifiers plus, optionally, a provider of timed ones. The
// static ones are indexed by kind once, so a stat with no modifiers is a map
// lookup. The provider is the simulation, which knows which auras are up:
//   provider.auraModifiers(kind) -> [{ modifier, stacks, duration, source }]
export class ModifierPipeline {
  #byKind = new Map();
  #provider = null;

  constructor(modifiers = []) {
    if (!Array.isArray(modifiers)) {
      throw new TypeError("modifiers must be an array of modifiers.");
    }
    // defineModifier accepts its own output, so a mixed list of specs and
    // already-defined modifiers is fine.
    this.modifiers = Object.freeze(modifiers.map(defineModifier));
    for (const modifier of this.modifiers) {
      if (isNeutral(modifier)) {
        continue;
      }
      const list = this.#byKind.get(modifier.kind) ?? [];
      list.push({
        modifier,
        stacks: 1,
        duration: Number.POSITIVE_INFINITY,
        source: modifier.source,
      });
      this.#byKind.set(modifier.kind, list);
    }
  }

  // The fight that owns this pipeline's timed modifiers. One fight at a time:
  // a second Simulation on the same rogue would otherwise take the provider
  // over, and the first would then read the second's auras. Attaching the same
  // provider again is harmless.
  attach(provider) {
    if (this.#provider !== null && this.#provider !== provider) {
      throw new Error(
        "This modifier pipeline already belongs to another Simulation. Build a new Rogue (and pipeline) for each fight.",
      );
    }
    this.#provider = provider;
  }

  // The modifiers of one kind that apply to this context, static ones first.
  contributions(kind, context) {
    const statics = this.#byKind.get(kind);
    const timed = this.#provider?.auraModifiers(kind) ?? NONE;
    if (statics === undefined && timed.length === 0) {
      return NONE;
    }
    const found = [];
    for (const entry of statics ?? NONE) {
      if (matches(entry.modifier.scope, context)) {
        found.push(entry);
      }
    }
    for (const entry of timed) {
      if (matches(entry.modifier.scope, context)) {
        found.push(entry);
      }
    }
    return found;
  }

  combine(kind, base, contributions) {
    return combine(kind, base, contributions);
  }

  // The value of a stat: base when nothing applies, else the combination.
  resolve(kind, base, context) {
    if (!Object.hasOwn(MODIFIER_KINDS, kind)) {
      throw new RangeError(`Unknown modifier kind: ${kind}`);
    }
    return combine(kind, base, this.contributions(kind, context));
  }

  // For tests and the page: each contribution to a kind as a plain row.
  explain(kind, context) {
    return this.contributions(kind, context).map(
      ({ modifier, stacks, source }) => ({
        source,
        op: modifier.op,
        value: modifier.value,
        stacks,
      }),
    );
  }
}
