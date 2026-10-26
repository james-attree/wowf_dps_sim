import { k } from "../data/constants.js";

// Chances are fractions. White miss is yellow miss plus the dual-wield penalty.
// Rolls are compared on attack.rollScale so callers can inject a roll.
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

// The roll is the simulation's rng times attack.rollScale. A caller that
// injects a roll does not need an rng, and no draw is made.
function drawRoll(rng) {
  if (typeof rng !== "function") {
    throw new TypeError("resolveAttack needs an rng function or a roll.");
  }
  return rng() * ROLL_SCALE;
}

export function resolveAttack({
  attackType,
  baseDamage,
  bonusHitChance,
  critChance,
  critMultiplier = CRITICAL_DAMAGE_MULTIPLIER,
  dodgeReduction = 0,
  parryReduction = 0,
  rng,
  roll = drawRoll(rng),
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
  if (!Number.isFinite(critMultiplier) || critMultiplier < 0) {
    throw new RangeError("Critical multiplier must be a non-negative number.");
  }
  // Expertise-style reductions come from the modifier pipeline (A2). Zero,
  // the default, leaves the chance exactly as it was.
  const dodgeChance = Math.max(
    0,
    DODGE_CHANCE - clampChance(dodgeReduction, "Dodge reduction"),
  );
  // Parry stays at 0 until the front/behind table in A7. parry.target records
  // both. The reduction is read now so A7 only has to raise the base.
  const parryChance = Math.max(
    0,
    0 - clampChance(parryReduction, "Parry reduction"),
  );
  const outcomes = [
    { result: "miss", chance: missChance },
    { result: "dodge", chance: dodgeChance },
    { result: "parry", chance: parryChance },
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
    crit: critMultiplier,
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

export function rollCrit(critChance, rng) {
  const chance = clampChance(critChance, "Critical chance");
  if (typeof rng !== "function") {
    throw new TypeError("rollCrit needs an rng function.");
  }
  return rng() < chance;
}
