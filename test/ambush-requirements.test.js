import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONSTANTS, k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { Ability } from "../js/ability.js";
import { createFight, runFight } from "../js/fight.js";
import { rotationHost } from "../js/rotation-host.js";
import { compileRotation, decide } from "../js/rotation-interpreter.js";
import { exportRotation, importRotation } from "../js/rotation-io.js";
import { rotationWarnings } from "../js/rotation-warnings.js";
import { validateRotation } from "../js/rotation-validator.js";
import { REQUIRED_AURAS } from "../js/required-auras.js";
import { grantStealth } from "./stealth-override.js";

// Issue #261: Ambush needs a dagger in the main hand and the Stealth aura
// (js/required-auras.js). Nothing in a fight grants Stealth (the sim models no
// stealth openers), so Ambush is never cast. A rotation may still hold an
// Ambush rule, with no warning: it is passed over. The test-only override
// (test/stealth-override.js) grants the aura as Cutthroat will in Phase 4.6,
// which proves the hook: Ambush casts, uses the aura up, and is refused again.

const SEED = 7;
const DURATION = 300;
const fivePoints = { type: "comboPoints", op: ">=", value: 5 };
const rotation = (...builders) => ({
  schemaVersion: 1,
  name: "Eviscerate at 5 CP, otherwise a builder",
  rules: [
    { action: "eviscerate", conditions: [fivePoints] },
    ...builders.map((action) => ({ action, conditions: [] })),
  ],
});
const weapons = (type) => ({ mainHand: { type } });

function ready(type, options) {
  const fight = createFight(5, { weapons: weapons(type) }, options);
  fight.rogue.energy = fight.rogue.maxEnergy;
  fight.rogue.comboPoints = 0;
  fight.simulation.gcd = 0;
  return fight;
}

// What a refused cast must leave alone, and a count of the rng draws.
function snapshot({ rogue, simulation }) {
  return JSON.stringify({
    energy: rogue.energy,
    points: rogue.comboPoints,
    gcd: simulation.gcd,
    buffs: simulation.activeBuffs,
    cooldowns: simulation.cooldowns,
    log: simulation.combatLog.length,
    damage: simulation.damageDone,
    casts: simulation.abilityStats.ambush?.casts ?? 0,
  });
}
function countDraws(simulation) {
  const counter = { draws: 0 };
  const draw = simulation.rng;
  simulation.rng = () => {
    counter.draws += 1;
    return draw();
  };
  return counter;
}

describe("Ambush in the issue's repro (#261)", () => {
  // Before the fix (main at 108403c): 204.7 DPS with 48 Ambush on a sword,
  // 194.4 with 48 on a dagger.
  for (const type of ["sword", "dagger"]) {
    it(`casts no Ambush on a ${type}: the fight is Eviscerate at 5 CP alone`, () => {
      const config = (...builders) => ({
        weapons: weapons(type),
        rotation: rotation(...builders),
      });
      const withAmbush = runFight({
        seed: SEED,
        duration: DURATION,
        config: config("ambush"),
      });
      const alone = runFight({
        seed: SEED,
        duration: DURATION,
        config: config(),
      });
      assert.equal(withAmbush.abilities.Ambush, undefined);
      assert.equal(
        withAmbush.log.some((line) => JSON.stringify(line).includes("Ambush")),
        false,
      );
      const { config: ignored, ...rest } = withAmbush;
      const { config: ignoredToo, ...restAlone } = alone;
      assert.deepEqual(rest, restAlone);
      assert.ok(ignored && ignoredToo);
    });
  }
});

describe("a refused Ambush spends nothing (#261)", () => {
  for (const type of ["sword", "dagger"]) {
    it(`with no stealth on a ${type}: no cast, energy, combo point, GCD, cooldown or draw`, () => {
      const fight = ready(type);
      const { rogue, simulation } = fight;
      const before = snapshot(fight);
      const counter = countDraws(simulation);
      const events = [];
      simulation.on("*", (event) => events.push(event));
      assert.equal(rogue.abilities.ambush.canCast(rogue, simulation), false);
      assert.equal(rogue.abilities.ambush.cast(rogue, simulation), null);
      assert.equal(counter.draws, 0);
      assert.equal(snapshot(fight), before);
      assert.deepEqual(events, []);
    });
  }

  it("on a sword with stealth: still refused, nothing spent (it needs a dagger too)", () => {
    const fight = ready("sword");
    const { rogue, simulation } = fight;
    grantStealth(rogue, simulation);
    const before = snapshot(fight);
    const counter = countDraws(simulation);
    assert.equal(rogue.abilities.ambush.canCast(rogue, simulation), false);
    assert.equal(rogue.abilities.ambush.cast(rogue, simulation), null);
    assert.equal(counter.draws, 0);
    assert.equal(snapshot(fight), before);
    assert.equal(simulation.hasAura("stealth"), true, "not used up");
    const host = rotationHost(rogue, simulation);
    assert.equal(host.usable("ambush"), false);
    assert.equal(host.canCast("ambush"), false);
  });
});

describe("the host passes an Ambush rule over (#261)", () => {
  const program = () =>
    compileRotation({
      schemaVersion: 1,
      name: "Ambush, then Sinister Strike",
      rules: [
        { action: "ambush", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    });
  for (const type of ["sword", "dagger"]) {
    it(`on a ${type}: not usable, not castable, and the walk falls through to Sinister Strike`, () => {
      const { rogue, simulation } = ready(type);
      const host = rotationHost(rogue, simulation);
      assert.equal(host.usable("ambush"), false);
      assert.equal(host.canCast("ambush"), false);
      assert.deepEqual(decide(program(), host), {
        casts: ["sinister-strike"],
        outcome: "cast",
      });
    });

    it(`on a ${type} with too little energy: the walk pools for Sinister Strike, not Ambush`, () => {
      const { rogue, simulation } = ready(type);
      rogue.energy = 0;
      const counter = countDraws(simulation);
      const host = rotationHost(rogue, simulation);
      assert.equal(decide(program(), host).outcome, "pooling");
      assert.equal(counter.draws, 0);
      assert.equal(simulation.abilityStats.ambush?.casts ?? 0, 0);
    });
  }
});

describe("the stealth hook: what Cutthroat will plug into (#261)", () => {
  it("names the aura: Ambush requires the self aura stealth, the catalogue's id, with one charge", () => {
    const aura = REQUIRED_AURAS.stealth;
    assert.equal(aura.id, "stealth");
    assert.equal(aura.target, "self");
    assert.equal(aura.charges, k("stealth.aura").charges);
    assert.equal(aura.charges, 1);
    assert.equal(aura.duration, null, "the granter gives the duration");
    assert.equal(
      ABILITY_DEFINITIONS.find(({ id }) => id === "ambush").requiresAura,
      aura.id,
    );
  });

  it("nothing in a fight grants it: no granted aura, and it is not up", () => {
    for (const type of ["sword", "dagger"]) {
      const { rogue, simulation } = ready(type);
      assert.deepEqual([...rogue.grantedAuras], []);
      assert.equal(simulation.hasAura("stealth"), false);
    }
  });

  it("granted, with a dagger: Ambush casts, uses the aura up, and is refused again with nothing spent", () => {
    const fight = ready("dagger");
    const { rogue, simulation } = fight;
    const events = [];
    simulation.on("aura", (event) => events.push(event));
    grantStealth(rogue, simulation);
    const host = rotationHost(rogue, simulation);
    assert.equal(host.usable("ambush"), true);
    assert.equal(host.canCast("ambush"), true);
    assert.ok(rogue.abilities.ambush.cast(rogue, simulation));
    assert.equal(simulation.abilityStats.ambush.casts, 1);
    assert.equal(rogue.energy, rogue.maxEnergy - k("ambush").energy);
    // Consumed: the cast used the one charge, and the aura ended.
    assert.equal(simulation.hasAura("stealth"), false);
    assert.equal(Object.hasOwn(simulation.activeBuffs, "stealth"), false);
    assert.deepEqual(
      events
        .filter(({ aura }) => aura === "stealth")
        .map(({ change, reason }) => [change, reason]),
      [
        ["apply", null],
        ["expire", "charges"],
      ],
    );
    // Refused again: nothing spent, drawn or told.
    rogue.energy = rogue.maxEnergy;
    simulation.gcd = 0;
    const before = snapshot(fight);
    const counter = countDraws(simulation);
    const after = [];
    simulation.on("*", (event) => after.push(event));
    assert.equal(host.canCast("ambush"), false);
    assert.equal(rogue.abilities.ambush.cast(rogue, simulation), null);
    assert.equal(counter.draws, 0);
    assert.equal(snapshot(fight), before);
    assert.deepEqual(after, []);
    assert.equal(simulation.abilityStats.ambush.casts, 1);
  });

  it("a cast that misses uses the aura up too: it is used by a cast that goes ahead, whatever the outcome", () => {
    const { rogue, simulation } = ready("dagger");
    grantStealth(rogue, simulation);
    // The lowest roll is a miss on the attack table.
    simulation.rng = () => 0;
    const result = rogue.abilities.ambush.cast(rogue, simulation);
    assert.ok(result);
    assert.equal(result.landed, false);
    assert.equal(result.outcome, "miss");
    assert.equal(simulation.hasAura("stealth"), false);
  });

  it("a cast refused for something else (energy) leaves the aura up", () => {
    const { rogue, simulation } = ready("dagger");
    grantStealth(rogue, simulation);
    rogue.energy = 0;
    assert.equal(rogue.abilities.ambush.cast(rogue, simulation), null);
    assert.equal(simulation.hasAura("stealth"), true);
  });

  it("granted, in a rotation: an Ambush rule casts once, then the walk pools for it (it is usable)", () => {
    const { rogue, simulation } = ready("dagger");
    grantStealth(rogue, simulation);
    const program = compileRotation({
      schemaVersion: 1,
      name: "Ambush, then Sinister Strike",
      rules: [
        { action: "ambush", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    });
    const host = rotationHost(rogue, simulation);
    assert.deepEqual(decide(program, host), {
      casts: ["ambush"],
      outcome: "cast",
    });
    simulation.gcd = 0;
    assert.equal(decide(program, host).outcome, "pooling");
  });

  it("the aura up but not granted: a cast goes ahead, and a rotation rule is still passed over", () => {
    const { rogue, simulation } = ready("dagger");
    simulation.applyAura(REQUIRED_AURAS.stealth, { duration: 10 });
    const host = rotationHost(rogue, simulation);
    assert.equal(host.usable("ambush"), false);
    assert.ok(rogue.abilities.ambush.cast(rogue, simulation));
  });

  it("the override is test-only: no Rogue or fight option grants the aura", () => {
    for (const key of ["states", "auras", "grantedAuras", "stealth"]) {
      assert.throws(
        () => createFight(1, {}, { [key]: ["stealth"] }),
        /Unknown Rogue option/,
        key,
      );
    }
  });
});

describe("the requirements are data (#261)", () => {
  it("Ambush needs a dagger and Stealth; only it requires an aura", () => {
    assert.deepEqual(
      ABILITY_DEFINITIONS.filter(
        (definition) => definition.requiresAura !== undefined,
      ).map((definition) => [definition.id, definition.requiresAura]),
      [["ambush", "stealth"]],
    );
    const ambush = ABILITY_DEFINITIONS.find(({ id }) => id === "ambush");
    assert.equal(ambush.requiresMainHand, "dagger");
  });

  it("a definition that requires an aura js/required-auras.js does not define is refused", () => {
    const ambush = ABILITY_DEFINITIONS.find(({ id }) => id === "ambush");
    const { rogue } = createFight(1);
    assert.throws(
      () => new Ability({ ...ambush, requiresAura: "invisible" }, rogue),
      /requires the aura "invisible"/,
    );
    assert.ok(new Ability(ambush, rogue));
  });

  it("Premeditation is unchanged: it requires no aura and casts with no stealth", () => {
    const premeditation = ABILITY_DEFINITIONS.find(
      ({ id }) => id === "premeditation",
    );
    assert.equal(premeditation.requiresAura, undefined);
    assert.equal(premeditation.requiresMainHand, undefined);
    const { rogue, simulation } = ready("sword", {
      abilities: ["premeditation"],
    });
    const host = rotationHost(rogue, simulation);
    assert.equal(host.usable("premeditation"), true);
    assert.equal(host.canCast("premeditation"), true);
    rogue.abilities.premeditation.cast(rogue, simulation);
    assert.equal(simulation.abilityStats.premeditation.casts, 1);
    assert.equal(rogue.comboPoints, k("premeditation").comboPoints);
  });

  it("the ambush constants note says what is enforced", () => {
    const { note, source } = CONSTANTS.ambush;
    assert.match(note, /dagger in the main hand/);
    assert.match(note, /Stealth/);
    assert.doesNotMatch(
      note,
      /Stealth, dagger, and behind requirements are not enforced/,
    );
    assert.equal(source, CONSTANTS.backstab.source);
  });
});

describe("an Ambush rule is not warned for (#261: the coordinator dropped the warning)", () => {
  it("a rotation with an Ambush rule validates, and its warnings are those of the rule as any other", () => {
    const withAmbush = rotation("ambush");
    assert.deepEqual(validateRotation(withAmbush), []);
    assert.deepEqual(
      rotationWarnings(withAmbush).filter(
        ({ ability }) => ability === "ambush",
      ),
      [],
    );
    assert.equal(importRotation(exportRotation(withAmbush)).ok, true);
  });
});
