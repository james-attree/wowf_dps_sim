import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { abilityCatalogue } from "../js/abilities.js";
import { createFight } from "../js/fight.js";
import { castableAbilities } from "../js/rotation-edit.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { expandTalents } from "../js/talent-build.js";
import {
  COMBAT_SWORDS_SHANK_RULE,
  ROTATION_PRESETS,
} from "../data/rotation-presets.js";
import { loadPreset } from "../js/rotation-presets.js";
import { validateRotation } from "../js/rotation-validator.js";
import { rotationContext } from "../js/rotation-validator.js";
import { compileRotation, decide } from "../js/rotation-interpreter.js";
import { rotationHost } from "../js/rotation-host.js";
import { runFight } from "../js/fight.js";

// TR-04 / #337: Shank, Flash of Steel, Boot Knife.

const swords = {
  weapons: {
    mainHand: { type: "sword" },
    offHand: { type: "sword" },
  },
};

function ready(config = {}, options = {}) {
  const fight = createFight(5, { ...swords, ...config }, options);
  fight.rogue.energy = fight.rogue.maxEnergy;
  fight.rogue.comboPoints = 0;
  fight.simulation.gcd = 0;
  return fight;
}

describe("Shank is a live castable off-hand ability (#337)", () => {
  it("is in ABILITY_DEFINITIONS and the castable list", () => {
    const definition = ABILITY_DEFINITIONS.find((d) => d.id === "shank");
    assert.ok(definition);
    assert.equal(definition.hand, "offHand");
    assert.equal(definition.cannotMiss, true);
    assert.ok(castableAbilities().includes("shank"));
    assert.equal(abilityCatalogue.get("shank").name, "Shank");
  });

  it("costs 5 energy, deals 50% off-hand weapon damage, generates 25 energy, 10 s CD", () => {
    assert.equal(k("shank").weaponMultiplier, 0.5);
    const { rogue, simulation } = ready();
    // Poised may be up from a full bar (TR-05). This cast measures Shank.
    if (simulation.hasAura("poised")) {
      simulation.consumeCharge("poised");
    }
    // Start below the cap so generated energy is visible.
    rogue.energy = 50;
    let result = null;
    for (let i = 0; i < 30 && !(result && result.landed); i += 1) {
      rogue.energy = 50;
      simulation.gcd = 0;
      simulation.cooldowns.shank = 0;
      result = rogue.abilities.shank.cast(rogue, simulation);
    }
    assert.ok(result?.landed, "expected a landed Shank");
    assert.notEqual(result.outcome, "miss", "Shank cannot miss");
    assert.equal(simulation.abilityStats.shank.casts > 0, true);
    assert.equal(simulation.cooldowns.shank, k("shank").cooldown);
    assert.equal(
      rogue.energy,
      50 - k("shank").energy + k("shank").energyGenerated,
    );
    assert.equal(
      rogue.comboPoints,
      0,
      "Shank awards no combo points by itself",
    );
  });

  it("never rolls miss across many casts", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const fight = createFight(seed, swords);
      fight.rogue.energy = fight.rogue.maxEnergy;
      fight.simulation.gcd = 0;
      // Force the table roll into the miss band if miss were possible.
      const result = fight.rogue.abilities.shank.cast(
        fight.rogue,
        fight.simulation,
      );
      assert.ok(result);
      assert.notEqual(result.outcome, "miss", `seed ${seed}`);
    }
  });

  it("strikes with the off hand (poison and damage use OH)", () => {
    const { rogue, simulation } = ready({
      poisons: { mainHand: null, offHand: "instant" },
    });
    assert.equal(rogue.abilities.shank.hand, "offHand");
    // Fill energy repeatedly and cast until a hit lands.
    let landed = null;
    for (let i = 0; i < 20 && !landed; i += 1) {
      rogue.energy = rogue.maxEnergy;
      simulation.gcd = 0;
      simulation.cooldowns.shank = 0;
      const result = rogue.abilities.shank.cast(rogue, simulation);
      if (result?.landed) landed = result;
    }
    assert.ok(landed);
    const events = simulation.combatLog.filter((e) => e.name === "Shank");
    assert.ok(events.length >= 1);
  });

  it("does not trigger Seal Fate on a crit", () => {
    // High crit; cast many Shanks and assert no seal-fate CP gain.
    let sealFateGains = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const build = expandTalents({ "assassination.seal-fate": 3 });
      const fight = createFight(
        seed,
        { ...swords, character: { critChance: 1 } },
        { modifiers: build.modifiers, procs: build.procs },
      );
      fight.rogue.energy = fight.rogue.maxEnergy;
      fight.simulation.gcd = 0;
      const before = fight.rogue.comboPoints;
      const result = fight.rogue.abilities.shank.cast(
        fight.rogue,
        fight.simulation,
      );
      if (result?.outcome === "crit") {
        const gained = fight.rogue.comboPoints - before;
        // Boot Knife is not talented; Shank itself gives 0 CP.
        assert.equal(gained, 0, `seed ${seed} crit gave CP`);
      }
      const stats = fight.simulation.procs?.stats?.["seal-fate"];
      if (stats) sealFateGains += stats.procs ?? 0;
    }
    assert.equal(sealFateGains, 0);
  });
});

describe("shank.appliesOffHandPoison (Kira B1 / M7)", () => {
  function withConstant(id, value, run) {
    const original = CONSTANTS[id].value;
    CONSTANTS[id].value = value;
    try {
      return run();
    } finally {
      CONSTANTS[id].value = original;
    }
  }

  function instantPoisonCasts(applies) {
    return withConstant("shank.appliesOffHandPoison", applies, () => {
      let poisonCasts = 0;
      let shankHits = 0;
      for (let seed = 1; seed <= 80; seed += 1) {
        const fight = createFight(seed, {
          ...swords,
          poisons: { mainHand: null, offHand: "instant" },
        });
        fight.rogue.energy = fight.rogue.maxEnergy;
        fight.simulation.gcd = 0;
        const result = fight.rogue.abilities.shank.cast(
          fight.rogue,
          fight.simulation,
        );
        if (result?.landed) {
          shankHits += 1;
          poisonCasts +=
            fight.simulation.abilityStats["instant-poison"]?.casts ?? 0;
        }
      }
      return { poisonCasts, shankHits };
    });
  }

  it("default true: a landed Shank can apply off-hand Instant Poison", () => {
    assert.equal(k("shank.appliesOffHandPoison"), true);
    const { poisonCasts, shankHits } = instantPoisonCasts(true);
    assert.ok(shankHits > 20, `hits ${shankHits}`);
    assert.ok(
      poisonCasts > 0,
      `expected Instant Poison on Shank hits (casts ${poisonCasts})`,
    );
  });

  it("false: a landed Shank never applies off-hand Instant Poison (kills M7)", () => {
    const { poisonCasts, shankHits } = instantPoisonCasts(false);
    assert.ok(shankHits > 20, `hits ${shankHits}`);
    assert.equal(
      poisonCasts,
      0,
      `Shank must not apply OH poison when shank.appliesOffHandPoison is false (got ${poisonCasts})`,
    );
  });
});

describe("Flash of Steel (#337)", () => {
  it("is mapped: +3 energy and −0.4 s Shank cooldown per rank", () => {
    const entry = TALENT_EFFECTS["combat.flash-of-steel"];
    assert.equal(entry.pending, undefined);
    assert.deepEqual(
      entry.modifiers.map((m) => m.kind),
      ["castGain", "cooldown"],
    );
    assert.deepEqual(entry.modifiers[0].values, [3, 6, 9, 12, 15]);
    assert.deepEqual(entry.modifiers[1].values, [-0.4, -0.8, -1.2, -1.6, -2.0]);
    for (const mod of entry.modifiers) {
      assert.deepEqual(mod.scope, { abilities: ["shank"] });
    }
  });

  it("at rank 5: Shank generates 40 energy and cools for 8 s", () => {
    const build = expandTalents({ "combat.flash-of-steel": 5 });
    const { rogue, simulation } = ready(
      {},
      { modifiers: build.modifiers, procs: build.procs },
    );
    if (simulation.hasAura("poised")) {
      simulation.consumeCharge("poised");
    }
    // Start below the cap so the +40 generated energy is visible.
    const before = 50;
    let landed = false;
    for (let i = 0; i < 30 && !landed; i += 1) {
      rogue.energy = before;
      simulation.gcd = 0;
      simulation.cooldowns.shank = 0;
      const result = rogue.abilities.shank.cast(rogue, simulation);
      if (result?.landed) {
        landed = true;
        assert.equal(
          rogue.energy,
          before - k("shank").energy + k("shank").energyGenerated + 15,
        );
        assert.equal(simulation.cooldowns.shank, 8);
      }
    }
    assert.ok(landed);
  });
});

describe("Boot Knife (#337)", () => {
  it("is mapped: 20–100% chance for Shank to award +2 CP", () => {
    const entry = TALENT_EFFECTS["subtlety.boot-knife"];
    assert.equal(entry.pending, undefined);
    const [proc] = entry.procs;
    assert.equal(proc.id, "boot-knife");
    assert.deepEqual(proc.chance.values, [0.2, 0.4, 0.6, 0.8, 1]);
    assert.deepEqual(proc.scope, { abilities: ["shank"] });
    assert.deepEqual(proc.actions, [
      {
        type: "gainResource",
        resource: "comboPoints",
        amount: k("bootKnife.comboPoint").comboPoints,
      },
    ]);
  });

  it("at rank 5 always awards +2 CP on a landed Shank", () => {
    const build = expandTalents({ "subtlety.boot-knife": 5 });
    let hits = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const fight = createFight(seed, swords, {
        modifiers: build.modifiers,
        procs: build.procs,
      });
      fight.rogue.energy = fight.rogue.maxEnergy;
      fight.rogue.comboPoints = 0;
      fight.simulation.gcd = 0;
      const result = fight.rogue.abilities.shank.cast(
        fight.rogue,
        fight.simulation,
      );
      if (result?.landed) {
        hits += 1;
        assert.equal(fight.rogue.comboPoints, 2, `seed ${seed}`);
      }
    }
    assert.ok(hits > 0);
  });
});

describe("Combat swords temp rotation casts Shank when energy < 50 (#337)", () => {
  it("the live preset includes the Shank rule", () => {
    const [preset] = ROTATION_PRESETS;
    assert.equal(preset.id, "combat-swords-temp");
    assert.deepEqual(COMBAT_SWORDS_SHANK_RULE, {
      action: "shank",
      conditions: [
        { type: "cooldownReady", ability: "shank" },
        { type: "resource", resource: "energy", op: "<", value: 50 },
      ],
    });
    assert.ok(
      preset.rotation.rules.some((r) => r.action === "shank"),
      "Shank rule is live",
    );
    assert.deepEqual(
      preset.rotation.rules.find((r) => r.action === "shank"),
      COMBAT_SWORDS_SHANK_RULE,
    );
  });

  it("the validator accepts the preset rotation with Shank", () => {
    const [preset] = ROTATION_PRESETS;
    const errors = validateRotation(preset.rotation, rotationContext());
    assert.deepEqual(errors, []);
  });

  it("the host casts Shank when energy is below 50 and the cooldown is ready", () => {
    const config = loadPreset("combat-swords-temp");
    const fight = createFight(1, config);
    const host = rotationHost(fight.rogue, fight.simulation);
    const compiled = compileRotation(config.rotation);
    // Drain energy below 50, clear GCD and Shank CD.
    fight.rogue.energy = 40;
    fight.simulation.gcd = 0;
    fight.simulation.cooldowns.shank = 0;
    // Ensure SnD is up so we don't prefer a finisher path that blocks us;
    // with 0 CP the walk reaches Shank / SS.
    fight.rogue.comboPoints = 0;
    const action = decide(compiled, host);
    assert.deepEqual(action.casts, ["shank"]);
  });

  it("a 60 s preset fight records Shank casts", () => {
    const config = loadPreset("combat-swords-temp");
    const result = runFight({ config, seed: 142, duration: 60 });
    const shank = Object.entries(result.abilities).find(([name]) =>
      /shank/i.test(name),
    );
    assert.ok(shank, `abilities: ${Object.keys(result.abilities).join(",")}`);
    assert.ok(shank[1].casts > 0);
  });
});
