import { k } from "../data/constants.js";
import { normalizeConfig } from "./sim-config.js";
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
  // `config` is a SimConfig (js/sim-config.js): the character stats, the
  // weapons, the talent ranks and the poisons. It is validated and filled in
  // here, so `new Rogue()` is the default fight and `rogue.config` is always
  // the full form. The talent ranks and the poisons are carried and not read
  // by the engine yet.
  constructor(config) {
    this.config = normalizeConfig(config);
    const { character, weapons } = this.config;
    this.energy = k("start.state").energy;
    this.maxEnergy = k("energy.max");
    this.attackPower = character.attackPower;
    this.critChance = character.critChance;
    this.bonusHitChance = character.bonusHitChance;
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

    const { mainHand, offHand } = weapons;
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
      offHand.type,
    );
    // The delay is not part of the config: it only stops both hands from
    // swinging on the first frame.
    this.weapons.offHand.swingTimer = k("weapon.offHand").initialSwing;
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
      const active = simulation.activeBuffs[sliceAndDice.id];
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
    // Which auras give haste is the auras' business (js/auras.js), not
    // this method's. Each stack of an aura applies its haste again.
    let hasteMultiplier = 1;
    for (const { value, stacks } of simulation.auraEffects("haste")) {
      for (let stack = 0; stack < stacks; stack++) {
        hasteMultiplier = stackHaste(hasteMultiplier, value);
      }
    }

    this.weapons.mainHand.tick(dt, hasteMultiplier, (weapon) => {
      simulation.resolveAttack(weapon.attack, "weapon", weapon.rollDamage());
    });
    this.weapons.offHand.tick(dt, hasteMultiplier, (weapon) => {
      simulation.resolveAttack(weapon.attack, "weapon", weapon.rollDamage());
    });
  }
}
