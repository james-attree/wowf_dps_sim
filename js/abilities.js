import { k } from "../data/constants.js";
import { snapshot } from "./snapshot.js";
import { slugify } from "./talents.js";

// The ability schema (roadmap D1). Each rogue ability is built from the
// vendored talentsforever snapshot's `spell_desc` text for its highest rank:
// the cost, the cooldown, the cast time, the combo points it awards or needs,
// the % weapon damage, any flat damage, and the per-combo-point tables. What
// the text leaves out comes from data/constants.js through k(): the AP
// coefficients (abilities.apCoefficients), which abilities skip the GCD
// (abilities.offGcd), which are bleeds (bleed.spells) and the unit scales.
//
// The parser reads every cell and sentence it understands and throws on a
// cell or table row it does not. A refreshed snapshot with a reworded tooltip
// then fails the import with an error naming the spell and rank, instead of
// quietly dropping a number. Sentences with no numbers to read (for example
// "Must be stealthed") are skipped by design; numbers inside them are not
// taken. The checks are listed on parseSpell and buildAbilityCatalogue.
//
// This module is pure: no DOM, no clock, no random numbers, no fetch. It
// reads the JSON module through js/snapshot.js. The generic executor
// (js/ability.js, D2 #98) reads two things from it: an ability's display name
// and whether it starts the GCD. The costs and the other numbers still come
// from the constants, and test/abilities.test.js checks that the catalogue
// agrees with them.
//
// What is deliberately not parsed in D1: buff and debuff magnitudes and
// lengths (Slice and Dice's haste %, Adrenaline Rush's energy %, Ghostly
// Strike's dodge, Hemorrhage's Rupture bonus), the poisons (D9) and the
// talent modifiers (D6). They stay in constants.js until the issues that need
// them.

// A spell_desc number: "9", "1,012", "0.5". Thousands commas are dropped.
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;

function toNumber(text) {
  return Number(text.replaceAll(",", ""));
}

// The error every parse failure throws. `spell` and `rank` name the offender,
// and the message starts with them.
export class AbilityParseError extends Error {
  constructor(spell, rank, problem, text) {
    const where = rank === null ? spell : `${spell} rank ${rank}`;
    super(
      `Cannot read ${where} from the spell data: ${problem}.` +
        (text === undefined ? "" : ` Text: ${JSON.stringify(text)}`),
    );
    this.name = "AbilityParseError";
    this.spell = spell;
    this.rank = rank;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// ---- cells --------------------------------------------------------------

// `l` is a list of [left, right] cells. Which row holds the cost, the
// cooldown or "Instant" changes from spell to spell, so every cell is matched
// on its own text and not on its position.
// A requirement is read as the slug of its text ("Requires Stealth" is
// "stealth"), the same slug the ability ids use.
const REQUIREMENTS = new Set(["stealth", "daggers"]);

function parseCells(cells, fail) {
  const found = {
    cost: null,
    cooldown: 0,
    castTime: null,
    finisher: null,
    passive: false,
    requires: [],
  };
  const once = (field, value, cell) => {
    if (found[field] !== null && found[field] !== 0) {
      fail(`two "${field}" cells (${JSON.stringify(cell)} and another)`);
    }
    found[field] = value;
  };

  for (const cell of cells) {
    let match;
    if (cell === "") {
      continue;
    } else if (cell === "Passive") {
      found.passive = true;
    } else if (cell === "Instant") {
      once("castTime", 0, cell);
    } else if (cell === "Melee Range") {
      // Range is not modelled.
    } else if (
      (match = cell.match(
        new RegExp(`^(?<amount>${NUMBER}) (?<unit>\\p{L}+)$`, "u"),
      )) &&
      k("abilities.resources").includes(match.groups.unit.toLowerCase())
    ) {
      // Only a known resource is a cost. "45 sec" and the like are not, and
      // fall through to the other cells (or to "unrecognised cell").
      once(
        "cost",
        {
          resource: match.groups.unit.toLowerCase(),
          amount: toNumber(match.groups.amount),
        },
        cell,
      );
    } else if (
      (match = cell.match(
        new RegExp(`^(?<amount>${NUMBER}) (?<unit>sec|min) cooldown$`),
      ))
    ) {
      once(
        "cooldown",
        match.groups.unit === "min"
          ? toNumber(match.groups.amount) * k("abilities.secondsPerMinute")
          : toNumber(match.groups.amount),
        cell,
      );
    } else if (
      (match = cell.match(new RegExp(`^(?<amount>${NUMBER}) sec cast$`)))
    ) {
      once("castTime", toNumber(match.groups.amount), cell);
    } else if (
      (match = cell.match(
        new RegExp(`^(?<min>\\d+) to (?<max>\\d+) Combo Points$`),
      ))
    ) {
      once(
        "finisher",
        { min: Number(match.groups.min), max: Number(match.groups.max) },
        cell,
      );
    } else if (new RegExp(`^${NUMBER}(?:-${NUMBER})? yd range$`).test(cell)) {
      // Range is not modelled.
    } else if (/^(?:Reagents|Tools|Makes): /.test(cell)) {
      // Crafting inputs are not modelled.
    } else if ((match = cell.match(/^Requires (?<what>.+)$/))) {
      const requirement = slugify(match.groups.what);
      if (!REQUIREMENTS.has(requirement)) {
        fail(`unknown requirement ${JSON.stringify(cell)}`);
      }
      found.requires.push(requirement);
    } else {
      fail(`unrecognised cell ${JSON.stringify(cell)}`);
    }
  }
  return found;
}

// ---- per-combo-point tables ---------------------------------------------

// A table line is "<n> point(s): <value>". The value is one of
//   "224-332 damage", "159 damage over 8 secs", "9 seconds", "21 sec",
//   "450 Armor".
// Anything else is an error: a new unit must be handled on purpose.
function parseTableValue(value, fail, line) {
  let match;
  if (
    (match = value.match(
      new RegExp(`^(?<min>${NUMBER})-(?<max>${NUMBER}) damage$`),
    ))
  ) {
    const min = toNumber(match.groups.min);
    const max = toNumber(match.groups.max);
    if (min > max) {
      fail(`the table row ${JSON.stringify(line)} has min damage above max`);
    }
    return { damage: { min, max }, duration: null, armorReduction: null };
  }
  if (
    (match = value.match(
      new RegExp(
        `^(?<damage>${NUMBER}) damage over (?<seconds>${NUMBER}) (?:secs?|seconds)$`,
      ),
    ))
  ) {
    const damage = toNumber(match.groups.damage);
    return {
      damage: { min: damage, max: damage },
      duration: toNumber(match.groups.seconds),
      armorReduction: null,
    };
  }
  if (
    (match = value.match(
      new RegExp(`^(?<seconds>${NUMBER}) (?:secs?|seconds)$`),
    ))
  ) {
    return {
      damage: null,
      duration: toNumber(match.groups.seconds),
      armorReduction: null,
    };
  }
  if ((match = value.match(new RegExp(`^(?<armor>${NUMBER}) Armor$`)))) {
    return {
      damage: null,
      duration: null,
      armorReduction: toNumber(match.groups.armor),
    };
  }
  return fail(`unrecognised table row ${JSON.stringify(line)}`);
}

const TABLE_LINE = /^\s*(?<points>\d+) points?\s*:\s*(?<value>.+?)\s*$/;

function parseTable(description, fail) {
  const rows = [];
  for (const line of description.split("\n")) {
    const match = line.match(TABLE_LINE);
    if (match === null) {
      continue;
    }
    rows.push({
      comboPoints: Number(match.groups.points),
      ...parseTableValue(match.groups.value, fail, line.trim()),
    });
  }
  return rows;
}

// ---- sentences ----------------------------------------------------------

const WEAPON_PERCENT = new RegExp(
  `(?<base>${NUMBER})%` +
    `(?: \\((?<first>${NUMBER})% if a Dagger is equipped[^)]*\\))?` +
    " weapon damage" +
    `(?: \\((?<second>${NUMBER})% if a Dagger is equipped[^)]*\\))?`,
  "i",
);

function parseWeaponPercent(description, fail) {
  const match = description.match(WEAPON_PERCENT);
  if (match !== null) {
    const scale = k("abilities.percentScale");
    const dagger = match.groups.first ?? match.groups.second;
    return {
      base: toNumber(match.groups.base) / scale,
      dagger: dagger === undefined ? null : toNumber(dagger) / scale,
    };
  }
  if (/your normal weapon damage/i.test(description)) {
    return { base: 1, dagger: null };
  }
  if (/weapon damage/i.test(description)) {
    return fail("it mentions weapon damage in a form the parser does not know");
  }
  return null;
}

function parseFlatDamage(description) {
  const patterns = [
    new RegExp(
      `weapon damage plus (?:an additional )?(?<n>${NUMBER})\\b(?!%)`,
      "i",
    ),
    new RegExp(`\\b(?:causes|for) (?<n>${NUMBER}) damage\\b(?! over)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match !== null) {
      return toNumber(match.groups.n);
    }
  }
  return null;
}

function parseDot(description) {
  const match = description.match(
    new RegExp(
      `causing (?<damage>${NUMBER}) damage over (?<seconds>${NUMBER}) sec`,
      "i",
    ),
  );
  return match === null
    ? null
    : {
        damage: toNumber(match.groups.damage),
        duration: toNumber(match.groups.seconds),
      };
}

// The text outside the per-combo-point table, which has its own parser.
function proseOf(description) {
  return description
    .split("\n")
    .filter((line) => !TABLE_LINE.test(line))
    .join("\n");
}

// Every damage number or damage-over-time sentence in the prose has to have
// been read by parseFlatDamage or parseDot, so a reworded tooltip fails here
// and does not become a silent null. "150% weapon damage" is the weapon
// percent's, and "damage" with no number ("causing no damage", "causes damage
// over time") holds nothing to read.
function checkDamageSentences(description, flatDamage, dot, fail) {
  const prose = proseOf(description);
  if (/\bdamage over \d/i.test(prose) && dot === null) {
    fail("it describes damage over time in a form the parser does not know");
  }
  const read = new Set([flatDamage, dot?.damage]);
  for (const match of prose.matchAll(
    new RegExp(`(?<![\\d.,-])(?<n>${NUMBER})(?!%|\\d)\\s+damage\\b`, "gi"),
  )) {
    if (!read.has(toNumber(match.groups.n))) {
      fail(`it has a damage number the parser does not read: ${match[0]}`);
    }
  }
}

function parseComboPointsAwarded(description) {
  const match = description.match(
    /\b(?:awards|adds) (?<n>\d+) combo points?\b/i,
  );
  return match === null ? 0 : Number(match.groups.n);
}

// ---- one spell ----------------------------------------------------------

// The AP coefficient for an ability, read through the constant named in
// abilities.apCoefficients. The text says an ability scales with Attack Power
// but never gives the number, so an ability the text marks but the map does
// not name gets null. A map entry for an ability the text does not mark is an
// error: the two sources disagree.
function readApCoefficient(id, scalesWithAttackPower, read, fail) {
  const named = read("abilities.apCoefficients")[id];
  if (named === undefined) {
    return null;
  }
  if (!scalesWithAttackPower) {
    return fail(
      `abilities.apCoefficients names ${id}, but its text does not say it scales with Attack Power`,
    );
  }
  return {
    kind: named.kind,
    constant: named.constant,
    value: read(named.constant),
  };
}

// Builds one ability from one spell_desc entry. `label` is the spellbook's rank
// label ("Rank 9", "" or "Passive") and `key` is the entry's snapshot key. It
// throws an AbilityParseError on the first of:
//   - an entry that is not { l: [...], d: string, id: whole number, sc: string };
//   - a cell the parser does not recognise, or two cells for one field;
//   - a requirement it does not know, or a "N to M Combo Points" cell whose
//     range is not 1 to M with M at least 1;
//   - a finisher whose table is missing, has a row that is not a known shape,
//     skips a combo point count, or differs from the cell's range;
//   - a table with no finisher cell, or text that says "Finishing move" with
//     no finisher cell (or the other way round);
//   - "weapon damage" in a form the parser does not know;
//   - a cost cell whose unit is not in abilities.resources, a table row with
//     min damage above max, and a damage number or damage-over-time sentence
//     that parseFlatDamage and parseDot did not read;
//   - a coefficient in abilities.apCoefficients for an ability the text does
//     not say scales with Attack Power.
export function parseSpell({ name, rank, label, tab, key, entry }, read = k) {
  const fail = (problem, text) => {
    throw new AbilityParseError(name, rank, problem, text);
  };
  if (
    !isObject(entry) ||
    !Array.isArray(entry.l) ||
    typeof entry.d !== "string" ||
    !Number.isInteger(entry.id) ||
    typeof entry.sc !== "string"
  ) {
    fail(`the spell_desc entry ${JSON.stringify(key)} lacks l, d, id or sc`);
  }

  const cells = [];
  for (const row of entry.l) {
    if (!Array.isArray(row) || !row.every((cell) => typeof cell === "string")) {
      fail("a row of cells is not a list of strings", JSON.stringify(row));
    }
    cells.push(...row);
  }
  const description = entry.d;
  const found = parseCells(cells, (problem) => fail(problem, description));

  const table = parseTable(description, (problem) =>
    fail(problem, description),
  );
  const isFinishingMove = /^Finishing move/.test(description);
  if (found.finisher === null) {
    if (isFinishingMove || table.length > 0) {
      fail(
        "the text describes a finishing move but there is no combo point cell",
        description,
      );
    }
  } else {
    const { min, max } = found.finisher;
    if (min !== 1 || max < min) {
      fail(`the combo point range ${min} to ${max} does not start at 1`);
    }
    if (!isFinishingMove) {
      fail(
        "there is a combo point cell but the text is not a finishing move",
        description,
      );
    }
    if (table.length !== max) {
      fail(
        `the table has ${table.length} rows for ${max} combo points`,
        description,
      );
    }
    table.forEach((row, index) => {
      if (row.comboPoints !== index + 1) {
        fail(
          `table row ${index + 1} is for ${row.comboPoints} combo points`,
          description,
        );
      }
    });
  }

  const passive = found.passive || label === "Passive";
  const scalesWithAttackPower = /Attack Power/.test(description);
  const weaponPercent = parseWeaponPercent(description, (problem) =>
    fail(problem, description),
  );
  const flatDamage = parseFlatDamage(description);
  const dot = parseDot(description);
  checkDamageSentences(description, flatDamage, dot, (problem) =>
    fail(problem, description),
  );
  // The constants name an ability by its id, never its display name.
  const id = slugify(name);
  const bleed = read("bleed.spells").includes(id);
  const ap = readApCoefficient(id, scalesWithAttackPower, read, (problem) =>
    fail(problem),
  );

  return {
    id,
    name,
    rank,
    spellId: entry.id,
    tab,
    school: entry.sc.toLowerCase(),
    passive,
    cost: found.cost,
    cooldown: found.cooldown,
    castTime: found.castTime,
    comboPointsAwarded: parseComboPointsAwarded(description),
    finisher: found.finisher,
    weaponPercent,
    flatDamage,
    dot,
    perComboPoint: table.length === 0 ? null : table,
    scalesWithAttackPower,
    ap,
    bleed,
    startsGcd: !passive && !read("abilities.offGcd").includes(id),
    requires: found.requires,
    text: description,
  };
}

// ---- the catalogue ------------------------------------------------------

// "Rank 9" is rank 9. "" and "Passive" are the one and only rank, 1.
function rankOf(label, name, fail) {
  if (label === "" || label === "Passive") {
    return 1;
  }
  const match = /^Rank (?<n>\d+)$/.exec(label);
  if (match === null) {
    return fail(
      name,
      `the rank label ${JSON.stringify(label)} is not understood`,
    );
  }
  return Number(match.groups.n);
}

// Builds a catalogue from a parsed talentsforever export. `read` is the
// constant reader (k), so a test can swap a constant. It parses the highest
// rank of every spell in the tabs named by `abilities.tabs` and throws an
// AbilityParseError on the first of:
//   - a missing spellbook, a configured tab that is not in it, or a spell that
//     is not a [name, rank label] pair;
//   - a rank label that is not "", "Passive" or "Rank N";
//   - a spell with no spell_desc entry for its highest rank;
//   - a duplicate ability id, or the same spell listed in two tabs;
//   - everything parseSpell checks.
// The result is deeply frozen:
//
//   catalogue.abilities     every ability, tab by tab, in spellbook order
//   catalogue.get(id)       an ability by id (the slug of its name), or undefined
//   catalogue.byName(name)  an ability by name, ignoring case; undefined if none
//
// An ability is { id, name, rank, spellId, tab, school, passive, cost,
// cooldown, castTime, comboPointsAwarded, finisher, weaponPercent, flatDamage,
// dot, perComboPoint, scalesWithAttackPower, ap, bleed, startsGcd, requires,
// text }. Times are seconds, `cost` is { resource, amount } or null,
// `weaponPercent` is { base, dagger } as multipliers or null, `finisher` is
// { min, max } combo points or null, `ap` is { kind, constant, value } or null,
// and `perComboPoint` is a list of { comboPoints, damage, duration,
// armorReduction } or null.
export function buildAbilityCatalogue(source, read = k) {
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

  const abilities = [];
  const byId = new Map();
  const failFor = (spell) => (name, problem) => {
    throw new AbilityParseError(name ?? spell, null, problem);
  };

  for (const tabName of read("abilities.tabs")) {
    const tab = tabs.find((candidate) => candidate?.name === tabName);
    if (tab === undefined || !Array.isArray(tab.spells)) {
      throw new AbilityParseError(
        tabName,
        null,
        `the snapshot has no spellbook tab named ${JSON.stringify(tabName)}`,
      );
    }

    // The highest rank of each spell, in the order the spells first appear.
    const best = new Map();
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
      const rank = rankOf(label, name, failFor(tabName));
      const current = best.get(name);
      if (current === undefined || rank > current.rank) {
        best.set(name, { name, label, rank });
      }
    }

    for (const { name, label, rank } of best.values()) {
      const key = `${className}|${name}|${label}`;
      const ability = deepFreeze(
        parseSpell(
          { name, rank, label, tab: tabName, key, entry: descriptions[key] },
          read,
        ),
      );
      if (byId.has(ability.id)) {
        throw new AbilityParseError(
          name,
          rank,
          `two abilities have the id ${JSON.stringify(ability.id)}`,
        );
      }
      byId.set(ability.id, ability);
      abilities.push(ability);
    }
  }

  const catalogue = {
    abilities,
    get(id) {
      return byId.get(id);
    },
    byName(name) {
      if (typeof name !== "string") {
        throw new TypeError("byName needs an ability name as a string.");
      }
      const wanted = name.trim().toLowerCase();
      return abilities.find((ability) => ability.name.toLowerCase() === wanted);
    },
  };
  return deepFreeze(catalogue);
}

// The catalogue for the vendored snapshot, built once when the module loads.
export const abilityCatalogue = buildAbilityCatalogue(snapshot);
