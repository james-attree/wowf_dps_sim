import { k } from "../data/constants.js";
import { Weapon } from "./weapon.js";
import * as Skills from "./skill.js";

// haste.stacking is multiplicative or additive. Any other value is a typo.
function stackHaste(hasteMultiplier, haste) {
  const stacking = k("haste.stacking");
  if (stacking === "multiplicative") {
    return hasteMultiplier * (1 + haste);
  }
  if (stacking === "additive") {
    return hasteMultiplier + haste;
  }
  throw new Error(`Unknown haste.stacking: ${stacking}`);
}

export class Rogue {
  constructor() {
    this.energy = k("start.state").energy;
    this.maxEnergy = k("energy.max");
    this.attackPower = k("character.attackPower");
    this.critChance = k("character.critChance");
    this.bonusHitChance = k("character.bonusHitChance");
    this.comboPoints = k("character.startingComboPoints");
    this.maxComboPoints = k("combo.max");
    // Combo points expiry will remove, and the time left before that.
    this.premeditationCp = 0;
    this.premeditationCpRemaining = 0;
    // The Simulation that owns this rogue sets rng. Until then a draw throws.
    this.rng = null;
    this.normalizedWeaponSpeed = k("normalizedSpeed.dagger"); // normalizedSpeed.dagger for instant-attack AP

    this.abilities = {
      premeditation: new Skills.Premeditation(this),
      sinisterStrike: new Skills.SinisterStrike(this),
      eviscerate: new Skills.Eviscerate(this),
      adrenalineRush: new Skills.AdrenalineRush(this),
      sliceAndDice: new Skills.SliceAndDice(this),
      ghostlyStrike: new Skills.GhostlyStrike(this),
      backstab: new Skills.Backstab(this),
      ambush: new Skills.Ambush(this),
      bladeFlurry: new Skills.BladeFlurry(this),
      rupture: new Skills.Rupture(this),
      hemorrhage: new Skills.Hemorrhage(this),
    };

    // Weapons
    this.weapons = {
      mainHand: null,
      offHand: null,
    };

    const mainHand = k("weapon.mainHand");
    const offHand = k("weapon.offHand");
    this.weapons.mainHand = new Weapon(
      this,
      mainHand.min,
      mainHand.max,
      mainHand.speed,
      "main",
      mainHand.type,
    );
    this.weapons.offHand = new Weapon(
      this,
      offHand.min,
      offHand.max,
      offHand.speed,
      "off",
      offHand.type ?? null,
    );
    this.weapons.offHand.swingTimer = offHand.initialSwing;
  }

  // Every random draw (weapon die, Eviscerate, and the rolls the Simulation
  // makes) goes through the one rng the Simulation owns.
  random() {
    if (typeof this.rng !== "function") {
      throw new Error(
        "Rogue has no rng. Create a Simulation for it, or set rogue.rng.",
      );
    }
    return this.rng();
  }

  regenerateEnergy(dt, rate) {
    this.energy = Math.min(this.energy + rate * dt, this.maxEnergy);
  }

  // Expiry always removes premeditation.cpRemovedOnExpiry, however many were added.
  armPremeditation() {
    this.premeditationCp = k("premeditation.cpRemovedOnExpiry");
    this.premeditationCpRemaining = k("premeditation.cpExpiry");
  }

  // Adding a combo point, or spending them, keeps the Premeditation points.
  clearPremeditation() {
    this.premeditationCp = 0;
    this.premeditationCpRemaining = 0;
  }

  tickPremeditation(dt) {
    if (this.premeditationCpRemaining <= 0) {
      return;
    }
    this.premeditationCpRemaining -= dt;
    if (this.premeditationCpRemaining > k("sim.tickEpsilon")) {
      return;
    }
    this.comboPoints = Math.max(0, this.comboPoints - this.premeditationCp);
    this.clearPremeditation();
  }

  // Character stats are read through these accessors.
  getAttackPower() {
    return this.attackPower;
  }

  getCritChance() {
    return this.critChance;
  }

  getBonusHitChance() {
    return this.bonusHitChance;
  }

  rollWeaponDamageForSkill() {
    // Weapon die plus attack power / ap.perDps, times normalizedSpeed.dagger.
    return (
      this.weapons.mainHand.rollWeaponDamage() +
      (this.getAttackPower() / k("ap.perDps")) * this.normalizedWeaponSpeed
    );
  }

  rotation(simulation, dt) {
    // rotation.priority is the placeholder Combat list. onCooldown is tried
    // first, in order. At rotation.finisherComboPoints, Slice and Dice is
    // used when it is missing or has at most
    // rotation.sliceAndDiceRefreshSeconds left; otherwise Eviscerate.
    // Otherwise the builder is used.
    const priority = k("rotation.priority");
    for (const id of priority.onCooldown) {
      this.abilities[id].cast(this, simulation);
    }

    if (this.comboPoints >= k("rotation.finisherComboPoints")) {
      const sliceAndDice = this.abilities[priority.sliceAndDice];
      const active = simulation.activeBuffs[sliceAndDice.name];
      const refresh =
        !active || active.duration <= k("rotation.sliceAndDiceRefreshSeconds");
      const finisher = refresh
        ? sliceAndDice
        : this.abilities[priority.eviscerate];
      finisher.cast(this, simulation);
    } else {
      this.abilities[priority.builder].cast(this, simulation);
    }

    // Slice and Dice and Blade Flurry shorten the next swing of both weapons.
    // haste.stacking chooses the product or the sum. A swing already counting
    // down keeps its remaining time. wowsims rescales that swing.
    let hasteMultiplier = 1;
    if (
      simulation.activeBuffs["Slice and Dice"] &&
      simulation.activeBuffs["Slice and Dice"].duration > 0
    ) {
      hasteMultiplier = stackHaste(hasteMultiplier, k("sliceAndDice").haste);
    }
    if (
      simulation.activeBuffs["Blade Flurry"] &&
      simulation.activeBuffs["Blade Flurry"].duration > 0
    ) {
      hasteMultiplier = stackHaste(hasteMultiplier, k("bladeFlurry").haste);
    }

    this.weapons.mainHand.tick(dt, hasteMultiplier, (weapon) => {
      simulation.resolveAttack("Main-hand", "weapon", weapon.rollDamage());
    });
    this.weapons.offHand.tick(dt, hasteMultiplier, (weapon) => {
      simulation.resolveAttack("Off-hand", "weapon", weapon.rollDamage());
    });
  }
}
