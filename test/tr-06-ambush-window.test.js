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
    // Sword path damage, not only the stored percent (Kira, #350).
    sword.rogue.rng = () => 0;
    const swordDie = sword.rogue.rollWeaponDamageForSkill();
    assert.equal(
      sword.rogue.abilities.ghostlyStrike.damage(),
      swordDie * k("ghostlyStrike").weaponMultiplier.other,
    );
    assert.equal(
      sword.rogue.abilities.hemorrhage.damage(),
      swordDie * k("hemorrhage").weaponMultiplier.other,
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
    // A percent duration with no flat seconds still splits the tooltip total
    // across the longer tick count. Blood Splatter does not change that.
    const percentOnly = createFight(1, daggers, extra);
    percentOnly.rogue.comboPoints = 5;
    percentOnly.rogue.critChance = 0;
    percentOnly.rogue.bonusHitChance = 1;
    percentOnly.simulation.rng = () => 0.99;
    const percentTotal = percentOnly.rogue.abilities.rupture.resolve(5).damage;
    const percentCast = percentOnly.rogue.abilities.rupture.cast(
      percentOnly.rogue,
      percentOnly.simulation,
    );
    assert.equal(percentCast.landed, true);
    const percentDot = percentOnly.simulation.activeDots.rupture;
    const percentTicks = Math.floor((base * 1.5) / k("rupture.tickInterval"));
    assert.equal(percentDot.duration, base * 1.5);
    assert.equal(
      percentDot.tickDamage,
      Math.floor(percentTotal) / percentTicks,
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

describe("TR-06 Blood Splatter full-strength ticks (#335)", () => {
  const interval = () => k("rupture.tickInterval");
  const quiet = {
    character: { critChance: 0, bonusHitChance: 1 },
  };

  function ruptureFight(talents, extraModifiers = []) {
    const build = expandTalents(talents);
    const h = createFight(
      1,
      { ...daggers, ...quiet },
      {
        modifiers: [...build.modifiers, ...extraModifiers],
        procs: build.procs,
        abilities: build.abilities,
      },
    );
    if (h.simulation.hasAura("poised")) {
      h.simulation.consumeCharge("poised");
    }
    h.rogue.energy = h.rogue.maxEnergy;
    h.simulation.gcd = 0;
    h.simulation.rng = () => 0.99;
    return h;
  }

  function castRupture(h, comboPoints) {
    h.rogue.comboPoints = comboPoints;
    h.rogue.energy = h.rogue.maxEnergy;
    h.simulation.gcd = 0;
    const result = h.rogue.abilities.rupture.cast(h.rogue, h.simulation);
    assert.equal(result.landed, true);
    return h.simulation.activeDots.rupture;
  }

  it("keeps the 5 CP tick and adds three ticks, so the total rises", () => {
    assert.equal(CONSTANTS["bloodSplatter.ticks"].source, "wowf-designer");
    assert.match(CONSTANTS["bloodSplatter.ticks"].ref, /23:28/);
    assert.match(CONSTANTS["bloodSplatter.ticks"].ref, /Scout/);
    assert.equal(k("bloodSplatter.ticks"), "full strength");
    const plain = ruptureFight({});
    const baseDot = castRupture(plain, 5);
    const talented = ruptureFight({ "assassination.blood-splatter": 1 });
    const dot = castRupture(talented, 5);
    const baseTicks = Math.floor(k("rupture").durationByCp[4] / interval());
    const added = Math.floor(k("bloodSplatter").rupture / interval());
    assert.equal(baseDot.tickDamage, dot.tickDamage);
    assert.equal(dot.duration, k("rupture").durationByCp[4] + 6);
    assert.equal(Math.floor(dot.duration / interval()), baseTicks + added);
    runOnCore(talented.simulation, dot.duration);
    const ticks = talented.simulation.combatLog.filter(
      (event) => event.name === "Rupture" && event.damage > 0,
    );
    assert.equal(ticks.length, baseTicks + added);
    for (const event of ticks) {
      assert.equal(event.damage, dot.tickDamage);
    }
    assert.equal(
      ticks.reduce((sum, event) => sum + event.damage, 0),
      dot.tickDamage * (baseTicks + added),
    );
  });

  it("a damage modifier scales the tick the same with and without the talent", () => {
    const bonus = {
      kind: "damage",
      op: "add",
      value: 0.3,
      scope: { abilities: ["rupture"] },
      source: "test",
    };
    const plain = ruptureFight({}, [bonus]);
    const talented = ruptureFight({ "assassination.blood-splatter": 1 }, [
      bonus,
    ]);
    const baseDot = castRupture(plain, 5);
    const dot = castRupture(talented, 5);
    assert.equal(dot.tickDamage, baseDot.tickDamage);
    assert.ok(dot.tickDamage > castRupture(ruptureFight({}), 5).tickDamage);
  });

  it("a refresh uses the new combo points at full tick strength", () => {
    const h = ruptureFight({ "assassination.blood-splatter": 1 });
    castRupture(h, 5);
    const dot = castRupture(h, 3);
    const alone = ruptureFight({});
    const baseDot = castRupture(alone, 3);
    assert.equal(dot.tickDamage, baseDot.tickDamage);
    assert.equal(dot.duration, k("rupture").durationByCp[2] + 6);
  });

  it("a fight that ends early keeps full ticks and drops the ones that do not fit", () => {
    const h = ruptureFight({ "assassination.blood-splatter": 1 });
    const dot = castRupture(h, 5);
    const plain = castRupture(ruptureFight({}), 5);
    runOnCore(h.simulation, 10);
    const ticks = h.simulation.combatLog.filter(
      (event) => event.name === "Rupture" && event.damage > 0,
    );
    assert.ok(ticks.length > 0);
    assert.ok(ticks.length < Math.floor(dot.duration / interval()));
    assert.equal(dot.tickDamage, plain.tickDamage);
    for (const event of ticks) {
      assert.equal(event.damage, plain.tickDamage);
    }
  });

  it("percent duration still lengthens first; the flat seconds stay full ticks", () => {
    const percent = {
      kind: "duration",
      op: "add",
      value: 0.5,
      scope: { abilities: ["rupture"] },
      source: "test",
    };
    const h = ruptureFight({ "assassination.blood-splatter": 1 }, [percent]);
    const dot = castRupture(h, 5);
    const base = k("rupture").durationByCp[4];
    const split = base * 1.5;
    assert.equal(dot.duration, split + 6);
    const expected =
      Math.floor(h.rogue.abilities.rupture.resolve(5).damage) /
      Math.floor(split / interval());
    assert.equal(dot.tickDamage, expected);
    withConstant("bloodSplatter.apply", "before percent", () => {
      const before = ruptureFight({ "assassination.blood-splatter": 1 }, [
        percent,
      ]);
      const stretched = castRupture(before, 5);
      assert.equal(stretched.duration, (base + 6) * 1.5);
      assert.equal(stretched.tickDamage, expected);
    });
  });

  it("any other bloodSplatter.ticks value keeps the fixed-total split", () => {
    withConstant("bloodSplatter.ticks", "spread", () => {
      const h = ruptureFight({ "assassination.blood-splatter": 1 });
      const dot = castRupture(h, 5);
      const total = Math.floor(h.rogue.abilities.rupture.resolve(5).damage);
      const ticks = Math.floor(dot.duration / interval());
      assert.equal(dot.tickDamage, total / ticks);
      assert.ok(dot.tickDamage < total / Math.floor(16 / interval()));
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
