// Garrote (#340). Rank 6 from the 70755 export. The 2s tick and the 0.42
// attack-power term are James, 10 Nov 2026, #340, and assumptions because
// the export does not state them. Attack power is snapshotted at the cast,
// a dev choice.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { AURAS } from "../js/auras.js";
import { runOnCore } from "../js/core/fight.js";
import { createFight } from "../js/fight.js";
import { expandTalents } from "../js/talent-build.js";

const AP = 1000;

function fight(talents = {}, extra = {}) {
  const build = expandTalents(talents);
  const built = createFight(
    1,
    {
      character: { attackPower: AP, critChance: 0 },
      weapons: {
        mainHand: { type: "dagger", min: 40, max: 40, speed: 1.8 },
        offHand: { type: "dagger", min: 40, max: 40, speed: 1.8 },
      },
      rotation: {
        schemaVersion: 1,
        name: "idle",
        rules: [
          {
            action: "sinister-strike",
            conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
          },
        ],
      },
      ...extra,
    },
    {
      modifiers: build.modifiers,
      procs: build.procs,
      abilities: build.abilities,
    },
  );
  built.rogue.energy = built.rogue.maxEnergy;
  built.simulation.gcd = 0;
  built.simulation.rng = () => 0.99;
  return built;
}

function openWindow(h) {
  h.simulation.applyAura(AURAS.ambushWindow, {
    duration: k("ghostlyStrike.ambushWindow"),
    source: "ghostly-strike",
  });
}

function holdSwings(h) {
  h.rogue.weapons.mainHand.swingTimer = 999;
  h.rogue.weapons.offHand.swingTimer = 999;
}

describe("Garrote (#340)", () => {
  it("ticks every 2s, nine times over 18s, for 552 + 0.42 × attack power", () => {
    assert.equal(k("rupture.tickInterval"), 2);
    assert.equal(k("garrote").duration / k("rupture.tickInterval"), 9);
    assert.equal(CONSTANTS["garrote.apCoefficient"].source, "assumption");
    assert.match(
      CONSTANTS["garrote.apCoefficient"].ref,
      /James, 10 Nov 2026, issue #340/,
    );
    const h = fight();
    openWindow(h);
    const total = k("garrote").damage + AP * k("garrote.apCoefficient");
    assert.equal(h.rogue.abilities.garrote.resolve().damage, total);
    assert.equal(
      h.rogue.abilities.garrote.cast(h.rogue, h.simulation).landed,
      true,
    );
    assert.equal(h.simulation.hasAura("ambush-window"), false);
    assert.equal(h.simulation.activeDebuffs.garrote.duration, 18);
    holdSwings(h);
    runOnCore(h.simulation, 18);
    assert.equal(h.simulation.abilityStats.garrote.ticks, 9);
    assert.equal(h.simulation.abilityStats.garrote.damage, total);
  });

  it("snapshots attack power when the cast lands", () => {
    assert.equal(k("garrote.snapshot"), "at application");
    assert.match(CONSTANTS["garrote.snapshot"].ref, /Not a ruling by James/);
    const h = fight();
    openWindow(h);
    const total = k("garrote").damage + AP * k("garrote.apCoefficient");
    h.rogue.abilities.garrote.cast(h.rogue, h.simulation);
    h.rogue.config.character.attackPower = AP * 2;
    holdSwings(h);
    runOnCore(h.simulation, 2);
    assert.equal(h.simulation.abilityStats.garrote.damage, total / 9);
  });

  it("is castable only while the Ghostly Strike window is up, and spends it", () => {
    const closed = fight();
    assert.equal(
      closed.rogue.abilities.garrote.cast(closed.rogue, closed.simulation),
      null,
    );
    assert.equal(closed.simulation.abilityStats.garrote?.casts ?? 0, 0);
    const open = fight({ "subtlety.ghostly-strike": 1 });
    open.rogue.abilities.ghostlyStrike.cast(open.rogue, open.simulation);
    assert.equal(open.simulation.hasAura("ambush-window"), true);
    open.simulation.gcd = 0;
    open.rogue.energy = open.rogue.maxEnergy;
    assert.equal(
      open.rogue.abilities.garrote.cast(open.rogue, open.simulation).landed,
      true,
    );
    assert.equal(open.simulation.hasAura("ambush-window"), false);
  });

  it("Blood Splatter adds 9s of full-strength ticks", () => {
    const h = fight({ "assassination.blood-splatter": 1 });
    openWindow(h);
    const total = k("garrote").damage + AP * k("garrote.apCoefficient");
    const perTick = total / 9;
    h.rogue.abilities.garrote.cast(h.rogue, h.simulation);
    assert.equal(h.simulation.activeDebuffs.garrote.duration, 27);
    holdSwings(h);
    runOnCore(h.simulation, 27);
    assert.ok(h.simulation.abilityStats.garrote.ticks > 9);
    assert.equal(
      h.simulation.abilityStats.garrote.damage,
      perTick * h.simulation.abilityStats.garrote.ticks,
    );
  });

  it("Death Mark stores Garrote damage at twice the mark's rate", () => {
    const h = fight(
      { "subtlety.death-mark": 1 },
      {
        weapons: {
          mainHand: { type: "dagger", min: 40, max: 40, speed: 100 },
          offHand: { type: "dagger", min: 40, max: 40, speed: 100 },
        },
      },
    );
    h.rogue.comboPoints = 1;
    h.rogue.abilities.deathMark.cast(h.rogue, h.simulation);
    openWindow(h);
    h.simulation.gcd = 0;
    h.rogue.energy = h.rogue.maxEnergy;
    h.rogue.abilities.garrote.cast(h.rogue, h.simulation);
    holdSwings(h);
    runOnCore(h.simulation, 2);
    const tick = h.simulation.abilityStats.garrote.damage;
    assert.ok(tick > 0);
    assert.equal(
      h.simulation.activeDebuffs["death-mark"].stored,
      tick * 0.12 * k("deathMark.doubleRate"),
    );
  });
});
