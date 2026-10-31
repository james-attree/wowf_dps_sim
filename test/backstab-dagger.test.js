import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { createFight } from "../js/fight.js";
import { abilityCatalogue } from "../js/abilities.js";
import { rotationHost } from "../js/rotation-host.js";
import { compileRotation, decide } from "../js/rotation-interpreter.js";
import { grantCutthroat } from "./cutthroat-override.js";
import { talentGrantedAbilities } from "../js/talent-build.js";

// Issue #122, with the carry-over from #108: Backstab needs a dagger in the
// main hand. A cast with any other main hand is refused as a failed cast: no
// cast is told, nothing is spent, no cooldown or GCD starts, no number is
// drawn. Backstab and Ambush have the rule (#261: Ambush needs the cutthroat
// aura as well, test/ambush-requirements.test.js). Mutilate lists a dagger
// requirement in the catalogue too, and it is not enforced.

const config = (type) => ({ weapons: { mainHand: { type } } });
const OTHERS = ["sword", "mace", "fist", "axe"];

function ready(type) {
  const fight = createFight(5, config(type));
  fight.rogue.energy = fight.rogue.maxEnergy;
  fight.rogue.comboPoints = 0;
  fight.simulation.gcd = 0;
  return fight;
}

describe("Backstab needs a dagger", () => {
  it("casts with a dagger: told, energy spent, a combo point, the GCD started", () => {
    const { rogue, simulation } = ready("dagger");
    const result = rogue.abilities.backstab.cast(rogue, simulation);
    assert.ok(result);
    assert.equal(simulation.abilityStats.backstab.casts, 1);
    assert.equal(rogue.energy, rogue.maxEnergy - k("backstab").energy);
    assert.ok(rogue.comboPoints >= k("backstab").comboPoints);
    assert.ok(simulation.gcd > 0);
  });

  for (const type of OTHERS) {
    it(`refuses a ${type} main hand and changes nothing`, () => {
      const { rogue, simulation } = ready(type);
      const before = JSON.stringify({
        energy: rogue.energy,
        points: rogue.comboPoints,
        gcd: simulation.gcd,
        cooldowns: simulation.cooldowns,
        log: simulation.combatLog.length,
        damage: simulation.damageDone,
        draw: null,
      });
      const draw = simulation.rng;
      let draws = 0;
      simulation.rng = () => {
        draws += 1;
        return draw();
      };
      assert.equal(rogue.abilities.backstab.cast(rogue, simulation), null);
      assert.equal(draws, 0, "no number drawn");
      assert.equal(simulation.abilityStats.backstab?.casts ?? 0, 0);
      assert.equal(
        JSON.stringify({
          energy: rogue.energy,
          points: rogue.comboPoints,
          gcd: simulation.gcd,
          cooldowns: simulation.cooldowns,
          log: simulation.combatLog.length,
          damage: simulation.damageDone,
          draw: null,
        }),
        before,
      );
    });
  }

  it("is the host's answer too: not castable, not usable, and a rule for it is passed over (#155)", () => {
    const rotation = compileRotation({
      schemaVersion: 1,
      name: "Backstab only",
      rules: [{ action: "backstab", conditions: [] }],
    });
    for (const [type, outcome] of [
      ["dagger", "cast"],
      ["sword", "none"],
    ]) {
      const { rogue, simulation } = ready(type);
      const host = rotationHost(rogue, simulation);
      assert.equal(host.canCast("backstab"), type === "dagger", type);
      assert.equal(host.usable("backstab"), type === "dagger", type);
      assert.equal(decide(rotation, host).outcome, outcome, type);
      assert.equal(
        (simulation.abilityStats.backstab?.casts ?? 0) > 0,
        type === "dagger",
        type,
      );
    }
  });

  it("a Backstab rule above Sinister Strike falls through to it with a sword, and holds the walk with a dagger (#155)", () => {
    const rotation = compileRotation({
      schemaVersion: 1,
      name: "Backstab, then Sinister Strike",
      rules: [
        { action: "backstab", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    });
    for (const [type, casts] of [
      ["dagger", ["backstab"]],
      ["sword", ["sinister-strike"]],
      ["mace", ["sinister-strike"]],
    ]) {
      const { rogue, simulation } = ready(type);
      assert.deepEqual(
        decide(rotation, rotationHost(rogue, simulation)),
        { casts, outcome: "cast" },
        type,
      );
    }
    // With a dagger and too little energy, Backstab still pools: the rule is
    // only passed over when no amount of waiting could make it castable.
    const { rogue, simulation } = ready("dagger");
    rogue.energy = 0;
    assert.equal(
      decide(rotation, rotationHost(rogue, simulation)).outcome,
      "pooling",
    );
  });

  it("host.usable is false only for Backstab off a dagger (#155), and for Ambush (#261)", () => {
    for (const type of ["dagger", ...OTHERS]) {
      // Every talent ability granted, so only the weapon is asked: a talent
      // ability the build lacks is not usable either (#199).
      const { rogue, simulation } = createFight(5, config(type), {
        abilities: [...talentGrantedAbilities],
      });
      const host = rotationHost(rogue, simulation);
      const unusable = ABILITY_DEFINITIONS.map(({ id }) => id).filter(
        (id) => !host.usable(id),
      );
      // Ambush needs the cutthroat aura, which nothing in the fight grants
      // (#261).
      assert.deepEqual(
        unusable,
        type === "dagger" ? ["ambush"] : ["backstab", "ambush"],
        type,
      );
    }
  });

  it("a refused Backstab publishes no cast event (#164)", () => {
    const { rogue, simulation } = ready("sword");
    const events = [];
    simulation.on("*", (event) => events.push(event));
    assert.equal(rogue.abilities.backstab.cast(rogue, simulation), null);
    assert.deepEqual(
      events.filter((event) => event.type === "cast"),
      [],
    );
    assert.deepEqual(
      events.filter((event) => event.ability === "backstab"),
      [],
    );
  });

  it("is data: only Backstab and Ambush have requiresMainHand (#261)", () => {
    const needing = ABILITY_DEFINITIONS.filter(
      (definition) => definition.requiresMainHand !== undefined,
    );
    assert.deepEqual(
      needing.map((definition) => [definition.id, definition.requiresMainHand]),
      [
        ["backstab", "dagger"],
        ["ambush", "dagger"],
      ],
    );
  });

  it("enforces the catalogue's dagger requirement for Ambush, and not Mutilate's (#261)", () => {
    for (const id of ["ambush", "mutilate"]) {
      assert.ok(abilityCatalogue.get(id).requires.includes("daggers"), id);
    }
    // The cutthroat aura granted by the test-only override, so only the
    // weapon is asked.
    for (const [type, casts] of [
      ["sword", false],
      ["dagger", true],
    ]) {
      const fight = createFight(5, config(type));
      fight.rogue.energy = fight.rogue.maxEnergy;
      fight.simulation.gcd = 0;
      const { rogue, simulation } = fight;
      grantCutthroat(rogue, simulation);
      assert.equal(
        rogue.abilities.ambush.cast(rogue, simulation) !== null,
        casts,
        type,
      );
    }
    assert.equal(
      ABILITY_DEFINITIONS.some(({ id }) => id === "mutilate"),
      false,
      "Mutilate is not an engine ability",
    );
  });

  it("a whole fight with a Backstab-only rotation casts it with daggers and never with swords", () => {
    const rotation = {
      schemaVersion: 1,
      name: "Backstab only",
      rules: [{ action: "backstab", conditions: [] }],
    };
    for (const [type, casts] of [
      ["dagger", true],
      ["sword", false],
    ]) {
      const fight = createFight(5, { ...config(type), rotation });
      fight.simulation.run(20);
      assert.equal(
        (fight.simulation.abilityStats.backstab?.casts ?? 0) > 0,
        casts,
        type,
      );
    }
  });

  it("a whole fight with Backstab above Sinister Strike on a sword casts Sinister Strike, not nothing (#155)", () => {
    const rotation = {
      schemaVersion: 1,
      name: "Backstab, then Sinister Strike",
      rules: [
        { action: "backstab", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    };
    const fight = createFight(5, { ...config("sword"), rotation });
    fight.simulation.run(20);
    const stats = fight.simulation.abilityStats;
    assert.equal(stats.backstab?.casts ?? 0, 0);
    assert.ok(stats["sinister-strike"].casts > 0);
  });
});
