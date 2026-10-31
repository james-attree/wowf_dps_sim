import { k } from "../data/constants.js";
import {
  AbilityParseError,
  NUMBER,
  deepFreeze,
  isObject,
  rankOf,
  toNumber,
} from "./abilities.js";
import { spellIconUrl } from "./icons.js";
import { snapshot } from "./snapshot.js";
import { defineProc } from "./procs.js";
import { slugify } from "./talents.js";

// The poison definitions (roadmap D9, #104). Each rogue poison is read from the
// vendored talentsforever snapshot's `spell_desc` text, rank by rank: the
// chance to apply per strike, the direct damage range or the damage over time,
// the duration, the most stacks, and the charges. Definitions are data only.
// The catalogue rolls nothing. poisonProcs (below, A5 #105) turns the poisons a
// SimConfig puts on the weapons into procs (js/procs.js) that the fight runs.
//
// The parser follows the ability parser (js/abilities.js, D1 #93). It reads
// every sentence it understands and throws on text it does not, with an
// AbilityParseError that names the poison and the rank, so a refreshed
// snapshot with a reworded tooltip fails the import and does not become a
// silent null. Which poisons deal DPS comes from `poison.spells`; every other
// poison needs a reason in `poison.noDpsReasons` and is an explicit no-op.
//
// This module is pure: no DOM, no clock, no random numbers, no fetch.

// The sentences of a poison's text, in order. A text is
//   COATING EFFECT [STACKS] [CHARGES]
// and each part is matched whole, so an extra or reworded sentence is left
// over and rejected, never skipped.
const COATING = new RegExp(
  `^Coats a weapon with poison that lasts for (?<coating>${NUMBER}) (?<unit>minutes?|min|sec|seconds?)\\. ` +
    `Each strike has a (?<chance>${NUMBER})% chance of poisoning the enemy`,
);

// One entry per kind of effect. `read` turns the named groups of `pattern`
// into the effect's fields (the kind is added by the caller). `stacks` says
// whether the kind may carry a "Stacks up to N times" sentence.
const EFFECTS = [
  {
    kind: "damage",
    stacks: false,
    pattern: new RegExp(
      `^ which instantly inflicts (?<min>${NUMBER}) to (?<max>${NUMBER}) (?<school>\\p{L}+) damage\\.`,
      "u",
    ),
    read: (g) => ({
      school: g.school,
      min: toNumber(g.min),
      max: toNumber(g.max),
    }),
  },
  {
    kind: "dot",
    stacks: true,
    pattern: new RegExp(
      `^ for (?<damage>${NUMBER}) (?<school>\\p{L}+) damage over (?<duration>${NUMBER}) sec\\.`,
      "u",
    ),
    read: (g) => ({
      school: g.school,
      damage: toNumber(g.damage),
      duration: toNumber(g.duration),
    }),
  },
  {
    kind: "healingReduction",
    stacks: true,
    pattern: new RegExp(
      `^, reducing all healing effects used on them by (?<amount>${NUMBER}) for (?<duration>${NUMBER}) sec\\.`,
    ),
    read: (g) => ({
      amount: toNumber(g.amount),
      duration: toNumber(g.duration),
    }),
  },
  {
    kind: "slow",
    stacks: false,
    pattern: new RegExp(
      `^, slowing their movement speed by (?<percent>${NUMBER})% for (?<duration>${NUMBER}) sec\\.`,
    ),
    read: (g, scale) => ({
      fraction: toNumber(g.percent) / scale,
      duration: toNumber(g.duration),
    }),
  },
  {
    kind: "castSlow",
    stacks: false,
    pattern: new RegExp(
      `^, increasing their casting time by (?<percent>${NUMBER})% for (?<duration>${NUMBER}) sec\\.`,
    ),
    read: (g, scale) => ({
      fraction: toNumber(g.percent) / scale,
      duration: toNumber(g.duration),
    }),
  },
];

const STACKS = new RegExp(
  `^ Stacks up to (?<stacks>${NUMBER}) times on a single target\\.`,
);
const CHARGES = new RegExp(`^ (?<charges>${NUMBER}) charges\\.`);

// The cells of `l`. A poison's cells are the cast time, the reagents and what
// it makes. None of them is modelled, but an unknown one is an error, as in
// the ability parser.
function checkCells(entry, fail) {
  for (const row of entry.l) {
    if (!Array.isArray(row) || !row.every((cell) => typeof cell === "string")) {
      fail("a row of cells is not a list of strings", JSON.stringify(row));
    }
    for (const cell of row) {
      if (
        cell !== "" &&
        !new RegExp(`^${NUMBER} sec cast$`).test(cell) &&
        !/^(?:Reagents|Makes): /.test(cell)
      ) {
        fail(`unrecognised cell ${JSON.stringify(cell)}`);
      }
    }
  }
}

function wholeNumber(text, what, fail) {
  const value = toNumber(text);
  if (!Number.isInteger(value) || value < 1) {
    fail(`${what} ${text} is not a whole number of at least 1`);
  }
  return value;
}

function positive(value, what, fail) {
  if (!(value > 0)) {
    fail(`${what} must be above 0`);
  }
}

// Builds one rank of one poison from one spell_desc entry. `key` is the entry's
// snapshot key. It throws an AbilityParseError on the first of:
//   - an entry that is not { l: [...], d: string, id: whole number };
//   - a cell that is not a cast time, the reagents or what it makes;
//   - text that does not start with the coating sentence and a chance;
//   - an effect sentence that is none of the known kinds;
//   - a chance outside 0 to 100 percent, or a duration or amount not above 0;
//   - a damage range with min above max, a damage school that is not the
//     entry's own `sc` (or an `sc` the text does not name);
//   - a "Stacks up to N times" sentence on a kind that does not stack, or a
//     stack count or charge count that is not a whole number of at least 1;
//   - any text left over once the sentences above are read.
// `effect` is { kind: "damage", school, min, max }, { kind: "dot", school,
// damage, duration, maxStacks }, { kind: "healingReduction", amount,
// duration, maxStacks }, { kind: "slow", fraction, duration } or
// { kind: "castSlow", fraction, duration }. Times are seconds, `fraction`
// and `chance` are 0 to 1. `charges` is null when the text gives none, and a
// kind with no stacking sentence has maxStacks 1.
export function parsePoison({ name, rank, key, entry }, read = k) {
  const fail = (problem, text) => {
    throw new AbilityParseError(name, rank, problem, text);
  };
  if (
    !isObject(entry) ||
    !Array.isArray(entry.l) ||
    typeof entry.d !== "string" ||
    !Number.isInteger(entry.id)
  ) {
    fail(`the spell_desc entry ${JSON.stringify(key)} lacks l, d or id`);
  }
  checkCells(entry, fail);
  const text = entry.d;
  const failText = (problem) => fail(problem, text);
  const scale = read("abilities.percentScale");

  const start = COATING.exec(text);
  if (start === null) {
    failText(
      "the text does not start with the coating sentence and a chance per strike",
    );
  }
  const coatingNumber = toNumber(start.groups.coating);
  const coatingSeconds = /^min/.test(start.groups.unit)
    ? coatingNumber * read("abilities.secondsPerMinute")
    : coatingNumber;
  const chance = toNumber(start.groups.chance) / scale;
  if (!(chance > 0 && chance <= 1)) {
    failText(
      `the chance ${start.groups.chance}% is not above 0 and at most 100`,
    );
  }
  positive(coatingSeconds, "the coating duration", failText);

  let rest = text.slice(start[0].length);
  let effect = null;
  let kind = null;
  for (const candidate of EFFECTS) {
    const match = candidate.pattern.exec(rest);
    if (match !== null) {
      kind = candidate;
      effect = { kind: candidate.kind, ...candidate.read(match.groups, scale) };
      rest = rest.slice(match[0].length);
      break;
    }
  }
  if (effect === null) {
    failText("the effect sentence is not one the parser knows");
  }
  if (effect.kind === "damage") {
    if (effect.min > effect.max) {
      failText("the damage range has min above max");
    }
    positive(effect.min, "the damage", failText);
  } else if (effect.kind === "dot") {
    positive(effect.damage, "the damage over time", failText);
  }
  if ("school" in effect) {
    effect.school = effect.school.toLowerCase();
    const named = typeof entry.sc === "string" ? entry.sc.toLowerCase() : null;
    if (named !== effect.school) {
      failText(
        `the text says ${effect.school} damage but the entry's school is ${JSON.stringify(entry.sc)}`,
      );
    }
  }
  for (const field of ["amount", "duration", "fraction"]) {
    if (field in effect) {
      positive(effect[field], `the ${field}`, failText);
    }
  }

  const stacks = STACKS.exec(rest);
  if (stacks !== null) {
    if (!kind.stacks) {
      failText(
        `a ${effect.kind} poison does not stack, but the text says it does`,
      );
    }
    rest = rest.slice(stacks[0].length);
  }
  if (kind.stacks) {
    effect.maxStacks =
      stacks === null
        ? 1
        : wholeNumber(stacks.groups.stacks, "the stack count", failText);
  }

  const charges = CHARGES.exec(rest);
  if (charges !== null) {
    rest = rest.slice(charges[0].length);
  }
  if (rest !== "") {
    failText(`there is text the parser does not read: ${JSON.stringify(rest)}`);
  }

  return {
    id: slugify(name),
    name,
    rank,
    spellId: entry.id,
    chance,
    coatingDuration: coatingSeconds,
    charges:
      charges === null
        ? null
        : wholeNumber(charges.groups.charges, "the charge count", failText),
    effect,
    text,
  };
}

// ---- the catalogue ------------------------------------------------------

// Builds the catalogue from a parsed talentsforever export. `read` is the
// constant reader (k). It reads every rank of every spell in the spellbook tab
// named by `poison.tab` and throws an AbilityParseError on the first of:
//   - a missing spellbook, a missing poison tab, or a spell that is not a
//     [name, rank label] pair (the spells in `poison.tabSkip`, which are not
//     poisons, are left out);
//   - a rank label that is not "Rank N", a rank listed twice, or ranks that do
//     not run 1, 2, 3 and so on;
//   - a spell with no spell_desc entry for a listed rank;
//   - a poison that is neither in `poison.spells` (a DPS poison) nor in
//     `poison.noDpsReasons`, or in both, or a name in either that is not in
//     the tab, or a reason that is not text;
//   - the poisons in the tab not matching `config.poisonIds`, as a set;
//   - everything parsePoison checks.
// The result is deeply frozen:
//
//   catalogue.poisons         every poison, in spellbook order
//   catalogue.dps             the DPS poisons (in `poison.spells` order)
//   catalogue.noOps           the poisons with no DPS effect, with a reason
//   catalogue.get(id)         a poison by id (the slug of its name), or undefined
//   catalogue.byKey(key)      a poison by its config id ("instant"), or undefined
//   catalogue.rank(id, n)     rank n of a poison, or undefined
//
// A poison is { id, key, name, dps, noDpsReason, ranks, top }: `key` is the id
// with the trailing "-poison" taken off, the form config.poisonIds uses;
// `ranks` is a list of what parsePoison returns, in rank order; `top` is the
// highest rank; `noDpsReason` is text for a no-op and null for a DPS poison.
export function buildPoisonCatalogue(source, read = k) {
  const tabs = source?.spellbook?.tabs;
  const descriptions = source?.spell_desc;
  const className = source?.class;
  if (
    !Array.isArray(tabs) ||
    !isObject(descriptions) ||
    typeof className !== "string"
  ) {
    throw new AbilityParseError(
      "the snapshot",
      null,
      "it has no spellbook.tabs, spell_desc or class",
    );
  }
  const tabName = read("poison.tab");
  const tab = tabs.find((candidate) => candidate?.name === tabName);
  if (tab === undefined || !Array.isArray(tab.spells)) {
    throw new AbilityParseError(
      tabName,
      null,
      `the snapshot has no spellbook tab named ${JSON.stringify(tabName)}`,
    );
  }

  // The listed ranks of each poison, in the order the poisons first appear.
  const listed = new Map();
  for (const pair of tab.spells) {
    if (
      !Array.isArray(pair) ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    ) {
      throw new AbilityParseError(
        tabName,
        null,
        `a spellbook entry is not a [name, rank label] pair: ${JSON.stringify(pair)}`,
      );
    }
    const [name, label] = pair;
    if (read("poison.tabSkip").includes(slugify(name))) {
      continue;
    }
    const rank = rankOf(label, name, (spell, problem) => {
      throw new AbilityParseError(spell, null, problem);
    });
    if (!/^Rank /.test(label)) {
      throw new AbilityParseError(
        name,
        null,
        `the rank label ${JSON.stringify(label)} is not "Rank N"`,
      );
    }
    const ranks = listed.get(name) ?? [];
    if (ranks.some((entry) => entry.rank === rank)) {
      throw new AbilityParseError(name, rank, "the rank is listed twice");
    }
    ranks.push({ rank, label });
    listed.set(name, ranks);
  }

  const dpsIds = read("poison.spells");
  const reasons = read("poison.noDpsReasons");
  const poisons = [];
  const byId = new Map();
  for (const [name, ranks] of listed) {
    const id = slugify(name);
    if (byId.has(id)) {
      throw new AbilityParseError(
        name,
        null,
        `two poisons have the id ${JSON.stringify(id)}`,
      );
    }
    ranks.sort((a, b) => a.rank - b.rank);
    ranks.forEach((entry, index) => {
      if (entry.rank !== index + 1) {
        throw new AbilityParseError(
          name,
          entry.rank,
          `the ranks do not run from 1 without a gap (expected rank ${index + 1})`,
        );
      }
    });

    const isDps = dpsIds.includes(id);
    const reason = Object.hasOwn(reasons, id) ? reasons[id] : null;
    if (isDps === (reason !== null)) {
      throw new AbilityParseError(
        name,
        null,
        isDps
          ? `${id} is in poison.spells and in poison.noDpsReasons`
          : `${id} is in neither poison.spells nor poison.noDpsReasons`,
      );
    }
    if (reason !== null && (typeof reason !== "string" || reason === "")) {
      throw new AbilityParseError(
        name,
        null,
        `the no-DPS reason for ${id} is not text`,
      );
    }

    const parsed = ranks.map(({ rank, label }) => {
      const key = `${className}|${name}|${label}`;
      return deepFreeze(
        parsePoison({ name, rank, key, entry: descriptions[key] }, read),
      );
    });
    const poison = {
      id,
      key: id.replace(/-poison$/, ""),
      name,
      dps: isDps,
      noDpsReason: reason,
      ranks: parsed,
      top: parsed[parsed.length - 1],
    };
    byId.set(id, poison);
    poisons.push(poison);
  }

  for (const id of [...dpsIds, ...Object.keys(reasons)]) {
    if (!byId.has(id)) {
      throw new AbilityParseError(
        tabName,
        null,
        `${id} is named in poison.spells or poison.noDpsReasons but is not in the ${JSON.stringify(tabName)} tab`,
      );
    }
  }
  const keys = poisons.map((poison) => poison.key).sort();
  const configured = [...read("config.poisonIds")].sort();
  if (JSON.stringify(keys) !== JSON.stringify(configured)) {
    throw new AbilityParseError(
      tabName,
      null,
      `the poisons in the tab (${keys.join(", ")}) are not config.poisonIds (${configured.join(", ")})`,
    );
  }

  const catalogue = {
    poisons,
    dps: dpsIds.map((id) => byId.get(id)),
    noOps: poisons.filter((poison) => !poison.dps),
    get(id) {
      return byId.get(id);
    },
    byKey(key) {
      return poisons.find((poison) => poison.key === key);
    },
    rank(id, number) {
      return byId.get(id)?.ranks[number - 1];
    },
  };
  return deepFreeze(catalogue);
}

// The catalogue for the vendored snapshot, built once when the module loads.
export const poisonCatalogue = buildPoisonCatalogue(snapshot);

// ---- the poisons on the weapons, as procs --------------------------------

// The proc of one DPS poison on one hand, from its top rank (the export's
// highest: Instant Poison VI, Deadly Poison V). A strike of the hand that lands
// rolls the poison's chance (flat, one draw: js/procs.js), then the poison's
// action rolls the spell hit (spell.missTarget, one draw).
//   damage  a direct hit: the damage range, from its own source (the id of the
//           poison, a nature spell that skips armor).
//   dot     a stacking damage over time: the export gives its total for one
//           application, which the Classic tick count (poison.deadlyTick) splits
//           into ticks, `interval` apart. Each stack adds one tick of that
//           size. The poison's own target aura (js/auras.js, same id) counts
//           the stacks, up to the export's most.
// A charge is never used up (poison.charges is "unlimited").
function poisonProc(poison, hand, read, bonus) {
  const { effect } = poison.top;
  // A9 (#266): a poisonChance bonus adds percentage points, capped at
  // poison.chanceCap. The sum is taken in whole points (poison.chancePoints per
  // 1) and divided once, so 20% + 10 is exactly 0.3, not 0.30000000000000004.
  // At 0 the export's chance stands untouched (no float op).
  const points = read("poison.chancePoints");
  const chance =
    bonus > 0
      ? Math.min(
          read("poison.chanceCap"),
          Math.round((poison.top.chance + bonus) * points) / points,
        )
      : poison.top.chance;
  const id = `${poison.id}.${hand}`;
  // A poison rolls on every landed hit of its hand: a white swing, and any
  // ability, finishers included (they count as main-hand attacks). That is how
  // wowsims does it: its main-hand mask includes the specials. It is a
  // deliberate reference choice, not verified against real Classic. See
  // "Poison procs" in docs/mechanics.md.
  const scope = { hands: [hand] };
  const rule = { mode: "flat", value: chance };
  if (effect.kind === "damage") {
    return defineProc({
      id,
      trigger: "onHit",
      scope,
      chance: rule,
      actions: [
        {
          type: "dealDamage",
          id: poison.id,
          name: poison.name,
          icon: spellIconUrl(poison.name),
          min: effect.min,
          max: effect.max,
          spellHit: true,
          canCrit: true,
        },
      ],
    });
  }
  if (effect.kind === "dot") {
    const { interval, ticks } = read("poison.deadlyTick");
    if (effect.duration !== interval * ticks) {
      throw new RangeError(
        `${poison.name} lasts ${effect.duration} s in the export, and poison.deadlyTick gives ${ticks} ticks ${interval} s apart.`,
      );
    }
    return defineProc({
      id,
      trigger: "onHit",
      scope,
      chance: rule,
      actions: [
        {
          type: "applyDot",
          id: poison.id,
          name: poison.name,
          icon: spellIconUrl(poison.name),
          tickDamage: effect.damage / ticks,
          interval,
          duration: effect.duration,
          aura: poison.id,
          spellHit: true,
        },
      ],
    });
  }
  throw new RangeError(
    `${poison.name} is a DPS poison with a "${effect.kind}" effect, which poisonProcs does not simulate.`,
  );
}

// The procs for a SimConfig's poisons ({ mainHand, offHand }: a poison key or
// null for each hand, as normalizeConfig gives them), main hand first. A hand
// with none, and a poison that deals no DPS here (Wound, Crippling and
// Mind-numbing: poison.noDpsReasons), gives no proc, so a build without a DPS
// poison has no procs and draws no extra random numbers.
// `bonus` is the resolved poisonChance (A9, #266), 0 by default.
export function poisonProcs(
  poisons,
  catalogue = poisonCatalogue,
  read = k,
  bonus = 0,
) {
  const procs = [];
  for (const [hand, key] of Object.entries(poisons ?? {})) {
    if (key === null || key === undefined) {
      continue;
    }
    const poison = catalogue.byKey(key);
    if (poison === undefined) {
      throw new RangeError(
        `poisons.${hand} names "${String(key)}", which is not a poison in the catalogue.`,
      );
    }
    if (poison.dps) {
      procs.push(poisonProc(poison, hand, read, bonus));
    }
  }
  return procs;
}
