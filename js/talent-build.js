import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "./abilities.js";
import { expandRank } from "./modifiers.js";
import { defineRankedProc } from "./procs.js";
import { talentCatalogue } from "./talents.js";

// From talent ranks to what a fight takes (roadmap D5). expandTalents turns a
// map { talent id: rank } into the modifiers and the procs the talents give,
// from data/talent-effects.js, and nothing else: it names no talent and no
// ability, and the engine's pipeline (js/modifiers.js) and proc runner
// (js/procs.js) do the rest. A host passes the two lists on:
//
//   const build = expandTalents(config.talents);
//   createFight(seed, config, { modifiers: build.modifiers, procs: build.procs });
//
// runFight does not do this yet. Reading config.talents into a fight, and the
// rotation's use of the talents that grant an ability, is D7 (#103).
//
// The result lists things in catalogue order, whatever the order of the map, so
// the same build is the same fight. That order is also the order the procs are
// listed in, and so the order their random draws are made in.
//
//   modifiers  for Rogue's `modifiers` option. Each has the talent id as its
//              `source`
//   procs      for Rogue's `procs` option, rank 0 left out
//   abilities  the ids of the abilities a talent of rank 1 or more grants
//   noDps      the talents of rank 1 or more that have no DPS effect
//   unmapped   the talents of rank 1 or more that have no entry in the effects
//              data. They do nothing in the fight. The host should say so: it is
//              a build the simulator does not fully model yet (the Assassination
//              and Subtlety talents, until D8a and D8b)
//
// A talent at rank 0 gives nothing and makes no random draw, since a proc that
// is not in the list is not rolled. Every rank table is checked at every rank,
// at rank 0 too, so a typo in a talent nobody has spent points in still fails.

const EFFECT_KEYS = [
  "textHash",
  "modifiers",
  "procs",
  "ability",
  "noDpsEffect",
];
const NO_DPS_KEYS = ["textHash", "noDpsEffect"];
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function fail(id, message) {
  throw new RangeError(`Talent effects for "${id}": ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function kindOf(value) {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "an array" : typeof value;
}

// Check the effects data against the catalogue, so a typo fails when the
// module loads and not as a talent that quietly does nothing. It checks the
// shape; the numbers are checked against the snapshot's text by the tests, and
// a rank table is checked in full when it is expanded.
export function checkTalentEffects(
  effects = TALENT_EFFECTS,
  catalogue = talentCatalogue,
) {
  if (!isObject(effects)) {
    throw new RangeError(
      `Talent effects must be an object keyed by talent id, not ${kindOf(effects)}.`,
    );
  }
  const procIds = new Set();
  for (const [id, entry] of Object.entries(effects)) {
    const talent = catalogue.get(id);
    if (talent === undefined) {
      fail(id, "no such talent in the catalogue.");
    }
    if (!isObject(entry)) {
      fail(id, "an entry must be an object.");
    }
    for (const key of Object.keys(entry)) {
      if (!EFFECT_KEYS.includes(key)) {
        fail(id, `unknown key "${key}". Known: ${EFFECT_KEYS.join(", ")}.`);
      }
    }
    if (
      typeof entry.textHash !== "string" ||
      !HASH_PATTERN.test(entry.textHash)
    ) {
      fail(id, "textHash must be 64 hex digits (SHA-256 of the rank texts).");
    }
    if (entry.noDpsEffect !== undefined) {
      if (typeof entry.noDpsEffect !== "string" || entry.noDpsEffect === "") {
        fail(id, "noDpsEffect must be a one-line reason.");
      }
      if (Object.keys(entry).some((key) => !NO_DPS_KEYS.includes(key))) {
        fail(id, "noDpsEffect stands alone, with textHash.");
      }
      continue;
    }
    if (Object.keys(entry).every((key) => key === "textHash")) {
      fail(id, "an entry needs modifiers, procs, an ability or noDpsEffect.");
    }
    for (const table of entry.modifiers ?? []) {
      if (!Array.isArray(table.values) || table.values.length !== talent.max) {
        fail(
          id,
          `a modifier needs one value for each of the ${talent.max} ranks.`,
        );
      }
    }
    for (const spec of entry.procs ?? []) {
      if (
        !Array.isArray(spec.chance?.values) ||
        spec.chance.values.length !== talent.max
      ) {
        fail(
          id,
          `a proc needs one chance for each of the ${talent.max} ranks.`,
        );
      }
      if (procIds.has(spec.id)) {
        fail(id, `the proc id "${spec.id}" is used twice.`);
      }
      procIds.add(spec.id);
    }
    if (
      entry.ability !== undefined &&
      abilityCatalogue.get(entry.ability) === undefined
    ) {
      fail(
        id,
        `the ability "${entry.ability}" is not in the ability catalogue.`,
      );
    }
  }
}

function checkRanks(ranks, catalogue) {
  if (!isObject(ranks)) {
    throw new RangeError(
      `expandTalents needs an object of { talent id: rank }, not ${kindOf(ranks)}.`,
    );
  }
  for (const [id, rank] of Object.entries(ranks)) {
    const talent = catalogue.get(id);
    if (talent === undefined) {
      throw new RangeError(
        `expandTalents got an unknown talent id ${JSON.stringify(id)}. Use a catalogue id such as "combat.precision".`,
      );
    }
    if (!Number.isInteger(rank) || rank < 0 || rank > talent.max) {
      throw new RangeError(
        `Talent "${id}" has ranks 0 to ${talent.max}. Got ${String(rank)}.`,
      );
    }
  }
}

export function expandTalents(
  ranks = {},
  effects = TALENT_EFFECTS,
  catalogue = talentCatalogue,
) {
  checkRanks(ranks, catalogue);
  const build = {
    modifiers: [],
    procs: [],
    abilities: [],
    noDps: [],
    unmapped: [],
  };
  for (const talent of catalogue.talents) {
    const rank = Object.hasOwn(ranks, talent.id) ? ranks[talent.id] : 0;
    const entry = effects[talent.id];
    if (entry === undefined) {
      if (rank > 0) {
        build.unmapped.push(talent.id);
      }
      continue;
    }
    build.modifiers.push(...expandRank(entry.modifiers ?? [], rank, talent.id));
    for (const spec of entry.procs ?? []) {
      const proc = defineRankedProc(spec, rank);
      if (proc !== null) {
        build.procs.push(proc);
      }
    }
    if (rank > 0 && entry.ability !== undefined) {
      build.abilities.push(entry.ability);
    }
    if (rank > 0 && entry.noDpsEffect !== undefined) {
      build.noDps.push(talent.id);
    }
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(build).map(([key, list]) => [key, Object.freeze(list)]),
    ),
  );
}

// Fail the import on bad data: the shape, and every rank table at every rank.
checkTalentEffects();
expandTalents();
