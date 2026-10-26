import { k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "./abilities.js";
import { expandRank } from "./modifiers.js";
import { defineRankedProc } from "./procs.js";
import { talentCatalogue } from "./talents.js";

// From talent ranks to what a fight takes (roadmap D5, D7). expandTalents turns
// a map { talent id: rank } into the modifiers and the procs the talents give,
// from data/talent-effects.js, and nothing else: it names no talent and no
// ability, and the engine's pipeline (js/modifiers.js) and proc runner
// (js/procs.js) do the rest. It checks ids and ranks only, so a test or a tool
// can expand one talent on its own:
//
//   const build = expandTalents({ "combat.precision": 3 });
//   createFight(seed, config, { modifiers: build.modifiers, procs: build.procs });
//
// applyBuild (D7, #106) is the same expansion for a build a player selected. It
// first checks that the build is one a character can have (validateBuild), and
// the Rogue calls it on `config.talents`, so runFight, createFight and the live
// page all apply a selected build without the host expanding anything.
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

function checkRanks(ranks, catalogue, who = "expandTalents") {
  if (!isObject(ranks)) {
    throw new RangeError(
      `${who} needs an object of { talent id: rank }, not ${kindOf(ranks)}.`,
    );
  }
  for (const [id, rank] of Object.entries(ranks)) {
    const talent = catalogue.get(id);
    if (talent === undefined) {
      throw new RangeError(
        `${who} got an unknown talent id ${JSON.stringify(id)}. Use a catalogue id such as "combat.precision".`,
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

// The talent points a build spends, in all, and by tree and row. A talent not
// in `ranks` is rank 0.
function spending(ranks, catalogue) {
  const rankOf = (talent) =>
    Object.hasOwn(ranks, talent.id) ? ranks[talent.id] : 0;
  let total = 0;
  const rows = new Map();
  for (const talent of catalogue.talents) {
    const rank = rankOf(talent);
    total += rank;
    const key = `${talent.tree}/${talent.row}`;
    rows.set(key, (rows.get(key) ?? 0) + rank);
  }
  const above = (talent) => {
    let points = 0;
    for (let row = 1; row < talent.row; row += 1) {
      points += rows.get(`${talent.tree}/${row}`) ?? 0;
    }
    return points;
  };
  return { rankOf, total, above };
}

// Check that a build is one a character can have, and throw one RangeError that
// lists every problem, naming talents by id and never by display name. The
// rules are the Classic ones, with the numbers in data/constants.js:
//   - the build spends exactly k("talents.maxPoints") points (the export's
//     classic_total, 51): no fewer, so a half-made build is not run as if it
//     were a whole one;
//   - a talent with a prerequisite (`req`, the talent it hangs below) has its
//     prerequisite at full rank, as in the Classic tree;
//   - a talent on row r needs k("talents.rowGating") * (r - 1) points spent in
//     its own tree on the rows above it (an assumption: the export does not
//     say, OQ14).
// Ids and ranks are checked first, as expandTalents does. It returns the points
// spent. A build with no ranks is not a build: applyBuild does not call this for
// it, and a direct call reports its 0 points like any other total.
export function validateBuild(ranks, catalogue = talentCatalogue) {
  checkRanks(ranks, catalogue, "validateBuild");
  const { rankOf, total, above } = spending(ranks, catalogue);
  const problems = [];
  const needed = k("talents.maxPoints");
  if (total !== needed) {
    problems.push(
      `the build spends ${total} talent points, and exactly ${needed} are needed (talents.maxPoints)`,
    );
  }
  for (const talent of catalogue.talents) {
    if (rankOf(talent) === 0) {
      continue;
    }
    if (talent.req !== null) {
      const required = catalogue.get(talent.req);
      if (rankOf(required) < required.max) {
        problems.push(
          `"${talent.id}" needs its prerequisite "${talent.req}" at rank ${required.max}, and it is at rank ${rankOf(required)}`,
        );
      }
    }
    const rowPoints = k("talents.rowGating") * (talent.row - 1);
    const spent = above(talent);
    if (spent < rowPoints) {
      problems.push(
        `"${talent.id}" is on row ${talent.row} of ${talent.tree}, which needs ${rowPoints} points on the rows above it (talents.rowGating), and the build has ${spent}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new RangeError(`Talent build is not valid: ${problems.join("; ")}.`);
  }
  return total;
}

// What a selected build gives a fight (D7). `ranks` is config.talents. A build
// with no ranks is no build: `selected` is false, nothing is given, and the
// fight is the one it was before talents (the placeholder rotation casts every
// ability on its list). Any other build is validated, then expanded:
//
//   selected   whether a build was chosen (at least one rank above 0)
//   points     the points it spends
//   modifiers, procs, abilities, noDps, unmapped   as expandTalents gives them
export function applyBuild(
  ranks = {},
  effects = TALENT_EFFECTS,
  catalogue = talentCatalogue,
) {
  checkRanks(ranks, catalogue, "applyBuild");
  const points = spending(ranks, catalogue).total;
  const selected = points > 0;
  if (selected) {
    validateBuild(ranks, catalogue);
  }
  return Object.freeze({
    selected,
    points,
    ...expandTalents(ranks, effects, catalogue),
  });
}

// The ids of the abilities some talent grants, from the effects data. With a
// build selected, the rotation casts one of these only when the build has the
// talent (Rogue.rotation); an ability no talent grants is never held back.
export const talentGrantedAbilities = Object.freeze(
  new Set(
    Object.values(TALENT_EFFECTS)
      .map((entry) => entry.ability)
      .filter((id) => id !== undefined),
  ),
);

// Fail the import on bad data: the shape, and every rank table at every rank.
checkTalentEffects();
expandTalents();
