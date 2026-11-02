import { k } from "../data/constants.js";
import { abilityCatalogue, parseSpell } from "./abilities.js";
import { snapshot } from "./snapshot.js";

// Ranks by level (#290). The export gives every rank of a rogue spell with the
// level it is learned at (spell_desc's "lv": "Learned at level N"). A level N
// character has the highest rank learned at or below N; a spell with no rank
// learned yet is not castable (Rogue.lockedByLevel) and a poison with none
// gives no proc (js/poisons.js poisonProcs).
//
// The engine's numbers are the constants rows (data/constants.js), which hold
// the top rank. rankedStats(row, level) is that row with the fields a lower
// rank changes overlaid from the export: the same object as k(row) at a level
// that has the top rank, so a level 60 fight reads exactly what it did.

const LEARNED = /^Learned at level (\d+)$/;

// The ranks of a spell in the export: [{ rank, level, key, label }], in rank
// order. A spell with one unranked entry ("Rogue|Cold Blood|") is rank 1.
// Racials and anything else with no entry give [].
const ranksCache = new Map();
export function spellRanks(name, source = snapshot) {
  if (source === snapshot && ranksCache.has(name)) {
    return ranksCache.get(name);
  }
  const prefix = `${source.class}|${name}|`;
  const ranks = [];
  for (const [key, entry] of Object.entries(source.spell_desc ?? {})) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const label = key.slice(prefix.length);
    const match = /^Rank (\d+)$/.exec(label);
    if (label !== "" && match === null) {
      continue;
    }
    const learned = LEARNED.exec(entry?.lv ?? "");
    if (learned === null) {
      throw new RangeError(
        `The export's ${JSON.stringify(key)} has no "Learned at level N" (lv: ${JSON.stringify(entry?.lv)}).`,
      );
    }
    ranks.push({
      rank: match === null ? 1 : Number(match[1]),
      level: Number(learned[1]),
      key,
      label,
    });
  }
  ranks.sort((a, b) => a.rank - b.rank);
  const frozen = Object.freeze(ranks.map((rank) => Object.freeze(rank)));
  if (source === snapshot) {
    ranksCache.set(name, frozen);
  }
  return frozen;
}

// The level a spell is first learned at: its lowest rank's. 1 for a spell the
// export has no entry for (the racials), which every level has.
export function learnedAt(name, source = snapshot) {
  const ranks = spellRanks(name, source);
  return ranks.length === 0 ? 1 : Math.min(...ranks.map((rank) => rank.level));
}

// The highest rank of a spell learned at or below `level`, or null when none
// is. A spell the export has no entry for is rank 1 at every level.
export function rankAt(name, level, source = snapshot) {
  const ranks = spellRanks(name, source);
  if (ranks.length === 0) {
    return 1;
  }
  let best = null;
  for (const rank of ranks) {
    if (rank.level <= level && (best === null || rank.rank > best.rank)) {
      best = rank;
    }
  }
  return best === null ? null : best.rank;
}

// The constants rows a rank changes, the spell each one is (its catalogue
// id; its name is the catalogue's), and how a parsed
// rank (parseSpell, js/abilities.js) gives the row's fields. A field not
// listed is the same at every rank (cooldown, weaponMultiplier, combo points)
// and stays the row's.
const energy = (spell) => ({ energy: spell.cost.amount });
const bonus = (spell) => ({ ...energy(spell), bonusDamage: spell.flatDamage });
const RANKED = {
  sinisterStrike: { id: "sinister-strike", fields: bonus },
  backstab: { id: "backstab", fields: bonus },
  ambush: { id: "ambush", fields: bonus },
  mutilate: { id: "mutilate", fields: bonus },
  eviscerate: {
    id: "eviscerate",
    fields: (spell) => ({
      ...energy(spell),
      damageByCp: spell.perComboPoint.map(({ damage }) => ({
        min: damage.min,
        max: damage.max,
      })),
    }),
  },
  rupture: {
    id: "rupture",
    fields: (spell) => ({
      ...energy(spell),
      damageByCp: spell.perComboPoint.map(({ damage }) => damage.min),
      durationByCp: spell.perComboPoint.map(({ duration }) => duration),
    }),
  },
  sliceAndDice: {
    id: "slice-and-dice",
    fields: (spell) => {
      const haste = /attack speed by (\d+)%/.exec(spell.text);
      if (haste === null) {
        throw new RangeError(
          `${spell.name} rank ${spell.rank} gives no "attack speed by N%".`,
        );
      }
      return {
        ...energy(spell),
        haste: Number(haste[1]) / k("abilities.percentScale"),
        durationByCp: spell.perComboPoint.map(({ duration }) => duration),
      };
    },
  },
  exposeArmor: {
    id: "expose-armor",
    fields: (spell) => ({
      ...energy(spell),
      armorPerComboPoint: spell.perComboPoint[0].armorReduction,
    }),
  },
};

const spellName = (row) => abilityCatalogue.get(RANKED[row].id).name;

export const RANKED_ROWS = Object.freeze(Object.keys(RANKED));

// The spell a ranked row is, or undefined for a row ranks do not change.
export function rankedSpell(row) {
  return Object.hasOwn(RANKED, row) ? spellName(row) : undefined;
}

function parseRank(name, rank) {
  const found = spellRanks(name).find((entry) => entry.rank === rank);
  return parseSpell({
    name,
    rank,
    label: found.label,
    tab: null,
    key: found.key,
    entry: snapshot.spell_desc[found.key],
  });
}

// A constants row at a character level: k(row) itself when the level has the
// top rank (or no level is given, or the row has no ranks), and otherwise a
// frozen copy with the rank's fields from the export. A level with no rank
// learned gives k(row): the ability is locked then and never cast.
// `options.force` overlays the top rank too (the test that the rows agree with
// the export).
const statsCache = new Map();
export function rankedStats(row, level, { force = false } = {}) {
  const base = k(row);
  if (!Object.hasOwn(RANKED, row) || (level === undefined && !force)) {
    return base;
  }
  const { fields } = RANKED[row];
  const name = spellName(row);
  const ranks = spellRanks(name);
  const top = ranks[ranks.length - 1];
  const at = force && level >= top.level ? top.rank : rankAt(name, level);
  if (at === null || (at === top.rank && !force)) {
    return base;
  }
  const cacheKey = `${row}|${at}|${force}`;
  if (!statsCache.has(cacheKey) || statsCache.get(cacheKey).base !== base) {
    const stats = Object.freeze({ ...base, ...fields(parseRank(name, at)) });
    statsCache.set(cacheKey, { base, stats });
  }
  return statsCache.get(cacheKey).stats;
}
