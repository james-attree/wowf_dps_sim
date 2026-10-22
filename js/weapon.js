export class Weapon {
  constructor(rogue, minDamage, maxDamage, speed, hand) {
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
    let weaponDamage = this.rollWeaponDamage();
    if (this.hand === "off") {
      weaponDamage *= 0.5; // Off-hand damage is typically reduced
    }
    return weaponDamage + (this.rogue.getAttackPower() / 14) * this.speed; // Simplified AP contribution
  }
}
