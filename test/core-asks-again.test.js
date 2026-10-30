import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openCore } from "../js/core/fight.js";
import { createFight } from "../js/fight.js";
import { ModifierPipeline } from "../js/modifiers.js";
import { compileRotation } from "../js/rotation-interpreter.js";
import { EXTRA_CASES, FIGHT_CASES } from "./fight-cases.js";
import { COMBAT_GRANTS } from "./combat-grants.js";

// #231 QA (X1 and the field-drop mutants): a run that starts on a fight
// changed since the last run closed asks the rotation at its start, and a
// run on an unchanged fight does not. One change per thing decisionMarks
// (js/core/fight.js) checks, so dropping any one of them fails a test.

const DEFAULT = FIGHT_CASES.find(
  ({ name }) => name === "five-minute-seed-1-300s",
);
const HEMO = EXTRA_CASES.find(
  ({ name }) => name === "dot-hemorrhage-rupture-120s",
);

// The default config's fights are given Blade Flurry and Adrenaline Rush
// (COMBAT_GRANTS): since #199 the untalented default casts neither, and these
// tests change their auras and cooldowns.
function fightAt(
  cut,
  { seed = 5, config = DEFAULT.config, duration = 60 } = {},
) {
  const fight = createFight(seed, structuredClone(config), {
    duration,
    ...(config === DEFAULT.config ? COMBAT_GRANTS : {}),
  });
  fight.simulation.run(cut);
  assert.notEqual(fight.simulation.coreCarry, null, "the run left a carry");
  return fight;
}

// How often the rotation is asked at the start of the next run, with nothing
// past the start time run.
function askedAtStart({ simulation, rogue }) {
  let asked = 0;
  const castRotation = rogue.castRotation;
  rogue.castRotation = function (...args) {
    asked += 1;
    return castRotation.apply(this, args);
  };
  try {
    const run = openCore(simulation, 1);
    run.runUntil(simulation.currentTime);
    run.close();
  } finally {
    delete rogue.castRotation;
  }
  return asked;
}

// A copy of an object with its own fields and prototype.
const copy = (object) =>
  Object.assign(Object.create(Object.getPrototypeOf(object)), object);

// The casts of the next `length` seconds, from the carry or asked afresh.
function castsAfter(fight, length, { fresh = false } = {}) {
  const { simulation } = fight;
  if (fresh) {
    simulation.coreCarry = null;
  }
  const casts = [];
  const off = simulation.on("cast", (event) =>
    casts.push(`${event.ability}@${event.time}`),
  );
  simulation.run(length);
  off?.();
  return casts;
}

describe("a fight changed between runs asks the rotation again (#231 QA)", () => {
  it("does not ask on an unchanged fight", () => {
    assert.equal(askedAtStart(fightAt(2.5)), 0);
    assert.equal(askedAtStart(fightAt(40.123)), 0);
    assert.equal(
      askedAtStart(fightAt(20, { seed: 30, config: HEMO.config })),
      0,
    );
  });

  const CHANGES = [
    ["the GCD", ({ simulation }) => (simulation.gcd = 0)],
    ["the fight length", ({ simulation }) => (simulation.fightLength += 1)],
    [
      "the rotation program, replaced",
      ({ rogue }) =>
        (rogue.rotationProgram = compileRotation(rogue.config.rotation)),
    ],
    [
      "the config, replaced",
      ({ rogue }) => (rogue.config = { ...rogue.config }),
    ],
    ["the build, replaced", ({ rogue }) => (rogue.build = { ...rogue.build })],
    [
      "the granted set, replaced",
      ({ rogue }) => (rogue.granted = new Set(rogue.granted)),
    ],
    [
      "the granted set, added to",
      ({ rogue }) => rogue.granted.add("test-only"),
    ],
    [
      "the modifier pipeline, replaced",
      ({ simulation }) => {
        const pipeline = new ModifierPipeline(simulation.modifiers.modifiers);
        pipeline.attach(simulation);
        simulation.modifiers = pipeline;
      },
    ],
    [
      "the main hand, replaced",
      ({ rogue }) => (rogue.weapons.mainHand = copy(rogue.weapons.mainHand)),
    ],
    [
      "the main hand's swing timer",
      ({ rogue }) => (rogue.weapons.mainHand.swingTimer += 0.1),
    ],
    [
      "the off hand, replaced",
      ({ rogue }) => (rogue.weapons.offHand = copy(rogue.weapons.offHand)),
    ],
    [
      "the off hand's swing timer",
      ({ rogue }) => (rogue.weapons.offHand.swingTimer += 0.1),
    ],
    [
      "a cooldown",
      ({ simulation }) => (simulation.cooldowns["blade-flurry"] -= 1),
    ],
    [
      "an aura's field",
      ({ simulation }) =>
        (simulation.activeBuffs["blade-flurry"].duration += 1),
    ],
    [
      "an aura, replaced by a copy",
      ({ simulation }) =>
        (simulation.activeBuffs["blade-flurry"] = {
          ...simulation.activeBuffs["blade-flurry"],
        }),
    ],
    ["the energy", ({ rogue }) => (rogue.resources.energy.value -= 1)],
    [
      "the combo points' cap",
      ({ rogue }) => (rogue.resources.comboPoints.baseMax += 1),
    ],
    [
      "the combo points' expiry",
      ({ rogue }) => (rogue.resources.comboPoints.expiryRemaining = 5),
    ],
    [
      "the combo points pool, replaced",
      ({ rogue }) =>
        (rogue.resources.comboPoints = copy(rogue.resources.comboPoints)),
    ],
    [
      "the energy rate, with nothing decisionMarks checks changed",
      ({ simulation, rogue }) => {
        const pipeline = new ModifierPipeline([
          { kind: "energyRegen", op: "mult", value: 2, source: "test" },
        ]);
        pipeline.attach(simulation);
        rogue.resources.energy.modifiers = pipeline;
      },
    ],
    [
      "an ability's cost (X1)",
      ({ rogue }) => (rogue.abilitiesById.get("sinister-strike").cost = 20),
    ],
    [
      "an ability's triggersGcd",
      ({ rogue }) => {
        const ability = rogue.abilitiesById.get("sinister-strike");
        ability.triggersGcd = !ability.triggersGcd;
      },
    ],
    [
      "an ability's cooldown",
      ({ rogue }) => (rogue.abilitiesById.get("sinister-strike").cooldown = 3),
    ],
    [
      "a field added to the last ability",
      ({ rogue }) => ([...rogue.abilitiesById.values()].at(-1).testOnly = 1),
    ],
    [
      "an ability, replaced",
      ({ rogue }) =>
        rogue.abilitiesById.set(
          "sinister-strike",
          copy(rogue.abilitiesById.get("sinister-strike")),
        ),
    ],
    [
      "the abilities map, replaced",
      ({ rogue }) => (rogue.abilitiesById = new Map(rogue.abilitiesById)),
    ],
  ];

  for (const [what, change] of CHANGES) {
    it(`asks after a change: ${what}`, () => {
      const fight = fightAt(2.5);
      change(fight);
      assert.ok(askedAtStart(fight) >= 1);
    });
  }

  it("asks when an unfrozen build's selected flag changed", () => {
    // applyBuild freezes the builds it makes, so only a build a host put in
    // its place can change in place.
    const fight = createFight(5, structuredClone(DEFAULT.config), {
      duration: 60,
    });
    fight.rogue.build = { ...fight.rogue.build };
    fight.simulation.run(2.5);
    fight.rogue.build.selected = !fight.rogue.build.selected;
    assert.ok(askedAtStart(fight) >= 1);
  });

  it("asks when a DoT's field changed", () => {
    const fight = fightAt(20, { seed: 30, config: HEMO.config });
    const [dot] = Object.values(fight.simulation.activeDots);
    assert.ok(dot !== undefined, "a DoT is up at the cut");
    dot.tickDamage = (dot.tickDamage ?? 0) + 1;
    assert.ok(askedAtStart(fight) >= 1);
  });
});

// What the rotation does after a change is what it does when asked afresh
// (sim.coreCarry cleared): the carry's wakes are not used on a changed fight.
describe("a changed fight continues as if asked afresh (#231 QA)", () => {
  const same = (cut, change, options) => {
    const kept = fightAt(cut, options);
    const fresh = fightAt(cut, options);
    change(kept);
    change(fresh);
    assert.deepEqual(
      castsAfter(kept, 5),
      castsAfter(fresh, 5, { fresh: true }),
    );
  };

  it("X1: sinister strike's cost changed, seeds 1 to 30 (Kira's x1repro)", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      same(
        40.123,
        ({ rogue }) => (rogue.abilitiesById.get("sinister-strike").cost = 20),
        {
          seed,
          duration: 50,
        },
      );
    }
  });

  it("the energy changed: filled while the rotation waits for it", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      same(40.123, ({ rogue }) => (rogue.resources.energy.value = 100), {
        seed,
        duration: 50,
      });
    }
    const fight = fightAt(40.123, { seed: 2, duration: 50 });
    fight.rogue.resources.energy.value = 100;
    assert.ok(castsAfter(fight, 0.001).length > 0, "it casts at the start");
  });

  it("a cooldown changed: Blade Flurry made ready again", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      same(20, ({ simulation }) => (simulation.cooldowns["blade-flurry"] = 0), {
        seed,
      });
    }
    const fight = fightAt(20);
    fight.simulation.cooldowns["blade-flurry"] = 0;
    assert.ok(
      castsAfter(fight, 2).some((cast) => cast.startsWith("blade-flurry@")),
    );
  });

  it("the rotation swapped for sinister strike only", () => {
    const swap = ({ rogue }) =>
      (rogue.rotationProgram = compileRotation({
        schemaVersion: 1,
        name: "Sinister Strike only",
        rules: [{ action: "sinister-strike", conditions: [] }],
      }));
    for (let seed = 1; seed <= 10; seed += 1) {
      same(2.5, swap, { seed });
    }
    const fight = fightAt(2.5);
    swap(fight);
    const casts = castsAfter(fight, 10);
    assert.ok(
      casts.length > 0 &&
        casts.every((cast) => cast.startsWith("sinister-strike@")),
      casts.join(" "),
    );
  });
});
