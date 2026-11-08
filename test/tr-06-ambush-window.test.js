// TR-06 / #335: Ghostly Strike opens a 7 s Ambush window, Hemorrhage raises
// Rupture only, Blood Splatter adds 6 s to Rupture, and Mutilate's flats are
// the 70755 ranks 36/51/71.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { AURAS } from "../js/auras.js";
import { createFight } from "../js/fight.js";
import { rankedStats } from "../js/ranks.js";
import { expandTalents } from "../js/talent-build.js";
import { runOnCore } from "../js/core/fight.js";

const daggers = {
  weapons: {
    mainHand: { type: "dagger", min: 40, max: 40, speed: 1.8 },
    offHand: { type: "dagger", min: 40, max: 40, speed: 1.8 },
  },
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

function fight(talents, config = daggers) {
  const build = expandTalents(talents);
  const built = createFight(1, config, {
    modifiers: build.modifiers,
    procs: build.procs,
    abilities: build.abilities,
  });
  if (built.simulation.hasAura("poised")) {
    built.simulation.consumeCharge("poised");
  }
  built.rogue.energy = built.rogue.maxEnergy;
  built.simulation.gcd = 0;
  return built;
}

function land(h, key) {
  const { rogue, simulation } = h;
  for (let i = 0; i < 30; i += 1) {
    rogue.energy = rogue.maxEnergy;
    simulation.gcd = 0;
    simulation.cooldowns[rogue.abilities[key].id] = 0;
    const result = rogue.abilities[key].cast(rogue, simulation);
    if (result?.landed) {
      return result;
    }
  }
  assert.fail(`expected a landed ${key}`);
}

describe("TR-06 Ghostly Strike ambush window (#335)", () => {
  it("tags the dagger percents as assumptions James accepted", () => {
    for (const id of [
      "ghostlyStrike.daggerMultiplier",
      "hemorrhage.daggerMultiplier",
    ]) {
      assert.equal(CONSTANTS[id].source, "assumption");
      assert.equal(CONSTANTS[id].retune, true);
      assert.match(CONSTANTS[id].ref, /James, 8 Nov 2026, issue #335/);
      assert.match(CONSTANTS[id].ref, /Tagged assumption/);
    }
    assert.equal(k("ghostlyStrike.daggerMultiplier"), 1.8);
    assert.equal(k("hemorrhage.daggerMultiplier"), 1.45);
    assert.equal(k("ghostlyStrike").weaponMultiplier.other, 1.25);
    assert.equal(k("hemorrhage").weaponMultiplier.other, 1);
  });

  it("uses the assumption row for a dagger, and the export percent otherwise", () => {
    const sword = fight(
      {},
      {
        weapons: {
          mainHand: { type: "sword", min: 100, max: 100, speed: 2.6 },
          offHand: { type: "sword", min: 50, max: 50, speed: 2.6 },
        },
      },
    );
    assert.equal(
      sword.rogue.abilities.ghostlyStrike.stats.weaponMultiplier.dagger,
      k("ghostlyStrike.daggerMultiplier"),
    );
    assert.equal(
      sword.rogue.abilities.ghostlyStrike.stats.weaponMultiplier.other,
      1.25,
    );
    const dagger = fight({});
    dagger.rogue.rng = () => 0;
    const die = dagger.rogue.rollWeaponDamageForSkill();
    assert.equal(
      dagger.rogue.abilities.ghostlyStrike.damage(),
      die * k("ghostlyStrike.daggerMultiplier"),
    );
    assert.equal(
      dagger.rogue.abilities.hemorrhage.damage(),
      die * k("hemorrhage.daggerMultiplier"),
    );
  });

  it("a landed Ghostly Strike opens a 7 s one-charge window; a miss does not", () => {
    const h = fight({ "subtlety.ghostly-strike": 1 });
    assert.ok(h.rogue.grantedAuras.has("ambush-window"));
    h.simulation.rng = () => 0;
    h.rogue.abilities.ghostlyStrike.cast(h.rogue, h.simulation);
    assert.equal(h.simulation.hasAura("ambush-window"), false);
    h.simulation.rng = () => 0.99;
    h.rogue.energy = h.rogue.maxEnergy;
    h.simulation.gcd = 0;
    h.simulation.cooldowns["ghostly-strike"] = 0;
    const landed = h.rogue.abilities.ghostlyStrike.cast(h.rogue, h.simulation);
    assert.equal(landed.landed, true);
    assert.equal(
      h.simulation.activeBuffs["ambush-window"].duration,
      k("ghostlyStrike.ambushWindow"),
    );
    assert.equal(h.simulation.activeBuffs["ambush-window"].charges, 1);
    assert.equal(h.simulation.hasAura("ghostly-strike"), true);
  });

  it("Ambush uses the charge; a second Ambush is refused; the dodge buff stays", () => {
    const h = fight({ "subtlety.ghostly-strike": 1 });
    h.simulation.rng = () => 0.99;
    land(h, "ghostlyStrike");
    h.rogue.energy = h.rogue.maxEnergy;
    h.simulation.gcd = 0;
    assert.ok(h.rogue.abilities.ambush.cast(h.rogue, h.simulation));
    assert.equal(h.simulation.hasAura("ambush-window"), false);
    assert.equal(h.simulation.hasAura("ghostly-strike"), true);
    h.rogue.energy = h.rogue.maxEnergy;
    h.simulation.gcd = 0;
    assert.equal(h.rogue.abilities.ambush.cast(h.rogue, h.simulation), null);
  });

  it("reads the window length when the fight is built", () => {
    withConstant("ghostlyStrike.ambushWindow", 3, () => {
      const h = fight({ "subtlety.ghostly-strike": 1 });
      h.simulation.rng = () => 0.99;
      land(h, "ghostlyStrike");
      assert.equal(h.simulation.activeBuffs["ambush-window"].duration, 3);
    });
  });

  it("the window expires at its length when Ambush is not cast", () => {
    const h = fight({ "subtlety.ghostly-strike": 1 });
    h.simulation.rng = () => 0.99;
    land(h, "ghostlyStrike");
    runOnCore(h.simulation, k("ghostlyStrike.ambushWindow"));
    assert.equal(h.simulation.hasAura("ambush-window"), false);
  });
});

describe("TR-06 Hemorrhage and Blood Splatter (#335)", () => {
  it("Hemorrhage raises Rupture only; Garrote is not an ability", () => {
    assert.deepEqual(AURAS.hemorrhage.effects.dotDamageTaken.ids, ["rupture"]);
    assert.equal(
      AURAS.hemorrhage.effects.dotDamageTaken.bonus,
      k("hemorrhage.ruptureBonus").bonus,
    );
    assert.equal(
      ABILITY_DEFINITIONS.some((definition) => definition.id === "garrote"),
      false,
    );
    assert.equal(TALENT_EFFECTS["subtlety.hemorrhage"].pending, undefined);
    assert.equal(TALENT_EFFECTS["subtlety.ghostly-strike"].pending, undefined);
    assert.equal(
      TALENT_EFFECTS["assassination.blood-splatter"].pending,
      undefined,
    );
  });

  it("adds 6 s to Rupture and records 9 s of Garrote without applying it", () => {
    assert.equal(CONSTANTS.bloodSplatter.source, "wowf-export");
    assert.deepEqual(k("bloodSplatter"), { rupture: 6, garrote: 9 });
    assert.equal(CONSTANTS["bloodSplatter.apply"].source, "assumption");
    assert.match(CONSTANTS["bloodSplatter.apply"].ref, /Team assumption/);
    assert.match(CONSTANTS["bloodSplatter.apply"].ref, /Not a ruling by James/);
    const plain = fight({});
    plain.rogue.comboPoints = 5;
    assert.equal(
      plain.rogue.abilities.rupture.resolve().duration,
      k("rupture").durationByCp[4],
    );
    const splatter = fight({ "assassination.blood-splatter": 1 });
    splatter.rogue.comboPoints = 5;
    assert.equal(
      splatter.rogue.abilities.rupture.resolve().duration,
      k("rupture").durationByCp[4] + k("bloodSplatter").rupture,
    );
    assert.equal(
      expandTalents({ "assassination.blood-splatter": 1 }).modifiers[0].kind,
      "flatDuration",
    );
  });

  it("adds the seconds after a percent duration modifier, unless configured otherwise", () => {
    const extra = {
      modifiers: [
        {
          kind: "duration",
          op: "add",
          value: 0.5,
          scope: { abilities: ["rupture"] },
          source: "test",
        },
      ],
    };
    const base = k("rupture").durationByCp[4];
    const splatter = expandTalents({ "assassination.blood-splatter": 1 });
    const after = createFight(1, daggers, {
      modifiers: [...splatter.modifiers, ...extra.modifiers],
      abilities: splatter.abilities,
    });
    after.rogue.comboPoints = 5;
    assert.equal(
      after.rogue.abilities.rupture.resolve().duration,
      base * 1.5 + 6,
    );
    withConstant("bloodSplatter.apply", "before percent", () => {
      const before = createFight(1, daggers, {
        modifiers: [...splatter.modifiers, ...extra.modifiers],
        abilities: splatter.abilities,
      });
      before.rogue.comboPoints = 5;
      assert.equal(
        before.rogue.abilities.rupture.resolve().duration,
        (base + 6) * 1.5,
      );
    });
  });
});

describe("TR-06 Mutilate ranks (#335)", () => {
  it("uses the export flats 36/51/71, not an assumption", () => {
    assert.equal(CONSTANTS["mutilate.bonusByRank"].source, "wowf-export");
    assert.deepEqual([...k("mutilate.bonusByRank")], [36, 51, 71]);
    assert.equal(k("mutilate").bonusDamage, 71);
    assert.equal(k("mutilate").weaponMultiplier, 0.9);
    assert.equal(k("mutilate").poisonedMultiplier, 1.2);
    assert.equal(rankedStats("mutilate", 40).bonusDamage, 36);
    assert.equal(rankedStats("mutilate", 50).bonusDamage, 51);
    assert.equal(rankedStats("mutilate", 60).bonusDamage, 71);
    assert.equal(CONSTANTS.mutilate.source, "wowf-export");
  });
});
