import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { abilityCatalogue } from "./abilities.js";
import { AURAS } from "./auras.js";

// The generic ability executor (roadmap D2). An Ability is built from one
// entry of js/ability-data.js and casts it. Every ability goes through the
// same cast, so a new ability is a new entry and no new class.
//
// An ability is identified by its id, the catalogue's id for it (js/abilities.js,
// slugify(name)). Its name is read from the catalogue for display: the page,
// the combat log and the result's per-ability breakdown. Nothing compares it.

// A weapon multiplier is one number, or { dagger, other } by the main-hand
// type. Only the config's weapon type decides it.
function weaponMultiplier(value, rogue) {
  if (typeof value === "number") {
    return value;
  }
  return rogue.weapons.mainHand.type === "dagger" ? value.dagger : value.other;
}

// How each damage kind is worked out. Each gets the entry's `damage` spec, the
// row's constants and the rogue, and returns the damage or, for a dot, the
// damage and the duration. The weapon and finisherRoll kinds draw one number
// from the rogue's rng, and the dot kind none.
const DAMAGE = {
  weapon(spec, stats, rogue) {
    const multiplier =
      spec.multiplier === undefined
        ? 1
        : weaponMultiplier(stats[spec.multiplier], rogue);
    const bonus = spec.bonus === undefined ? 0 : stats[spec.bonus];
    return rogue.rollWeaponDamageForSkill() * multiplier + bonus;
  },

  finisherRoll(spec, stats, rogue) {
    const comboPoints = rogue.comboPoints;
    const modifier = rogue.getAttackPower() * comboPoints * k(spec.apPerCp);
    let min = modifier;
    let max = modifier;
    const bands = stats[spec.bands];
    if (comboPoints >= 1 && comboPoints <= bands.length) {
      min += bands[comboPoints - 1].min;
      max += bands[comboPoints - 1].max;
    }
    return Math.floor(rogue.random() * (max - min + 1) + min);
  },

  dot(spec, stats, rogue, durations) {
    // Totals, not per tick. The DoT applicator divides this by the tick count.
    const comboPoints = rogue.comboPoints;
    const apByCp = k(spec.ap);
    if (
      comboPoints < 1 ||
      comboPoints > stats.damageByCp.length ||
      comboPoints > durations.length ||
      comboPoints > apByCp.length
    ) {
      return null;
    }
    return (
      stats.damageByCp[comboPoints - 1] +
      rogue.getAttackPower() * apByCp[comboPoints - 1]
    );
  },
};

export class Ability {
  constructor(definition, rogue) {
    const stats = k(definition.row);
    this.definition = definition;
    this.rogue = rogue;
    this.id = definition.id;
    const catalogued = abilityCatalogue.get(definition.id);
    if (catalogued === undefined) {
      throw new Error(
        `The ability "${definition.id}" is not in the ability catalogue.`,
      );
    }
    this.name = catalogued.name;
    this.energyCost = stats.energy;
    // What an energyCost modifier's scope sees of this ability. An ability
    // attacks with the main hand (Simulation.attackContext reads `hand`).
    this.hand = "mainHand";
    this.costContext = Object.freeze({ ability: this.id });
    this.cooldown = stats.cooldown;
    this.icon = definition.icon;
    // Whether a cast starts the global cooldown. An off-GCD ability skips the
    // wait for a clear GCD and does not start one.
    this.triggersGcd = catalogued.startsGcd;
    this.spender = definition.comboPoints === "spend";
    this.comboPointsGenerated =
      definition.comboPoints === "gain" ? stats.comboPoints : 0;
    // Premeditation only. Expiry removes premeditation.cpRemovedOnExpiry
    // unless a later cast adds a combo point or a finisher spends them.
    this.expiresComboPoints = definition.expiresComboPoints === true;
    this.attackSkill = definition.damage !== undefined;
    this.dot = definition.damage?.kind === "dot";
    this.bleed = definition.damage?.bleed === true;
    // The aura (js/auras.js) a cast puts up for `duration` seconds, if any. An
    // aura on the player (haste, energy regen) is a buff, one on the target (a
    // DoT, or bonus damage taken) a debuff: the definition says which.
    this.aura =
      definition.aura === undefined ? null : AURAS[definition.aura.id];
    // The aura's length when it does not depend on the combo points spent.
    this.duration = 0;
    const length = definition.aura?.duration;
    if (length?.field !== undefined) {
      this.duration = k(length.row ?? definition.row)[length.field];
    }
  }

  // The damage and aura length of a cast now: { damage, duration }. A damage
  // kind that draws from the rng does it here, once per call. A length by combo
  // points is 0 outside the combo points the table covers, and so is the damage
  // of a dot.
  resolve() {
    const { definition, rogue } = this;
    const stats = k(definition.row);
    let duration = this.duration;
    const table = definition.aura?.duration.byComboPoints;
    if (table !== undefined) {
      const durations = stats[table];
      const comboPoints = rogue.comboPoints;
      duration =
        comboPoints >= 1 && comboPoints <= durations.length
          ? durations[comboPoints - 1]
          : 0;
    }
    const spec = definition.damage;
    if (spec === undefined) {
      return { damage: 0, duration };
    }
    const damage = DAMAGE[spec.kind](spec, stats, rogue, stats[table] ?? []);
    return damage === null ? { damage: 0, duration: 0 } : { damage, duration };
  }

  damage() {
    return this.resolve().damage;
  }

  onCooldown(rogue, simulation) {
    return simulation.cooldowns[this.id] > 0;
  }

  cast(rogue, simulation) {
    if (this.onCooldown(rogue, simulation)) {
      return null; // On cooldown, cannot cast
    }
    // Spenders (Eviscerate, Rupture, Slice and Dice) need a combo point.
    if (this.spender && rogue.comboPoints < 1) {
      return null;
    }
    // gcd.flags: an ability on the GCD waits until it is clear. A remainder
    // within sim.tickEpsilon counts as clear, the same tolerance buffs,
    // cooldowns, DoT expiry, and weapon swings already use. Every off-GCD
    // ability skips that wait and does not start one, not only Premeditation.
    // A future off-GCD ability, such as Cold Blood, inherits this.
    // The cost after energyCost modifiers (Improved Sinister Strike). With
    // none, it is this.energyCost as it stands.
    const energyCost = simulation.modifiers.resolve(
      "energyCost",
      this.energyCost,
      this.costContext,
    );
    if (
      rogue.energy >= energyCost &&
      (simulation.gcd <= k("sim.tickEpsilon") || !this.triggersGcd)
    ) {
      rogue.energy -= energyCost;
      if (this.triggersGcd) {
        simulation.setGcd();
      }

      let result = null;
      const { damage, duration } = this.resolve();

      if (this.attackSkill) {
        if (this.dot) {
          // DoTs log the application with no immediate damage. Ticks use the resolved amount.
          result = simulation.resolveDotAttack(
            this,
            "skill",
            damage,
            duration,
            this.bleed,
          );
        } else {
          result = simulation.resolveAttack(this, "skill", damage);
        }
      } else {
        simulation.recordAbility(this, "cast");
        simulation.addCombatEvent(
          this.name,
          "skill",
          0,
          "Cast",
          "cast",
          this.icon,
        );
      }

      if (result && !result.landed) {
        // A miss refunds skill.missEnergyRefund of the energy and does not start the cooldown.
        rogue.energy += energyCost * k("skill.missEnergyRefund");
        return result; // Return the result of the attack attempt
      }

      if (this.spender) {
        rogue.comboPoints = 0; // Reset combo points after spending
        rogue.clearPremeditation();
      } else {
        const before = rogue.comboPoints;
        rogue.comboPoints = Math.min(
          rogue.comboPoints + this.comboPointsGenerated,
          rogue.maxComboPoints,
        );
        const gained = rogue.comboPoints - before;
        if (this.expiresComboPoints) {
          rogue.armPremeditation();
        } else if (gained > 0) {
          rogue.clearPremeditation();
        }
      }

      //  Put this attack on CD
      if (this.cooldown > 0) {
        simulation.cooldowns[this.id] = this.cooldown; // Set the ability's cooldown
      }

      if (duration > 0 && this.aura) {
        simulation.applyAura(this.aura, { duration, icon: this.icon });
      }

      return result;
    }
    return null;
  }
}

// The rogue's abilities by key, in the order of ABILITY_DEFINITIONS.
export function createAbilities(rogue) {
  return Object.fromEntries(
    ABILITY_DEFINITIONS.map((definition) => [
      definition.key,
      new Ability(definition, rogue),
    ]),
  );
}
