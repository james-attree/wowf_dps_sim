import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { createFight, runFight } from "../js/fight.js";
import { createLiveFeed } from "../js/live-feed.js";
import { defaultConfig, defaultDaggerConfig } from "../js/sim-config.js";

// Issue #150. The live feed turns a running fight into the plain slices the
// visualiser draws: the combat log and the combo points from the event stream,
// the continuous values read at the frame. These tests hold it to the engine
// it reads, frame by frame, so the page draws what it drew before.

const STEP = k("sim.fixedStep");
const SEEDS = [1, 20261029, 4242];
// A Rupture rotation, so the log has DoT ticks (a tick shows its status as
// its outcome).
const ruptureConfig = () => ({
  ...defaultConfig(),
  rotation: {
    schemaVersion: 1,
    name: "Rupture",
    rules: [
      {
        action: "rupture",
        conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
      },
      { action: "sinister-strike", conditions: [] },
    ],
  },
});
const CONFIGS = {
  sword: defaultConfig,
  dagger: defaultDaggerConfig,
  rupture: ruptureConfig,
};
// Uneven frames, in whole steps: 0 to 6, the way FrameClock hands them out.
const FRAME_STEPS = [1, 0, 3, 1, 6, 2, 1, 1, 4, 0, 5];

function frames(fight, count, visit) {
  for (let frame = 0; frame < count; frame++) {
    const steps = FRAME_STEPS[frame % FRAME_STEPS.length];
    for (let step = 0; step < steps; step++) {
      fight.simulation.step(STEP);
    }
    visit(frame);
  }
}

// What the visualiser used to read from the engine, in the feed's shape.
function engineView({ rogue, simulation }) {
  const skills = new Map(
    Object.values(rogue.abilities).map((skill) => [skill.id, skill]),
  );
  const timed = (effects) =>
    Object.entries(effects).map(([id, effect]) => {
      const isAura = typeof effect === "object";
      return {
        id,
        name: isAura ? effect.name : skills.get(id)?.name,
        icon: isAura ? effect.icon : skills.get(id)?.icon,
        remaining: isAura ? effect.duration : effect,
      };
    });
  return {
    resources: {
      comboPoints: { value: rogue.comboPoints, max: rogue.maxComboPoints },
      energy: { value: rogue.energy, max: rogue.maxEnergy },
    },
    gcd: { remaining: simulation.gcd, duration: simulation.gcdDuration },
    effects: {
      buffs: timed(simulation.activeBuffs),
      debuffs: timed(simulation.activeDebuffs),
      cooldowns: timed(simulation.cooldowns),
    },
    log: simulation.combatLog,
  };
}

// Every object in it frozen, plain (an object literal or an array), no
// functions: nothing a view could call into or change.
function assertPlainFrozen(value, path = "slice") {
  if (value === null || typeof value !== "object") {
    assert.notEqual(typeof value, "function", path);
    return;
  }
  assert.ok(Object.isFrozen(value), `${path} is frozen`);
  const proto = Object.getPrototypeOf(value);
  assert.ok(
    proto === Object.prototype || proto === Array.prototype,
    `${path} is plain data`,
  );
  for (const [key, inner] of Object.entries(value)) {
    assertPlainFrozen(inner, `${path}.${key}`);
  }
}

describe("live feed (#150)", () => {
  it("reads the slices the visualiser draws, and no others", () => {
    const feed = createLiveFeed(createFight(1, defaultConfig()));
    assert.deepEqual(Object.keys(feed.read()), [
      "resources",
      "gcd",
      "effects",
      "log",
    ]);
  });

  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`matches the engine at every frame of a ${name} fight`, () => {
      for (const seed of SEEDS) {
        const fight = createFight(seed, config());
        const feed = createLiveFeed(fight);
        assert.deepEqual(feed.read(), engineView(fight), "before a step");
        let comboChanges = 0;
        let previousCombo = fight.rogue.comboPoints;
        frames(fight, 3000, (frame) => {
          const read = feed.read();
          assert.deepEqual(read, engineView(fight), `${seed} frame ${frame}`);
          if (fight.rogue.comboPoints !== previousCombo) {
            comboChanges += 1;
            previousCombo = fight.rogue.comboPoints;
          }
        });
        assert.ok(comboChanges > 10, "the fight moves its combo points");
        assert.ok(feed.read().log.length === k("log.maxEvents"), "a full log");
      }
    });
  }

  it("shows a DoT tick's status as its outcome, as the log does", () => {
    const fight = createFight(1, ruptureConfig());
    const feed = createLiveFeed(fight);
    fight.simulation.run(120);
    const crit = feed.read().log.find((row) => row.outcome === "Crit");
    assert.ok(crit, "a DoT tick that crit, shown as Crit");
    assert.deepEqual(feed.read().log, fight.simulation.combatLog);
  });

  it("reads the fight's own caps, combo points and GCD length", () => {
    const fight = createFight(1, defaultConfig());
    fight.rogue.comboPoints = 2;
    fight.rogue.maxComboPoints = 7;
    fight.simulation.gcdDuration = 1.5;
    const feed = createLiveFeed(fight);
    const { resources, gcd } = feed.read();
    assert.deepEqual(resources.comboPoints, { value: 2, max: 7 });
    assert.equal(gcd.duration, 1.5);
  });

  it("gives plain frozen data, with no engine object in it", () => {
    const fight = createFight(20261029, defaultConfig());
    const feed = createLiveFeed(fight);
    frames(fight, 200, () => assertPlainFrozen(feed.read()));
  });

  it("takes a reading: later steps do not change one already read", () => {
    const fight = createFight(4242, defaultConfig());
    const feed = createLiveFeed(fight);
    frames(fight, 100, () => {});
    const first = feed.read();
    const copy = structuredClone(first);
    frames(fight, 100, () => {});
    assert.deepEqual(first, copy);
    assert.notDeepEqual(feed.read(), first);
  });

  it("builds its log from hit events only, the same rows runFight gives", () => {
    for (const seed of SEEDS) {
      const duration = 60;
      const fight = createFight(seed, defaultConfig());
      const feed = createLiveFeed(fight);
      fight.simulation.run(duration);
      const result = runFight({ seed, duration, config: defaultConfig() });
      assert.deepEqual(feed.read().log, result.log, String(seed));
    }
  });

  it("keeps the newest rows when one frame brings more than the log holds", () => {
    const fight = createFight(1, defaultConfig());
    const feed = createLiveFeed(fight);
    fight.simulation.run(120);
    const { log } = feed.read();
    assert.equal(log.length, k("log.maxEvents"));
    assert.deepEqual(log, fight.simulation.combatLog);
    assert.ok(log[0].id > log[log.length - 1].id, "newest first");
  });

  it("subscribes to hit and resource events only", () => {
    const fight = createFight(1, defaultConfig());
    createLiveFeed(fight);
    const events = fight.simulation.events;
    assert.ok(events.has("hit"));
    assert.ok(events.has("resource"));
    for (const type of ["cast", "aura", "proc", "end"]) {
      assert.equal(events.has(type), false, type);
    }
  });

  it("stop() unsubscribes: no more rows or combo points from the fight", () => {
    const fight = createFight(1, defaultConfig());
    const feed = createLiveFeed(fight);
    fight.simulation.run(5);
    const before = feed.read();
    feed.stop();
    feed.stop();
    fight.simulation.run(30);
    const after = feed.read();
    assert.deepEqual(after.log, before.log);
    assert.equal(
      after.resources.comboPoints.value,
      before.resources.comboPoints.value,
    );
    assert.notDeepEqual(fight.simulation.combatLog, before.log);
  });

  it("does not change the fight it reads", () => {
    for (const seed of SEEDS) {
      const fight = createFight(seed, defaultConfig());
      const feed = createLiveFeed(fight);
      frames(fight, 2000, () => feed.read());
      const plain = createFight(seed, defaultConfig());
      frames(plain, 2000, () => {});
      assert.equal(fight.simulation.damageDone, plain.simulation.damageDone);
      assert.deepEqual(fight.simulation.combatLog, plain.simulation.combatLog);
    }
  });
});
