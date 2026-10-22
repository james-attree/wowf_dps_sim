// Chances are fractions (0.24 = 24%); rolls are on a 0-100 scale.
const BASE_MISS_CHANCE = {
  weapon: 0.24,
  skill: 0.08
};

const DODGE_CHANCE = 0.065;
const GLANCING_CHANCE = 0.4;
const GLANCING_DAMAGE_MULTIPLIER = 0.65;
// Classic physical crits deal double damage.
const CRITICAL_DAMAGE_MULTIPLIER = 2;

const OUTCOME_LABELS = {
  miss: "Miss",
  dodge: "Dodge",
  parry: "Parry",
  glancing: "Glance",
  crit: "Crit",
  hit: "Hit"
};

export function resolveAttack({
  attackType,
  baseDamage,
  bonusHitChance,
  critChance,
  roll = Math.random() * 100
}) {
  if (!Object.hasOwn(BASE_MISS_CHANCE, attackType)) {
    throw new RangeError(`Unsupported attack type: ${attackType}`);
  }
  if (!Number.isFinite(baseDamage) || baseDamage < 0) {
    throw new RangeError("Base damage must be a non-negative number.");
  }
  if (!Number.isFinite(roll) || roll < 0 || roll > 100) {
    throw new RangeError("Attack roll must be between 0 and 100.");
  }

  const missChance = Math.max(0, BASE_MISS_CHANCE[attackType] - clampChance(bonusHitChance, "Bonus hit chance"));
  const criticalChance = clampChance(critChance, "Critical chance");
  const outcomes = [
    { result: "miss", chance: missChance },
    { result: "dodge", chance: DODGE_CHANCE },
    { result: "parry", chance: 0 }
  ];

  if (attackType === "weapon") {
    outcomes.push({ result: "glancing", chance: GLANCING_CHANCE });
  }
  outcomes.push({ result: "crit", chance: criticalChance });

  let threshold = 0;
  let outcome = "hit";
  for (const entry of outcomes) {
    threshold += entry.chance * 100;
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
    hit: 1
  }[outcome];
  const damage = Math.floor(baseDamage * damageMultiplier);

  return {
    outcome,
    status: OUTCOME_LABELS[outcome],
    roll,
    damage,
    landed: outcome === "glancing" || outcome === "crit" || outcome === "hit"
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
