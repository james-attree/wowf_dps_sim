import { k } from "../data/constants.js";
import { ModifierPipeline } from "./modifiers.js";
import { normalizeConfig } from "./sim-config.js";
import { Weapon } from "./weapon.js";
import * as Skills from "./skill.js";

export class Rogue {
  // `config` is a SimConfig (js/sim-config.js): the character stats, the
  // weapons, the talent ranks and the poisons. It is validated and filled in
  // here, so `new Rogue()` is the default fight and `rogue.config` is always
  // the full form. The talent ranks and the poisons are carried and not read
  // by the engine yet.
  //
  // `options.modifiers` is the static modifier list (js/modifiers.js): what
  // the talents and gear give, as data. It is not part of the SimConfig, so a
  // fight's result shape and its goldens do not depend on it. The default is
  // none, which leaves every stat as the config gave it. D7 (#103) is where a
  // talent build turns into this list.
  constructor(config, options = {}) {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      throw new TypeError("Rogue options must be an object.");
    }
    for (const key of Object.keys(options)) {
      if (key !== "modifiers") {
        throw new RangeError(
          `Unknown Rogue option "${key}". Known: modifiers.`,
        );
      }
    }
    this.config = normalizeConfig(config);
    this.modifiers = new ModifierPipeline(options.modifiers);
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
  // The stat as the character has it, through the modifier pipeline. The
  // context says which attack is asking (Simulation.attackContext); without
  // one, only the modifiers with no scope apply.
  getAttackPower() {
    return this.modifiers.resolve("attackPower", this.attackPower);
  }

  getCritChance(context) {
    return this.modifiers.resolve("critChance", this.critChance, context);
  }

  getBonusHitChance(context) {
    return this.modifiers.resolve("hitChance", this.bonusHitChance, context);
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

    // Whatever gives haste (Slice and Dice, Blade Flurry, a talent) shortens
    // the next swing of both weapons. haste.stacking chooses the product or
    // the sum. A swing already counting down keeps its remaining time.
    // wowsims rescales that swing. The pipeline names no source: the haste
    // modifiers of the auras that are up combine in registry order, each
    // stack applying again.
    const hasteMultiplier = simulation.modifiers.resolve("haste", 1);

    this.weapons.mainHand.tick(dt, hasteMultiplier, (weapon) => {
      simulation.resolveAttack(weapon.attack, "weapon", weapon.rollDamage());
    });
    this.weapons.offHand.tick(dt, hasteMultiplier, (weapon) => {
      simulation.resolveAttack(weapon.attack, "weapon", weapon.rollDamage());
    });
  }
}
