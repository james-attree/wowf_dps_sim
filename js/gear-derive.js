import { k } from "../data/constants.js";
import { setBonus } from "../data/set-bonuses.js";
import { validateBuild } from "./gear-build.js";

// deriveSheet(build, character) -> the plain numbers the engine takes today,
// plus a breakdown and the effects v1 does not model. Pure: it does not
// mutate the build or the character. An empty off hand is null. The engine
// still rejects that until a later PR.

const RACE_OFFSET = {
  human: "sheet.raceOffset.human",
  orc: "sheet.raceOffset.orc",
  dwarf: "sheet.raceOffset.dwarf",
  "night-elf": "sheet.raceOffset.night-elf",
  undead: "sheet.raceOffset.undead",
  gnome: "sheet.raceOffset.gnome",
  troll: "sheet.raceOffset.troll",
  "skyborne-high-order": "sheet.raceOffset.skyborne-high-order",
  "skyborne-windshaper": "sheet.raceOffset.skyborne-windshaper",
};

function emptyStats() {
  return {
    strength: 0,
    agility: 0,
    stamina: 0,
    intellect: 0,
    spirit: 0,
    attackPower: 0,
    hit: 0,
    crit: 0,
    haste: 0,
    expertise: 0,
    hitPercent: 0,
    critPercent: 0,
  };
}

function addStats(total, stats, scale = 1) {
  if (!stats) {
    return;
  }
  for (const [key, value] of Object.entries(stats)) {
    total[key] = (total[key] ?? 0) + value * scale;
  }
}

function decodeSuffixes(text) {
  if (typeof text !== "string" || text === "") {
    return [];
  }
  const parts = text.split("+").map(Number);
  const ids = [parts[0]];
  for (let index = 1; index < parts.length; index += 1) {
    ids.push(ids[index - 1] + parts[index]);
  }
  return ids;
}

function suffixStats(item, suffix) {
  if (!suffix) {
    return null;
  }
  const points = item.randPropPoints ?? 0;
  const scaled = {};
  for (const [key, allocation] of Object.entries(suffix.stats ?? {})) {
    scaled[key] = (allocation * points) / k("sheet.suffixBudget");
  }
  return scaled;
}

function handWeapon(item, enchant, skill) {
  if (!item?.weapon || item.slot !== "weapon") {
    return null;
  }
  const bonus = enchant?.weaponDamage ?? 0;
  return {
    min: item.weapon.min + bonus,
    max: item.weapon.max + bonus,
    speed: item.weapon.speed,
    type: item.weapon.type,
    weaponSkill: skill,
  };
}

const SKILL_FOR_TYPE = {
  axe: "axes",
  dagger: "daggers",
  fist: "fist",
  mace: "maces",
  sword: "swords",
  bow: "bows",
  crossbow: "crossbows",
  gun: "guns",
  thrown: "thrown",
};

function skillFor(type, itemSkills, setSkills, level) {
  const skill = SKILL_FOR_TYPE[type];
  const base = level * k("sheet.skillPerLevel");
  return base + (itemSkills[skill] ?? 0) + (setSkills[skill] ?? 0);
}

export function indexGear(tables) {
  const byId = (rows) =>
    new Map(rows.map((row) => [row.id ?? row.effectId, row]));
  return {
    items: tables.items instanceof Map ? tables.items : byId(tables.items),
    enchants:
      tables.enchants instanceof Map ? tables.enchants : byId(tables.enchants),
    suffixes:
      tables.suffixes instanceof Map ? tables.suffixes : byId(tables.suffixes),
  };
}

export function deriveSheet(
  build,
  character,
  tables = { items: [], enchants: [], suffixes: [] },
) {
  const level = character?.level;
  if (level !== k("items.v1Level")) {
    throw new Error(`v1 derives a level ${k("items.v1Level")} sheet only.`);
  }
  const race = character.race ?? "human";
  const offsetId = RACE_OFFSET[race];
  if (!offsetId) {
    throw new Error(`No level-60 rogue offset for race ${race}.`);
  }
  const indexed = indexGear(tables);
  const worn = validateBuild(build ?? { slots: {} }, indexed);
  const gear = emptyStats();
  const setSkills = {};
  // Q7: none of these are modelled in v1.
  // coordinator call 15 Nov (James delegated)
  const notModelled = [];
  const counts = new Map();
  for (const { item } of worn) {
    if (item.setId != null) {
      counts.set(item.setId, (counts.get(item.setId) ?? 0) + 1);
    }
  }
  for (const [setId, count] of counts) {
    const set = setBonus(setId);
    if (!set) {
      continue;
    }
    for (const bonus of set.bonuses) {
      if (count < bonus.pieces) {
        continue;
      }
      if (!bonus.modelled) {
        notModelled.push({
          name: set.name,
          kind: bonus.kind,
          pieces: bonus.pieces,
          reason: "not modelled",
        });
        continue;
      }
      addStats(gear, bonus.stats);
      for (const [type, value] of Object.entries(bonus.weaponSkills ?? {})) {
        setSkills[type] = (setSkills[type] ?? 0) + value;
      }
    }
  }
  const itemSkills = {};
  for (const { slot, entry, item } of worn) {
    addStats(gear, item.stats);
    for (const [type, value] of Object.entries(item.weaponSkills ?? {})) {
      itemSkills[type] = (itemSkills[type] ?? 0) + value;
    }
    const suffix =
      entry.suffix == null ? null : indexed.suffixes.get(entry.suffix);
    if (
      suffix &&
      item.suffixes &&
      !decodeSuffixes(item.suffixes).includes(entry.suffix)
    ) {
      throw new Error(`${item.name} cannot take suffix ${suffix.name}.`);
    }
    addStats(gear, suffixStats(item, suffix));
    const enchant =
      entry.enchant == null ? null : indexed.enchants.get(entry.enchant);
    addStats(gear, enchant?.stats);
    if (enchant && enchant.weaponDamage == null && !enchant.stats) {
      notModelled.push({
        slot,
        name: enchant.name,
        kind: "enchant",
        reason: "not modelled",
      });
    }
    for (const effect of item.effects ?? []) {
      notModelled.push({
        slot,
        name: effect.name,
        kind: effect.kind,
        reason: "not modelled",
      });
    }
  }
  const base = k("sheet.classBase");
  const offset = k(offsetId);
  const strength = base.strength + offset.strength + gear.strength;
  const agility = base.agility + offset.agility + gear.agility;
  const percent = k("sheet.percent");
  const attackPower =
    base.attackPower +
    strength * k("sheet.apPerStrength") +
    agility * k("sheet.apPerAgility") +
    gear.attackPower;
  const critChance =
    (agility * k("sheet.critPerAgility")) / percent +
    gear.crit / k("sheet.critRatingPerPercent") / percent +
    gear.critPercent / percent;
  const bonusHitChance =
    gear.hit / k("sheet.hitRatingPerPercent") / percent +
    gear.hitPercent / percent;
  const haste = gear.haste / k("sheet.hasteRatingPerPercent") / percent;
  const expertise =
    gear.expertise / k("sheet.expertiseRatingPerPercent") / percent;
  const dodgeChance = (agility * k("sheet.dodgePerAgility")) / percent;
  const bySlot = new Map(worn.map((row) => [row.slot, row]));
  const hand = (slot) => {
    const row = bySlot.get(slot);
    if (!row) {
      return null;
    }
    const type = row.item.weapon?.type;
    const skill = skillFor(type, itemSkills, setSkills, level);
    const enchant =
      row.entry.enchant == null
        ? null
        : indexed.enchants.get(row.entry.enchant);
    return handWeapon(row.item, enchant, skill);
  };
  return {
    character: { attackPower, critChance, bonusHitChance, haste },
    weapons: { mainHand: hand("mainHand"), offHand: hand("offHand") },
    breakdown: {
      race,
      level,
      strength,
      agility,
      stamina: base.stamina + offset.stamina + gear.stamina,
      intellect: base.intellect + offset.intellect,
      spirit: base.spirit + offset.spirit,
      dodgeChance,
      expertise,
    },
    notModelled,
  };
}
