import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { k } from "../data/constants.js";

// Manual snapshot of wowsims/forever item data (#297). CI and Pages never
// fetch. Re-run this, review the diff, and commit the files under data/items/.

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_OUT_DIR = resolve(ROOT, "data", "items");

const ROGUE = 4;
const WEAPON = 13;
const RANGED = 14;
const MAIL = 3;
const PLATE = 4;
const ALLOWED_WEAPON = new Set([1, 2, 3, 4, 9]);
const ALLOWED_HAND = new Set([1, 2, 3]);
const ALLOWED_RANGED = new Set([1, 2, 3, 4]);
const EXCLUDED_ENCHANT = new Set([1, 2, 5]);

const SLOT = [
  null,
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger",
  "trinket",
  "weapon",
  "ranged",
];
const WEAPON_TYPE = {
  1: "axe",
  2: "dagger",
  3: "fist",
  4: "mace",
  9: "sword",
};
const HAND = { 1: "main", 2: "one", 3: "off" };
const RANGED_TYPE = { 1: "bow", 2: "crossbow", 3: "gun", 4: "thrown" };
const WEAPON_SKILL = [
  null,
  "axes",
  "twoHandedAxes",
  "maces",
  "twoHandedMaces",
  "swords",
  "twoHandedSwords",
  "polearms",
  "staves",
  "daggers",
  "fist",
  "bows",
  "crossbows",
  "guns",
  "thrown",
  "wands",
  "feral",
];
const KEPT_STATS = [
  [0, "strength"],
  [1, "agility"],
  [2, "stamina"],
  [14, "attackPower"],
  [17, "hit"],
  [18, "crit"],
  [19, "haste"],
  [21, "expertise"],
];
const PSEUDO = [
  "mainHandDps",
  "offHandDps",
  "rangedDps",
  "blockValueMultiplier",
  "dodgePercent",
  "parryPercent",
  "schoolHitArcane",
  "schoolHitFire",
  "schoolHitFrost",
  "schoolHitHoly",
  "schoolHitNature",
  "schoolHitShadow",
  "meleeHitPercent",
  "spellHitPercent",
  "meleeCritPercent",
  "spellCritPercent",
  "blockPercent",
  "meleeSpeedMultiplier",
  "rangedSpeedMultiplier",
  "castSpeedMultiplier",
  "meleeHastePercent",
  "rangedHastePercent",
  "spellHastePercent",
  "blockValuePerStrength",
  "rangedHitPercent",
  "rangedCritPercent",
  "reducedCritTakenPercent",
  "expertisePercent",
  "offHandHitPercent",
  "offHandCritPercent",
  "mainHandHitRating",
  "mainHandCritRating",
  "offHandHitRating",
  "offHandCritRating",
  "rangedHitRating",
  "rangedCritRating",
  "rangedCritSuppressionPercent",
  "feralCombatSkill",
  "mainHandWeaponSkill",
  "offHandWeaponSkill",
];
const FACTION = { 1: "alliance", 2: "horde" };

export const HELP_TEXT = `Write the rogue item snapshot from a pinned wowsims/forever commit.

Usage: node scripts/refresh-items.mjs [--db PATH] [--out DIR]
       [--base-stats PATH] [--ratings PATH]

With no --db, downloads db.json and the base-stat files from the commit in
data/constants.js (items.upstreamCommit). The app, CI, and Pages do not fetch.

Credit: wowsims/forever (MIT) ${k("items.upstreamCommit")}
`;

export function classAllowsRogue(list) {
  return list == null || list.length === 0 || list.includes(ROGUE);
}

export function rogueUsableItem(item) {
  if (!classAllowsRogue(item.classAllowlist)) {
    return false;
  }
  if (item.type === WEAPON) {
    return (
      ALLOWED_WEAPON.has(item.weaponType) && ALLOWED_HAND.has(item.handType)
    );
  }
  if (item.type === RANGED) {
    return ALLOWED_RANGED.has(item.rangedWeaponType);
  }
  if (item.type == null) {
    return false;
  }
  const armor = item.armorType ?? 0;
  return armor !== MAIL && armor !== PLATE;
}

export function rogueUsableEnchant(enchant) {
  if (!classAllowsRogue(enchant.classAllowlist)) {
    return false;
  }
  return !EXCLUDED_ENCHANT.has(enchant.enchantType ?? 0);
}

function statAt(source, index) {
  if (source == null) {
    return 0;
  }
  if (Array.isArray(source)) {
    return source[index] ?? 0;
  }
  const value = source[index] ?? source[String(index)];
  return value ?? 0;
}

export function keptStats(source) {
  const stats = {};
  for (const [index, name] of KEPT_STATS) {
    const value = statAt(source, index);
    if (value !== 0) {
      stats[name] = value;
    }
  }
  return stats;
}

function pseudoStats(source) {
  if (!Array.isArray(source)) {
    return {};
  }
  const stats = {};
  source.forEach((value, index) => {
    if (value !== 0) {
      stats[PSEUDO[index] ?? `pseudo${index}`] = value;
    }
  });
  return stats;
}

function weaponSkills(list) {
  const skills = {};
  for (const entry of list ?? []) {
    const name = WEAPON_SKILL[entry.skill];
    if (name && entry.value !== 0) {
      skills[name] = entry.value;
    }
  }
  return skills;
}

function effectKind(effect) {
  if (effect.proc) {
    return "proc";
  }
  if (effect.onUse) {
    return "use";
  }
  if (effect.stackProc) {
    return "stackProc";
  }
  return "equip";
}

// Suffix id lists are long runs of neighbours. Store the first id, then the
// gaps, so the file stays under the gear budget and a changed item is still
// one line in the diff. decodeSuffixes reverses it.
export function encodeSuffixes(ids) {
  if (!ids || ids.length === 0) {
    return undefined;
  }
  const sorted = [...ids].sort((a, b) => a - b);
  let text = String(sorted[0]);
  for (let i = 1; i < sorted.length; i += 1) {
    text += `+${sorted[i] - sorted[i - 1]}`;
  }
  return text;
}

export function decodeSuffixes(text) {
  if (typeof text !== "string" || text === "") {
    return [];
  }
  const parts = text.split("+").map(Number);
  const ids = [parts[0]];
  for (let i = 1; i < parts.length; i += 1) {
    ids.push(ids[i - 1] + parts[i]);
  }
  return ids;
}

function omitEmpty(record) {
  for (const [key, value] of Object.entries(record)) {
    if (
      value == null ||
      value === false ||
      (typeof value === "object" && Object.keys(value).length === 0)
    ) {
      delete record[key];
    }
  }
  return record;
}

export function slimItem(item) {
  const scaling = item.scalingOptions?.["0"] ?? {};
  const record = {
    id: item.id,
    name: item.name,
    icon: item.icon,
    slot: SLOT[item.type] ?? "unknown",
    quality: item.quality,
    stats: keptStats(scaling.stats),
    weaponSkills: weaponSkills(scaling.weaponSkills),
    pseudoStats: pseudoStats(item.pseudoStats),
    setId: item.setId,
    unique: item.unique === true,
    reqLvl: item.reqLvl,
    faction: FACTION[item.factionRestriction],
    suffixes: encodeSuffixes(item.randomSuffixOptions),
    randPropPoints: item.randomSuffixOptions?.length
      ? scaling.randPropPoints
      : undefined,
    effects: (item.itemEffects ?? [])
      .map((effect) => ({ name: effect.buffName, kind: effectKind(effect) }))
      .sort(
        (a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind),
      ),
  };
  if (item.type === WEAPON && WEAPON_TYPE[item.weaponType]) {
    record.weapon = omitEmpty({
      min: scaling.weaponDamageMin,
      max: scaling.weaponDamageMax,
      speed: item.weaponSpeed,
      type: WEAPON_TYPE[item.weaponType],
      hand: HAND[item.handType],
    });
  }
  if (item.type === RANGED && RANGED_TYPE[item.rangedWeaponType]) {
    record.weapon = omitEmpty({
      min: scaling.weaponDamageMin,
      max: scaling.weaponDamageMax,
      speed: item.weaponSpeed,
      type: RANGED_TYPE[item.rangedWeaponType],
    });
  }
  return omitEmpty(record);
}

export function slimEnchant(enchant) {
  return omitEmpty({
    effectId: enchant.effectId,
    spellId: enchant.spellId,
    name: enchant.name,
    icon: enchant.icon,
    slot: SLOT[enchant.type] ?? "unknown",
    extraSlots: (enchant.extraTypes ?? [])
      .map((type) => SLOT[type])
      .filter(Boolean)
      .sort(),
    quality: enchant.quality,
    stats: keptStats(enchant.stats),
    weaponDamage: enchant.weaponDamage,
  });
}

export function slimSuffix(suffix) {
  return omitEmpty({
    id: suffix.id,
    name: suffix.name,
    stats: keptStats(suffix.stats),
  });
}

export function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValue(value[key]);
    }
    return sorted;
  }
  return value;
}

export function stableStringify(value) {
  return `${JSON.stringify(sortValue(value))}\n`;
}

export function linesStringify(rows) {
  const body = rows.map((row) => JSON.stringify(sortValue(row))).join(",\n");
  return `[\n${body}\n]\n`;
}

export function parseRogueBaseStats(source) {
  const match = source.match(/Class_ClassRogue:\s*\{([^}]*)\}/);
  if (!match) {
    throw new Error("ClassRogue block not found in base_stats.go");
  }
  const block = match[1];
  const read = (name) => {
    const found = block.match(new RegExp(`stats\\.${name}:\\s*(-?\\d+)`));
    if (!found) {
      throw new Error(`missing rogue ${name}`);
    }
    return Number(found[1]);
  };
  return {
    health: read("Health"),
    agility: read("Agility"),
    strength: read("Strength"),
    intellect: read("Intellect"),
    spirit: read("Spirit"),
    stamina: read("Stamina"),
    attackPower: read("AttackPower"),
  };
}

export function parseLevelRatings(text, level) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split("\t");
  const row = lines
    .slice(1)
    .map((line) => line.split("\t"))
    .find((cells) => Number(cells[0]) === level);
  if (!row) {
    throw new Error(`no CombatRatings row for level ${level}`);
  }
  const at = (label) => {
    const index = header.indexOf(label);
    if (index < 0) {
      throw new Error(`CombatRatings has no ${label}`);
    }
    return Number(row[index]);
  };
  return {
    hit: at("Hit - Melee"),
    crit: at("Crit - Melee"),
    haste: at("Haste - Melee"),
    expertise: at("Expertise"),
  };
}

export function buildSnapshot(db, meta) {
  if (k("items.sockets") !== false) {
    throw new Error("items.sockets is false: this snapshot ships no gems");
  }
  const items = db.items
    .filter(rogueUsableItem)
    .map(slimItem)
    .sort((a, b) => a.id - b.id);
  const enchants = db.enchants
    .filter(rogueUsableEnchant)
    .map(slimEnchant)
    .sort((a, b) => a.effectId - b.effectId || a.spellId - b.spellId);
  const suffixes = db.randomSuffixes
    .map(slimSuffix)
    .sort((a, b) => a.id - b.id);
  const manifest = {
    upstream: "https://github.com/wowsims/forever",
    commit: meta.commit,
    date: meta.date,
    clientBuild: meta.clientBuild,
    license: "MIT",
    creditUrl: "https://github.com/wowsims/forever",
    sources: meta.sources,
    level: meta.level,
    counts: {
      items: items.length,
      enchants: enchants.length,
      suffixes: suffixes.length,
    },
    baseStats: meta.baseStats,
    ratings: meta.ratings,
    assumptions: [
      "v1 is level 60 only. coordinator call 15 Nov (James delegated)",
      "No gems or sockets. coordinator call 15 Nov (James delegated): Q12",
      "Stats are scalingOptions['0'].",
      "CI never fetches. coordinator call 15 Nov (James delegated): Q13",
    ],
  };
  return { items, enchants, suffixes, manifest };
}

export function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

// The manifest records a sha256 of every data/items file. Its own hash is of
// the manifest with that hash emptied, so the field can live in the file.
export function manifestSelfText(manifest) {
  const files = {
    ...manifest.files,
    "manifest.json": { sha256: "", count: 1 },
  };
  return stableStringify({ ...manifest, files });
}

export function snapshotFiles(snapshot) {
  const payloads = {
    "rogue-items.json": linesStringify(snapshot.items),
    "enchants.json": linesStringify(snapshot.enchants),
    "suffixes.json": linesStringify(snapshot.suffixes),
  };
  const files = {};
  for (const [name, text] of Object.entries(payloads)) {
    files[name] = { sha256: hashText(text), count: JSON.parse(text).length };
  }
  const manifest = { ...snapshot.manifest, files };
  files["manifest.json"] = {
    sha256: hashText(manifestSelfText(manifest)),
    count: 1,
  };
  return {
    ...payloads,
    "manifest.json": stableStringify(manifest),
  };
}

const UPSTREAM_FILES = {
  db: "assets/database/db.json",
  baseStats: "sim/core/base_stats.go",
  ratings: "assets/db_inputs/basestats-forever/CombatRatings.txt",
};

function rawUrl(commit, path) {
  return `https://raw.githubusercontent.com/wowsims/forever/${commit}/${path}`;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

function arg(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export async function refresh(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    return HELP_TEXT;
  }
  if (k("items.ciFetches") !== false) {
    throw new Error("items.ciFetches is false: this command is manual");
  }
  const commit = k("items.upstreamCommit");
  const clientBuild = k("items.clientBuild");
  const level = k("items.v1Level");
  const dbPath = arg(argv, "--db");
  const basePath = arg(argv, "--base-stats");
  const ratingsPath = arg(argv, "--ratings");
  const outDir = resolve(arg(argv, "--out") ?? DEFAULT_OUT_DIR);
  const [dbText, baseText, ratingsText] = await Promise.all([
    dbPath
      ? readFile(dbPath, "utf8")
      : fetchText(rawUrl(commit, UPSTREAM_FILES.db)),
    basePath
      ? readFile(basePath, "utf8")
      : fetchText(rawUrl(commit, UPSTREAM_FILES.baseStats)),
    ratingsPath
      ? readFile(ratingsPath, "utf8")
      : fetchText(rawUrl(commit, UPSTREAM_FILES.ratings)),
  ]);
  const snapshot = buildSnapshot(JSON.parse(dbText), {
    commit,
    date: "2026-11-15",
    clientBuild,
    level,
    sources: Object.values(UPSTREAM_FILES),
    baseStats: parseRogueBaseStats(baseText),
    ratings: parseLevelRatings(ratingsText, level),
  });
  await mkdir(outDir, { recursive: true });
  const files = snapshotFiles(snapshot);
  await Promise.all(
    Object.entries(files).map(([name, text]) =>
      writeFile(resolve(outDir, name), text),
    ),
  );
  return `${snapshot.manifest.counts.items} items, ${snapshot.manifest.counts.enchants} enchants, ${snapshot.manifest.counts.suffixes} suffixes → ${outDir}\n`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  refresh()
    .then((text) => {
      process.stdout.write(text);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
