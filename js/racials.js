import { k } from "../data/constants.js";
import { RACIAL_EFFECTS } from "../data/racial-effects.js";
import { defineModifier } from "./modifiers.js";
import { snapshot } from "./snapshot.js";
import { slugify } from "./talents.js";

// Races and their racials (roadmap D12a, issue #277, P5-02). Every race and
// every racial is read from the vendored talentsforever snapshot when the
// catalogue is built: its `races` (faction -> race names) and `racials`
// (faction -> [{ race, icon, classes, abilities: [[name, text, icon]...] }]).
// Nothing about a race is copied by hand, so a refreshed snapshot (npm run
// data:refresh) changes the catalogue without a code change. What a racial
// does in a fight is data too (data/racial-effects.js); this module names no
// race and no racial.
//
// Ids: a race is the slug of its name (slugify in js/talents.js): "human",
// "night-elf", "skyborne-windshaper". A racial is `race.slug`, for example
// "human.ruthless", so the two Skyborne races' Wind Blessed are two racials
// with the same text.
//
// This module is pure: no DOM, no clock, no random numbers.

// The class whose races the simulator reads. The snapshot is the rogue
// export, and a race lists the classes it can be.
export const RACE_CLASS = "Rogue";

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function show(value) {
  if (value === undefined || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, field, where) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      `${where}: "${field}" must be a non-empty string, not ${show(value)}.`,
    );
  }
}

// Builds the race catalogue from a parsed talentsforever export, and checks
// it as it goes. It throws on the first of these:
//   - `races` or `racials` is not an object of faction -> list;
//   - a race entry with no race name, icon or classes list, or an ability
//     that is not [name, text, icon] of non-empty strings;
//   - a race listed under a faction in `races` with no entry in `racials`
//     (or the reverse), or a race listed twice;
//   - two races with the same id, or two racials of one race with the same id;
//   - no race of the class.
// Only the races that list `className` are kept. The result is deeply frozen:
//
//   catalogue.races          [{ id, name, faction, icon, racials: [racial...] }]
//                            in snapshot order (faction by faction)
//   catalogue.racials        every racial, race by race
//   catalogue.ids            the race ids, in that order
//   catalogue.get(id)        a race, or undefined
//   catalogue.racial(id)     a racial, or undefined
//
// A racial is { id, race, name, text, icon }; `race` is the race's id.
export function buildRaceCatalogue(source, className = RACE_CLASS) {
  if (!isObject(source)) {
    throw new TypeError("The race catalogue needs a talentsforever export.");
  }
  const { races: listed, racials: entries } = source;
  if (!isObject(listed) || !isObject(entries)) {
    throw new TypeError(
      'The export needs "races" and "racials", each an object of faction -> list.',
    );
  }
  const races = [];
  const seenNames = new Set();
  const ids = new Set();
  for (const [faction, names] of Object.entries(listed)) {
    const where = `races[${JSON.stringify(faction)}]`;
    if (!Array.isArray(names)) {
      throw new TypeError(`${where} must be a list of race names.`);
    }
    const list = entries[faction];
    if (!Array.isArray(list)) {
      throw new TypeError(
        `racials[${JSON.stringify(faction)}] must be a list, as races lists the faction.`,
      );
    }
    const byName = new Map();
    list.forEach((entry, index) => {
      const at = `racials[${JSON.stringify(faction)}][${index}]`;
      if (!isObject(entry)) {
        throw new TypeError(`${at} must be an object.`);
      }
      requireText(entry.race, "race", at);
      requireText(entry.icon, "icon", at);
      if (
        !Array.isArray(entry.classes) ||
        entry.classes.some((name) => typeof name !== "string")
      ) {
        throw new TypeError(`${at}: "classes" must be a list of class names.`);
      }
      if (!Array.isArray(entry.abilities) || entry.abilities.length === 0) {
        throw new TypeError(`${at}: "abilities" must be a non-empty list.`);
      }
      if (byName.has(entry.race)) {
        throw new RangeError(
          `${at}: the race ${show(entry.race)} is listed twice.`,
        );
      }
      byName.set(entry.race, entry);
    });
    for (const name of names) {
      requireText(name, "race", where);
      if (seenNames.has(name)) {
        throw new RangeError(
          `${where}: the race ${show(name)} is listed twice.`,
        );
      }
      seenNames.add(name);
      const entry = byName.get(name);
      if (entry === undefined) {
        throw new RangeError(
          `${where} lists ${show(name)}, and racials[${JSON.stringify(faction)}] has no entry for it.`,
        );
      }
      byName.delete(name);
      if (!entry.classes.includes(className)) {
        continue;
      }
      const id = slugify(name);
      if (ids.has(id)) {
        throw new RangeError(`Two races have the id ${show(id)}.`);
      }
      ids.add(id);
      const racialIds = new Set();
      const racials = entry.abilities.map((ability, index) => {
        const at = `racials[${JSON.stringify(faction)}|${name}].abilities[${index}]`;
        // An export ability is [name, text, icon], nothing more.
        if (!Array.isArray(ability)) {
          throw new TypeError(`${at} must be [name, text, icon].`);
        }
        const [racialName, text, icon, ...extra] = ability;
        if (extra.length > 0) {
          throw new TypeError(`${at} must be [name, text, icon].`);
        }
        requireText(racialName, "name", at);
        requireText(text, "text", at);
        requireText(icon, "icon", at);
        const racialId = `${id}.${slugify(racialName)}`;
        if (racialIds.has(racialId)) {
          throw new RangeError(
            `${at}: two racials have the id ${show(racialId)}.`,
          );
        }
        racialIds.add(racialId);
        return { id: racialId, race: id, name: racialName, text, icon };
      });
      races.push({ id, name, faction, icon: entry.icon, racials });
    }
    if (byName.size > 0) {
      const [extra] = byName.keys();
      throw new RangeError(
        `racials[${JSON.stringify(faction)}] has ${show(extra)}, which races[${JSON.stringify(faction)}] does not list.`,
      );
    }
  }
  for (const faction of Object.keys(entries)) {
    if (!Object.hasOwn(listed, faction)) {
      throw new RangeError(
        `racials has the faction ${show(faction)}, which races does not list.`,
      );
    }
  }
  if (races.length === 0) {
    throw new RangeError(
      `The export has no race for the class ${show(className)}.`,
    );
  }
  deepFreeze(races);
  const allRacials = Object.freeze(races.flatMap((race) => race.racials));
  const raceById = new Map(races.map((race) => [race.id, race]));
  const racialById = new Map(allRacials.map((racial) => [racial.id, racial]));
  return Object.freeze({
    races: Object.freeze(races),
    racials: allRacials,
    ids: Object.freeze(races.map((race) => race.id)),
    get: (id) => raceById.get(id),
    racial: (id) => racialById.get(id),
  });
}

export const raceCatalogue = buildRaceCatalogue(snapshot);

// What an entry of data/racial-effects.js may hold. `modifiers` (with
// optional `mobTypes`) is a racial the fight simulates; `noDpsEffect` and
// `notSimulated` are reasons and stand alone with textHash.
const EFFECT_KEYS = [
  "textHash",
  "modifiers",
  "mobTypes",
  "noDpsEffect",
  "notSimulated",
];
const REASON_KEYS = ["noDpsEffect", "notSimulated"];
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function fail(id, message) {
  throw new RangeError(`Racial effects for "${id}": ${message}`);
}

// Check the effects data against the catalogue, so a typo fails when the
// module loads and not as a racial that quietly does nothing. The numbers
// are checked against the snapshot's text by test/racials.test.js, and every
// racial having an entry by the coverage check (npm run racials:coverage).
export function checkRacialEffects(
  effects = RACIAL_EFFECTS,
  catalogue = raceCatalogue,
) {
  if (!isObject(effects)) {
    throw new RangeError(
      "Racial effects must be an object keyed by racial id.",
    );
  }
  for (const [id, entry] of Object.entries(effects)) {
    if (catalogue.racial(id) === undefined) {
      fail(id, "no such racial in the race catalogue.");
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
      fail(
        id,
        "textHash must be 64 hex digits (SHA-256 of the racial's text).",
      );
    }
    const reasons = REASON_KEYS.filter((key) => entry[key] !== undefined);
    if (reasons.length > 0) {
      const reason = entry[reasons[0]];
      if (typeof reason !== "string" || reason.trim() === "") {
        fail(id, `${reasons[0]} must be a one-line reason.`);
      }
      if (
        Object.keys(entry).some(
          (key) => key !== "textHash" && key !== reasons[0],
        )
      ) {
        fail(id, `${reasons[0]} stands alone, with textHash.`);
      }
      continue;
    }
    if (!Array.isArray(entry.modifiers) || entry.modifiers.length === 0) {
      fail(id, "an entry needs modifiers, noDpsEffect or notSimulated.");
    }
    for (const spec of entry.modifiers) {
      defineModifier({ ...spec, source: id });
    }
    if (
      entry.mobTypes !== undefined &&
      (!Array.isArray(entry.mobTypes) ||
        entry.mobTypes.length === 0 ||
        entry.mobTypes.some((type) => typeof type !== "string" || type === ""))
    ) {
      fail(id, "mobTypes must be a non-empty list of target types.");
    }
  }
}

checkRacialEffects();

// How a racial stands in a fight against `target`:
//   "simulated"     its modifiers are in the fight
//   "inert"         its modifiers are for other target types (mobTypes), so
//                   against this target it does nothing
//   "noDpsEffect"   it does nothing in a damage fight; the entry says why
//   "notSimulated"  it would change the damage, and the simulator does not
//                   model it yet; the entry says why
//   "unmapped"      no entry. The coverage check fails on it.
export function racialStatus(
  racialId,
  effects = RACIAL_EFFECTS,
  target = { mobType: k("target.mobType") },
) {
  const entry = effects[racialId];
  if (entry === undefined) {
    return "unmapped";
  }
  if (entry.noDpsEffect !== undefined) {
    return "noDpsEffect";
  }
  if (entry.notSimulated !== undefined) {
    return "notSimulated";
  }
  if (
    entry.mobTypes !== undefined &&
    !entry.mobTypes.includes(target.mobType)
  ) {
    return "inert";
  }
  return "simulated";
}

const NO_RACE = Object.freeze({
  race: null,
  modifiers: Object.freeze([]),
  racials: Object.freeze([]),
});

// What a race gives a fight: its racials' static modifiers, each with the
// racial id as its `source`, in the catalogue's order. null (no race) gives
// nothing, so a fight with no race is the one it was before races (G4).
// Racials draw no random number: they are static modifiers, not procs.
//
//   race        the race id, or null
//   modifiers   for the rogue's pipeline
//   racials     [{ id, name, status }] every racial of the race (racialStatus)
//
// An unknown race id is a RangeError (normalizeConfig refuses it first).
export function expandRace(
  raceId,
  effects = RACIAL_EFFECTS,
  catalogue = raceCatalogue,
  target = { mobType: k("target.mobType") },
) {
  if (raceId === null) {
    return NO_RACE;
  }
  const race = catalogue.get(raceId);
  if (race === undefined) {
    throw new RangeError(
      `Unknown race ${show(raceId)}. Use one of: ${catalogue.ids.join(", ")}, or null for none.`,
    );
  }
  const modifiers = [];
  const racials = [];
  for (const racial of race.racials) {
    const status = racialStatus(racial.id, effects, target);
    racials.push(Object.freeze({ id: racial.id, name: racial.name, status }));
    if (status === "simulated") {
      for (const spec of effects[racial.id].modifiers) {
        modifiers.push(defineModifier({ ...spec, source: racial.id }));
      }
    }
  }
  return Object.freeze({
    race: race.id,
    modifiers: Object.freeze(modifiers),
    racials: Object.freeze(racials),
  });
}
