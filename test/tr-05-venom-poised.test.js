// TR-05 / #334: Venom is a passive on Shank, Poised is up at pull when energy
// is full, and Composure adds to that reduction. The old Venom finisher is
// not a castable ability.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { AURAS } from "../js/auras.js";
import { createFight } from "../js/fight.js";
import { castableAbilities } from "../js/rotation-edit.js";
import { expandTalents } from "../js/talent-build.js";

const swords = {
  weapons: {
    mainHand: { type: "sword", min: 80, max: 120, speed: 2.6 },
    offHand: { type: "sword", min: 50, max: 80, speed: 2.6 },
  },
  poisons: { mainHand: "instant", offHand: "deadly" },
};

function withConstant(id, value, run) {
  const row = CONSTANTS[id];
  const saved = row.value;
  row.value = value;
  try {
    return run();
  } finally {
    row.value = saved;
  }
}

function fight(talents, extra = {}) {
  return createFight(1, { ...swords, talents, ...extra });
}

function landShank(fight) {
  const { rogue, simulation } = fight;
  for (let i = 0; i < 40; i += 1) {
    rogue.energy = rogue.maxEnergy;
    simulation.gcd = 0;
    simulation.cooldowns.shank = 0;
    const result = rogue.abilities.shank.cast(rogue, simulation);
    if (result?.landed) {
      return result;
    }
  }
  assert.fail("expected a landed Shank");
}

describe("TR-05 Venom (#334)", () => {
  it("is not a castable finisher", () => {
    assert.equal(
      ABILITY_DEFINITIONS.some((definition) => definition.id === "venom"),
      false,
    );
    assert.equal(castableAbilities().includes("venom"), false);
    assert.equal(TALENT_EFFECTS["assassination.venom"].pending, undefined);
    assert.equal(TALENT_EFFECTS["assassination.venom"].ability, undefined);
  });

  it("reads the team assumption that +20% is percentage points", () => {
    assert.equal(CONSTANTS["venom.chanceAddMode"].source, "assumption");
    assert.match(CONSTANTS["venom.chanceAddMode"].ref, /Team assumption/);
    assert.doesNotMatch(CONSTANTS["venom.chanceAddMode"].ref, /James/);
    assert.equal(k("venom.chanceAddMode"), "percentage points");
    assert.equal(k("venom.chanceAdd"), 0.2);
    assert.equal(k("venom").duration, 6);
    assert.equal(k("venom").poisonDamage, 1.3);
    assert.deepEqual([...k("venom").abilities], ["shank"]);
  });

  it("a landed Shank with the talent applies 6 s of +30% poison damage and +20 points", () => {
    const h = fight({ "assassination.venom": 1 });
    assert.equal(h.simulation.hasAura("venom"), false);
    landShank(h);
    const aura = h.simulation.activeBuffs.venom;
    assert.equal(aura.duration, k("venom").duration);
    const poison = { tags: ["poison"] };
    assert.equal(
      h.simulation.modifiers.resolve("damage", 100, poison),
      100 * k("venom").poisonDamage,
    );
    assert.equal(
      h.simulation.modifiers.resolve("poisonChance", 0.2, {}),
      0.2 + k("venom.chanceAdd"),
    );
  });

  it("does not apply Venom when Shank does not land, or without the talent", () => {
    const missed = fight({ "assassination.venom": 1 });
    const { rogue, simulation } = missed;
    rogue.energy = rogue.maxEnergy;
    simulation.gcd = 0;
    const rng = simulation.rng;
    simulation.rng = () => 0;
    const result = rogue.abilities.shank.cast(rogue, simulation);
    simulation.rng = rng;
    assert.equal(result.landed, false);
    assert.equal(simulation.hasAura("venom"), false);

    const plain = fight({});
    landShank(plain);
    assert.equal(plain.simulation.hasAura("venom"), false);
  });

  it("reads chanceAddMode at fight build, so another mode adds no chance", () => {
    withConstant("venom.chanceAddMode", "off", () => {
      const h = fight({ "assassination.venom": 1 });
      landShank(h);
      assert.equal(h.simulation.hasAura("venom"), true);
      assert.equal(
        h.simulation.modifiers.resolve("poisonChance", 0.2, {}),
        0.2,
      );
      assert.equal(
        h.simulation.modifiers.resolve("damage", 100, { tags: ["poison"] }),
        100 * k("venom").poisonDamage,
      );
    });
  });

  it("Venom's poison damage still multiplies with a poison-damage add", () => {
    const h = fight(
      { "assassination.venom": 1, "assassination.vile-poisons": 5 },
      {},
    );
    landShank(h);
    assert.equal(
      h.simulation.modifiers.resolve("damage", 100, { tags: ["poison"] }),
      100 * 1.2 * k("venom").poisonDamage,
    );
  });
});

describe("TR-05 Poised and Composure (#334)", () => {
  it("tags the at-pull rule as a team assumption and reads it", () => {
    assert.equal(CONSTANTS["poised.atPull"].source, "assumption");
    assert.match(CONSTANTS["poised.atPull"].ref, /Team assumption/);
    assert.doesNotMatch(CONSTANTS["poised.atPull"].ref, /James/);
    assert.equal(k("poised.atPull"), "when energy is full");
    assert.equal(k("poised").energy, 10);
    assert.equal(TALENT_EFFECTS["combat.composure"].pending, undefined);
    const { modifiers } = expandTalents({ "combat.composure": 2 });
    assert.deepEqual(
      modifiers.map((modifier) => modifier.value),
      [10],
    );
  });

  it("is up at pull when starting energy is at the cap, and the next energy cast spends it", () => {
    const h = fight({});
    assert.equal(h.rogue.energy, h.rogue.maxEnergy);
    assert.equal(h.simulation.hasAura("poised"), true);
    const before = h.rogue.energy;
    h.simulation.gcd = 0;
    const result = h.rogue.abilities.sinisterStrike.cast(h.rogue, h.simulation);
    assert.ok(result);
    assert.equal(
      before - h.rogue.energy,
      Math.max(0, k("sinisterStrike").energy - k("poised").energy),
    );
    assert.equal(h.simulation.hasAura("poised"), false);
  });

  it("stays down when starting energy is below the cap (Vigor)", () => {
    const h = fight({ "assassination.vigor": 2 });
    assert.ok(h.rogue.energy < h.rogue.maxEnergy);
    assert.equal(h.simulation.hasAura("poised"), false);
  });

  it("stays down when the team assumption is not the full-energy rule", () => {
    withConstant("poised.atPull", "never", () => {
      const h = fight({});
      assert.equal(h.rogue.energy, h.rogue.maxEnergy);
      assert.equal(h.simulation.hasAura("poised"), false);
    });
  });

  it("Composure adds its rank's energy to Poised, from the constant", () => {
    withConstant("start.state", { energy: 110, comboPoints: 0 }, () => {
      const h = fight({
        "assassination.vigor": 2,
        "combat.composure": 2,
      });
      assert.equal(h.rogue.energy, h.rogue.maxEnergy);
      assert.equal(h.simulation.hasAura("poised"), true);
      const before = h.rogue.energy;
      h.simulation.gcd = 0;
      h.rogue.abilities.sinisterStrike.cast(h.rogue, h.simulation);
      const cut = k("poised").energy + k("composure.energy")[1];
      assert.equal(
        before - h.rogue.energy,
        Math.max(0, k("sinisterStrike").energy - cut),
      );
    });
  });
});

describe("Venom aura is still not an ability", () => {
  it("keeps the aura id off the ability catalogue", () => {
    assert.equal(AURAS.venom.id, "venom");
    assert.equal(AURAS.poised.id, "poised");
  });
});
