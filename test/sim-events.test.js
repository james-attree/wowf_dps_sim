import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { SIM_EVENT_TYPES } from "../js/event-stream.js";
import { createFight, fightResult, runFight } from "../js/fight.js";
import { SimRunner } from "../js/sim-runner.js";
import { referenceBuild } from "./talentsforever.js";

// Issue #137 (P3-2, E7-lite). The contract tests for the event stream of a
// fight, and of the SimRunner that carries it. They read events, results and
// rng draws, and never a step: Phase 3.5 replaces the engine core behind the
// same `sim.on` and these tests have to pass on it unchanged.

const SHORT = 20;
const LONG = 300;
const TALENTED = {
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
};
// Seeds, lengths and configs for the "several seeds" criteria.
const CASES = [
  { seed: 1, duration: SHORT },
  { seed: 2, duration: 7.77 },
  { seed: 107, duration: 60, config: TALENTED },
  { seed: 12345, duration: LONG },
  { seed: 99, duration: 31.4159, config: TALENTED },
];

const NUMBER = "number";
const STRING = "string";
const BOOLEAN = "boolean";
// The documented fields of each event, in order, with their kinds. A kind
// "string?" or "number?" may also be null. docs/events.md has the same table.
const SHAPES = {
  cast: {
    type: STRING,
    time: NUMBER,
    ability: STRING,
    name: STRING,
    icon: "string?",
    resource: "string?",
    cost: NUMBER,
    onGcd: BOOLEAN,
  },
  hit: {
    type: STRING,
    time: NUMBER,
    id: NUMBER,
    ability: "string?",
    name: STRING,
    icon: "string?",
    origin: STRING,
    attack: STRING,
    outcome: STRING,
    status: STRING,
    damage: NUMBER,
  },
  resource: {
    type: STRING,
    time: NUMBER,
    resource: STRING,
    change: STRING,
    before: NUMBER,
    after: NUMBER,
    source: "string?",
  },
  aura: {
    type: STRING,
    time: NUMBER,
    aura: STRING,
    name: STRING,
    target: STRING,
    change: STRING,
    stacks: NUMBER,
    duration: NUMBER,
    charges: "number?",
    source: "string?",
    reason: "string?",
  },
  proc: {
    type: STRING,
    time: NUMBER,
    proc: STRING,
    trigger: STRING,
    ability: STRING,
  },
  end: {
    type: STRING,
    time: NUMBER,
    totalDamage: NUMBER,
    dps: NUMBER,
  },
};
const ORIGINS = ["white", "yellow", "poison", "dot"];
const OUTCOMES = [
  "hit",
  "crit",
  "glancing",
  "miss",
  "dodge",
  "parry",
  "block",
  "cast",
];
const RESOURCE_CHANGES = ["gain", "spend", "expire", "clear"];
const AURA_CHANGES = ["apply", "refresh", "stack", "expire"];
const AURA_TARGETS = ["self", "target"];
const EXPIRE_REASONS = ["time", "charges"];

function checkShape(event) {
  const shape = SHAPES[event.type];
  assert.ok(shape, `unknown event type ${event.type}`);
  assert.deepEqual(Object.keys(event), Object.keys(shape), event.type);
  for (const [field, kind] of Object.entries(shape)) {
    const value = event[field];
    if (kind.endsWith("?") && value === null) {
      continue;
    }
    assert.equal(typeof value, kind.replace("?", ""), `${event.type}.${field}`);
    if (kind === NUMBER) {
      assert.ok(Number.isFinite(value), `${event.type}.${field} is finite`);
    }
  }
  assert.ok(Object.isFrozen(event), `${event.type} is frozen`);
  assert.equal(
    JSON.stringify(JSON.parse(JSON.stringify(event))),
    JSON.stringify(event),
  );
}

// Run a whole fight with a wildcard subscriber and return the events.
function eventsOf({ seed, duration, config }) {
  const fight = createFight(seed, config);
  const events = [];
  fight.simulation.on("*", (event) => events.push(event));
  fight.simulation.run(duration);
  return { events, fight };
}

// Run a fight with its rng counted. Returns what the rng gave, the result,
// and the log the result carries.
function countedFight({ seed, duration, config }, subscribe) {
  const fight = createFight(seed, config);
  const { simulation } = fight;
  const source = simulation.rng;
  const values = [];
  simulation.rng = () => {
    const value = source();
    values.push(value);
    return value;
  };
  simulation.rogue.rng = simulation.rng;
  subscribe?.(simulation);
  simulation.run(duration);
  return { values, result: fightResult(fight) };
}

afterEach(() => {
  mock.restoreAll();
});

describe("every event type, with its documented payload", () => {
  const seen = new Map();
  const all = [];
  for (const options of CASES) {
    all.push(...eventsOf(options).events);
  }
  for (const event of all) {
    seen.set(event.type, (seen.get(event.type) ?? 0) + 1);
  }

  it("emits all six types over the cases", () => {
    assert.deepEqual([...seen.keys()].sort(), [...SIM_EVENT_TYPES].sort());
  });

  for (const type of SIM_EVENT_TYPES) {
    it(`gives every ${type} event exactly its documented fields, frozen, as plain data`, () => {
      const ofType = all.filter((event) => event.type === type);
      assert.ok(ofType.length > 0);
      for (const event of ofType) {
        checkShape(event);
      }
    });
  }

  it("keeps the vocabularies of the enumerated fields", () => {
    const values = (type, field) => [
      ...new Set(all.filter((e) => e.type === type).map((e) => e[field])),
    ];
    for (const origin of values("hit", "origin")) {
      assert.ok(ORIGINS.includes(origin), origin);
    }
    for (const outcome of values("hit", "outcome")) {
      assert.ok(OUTCOMES.includes(outcome), outcome);
    }
    for (const change of values("resource", "change")) {
      assert.ok(RESOURCE_CHANGES.includes(change), change);
    }
    for (const change of values("aura", "change")) {
      assert.ok(AURA_CHANGES.includes(change), change);
    }
    for (const target of values("aura", "target")) {
      assert.ok(AURA_TARGETS.includes(target), target);
    }
    for (const reason of values("aura", "reason")) {
      assert.ok(reason === null || EXPIRE_REASONS.includes(reason), reason);
    }
  });

  it("shows white, yellow, poison and DoT hits", () => {
    assert.deepEqual(
      [
        ...new Set(all.filter((e) => e.type === "hit").map((e) => e.origin)),
      ].sort(),
      [...ORIGINS].sort(),
    );
  });

  it("shows an aura applied, refreshed, stacked and expired, on self and target", () => {
    const auras = all.filter((event) => event.type === "aura");
    const has = (test) => auras.some(test);
    for (const change of AURA_CHANGES) {
      assert.ok(
        has((event) => event.change === change),
        change,
      );
    }
    for (const target of AURA_TARGETS) {
      assert.ok(
        has((event) => event.target === target),
        target,
      );
    }
    for (const reason of EXPIRE_REASONS) {
      assert.ok(
        has((event) => event.reason === reason),
        reason,
      );
    }
  });

  it("shows energy and combo points gained and spent", () => {
    const resources = all.filter((event) => event.type === "resource");
    for (const resource of ["energy", "comboPoints"]) {
      for (const change of ["gain", "spend"]) {
        assert.ok(
          resources.some((e) => e.resource === resource && e.change === change),
          `${resource} ${change}`,
        );
      }
    }
  });

  it("states aura facts by change: stacks and the reason an aura ended", () => {
    for (const event of all.filter((e) => e.type === "aura")) {
      assert.equal(event.reason !== null, event.change === "expire");
      assert.equal(event.source === null, event.change === "expire");
      assert.ok(event.stacks >= 1);
    }
    const stack = all.find((e) => e.type === "aura" && e.change === "stack");
    assert.ok(stack.stacks > 1);
  });

  it("reports resource changes that really moved the pool", () => {
    for (const event of all.filter((e) => e.type === "resource")) {
      assert.notEqual(event.before, event.after);
      if (event.change === "spend" || event.change === "expire") {
        assert.ok(event.after < event.before);
      }
    }
  });

  it("puts each cast before the spend it caused, and names what spent", () => {
    for (let index = 0; index < all.length; index += 1) {
      const event = all[index];
      if (event.type !== "cast" || event.cost === 0) {
        continue;
      }
      const next = all[index + 1];
      assert.equal(next.type, "resource");
      assert.equal(next.change, "spend");
      assert.equal(next.resource, event.resource);
      assert.equal(next.source, event.ability);
      assert.equal(next.time, event.time);
      assert.equal(next.before - next.after, event.cost);
    }
  });

  it("delivers events in fight-time order and stamps proc events with the trigger", () => {
    for (let index = 1; index < all.length; index += 1) {
      if (all[index].type === "end") {
        continue;
      }
      // Events of one fight are in order of time; a new fight starts at 0.
      const previous = all[index - 1];
      if (previous.type !== "end" && all[index].time < previous.time) {
        assert.fail(
          `${all[index].type} at ${all[index].time} after ${previous.time}`,
        );
      }
    }
    const procs = all.filter((event) => event.type === "proc");
    assert.ok(procs.length > 0);
    for (const event of procs) {
      assert.match(event.trigger, /^on[A-Z]/);
    }
  });

  it("names nothing a step or a frame is in", () => {
    const names = new Set();
    for (const event of all) {
      for (const field of Object.keys(event)) {
        names.add(field);
      }
    }
    for (const name of [...names, ...SIM_EVENT_TYPES]) {
      assert.doesNotMatch(name, /step|frame/i);
    }
  });
});

describe("the resource events that fights seldom make", () => {
  it("reports a gift of combo points running out, with no source", () => {
    const fight = createFight(1);
    const { simulation } = fight;
    const events = [];
    simulation.on("resource", (event) => {
      if (event.resource === "comboPoints") {
        events.push(event);
      }
    });
    const points = simulation.rogue.resources.comboPoints;
    points.gain(2, "gift");
    points.armExpiry(2, 1);
    simulation.step(2);
    assert.deepEqual(
      events.map(({ change, before, after, source }) => [
        change,
        before,
        after,
        source,
      ]),
      [
        ["gain", 0, 2, "gift"],
        ["expire", 2, 0, null],
      ],
    );
  });

  it("reports a pool cleared by a new target, and nothing for an empty one", () => {
    const { simulation } = createFight(1);
    const events = [];
    simulation.on("resource", (event) => events.push(event));
    const points = simulation.rogue.resources.comboPoints;
    points.targetChanged();
    assert.deepEqual(events, []);
    points.gain(3);
    points.targetChanged();
    assert.deepEqual(
      events.map(({ change, before, after }) => [change, before, after]),
      [
        ["gain", 0, 3],
        ["clear", 3, 0],
      ],
    );
  });

  it("does not report regeneration", () => {
    const { simulation } = createFight(1);
    const events = [];
    simulation.on("resource", (event) => events.push(event));
    simulation.rogue.resources.energy.value = 0;
    simulation.step(1);
    assert.ok(simulation.rogue.resources.energy.value > 0);
    assert.deepEqual(events, []);
  });
});

describe("what the stream is not allowed to change", () => {
  for (const options of CASES) {
    const label = `seed ${options.seed}, ${options.duration} s`;

    it(`gives the same result, log and rng draws with and without subscribers (${label})`, () => {
      const plain = countedFight(options);
      const watched = countedFight(options, (simulation) => {
        simulation.on("*", () => {});
        for (const type of SIM_EVENT_TYPES) {
          simulation.on(type, () => {});
        }
      });
      assert.ok(plain.values.length > 0);
      assert.deepEqual(watched.values, plain.values);
      assert.deepEqual(watched.result, plain.result);
      assert.deepEqual(plain.result, runFight(options));
    });

    it(`gives the same fight when every handler throws (${label})`, () => {
      const plain = countedFight(options);
      const hostile = countedFight(options, (simulation) => {
        simulation.onError(() => {});
        simulation.on("*", () => {
          throw new Error("hostile");
        });
      });
      assert.deepEqual(hostile.values, plain.values);
      assert.deepEqual(hostile.result, plain.result);
    });

    it(`makes the hit events add up to totalDamage (${label})`, () => {
      const { events, fight } = eventsOf(options);
      const hits = events.filter((event) => event.type === "hit");
      const total = hits.reduce((sum, event) => sum + event.damage, 0);
      assert.equal(total, fight.simulation.damageDone);
      assert.equal(total, fightResult(fight).totalDamage);
      const end = events.at(-1);
      assert.equal(end.type, "end");
      assert.equal(end.totalDamage, total);
    });

    it(`gives an event stream that is the same every time (${label})`, () => {
      assert.deepEqual(eventsOf(options).events, eventsOf(options).events);
    });
  }

  it("builds no event for a type nobody subscribed to", () => {
    const fight = createFight(1);
    const built = [];
    const publish = fight.simulation.publish.bind(fight.simulation);
    fight.simulation.publish = (type, fields) => {
      built.push(type);
      return publish(type, fields);
    };
    fight.simulation.run(SHORT);
    // The combat log is the one subscriber a fight has of its own.
    assert.deepEqual([...new Set(built)], ["hit"]);
    built.length = 0;
    const watched = createFight(1, TALENTED);
    watched.simulation.on("proc", () => {});
    const publishWatched = watched.simulation.publish.bind(watched.simulation);
    watched.simulation.publish = (type, fields) => {
      built.push(type);
      return publishWatched(type, fields);
    };
    watched.simulation.run(SHORT);
    assert.deepEqual([...new Set(built)].sort(), ["hit", "proc"]);
  });

  it("stops building events once the subscriber unsubscribes", () => {
    const { simulation } = createFight(1);
    const seen = [];
    const off = simulation.on("cast", (event) => seen.push(event));
    simulation.run(SHORT / 2);
    const before = seen.length;
    assert.ok(before > 0);
    off();
    simulation.step(SHORT);
    assert.equal(seen.length, before);
  });
});

describe("the end event", () => {
  it("comes once, at the fight duration, with the summary", () => {
    const { events, fight } = eventsOf({ seed: 5, duration: 11.5 });
    const ends = events.filter((event) => event.type === "end");
    assert.equal(ends.length, 1);
    assert.equal(ends[0], events.at(-1));
    const result = fightResult(fight);
    assert.equal(ends[0].time, result.duration);
    assert.equal(ends[0].totalDamage, result.totalDamage);
    assert.equal(ends[0].dps, result.dps);
  });

  it("is not repeated by a second end()", () => {
    const { events, fight } = eventsOf({ seed: 5, duration: 3 });
    fight.simulation.end();
    assert.equal(events.filter((event) => event.type === "end").length, 1);
  });

  it("has a dps of 0 for a fight with no length", () => {
    const { events } = eventsOf({ seed: 5, duration: 0 });
    const end = events.at(-1);
    assert.equal(end.type, "end");
    assert.equal(end.time, 0);
    assert.equal(end.dps, 0);
  });
});

describe("the combat log ring", () => {
  const MAX = k("log.maxEvents");

  it("holds at most k(log.maxEvents) rows and keeps the newest", () => {
    const { events, fight } = eventsOf({ seed: 12345, duration: LONG });
    const hits = events.filter((event) => event.type === "hit");
    assert.ok(hits.length > MAX * 2, "the fight must overflow the ring");
    const { log } = fightResult(fight);
    assert.equal(log.length, MAX);
    assert.equal(fight.simulation.log.length, MAX);
    assert.equal(fight.simulation.log.capacity, MAX);
    // Newest first, and exactly the last MAX hits, row by row.
    const newest = hits.slice(-MAX).reverse();
    assert.deepEqual(
      log.map((row) => row.id),
      newest.map((event) => event.id),
    );
    assert.deepEqual(
      log.map((row) => row.time),
      newest.map((event) => event.time),
    );
    assert.equal(log[0].id, hits.length - 1);
    assert.equal(log.at(-1).id, hits.length - MAX);
  });

  it("is a view of the stream: each row is its hit event's name, damage and status", () => {
    const { events, fight } = eventsOf({
      seed: 107,
      duration: 60,
      config: TALENTED,
    });
    const hits = events.filter((event) => event.type === "hit");
    const log = fight.simulation.combatLog;
    for (const [index, row] of log.entries()) {
      const hit = hits[hits.length - 1 - index];
      assert.equal(row.id, hit.id);
      assert.equal(row.name, hit.name);
      assert.equal(row.type, hit.attack);
      assert.equal(row.damage, hit.damage);
      assert.equal(row.status, hit.status);
      assert.equal(row.icon, hit.icon);
    }
  });

  it("lets a handler read the log row of the hit it is told about", () => {
    const { simulation } = createFight(1);
    const checked = [];
    simulation.on("hit", (event) => {
      checked.push(simulation.combatLog[0].id === event.id);
    });
    simulation.run(SHORT);
    assert.ok(checked.length > 0);
    assert.ok(checked.every(Boolean));
  });

  it("does not grow while a fight goes on", () => {
    const { simulation } = createFight(12345);
    let longest = 0;
    for (let second = 0; second < LONG; second += 10) {
      simulation.step(10);
      longest = Math.max(longest, simulation.combatLog.length);
    }
    assert.equal(longest, MAX);
  });
});

describe("a handler that throws, or that touches the fight, in a Simulation", () => {
  it("is reported to onError with the event, and the others still hear it", () => {
    const { simulation } = createFight(1);
    const told = [];
    const heard = [];
    simulation.onError((info) => told.push(info));
    simulation.on("cast", () => {
      throw new Error("handler broke");
    });
    simulation.on("cast", (event) => heard.push(event));
    simulation.run(SHORT);
    assert.ok(heard.length > 0);
    assert.equal(told.length, heard.length);
    assert.equal(told[0].type, "cast");
    assert.equal(told[0].event, heard[0]);
    assert.equal(told[0].error.message, "handler broke");
  });

  it("delivers in order to every handler when one of them subscribes or unsubscribes mid-fight", () => {
    const { simulation } = createFight(1);
    const first = [];
    const second = [];
    simulation.on("*", (event) => {
      first.push(event);
      if (first.length === 3) {
        simulation.on("*", (late) => second.push(late));
      }
    });
    simulation.run(SHORT);
    assert.equal(second[0], first[3]);
    assert.deepEqual(second, first.slice(3));
  });
});

describe("SimRunner.on", () => {
  function runner(options) {
    return new SimRunner({ seed: 1, duration: SHORT, ...options });
  }

  function finish(target, chunk = Infinity) {
    let calls = 0;
    while (target.state === "running") {
      target.advance(chunk);
      calls += 1;
      assert.ok(calls < 1e6, "the runner never finished");
    }
  }

  it("delivers the events the engine makes for the same seed, whatever size the time comes in", () => {
    for (const chunk of [Infinity, 1, 0.1, 0.003]) {
      const target = runner({ seed: 107, duration: 8, config: TALENTED });
      const events = [];
      target.on("*", (event) => events.push(event));
      target.run();
      finish(target, chunk);
      const reference = eventsOf({
        seed: 107,
        duration: 8,
        config: TALENTED,
      }).events;
      assert.deepEqual(events, reference, `chunk ${chunk}`);
    }
  });

  it("keeps a subscription for every run, and ends each run with one end event", () => {
    const target = runner({ duration: 5 });
    const seen = [];
    target.on("*", (event) => seen.push(event));
    target.run();
    finish(target);
    const firstRun = seen.splice(0);
    target.run();
    finish(target);
    assert.deepEqual(seen, firstRun);
    assert.equal(seen.filter((event) => event.type === "end").length, 1);
  });

  it("subscribes by type, with a wildcard, and unsubscribes", () => {
    const target = runner();
    const casts = [];
    const every = [];
    const off = target.on("cast", (event) => casts.push(event));
    target.on("*", (event) => every.push(event));
    target.run();
    target.advance(5);
    const heard = casts.length;
    assert.ok(heard > 0);
    assert.ok(casts.every((event) => event.type === "cast"));
    assert.ok(every.some((event) => event.type === "hit"));
    off();
    target.advance(5);
    assert.equal(casts.length, heard);
  });

  it("rejects an unknown type and a handler that is not a function", () => {
    const target = runner();
    assert.throws(() => target.on("step", () => {}), {
      name: "RangeError",
      message: /Known: cast, hit, resource, aura, proc, end/,
    });
    assert.throws(() => target.on("cast"), TypeError);
    assert.throws(() => target.onError(null), TypeError);
  });

  it("sends the end event before the move to finished, and the result is ready then", () => {
    const target = runner();
    const order = [];
    target.on("end", () => order.push(["end", target.state, target.result]));
    target.onStateChange(({ to }) => order.push([to, target.result !== null]));
    target.run();
    finish(target);
    assert.deepEqual(
      order.map(([what]) => what),
      ["running", "end", "finished"],
    );
    assert.equal(order[1][1], "running");
    assert.equal(order[1][2], null);
    assert.equal(order[2][1], true);
  });

  it("gives a fight with no length its end event as it starts", () => {
    const target = runner({ duration: 0 });
    const types = [];
    target.on("*", (event) => types.push(event.type));
    target.run();
    assert.equal(target.state, "finished");
    assert.deepEqual(types, ["end"]);
  });

  it("gives the same result with subscribers, throwing ones included", () => {
    const reference = runFight({ seed: 1, duration: SHORT });
    const target = runner();
    target.onError(() => {});
    target.on("*", () => {
      throw new Error("hostile");
    });
    target.run();
    finish(target);
    assert.deepEqual(target.result, reference);
  });

  it("does not repeat or lose events when time is spread over a pause", () => {
    const reference = eventsOf({ seed: 1, duration: SHORT }).events;
    const target = runner();
    const events = [];
    target.on("*", (event) => events.push(event));
    target.run();
    target.advance(3);
    target.pause();
    target.advance(100);
    assert.equal(target.state, "paused");
    target.resume();
    finish(target);
    assert.deepEqual(events, reference);
  });

  it("does not pass on events of a fight that was stopped", () => {
    const target = runner();
    const events = [];
    target.on("*", (event) => events.push(event));
    target.run();
    target.advance(4);
    target.stop();
    const stoppedAt = events.length;
    target.advance(100);
    assert.equal(events.length, stoppedAt);
    target.run();
    finish(target);
    assert.deepEqual(
      events.slice(stoppedAt),
      eventsOf({ seed: 1, duration: SHORT }).events,
    );
  });
});

describe("a handler that calls the runner during an event", () => {
  function runner(options) {
    return new SimRunner({ seed: 1, duration: SHORT, ...options });
  }

  function finish(target) {
    let calls = 0;
    while (target.state === "running") {
      target.advance(Infinity);
      calls += 1;
      assert.ok(calls < 1e6, "the runner never finished");
    }
  }

  const reference = runFight({ seed: 1, duration: SHORT });

  // Pause from the nth hit, then resume from the outside.
  for (const nth of [1, 2, 7, 30]) {
    it(`pauses at hit ${nth} and resumes to the same result and events`, () => {
      const target = runner();
      const events = [];
      let hits = 0;
      let paused = false;
      target.on("*", (event) => events.push(event));
      target.on("hit", () => {
        hits += 1;
        if (hits === nth && !paused) {
          paused = true;
          target.pause();
        }
      });
      target.run();
      target.advance(Infinity);
      assert.equal(target.state, "paused");
      const timeAtPause = target.time;
      assert.ok(timeAtPause < SHORT);
      target.advance(5);
      assert.equal(target.time, timeAtPause, "paused: time given is dropped");
      target.resume();
      finish(target);
      assert.deepEqual(target.result, reference);
      assert.deepEqual(events, eventsOf({ seed: 1, duration: SHORT }).events);
    });
  }

  it("stops from a hit handler: idle, no more events, and the next run is the same fight", () => {
    const target = runner();
    const events = [];
    let stopped = false;
    target.on("*", (event) => events.push(event));
    target.on("hit", () => {
      if (!stopped && events.length > 5) {
        stopped = true;
        target.stop();
      }
    });
    target.run();
    target.advance(Infinity);
    assert.equal(target.state, "idle");
    assert.equal(target.time, 0);
    assert.equal(target.result, null);
    const count = events.length;
    target.advance(Infinity);
    assert.equal(events.length, count);
    target.run();
    finish(target);
    assert.deepEqual(target.result, reference);
    assert.deepEqual(
      events.slice(count),
      eventsOf({ seed: 1, duration: SHORT }).events,
    );
  });

  it("stops and runs again from a hit handler: the new fight is whole, the old one is dropped", () => {
    const target = runner();
    const events = [];
    let again = false;
    target.on("*", (event) => events.push(event));
    target.on("hit", () => {
      if (!again && events.length > 5) {
        again = true;
        events.length = 0;
        target.stop();
        target.run();
      }
    });
    target.run();
    target.advance(Infinity);
    finish(target);
    assert.equal(target.state, "finished");
    assert.deepEqual(target.result, reference);
    assert.deepEqual(events, eventsOf({ seed: 1, duration: SHORT }).events);
  });

  it("drops what is left of the old fight's move when a cast handler stops and runs again", () => {
    const target = runner();
    const events = [];
    let again = false;
    target.on("*", (event) => events.push(event));
    target.on("cast", () => {
      if (!again) {
        again = true;
        events.length = 0;
        target.stop();
        target.run();
      }
    });
    target.run();
    target.advance(Infinity);
    finish(target);
    assert.deepEqual(target.result, reference);
    assert.deepEqual(events, eventsOf({ seed: 1, duration: SHORT }).events);
  });

  it("leaves time given from a handler after stop and run to the new fight, not the old one", () => {
    const target = runner();
    let again = false;
    target.on("hit", () => {
      if (!again) {
        again = true;
        target.stop();
        target.run();
        target.advance(Infinity);
      }
    });
    target.run();
    target.advance(Infinity);
    assert.equal(target.state, "running");
    finish(target);
    assert.deepEqual(target.result, reference);
  });

  it("spends time given from inside a handler once, in the call that is running", () => {
    const target = runner();
    let given = 0;
    target.on("hit", () => {
      if (given < 3) {
        given += 1;
        assert.equal(target.advance(Infinity), "running");
      }
    });
    target.run();
    finish(target);
    assert.equal(given, 3);
    assert.deepEqual(target.result, reference);
  });

  it("pauses from the end event: the fight finishes when it is resumed, with one end", () => {
    const target = runner();
    const ends = [];
    const changes = [];
    target.onStateChange(({ from, to }) => changes.push(`${from}>${to}`));
    target.on("end", (event) => {
      ends.push(event);
      if (ends.length === 1) {
        target.pause();
      }
    });
    target.run();
    target.advance(Infinity);
    assert.equal(target.state, "paused");
    assert.equal(target.result, null);
    target.resume();
    assert.equal(target.state, "finished");
    assert.equal(ends.length, 1);
    assert.deepEqual(target.result, reference);
    assert.deepEqual(changes, [
      "idle>running",
      "running>paused",
      "paused>running",
      "running>finished",
    ]);
  });

  it("stops from the end event: idle, no result", () => {
    const target = runner();
    target.on("end", () => target.stop());
    target.run();
    target.advance(Infinity);
    assert.equal(target.state, "idle");
    assert.equal(target.result, null);
  });

  it("reports a bad call made from a handler as that handler's error, not a crash", () => {
    const target = runner();
    const told = [];
    target.onError((info) => told.push(info));
    target.on("cast", () => target.run());
    target.run();
    target.advance(2);
    assert.ok(told.length > 0);
    assert.match(
      told[0].error.message,
      /SimRunner\.run\(\) is not allowed while running/,
    );
    assert.equal(told[0].type, "cast");
    assert.equal(target.state, "running");
  });
});

describe("state handlers that throw or call the runner (the #158 review)", () => {
  function runner(options) {
    return new SimRunner({ seed: 1, duration: SHORT, ...options });
  }

  function spyDriver() {
    const calls = [];
    return {
      calls,
      start: () => calls.push("start"),
      stop: () => calls.push("stop"),
    };
  }

  it("shows every handler the changes in the order they happened when one calls pause()", () => {
    const target = runner();
    const first = [];
    const second = [];
    const third = [];
    target.onStateChange(({ from, to }) => {
      first.push(`${from}>${to}`);
      if (to === "running" && first.length === 1) {
        target.pause();
      }
    });
    target.onStateChange(({ from, to }) => second.push(`${from}>${to}`));
    target.onStateChange(({ from, to }) => third.push(`${from}>${to}`));
    target.run();
    const order = ["idle>running", "running>paused"];
    assert.deepEqual(first, order);
    assert.deepEqual(second, order);
    assert.deepEqual(third, order);
    assert.equal(target.state, "paused");
  });

  it("does the same when the handler calls run() and stop(), in a chain", () => {
    const target = runner();
    const seen = [];
    let step = 0;
    target.onStateChange(() => {
      step += 1;
      if (step === 1) {
        target.stop();
      } else if (step === 2) {
        target.run();
      }
    });
    target.onStateChange(({ from, to }) => seen.push(`${from}>${to}`));
    target.run();
    assert.deepEqual(seen, ["idle>running", "running>idle", "idle>running"]);
    assert.equal(target.state, "running");
  });

  it("never starts the driver for a state that was gone before its notification ended", () => {
    const driver = spyDriver();
    const target = runner({ driver });
    target.onStateChange(({ to }) => {
      if (to === "running") {
        target.pause();
      }
    });
    target.run();
    assert.equal(target.state, "paused");
    assert.deepEqual(driver.calls, []);
    target.resume();
    // The handler pauses again, so the driver is still not started.
    assert.deepEqual(driver.calls, []);
  });

  it("pairs every driver start with a stop when a handler pauses and resumes", () => {
    const driver = spyDriver();
    const target = runner({ driver });
    let seen = 0;
    target.onStateChange(({ to }) => {
      if (to === "running") {
        seen += 1;
      }
      // The second time the fight runs, a handler pauses it again at once.
      if (seen === 2 && to === "running") {
        target.pause();
      }
    });
    target.run();
    assert.deepEqual(driver.calls, ["start"]);
    target.pause();
    assert.deepEqual(driver.calls, ["start", "stop"]);
    target.resume();
    assert.equal(target.state, "paused");
    assert.deepEqual(driver.calls, ["start", "stop"]);
  });

  it("still starts and stops the driver when a handler throws, and tells the other handlers", () => {
    const driver = spyDriver();
    const target = runner({ driver });
    const told = [];
    const heard = [];
    target.onError((info) => told.push(info));
    target.onStateChange(() => {
      throw new Error("state handler broke");
    });
    target.onStateChange(({ from, to }) => heard.push(`${from}>${to}`));
    assert.doesNotThrow(() => target.run());
    assert.deepEqual(driver.calls, ["start"]);
    assert.doesNotThrow(() => target.pause());
    assert.deepEqual(driver.calls, ["start", "stop"]);
    assert.deepEqual(heard, ["idle>running", "running>paused"]);
    assert.equal(told.length, 2);
    assert.equal(told[0].error.message, "state handler broke");
    assert.equal(told[0].type, "state");
    assert.deepEqual(told[0].event, { from: "idle", to: "running" });
    assert.equal(target.state, "paused");
  });

  it("rethrows a state handler's error from a microtask when nobody listens", () => {
    const queued = [];
    mock.method(globalThis, "queueMicrotask", (task) => queued.push(task));
    const target = runner();
    const boom = new Error("unheard");
    target.onStateChange(() => {
      throw boom;
    });
    assert.doesNotThrow(() => target.run());
    assert.equal(queued.length, 1);
    assert.throws(queued[0], (error) => error === boom);
  });

  it("sends state-handler and event-handler errors to the same onError, and stops sending after unsubscribe", () => {
    const target = runner();
    const told = [];
    const off = target.onError((info) => told.push(info.type));
    target.onStateChange(() => {
      throw new Error("a");
    });
    target.on("end", () => {
      throw new Error("b");
    });
    target.run();
    target.advance(Infinity);
    assert.deepEqual(told, ["state", "end", "state"]);
    off();
    const queued = [];
    mock.method(globalThis, "queueMicrotask", (task) => queued.push(task));
    target.reset();
    assert.equal(queued.length, 1);
  });

  it("keeps the unsubscribe of onStateChange working inside a handler", () => {
    const target = runner();
    const seen = [];
    const off = target.onStateChange(() => {
      seen.push("self");
      off();
    });
    target.onStateChange(({ to }) => seen.push(to));
    target.run();
    target.pause();
    assert.deepEqual(seen, ["self", "running", "paused"]);
  });
});
