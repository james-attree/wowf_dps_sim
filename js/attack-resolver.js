import { k } from "../data/constants.js";

// The Classic 1.12 melee attack table (roadmap A7). Chances are fractions.
// Rolls are compared on attack.rollScale so callers can inject a roll.
//
// A white swing ("weapon") is one roll over the bands miss, dodge, parry,
// glancing, block, crit, hit (table.white). A yellow attack ("skill") is two
// rolls (table.yellow): the first walks miss, dodge, parry, block and is a hit
// when none of them takes it; a hit then rolls again for the crit. The parry
// and block bands exist only from the front.
//
// Every number comes from one table, the attackTable.* rows of
// data/constants.js (#295). deriveAttackTable() works the bands out from the
// weapon skill against the target's defense; a fight derives it once (the
// Simulation's attackTable) and passes it in. A caller that passes none gets
// the table at the default skill, read at the call so a test can change a row.
const ROLL_SCALE = k("attack.rollScale");

const ATTACK_TYPES = ["weapon", "skill"];

const OUTCOME_LABELS = {
  miss: "Miss",
  dodge: "Dodge",
  parry: "Parry",
  glancing: "Glance",
  block: "Block",
  crit: "Crit",
  hit: "Hit",
};

const LANDED = ["glancing", "block", "crit", "hit"];

// The roll is the simulation's rng times attack.rollScale. A caller that
// injects a roll does not need an rng, and no draw is made.
function drawRoll(rng) {
  if (typeof rng !== "function") {
    throw new TypeError("resolveAttack needs an rng function or a roll.");
  }
  return rng() * ROLL_SCALE;
}

function checkRoll(roll, name) {
  if (!Number.isFinite(roll) || roll < 0 || roll > ROLL_SCALE) {
    throw new RangeError(`${name} must be between 0 and ${ROLL_SCALE}.`);
  }
}

function clampChance(chance, name) {
  if (!Number.isFinite(chance)) {
    throw new RangeError(`${name} must be a finite number.`);
  }
  return Math.min(1, Math.max(0, chance));
}

// Rounded to attack.derivedDigits decimal places: floating-point dust off, so
// a derived 0.05 + 15 x 0.002 is the 0.08 a fixed row held.
function tidy(value) {
  return Number(value.toFixed(k("attack.derivedDigits")));
}

const between = (value, low, high) => Math.min(high, Math.max(low, value));

// The weapon skill a character of `level` has with no bonus: level x
// attackTable.weaponSkill.perLevel (300 at 60). The default of
// config.character.weaponSkill.
export function defaultWeaponSkill(level = k("character.level")) {
  return level * k("attackTable.weaponSkill").perLevel;
}

// The highest config.character.weaponSkill a config may give: the default
// plus attackTable.weaponSkill.maxAboveBase (350 at 60; Kira's QA N2 on #316).
export function maxWeaponSkill(level = k("character.level")) {
  return defaultWeaponSkill(level) + k("attackTable.weaponSkill").maxAboveBase;
}

// The weapon skill a config fights with: config.character.weaponSkill, or
// while that is null (the default, #290) the config's level x 5
// (defaultWeaponSkill of config.talentLevel, 300 at 60), plus the race's
// attackTable.weaponSkill racialBonus, which is empty: no WoW Forever race
// has one.
export function weaponSkillFor(config) {
  const { racialBonus } = k("attackTable.weaponSkill");
  const race = config?.race;
  const bonus =
    typeof race === "string" && Object.hasOwn(racialBonus, race)
      ? racialBonus[race]
      : 0;
  const level = config?.talentLevel ?? k("character.level");
  return (config?.character?.weaponSkill ?? defaultWeaponSkill(level)) + bonus;
}

function critModel() {
  const name = k("attackTable.critModel");
  const models = k("attackTable.critModels");
  if (!Object.hasOwn(models, name)) {
    throw new RangeError(
      `attackTable.critModel ${JSON.stringify(name)} is not one of attackTable.critModels: ${Object.keys(models).join(", ")}.`,
    );
  }
  return models[name];
}

// The skill a gap is taken from: "capped" is min(skill, level x 5), "total"
// the whole weapon skill.
function skillFor(choice, weaponSkill, baseSkill, row) {
  if (choice === "capped") {
    return Math.min(weaponSkill, baseSkill);
  }
  if (choice === "total") {
    return weaponSkill;
  }
  throw new RangeError(
    `${row} skill must be "capped" or "total", not ${JSON.stringify(choice)}.`,
  );
}

// The crit suppression, in three terms that suppressCrit takes off one after
// another: the skill term, the flat 1.8% aura term and the level aura.
function critTerms({ weaponSkill, baseSkill, defense, levelGap }) {
  const model = critModel();
  const gap =
    defense - skillFor(model.skill, weaponSkill, baseSkill, "A crit model's");
  const skillGap = defense - weaponSkill;
  // James, 2 Nov 2026 (#295): within 10 points of the defense the 1.8% goes.
  const flatAboveSkillGap = k("attackTable.flatAboveSkillGap");
  if (flatAboveSkillGap !== null && !Number.isFinite(flatAboveSkillGap)) {
    throw new RangeError(
      `attackTable.flatAboveSkillGap must be null or a number, not ${JSON.stringify(flatAboveSkillGap)}.`,
    );
  }
  const flatOn =
    levelGap >= model.flatMinLevelGap &&
    (flatAboveSkillGap === null || skillGap > flatAboveSkillGap);
  return {
    skill: tidy(gap * (gap > 0 ? model.perPoint : model.perPointAhead)),
    flat: flatOn ? model.flat : 0,
    levelAura: tidy(Math.max(0, levelGap) * model.levelAuraPerLevel),
  };
}

// The attack table of one fight: every band worked out from the attackTable
// rows, the weapon skill and the two levels (#295). The skill gap is the
// target's defense (target level x attackTable.defense.perLevel) less the
// weapon skill. At the defaults (300 skill, 60 against 63) it is the fixed
// table the engine had before: miss 8%, hit suppression 1%, dual-wield
// penalty 19%, dodge 6.5%, glancing 40% at 0.55 to 0.75, crit suppression
// 3% + 1.8%, spell miss 17%.
export function deriveAttackTable({
  weaponSkill = defaultWeaponSkill(),
  characterLevel = k("character.level"),
  targetLevel = k("target.level"),
} = {}) {
  if (!Number.isFinite(weaponSkill)) {
    throw new RangeError("Weapon skill must be a finite number.");
  }
  const baseSkill = defaultWeaponSkill(characterLevel);
  const defense = targetLevel * k("attackTable.defense").perLevel;
  const gap = defense - weaponSkill;
  const levelGap = targetLevel - characterLevel;
  const miss = k("attackTable.miss");
  const hit = k("attackTable.hitSuppression");
  const dodge = k("attackTable.dodge");
  const glancing = k("attackTable.glancing");
  const glancingDamage = k("attackTable.glancingDamage");
  const block = k("attackTable.block");
  const spell = k("attackTable.spellMiss");
  const glanceGap =
    defense -
    skillFor(glancing.skill, weaponSkill, baseSkill, "attackTable.glancing");
  const factor = ({ at, perPoint, min, max }) =>
    tidy(between(at - perPoint * gap, min, max));
  return {
    weaponSkill,
    defense,
    gap,
    miss: Math.max(
      0,
      tidy(
        miss.base +
          gap * (gap > miss.gap ? miss.perPointAboveGap : miss.perPoint),
      ),
    ),
    dualWieldPenalty: k("attackTable.dualWieldPenalty"),
    hitSuppression:
      gap > hit.gap
        ? tidy(hit.flat + hit.perPointAboveGap * (gap - hit.gap))
        : 0,
    dodge: Math.max(0, tidy(dodge.base + dodge.perPoint * gap)),
    parry: { ...k("attackTable.parry") },
    block: { front: block.front, behind: block.behind },
    blockValue: block.value,
    glancing: tidy(
      between(glancing.base + glancing.perPoint * glanceGap, 0, 1),
    ),
    glancingDamage: {
      low: factor(glancingDamage.low),
      high: factor(glancingDamage.high),
    },
    crit: critTerms({ weaponSkill, baseSkill, defense, levelGap }),
    spellMiss: {
      chance:
        spell.byLevelGap[between(levelGap, 0, spell.byLevelGap.length - 1)],
      floor: spell.floor,
    },
  };
}

// The first part of bonus hit that does not count: the table's hit
// suppression (1% while the defense is more than 10 above the skill).
export function hitSuppression(table = deriveAttackTable()) {
  return table.hitSuppression;
}

// A crit chance after the level-difference suppression: the table's skill
// term, its aura term and its level aura, one after another, then held between
// 0 and 1. The suppression comes off before the cap, so a chance of 100% or
// more still crits for sure (Cold Blood's +100%) once the suppression is paid.
export function suppressCrit(critChance, table = deriveAttackTable()) {
  if (!Number.isFinite(critChance)) {
    throw new RangeError("Critical chance must be a finite number.");
  }
  const { skill, flat, levelAura } = table.crit;
  return clampChance(critChance - skill - flat - levelAura, "Critical chance");
}

// The band widths of one roll, as fractions. `behind` is the target's
// position: parry and block are 0 from behind.
export function attackChances({
  attackType,
  bonusHitChance,
  critChance,
  dodgeReduction = 0,
  parryReduction = 0,
  behind = k("target.behind"),
  canCrit = true,
  table = deriveAttackTable(),
}) {
  if (!ATTACK_TYPES.includes(attackType)) {
    throw new RangeError(`Unsupported attack type: ${attackType}`);
  }
  const white = attackType === "weapon";
  const bonusHit = Math.max(
    0,
    clampChance(bonusHitChance, "Bonus hit chance") - hitSuppression(table),
  );
  const baseMiss = table.miss + (white ? table.dualWieldPenalty : 0);
  const position = behind ? "behind" : "front";
  return {
    miss: Math.max(0, baseMiss - bonusHit),
    // Expertise-style reductions come from the modifier pipeline (A2). Zero,
    // the default, leaves the chance exactly as it was.
    dodge: Math.max(
      0,
      table.dodge - clampChance(dodgeReduction, "Dodge reduction"),
    ),
    parry: Math.max(
      0,
      table.parry[position] - clampChance(parryReduction, "Parry reduction"),
    ),
    glancing: white ? table.glancing : 0,
    block: table.block[position],
    crit: canCrit ? suppressCrit(critChance, table) : 0,
  };
}

// `canCrit: false` is an attack with no crit roll at all, such as a DoT's
// application: a yellow attack then takes one draw, not two.
//
// Draws from rng, in this order: the table roll; for a glancing blow, the
// glancing-damage factor; for a yellow hit that can crit, the crit roll.
// critRoll and glanceRoll inject those two draws (on attack.rollScale).
// `table` is the fight's attack table (deriveAttackTable).
export function resolveAttack({
  attackType,
  baseDamage,
  bonusHitChance,
  critChance,
  critMultiplier = k("crit.meleeMultiplier"),
  dodgeReduction = 0,
  parryReduction = 0,
  behind = k("target.behind"),
  canCrit = true,
  table = deriveAttackTable(),
  rng,
  roll = drawRoll(rng),
  critRoll,
  glanceRoll,
}) {
  if (!ATTACK_TYPES.includes(attackType)) {
    throw new RangeError(`Unsupported attack type: ${attackType}`);
  }
  if (!Number.isFinite(baseDamage) || baseDamage < 0) {
    throw new RangeError("Base damage must be a non-negative number.");
  }
  checkRoll(roll, "Attack roll");
  if (!Number.isFinite(critMultiplier) || critMultiplier < 0) {
    throw new RangeError("Critical multiplier must be a non-negative number.");
  }
  const chances = attackChances({
    attackType,
    bonusHitChance,
    critChance,
    dodgeReduction,
    parryReduction,
    behind,
    canCrit,
    table,
  });
  const white = attackType === "weapon";

  // The first roll. A white swing has its crit band here; a yellow attack
  // does not, and rolls the crit afterwards.
  const bands = [
    ["miss", chances.miss],
    ["dodge", chances.dodge],
    ["parry", chances.parry],
  ];
  if (white) {
    bands.push(["glancing", chances.glancing]);
  }
  bands.push(["block", chances.block]);
  if (white) {
    bands.push(["crit", chances.crit]);
  }
  let threshold = 0;
  let outcome = "hit";
  for (const [result, chance] of bands) {
    threshold += chance * ROLL_SCALE;
    if (roll < threshold) {
      outcome = result;
      break;
    }
  }

  let secondRoll = null;
  if (!white && outcome === "hit" && canCrit) {
    secondRoll = critRoll ?? drawRoll(rng);
    checkRoll(secondRoll, "Crit roll");
    if (secondRoll < chances.crit * ROLL_SCALE) {
      outcome = "crit";
    }
  }

  let glanceFactor = null;
  if (outcome === "glancing") {
    const drawn = glanceRoll ?? drawRoll(rng);
    checkRoll(drawn, "Glancing roll");
    const { low, high } = table.glancingDamage;
    glanceFactor = low + (high - low) * (drawn / ROLL_SCALE);
  }

  let damage = 0;
  if (outcome === "hit") {
    damage = Math.floor(baseDamage);
  } else if (outcome === "crit") {
    damage = Math.floor(baseDamage * critMultiplier);
  } else if (outcome === "glancing") {
    damage = Math.floor(baseDamage * glanceFactor);
  } else if (outcome === "block") {
    damage = Math.floor(Math.max(0, baseDamage - table.blockValue));
  }

  return {
    outcome,
    status: OUTCOME_LABELS[outcome],
    roll,
    critRoll: secondRoll,
    glanceFactor,
    damage,
    landed: LANDED.includes(outcome),
  };
}

// Poison procs (A5) are spell hits: miss at the table's spell miss (17% at
// +3, attackTable.spellMiss), less the bonus spell hit, never below its floor.
// Melee hit and weapon skill do not reduce it (poison.hitModel). One draw,
// unless a roll is injected.
export function spellMissChance(
  bonusSpellHit = 0,
  table = deriveAttackTable(),
) {
  const { chance, floor } = table.spellMiss;
  return Math.max(
    floor,
    chance - clampChance(bonusSpellHit, "Bonus spell hit chance"),
  );
}

export function resolveSpellHit({
  bonusSpellHit = 0,
  table = deriveAttackTable(),
  rng,
  roll = drawRoll(rng),
}) {
  checkRoll(roll, "Spell roll");
  const missed = roll < spellMissChance(bonusSpellHit, table) * ROLL_SCALE;
  return {
    outcome: missed ? "miss" : "hit",
    status: missed ? "Resist" : "Hit",
    roll,
    landed: !missed,
  };
}

export function rollCrit(critChance, rng) {
  const chance = clampChance(critChance, "Critical chance");
  if (typeof rng !== "function") {
    throw new TypeError("rollCrit needs an rng function.");
  }
  return rng() < chance;
}
