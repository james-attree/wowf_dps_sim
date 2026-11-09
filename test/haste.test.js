import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { AURAS } from "../js/auras.js";
import { SwingTimer } from "../js/core/swing.js";
import { runOnCore } from "../js/core/fight.js";
import { createFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";

// Issue #265 (P4.6-02): character.haste, attack speed only, default 0.

const HALF = 0.5;

function withHaste(haste) {
  return { character: { haste } };
}

function interval(rogue, hand = "mainHand") {
  const timer = new SwingTimer({
    weapon: rogue.weapons[hand],
    modifiers: rogue.modifiers,
    scheduler: { schedule() {}, now: 0 },
  });
  return timer.interval;
}

// The events of a fight that haste must not move: casts (and so the GCD) and
// every energy change. White and yellow rolls share one rng, so under a seed
// extra swings would shift the yellow rolls; a constant roll isolates timing.
function timeline(haste, seconds = 60) {
  const simulation = new Simulation(new Rogue(withHaste(haste)), {
    rng: () => HALF,
    fightLength: seconds,
  });
  const fight = { simulation };
  const seen = [];
  fight.simulation.events.on("cast", ({ time, ability }) =>
    seen.push(["cast", time, ability]),
  );
  fight.simulation.events.on("resource", (event) => {
    if (event.resource === "energy") {
      seen.push(["energy", event.time, JSON.stringify(event)]);
    }
  });
  runOnCore(fight.simulation, seconds);
  return seen;
}

describe("character.haste (#265)", () => {
  it("is a constant, 0 by default, tagged assumption with James's ruling", () => {
    const row = CONSTANTS["character.haste"];
    assert.equal(row.value, 0);
    assert.equal(row.source, "assumption");
    assert.match(
      row.ref,
      /^James, 31 Oct 2026, issue #265: like Classic, attack speed only/,
    );
    assert.equal(defaultConfig().character.haste, 0);
  });

  it("accepts 0, 0.05 and 1; rejects -0.01 and 1.01", () => {
    for (const haste of [0, 0.05, 1]) {
      assert.equal(normalizeConfig(withHaste(haste)).character.haste, haste);
    }
    for (const haste of [-0.01, 1.01]) {
      assert.throws(
        () => normalizeConfig(withHaste(haste)),
        RangeError,
        String(haste),
      );
    }
  });

  it("an old config without haste reads 0 (G4)", () => {
    const config = normalizeConfig({
      character: { attackPower: 1000, critChance: 0.2, bonusHitChance: 0.05 },
    });
    assert.equal(config.character.haste, 0);
    assert.equal(normalizeConfig({}).character.haste, 0);
    assert.equal(new Rogue({ character: {} }).config.character.haste, 0);
  });

  it("haste 0 adds no modifier; haste above 0 adds one static haste modifier", () => {
    const none = new Rogue();
    assert.deepEqual(none.modifiers.contributions("haste"), []);
    assert.equal(none.modifiers.modifiers.length, 0);
    const some = new Rogue(withHaste(0.1));
    const found = some.modifiers.contributions("haste");
    assert.equal(found.length, 1);
    assert.equal(found[0].modifier.value, 0.1);
    assert.equal(found[0].modifier.source, "character.haste");
  });

  it("swing interval = speed / ((1 + h) · SnD · BF) exactly (A17)", () => {
    const h = 0.25;
    const rogue = new Rogue(withHaste(h));
    const simulation = new Simulation(rogue, { seed: 1 });
    const speed = rogue.weapons.mainHand.speed;
    assert.equal(interval(rogue), speed / (1 + h));
    assert.equal(
      interval(rogue, "offHand"),
      rogue.weapons.offHand.speed / (1 + h),
    );
    simulation.applyAura(AURAS.sliceAndDice, { duration: 10 });
    const snd = 1 + k("sliceAndDice").haste;
    assert.equal(interval(rogue), speed / ((1 + h) * snd));
    simulation.applyAura(AURAS.bladeFlurry, { duration: 10 });
    const bf = 1 + k("bladeFlurry").haste;
    assert.equal(interval(rogue), speed / ((1 + h) * snd * bf));
    // haste 0 is the weapon speed, with no float op.
    assert.equal(interval(new Rogue()), new Rogue().weapons.mainHand.speed);
  });

  it("speeds up white swings only: energy and GCD (cast) times are identical to haste 0", () => {
    const base = timeline(0);
    assert.ok(base.filter(([type]) => type === "cast").length > 10);
    assert.ok(base.some(([type]) => type === "energy"));
    for (const haste of [0.05, 0.3, 1]) {
      assert.deepEqual(timeline(haste), base, String(haste));
    }
    // And it does swing faster.
    const swings = (haste) => {
      const fight = createFight(7, withHaste(haste), { duration: 60 });
      let count = 0;
      fight.simulation.events.on("hit", ({ origin }) => {
        count += origin === "white" ? 1 : 0;
      });
      runOnCore(fight.simulation, 60);
      return count;
    };
    assert.ok(swings(0.3) > swings(0));
  });
});
