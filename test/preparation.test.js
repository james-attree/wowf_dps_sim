import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "../js/abilities.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { Ability } from "../js/ability.js";
import { runOnCore } from "../js/core/fight.js";
import { createFight, runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { abilityGroups } from "../js/rotation-builder-copy.js";
import { castableAbilities } from "../js/rotation-edit.js";
import { validateRotation } from "../js/rotation-validator.js";
import { defaultDaggerConfig, normalizeConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";
import { applyBuild, talentGrantedAbilities } from "../js/talent-build.js";
import {
  GOLDEN_CASES,
  PREPARATION_ROTATION,
  SUBTLETY_BUILD,
} from "../scripts/golden-update.mjs";
import { quiet } from "./quiet.js";

// Issue #270 (P4.6-05b): Preparation, a castable talent ability with a
// 10 min cooldown that finishes the cooldowns of Cold Blood, Premeditation,
// Ghostly Strike, Adrenaline Rush and Blade Flurry (A15), and not its own or
// any racial's. One test per reset, then gates G2 and G4.

const PREPARATION = "subtlety.preparation";
const RESETS = [
  ["cold-blood", "coldBlood"],
  ["premeditation", "premeditation"],
  ["ghostly-strike", "ghostlyStrike"],
  ["adrenaline-rush", "adrenalineRush"],
  ["blade-flurry", "bladeFlurry"],
];
// Racial cooldown ids: the engine models no racial, so none is a real
// ability; a cooldown under any of these names must be left alone.
const RACIALS = ["berserking", "blood-fury", "will-of-the-forsaken"];
const RACIAL_LEFT = 90;
// A draw this high lands a yellow strike (Ghostly Strike) with no crit.
const HIT = 0.99;
const PREPARATION_CASE = GOLDEN_CASES.find(
  ({ name }) => name === "preparation-subtlety-seed-270-60s",
);

function harness({ talents = SUBTLETY_BUILD } = {}) {
  const draws = [];
  const rogue = new Rogue({ ...defaultDaggerConfig(), talents });
  quiet(rogue);
  const simulation = new Simulation(rogue, {
    rng() {
      draws.push(true);
      return HIT;
    },
  });
  return { rogue, simulation, draws };
}

function cast(h, key) {
  h.rogue.energy = h.rogue.maxEnergy;
  h.simulation.gcd = 0;
  return h.rogue.abilities[key].cast(h.rogue, h.simulation);
}

describe("Preparation as data (#270)", () => {
  it("is a talent-granted ability: no cost, on the GCD, 10 min cooldown", () => {
    const entry = ABILITY_DEFINITIONS.find(({ id }) => id === "preparation");
    assert.ok(entry);
    assert.equal(entry.key, "preparation");
    assert.equal(entry.cost, undefined);
    assert.equal(entry.damage, undefined);
    assert.equal(TALENT_EFFECTS[PREPARATION].ability, "preparation");
    assert.ok(talentGrantedAbilities.has("preparation"));
    const spell = abilityCatalogue.get("preparation");
    assert.equal(spell.cost, null);
    assert.equal(spell.cooldown, k("preparation").cooldown);
    assert.equal(k("preparation").cooldown, 600);
    const { rogue } = harness();
    assert.equal(rogue.abilities.preparation.cost, 0);
    assert.equal(rogue.abilities.preparation.triggersGcd, true);
    assert.equal(rogue.abilities.preparation.cooldown, 600);
  });

  it("A15: the reset list is the five abilities, an assumption", () => {
    assert.deepEqual(
      k("preparation.resets"),
      RESETS.map(([id]) => id),
    );
    assert.equal(CONSTANTS["preparation.resets"].source, "assumption");
    for (const id of k("preparation.resets")) {
      assert.ok(
        ABILITY_DEFINITIONS.some((definition) => definition.id === id),
        id,
      );
    }
  });

  it("needs the talent: granted with it, locked without", () => {
    assert.equal(harness().rogue.granted.has("preparation"), true);
    const bare = new Rogue();
    assert.equal(bare.lockedByBuild(bare.abilities.preparation), true);
  });
});

describe("A15: Preparation finishes each listed cooldown", () => {
  for (const [id, key] of RESETS) {
    it(`finishes the cooldown of ${id}`, () => {
      const h = harness();
      const ability = h.rogue.abilities[key];
      cast(h, key);
      assert.equal(
        h.simulation.cooldowns[id],
        k(ability.definition.row).cooldown,
        id,
      );
      h.simulation.gcd = 0;
      assert.equal(ability.canCast(h.rogue, h.simulation), false);
      cast(h, "preparation");
      assert.equal(h.simulation.cooldowns[id] > 0, false);
      h.rogue.energy = h.rogue.maxEnergy;
      h.simulation.gcd = 0;
      assert.equal(ability.canCast(h.rogue, h.simulation), true);
    });
  }

  it("finishes all five at once, and only cooldowns that are running", () => {
    const h = harness();
    for (const [, key] of RESETS) {
      cast(h, key);
    }
    cast(h, "preparation");
    for (const [id] of RESETS) {
      assert.equal(h.simulation.cooldowns[id] > 0, false, id);
    }
  });
});

describe("A15: what Preparation does not reset", () => {
  it("not itself: its own 10 min cooldown starts and holds", () => {
    const h = harness();
    cast(h, "preparation");
    assert.equal(h.simulation.cooldowns.preparation, 600);
    assert.equal(cast(h, "preparation"), null);
    assert.equal(h.simulation.cooldowns.preparation, 600);
    assert.ok(!k("preparation.resets").includes("preparation"));
  });

  it("no racial: a racial cooldown is left as it is", () => {
    const h = harness();
    for (const id of RACIALS) {
      h.simulation.cooldowns[id] = RACIAL_LEFT;
    }
    cast(h, "preparation");
    for (const id of RACIALS) {
      assert.equal(h.simulation.cooldowns[id], RACIAL_LEFT, id);
      assert.ok(!k("preparation.resets").includes(id), id);
    }
  });

  it("a reset list that holds the ability's own id is refused", () => {
    // abilities.offGcd lists cold-blood, so Cold Blood cannot take it.
    const coldBlood = ABILITY_DEFINITIONS.find(({ id }) => id === "cold-blood");
    assert.throws(
      () =>
        new Ability({ ...coldBlood, resets: "abilities.offGcd" }, new Rogue()),
      /cold-blood.*own cooldown/,
    );
  });

  it("no other rogue cooldown outside the list", () => {
    const h = harness();
    h.simulation.cooldowns.hemorrhage = RACIAL_LEFT;
    cast(h, "preparation");
    assert.equal(h.simulation.cooldowns.hemorrhage, RACIAL_LEFT);
  });
});

describe("Preparation in a fight on the event core", () => {
  it("a second Ghostly Strike follows Preparation at once", () => {
    const result = runFight({
      seed: 270,
      duration: 10,
      config: PREPARATION_CASE.config,
    });
    assert.equal(result.abilities.Preparation.casts, 1);
    // Ghostly Strike's 20 s cooldown allows one cast in 10 s; Preparation
    // finishes it, so a second follows.
    assert.ok(result.abilities["Ghostly Strike"].casts >= 2);
  });

  it("is cast once in the 60 s golden fight", () => {
    const { seed, duration, config } = PREPARATION_CASE;
    const result = runFight({ seed, duration, config });
    assert.equal(result.abilities.Preparation.casts, 1);
  });
});

describe("Preparation in the builder palette and validator", () => {
  it("is castable and sits with the cooldowns, as a talent", () => {
    assert.ok(castableAbilities().includes("preparation"));
    const cooldowns = abilityGroups(castableAbilities()).find(
      ({ label }) => label === "Cooldowns",
    );
    assert.ok(
      cooldowns.options.some(
        ({ value, text }) =>
          value === "preparation" && text === "Preparation (talent)",
      ),
    );
  });

  it("a rule for it needs its talent guard", () => {
    const rule = (conditions) => ({
      schemaVersion: 1,
      name: "Preparation",
      rules: [{ action: "preparation", conditions }],
    });
    assert.deepEqual(
      validateRotation(
        rule([{ type: "abilityGranted", ability: "preparation" }]),
      ),
      [],
    );
    assert.deepEqual(
      validateRotation(rule([])).map(({ code }) => code),
      ["talentGuard"],
    );
    assert.deepEqual(validateRotation(PREPARATION_ROTATION), []);
  });
});

describe("G2 and G4 (#270)", () => {
  it("Preparation draws nothing", () => {
    const h = harness();
    cast(h, "ghostlyStrike");
    const before = h.draws.length;
    cast(h, "preparation");
    assert.equal(h.draws.length, before);
  });

  it("an old config without Preparation reads as 0 points and no ability", () => {
    const config = normalizeConfig({ talents: { "assassination.malice": 5 } });
    assert.equal(config.talents[PREPARATION] ?? 0, 0);
    const rogue = new Rogue(config);
    assert.equal(rogue.granted.has("preparation"), false);
    assert.equal(rogue.lockedByBuild(rogue.abilities.preparation), true);
  });

  it("an old config with the point now grants it and is no longer unmapped", () => {
    const build = applyBuild({ ...SUBTLETY_BUILD });
    assert.ok(!build.unmapped.includes(PREPARATION));
    assert.ok(build.abilities.includes("preparation"));
  });
});

describe("Preparation: a fight cut in pieces (#198)", () => {
  // The Preparation fixture's fight has Rupture and Hemorrhage end at the
  // same time, 32 s on seed 1. Cut at 20 s, the second run set their ends in
  // the target aura map's order, so Hemorrhage ran out first; one run runs
  // them in the order they were scheduled. The core now restores the timers
  // that go on in their seq order (restore() in js/core/fight.js).
  it("runs two ends at the same time in the same order across a cut", () => {
    const config = {
      ...defaultDaggerConfig(),
      talents: { ...SUBTLETY_BUILD },
      rotation: structuredClone(PREPARATION_ROTATION),
    };
    const logged = (cuts) => {
      const fight = createFight(1, structuredClone(config), { duration: 60 });
      const log = [];
      fight.simulation.on("*", (event) => {
        if (event.type !== "end") {
          log.push(JSON.stringify(event));
        }
      });
      for (const cut of cuts) {
        runOnCore(fight.simulation, cut - fight.simulation.currentTime);
      }
      return log;
    };
    const one = logged([60]);
    const expiries = one
      .map((line) => JSON.parse(line))
      .filter(
        (e) => e.type === "aura" && e.change === "expire" && e.time === 32,
      )
      .map((e) => e.aura);
    assert.deepEqual(expiries, ["rupture", "hemorrhage"]);
    assert.deepEqual(logged([20, 60]), one);
    assert.deepEqual(logged([30, 60]), one);
  });
});
