import { k } from "../data/constants.js";
import { auraRegistry } from "./auras.js";
import { abilityCatalogue } from "./abilities.js";
import {
  MODIFIER_KINDS,
  combine,
  defineScope,
  scopeMatches,
} from "./modifiers.js";
import { PROC_TABLES } from "./proc-data.js";
import { talentCatalogue } from "./talents.js";
import { RESOURCE_DEFINITIONS } from "./resource-data.js";

// The proc system (roadmap A4). A proc is data: a trigger, a chance, an
// optional internal cooldown, a filter and a list of actions. The engine runs
// them and names no ability, talent or poison to do it. Which procs a fight
// has is the host's choice: Rogue takes them as `options.procs`, the way it
// takes `modifiers`, so the SimConfig and the runFight result do not change.
// A fight with no procs does nothing here, draws nothing and costs nothing.
//
//   {
//     id: "hack-and-slash",             unique among a fight's procs
//     trigger: "onHit",                 see PROC_TRIGGERS
//     scope: { weaponTypes: ["sword", "axe"] },   the filter, optional
//     chance: { mode: "flat", value: 0.05 },      see CHANCE_MODES
//     cooldown: 0,                      internal cooldown in seconds, optional
//     actions: [{ type: "extraAttack" }],         see ACTION_TYPES, in order
//   }
//
// Triggers (all fire only for what landed):
//   onHit       a direct attack hit: a white swing or an ability that attacks,
//               whatever the roll gave (hit, crit, glancing or block). Not a
//               DoT application (it deals nothing) and not a tick.
//   onCrit      a direct attack that crit.
//   onWhiteHit  a white swing that hit (the same swing also fires onHit).
//   onAbility   a cast that went through: an attack that landed (a DoT
//               application too) or a cast that does not attack. It fires at
//               the end of the cast, after its gain, spend, cooldown and aura,
//               and it carries the points the cast spent.
//   onDotTick   one tick of a DoT, crit or not.
// The filter is a modifier scope (js/modifiers.js): `abilities` by id,
// `tags` (finisher, bleed, poison, white, yellow, any of), `schools`, `hands`
// and `weaponTypes`. A scope with two keys needs both. The context it reads is
// the attack's own (Simulation.attackContext). A cast that does not attack has
// no white or yellow tag.
//
// Chance modes. The chance is worked out before any draw:
//   flat      value
//   ppm       value × the swinging hand's base weapon speed ÷ 60. Haste does
//             not change it (the weapon speed is the unhasted one).
//             Only a swing or an attack has a hand: a ppm proc that meets a cast
//             that does not attack (Adrenaline Rush) is a RangeError, not a
//             chance of 0.
//   perSpent  value × the points the cast spent, capped at 1. Only onAbility
//             can know the points (Ability.spendable() reads them before the
//             cast resets the pool). A cast that spent none has chance 0.
//
// Actions, run in order when the proc fires:
//   gainResource  { resource, amount }: add to a pool of rogue.resources
//                 (comboPoints for an extra combo point, energy to restore
//                 energy). The pool's cap applies. Points gained clear a
//                 pending expiry, as a builder's do.
//   applyAura     { aura, duration?, stacks? }: Simulation.applyAura of an
//                 aura in js/auras.js, by id.
//   dealDamage    { id, name?, icon?, min, max?, spellHit?, canCrit? }: damage from a
//                 source of its own. The damage modifiers, armor and the
//                 damage tags of the id apply (a poison id is a nature
//                 spell). With spellHit it first rolls a spell hit, and a
//                 resist deals nothing. With canCrit a landed hit then rolls
//                 a crit (Instant Poison: poison.instantCrit); without it the
//                 damage never crits. It fires no procs.
//   applyDot      { id, name?, icon?, tickDamage, interval, duration,
//                 aura?, spellHit? }: a damage over time from a source of its own
//                 (Deadly Poison). It rolls the spell hit first (if asked), and
//                 a resist applies nothing. A landed application adds one stack
//                 of `aura` (js/auras.js, by id; none means one stack, always),
//                 starts the damage over time or refreshes it to `duration`,
//                 and sets each tick to stacks × tickDamage. A refresh keeps
//                 the tick clock, so the ticks stay `interval` apart.
//                 The damage modifiers apply to tickDamage at the application,
//                 and the ticks take armor, crit and the damage tags of the id
//                 as any damage over time does. The roll is the one spell
//                 hit draw and nothing else. It fires no procs.
//   extraAttack   a white swing of the hand that triggered the proc, rolled
//                 and resolved like any swing and fired through the same
//                 triggers, unless hackAndSlash.chain is off, when a proc that
//                 holds an extraAttack action does not roll on an extra attack.
//
// RNG draws, in order. Procs draw only when they could fire:
//   1. the attack's own draws (table, crit, glance, damage), as always;
//   2. the triggers in the fixed order PROC_TRIGGERS lists, and inside one
//      trigger the procs in the order the host listed them;
//   3. per proc: nothing when the filter fails, the proc is on its internal
//      cooldown, hackAndSlash.chain is off for it, or its chance is 0 (a
//      zero-rank talent is no proc at all, and perSpent with 0 points spent
//      is 0). Otherwise one draw: fires when it is below the chance;
//   4. then the actions in order, depth first: an extraAttack draws the
//      weapon damage, the attack table and so on, and runs its own triggers
//      before the next action; dealDamage draws the spell hit (if any), then
//      the damage if min and max differ, then the crit if it can crit and the
//      hit landed (always one draw, as a DoT tick's crit is); applyDot draws the spell hit (if
//      any) and nothing more (its ticks draw their own crit rolls).
// Draws by ability: a cast fires its triggers after everything it did, so its
// draws come last. A swing fires them right after its own.

const ON_HIT = "onHit";
const ON_CRIT = "onCrit";
const ON_WHITE_HIT = "onWhiteHit";
const ON_ABILITY = "onAbility";
const ON_DOT_TICK = "onDotTick";
export const PROC_TRIGGERS = Object.freeze([
  ON_HIT,
  ON_CRIT,
  ON_WHITE_HIT,
  ON_ABILITY,
  ON_DOT_TICK,
]);
const FLAT = "flat";
const PPM = "ppm";
const PER_SPENT = "perSpent";
export const CHANCE_MODES = Object.freeze([FLAT, PPM, PER_SPENT]);
const EXTRA_ATTACK = "extraAttack";
export const ACTION_TYPES = Object.freeze([
  "gainResource",
  "applyAura",
  "dealDamage",
  "applyDot",
  EXTRA_ATTACK,
]);

// What a cast that does not attack is not: it has neither attack tag.
const ATTACK_TAGS = Object.freeze(["white", "yellow"]);

const SPEC_KEYS = Object.freeze([
  "id",
  "trigger",
  "scope",
  "chance",
  "cooldown",
  "actions",
  "chanceBonus",
]);

// An optional chanceBonus { kind, cap, points } on a flat chance: the
// modifiers of that kind the auras that are up give (Venom's poisonChance,
// #268, A9) are added to the chance when it rolls, in whole points (`points`
// per 1) and capped at `cap`. With no such aura up the chance is the value as
// it stands, so the proc reads nothing more. Only the poisons have one.
function defineChanceBonus(label, chance, bonus) {
  if (bonus === undefined) {
    return undefined;
  }
  if (!plainObject(bonus)) {
    fail(label, "chanceBonus must be an object { kind, cap, points }.");
  }
  checkKeys(label, bonus, ["kind", "cap", "points"]);
  if (!Object.hasOwn(MODIFIER_KINDS, bonus.kind)) {
    fail(label, `chanceBonus names unknown modifier kind "${bonus.kind}".`);
  }
  if (chance.mode !== FLAT) {
    fail(label, "chanceBonus needs a flat chance.");
  }
  finite(label, "chanceBonus.cap", bonus.cap);
  finite(label, "chanceBonus.points", bonus.points, { min: 1 });
  return Object.freeze({ ...bonus });
}

const defined = new WeakSet();

function fail(label, message) {
  throw new RangeError(`Proc ${label}: ${message}`);
}

function checkKeys(label, object, known) {
  for (const key of Object.keys(object)) {
    if (!known.includes(key)) {
      fail(label, `unknown key "${key}". Known: ${known.join(", ")}.`);
    }
  }
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function finite(label, what, value, { min = 0 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    fail(
      label,
      `${what} must be a finite number, ${min} or more. Got ${value}.`,
    );
  }
}

function defineChance(label, trigger, chance) {
  if (!plainObject(chance)) {
    fail(label, "chance must be an object { mode, value }.");
  }
  checkKeys(label, chance, ["mode", "value"]);
  if (!CHANCE_MODES.includes(chance.mode)) {
    fail(
      label,
      `unknown chance mode ${JSON.stringify(chance.mode)}. Known: ${CHANCE_MODES.join(", ")}.`,
    );
  }
  finite(label, "chance.value", chance.value);
  if (chance.mode !== PPM && chance.value > 1) {
    fail(
      label,
      `a ${chance.mode} chance.value is 0 to 1. Got ${chance.value}.`,
    );
  }
  if (chance.mode === PER_SPENT && trigger !== ON_ABILITY) {
    fail(label, `a ${PER_SPENT} chance needs the ${ON_ABILITY} trigger.`);
  }
  if (chance.mode === PPM && trigger === ON_DOT_TICK) {
    fail(label, `a ${PPM} chance does not fit a DoT tick.`);
  }
  return Object.freeze({ mode: chance.mode, value: chance.value });
}

function defineAction(label, action, index) {
  const at = `${label} action ${index}`;
  if (!plainObject(action)) {
    fail(at, "must be an object { type, ... }.");
  }
  if (!ACTION_TYPES.includes(action.type)) {
    fail(
      at,
      `unknown action type ${JSON.stringify(action.type)}. Known: ${ACTION_TYPES.join(", ")}.`,
    );
  }
  if (action.type === "gainResource") {
    checkKeys(at, action, ["type", "resource", "amount"]);
    const pool = RESOURCE_DEFINITIONS.find(({ id }) => id === action.resource);
    if (pool === undefined) {
      fail(at, `unknown resource id ${JSON.stringify(action.resource)}.`);
    }
    finite(at, "amount", action.amount);
    if (pool.whole === true && !Number.isInteger(action.amount)) {
      fail(
        at,
        `${action.resource} holds whole units, so amount must be a whole number. Got ${action.amount}.`,
      );
    }
    return Object.freeze({ ...action });
  }
  if (action.type === "applyAura") {
    checkKeys(at, action, ["type", "aura", "duration", "stacks"]);
    const aura = auraRegistry().get(action.aura);
    if (aura === undefined) {
      fail(at, `unknown aura id ${JSON.stringify(action.aura)}.`);
    }
    const length = action.duration ?? aura.duration;
    if (
      typeof length !== "number" ||
      !(length > 0) ||
      !Number.isFinite(length)
    ) {
      fail(at, `duration must be above 0. Got ${length}.`);
    }
    if (
      action.stacks !== undefined &&
      (!Number.isInteger(action.stacks) || action.stacks < 1)
    ) {
      fail(
        at,
        `stacks must be a whole number, 1 or more. Got ${action.stacks}.`,
      );
    }
    return Object.freeze({ ...action });
  }
  if (action.type === "dealDamage") {
    checkKeys(at, action, [
      "type",
      "id",
      "name",
      "icon",
      "min",
      "max",
      "spellHit",
      "canCrit",
    ]);
    if (typeof action.id !== "string" || action.id === "") {
      fail(at, "id must be a non-empty string.");
    }
    const catalogued = abilityCatalogue.get(action.id);
    if (catalogued === undefined && typeof action.name !== "string") {
      fail(at, `an id outside the ability catalogue needs a name.`);
    }
    if (action.icon !== undefined && typeof action.icon !== "string") {
      fail(at, "icon must be a URL string.");
    }
    finite(at, "min", action.min);
    const max = action.max ?? action.min;
    finite(at, "max", max, { min: action.min });
    if (action.spellHit !== undefined && typeof action.spellHit !== "boolean") {
      fail(at, "spellHit must be true or false.");
    }
    if (action.canCrit !== undefined && typeof action.canCrit !== "boolean") {
      fail(at, "canCrit must be true or false.");
    }
    return Object.freeze({
      ...action,
      name: catalogued?.name ?? action.name,
      max,
      spellHit: action.spellHit === true,
      canCrit: action.canCrit === true,
    });
  }
  if (action.type === "applyDot") {
    checkKeys(at, action, [
      "type",
      "id",
      "name",
      "icon",
      "tickDamage",
      "interval",
      "duration",
      "aura",
      "spellHit",
    ]);
    if (typeof action.id !== "string" || action.id === "") {
      fail(at, "id must be a non-empty string.");
    }
    const catalogued = abilityCatalogue.get(action.id);
    if (catalogued === undefined && typeof action.name !== "string") {
      fail(at, `an id outside the ability catalogue needs a name.`);
    }
    if (action.icon !== undefined && typeof action.icon !== "string") {
      fail(at, "icon must be a URL string.");
    }
    for (const field of ["tickDamage", "interval", "duration"]) {
      if (!(action[field] > 0)) {
        fail(at, `${field} must be above 0. Got ${action[field]}.`);
      }
      finite(at, field, action[field]);
    }
    if (action.duration < action.interval) {
      fail(
        at,
        `duration (${action.duration}) must be at least one interval (${action.interval}).`,
      );
    }
    if (
      action.aura !== undefined &&
      auraRegistry().get(action.aura)?.target !== "target"
    ) {
      fail(at, `aura must be the id of a target aura. Got ${action.aura}.`);
    }
    if (action.spellHit !== undefined && typeof action.spellHit !== "boolean") {
      fail(at, "spellHit must be true or false.");
    }
    return Object.freeze({
      ...action,
      name: catalogued?.name ?? action.name,
      spellHit: action.spellHit === true,
    });
  }
  checkKeys(at, action, ["type"]);
  return Object.freeze({ ...action });
}

// Check a proc and freeze it. A typo fails here, when the data is loaded.
export function defineProc(spec) {
  if (!plainObject(spec)) {
    throw new RangeError("A proc must be an object.");
  }
  const label = typeof spec.id === "string" ? `"${spec.id}"` : "(no id)";
  if (
    typeof spec.id !== "string" ||
    spec.id === "" ||
    spec.id === "__proto__"
  ) {
    fail(label, "id must be a non-empty string other than __proto__.");
  }
  checkKeys(label, spec, SPEC_KEYS);
  if (!PROC_TRIGGERS.includes(spec.trigger)) {
    fail(
      label,
      `unknown trigger ${JSON.stringify(spec.trigger)}. Known: ${PROC_TRIGGERS.join(", ")}.`,
    );
  }
  const cooldown = spec.cooldown ?? 0;
  finite(label, "cooldown", cooldown);
  if (!Array.isArray(spec.actions) || spec.actions.length === 0) {
    fail(label, "actions must be a non-empty array.");
  }
  const actions = spec.actions.map((action, index) =>
    defineAction(label, action, index),
  );
  const proc = Object.freeze({
    id: spec.id,
    trigger: spec.trigger,
    // The filter is a modifier scope of damage (every attack key, no resource).
    scope: defineScope(`proc ${label}`, "damage", spec.scope),
    chance: defineChance(label, spec.trigger, spec.chance),
    ...(spec.chanceBonus === undefined
      ? {}
      : {
          chanceBonus: defineChanceBonus(label, spec.chance, spec.chanceBonus),
        }),
    cooldown,
    actions: Object.freeze(actions),
    extraAttack: actions.some(({ type }) => type === EXTRA_ATTACK),
  });
  defined.add(proc);
  return proc;
}

// A talent's proc by rank. The spec is the same, with chance.values in place
// of chance.value: { mode, values: [rank 1, rank 2, ...] }. Rank 0 is no proc
// at all (null), so a talent the build skips adds nothing and draws nothing.
// Every rank is defined whatever the rank, so a typo in a rank the build
// leaves unspent fails when the data loads.
export function defineRankedProc(spec, rank) {
  if (!plainObject(spec) || !plainObject(spec.chance)) {
    throw new RangeError("A ranked proc must be an object with a chance.");
  }
  if (!Number.isInteger(rank) || rank < 0) {
    throw new RangeError(
      `Rank must be a whole number, 0 or more. Got ${rank}.`,
    );
  }
  const { values, ...chance } = spec.chance;
  if (!Array.isArray(values) || values.length === 0) {
    fail(spec.id, "a ranked chance needs a values array.");
  }
  if (rank > values.length) {
    fail(spec.id, `rank ${rank} is above the table's ${values.length} ranks.`);
  }
  const perRank = values.map((value) =>
    defineProc({ ...spec, chance: { ...chance, value } }),
  );
  return rank === 0 ? null : perRank[rank - 1];
}

// The procs for a set of talent ranks { "<talent id>": rank }, from the rank
// tables in js/proc-data.js. A talent at rank 0, or left out, gives null. An id
// that is a talent but not a proc talent is ignored (most talents are
// modifiers); an id that is no talent at all, `null`, an array or anything
// that is not a plain object is a RangeError. The result is a list for Rogue's
// `procs` option.
export function procsFromTalents(ranks = {}) {
  if (!plainObject(ranks)) {
    throw new RangeError(
      `procsFromTalents needs an object of { talent id: rank }, not ${ranks === null ? "null" : Array.isArray(ranks) ? "an array" : typeof ranks}.`,
    );
  }
  // A key that is no talent in the catalogue is a typo, and a typo would give
  // a build that quietly lacks its proc. A talent that is not a proc talent
  // (most are modifiers) is fine and is ignored.
  for (const id of Object.keys(ranks)) {
    if (talentCatalogue.get(id) === undefined) {
      throw new RangeError(
        `procsFromTalents got an unknown talent id ${JSON.stringify(id)}. Use a catalogue id such as "combat.hack-and-slash".`,
      );
    }
  }
  return Object.keys(PROC_TABLES).flatMap((id) =>
    PROC_TABLES[id].map((spec) =>
      defineRankedProc(spec, Object.hasOwn(ranks, id) ? ranks[id] : 0),
    ),
  );
}

// The list a Rogue takes: procs from defineProc, and null for a rank 0 (left
// out). Anything else, and two procs with one id, is a RangeError.
export function checkProcs(list) {
  if (!Array.isArray(list)) {
    throw new TypeError("Rogue option procs must be an array.");
  }
  const procs = [];
  const ids = new Set();
  for (const proc of list) {
    if (proc === null) {
      continue;
    }
    if (!defined.has(proc)) {
      throw new RangeError(
        "Rogue option procs holds something defineProc did not make.",
      );
    }
    if (ids.has(proc.id)) {
      throw new RangeError(`Two procs share the id "${proc.id}".`);
    }
    ids.add(proc.id);
    procs.push(proc);
  }
  return Object.freeze(procs);
}

// Runs a fight's procs. One per Simulation: it holds the internal cooldowns
// and the counts.
export class ProcRunner {
  constructor(simulation, procs = []) {
    this.simulation = simulation;
    this.procs = procs;
    // Per trigger, in the order the host listed the procs.
    this.byTrigger = Object.fromEntries(
      PROC_TRIGGERS.map((trigger) => [
        trigger,
        procs.filter((proc) => proc.trigger === trigger),
      ]),
    );
    // Per proc id: rolls (draws), fires, blocked (held back by the internal
    // cooldown), gained (resource points added by gainResource actions).
    this.stats = Object.create(null);
    this.readyAt = new Map();
    this.depth = 0;
    const { resources } = simulation.rogue;
    for (const proc of procs) {
      this.stats[proc.id] = { rolls: 0, fires: 0, blocked: 0, gained: 0 };
      // A pool the rogue lacks is said now, not in the middle of a fight.
      for (const action of proc.actions) {
        if (
          action.type === "gainResource" &&
          !Object.hasOwn(resources ?? {}, action.resource)
        ) {
          throw new RangeError(
            `Proc "${proc.id}" gains the resource "${action.resource}", which the rogue does not have.`,
          );
        }
      }
    }
  }

  get active() {
    return this.procs.length > 0;
  }

  // A white swing resolved (Simulation.resolveAttack). `extra` is true for a
  // swing an extraAttack action made.
  onSwing(source, result, extra) {
    if (!this.active || !result.landed) {
      return;
    }
    this.dispatch({
      kinds: this.hitKinds(result, true),
      context: this.simulation.attackContext(source, "weapon"),
      hand: source.hand,
      spent: 0,
      attacks: true,
      extra,
    });
  }

  // A cast went through (Ability.cast), with the points it spent. `result` is
  // the attack's result, or null for a cast that does not attack.
  onCast(ability, result, spent) {
    if (!this.active) {
      return;
    }
    const attacks = result !== null && !ability.dot;
    const kinds = attacks ? this.hitKinds(result, false) : [];
    kinds.push(ON_ABILITY);
    const context = this.simulation.attackContext(
      {
        id: ability.id,
        hand: ability.hand,
        bleed: ability.dot && ability.bleed,
      },
      "skill",
    );
    if (result === null) {
      context.tags = context.tags.filter((tag) => !ATTACK_TAGS.includes(tag));
    }
    this.dispatch({
      kinds,
      context,
      hand: ability.hand,
      spent,
      attacks: result !== null,
      extra: false,
    });
  }

  // Mutilate's off-hand strike landed (#267, A4-A6): its onHit procs, the
  // off hand's poison among them, with hand "offHand". onCrit only when
  // `canCrit` (the main hand did not crit), so Seal Fate rolls at most once a
  // cast. No onAbility: the cast fired those with the main hand.
  onStrike(source, result, canCrit) {
    if (!this.active || !result.landed) {
      return;
    }
    const kinds = this.hitKinds(result, false).filter(
      (kind) => canCrit || kind !== ON_CRIT,
    );
    this.dispatch({
      kinds,
      context: this.simulation.attackContext(source, "skill"),
      hand: source.hand,
      spent: 0,
      attacks: true,
      extra: false,
    });
  }

  // One DoT tick (a DoT tick event on the core, js/core/dots.js), with the
  // context of the DoT.
  onDotTick(context) {
    if (!this.active) {
      return;
    }
    this.dispatch({
      kinds: [ON_DOT_TICK],
      context,
      hand: context.hand,
      spent: 0,
      attacks: true,
      extra: false,
    });
  }

  hitKinds(result, white) {
    const kinds = [ON_HIT];
    if (result.outcome === "crit") {
      kinds.push(ON_CRIT);
    }
    if (white) {
      kinds.push(ON_WHITE_HIT);
    }
    return kinds;
  }

  dispatch(event) {
    for (const trigger of PROC_TRIGGERS) {
      if (!event.kinds.includes(trigger)) {
        continue;
      }
      for (const proc of this.byTrigger[trigger]) {
        this.consider(proc, event);
      }
    }
  }

  chanceOf(proc, event) {
    const { mode, value } = proc.chance;
    if (mode === FLAT) {
      return proc.chanceBonus === undefined
        ? value
        : this.withAuraBonus(value, proc.chanceBonus);
    }
    if (mode === PPM) {
      // Procs per minute is a rate of weapon swings. A cast that does not
      // attack has no swing, and a quiet 0 would hide a proc that can never
      // fire, so it is an error.
      if (!event.attacks) {
        throw new RangeError(
          `Proc "${proc.id}" has a ppm chance and met a cast that does not attack. A ppm chance needs a swing or an attack.`,
        );
      }
      const weapon = this.simulation.rogue.weapons[event.hand];
      return Math.min(1, (value * weapon.speed) / k("proc.secondsPerMinute"));
    }
    return Math.min(1, value * event.spent);
  }

  // A flat chance plus the auras' modifiers of the bonus kind that are up
  // (Venom, #268), in whole points and capped. None up: the chance as it is.
  withAuraBonus(value, { kind, cap, points }) {
    const timed = this.simulation.auraModifiers(kind);
    if (timed.length === 0) {
      return value;
    }
    const extra = combine(kind, 0, timed);
    return extra > 0
      ? Math.min(cap, Math.round((value + extra) * points) / points)
      : value;
  }

  consider(proc, event) {
    if (!scopeMatches(proc.scope, event.context)) {
      return;
    }
    if (event.extra && proc.extraAttack && !k("hackAndSlash.chain")) {
      return;
    }
    const stats = this.stats[proc.id];
    const { currentTime } = this.simulation;
    if (currentTime < (this.readyAt.get(proc.id) ?? 0) - k("sim.tickEpsilon")) {
      stats.blocked += 1;
      return;
    }
    const chance = this.chanceOf(proc, event);
    if (!(chance > 0)) {
      return;
    }
    stats.rolls += 1;
    if (this.simulation.rng() >= chance) {
      return;
    }
    stats.fires += 1;
    this.simulation.emitProc(proc, event);
    if (proc.cooldown > 0) {
      this.readyAt.set(proc.id, currentTime + proc.cooldown);
    }
    for (const action of proc.actions) {
      this.run(proc, action, event);
    }
  }

  run(proc, action, event) {
    const simulation = this.simulation;
    if (action.type === "gainResource") {
      const pool = simulation.rogue.resources[action.resource];
      const gained = pool.gain(action.amount, proc.id);
      if (gained > 0) {
        pool.clearExpiry();
      }
      this.stats[proc.id].gained += gained;
    } else if (action.type === "applyAura") {
      simulation.applyAura(simulation.auraDefinitions.get(action.aura), {
        duration: action.duration,
        stacks: action.stacks,
        source: proc.id,
      });
    } else if (action.type === "dealDamage") {
      simulation.resolveProcDamage(action);
    } else if (action.type === "applyDot") {
      simulation.resolveProcDot(action);
    } else {
      this.extraAttack(event);
    }
  }

  extraAttack(event) {
    if (this.depth >= k("proc.maxChainDepth")) {
      throw new RangeError(
        `Extra attacks followed one another ${this.depth} times. A proc that cannot fail with hackAndSlash.chain on never stops.`,
      );
    }
    const weapon = this.simulation.rogue.weapons[event.hand];
    this.depth += 1;
    try {
      this.simulation.resolveAttack(
        weapon.attack,
        "weapon",
        weapon.rollDamage(),
        { extra: true },
      );
    } finally {
      this.depth -= 1;
    }
  }
}
