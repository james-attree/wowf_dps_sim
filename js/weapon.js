import { k } from "../data/constants.js";

// What a weapon's swing is called to the engine: an id for the per-ability
// totals and a display name for the combat log. Not catalogue abilities, so
// their ids are these two.
const WEAPON_ATTACKS = Object.freeze({
  main: Object.freeze({ id: "main-hand", name: "Main-hand", icon: null }),
  off: Object.freeze({ id: "off-hand", name: "Off-hand", icon: null }),
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
    this.attack = WEAPON_ATTACKS[hand];
    if (this.attack === undefined) {
      throw new RangeError(`Weapon hand must be 'main' or 'off', not ${hand}.`);
    }
    // 'dagger' selects the dagger weapon percent. Any other type does not.
    this.type = type;
    this.swingTimer = 0; // seconds until the next swing; 0 means one is due
  }

  tick(dt, hasteMultiplier, onSwingTriggered) {
    const interval = this.speed / hasteMultiplier;
    this.swingTimer -= dt;
    // A step can cover several swings. Time past each one stays on the timer,
    // so the next swing is not delayed by a full interval.
    if (interval > 0) {
      while (this.swingTimer <= k("sim.tickEpsilon")) {
        onSwingTriggered(this);
        this.swingTimer += interval;
      }
    }
  }

  rollWeaponDamage() {
    return (
      Math.floor(this.rogue.random() * (this.maxDamage - this.minDamage + 1)) +
      this.minDamage
    );
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
