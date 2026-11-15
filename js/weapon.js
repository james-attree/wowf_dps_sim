import { k } from "../data/constants.js";

// What a weapon's swing is called to the engine: an id for the per-ability
// totals and a display name for the combat log. Not catalogue abilities, so
// their ids are these two.
const WEAPON_ATTACKS = Object.freeze({
  // `hand` is the modifier scope's name for the hand (js/modifiers.js).
  main: Object.freeze({
    id: "main-hand",
    name: "Main-hand",
    icon: null,
    hand: "mainHand",
  }),
  off: Object.freeze({
    id: "off-hand",
    name: "Off-hand",
    icon: null,
    hand: "offHand",
  }),
});

export class Weapon {
  constructor(rogue, minDamage, maxDamage, speed, hand, type = null) {
    // NaN > x is false, so the range check below does not reject it.
    if (!Number.isFinite(minDamage)) {
      throw new RangeError("Weapon min damage must be a finite number.");
    }
    if (!Number.isFinite(maxDamage)) {
      throw new RangeError("Weapon max damage must be a finite number.");
    }
    if (!Number.isFinite(speed)) {
      throw new RangeError("Weapon speed must be a finite number.");
    }
    if (speed <= 0) {
      throw new RangeError("Weapon speed must be greater than 0.");
    }
    // The swing loop does one pass per swing, so a speed near 0 never
    // finishes a fight (#111 QA: 1e-9 s hung runFight).
    if (speed < k("config.minWeaponSpeed")) {
      throw new RangeError(
        `Weapon speed must be at least ${k("config.minWeaponSpeed")} seconds, not ${speed}.`,
      );
    }
    if (minDamage > maxDamage) {
      throw new RangeError(
        `Weapon min damage ${minDamage} is greater than max damage ${maxDamage}.`,
      );
    }
    this.rogue = rogue;
    this.minDamage = minDamage;
    this.maxDamage = maxDamage;
    this.speed = speed; // in seconds
    this.hand = hand; // 'main' or 'off'
    // The source Simulation.resolveAttack records this hand's swings under.
    // Own keys only: "toString" or "__proto__" is not a hand.
    if (!Object.hasOwn(WEAPON_ATTACKS, hand)) {
      throw new RangeError(`Weapon hand must be 'main' or 'off', not ${hand}.`);
    }
    this.attack = WEAPON_ATTACKS[hand];
    // 'dagger' selects the dagger weapon percent. Any other type does not.
    this.type = type;
    // Seconds until the next swing; 0 means one is due. The event core's
    // SwingTimer (js/core/swing.js) reads it at a run's start and writes it
    // back at its close.
    this.swingTimer = 0;
  }

  rollWeaponDamage() {
    const min = this.minDamage;
    const max = this.maxDamage;
    const roll = this.rogue.random();
    // Both bounds integers: the inclusive die, unchanged. One draw, as before.
    if (Number.isInteger(min) && Number.isInteger(max)) {
      return Math.floor(roll * (max - min + 1)) + min;
    }
    // Either bound fractional. Assumption, coordinator call 15 Nov (James
    // delegated): a continuous roll on [min, max], mean exactly (min + max) / 2.
    // Not a game mechanic. One draw, the same as the integer path. The value
    // is not rounded here; rollDamage adds the attack-power term and, for the
    // off hand, multiplies the sum, and that amount is what the attack table
    // records. The page floors damage only when it displays it.
    return min + roll * (max - min);
  }

  rollDamage() {
    // offHand.damageMult scales the whole hit, weapon roll and the AP bonus.
    let hit =
      this.rollWeaponDamage() +
      (this.rogue.getAttackPower() / k("ap.perDps")) * this.speed;
    if (this.hand === "off") {
      hit *= k("offHand.damageMult");
    }
    return hit;
  }
}
