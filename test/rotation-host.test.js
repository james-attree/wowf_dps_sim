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
import { COMBAT_GRANTS } from "./combat-grants.js";
import { referenceBuild } from "./talentsforever.js";
import { runOnCore } from "../js/core/fight.js";

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
// Blade Flurry left out: Adrenaline Rush and Weapon Expertise need it, so
// they go too, and the four points move to Assassination (#155).
const noFlurry = (() => {
  const ranks = referenceBuild();
  for (const id of [
    "combat.blade-flurry",
    "combat.adrenaline-rush",
    "combat.weapon-expertise",
  ]) {
    delete ranks[id];
  }
  return {
    ...ranks,
    "assassination.murder": 2,
    "assassination.improved-poisons": 2,
  };
})();

describe("rotationHost", () => {
  it("answers canCast from the ability and the build", () => {
    const { rogue, simulation } = fightWith({});
    const host = rotationHost(rogue, simulation);
    rogue.energy = 100;
    assert.equal(host.canCast("sinister-strike"), true);
    rogue.energy = 10;
    assert.equal(host.canCast("sinister-strike"), false);
    // Blade Flurry and Adrenaline Rush: with no build selected the fight is
    // untalented (#199), so they are locked and not usable either.
    rogue.energy = 100;
    for (const id of ["blade-flurry", "adrenaline-rush"]) {
      assert.equal(host.canCast(id), false, id);
      assert.equal(host.usable(id), false, id);
    }
    assert.equal(host.usable("sinister-strike"), true);
    // A host grant unlocks them.
    const granted = fightWith({}, COMBAT_GRANTS);
    granted.rogue.energy = 100;
    const grantedHost = rotationHost(granted.rogue, granted.simulation);
    for (const id of ["blade-flurry", "adrenaline-rush"]) {
      assert.equal(grantedHost.canCast(id), true, id);
      assert.equal(grantedHost.usable(id), true, id);
    }
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

  it("holds back Blade Flurry when the selected build lacks it (#155)", () => {
    const locked = fightWith(noFlurry);
    locked.rogue.energy = 100;
    const host = rotationHost(locked.rogue, locked.simulation);
    const flurry = locked.rogue.abilitiesById.get("blade-flurry");
    assert.equal(locked.rogue.lockedByBuild(flurry), true);
    assert.equal(flurry.canCast(locked.rogue, locked.simulation), true);
    assert.equal(host.canCast("blade-flurry"), false);
    // Locked is "not usable" too (#199): the interpreter passes its rule
    // over whatever the rule's conditions say.
    assert.equal(host.usable("blade-flurry"), false);
    const rotation = compileRotation({
      schemaVersion: 1,
      name: "Flurry first",
      rules: [
        {
          action: "blade-flurry",
          conditions: [{ type: "abilityUnlocked", ability: "blade-flurry" }],
        },
        { action: "sinister-strike", conditions: [] },
      ],
    });
    assert.deepEqual(decide(rotation, host), {
      casts: ["sinister-strike"],
      outcome: "cast",
    });
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
  it("is not redundant: the validator refuses the rule without it (#188), and with it a build lacking the ability falls through", () => {
    // Without a guard the rule would hold and the locked ability could not be
    // cast, so the walk would end there and Sinister Strike would never be
    // reached. Since #188 such a rotation is refused before the fight.
    assert.throws(
      () => castsIn(rush(), noRush),
      /rules\[0\]\.conditions: Adrenaline Rush \(adrenaline-rush\) comes from a talent/,
    );
    const guarded = castsIn(
      rush({ type: "abilityUnlocked", ability: "adrenaline-rush" }),
      noRush,
    );
    assert.ok(guarded["sinister-strike"].casts > 10);
    assert.equal(guarded["adrenaline-rush"], undefined);
  });

  it("makes no difference for a build that has the ability: abilityUnlocked and abilityGranted cast the same", () => {
    const unlocked = castsIn(
      rush(
        { type: "abilityUnlocked", ability: "adrenaline-rush" },
        { type: "cooldownReady", ability: "adrenaline-rush" },
      ),
      referenceBuild(),
    );
    const granted = castsIn(
      rush(
        { type: "abilityGranted", ability: "adrenaline-rush" },
        { type: "cooldownReady", ability: "adrenaline-rush" },
      ),
      referenceBuild(),
    );
    assert.deepEqual(unlocked, granted);
    assert.ok(unlocked["adrenaline-rush"].casts >= 1);
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
    assert.throws(
      () => compileRotation(rush()),
      /^RangeError: Bad rotation:\n/,
    );
  });
});

describe("rotationStateReader: the view built a part at a time", () => {
  // It must say what rotationState says, at every moment of a fight: with
  // auras, debuffs and cooldowns coming and going, the energy rate doubling
  // under Adrenaline Rush, and every kind of build.
  for (const [name, talents, options] of [
    ["no build, Blade Flurry and Adrenaline Rush granted", {}, COMBAT_GRANTS],
    ["the reference build", referenceBuild()],
    ["a build without Adrenaline Rush", noRush],
  ]) {
    it(`reads what rotationState gives, all through a fight: ${name}`, () => {
      const { rogue, simulation } = fightWith(talents, options);
      const reader = rotationStateReader(rogue, simulation, { duration: 90 });
      const seen = { auras: 0, debuffs: 0, cooldowns: 0, rushes: 0 };
      for (let index = 0; index < 1200; index += 1) {
        runOnCore(simulation, 0.1);
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
    const { rogue, simulation } = fightWith({}, COMBAT_GRANTS);
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
