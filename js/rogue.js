import { Weapon } from "./weapon.js";
import { SinisterStrike, Eviscerate } from "./skill.js";

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
      sinisterStrike: new SinisterStrike(this),
      eviscerate: new Eviscerate(this)
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

  regenerateEnergy(dt) {
    this.energy = Math.min(this.energy + (10 * dt), this.maxEnergy);
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
    // Example rotation logic
    this.abilities.sinisterStrike.cast(this, simulation);

    if (this.comboPoints >= 4) {
      this.abilities.eviscerate.cast(this, simulation);
    }

    // Tick weapons
    this.weapons.mainHand.tick(dt, 1, (weapon) => {
        simulation.resolveAttack("Main-hand", "weapon", weapon.rollDamage());
    });
    this.weapons.offHand.tick(dt, 1, (weapon) => {
        simulation.resolveAttack("Off-hand", "weapon", weapon.rollDamage());
    });
  }
}
