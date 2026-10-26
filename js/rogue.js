import { k } from "../data/constants.js";
import { ModifierPipeline } from "./modifiers.js";
import { normalizeConfig } from "./sim-config.js";
import { Weapon } from "./weapon.js";
import { createAbilities } from "./ability.js";
import { checkProcs } from "./procs.js";
import { abilityCatalogue } from "./abilities.js";
import { beforeFinisher } from "./rotation-rules.js";
import { createResources } from "./resource.js";

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
  // none (undefined or null), which leaves every stat as the config gave it.
  // D7 (#106) is where a talent build turns into this list.
  //
  // `options.procs` is the proc list (js/procs.js), also none by default.
  // `options.abilities` is the ids of the abilities the build grants (what
  // expandTalents gives as `abilities`), none by default. Only the rotation
  // rules (js/rotation-rules.js) read it; the rotation casts what a rule
  // names only when it is granted. Like the other two it is not part of the
  // SimConfig or the result.
  constructor(config, options = {}) {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      throw new TypeError("Rogue options must be an object.");
    }
    for (const key of Object.keys(options)) {
      if (key !== "modifiers" && key !== "procs" && key !== "abilities") {
        throw new RangeError(
          `Unknown Rogue option "${key}". Known: modifiers, procs, abilities.`,
        );
      }
    }
    this.config = normalizeConfig(config);
    // null means none, as it does for procs and abilities.
    this.modifiers = new ModifierPipeline(options.modifiers ?? []);
    // The procs (js/procs.js) the fight runs. None by default.
    this.procs = checkProcs(options.procs ?? []);
    // The ids of the abilities the build grants, checked against the catalogue.
    const granted = options.abilities ?? [];
    if (!Array.isArray(granted)) {
      throw new TypeError("Rogue option abilities must be an array of ids.");
    }
    for (const id of granted) {
      if (abilityCatalogue.get(id) === undefined) {
        throw new RangeError(
          `Rogue option abilities names "${String(id)}", which is not in the ability catalogue.`,
        );
      }
    }
    this.granted = new Set(granted);
    const { character, weapons } = this.config;
    // Energy and combo points are resource pools (js/resource.js), described
    // as data in js/resource-data.js. The pools are made before the abilities,
    // which name them by id.
    this.resources = createResources(this.modifiers);
    this.attackPower = character.attackPower;
    this.critChance = character.critChance;
    this.bonusHitChance = character.bonusHitChance;
    // The Simulation that owns this rogue sets rng. Until then a draw throws.
    this.rng = null;
    // Instant attacks use the normalized speed of the main-hand weapon for the
    // AP bonus: normalizedSpeed.dagger for a dagger, normalizedSpeed.oneHand for
    // any other type (or none). Abilities roll the main hand only (issue #129).
    this.normalizedWeaponSpeed = k(
      weapons.mainHand.type === "dagger"
        ? "normalizedSpeed.dagger"
        : "normalizedSpeed.oneHand",
    );

    this.abilities = createAbilities(this);

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

  // The two resources as the rogue's own fields, for the page, the tests and
  // a scripted fight. They read and write the pools (this.resources), which are
  // what the engine uses, so the cap is the one the resourceMax modifiers give.
  // Setting maxEnergy or maxComboPoints sets the base cap, before modifiers.
  get energy() {
    return this.resources.energy.value;
  }

  set energy(value) {
    this.resources.energy.value = value;
  }

  get maxEnergy() {
    return this.resources.energy.max;
  }

  set maxEnergy(value) {
    this.resources.energy.baseMax = value;
  }

  get comboPoints() {
    return this.resources.comboPoints.value;
  }

  set comboPoints(value) {
    this.resources.comboPoints.value = value;
  }

  get maxComboPoints() {
    return this.resources.comboPoints.max;
  }

  set maxComboPoints(value) {
    this.resources.comboPoints.baseMax = value;
  }

  // The combo points a pending expiry will remove, and the seconds left before
  // it (Premeditation). The expiry is the combo point pool's.
  get premeditationCp() {
    return this.resources.comboPoints.expiryAmount;
  }

  get premeditationCpRemaining() {
    return this.resources.comboPoints.expiryRemaining;
  }

  // Expiry always removes premeditation.cpRemovedOnExpiry, however many were added.
  armPremeditation() {
    this.resources.comboPoints.armExpiry(
      k("premeditation.cpRemovedOnExpiry"),
      k("premeditation.cpExpiry"),
    );
  }

  // Adding a combo point, or spending them, keeps the Premeditation points.
  clearPremeditation() {
    this.resources.comboPoints.clearExpiry();
  }

  // Count every resource's timed expiry down. The simulation steps it where it
  // always stepped Premeditation, before the rotation.
  tickResources(dt) {
    const { resources } = this;
    for (const id in resources) {
      resources[id].clamp();
      resources[id].tick(dt);
    }
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
    // Weapon die plus attack power / ap.perDps, times the normalized speed of
    // the main-hand type (the dagger or the one-hand constant, set above).
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
      // A rule for a granted ability (Cold Blood) may cast first.
      beforeFinisher(this, simulation, finisher);
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
