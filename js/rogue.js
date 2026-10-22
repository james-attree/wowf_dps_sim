import { k } from "../data/constants.js";
import { Weapon } from "./weapon.js";
import * as Skills from "./skill.js";

export class Rogue {
  constructor() {
    this.energy = k("start.state").energy;
    this.maxEnergy = k("energy.max");
    this.attackPower = k("character.attackPower");
    this.critChance = k("character.critChance");
    this.bonusHitChance = k("character.bonusHitChance");
    this.comboPoints = k("character.startingComboPoints");
    this.maxComboPoints = k("combo.max");
    this.normalizedWeaponSpeed = k("normalizedSpeed.dagger"); // Normalized weapon speed for AP contribution

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
    ); // Example values
    this.weapons.offHand = new Weapon(
      this,
      offHand.min,
      offHand.max,
      offHand.speed,
      "off",
    ); // Example values
    this.weapons.offHand.swingTimer = offHand.initialSwing;
  }

  regenerateEnergy(dt, rate) {
    this.energy = Math.min(this.energy + rate * dt, this.maxEnergy);
  }

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
    return (
      this.weapons.mainHand.rollWeaponDamage() +
      (this.attackPower / k("ap.perDps")) * this.normalizedWeaponSpeed
    ); // Simplified AP contribution
  }

  rotation(simulation, dt) {
    if (this.energy <= k("rotation.adrenalineRushEnergy")) {
      this.abilities.adrenalineRush.cast(this, simulation); // Cast Adrenaline Rush if energy is low
    }

    this.abilities.bladeFlurry.cast(this, simulation); // Cast Blade Flurry if available

    this.abilities.premeditation.cast(this, simulation); // Cast Premeditation if available

    // If we aren't already under the effect of Slice and Dice, or if it's about to expire, and we have enough combo points, cast it
    if (
      (!simulation.activeBuffs["Slice and Dice"] ||
        (simulation.activeBuffs["Slice and Dice"] &&
          simulation.activeBuffs["Slice and Dice"].duration <=
            k("rotation.sliceAndDiceRefreshSeconds"))) &&
      this.comboPoints >= k("rotation.sliceAndDiceComboPoints")
    ) {
      //this.abilities.sliceAndDice.cast(this, simulation);
    }

    if (this.comboPoints >= k("combo.max")) {
      this.abilities.rupture.cast(this, simulation);
    }

    this.abilities.ghostlyStrike.cast(this, simulation); // Cast Ghostly Strike if available

    this.abilities.hemorrhage.cast(this, simulation);

    // Tick weapons
    let hasteMultiplier = 1; // Placeholder for any haste effects
    if (
      simulation.activeBuffs["Slice and Dice"] &&
      simulation.activeBuffs["Slice and Dice"].duration > 0
    ) {
      hasteMultiplier += k("sliceAndDice").haste; // Example: Slice and Dice increases attack speed by 30%
    }
    if (
      simulation.activeBuffs["Blade Flurry"] &&
      simulation.activeBuffs["Blade Flurry"].duration > 0
    ) {
      hasteMultiplier += k("bladeFlurry").haste; // Example: Blade Flurry increases attack speed by 20%
    }

    this.weapons.mainHand.tick(dt, hasteMultiplier, (weapon) => {
      simulation.resolveAttack("Main-hand", "weapon", weapon.rollDamage());
    });
    this.weapons.offHand.tick(dt, hasteMultiplier, (weapon) => {
      simulation.resolveAttack("Off-hand", "weapon", weapon.rollDamage());
    });
  }
}
