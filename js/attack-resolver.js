import { k } from "../data/constants.js";

// The Classic 1.12 melee attack table (roadmap A7). Chances are fractions.
// Rolls are compared on attack.rollScale so callers can inject a roll.
//
// A white swing ("weapon") is one roll over the bands miss, dodge, parry,
// glancing, block, crit, hit (table.white). A yellow attack ("skill") is two
// rolls (table.yellow): the first walks miss, dodge, parry, block and is a hit
// when none of them takes it; a hit then rolls again for the crit. The numbers
// are the data/constants.js rows, read here at the call so a test can change
// one. The parry and block bands exist only from the front.
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

// The first part of bonus hit that does not count: k("hit.suppression") when
// the target's defense is more than k("hit.suppressionGap") above the weapon
// skill (315 against 300), else none.
export function hitSuppression() {
  const gap = k("target.defense") - k("weaponSkill.base");
  return gap > k("hit.suppressionGap") ? k("hit.suppression") : 0;
}

// A crit chance after the level-difference suppression: the skill term and the
// aura term (crit.suppressionSkill and crit.suppressionAura), never below 0.
export function suppressCrit(critChance) {
  const chance = clampChance(critChance, "Critical chance");
  return Math.max(
    0,
    chance - k("crit.suppressionSkill") - k("crit.suppressionAura"),
  );
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
}) {
  if (!ATTACK_TYPES.includes(attackType)) {
    throw new RangeError(`Unsupported attack type: ${attackType}`);
  }
  const white = attackType === "weapon";
  const bonusHit = Math.max(
    0,
    clampChance(bonusHitChance, "Bonus hit chance") - hitSuppression(),
  );
  const baseMiss = k("miss.yellow") + (white ? k("miss.dualWieldPenalty") : 0);
  const position = behind ? "behind" : "front";
  return {
    miss: Math.max(0, baseMiss - bonusHit),
    // Expertise-style reductions come from the modifier pipeline (A2). Zero,
    // the default, leaves the chance exactly as it was.
    dodge: Math.max(
      0,
      k("dodge.target") - clampChance(dodgeReduction, "Dodge reduction"),
    ),
    parry: Math.max(
      0,
      k("parry.target")[position] -
        clampChance(parryReduction, "Parry reduction"),
    ),
    glancing: white ? k("glancing.chance") : 0,
    block: k("block.target")[position],
    crit: canCrit ? suppressCrit(critChance) : 0,
  };
}

// `canCrit: false` is an attack with no crit roll at all, such as a DoT's
// application: a yellow attack then takes one draw, not two.
//
// Draws from rng, in this order: the table roll; for a glancing blow, the
// glancing-damage factor; for a yellow hit that can crit, the crit roll.
// critRoll and glanceRoll inject those two draws (on attack.rollScale).
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
    const { low, high } = k("glancing.damage");
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
    damage = Math.floor(Math.max(0, baseDamage - k("block.value")));
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

// Poison procs (A5) are spell hits: miss at spell.missTarget.chance, less the
// bonus spell hit, never below its floor. Melee hit does not reduce it
// (poison.hitModel). One draw, unless a roll is injected.
export function spellMissChance(bonusSpellHit = 0) {
  const { chance, floor } = k("spell.missTarget");
  return Math.max(
    floor,
    chance - clampChance(bonusSpellHit, "Bonus spell hit chance"),
  );
}

export function resolveSpellHit({
  bonusSpellHit = 0,
  rng,
  roll = drawRoll(rng),
}) {
  checkRoll(roll, "Spell roll");
  const missed = roll < spellMissChance(bonusSpellHit) * ROLL_SCALE;
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
