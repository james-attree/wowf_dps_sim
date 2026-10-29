import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { AURAS } from "../js/auras.js";
import { BatchRunner, deriveSeed, runBatch } from "../js/batch-runner.js";
import { createFight } from "../js/fight.js";
import {
  BatchAuras,
  FightAuras,
  aurasFromEvents,
} from "../js/fight-metrics.js";
import { SimRunner } from "../js/sim-runner.js";
import { referenceBuild } from "./talentsforever.js";

// Issue #146 (S3): aura uptime. Most of these are contract tests: they read
// events and results, never an engine step, so they have to pass unchanged on
// the Phase 3.5 engine. The one exception is "agreement with the engine", which
// checks the event-based uptimes against the engine's own aura maps step by step.

const FIGHT = 30; // seconds per fight in these tests
const TALENTED = {
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
};
// Deadly Poison on both hands reaches full stacks, so full-stack time is tested
// on a real fight.
const DEADLY_BOTH = {
  talents: referenceBuild(),
  poisons: { mainHand: "deadly", offHand: "deadly" },
};
const ROUNDING = 1e-12;

function close(actual, expected, message) {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= ROUNDING * scale,
    `${message}: ${actual} vs ${expected}`,
  );
}

function observed(seed, config = TALENTED, duration = FIGHT) {
  const runner = new SimRunner({ seed, duration, config });
  const auras = new FightAuras();
  auras.attach(runner);
  const events = [];
  runner.on("*", (event) => events.push(event));
  runner.run();
  runner.advance(Infinity);
  return { result: runner.result, summary: auras.summary(), events };
}

function aura(time, id, change, stacks = 1, target = "self") {
  return {
    type: "aura",
    time,
    aura: id,
    name: `Name of ${id}`,
    target,
    change,
    stacks,
  };
}

function end(time) {
  return { type: "end", time };
}

function row(summary, id, target = "self") {
  return summary.rows.find((r) => r.id === id && r.target === target);
}

describe("one fight, hand-built", () => {
  it("counts the seconds between apply and expire, refreshes keep it up", () => {
    const summary = aurasFromEvents([
      aura(2, "slice-and-dice", "apply"),
      aura(5, "slice-and-dice", "refresh"),
      aura(12, "slice-and-dice", "expire", 1),
      aura(14, "slice-and-dice", "apply"),
      aura(16, "slice-and-dice", "expire"),
      end(20),
    ]);
    assert.equal(summary.duration, 20);
    assert.equal(summary.ended, true);
    assert.deepEqual(row(summary, "slice-and-dice"), {
      id: "slice-and-dice",
      target: "self",
      name: "Name of slice-and-dice",
      maxStacks: 1,
      applications: 2,
      refreshes: 1,
      uptime: 12,
      uptimeFraction: 0.6,
      stacks: null,
    });
  });

  it("counts an aura still up at the end up to the end, and one never down as the whole fight", () => {
    const summary = aurasFromEvents([
      aura(0, "blade-flurry", "apply"),
      aura(15, "adrenaline-rush", "apply"),
      end(20),
    ]);
    assert.equal(row(summary, "blade-flurry").uptime, 20);
    assert.equal(row(summary, "blade-flurry").uptimeFraction, 1);
    assert.equal(row(summary, "adrenaline-rush").uptime, 5);
    assert.equal(row(summary, "adrenaline-rush").uptimeFraction, 0.25);
  });

  it("weights the stacks by time, and times full stacks", () => {
    const id = "deadly-poison";
    const max = AURAS.deadlyPoison.maxStacks;
    assert.ok(max > 2, "Deadly Poison stacks");
    const events = [aura(0, id, "apply", 1, "target")];
    for (let stacks = 2; stacks <= max; stacks += 1) {
      events.push(aura(stacks - 1, id, "stack", stacks, "target"));
    }
    // Full stacks from max - 1 to 10, refreshed at 6, then down until 12, then
    // one stack from 12 to the end at 20.
    events.push(aura(6, id, "refresh", max, "target"));
    events.push(aura(10, id, "expire", max, "target"));
    events.push(aura(12, id, "apply", 1, "target"));
    events.push(end(20));
    const summary = aurasFromEvents(events);
    const poison = row(summary, id, "target");
    assert.equal(poison.maxStacks, max);
    assert.equal(poison.applications, 2);
    assert.equal(poison.refreshes, max - 1 + 1);
    assert.equal(poison.uptime, 18);
    assert.equal(poison.uptimeFraction, 18 / 20);
    // Seconds 0..max-1 at 1, 2, ..., max - 1 stacks, then max stacks to 10.
    const rising = ((max - 1) * max) / 2;
    const full = 10 - (max - 1);
    const stackSeconds = rising + full * max + 8;
    assert.deepEqual(poison.stacks, {
      stackSeconds,
      meanStacks: stackSeconds / 18,
      fullStackUptime: full,
      fullStackFraction: full / 20,
    });
  });

  it("counts full stacks still up at the end", () => {
    const summary = aurasFromEvents(
      [
        aura(0, "x", "apply", 1, "target"),
        aura(4, "x", "stack", 2, "target"),
        aura(6, "x", "stack", 3, "target"),
        end(10),
      ],
      { maxStacks: { x: 2 } },
    );
    assert.deepEqual(row(summary, "x", "target").stacks, {
      stackSeconds: 4 + 2 * 2 + 3 * 4,
      meanStacks: 20 / 10,
      fullStackUptime: 6,
      fullStackFraction: 0.6,
    });
  });

  it("keeps one row per side, sorted by id then side, whatever the order", () => {
    const summary = aurasFromEvents([
      aura(1, "b", "apply", 1, "target"),
      aura(2, "b", "apply", 1, "self"),
      aura(3, "a", "apply", 1, "target"),
      aura(4, "b", "expire", 1, "target"),
      end(5),
    ]);
    assert.deepEqual(
      summary.rows.map((r) => [r.id, r.target, r.uptime]),
      [
        ["a", "target", 2],
        ["b", "self", 3],
        ["b", "target", 3],
      ],
    );
    // An aura the definitions do not know has no stack limit and no stacks.
    assert.equal(summary.rows[0].maxStacks, null);
    assert.equal(summary.rows[0].stacks, null);
  });

  it("reads mid-fight up to the latest event, and other types move the clock", () => {
    const auras = new FightAuras();
    auras.observe(aura(1, "slice-and-dice", "apply"));
    auras.observe({ type: "hit", time: 4, damage: 1 });
    let summary = auras.summary();
    assert.equal(summary.ended, false);
    assert.equal(summary.duration, 4);
    assert.equal(row(summary, "slice-and-dice").uptime, 3);
    auras.observe(end(9));
    summary = auras.summary();
    assert.equal(summary.ended, true);
    assert.equal(row(summary, "slice-and-dice").uptime, 8);
  });

  it("ignores an expire for an aura that is not up, and gives an empty fight no rows", () => {
    const summary = aurasFromEvents([
      aura(3, "slice-and-dice", "expire"),
      end(6),
    ]);
    assert.equal(row(summary, "slice-and-dice").uptime, 0);
    assert.equal(row(summary, "slice-and-dice").applications, 0);
    assert.deepEqual(aurasFromEvents([]), {
      duration: 0,
      ended: false,
      rows: [],
    });
    const zero = aurasFromEvents([aura(0, "slice-and-dice", "apply"), end(0)]);
    assert.equal(row(zero, "slice-and-dice").uptimeFraction, 0);
  });

  it("gives meanStacks null to a stacking aura never up", () => {
    const summary = aurasFromEvents([
      aura(0, "deadly-poison", "apply", 1, "target"),
      aura(0, "deadly-poison", "expire", 1, "target"),
      end(4),
    ]);
    const poison = row(summary, "deadly-poison", "target");
    assert.equal(poison.uptime, 0);
    assert.equal(poison.stacks.meanStacks, null);
    assert.equal(poison.stacks.fullStackFraction, 0);
  });

  it("refuses what is not an event, events out of order and events after the end", () => {
    const auras = new FightAuras();
    for (const bad of [null, 1, "aura"]) {
      assert.throws(() => auras.observe(bad), TypeError, String(bad));
    }
    for (const time of [NaN, Infinity, undefined, "1"]) {
      assert.throws(
        () => auras.observe({ type: "aura", time }),
        RangeError,
        String(time),
      );
    }
    assert.throws(
      () => auras.observe({ ...aura(1, "x", "apply"), aura: 7 }),
      TypeError,
    );
    for (const stacks of [0, 1.5, undefined, -1]) {
      assert.throws(
        () => auras.observe({ ...aura(1, "x", "apply"), stacks }),
        RangeError,
        String(stacks),
      );
    }
    // An expire needs no stacks.
    auras.observe({ ...aura(2, "x", "expire"), stacks: undefined });
    assert.throws(() => auras.observe(aura(1, "x", "apply")), RangeError);
    auras.observe(end(3));
    assert.throws(() => auras.observe(aura(3, "x", "apply")), RangeError);
    assert.throws(() => auras.observe(end(3)), RangeError);
  });

  it("checks the maxStacks option", () => {
    assert.throws(() => new FightAuras({ maxStacks: null }), TypeError);
    assert.throws(() => new FightAuras({ maxStacks: 3 }), TypeError);
    for (const bad of [0, 1.5, "2", -1]) {
      assert.throws(
        () => new FightAuras({ maxStacks: { x: bad } }),
        RangeError,
        String(bad),
      );
    }
    // The option replaces the definitions.
    const summary = aurasFromEvents([aura(0, "slice-and-dice", "apply")], {
      maxStacks: {},
    });
    assert.equal(row(summary, "slice-and-dice").maxStacks, null);
  });

  it("returns fresh data on every call", () => {
    const auras = new FightAuras();
    auras.observe(aura(0, "deadly-poison", "apply", 2, "target"));
    const first = auras.summary();
    first.rows[0].stacks.stackSeconds = -1;
    first.rows.pop();
    assert.equal(auras.summary().rows.length, 1);
    assert.equal(auras.summary().rows[0].stacks.stackSeconds, 0);
  });
});

describe("one fight, more hand-built cases", () => {
  it("follows the stacks down as well as up", () => {
    const summary = aurasFromEvents(
      [
        aura(0, "x", "apply", 3, "target"),
        aura(2, "x", "refresh", 1, "target"),
        end(4),
      ],
      { maxStacks: { x: 3 } },
    );
    assert.deepEqual(row(summary, "x", "target").stacks, {
      stackSeconds: 3 * 2 + 1 * 2,
      meanStacks: 2,
      fullStackUptime: 2,
      fullStackFraction: 0.5,
    });
  });

  it("keeps its own copy of the maxStacks option", () => {
    const maxStacks = { x: 2 };
    const auras = new FightAuras({ maxStacks });
    maxStacks.x = 1;
    auras.observe(aura(0, "x", "apply", 1));
    assert.equal(auras.summary().rows[0].maxStacks, 2);
  });
});

describe("one fight, from a real fight", () => {
  it("agrees with the engine's own auras, step by step", () => {
    const dt = k("sim.fixedStep");
    let sawFullStacks = false;
    for (const [seed, config, duration] of [
      [107, TALENTED, 120],
      [3, DEADLY_BOTH, 120],
      [1, {}, 60],
    ]) {
      const { simulation } = createFight(seed, config);
      const auras = new FightAuras();
      auras.attach(simulation);
      const expected = new Map();
      const add = (key, field, value) => {
        const entry = expected.get(key) ?? {
          uptime: 0,
          stackSeconds: 0,
          full: 0,
        };
        entry[field] += value;
        expected.set(key, entry);
      };
      const steps = duration / dt;
      for (let step = 0; step < steps; step += 1) {
        // What is up at the start of a move is up for the whole move.
        for (const [map, side] of [
          [simulation.activeBuffs, "self"],
          [simulation.activeDebuffs, "target"],
        ]) {
          for (const [id, state] of Object.entries(map)) {
            const key = `${id}/${side}`;
            const stacks = state.stacks ?? 1;
            add(key, "uptime", dt);
            add(key, "stackSeconds", stacks * dt);
            if (stacks >= simulation.auraDefinitions.get(id).maxStacks) {
              add(key, "full", dt);
            }
          }
        }
        simulation.step(dt);
      }
      simulation.end();
      const summary = auras.summary();
      assert.equal(summary.duration, duration);
      assert.equal(summary.ended, true);
      const seen = new Set();
      for (const r of summary.rows) {
        const key = `${r.id}/${r.target}`;
        seen.add(key);
        const want = expected.get(key) ?? {
          uptime: 0,
          stackSeconds: 0,
          full: 0,
        };
        assert.equal(r.uptime, want.uptime, `${key} seed ${seed}`);
        if (r.stacks !== null) {
          assert.equal(r.stacks.stackSeconds, want.stackSeconds, key);
          assert.equal(r.stacks.fullStackUptime, want.full, key);
          sawFullStacks ||= r.stacks.fullStackUptime > 0;
        } else {
          assert.equal(want.full, want.uptime, key);
        }
      }
      for (const key of expected.keys()) {
        assert.ok(seen.has(key), `${key} seed ${seed} has a row`);
      }
    }
    assert.ok(sawFullStacks, "some fight reached full Deadly Poison stacks");
  });

  it("times Adrenaline Rush and Blade Flurry at their full duration", () => {
    const { summary } = observed(107, TALENTED, 60);
    for (const [id, duration] of [
      ["adrenaline-rush", k("adrenalineRush").duration],
      ["blade-flurry", k("bladeFlurry").duration],
    ]) {
      const r = row(summary, id);
      assert.equal(r.applications, 1, id);
      // At least its duration, and less than one stamp of the fixed-step
      // engine longer (docs/mechanics.md, "Stamping").
      assert.ok(r.uptime >= duration, `${id} ${r.uptime}`);
      assert.ok(r.uptime < duration + k("sim.fixedStep"), `${id} ${r.uptime}`);
    }
    assert.equal(summary.duration, 60);
  });

  it("clips an aura still up at the end to the fight", () => {
    const { summary, events } = observed(107, TALENTED, 10);
    const flurry = events.find(
      (event) => event.type === "aura" && event.aura === "blade-flurry",
    );
    assert.equal(flurry.change, "apply");
    const r = row(summary, "blade-flurry");
    assert.equal(r.uptime, 10 - flurry.time);
    assert.ok(r.uptimeFraction < 1);
    for (const each of summary.rows) {
      assert.ok(each.uptime <= summary.duration, each.id);
    }
  });

  it("gives the same summary from recorded events, the same fight twice, and changes nothing", () => {
    const first = observed(5);
    const again = observed(5);
    assert.deepEqual(first.summary, again.summary);
    assert.deepEqual(aurasFromEvents(first.events), first.summary);
    const plain = new SimRunner({ seed: 5, duration: FIGHT, config: TALENTED });
    plain.run();
    plain.advance(Infinity);
    assert.deepEqual(plain.result, first.result);
  });

  it("stops counting once unsubscribed", () => {
    const runner = new SimRunner({
      seed: 5,
      duration: FIGHT,
      config: TALENTED,
    });
    const auras = new FightAuras();
    const off = auras.attach(runner);
    runner.run();
    runner.advance(FIGHT / 2);
    off();
    const mid = auras.summary();
    assert.equal(mid.ended, false);
    assert.ok(mid.duration <= FIGHT / 2);
    runner.advance(Infinity);
    assert.deepEqual(auras.summary(), mid);
  });
});

describe("a batch of fights", () => {
  const a = aurasFromEvents([
    aura(0, "slice-and-dice", "apply"),
    aura(0, "deadly-poison", "apply", 2, "target"),
    end(10),
  ]);
  const b = aurasFromEvents([aura(5, "slice-and-dice", "apply"), end(10)]);
  const c = aurasFromEvents([aura(2, "blade-flurry", "apply"), end(10)]);

  it("sums the counts and seconds and pools the fractions", () => {
    const batch = new BatchAuras();
    for (const fight of [a, b]) {
      batch.add(fight);
    }
    const summary = batch.summary();
    assert.equal(summary.fights, 2);
    assert.equal(summary.duration, 20);
    const snd = row(summary, "slice-and-dice");
    assert.equal(snd.applications, 2);
    assert.equal(snd.uptime, 15);
    assert.equal(snd.uptimeFraction, 0.75);
    assert.equal(snd.stacks, null);
    assert.equal(snd.perFight.uptimeFraction.mean, 0.75);
    assert.equal(snd.perFight.uptimeFraction.min, 0.5);
    assert.equal(snd.perFight.uptimeFraction.max, 1);
    assert.equal(snd.perFight.fullStackFraction, undefined);
    const poison = row(summary, "deadly-poison", "target");
    assert.deepEqual(poison.stacks, {
      stackSeconds: 20,
      meanStacks: 2,
      fullStackUptime: 0,
      fullStackFraction: 0,
    });
    assert.equal(poison.uptimeFraction, 0.5);
    assert.equal(poison.perFight.uptimeFraction.count, 2);
    assert.equal(poison.perFight.uptimeFraction.min, 0);
    assert.equal(poison.perFight.fullStackFraction.count, 2);
  });

  it("pools over fights of different lengths, and sums refreshes and full stacks", () => {
    const long = aurasFromEvents(
      [
        aura(0, "x", "apply", 1, "target"),
        aura(1, "x", "stack", 2, "target"),
        aura(2, "x", "refresh", 2, "target"),
        end(30),
      ],
      { maxStacks: { x: 2 } },
    );
    const short = aurasFromEvents(
      [
        aura(0, "x", "apply", 2, "target"),
        aura(5, "x", "expire", 2, "target"),
        end(10),
      ],
      { maxStacks: { x: 2 } },
    );
    const batch = new BatchAuras();
    batch.add(long);
    batch.add(short);
    const x = row(batch.summary(), "x", "target");
    assert.equal(x.refreshes, 2);
    // Pooled: 35 s up of 40, not the mean of 1 and 0.5.
    assert.equal(x.uptimeFraction, 35 / 40);
    assert.equal(x.perFight.uptimeFraction.mean, 0.75);
    assert.deepEqual(x.stacks, {
      stackSeconds: 1 + 29 * 2 + 5 * 2,
      meanStacks: (1 + 29 * 2 + 5 * 2) / 35,
      fullStackUptime: 29 + 5,
      fullStackFraction: 34 / 40,
    });
  });

  it("gives meanStacks null to a stacking aura never up in the batch", () => {
    const batch = new BatchAuras();
    batch.add(
      aurasFromEvents([
        aura(1, "deadly-poison", "apply", 1, "target"),
        aura(1, "deadly-poison", "expire", 1, "target"),
        end(2),
      ]),
    );
    const poison = row(batch.summary(), "deadly-poison", "target");
    assert.equal(poison.uptime, 0);
    assert.equal(poison.stacks.meanStacks, null);
  });

  it("counts a fight without the row as zero, before and after it appears", () => {
    const batch = new BatchAuras();
    for (const fight of [a, c, b]) {
      batch.add(fight);
    }
    const flurry = row(batch.summary(), "blade-flurry");
    assert.equal(flurry.perFight.uptimeFraction.count, 3);
    close(flurry.perFight.uptimeFraction.mean, 0.8 / 3, "mean");
    assert.equal(flurry.perFight.uptimeFraction.min, 0);
    assert.equal(flurry.perFight.uptimeFraction.max, 0.8);
  });

  it("depends on the fights, not on when a row first showed up", () => {
    const one = new BatchAuras();
    const two = new BatchAuras();
    for (const fight of [c, a, b]) {
      one.add(fight);
    }
    two.add(c);
    two.add({ ...a, rows: [...a.rows].reverse() });
    two.add(b);
    assert.deepEqual(one.summary(), two.summary());
  });

  it("matches the fight for a batch of one", () => {
    const batch = new BatchAuras();
    batch.add(a);
    const summary = batch.summary();
    for (const fightRow of a.rows) {
      const { perFight, ...rest } = row(summary, fightRow.id, fightRow.target);
      assert.deepEqual(rest, fightRow);
      assert.equal(perFight.uptimeFraction.mean, fightRow.uptimeFraction);
    }
  });

  it("adds the seconds with compensated sums", () => {
    const batch = new BatchAuras();
    for (const uptime of [1e16, 1, 1]) {
      batch.add({
        duration: 1e16,
        ended: true,
        rows: [
          {
            id: "x",
            target: "self",
            name: "x",
            maxStacks: 1,
            applications: 1,
            refreshes: 0,
            uptime,
            uptimeFraction: 0,
            stacks: null,
          },
        ],
      });
    }
    assert.equal(row(batch.summary(), "x").uptime, 1e16 + 2);
  });

  it("is empty with no fights, and gives fresh data on every call", () => {
    const batch = new BatchAuras();
    assert.deepEqual(batch.summary(), { fights: 0, duration: 0, rows: [] });
    batch.add(a);
    assert.equal(batch.fights, 1);
    const first = batch.summary();
    first.rows.pop();
    assert.equal(batch.summary().rows.length, 2);
    const zero = new BatchAuras();
    zero.add(aurasFromEvents([aura(0, "slice-and-dice", "apply"), end(0)]));
    assert.equal(row(zero.summary(), "slice-and-dice").uptimeFraction, 0);
  });

  it("refuses what is not a fight summary", () => {
    const batch = new BatchAuras();
    for (const bad of [
      null,
      1,
      {},
      { duration: 1 },
      { rows: [] },
      { rows: [], duration: NaN },
      { rows: [], duration: -1 },
      { rows: [], duration: "1" },
      { rows: {}, duration: 1 },
    ]) {
      assert.throws(() => batch.add(bad), TypeError, JSON.stringify(bad));
    }
    assert.equal(batch.fights, 0);
  });
});

describe("the batch runner's auras", () => {
  const ITERATIONS = 5;
  const options = {
    seed: 11,
    iterations: ITERATIONS,
    duration: FIGHT,
    config: TALENTED,
  };

  it("is the auras of each iteration's fight, added in index order", () => {
    const result = runBatch(options);
    const expected = new BatchAuras();
    for (let index = 0; index < ITERATIONS; index += 1) {
      expected.add(observed(deriveSeed(options.seed, index)).summary);
    }
    assert.deepEqual(result.auras, expected.summary());
    assert.equal(result.auras.fights, result.completed);
    close(result.auras.duration, ITERATIONS * FIGHT, "duration");
    assert.ok(row(result.auras, "slice-and-dice").uptime > 0);
  });

  it("does not depend on how the iterations are sliced", () => {
    const whole = runBatch(options).auras;
    for (const sizes of [[1], [2], [4, 1], [3, Infinity]]) {
      const runner = new BatchRunner(options);
      runner.run();
      let turn = 0;
      while (runner.state === "running") {
        runner.advance(sizes[turn % sizes.length]);
        turn += 1;
      }
      assert.deepEqual(runner.result.auras, whole, JSON.stringify(sizes));
    }
  });

  it("covers the completed iterations of a cancelled batch, and starts again on a repeat run", () => {
    const runner = new BatchRunner(options);
    runner.run();
    runner.advance(2);
    runner.cancel();
    assert.equal(runner.result.auras.fights, 2);
    const expected = new BatchAuras();
    for (let index = 0; index < 2; index += 1) {
      expected.add(observed(deriveSeed(options.seed, index)).summary);
    }
    assert.deepEqual(runner.result.auras, expected.summary());
    runner.run();
    runner.advance(Infinity);
    assert.deepEqual(runner.result.auras, runBatch(options).auras);
  });

  it("is plain data with no step or frame in its keys", () => {
    const { auras } = runBatch({ ...options, config: DEADLY_BOTH });
    assert.deepEqual(JSON.parse(JSON.stringify(auras)), auras);
    assert.deepEqual(Object.keys(auras), ["fights", "duration", "rows"]);
    const poison = row(auras, "deadly-poison", "target");
    assert.deepEqual(Object.keys(poison), [
      "id",
      "target",
      "name",
      "maxStacks",
      "applications",
      "refreshes",
      "uptime",
      "uptimeFraction",
      "stacks",
      "perFight",
    ]);
    assert.deepEqual(Object.keys(poison.stacks), [
      "stackSeconds",
      "meanStacks",
      "fullStackUptime",
      "fullStackFraction",
    ]);
    assert.deepEqual(Object.keys(poison.perFight), [
      "uptimeFraction",
      "fullStackFraction",
    ]);
    const keys = new Set();
    const walk = (value) => {
      if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(auras);
    assert.doesNotMatch([...keys].join(" "), /step|frame/i);
  });
});

describe("purity", () => {
  it("imports only the aura data and the statistics, and reads no clock, randomness or engine", async () => {
    const file = "../js/fight-metrics.js";
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(imports, ["./auras.js", "./running-stats.js"]);
    for (const banned of [
      /\bDate\b/,
      /performance\./,
      /Math\.random/,
      /setTimeout/,
      /\bPromise\b/,
      /\.simulation\b/,
      /activeBuffs|activeDebuffs/,
      /createFight|runFight|fightResult/,
      /\bstep\b|\bframe\b/i,
    ]) {
      assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), banned, `${banned}`);
    }
  });
});
