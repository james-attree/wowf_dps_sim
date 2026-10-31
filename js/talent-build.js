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
  "mobTypes",
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
    if (
      entry.mobTypes !== undefined &&
      (!Array.isArray(entry.mobTypes) ||
        entry.mobTypes.length === 0 ||
        entry.mobTypes.some((type) => typeof type !== "string" || type === ""))
    ) {
      fail(id, "mobTypes must be a non-empty list of target types.");
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
        `Talent "${id}" has ranks 0 to ${talent.max}. Got ${typeof rank === "string" ? JSON.stringify(rank) : String(rank)}.`,
      );
    }
  }
}

export function expandTalents(
  ranks = {},
  effects = TALENT_EFFECTS,
  catalogue = talentCatalogue,
  target = { mobType: k("target.mobType") },
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
    if (
      entry.mobTypes !== undefined &&
      !entry.mobTypes.includes(target.mobType)
    ) {
      // Murder (#266): mapped, but off against any other target type.
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
// in `ranks` is rank 0. It never throws: an id the catalogue does not know and
// a rank that is not a whole number from 0 to the talent's max count for
// nothing, so the picker (U6) can ask about a build that is not valid yet.
function spending(ranks, catalogue) {
  const given = isObject(ranks) ? ranks : {};
  const rankOf = (talent) => {
    const rank = Object.hasOwn(given, talent.id) ? given[talent.id] : 0;
    return Number.isInteger(rank) && rank >= 0 && rank <= talent.max ? rank : 0;
  };
  let total = 0;
  const rows = new Map();
  const trees = new Map(catalogue.trees.map((tree) => [tree.id, 0]));
  for (const talent of catalogue.talents) {
    const rank = rankOf(talent);
    total += rank;
    trees.set(talent.tree, (trees.get(talent.tree) ?? 0) + rank);
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
  return { rankOf, total, trees, above };
}

// Partial builds and the talent level (#190, P3.5-04). A build may spend from
// 0 points up to its cap. The cap is the talent level's points, level - 9 (the
// Classic rule of one point a level from k("talents.firstPointLevel"), 10,
// tagged `assumption`), and never more than k("talents.maxPoints") (51). The
// level runs from 10 (1 point) to 60 (51 points), and 60 is the default, so a
// build with no level is capped at 51 as before. The level caps the points and
// nothing else: it is config.talentLevel (js/sim-config.js), not
// character.level, and the armor divisor never reads it.

// The lowest and highest talent level, and the default (the highest).
export function talentLevelRange() {
  const min = k("talents.firstPointLevel");
  return Object.freeze({ min, max: k("talents.maxPoints") + min - 1 });
}

export const DEFAULT_TALENT_LEVEL = talentLevelRange().max;

function levelProblem(level) {
  const { min, max } = talentLevelRange();
  if (Number.isInteger(level) && level >= min && level <= max) {
    return null;
  }
  return {
    code: "badLevel",
    talent: null,
    need: Number.isFinite(level) && level > max ? max : min,
    have: level === undefined ? null : level,
    message: `the talent level must be a whole number from ${min} to ${max}, not ${typeof level === "string" ? JSON.stringify(level) : String(level)}`,
  };
}

// The talent level an options argument asks for. Options that are not an
// object (null, a number, a string) or that leave the level out ask for the
// default, so the non-throwing checks never throw on them (#190).
function levelOf(options) {
  return isObject(options) && options.level !== undefined
    ? options.level
    : DEFAULT_TALENT_LEVEL;
}

// The points a character of `level` can spend: level - 9, so 51 at 60 and 1
// at 10. It throws a RangeError for a level outside 10 to 60.
export function talentPointCap(level = DEFAULT_TALENT_LEVEL) {
  const problem = levelProblem(level);
  if (problem !== null) {
    throw new RangeError(
      `${problem.message.charAt(0).toUpperCase()}${problem.message.slice(1)}.`,
    );
  }
  return Math.min(
    level - k("talents.firstPointLevel") + 1,
    k("talents.maxPoints"),
  );
}

// The cap the non-throwing functions use: a bad level falls back to the
// default, and the level problem is reported on its own.
function capOf(level) {
  return levelProblem(level) === null
    ? talentPointCap(level)
    : k("talents.maxPoints");
}

// Points by tree, for the picker's header and the build label. It never
// throws: anything that is not a valid rank counts for nothing.
//   pointsByTree({ "combat.precision": 3 })
//   -> { assassination: 0, combat: 3, subtlety: 0, total: 3 }
export function pointsByTree(ranks, catalogue = talentCatalogue) {
  const { trees, total } = spending(ranks, catalogue);
  return Object.freeze({ ...Object.fromEntries(trees), total });
}

function problem(code, talent, need, have, message) {
  return Object.freeze({ code, talent, need, have, message });
}

function inputProblems(ranks, catalogue) {
  if (!isObject(ranks)) {
    return [
      problem(
        "notAnObject",
        null,
        null,
        null,
        `a build must be an object of { talent id: rank }, not ${kindOf(ranks)}`,
      ),
    ];
  }
  const problems = [];
  for (const [id, rank] of Object.entries(ranks)) {
    const talent = catalogue.get(id);
    if (talent === undefined) {
      problems.push(
        problem(
          "unknownTalent",
          id,
          null,
          null,
          `${JSON.stringify(id)} is not a talent id. Use a catalogue id such as "combat.precision"`,
        ),
      );
    } else if (!Number.isInteger(rank) || rank < 0 || rank > talent.max) {
      problems.push(
        problem(
          "badRank",
          id,
          talent.max,
          rank,
          `"${id}" has ranks 0 to ${talent.max}, not ${typeof rank === "string" ? JSON.stringify(rank) : String(rank)}`,
        ),
      );
    }
  }
  return problems;
}

// The rules of the tree, for the valid ranks of a build: the cap, then each
// talent's prerequisite and row.
function ruleProblems(spent, level, catalogue) {
  const { rankOf, total, above } = spent;
  const problems = [];
  const maxPoints = k("talents.maxPoints");
  if (total > maxPoints) {
    problems.push(
      problem(
        "overMax",
        null,
        maxPoints,
        total,
        `the build spends ${total} talent points, and at most ${maxPoints} can be spent (talents.maxPoints)`,
      ),
    );
  }
  const cap = capOf(level);
  if (cap < maxPoints && total > cap) {
    problems.push(
      problem(
        "overLevel",
        null,
        cap,
        total,
        `the build spends ${total} talent points, and a level ${level} character can spend at most ${cap} (level - ${k("talents.firstPointLevel") - 1}, talents.firstPointLevel)`,
      ),
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
          problem(
            "prerequisite",
            talent.id,
            required.max,
            rankOf(required),
            `"${talent.id}" needs its prerequisite "${talent.req}" at rank ${required.max}, and it is at rank ${rankOf(required)}`,
          ),
        );
      }
    }
    const rowPoints = k("talents.rowGating") * (talent.row - 1);
    const points = above(talent);
    if (points < rowPoints) {
      problems.push(
        problem(
          "rowGate",
          talent.id,
          rowPoints,
          points,
          `"${talent.id}" is on row ${talent.row} of ${talent.tree}, which needs ${rowPoints} points on the rows above it (talents.rowGating), and the build has ${points}`,
        ),
      );
    }
  }
  return problems;
}

// Everything wrong with a build, as data, for the picker (U6) to show without
// parsing text. It never throws, and an empty list is a legal build. Each
// entry is frozen { code, talent, need, have, message }: `talent` is the id the
// problem is about (null for the build as a whole), `need` and `have` the two
// numbers that disagree, and `message` the text validateBuild throws, naming
// talents by id. The codes:
//
//   notAnObject    the build is not a { talent id: rank } object (alone)
//   unknownTalent  an id the catalogue does not know (need and have null)
//   badRank        a rank that is not a whole number from 0 to max
//                  (need: the max, have: the rank)
//   badLevel       the level is not a whole number from 10 to 60
//                  (need: the bound it missed, have: the level)
//   overMax        more than k("talents.maxPoints") (51) points
//   overLevel      more than the level's level - 9 points (below 60 only)
//   prerequisite   a talent's `req` is not at full rank
//                  (need: the req's max, have: its rank)
//   rowGate        too few points on the rows above a talent, in its tree
//                  (need: rowGating * (row - 1), have: the points)
//
// Fewer points than the cap is not a problem (#190).
export function buildProblems(
  ranks,
  options = {},
  catalogue = talentCatalogue,
) {
  const level = levelOf(options);
  const problems = inputProblems(ranks, catalogue);
  const bad = levelProblem(level);
  if (bad !== null) {
    problems.push(bad);
  }
  if (problems.length > 0 && problems[0].code === "notAnObject") {
    return Object.freeze(problems);
  }
  problems.push(...ruleProblems(spending(ranks, catalogue), level, catalogue));
  return Object.freeze(problems);
}

// Why `action` ("add" or "remove") on one point of talent `id` is refused, or
// null when it is allowed. It never throws. The answer is one problem entry
// ({ code, talent, need, have, message }) and `blockers`, the ids of the
// talents in the way. It judges the one change: a build that is already
// illegal elsewhere does not block it, and a remove is refused only for a
// problem the remove itself makes. The codes, besides the input ones above
// (notAnObject, unknownTalent, badRank, badLevel) and badAction:
//
//   add     maxRank      the talent is at its max (need: max, have: rank)
//           capReached   the build has spent its cap (need: cap, have: points)
//           prerequisite the talent's `req` is not at full rank (blockers: [req])
//           rowGate      too few points on the rows above it
//   remove  notTaken     the talent is at rank 0
//           strands      a talent that is taken would lose its prerequisite or
//                        its row (talent: the one that would be stranded,
//                        need and have its rule's numbers after the remove,
//                        blockers: every stranded id)
export function why(
  ranks,
  id,
  action = "add",
  options = {},
  catalogue = talentCatalogue,
) {
  const level = levelOf(options);
  const refuse = (entry, blockers = []) =>
    Object.freeze({ ...entry, blockers: Object.freeze(blockers) });
  if (action !== "add" && action !== "remove") {
    return refuse(
      problem(
        "badAction",
        typeof id === "string" ? id : null,
        null,
        action,
        `the action must be "add" or "remove", not ${typeof action === "string" ? JSON.stringify(action) : String(action)}`,
      ),
    );
  }
  const talent = typeof id === "string" ? catalogue.get(id) : undefined;
  if (talent === undefined) {
    return refuse(
      problem(
        "unknownTalent",
        typeof id === "string" ? id : null,
        null,
        null,
        `${typeof id === "string" ? JSON.stringify(id) : String(id)} is not a talent id. Use a catalogue id such as "combat.precision"`,
      ),
    );
  }
  const input = inputProblems(ranks, catalogue);
  if (input.length > 0) {
    return refuse(input[0]);
  }
  const bad = levelProblem(level);
  if (bad !== null) {
    return refuse(bad);
  }
  const spent = spending(ranks, catalogue);
  const rank = spent.rankOf(talent);
  if (action === "add") {
    if (rank >= talent.max) {
      return refuse(
        problem(
          "maxRank",
          talent.id,
          talent.max,
          rank,
          `"${talent.id}" is at its full rank, ${talent.max}`,
        ),
      );
    }
    const cap = capOf(level);
    if (spent.total >= cap) {
      return refuse(
        problem(
          "capReached",
          talent.id,
          cap,
          spent.total,
          `the build has spent ${cap === 1 ? "the 1 talent point" : `all ${cap} talent points`} a level ${level} character has`,
        ),
      );
    }
    const next = ruleProblems(
      spending({ ...ranks, [talent.id]: rank + 1 }, catalogue),
      level,
      catalogue,
    ).filter((entry) => entry.talent === talent.id);
    const req = next.find((entry) => entry.code === "prerequisite");
    if (req !== undefined) {
      return refuse(req, [talent.req]);
    }
    const row = next.find((entry) => entry.code === "rowGate");
    if (row !== undefined) {
      return refuse(row);
    }
    return null;
  }
  if (rank === 0) {
    return refuse(
      problem(
        "notTaken",
        talent.id,
        1,
        0,
        `"${talent.id}" has no point to take back`,
      ),
    );
  }
  const key = (entry) => `${entry.code}/${entry.talent}`;
  const before = new Set(ruleProblems(spent, level, catalogue).map(key));
  const after = { ...ranks, [talent.id]: rank - 1 };
  // ruleProblems only looks at talents that are taken, so each of these is a
  // talent with points that the remove would leave illegal.
  const stranded = ruleProblems(
    spending(after, catalogue),
    level,
    catalogue,
  ).filter(
    (entry) =>
      (entry.code === "prerequisite" || entry.code === "rowGate") &&
      !before.has(key(entry)),
  );
  if (stranded.length === 0) {
    return null;
  }
  const first = stranded[0];
  return refuse(
    problem(
      "strands",
      first.talent,
      first.need,
      first.have,
      `taking a point from "${talent.id}" would strand a talent: ${first.message}`,
    ),
    [...new Set(stranded.map((entry) => entry.talent))],
  );
}

// Whether one point can go into talent `id`, or come out of it. They never
// throw: a bad build, id or level is a refusal, and why() says which.
export function canAdd(ranks, id, options = {}, catalogue = talentCatalogue) {
  return why(ranks, id, "add", options, catalogue) === null;
}

export function canRemove(
  ranks,
  id,
  options = {},
  catalogue = talentCatalogue,
) {
  return why(ranks, id, "remove", options, catalogue) === null;
}

// The throwing check (D7, #106; partial builds since #190): that a build is
// one a character of `level` can have. Ids and ranks are checked first, as
// expandTalents does, with the same messages; then a bad level is a
// RangeError; then every rule problem from buildProblems is listed in one
// RangeError, "Talent build is not valid: <message>; <message>.", naming
// talents by id and never by display name. The rules are the Classic ones,
// with the numbers in data/constants.js:
//   - the build spends from 0 to its cap: at most k("talents.maxPoints") (51),
//     and at most level - 9 below level 60 (k("talents.firstPointLevel"),
//     `assumption`). Fewer is legal (#190);
//   - a talent with a prerequisite (`req`, the talent it hangs below) has its
//     prerequisite at full rank, as in the Classic tree;
//   - a talent on row r needs k("talents.rowGating") * (r - 1) points spent in
//     its own tree on the rows above it (the Classic rule of 5 points a row,
//     which WoW Forever matches, confirmed by James on 29 Oct 2026, so
//     `wowf-designer`; the export does not state the number).
// It returns the points spent. `catalogue` stays the second argument, so the
// callers from before #190 work unchanged.
export function validateBuild(
  ranks,
  catalogue = talentCatalogue,
  options = {},
) {
  const level = levelOf(options);
  checkRanks(ranks, catalogue, "validateBuild");
  talentPointCap(level);
  const problems = ruleProblems(spending(ranks, catalogue), level, catalogue);
  if (problems.length > 0) {
    throw new RangeError(
      `Talent build is not valid: ${problems.map((entry) => entry.message).join("; ")}.`,
    );
  }
  return spending(ranks, catalogue).total;
}

// What a selected build gives a fight (D7). `ranks` is config.talents. A build
// with no ranks is no build: `selected` is false, nothing is given, and the
// fight is untalented (the rotation casts no talent ability, #199). Any other build is validated, then expanded:
//
//   selected   whether a build was chosen (at least one rank above 0)
//   points     the points it spends
//   modifiers, procs, abilities, noDps, unmapped   as expandTalents gives them
//
// A partial build (#190) is a selected build like a full one, so `selected` is
// true from the first point and the talent abilities it lacks stay locked
// (Rogue.lockedByBuild). `level` is the talent level (validateBuild); the Rogue
// passes none, so its cap is 51, and normalizeConfig has already held
// config.talents to config.talentLevel's cap.
export function applyBuild(
  ranks = {},
  effects = TALENT_EFFECTS,
  catalogue = talentCatalogue,
  options = {},
) {
  const level = levelOf(options);
  checkRanks(ranks, catalogue, "applyBuild");
  const points = spending(ranks, catalogue).total;
  const selected = points > 0;
  if (selected) {
    validateBuild(ranks, catalogue, { level });
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
// Object.freeze does not stop a Set's add, delete or clear, so those throw
// (#207); has, size and iteration work as on any Set. It is a Set
// (instanceof) with no set data of its own: the values are in a Set only it
// can reach, so even Set.prototype.add.call(it, id) cannot change them; that
// throws, as for any object that is not a real Set (#210, #244).
function readOnlySet(values) {
  const inner = new Set(values);
  const set = Object.create(Set.prototype);
  for (const method of ["add", "delete", "clear"]) {
    Object.defineProperty(set, method, {
      value() {
        throw new TypeError(`talentGrantedAbilities is read-only (${method}).`);
      },
    });
  }
  Object.defineProperties(set, {
    size: { get: () => inner.size },
    has: { value: (id) => inner.has(id) },
    forEach: {
      value(each, self) {
        inner.forEach((id) => each.call(self, id, id, set));
      },
    },
    values: { value: () => inner.values() },
    keys: { value: () => inner.keys() },
    entries: { value: () => inner.entries() },
    [Symbol.iterator]: { value: () => inner.values() },
  });
  return Object.freeze(set);
}

export const talentGrantedAbilities = readOnlySet(
  Object.values(TALENT_EFFECTS)
    .map((entry) => entry.ability)
    .filter((id) => id !== undefined),
);

// Fail the import on bad data: the shape, and every rank table at every rank.
checkTalentEffects();
expandTalents();
