import { k } from "../data/constants.js";

// Chances are fractions. White miss is yellow miss plus the dual-wield penalty.
// Rolls are compared on attack.rollScale (0–100) so callers can inject a roll.
const ROLL_SCALE = k("attack.rollScale");
const BASE_MISS_CHANCE = {
  weapon: k("miss.yellow") + k("miss.dualWieldPenalty"),
  skill: k("miss.yellow"),
};

const DODGE_CHANCE = k("dodge.target");
const GLANCING_CHANCE = k("glancing.chance");
const GLANCING_DAMAGE_MULTIPLIER = k("glancing.damage");
const CRITICAL_DAMAGE_MULTIPLIER = k("crit.meleeMultiplier");

const OUTCOME_LABELS = {
  miss: "Miss",
  dodge: "Dodge",
  parry: "Parry",
  glancing: "Glance",
  crit: "Crit",
  hit: "Hit",
};

export function resolveAttack({
  attackType,
  baseDamage,
  bonusHitChance,
  critChance,
  roll = Math.random() * ROLL_SCALE,
}) {
  if (!Object.hasOwn(BASE_MISS_CHANCE, attackType)) {
    throw new RangeError(`Unsupported attack type: ${attackType}`);
  }
  if (!Number.isFinite(baseDamage) || baseDamage < 0) {
    throw new RangeError("Base damage must be a non-negative number.");
  }
  if (!Number.isFinite(roll) || roll < 0 || roll > ROLL_SCALE) {
    throw new RangeError(`Attack roll must be between 0 and ${ROLL_SCALE}.`);
  }

  const missChance = Math.max(
    0,
    BASE_MISS_CHANCE[attackType] -
      clampChance(bonusHitChance, "Bonus hit chance"),
  );
  const criticalChance = clampChance(critChance, "Critical chance");
  // Parry stays at 0 until the front/behind table in A7. parry.target records both.
  const outcomes = [
    { result: "miss", chance: missChance },
    { result: "dodge", chance: DODGE_CHANCE },
    { result: "parry", chance: 0 },
  ];

  if (attackType === "weapon") {
    outcomes.push({ result: "glancing", chance: GLANCING_CHANCE });
  }
  outcomes.push({ result: "crit", chance: criticalChance });

  let threshold = 0;
  let outcome = "hit";
  for (const entry of outcomes) {
    threshold += entry.chance * ROLL_SCALE;
    if (roll < threshold) {
      outcome = entry.result;
      break;
    }
  }

  const damageMultiplier = {
    miss: 0,
    dodge: 0,
    parry: 0,
    glancing: GLANCING_DAMAGE_MULTIPLIER,
    crit: CRITICAL_DAMAGE_MULTIPLIER,
    hit: 1,
  }[outcome];
  const damage = Math.floor(baseDamage * damageMultiplier);

  return {
    outcome,
    status: OUTCOME_LABELS[outcome],
    roll,
    damage,
    landed: outcome === "glancing" || outcome === "crit" || outcome === "hit",
  };
}

function clampChance(chance, name) {
  if (!Number.isFinite(chance)) {
    throw new RangeError(`${name} must be a finite number.`);
  }
  return Math.min(1, Math.max(0, chance));
}

export function rollCrit(critChance) {
  return Math.random() < clampChance(critChance, "Critical chance");
}
