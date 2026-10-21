import { Weapon } from "./weapon.js";
import * as Skills from "./skill.js";

export class Rogue {
  constructor() {
    this.energy = 100;
    this.maxEnergy = 100;
    this.attackPower = 450;
    this.critChance = 0.10;
    this.bonusHitChance = 0.09;
    this.comboPoints = 3;
    this.maxComboPoints = 5;
    this.normalizedWeaponSpeed = 1.7; // Normalized weapon speed for AP contribution

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
    };

    // Weapons
    this.weapons = {
      mainHand: null,
      offHand: null
    };

    this.weapons.mainHand = new Weapon(this, 110, 59, 1.8, "main"); // Example values
    this.weapons.offHand = new Weapon(this, 54, 101, 1.7, "off"); // Example values
    this.weapons.offHand.swingTimer = 0.5;
  }

  regenerateEnergy(dt, rate) {
    this.energy = Math.min(this.energy + (rate * dt), this.maxEnergy);
  }

  getAttackPower() {
    return this.attackPower;
  }

  getCritChance() {
    return this.critChance;
  }

  getBonusHitChance(){
    return this.bonusHitChance;
  }

  rollWeaponDamageForSkill(){
    return this.weapons.mainHand.rollWeaponDamage() + ((this.attackPower / 14) * this.normalizedWeaponSpeed); // Simplified AP contribution
  }

  rotation(simulation, dt) {

    if (this.energy <= 25){
      this.abilities.adrenalineRush.cast(this, simulation); // Cast Adrenaline Rush if energy is low 
    }

    this.abilities.bladeFlurry.cast(this, simulation); // Cast Blade Flurry if available

    this.abilities.premeditation.cast(this, simulation); // Cast Premeditation if available

    // If we aren't already under the effect of Slice and Dice, or if it's about to expire, and we have enough combo points, cast it
    if ((!simulation.activeBuffs["Slice and Dice"] || (simulation.activeBuffs["Slice and Dice"] && simulation.activeBuffs["Slice and Dice"].duration <= 3)) && this.comboPoints >= 4) {
      this.abilities.sliceAndDice.cast(this, simulation);
    }

    if (this.comboPoints >= 4) {
      this.abilities.eviscerate.cast(this, simulation);
    }

    this.abilities.ghostlyStrike.cast(this, simulation); // Cast Ghostly Strike if available

    this.abilities.sinisterStrike.cast(this, simulation);

    // Tick weapons
    let hasteMultiplier = 1; // Placeholder for any haste effects
    if (simulation.activeBuffs["Slice and Dice"] && simulation.activeBuffs["Slice and Dice"].duration > 0){
      hasteMultiplier += 0.3; // Example: Slice and Dice increases attack speed by 30%
    }
    if (simulation.activeBuffs["Blade Flurry"] && simulation.activeBuffs["Blade Flurry"].duration > 0){
      hasteMultiplier += 0.2; // Example: Blade Flurry increases attack speed by 20%
    }

    this.weapons.mainHand.tick(dt, hasteMultiplier, (weapon) => {
        simulation.resolveAttack("Main-hand", "weapon", weapon.rollDamage());
    });
    this.weapons.offHand.tick(dt, hasteMultiplier, (weapon) => {
        simulation.resolveAttack("Off-hand", "weapon", weapon.rollDamage());
    });
  }
}
