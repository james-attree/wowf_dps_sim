import { k } from "../data/constants.js";
import { talentCatalogue } from "./talents.js";

// SimConfig (roadmap E2-lite, issue #92): the inputs of one fight. It names the
// character's stats, the two weapons, the talent ranks and the poison on each
// hand. createFight(seed, config) and runFight({ seed, duration, config })
// take it; with none, the defaults below reproduce the fight the engine ran
// before there was a config.
//
// The config is only parsed, validated, normalised and carried. The character
// stats and the weapons change the fight. The talent ranks and the poisons are
// stored and handed back in the result, and the engine ignores them until the
// issues that wire them in (talent effects D5/D7, poisons A5).
//
// The shape (every field is optional; a missing one takes its default):
//
//   {
//     character: { attackPower, critChance, bonusHitChance },
//     weapons: {
//       mainHand: { min, max, speed, type },
//       offHand:  { min, max, speed, type },
//     },
//     target: { behind },                        // true: no parry, no block
//     talents: { "combat.precision": 5, ... },   // talent id -> rank
//     poisons: { mainHand: "instant", offHand: "deadly" },   // an id, or null
//   }
//
// normalizeConfig returns the full form, with every field filled in. It is
// what a result records, and normalizeConfig of that gives the same config
// again, so a recorded config repeats the fight exactly.

const HANDS = ["mainHand", "offHand"];
const CHARACTER_FIELDS = ["attackPower", "critChance", "bonusHitChance"];
const WEAPON_FIELDS = ["min", "max", "speed", "type"];
const TARGET_FIELDS = ["behind"];
const SECTIONS = ["character", "weapons", "target", "talents", "poisons"];

// The config every fight uses when it is given none, built fresh from the
// constants each call so nobody can change another fight's defaults.
export function defaultConfig() {
  const weapon = (hand) => {
    const { min, max, speed, type } = k(`weapon.${hand}`);
    return { min, max, speed, type: type ?? null };
  };
  return {
    character: {
      attackPower: k("character.attackPower"),
      critChance: k("character.critChance"),
      bonusHitChance: k("character.bonusHitChance"),
    },
    weapons: { mainHand: weapon("mainHand"), offHand: weapon("offHand") },
    target: { behind: k("target.behind") },
    talents: {},
    poisons: { mainHand: null, offHand: null },
  };
}

// The dagger/dagger alternate (issue #127): Perdition's Blade and Core Hound
// Tooth, with the character sheet that goes with them (no Brutality Blade stats,
// Core Hound Tooth's crit and AP). Everything else is the default config.
export function defaultDaggerConfig() {
  const config = defaultConfig();
  const dagger = (hand) => {
    const { min, max, speed, type } = k(`weapon.dagger.${hand}`);
    return { min, max, speed, type };
  };
  config.character.attackPower = k("character.dagger.attackPower");
  config.character.critChance = k("character.dagger.critChance");
  config.weapons = { mainHand: dagger("mainHand"), offHand: dagger("offHand") };
  return config;
}

// How a bad value reads in a message: JSON.stringify hides NaN and Infinity as
// "null" and undefined as nothing, so numbers and undefined use String().
function show(value) {
  if (value === undefined || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function kindOf(value) {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "an array" : typeof value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// A section or sub-object: undefined means "use the defaults", anything else
// must be a plain object with no key outside `allowed`.
function readObject(value, path, allowed) {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object, not ${kindOf(value)}.`);
  }
  if (allowed !== undefined) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        throw new RangeError(
          `${path} has an unknown field ${JSON.stringify(key)}. Allowed fields: ${allowed.join(", ")}.`,
        );
      }
    }
  }
  return value;
}

function readNumber(value, path, fallback, { min = 0, max, whole = false }) {
  if (value === undefined) {
    return fallback;
  }
  const what = whole ? "a whole number" : "a number";
  const range =
    max === undefined ? `${min} or more` : `between ${min} and ${max}`;
  if (typeof value !== "number") {
    throw new TypeError(
      `${path} must be ${what} ${range}, not ${show(value)}.`,
    );
  }
  if (
    !Number.isFinite(value) ||
    value < min ||
    (max !== undefined && value > max) ||
    (whole && !Number.isInteger(value))
  ) {
    throw new RangeError(
      `${path} must be ${what} ${range}, not ${show(value)}.`,
    );
  }
  return value;
}

// One of `ids`, or null. undefined means the default.
function readChoice(value, path, fallback, ids, noun) {
  if (value === undefined) {
    return fallback;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(
      `${path} must be a ${noun} id (${ids.join(", ")}) or null, not ${show(value)}.`,
    );
  }
  if (!ids.includes(value)) {
    throw new RangeError(
      `${path} has an unknown ${noun} ${show(value)}. Use one of: ${ids.join(", ")}, or null for none.`,
    );
  }
  return value;
}

function readCharacter(input, defaults) {
  const given = readObject(input, "config.character", CHARACTER_FIELDS);
  const result = {};
  for (const field of CHARACTER_FIELDS) {
    // Attack power has no upper limit. A chance runs from 0 to 1.
    const limits = field === "attackPower" ? {} : { max: 1 };
    result[field] = readNumber(
      given[field],
      `config.character.${field}`,
      defaults[field],
      limits,
    );
  }
  return result;
}

function readWeapon(input, hand, defaults) {
  const path = `config.weapons.${hand}`;
  const given = readObject(input, path, WEAPON_FIELDS);
  const min = readNumber(given.min, `${path}.min`, defaults.min, {
    whole: true,
  });
  const max = readNumber(given.max, `${path}.max`, defaults.max, {
    whole: true,
  });
  if (min > max) {
    throw new RangeError(
      `${path}.min (${min}) is greater than ${path}.max (${max}).`,
    );
  }
  // A speed below config.minWeaponSpeed is rejected here, not left to run: the
  // swing loop does one pass per swing, so a speed near 0 never finishes.
  const speed = readNumber(given.speed, `${path}.speed`, defaults.speed, {
    min: k("config.minWeaponSpeed"),
  });
  const type = readChoice(
    given.type,
    `${path}.type`,
    defaults.type,
    k("config.weaponTypes"),
    "weapon type",
  );
  return { min, max, speed, type };
}

function readWeapons(input, defaults) {
  const given = readObject(input, "config.weapons", HANDS);
  return Object.fromEntries(
    HANDS.map((hand) => [hand, readWeapon(given[hand], hand, defaults[hand])]),
  );
}

// Where the rogue stands. Behind the target, the attack table has no parry and
// no block (A7).
function readTarget(input, defaults) {
  const given = readObject(input, "config.target", TARGET_FIELDS);
  if (given.behind !== undefined && typeof given.behind !== "boolean") {
    throw new TypeError(
      `config.target.behind must be true or false, not ${show(given.behind)}.`,
    );
  }
  return { behind: given.behind ?? defaults.behind };
}

// Talent ranks by catalogue id. Only the rank is checked here (a whole number
// from 0 to the talent's max, and the id must exist). The 51-point total, the
// row gating and the prerequisites are checked when a build is applied (D7).
// A rank of 0 is the same as not naming the talent, so it is left out. The
// result lists the talents in catalogue order, so two spellings of one build
// normalise to the same config.
function readTalents(input, catalogue) {
  const given = readObject(input, "config.talents");
  // Each given[id] is read once. A rank is validated where it is read, and the
  // kept ones are collected, so the loop below never reads `given` again.
  const kept = new Map();
  for (const [id, rank] of Object.entries(given)) {
    const talent = catalogue.get(id);
    if (talent === undefined) {
      throw new RangeError(
        `config.talents names an unknown talent ${JSON.stringify(id)}. Use a catalogue id such as "combat.precision".`,
      );
    }
    const path = `config.talents[${JSON.stringify(id)}]`;
    if (rank === undefined) {
      throw new TypeError(
        `${path} must be a whole number between 0 and ${talent.max}, not undefined.`,
      );
    }
    const valid = readNumber(rank, path, undefined, {
      max: talent.max,
      whole: true,
    });
    if (valid > 0) {
      kept.set(id, valid);
    }
  }
  const ranks = {};
  for (const talent of catalogue.talents) {
    if (kept.has(talent.id)) {
      ranks[talent.id] = kept.get(talent.id);
    }
  }
  return ranks;
}

function readPoisons(input, defaults) {
  const given = readObject(input, "config.poisons", HANDS);
  return Object.fromEntries(
    HANDS.map((hand) => [
      hand,
      readChoice(
        given[hand],
        `config.poisons.${hand}`,
        defaults[hand],
        k("config.poisonIds"),
        "poison",
      ),
    ]),
  );
}

// Validates a config and returns it in full form, as a new object that shares
// nothing with the input. undefined gives the defaults. It throws a TypeError
// for a value of the wrong type and a RangeError for a value out of range, an
// unknown field, or an unknown talent, and the message names the field.
export function normalizeConfig(config, catalogue = talentCatalogue) {
  const given = readObject(config, "config", SECTIONS);
  const defaults = defaultConfig();
  return {
    character: readCharacter(given.character, defaults.character),
    weapons: readWeapons(given.weapons, defaults.weapons),
    target: readTarget(given.target, defaults.target),
    talents: readTalents(given.talents, catalogue),
    poisons: readPoisons(given.poisons, defaults.poisons),
  };
}
