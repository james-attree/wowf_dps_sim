// View model for the #297 PR6 paper doll and the derived stats panel.
// Pure: no DOM. Applying a slot writes config.gear and, when the build
// still derives, the sheet and weapons. Typing the sheet or a weapon in
// the existing form still drops config.gear
// (coordinator call 16 Nov (James delegated)).

import { k } from "../data/constants.js";
import { isLegacySheet } from "./build-codec.js";
import { GEAR_SLOTS } from "./gear-build.js";
import { deriveSheet } from "./gear-derive.js";
import { sheetFromGear } from "./gear-sheet.js";
import { characterLevel } from "./levels.js";
import { raceCatalogue } from "./racials.js";
import {
  EMPTY_COPY,
  LEFT_SLOTS,
  RIGHT_SLOTS,
  SLOT_GLYPH,
  SLOT_LABEL,
  WEAPON_SLOTS,
  itemInitials,
  qualityClass,
  qualityName,
  resultMeta,
  slotConflict,
  slotGlyph,
  suffixesForItem,
} from "./gear-search.js";

const V1_LEVEL = k("items.v1Level");
const PERCENT_DECIMALS = 1;
const PERCENT = k("sheet.percent");
const EMPTY_MH = "Equip a main-hand weapon.";
const LEVEL_BLOCK = "Gear stats are level 60 only for now.";
const TALENT_NOTE =
  "Talent crit and hit are added on the Talents screen, not here.";
const NOT_MODELLED_HELP =
  "These are equipped, but the sim does not roll their procs or on-use effects in v1. Their static stats still count.";
const CREDIT_BEFORE = "Item data from ";
const CREDIT_LABEL = "wowsims/forever";
const CREDIT_AFTER = " (MIT).";
const CREDIT_HREF = "https://github.com/wowsims/forever";
const MINUS = "−";
const ONE = 1;

const STAT_LABELS = Object.freeze({
  strength: "Strength",
  agility: "Agility",
  attackPower: "Attack power",
  crit: "Crit",
  hit: "Hit",
  haste: "Haste",
  expertise: "Expertise",
  mainSkill: "Weapon skill, main hand",
  offSkill: "Weapon skill, off hand",
  mainHand: "Main hand",
  offHand: "Off hand",
});

export {
  EMPTY_MH,
  LEVEL_BLOCK,
  TALENT_NOTE,
  NOT_MODELLED_HELP,
  CREDIT_BEFORE,
  CREDIT_LABEL,
  CREDIT_AFTER,
  CREDIT_HREF,
  STAT_LABELS,
};

function copySlots(slots) {
  const next = {};
  for (const slot of GEAR_SLOTS) {
    const entry = slots?.[slot];
    if (entry == null) {
      continue;
    }
    next[slot] = {
      item: entry.item,
      enchant: entry.enchant ?? null,
      suffix: entry.suffix ?? null,
    };
  }
  return next;
}

export function configWithGear(config, slots) {
  const gear = { slots: copySlots(slots) };
  const next = {
    ...config,
    character: { ...config.character },
    weapons: {
      mainHand: config.weapons?.mainHand
        ? { ...config.weapons.mainHand }
        : config.weapons?.mainHand,
      offHand: config.weapons?.offHand
        ? { ...config.weapons.offHand }
        : config.weapons?.offHand,
    },
    gear,
  };
  try {
    const derived = sheetFromGear(gear, { race: config.race ?? "human" });
    next.character = { ...next.character, ...derived.character };
    // The doll and the sim must never disagree: an empty hand is null
    // here, not the previous weapon. coordinator call 16 Nov (James
    // delegated), per the Q10 ruling of 15 Nov. Empty MH blocks Run;
    // empty OH runs main-hand only (legal since #390).
    next.weapons = {
      mainHand: derived.weapons.mainHand,
      offHand: derived.weapons.offHand,
    };
  } catch {
    // A conflict in another slot must not drop the player's pick, but
    // an empty hand is still cleared so the sim cannot swing it.
    if (!gear.slots.mainHand) {
      next.weapons.mainHand = null;
    }
    if (!gear.slots.offHand) {
      next.weapons.offHand = null;
    }
  }
  return next;
}

function raceName(race) {
  if (race == null) {
    return null;
  }
  return raceCatalogue.get(race)?.name ?? race;
}

export function formatSheetPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${(0).toFixed(PERCENT_DECIMALS)}%`;
  }
  return `${(value * PERCENT).toFixed(PERCENT_DECIMALS)}%`;
}

function signedPart(value, label) {
  if (!value) {
    return null;
  }
  const sign = value < 0 ? MINUS : "+";
  const amount = Math.abs(value);
  return `${sign} ${amount} ${label}`;
}

function joinParts(parts) {
  return parts.filter((part) => part != null && part !== "").join(" ");
}

function sourceForBase(classValue, raceValue, gearValue, race) {
  const name = raceName(race) ?? "race";
  return joinParts([
    `${classValue} class`,
    signedPart(raceValue, name),
    signedPart(gearValue, "gear"),
  ]);
}

export function derivedRows(derived) {
  if (!derived) {
    return [];
  }
  const base = k("sheet.classBase");
  const race = derived.breakdown.race;
  const offsetId =
    race === "night-elf"
      ? "sheet.raceOffset.night-elf"
      : race === "skyborne-high-order"
        ? "sheet.raceOffset.skyborne-high-order"
        : race === "skyborne-windshaper"
          ? "sheet.raceOffset.skyborne-windshaper"
          : `sheet.raceOffset.${race}`;
  const offset = k(offsetId);
  const gearStrength =
    derived.breakdown.strength - base.strength - offset.strength;
  const gearAgility = derived.breakdown.agility - base.agility - offset.agility;
  const itemAp =
    derived.character.attackPower -
    base.attackPower -
    derived.breakdown.strength * k("sheet.apPerStrength") -
    derived.breakdown.agility * k("sheet.apPerAgility");
  const weaponLine = (hand) => {
    const weapon = derived.weapons[hand];
    if (!weapon) {
      return EMPTY_COPY;
    }
    return `${weapon.min}${MINUS}${weapon.max}, ${weapon.speed} s, ${weapon.type}`;
  };
  const skillSource = (hand) => {
    const weapon = derived.weapons[hand];
    if (!weapon) {
      return EMPTY_COPY;
    }
    const floor = derived.breakdown.level * k("sheet.skillPerLevel");
    const extra = weapon.weaponSkill - floor;
    return extra
      ? `${floor} (level × ${k("sheet.skillPerLevel")}) ${signedPart(extra, "gear")}`
      : `${floor} (level × ${k("sheet.skillPerLevel")})`;
  };
  return [
    {
      id: "strength",
      label: STAT_LABELS.strength,
      value: String(derived.breakdown.strength),
      source: sourceForBase(base.strength, offset.strength, gearStrength, race),
    },
    {
      id: "agility",
      label: STAT_LABELS.agility,
      value: String(derived.breakdown.agility),
      source: sourceForBase(base.agility, offset.agility, gearAgility, race),
    },
    {
      id: "attackPower",
      label: STAT_LABELS.attackPower,
      value: String(Math.round(derived.character.attackPower)),
      source: joinParts([
        `${base.attackPower} class`,
        signedPart(
          derived.breakdown.strength * k("sheet.apPerStrength"),
          "Str",
        ),
        signedPart(derived.breakdown.agility * k("sheet.apPerAgility"), "Agi"),
        signedPart(itemAp, "item and set AP"),
      ]),
    },
    {
      id: "crit",
      label: STAT_LABELS.crit,
      value: formatSheetPercent(derived.character.critChance),
      source: `Agility × ${k("sheet.critPerAgility")}% + crit rating / ${k("sheet.critRatingPerPercent")}`,
    },
    {
      id: "hit",
      label: STAT_LABELS.hit,
      value: formatSheetPercent(derived.character.bonusHitChance),
      source: `Hit rating / ${k("sheet.hitRatingPerPercent")}`,
    },
    {
      id: "haste",
      label: STAT_LABELS.haste,
      value: formatSheetPercent(derived.character.haste),
      source: `Haste rating / ${k("sheet.hasteRatingPerPercent")}`,
    },
    {
      id: "expertise",
      label: STAT_LABELS.expertise,
      value: formatSheetPercent(derived.breakdown.expertise),
      source: `Expertise rating / ${k("sheet.expertiseRatingPerPercent")}`,
    },
    {
      id: "mainSkill",
      label: STAT_LABELS.mainSkill,
      value: derived.weapons.mainHand
        ? String(derived.weapons.mainHand.weaponSkill)
        : EMPTY_COPY,
      source: skillSource("mainHand"),
    },
    {
      id: "offSkill",
      label: STAT_LABELS.offSkill,
      value: derived.weapons.offHand
        ? String(derived.weapons.offHand.weaponSkill)
        : EMPTY_COPY,
      source: skillSource("offHand"),
    },
    {
      id: "mainHand",
      label: STAT_LABELS.mainHand,
      value: weaponLine("mainHand"),
      source: "",
    },
    {
      id: "offHand",
      label: STAT_LABELS.offHand,
      value: weaponLine("offHand"),
      source: "",
    },
  ];
}

function enchantName(entry, tables) {
  if (entry?.enchant == null) {
    return null;
  }
  return tables.enchants.get(entry.enchant)?.name ?? null;
}

function suffixName(entry, tables) {
  if (entry?.suffix == null) {
    return null;
  }
  return tables.suffixes.get(entry.suffix)?.name ?? null;
}

function hintFor(item, entry, tables, conflict) {
  if (conflict) {
    return conflict.reason;
  }
  if (!item) {
    return "";
  }
  const bits = [qualityName(item.quality)];
  const stats = resultMeta(item).split(" · ").slice(ONE);
  bits.push(...stats);
  const enchant = enchantName(entry, tables);
  if (enchant) {
    bits.push(`Enchant: ${enchant}`);
  }
  const suffix = suffixName(entry, tables);
  if (suffix) {
    bits.push(suffix);
  }
  return bits.filter(Boolean).join(" · ");
}

function rowFor(slot, slots, tables) {
  const entry = slots?.[slot] ?? null;
  const conflict = slotConflict(slot, entry, tables, slots);
  const item = entry == null ? null : (tables.items.get(entry.item) ?? null);
  const empty = item == null && conflict == null;
  return {
    slot,
    label: SLOT_LABEL[slot],
    glyph: empty
      ? SLOT_GLYPH[slot]
      : item
        ? itemInitials(item.name)
        : slotGlyph(slot),
    name: conflict ? conflict.name : empty ? EMPTY_COPY : item.name,
    quality: item?.quality ?? null,
    qualityName: item ? qualityName(item.quality) : null,
    qualityClass: item ? qualityClass(item.quality) : "",
    icon: item?.icon ?? null,
    hint: empty ? SLOT_LABEL[slot] : hintFor(item, entry, tables, conflict),
    empty,
    conflict: conflict != null,
    conflictReason: conflict?.reason ?? null,
    entry,
    item,
    suffixes: item ? suffixesForItem(item, tables) : [],
  };
}

export function gearLead(config) {
  const level = characterLevel(config);
  const race = raceName(config.race);
  const who = race ? `${race} rogue` : "rogue";
  return `First load is the wowsims Forever P1 gear build. Level ${level} ${who}. Race is set on Character. Empty slots are allowed. An empty main hand blocks Run.`;
}

export function gearViewModel(config, tables) {
  const legacy = isLegacySheet(config);
  const slots = config.gear?.slots ?? {};
  const rows = Object.fromEntries(
    GEAR_SLOTS.map((slot) => [slot, rowFor(slot, slots, tables)]),
  );
  const level = characterLevel(config);
  const emptyMainHand = !legacy && rows.mainHand.empty;
  const levelBlocked = !legacy && level !== V1_LEVEL;
  let derived = null;
  if (!legacy) {
    try {
      derived = deriveSheet(
        config.gear ?? { slots: {} },
        { level: V1_LEVEL, race: config.race ?? "human" },
        tables,
      );
    } catch {
      derived = null;
    }
  }
  const notModelled = derived?.notModelled ?? [];
  return {
    legacy,
    showDoll: !legacy,
    lead: gearLead(config),
    emptyMainHand,
    emptyMainHandText: emptyMainHand ? EMPTY_MH : "",
    levelBlocked,
    levelBlockText: levelBlocked ? LEVEL_BLOCK : "",
    race: raceName(config.race),
    level,
    rows,
    left: LEFT_SLOTS.map((slot) => rows[slot]),
    right: RIGHT_SLOTS.map((slot) => rows[slot]),
    weapons: WEAPON_SLOTS.map((slot) => rows[slot]),
    stats: derivedRows(derived),
    notModelled,
    notModelledCount: notModelled.length,
    notModelledLabel:
      notModelled.length === ONE
        ? "1 effect not modelled"
        : `${notModelled.length} effects not modelled`,
    derived,
  };
}

export function setSlot(slots, slot, patch) {
  const next = copySlots(slots);
  if (patch == null) {
    delete next[slot];
    return next;
  }
  next[slot] = {
    item: patch.item,
    enchant: patch.enchant ?? null,
    suffix: patch.suffix ?? null,
  };
  return next;
}

export { copySlots };
