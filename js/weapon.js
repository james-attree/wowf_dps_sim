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
    this.swingTimer = 0; // time since last swing
  }

  resetTimer(hasteMultiplier) {
    this.swingTimer = this.speed / hasteMultiplier;
  }

  tick(dt, hasteMultiplier, onSwingTriggered) {
    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
    }

    if (this.swingTimer === 0) {
      onSwingTriggered(this);
      this.resetTimer(hasteMultiplier);
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
