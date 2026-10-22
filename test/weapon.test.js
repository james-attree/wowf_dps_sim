import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Rogue } from "../js/rogue.js";
import { Weapon } from "../js/weapon.js";

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
});
