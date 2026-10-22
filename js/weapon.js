import { k } from "../data/constants.js";

export class Weapon {
  constructor(rogue, minDamage, maxDamage, speed, hand) {
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
      Math.floor(Math.random() * (this.maxDamage - this.minDamage + 1)) +
      this.minDamage
    );
  }

  rollDamage() {
    // Classic applies the off-hand penalty to the whole hit, AP bonus included.
    let hit =
      this.rollWeaponDamage() +
      (this.rogue.getAttackPower() / k("ap.perDps")) * this.speed;
    if (this.hand === "off") {
      hit *= k("offHand.damageMult");
    }
    return hit;
  }
}
