import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Weapon } from "../js/weapon.js";

function rawHit(weapon, attackPower, weaponRoll) {
  return weaponRoll + (attackPower / k("ap.perDps")) * weapon.speed;
}

describe("Weapon", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("throws when min damage is greater than max damage", () => {
    assert.throws(() => new Weapon(null, 110, 59, 1.8, "main"), {
      name: "RangeError",
      message: "Weapon min damage 110 is greater than max damage 59.",
    });
  });

  it("allows a weapon whose min and max damage are equal", () => {
    const weapon = new Weapon(null, 80, 80, 1.8, "main");
    mock.method(Math, "random", () => 0.5);
    assert.equal(weapon.rollWeaponDamage(), 80);
  });

  it("gives the sample main hand an inclusive 59–110 die", () => {
    const mainHand = new Rogue().weapons.mainHand;
    assert.equal(mainHand.minDamage, 59);
    assert.equal(mainHand.maxDamage, 110);
    assert.equal(mainHand.speed, 1.8);

    mock.method(Math, "random", () => 0);
    assert.equal(mainHand.rollWeaponDamage(), 59);

    mock.restoreAll();
    mock.method(Math, "random", () => 1 - Number.EPSILON);
    assert.equal(mainHand.rollWeaponDamage(), 110);
  });

  it("halves an off-hand swing after the AP bonus is added", () => {
    mock.method(Math, "random", () => 0);
    const rogue = new Rogue();
    const attackPower = rogue.getAttackPower();
    const swings = {};

    for (const [hand, weapon] of [
      ["main", rogue.weapons.mainHand],
      ["off", rogue.weapons.offHand],
    ]) {
      weapon.swingTimer = 0;
      weapon.tick(0, 1, (swung) => {
        swings[hand] = swung.rollDamage();
      });
    }

    const mainHand = rogue.weapons.mainHand;
    const offHand = rogue.weapons.offHand;
    const mainRaw = rawHit(mainHand, attackPower, mainHand.minDamage);
    const offRaw = rawHit(offHand, attackPower, offHand.minDamage);
    const offPenalty = k("offHand.damageMult");
    const weaponDieOnly =
      offHand.minDamage * offPenalty +
      (attackPower / k("ap.perDps")) * offHand.speed;

    assert.equal(offPenalty, 0.5);
    assert.equal(swings.main, mainRaw);
    assert.equal(swings.off, offRaw * offPenalty);
    assert.notEqual(swings.off, weaponDieOnly);
  });

  it("halves a mid-range off-hand roll and leaves the same main-hand roll whole", () => {
    mock.method(Math, "random", () => 0.75);
    const attackPower = 280;
    const rogue = { getAttackPower: () => attackPower };
    const mainHand = new Weapon(rogue, 10, 13, 2, "main");
    const offHand = new Weapon(rogue, 10, 13, 2, "off");
    // floor(0.75 * 4) + 10 = 13, the top of this die.
    const weaponRoll = 13;
    const raw = rawHit(offHand, attackPower, weaponRoll);
    const offHandDamage = offHand.rollDamage();

    assert.equal(mainHand.rollDamage(), raw);
    assert.equal(offHandDamage, raw * k("offHand.damageMult"));
    assert.notEqual(
      offHandDamage,
      weaponRoll * k("offHand.damageMult") +
        (attackPower / k("ap.perDps")) * offHand.speed,
    );
  });
});
