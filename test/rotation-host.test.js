import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFight } from "../js/fight.js";
import { rotationHost } from "../js/rotation-host.js";
import {
  lazyRotationState,
  rotationState,
  rotationStateReader,
} from "../js/rotation-state.js";
import { compileRotation, decide } from "../js/rotation-interpreter.js";
import { defaultConfig } from "../js/sim-config.js";
import { buildWithout } from "./builds.js";
import { referenceBuild } from "./talentsforever.js";

// R3 (#140): the Rogue's host for the interpreter, and the decision about
// abilityUnlocked (docs/rotation.md, "Granted and unlocked").

function fightWith(talents, options) {
  const config = defaultConfig();
  config.talents = talents;
  return createFight(5, config, options);
}

// What a view says, read out part by part into a plain object (the lazy view
// reads the pools and the rest when asked, so it is compared by what it gives).
function read(view) {
  const resources = {};
  for (const id of Object.keys(view.resources)) {
    const { value, max, regenPerSecond } = view.resources[id];
    resources[id] = { value, max, regenPerSecond };
  }
  return {
    time: view.time,
    duration: view.duration,
    resources,
    auras: view.auras,
    debuffs: view.debuffs,
    cooldowns: view.cooldowns,
    build: view.build,
    granted: view.granted,
    talentAbilities: view.talentAbilities,
  };
}

const noRush = buildWithout(["combat.adrenaline-rush"]);

describe("rotationHost", () => {
  it("answers canCast from the ability and the build", () => {
    const { rogue, simulation } = fightWith({});
    const host = rotationHost(rogue, simulation);
    rogue.energy = 100;
    assert.equal(host.canCast("sinister-strike"), true);
    rogue.energy = 10;
    assert.equal(host.canCast("sinister-strike"), false);
    // Blade Flurry and Adrenaline Rush: with no build selected, not locked.
    rogue.energy = 100;
    assert.equal(host.canCast("blade-flurry"), true);
    assert.equal(host.canCast("adrenaline-rush"), true);
  });

  it("hands the interpreter an unfrozen view, equal to the frozen one", () => {
    const { rogue, simulation } = fightWith({});
    const view = rotationHost(rogue, simulation).state();
    assert.ok(!Object.isFrozen(view));
    assert.deepEqual(read(view), rotationState(rogue, simulation));
  });

  it("follows the rogue to another simulation: one host for each", () => {
    const first = fightWith({});
    const second = createFight(2, first.config ?? {});
    const { rogue } = first;
    rogue.energy = 100;
    rogue.castRotation(first.simulation);
    const castsHere = first.simulation.combatLog.length;
    assert.ok(castsHere > 0);
    // The same rogue asked in a simulation that has had no casts: the cast
    // lands there and not in the first.
    rogue.energy = 100;
    rogue.castRotation(second.simulation);
    assert.ok(second.simulation.combatLog.length > 0);
    assert.equal(first.simulation.combatLog.length, castsHere);
  });

  it("holds back an ability the selected build lacks, with everything else ready", () => {
    const locked = fightWith(noRush);
    locked.rogue.energy = 100;
    const host = rotationHost(locked.rogue, locked.simulation);
    assert.equal(
      locked.rogue.lockedByBuild(
        locked.rogue.abilitiesById.get("adrenaline-rush"),
      ),
      true,
    );
    assert.equal(host.canCast("adrenaline-rush"), false);
    assert.equal(host.canCast("blade-flurry"), true);
    const full = fightWith(referenceBuild());
    full.rogue.energy = 100;
    assert.equal(
      rotationHost(full.rogue, full.simulation).canCast("adrenaline-rush"),
      true,
    );
  });

  it("says whether the GCD is clear and which abilities start it", () => {
    const { rogue, simulation } = fightWith({});
    const host = rotationHost(rogue, simulation);
    assert.equal(host.gcdClear(), true);
    simulation.gcd = 1.5;
    assert.equal(host.gcdClear(), false);
    for (const id of [
      "sinister-strike",
      "eviscerate",
      "slice-and-dice",
      "blade-flurry",
      "adrenaline-rush",
    ]) {
      assert.equal(host.onGcd(id), true, id);
    }
    for (const id of ["cold-blood", "premeditation"]) {
      assert.equal(host.onGcd(id), false, id);
    }
  });

  it("casts through the ability, and reads the state view of the fight", () => {
    const { rogue, simulation } = fightWith({});
    const host = rotationHost(rogue, simulation);
    rogue.energy = 100;
    host.cast("sinister-strike");
    assert.equal(
      rogue.energy,
      100 - rogue.abilitiesById.get("sinister-strike").cost,
    );
    assert.ok(simulation.gcd > 0);
    assert.deepEqual(read(host.state()), rotationState(rogue, simulation, {}));
    assert.equal(host.state().duration, null);
    assert.deepEqual(
      read(rotationHost(rogue, simulation, { duration: 90 }).state()),
      rotationState(rogue, simulation, { duration: 90 }),
    );
  });
});

// A rotation with Adrenaline Rush's rule as an on-GCD rule always does.
const rush = (...conditions) => ({
  schemaVersion: 1,
  name: "Rush first",
  rules: [
    { action: "adrenaline-rush", conditions },
    { action: "sinister-strike", conditions: [] },
  ],
});

function castsIn(rotation, talents) {
  const config = defaultConfig();
  config.talents = talents;
  config.rotation = rotation;
  const fight = createFight(2, config);
  fight.simulation.run(60);
  return fight.simulation.abilityStats;
}

describe("abilityUnlocked on an on-GCD talent ability", () => {
  it("is not redundant: without it a build lacking the ability starves the list", () => {
    const without = castsIn(rush(), noRush);
    const guarded = castsIn(
      rush({ type: "abilityUnlocked", ability: "adrenaline-rush" }),
      noRush,
    );
    // The rule holds and the locked ability cannot be cast, so the walk ends
    // there and Sinister Strike is never reached.
    assert.equal(without["sinister-strike"], undefined);
    assert.ok(guarded["sinister-strike"].casts > 10);
    assert.equal(guarded["adrenaline-rush"], undefined);
  });

  it("makes no difference for a build that has the ability", () => {
    const rotation = rush({
      type: "cooldownReady",
      ability: "adrenaline-rush",
    });
    const unguarded = castsIn(rotation, referenceBuild());
    const guarded = castsIn(
      rush(
        { type: "abilityUnlocked", ability: "adrenaline-rush" },
        { type: "cooldownReady", ability: "adrenaline-rush" },
      ),
      referenceBuild(),
    );
    assert.deepEqual(guarded, unguarded);
    assert.ok(guarded["adrenaline-rush"].casts >= 1);
  });

  it("never casts an ability the build lacks", () => {
    const stats = castsIn(
      rush(
        { type: "abilityUnlocked", ability: "adrenaline-rush" },
        { type: "cooldownReady", ability: "adrenaline-rush" },
      ),
      noRush,
    );
    assert.equal(stats["adrenaline-rush"], undefined);
  });

  it("decides the same at one decision point as the host's canCast", () => {
    const { rogue, simulation } = fightWith(noRush);
    rogue.energy = 100;
    const host = rotationHost(rogue, simulation);
    const result = decide(
      compileRotation(
        rush({ type: "abilityUnlocked", ability: "adrenaline-rush" }),
      ),
      host,
    );
    assert.deepEqual(result, { casts: ["sinister-strike"], outcome: "cast" });
    rogue.energy = 100;
    simulation.gcd = 0;
    assert.deepEqual(
      decide(compileRotation(rush()), rotationHost(rogue, simulation)),
      {
        casts: [],
        outcome: "pooling",
      },
    );
  });
});

describe("rotationStateReader: the view built a part at a time", () => {
  // It must say what rotationState says, at every moment of a fight: with
  // auras, debuffs and cooldowns coming and going, the energy rate doubling
  // under Adrenaline Rush, and every kind of build.
  for (const [name, talents] of [
    ["no build", {}],
    ["the reference build", referenceBuild()],
    ["a build without Adrenaline Rush", noRush],
  ]) {
    it(`reads what rotationState gives, all through a fight: ${name}`, () => {
      const { rogue, simulation } = fightWith(talents);
      const reader = rotationStateReader(rogue, simulation, { duration: 90 });
      const seen = { auras: 0, debuffs: 0, cooldowns: 0, rushes: 0 };
      for (let index = 0; index < 1200; index += 1) {
        simulation.step(0.1);
        const view = reader();
        const expected = rotationState(rogue, simulation, { duration: 90 });
        assert.deepEqual(read(view), expected, `at step ${index}`);
        seen.auras += Object.keys(expected.auras).length > 0 ? 1 : 0;
        seen.debuffs += Object.keys(expected.debuffs).length > 0 ? 1 : 0;
        seen.cooldowns += Object.keys(expected.cooldowns).length > 0 ? 1 : 0;
        seen.rushes +=
          expected.resources.energy.regenPerSecond >
          rogue.resources.energy.definition.regen.base
            ? 1
            : 0;
      }
      assert.ok(seen.auras > 10 && seen.cooldowns > 10, JSON.stringify(seen));
    });
  }

  it("reads the fight as it is when a part is read, not when the view was made", () => {
    const { rogue, simulation } = fightWith({});
    const view = rotationStateReader(rogue, simulation)();
    rogue.energy = 100;
    assert.equal(view.resources.energy.value, 100);
    rogue.energy = 7;
    assert.equal(view.resources.energy.value, 7);
  });

  it("keeps a part once it is read, for the rest of that view", () => {
    const { rogue, simulation } = fightWith({});
    rogue.energy = 100;
    rogue.castRotation(simulation);
    const view = rotationStateReader(rogue, simulation)();
    const { cooldowns } = view;
    assert.equal(view.cooldowns, cooldowns);
    assert.ok(Object.keys(cooldowns).length > 0);
  });

  it("makes a new view each time, and one view alone with lazyRotationState", () => {
    const { rogue, simulation } = fightWith({});
    const reader = rotationStateReader(rogue, simulation);
    assert.notEqual(reader(), reader());
    assert.deepEqual(
      read(lazyRotationState(rogue, simulation, { duration: 5 })),
      rotationState(rogue, simulation, { duration: 5 }),
    );
  });

  it("shares what a fight does not change, and freezes it", () => {
    const { rogue, simulation } = fightWith(referenceBuild());
    const reader = rotationStateReader(rogue, simulation);
    const [first, second] = [reader(), reader()];
    assert.equal(first.talentAbilities, second.talentAbilities);
    assert.ok(Object.isFrozen(first.talentAbilities));
    assert.ok(Object.isFrozen(first.granted));
    assert.ok(Object.isFrozen(first.build));
  });
});
