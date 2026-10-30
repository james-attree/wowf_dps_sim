import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { createFight, runFight } from "../js/fight.js";
import { abilityCatalogue } from "../js/abilities.js";
import { cooldownOf, createLiveFeed, procName } from "../js/live-feed.js";
import { defaultConfig, defaultDaggerConfig } from "../js/sim-config.js";
import { referenceBuild } from "./talentsforever.js";
import { runOnCore } from "../js/core/fight.js";
import { POLL_STEP } from "./poll-step.js";

// Issue #150. The live feed turns a running fight into the plain slices the
// visualiser draws: the combat log and the combo points from the event stream,
// the continuous values read at the frame. These tests hold it to the engine
// it reads, frame by frame, so the page draws what it drew before.

const STEP = POLL_STEP;
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
// The reference talents with both poisons: procs (Hack and Slash,
// Ruthlessness, Relentless Strikes, the poisons) and a stacking debuff.
const procConfig = () => ({
  ...defaultConfig(),
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
});
const CONFIGS = {
  sword: defaultConfig,
  dagger: defaultDaggerConfig,
  rupture: ruptureConfig,
  procs: procConfig,
};
// Uneven frames, in whole 1/64 s steps: 0 to 6.
const FRAME_STEPS = [1, 0, 3, 1, 6, 2, 1, 1, 4, 0, 5];

function frames(fight, count, visit) {
  for (let frame = 0; frame < count; frame++) {
    const steps = FRAME_STEPS[frame % FRAME_STEPS.length];
    for (let step = 0; step < steps; step++) {
      runOnCore(fight.simulation, STEP);
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

// A reading cut to what the engine has its own copy of (engineView): the
// Phase 3 slices and fields (duration, stacks, procs, spend, moment,
// fromProc) are checked against the events below.
function sampled({ resources, gcd, effects, log }) {
  const timed = (list) =>
    list.map(({ id, name, icon, remaining }) => ({
      id,
      name,
      icon,
      remaining,
    }));
  return {
    resources,
    gcd,
    effects: {
      buffs: timed(effects.buffs),
      debuffs: timed(effects.debuffs),
      cooldowns: timed(effects.cooldowns),
    },
    log: logRows(log),
  };
}

function logRows(log) {
  return log.map(({ fromProc, ...row }) => {
    assert.equal(typeof fromProc, "boolean");
    return row;
  });
}

// Every event, in order, for the checks the engine has no copy of.
function record(fight) {
  const events = [];
  fight.simulation.on("*", (event) => events.push(event));
  return events;
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
      "procs",
      "spend",
      "moment",
      "log",
    ]);
  });

  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`matches the engine at every frame of a ${name} fight`, () => {
      for (const seed of SEEDS) {
        const fight = createFight(seed, config());
        const feed = createLiveFeed(fight);
        assert.deepEqual(
          sampled(feed.read()),
          engineView(fight),
          "before a step",
        );
        let comboChanges = 0;
        let previousCombo = fight.rogue.comboPoints;
        frames(fight, 3000, (frame) => {
          const read = feed.read();
          assert.deepEqual(
            sampled(read),
            engineView(fight),
            `${seed} frame ${frame}`,
          );
          const auras = {
            ...fight.simulation.activeBuffs,
            ...fight.simulation.activeDebuffs,
          };
          for (const effect of [
            ...read.effects.buffs,
            ...read.effects.debuffs,
            ...read.effects.cooldowns,
          ]) {
            assert.ok(effect.remaining <= effect.duration, effect.id);
            assert.equal(effect.stacks, auras[effect.id]?.stacks ?? 1);
          }
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
    assert.deepEqual(logRows(feed.read().log), fight.simulation.combatLog);
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
      assert.deepEqual(logRows(feed.read().log), result.log, String(seed));
    }
  });

  it("keeps the newest rows when one frame brings more than the log holds", () => {
    const fight = createFight(1, defaultConfig());
    const feed = createLiveFeed(fight);
    fight.simulation.run(120);
    const { log } = feed.read();
    assert.equal(log.length, k("log.maxEvents"));
    assert.deepEqual(logRows(log), fight.simulation.combatLog);
    assert.ok(log[0].id > log[log.length - 1].id, "newest first");
  });

  it("subscribes to hit, resource, aura and proc events only", () => {
    const fight = createFight(1, defaultConfig());
    createLiveFeed(fight);
    const events = fight.simulation.events;
    for (const type of ["hit", "resource", "aura", "proc"]) {
      assert.ok(events.has(type), type);
    }
    for (const type of ["cast", "end"]) {
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

  it("an aura's duration is its seconds at the last apply, refresh or stack", () => {
    for (const seed of SEEDS) {
      const fight = createFight(seed, procConfig());
      const events = record(fight);
      const feed = createLiveFeed(fight);
      let seen = 0;
      frames(fight, 4000, () => {
        const read = feed.read();
        for (const effect of [...read.effects.buffs, ...read.effects.debuffs]) {
          const last = events.findLast(
            (event) => event.type === "aura" && event.aura === effect.id,
          );
          assert.notEqual(last.change, "expire", effect.id);
          // On the core an aura's seconds are its expiry less the time, so
          // they come back to within float error, not bit for bit.
          assert.ok(
            Math.abs(effect.duration - last.duration) < 1e-9,
            `${effect.id}: ${effect.duration} vs ${last.duration}`,
          );
          assert.equal(effect.stacks, last.stacks, effect.id);
          seen += 1;
        }
      });
      assert.ok(seen > 100, "auras were up");
      const stacked = events.some(
        (event) => event.type === "aura" && event.stacks > 1,
      );
      assert.ok(stacked, "Deadly Poison stacked");
    }
  });

  it("a cooldown's duration is the ability data's", () => {
    const fight = createFight(1, procConfig());
    const feed = createLiveFeed(fight);
    let seen = 0;
    frames(fight, 4000, () => {
      for (const effect of feed.read().effects.cooldowns) {
        const data = abilityCatalogue.get(effect.id).cooldown;
        assert.equal(effect.duration, Math.max(data, effect.remaining));
        assert.equal(cooldownOf(effect.id), data);
        seen += 1;
      }
    });
    assert.ok(seen > 100, "cooldowns ran");
    assert.equal(cooldownOf("main-hand"), undefined);
  });

  it("counts each proc by id, in the order each first fired, named from the data", () => {
    for (const seed of SEEDS) {
      const fight = createFight(seed, procConfig());
      const events = record(fight);
      const feed = createLiveFeed(fight);
      fight.simulation.run(300);
      const procs = events.filter((event) => event.type === "proc");
      const order = [...new Set(procs.map((event) => event.proc))];
      assert.deepEqual(
        feed.read().procs,
        order.map((id) => ({
          id,
          name: procName(id),
          count: procs.filter((event) => event.proc === id).length,
        })),
      );
      assert.ok(order.length >= 4, `${seed}: ${order}`);
    }
    assert.equal(procName("hack-and-slash"), "Hack and Slash");
    assert.equal(procName("ruthlessness"), "Ruthlessness");
    assert.equal(procName("relentless-strikes"), "Relentless Strikes");
    assert.equal(procName("deadly-poison.offHand"), "Deadly Poison");
    assert.equal(procName("instant-poison.mainHand"), "Instant Poison");
    assert.equal(procName("no-such-proc"), "no-such-proc");
  });

  it("marks the rows a proc made: a poison's hit, or the hit right after a proc", () => {
    const fight = createFight(4242, procConfig());
    const events = record(fight);
    const feed = createLiveFeed(fight);
    fight.simulation.run(60);
    const made = new Set();
    events.forEach((event, index) => {
      if (event.type !== "hit") {
        return;
      }
      const previous = events[index - 1];
      if (event.origin === "poison" || previous?.type === "proc") {
        made.add(event.id);
      }
    });
    const { log } = feed.read();
    for (const row of log) {
      assert.equal(row.fromProc, made.has(row.id), String(row.id));
    }
    assert.ok(log.some((row) => row.fromProc));
    const swing = events.findIndex(
      (event, index) =>
        event.type === "hit" &&
        event.origin === "white" &&
        events[index - 1]?.proc === "hack-and-slash",
    );
    assert.ok(swing > 0, "Hack and Slash gave a swing");
  });

  it("keeps the last combo point spend, named from the ability data", () => {
    const fight = createFight(1, procConfig());
    const events = record(fight);
    const feed = createLiveFeed(fight);
    assert.equal(feed.read().spend, null);
    frames(fight, 3000, () => {
      const spend = events.findLast(
        (event) =>
          event.type === "resource" &&
          event.resource === "comboPoints" &&
          event.change === "spend",
      );
      const read = feed.read().spend;
      if (spend === undefined) {
        assert.equal(read, null);
        return;
      }
      assert.deepEqual(read, {
        source: spend.source,
        name: abilityCatalogue.get(spend.source).name,
        before: spend.before,
        after: spend.after,
        time: spend.time,
      });
    });
    assert.ok(
      ["Eviscerate", "Slice and Dice"].includes(feed.read().spend.name),
    );
  });

  it("keeps the last buff that came up or went, counted", () => {
    const fight = createFight(1, procConfig());
    const events = record(fight);
    const feed = createLiveFeed(fight);
    assert.equal(feed.read().moment, null);
    fight.simulation.run(120);
    const moments = events.filter(
      (event) =>
        event.type === "aura" &&
        event.target === "self" &&
        (event.change === "apply" || event.change === "expire"),
    );
    const last = moments.at(-1);
    assert.deepEqual(feed.read().moment, {
      seq: moments.length,
      change: last.change,
      name: last.name,
    });
    assert.ok(
      events.some(
        (event) => event.type === "aura" && event.target === "target",
      ),
      "a debuff, which is not a moment",
    );
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
