import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { k } from "../data/constants.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { runBatch } from "../js/batch-runner.js";
import { createFight, runFight } from "../js/fight.js";
import { FrameClock } from "../js/frame-clock.js";
import { iconUrl } from "../js/icons.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { SimRunner } from "../js/sim-runner.js";
import { runOnCore } from "../js/core/fight.js";
import { POLL_STEP } from "./poll-step.js";

// Issue #76. The live page is a view of the engine runFight uses: js/main.js
// turns animation frames into seconds of fight time (js/frame-clock.js), gives
// them to the same fight on the event core (js/sim-runner.js advance), and
// draws it. Nothing here reads a real clock: every frame timestamp is made up
// by the test. (Frames were whole fixed steps until #234 removed that engine.)

const STEP = POLL_STEP;
const CAP = k("sim.maxFrameTime");
const FRAME_MS = 1000 / 60;
const FRAME = FRAME_MS / k("sim.msPerSecond");
const EPSILON = 1e-9;
const sum = (list) => list.reduce((total, value) => total + value, 0);

// What a fight looks like from the outside, the fields runFight returns.
function snapshot(simulation) {
  return {
    duration: simulation.currentTime,
    totalDamage: simulation.damageDone,
    abilities: simulation.abilityBreakdown(),
    log: simulation.combatLog,
  };
}

function fromRunFight(result) {
  return {
    duration: result.duration,
    totalDamage: result.totalDamage,
    abilities: result.abilities,
    log: result.log,
  };
}

describe("FrameClock", () => {
  it("gives no time on the first frame, whatever its timestamp", () => {
    for (const first of [0, 1234.5, 9e9]) {
      assert.equal(new FrameClock().seconds(first), 0, String(first));
    }
  });

  it("gives each frame its own seconds, with nothing carried", () => {
    const clock = new FrameClock();
    let timestamp = 1000;
    clock.seconds(timestamp);
    let total = 0;
    for (let frame = 0; frame < 600; frame++) {
      timestamp += FRAME_MS;
      total += clock.seconds(timestamp);
    }
    // Nothing is lost: the seconds given are the time elapsed.
    const elapsed = (timestamp - 1000) / k("sim.msPerSecond");
    assert.ok(Math.abs(total - elapsed) < EPSILON);
    assert.equal("carry" in clock, false);
    assert.equal(clock.steps, undefined);
  });

  it("cuts a late frame to k('sim.maxFrameTime') and drops the rest", () => {
    const clock = new FrameClock();
    clock.seconds(0);
    // A backgrounded tab: the next frame is ten seconds late.
    assert.equal(clock.seconds(10_000), CAP);
    // The ten seconds are gone, not owed: the next normal frame is normal.
    assert.ok(Math.abs(clock.seconds(10_000 + FRAME_MS) - FRAME) < EPSILON);
    // A long gap of any size gives the same cap.
    assert.equal(clock.seconds(1e12), CAP);
  });

  it("never gives more than the cap in one frame, whatever the gaps", () => {
    const clock = new FrameClock();
    let timestamp = 0;
    clock.seconds(timestamp);
    for (const gap of [1, 16, 17, 250, 251, 1000, 5000, 3.6e6, 0.5, 0, 33]) {
      timestamp += gap;
      const seconds = clock.seconds(timestamp);
      assert.ok(seconds >= 0 && seconds <= CAP, `${gap} ms gave ${seconds}`);
    }
  });

  it("gives no time when time does not move forward", () => {
    const clock = new FrameClock();
    clock.seconds(5000);
    assert.equal(clock.seconds(5000), 0);
    assert.equal(clock.seconds(4000), 0); // backwards: ignored, not negative
    // Time is measured from the last timestamp seen, so 4000 is the new base.
    assert.equal(clock.seconds(4000 + 250), 0.25);
  });

  it("restart() drops the gap", () => {
    const clock = new FrameClock();
    clock.seconds(0);
    clock.seconds(500);
    clock.restart();
    // An hour later: the first frame after restart gives no time at all.
    assert.equal(clock.seconds(3.6e6), 0);
    // Then it carries on from that frame.
    assert.equal(clock.seconds(3.6e6 + 250), 0.25);
  });

  it("rejects a timestamp that is not a finite number", () => {
    const clock = new FrameClock();
    for (const bad of [Number.NaN, Infinity, -Infinity, undefined, null, "5"]) {
      assert.throws(() => clock.seconds(bad), RangeError, String(bad));
    }
  });
});

describe("createFight", () => {
  it("builds the rogue and simulation that runFight uses", () => {
    const { seed, rogue, simulation } = createFight(42);
    assert.equal(seed, 42);
    assert.ok(rogue instanceof Rogue);
    assert.ok(simulation instanceof Simulation);
    assert.equal(simulation.rogue, rogue);
    assert.equal(simulation.seed, 42);
    assert.equal(simulation.currentTime, 0);
  });

  it("wraps the seed to 32 bits and rejects a seed that is not an integer", () => {
    assert.equal(createFight(-1).seed, 4294967295);
    assert.equal(createFight(2 ** 32 + 5).simulation.seed, 5);
    for (const bad of [undefined, null, 1.5, Number.NaN, "7"]) {
      assert.throws(() => createFight(bad), RangeError, String(bad));
    }
  });

  it("gives runFight's result when stepped the way run steps it", () => {
    const seed = 7;
    const { simulation } = createFight(seed);
    const steps = 64 * 90; // 90 s
    for (let index = 0; index < steps; index++) {
      runOnCore(simulation, STEP);
    }
    assert.deepEqual(
      snapshot(simulation),
      fromRunFight(runFight({ seed, duration: steps * STEP })),
    );
  });
});

describe("a live fight driven by uneven frames", () => {
  // Frame gaps of 4 ms to 40 ms, then a stalled tab (20 s), then 60 fps.
  function frameTimes() {
    const times = [1000];
    let timestamp = 1000;
    for (let frame = 0; frame < 4000; frame++) {
      timestamp += 4 + ((frame * 7) % 37);
      times.push(timestamp);
    }
    timestamp += 20_000;
    times.push(timestamp);
    for (let frame = 0; frame < 600; frame++) {
      timestamp += FRAME_MS;
      times.push(timestamp);
    }
    return times;
  }

  // The page's driver: a SimRunner held open for the fight, given each
  // frame's seconds.
  function live(seed, times) {
    const runner = new SimRunner({ seed, duration: 300 });
    runner.run();
    const clock = new FrameClock();
    for (const timestamp of times) {
      const seconds = clock.seconds(timestamp);
      assert.ok(seconds <= CAP);
      runner.advance(seconds);
    }
    return runner.fight.simulation;
  }

  it("matches runFight for the same seed and the same fight time", () => {
    for (const seed of [1, 99, 20261025]) {
      const simulation = live(seed, frameTimes());
      assert.ok(simulation.currentTime > 0);
      assert.deepEqual(
        snapshot(simulation),
        fromRunFight(runFight({ seed, duration: simulation.currentTime })),
        `seed\u00a0${seed}`,
      );
    }
  });

  it("does not depend on how the frames are cut", () => {
    // 60 fps and 144 fps over the same wall time give the same fight time,
    // and each is runFight's fight for that time.
    const run = (fps) => {
      const gap = 1000 / fps;
      return live(
        5,
        Array.from({ length: fps * 30 + 1 }, (_, frame) => frame * gap),
      );
    };
    const slow = run(60);
    const fast = run(144);
    assert.ok(Math.abs(slow.currentTime - fast.currentTime) < EPSILON);
    assert.ok(slow.currentTime > 0);
    for (const simulation of [slow, fast]) {
      assert.deepEqual(
        snapshot(simulation),
        fromRunFight(runFight({ seed: 5, duration: simulation.currentTime })),
      );
    }
  });
});

// The real js/main.js, loaded against a small stand-in for the page. The
// stand-in hands the test each animation frame callback, so the test decides
// when a frame happens and what its timestamp is.
function fakeElement() {
  const attributes = new Map();
  const listeners = new Map();
  return {
    style: {},
    classList: { toggle() {} },
    value: "",
    textContent: "",
    className: "",
    hidden: false,
    children: [],
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 0,
    firstChild: null,
    lastElementChild: { remove() {} },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click() {
      listeners.get("click")();
    },
    append() {},
    appendChild(node) {
      return node;
    },
    remove() {},
    insertBefore() {},
    // What the stats form view (#151) calls while it fills itself.
    removeAttribute(name) {
      attributes.delete(name);
    },
    replaceChildren() {},
  };
}

describe("js/main.js on a stand-in page", () => {
  const SEED = 20261025;
  const elements = new Map();
  // The seconds the page gives the fight, one entry per advance.
  const secondsSeen = [];
  let pendingFrame = null;
  const intervals = new Set();
  let cancelled = 0;
  let live;
  // Off while the test runs runFight (which does not advance a runner, but
  // keeps the reference out of the record all the same).
  let recording = true;
  function reference(duration) {
    recording = false;
    try {
      // The page fights its own defaults (#152: Instant and Deadly Poison).
      return fromRunFight(
        runFight({ seed: SEED, duration, config: pageDefaultConfig() }),
      );
    } finally {
      recording = true;
    }
  }

  const element = (selector) => elements.get(selector);
  // Run one animation frame at `timestamp` and report the seconds it gave.
  function frame(timestamp) {
    assert.ok(pendingFrame, "a frame was requested");
    const callback = pendingFrame;
    pendingFrame = null;
    const before = secondsSeen.length;
    callback(timestamp);
    return sum(secondsSeen.slice(before));
  }

  before(async () => {
    globalThis.document = {
      querySelector(selector) {
        if (!elements.has(selector)) {
          elements.set(selector, fakeElement());
        }
        return elements.get(selector);
      },
      querySelectorAll: () => [],
      createElement: () => fakeElement(),
      // The results panel (#154) builds its body with js/svg.js toDom.
      createElementNS: () => fakeElement(),
      createTextNode: (text) => ({ text }),
    };
    globalThis.requestAnimationFrame = (callback) => {
      pendingFrame = callback;
      return 1;
    };
    globalThis.cancelAnimationFrame = () => {
      pendingFrame = null;
      cancelled += 1;
    };
    // A batch ticks its elapsed time once a second (#155): record the timer.
    globalThis.window = {
      setInterval(callback) {
        intervals.add(callback);
        return callback;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
    };
    // The page picks its seed from the platform's random source. Pin it.
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues(array) {
          array[0] = SEED;
          return array;
        },
      },
    });
    // Record the seconds the page gives the fight, and which fight it is.
    const original = SimRunner.prototype.advance;
    SimRunner.prototype.advance = function recordedAdvance(seconds) {
      if (recording) {
        live = this.fight.simulation;
        secondsSeen.push(seconds);
      }
      return original.call(this, seconds);
    };
    await import("../js/main.js");
    // The page opens in Batch mode (#242, UX4): these fights are live.
    const liveMode = element("#run-mode-live");
    liveMode.value = "live";
    liveMode.checked = true;
    liveMode.listeners.get("change")();
  });

  it("starts idle with the seed in the bar, and Run starts the fight (#153)", () => {
    assert.equal(element("#run-seed").value, String(SEED));
    assert.equal(
      element("#run-status-text").textContent,
      `Ready · 300\u00a0s · seed\u00a0${SEED}`,
    );
    assert.equal(pendingFrame, null, "nothing runs at load");
    assert.equal(element("#pause-button").disabled, true);
    assert.equal(element("#run-button").disabled, false);
    element("#run-button").click();
    assert.equal(sum(secondsSeen), 0, "no time before the first frame");
    assert.ok(pendingFrame, "Run asks for a frame");
    assert.equal(element("#run-button").disabled, true);
    // Run moved the page to Results' Live view (#242, #245): said with the
    // run's own message.
    assert.equal(
      element("#run-announce").textContent,
      "Running. Showing Results.",
    );
  });

  it("gives no time on the first frame, then each frame's own seconds", () => {
    assert.equal(frame(1000), 0);
    let timestamp = 1000;
    let total = 0;
    for (let index = 0; index < 600; index++) {
      timestamp += FRAME_MS;
      const seconds = frame(timestamp);
      assert.ok(Math.abs(seconds - FRAME) < EPSILON, `${seconds}`);
      total += seconds;
    }
    assert.ok(Math.abs(total - 10) < EPSILON, `10 s of frames: ${total}`);
    assert.ok(Math.abs(live.currentTime - total) < EPSILON);
    assert.equal(live.seed, SEED);
    assert.match(element("#time-value").textContent, /^00:0[89]$|^00:10$/);
    // The page and runFight agree for this seed and this many steps.
    assert.deepEqual(snapshot(live), reference(live.currentTime));
  });

  let paused;
  it("Pause freezes the fight: no frame is queued and a stale one does nothing", () => {
    const staleFrame = pendingFrame;
    const timeBefore = live.currentTime;
    const damageBefore = live.damageDone;
    const cancelledBefore = cancelled;
    element("#pause-button").click();
    assert.equal(cancelled, cancelledBefore + 1);
    assert.equal(pendingFrame, null);
    assert.equal(element("#pause-button").getAttribute("aria-pressed"), null);
    assert.equal(element("#pause-label").textContent, "Resume");
    assert.match(
      element("#run-announce").textContent,
      /^Paused at (9|10) seconds\. Total damage [\d,]+\. [\d,]+ DPS\. Energy \d+ of \d+\. Combo points \d of 5\.$/,
    );
    assert.match(
      element("#run-status-text").textContent,
      /^Paused at 00:(09|10)$/,
    );
    const seenBefore = sum(secondsSeen);
    staleFrame(1e9);
    assert.equal(sum(secondsSeen), seenBefore);
    assert.equal(live.currentTime, timeBefore);
    assert.equal(live.damageDone, damageBefore);
    paused = { timeBefore };
  });

  it("Resume after a long pause takes no catch-up time", () => {
    element("#pause-button").click();
    assert.equal(element("#pause-button").getAttribute("aria-pressed"), null);
    assert.equal(element("#pause-label").textContent, "Pause");
    assert.equal(
      element("#run-announce").textContent,
      "Running",
      "Resume says Running (#45, Scout)",
    );
    assert.match(element("#run-status-text").textContent, /^Running · /);
    assert.ok(pendingFrame, "resume asks for a frame");
    // An hour later by the browser's clock.
    const resumedAt = 1000 + 3.6e6;
    assert.equal(frame(resumedAt), 0);
    assert.equal(live.currentTime, paused.timeBefore);
    const seconds = frame(resumedAt + FRAME_MS);
    assert.ok(Math.abs(seconds - FRAME) < EPSILON, `${seconds}`);
    assert.ok(Math.abs(live.currentTime - paused.timeBefore - FRAME) < EPSILON);
  });

  it("a backgrounded tab's late frame is capped to k('sim.maxFrameTime')", () => {
    const timeBefore = live.currentTime;
    // The tab was hidden for 5 minutes: the next frame arrives 300 s late.
    assert.equal(frame(1000 + 3.6e6 + 300_000), CAP);
    assert.ok(Math.abs(live.currentTime - timeBefore - CAP) < EPSILON);
    // The next frame is back to normal.
    const next = frame(1000 + 3.6e6 + 300_000 + FRAME_MS);
    assert.ok(Math.abs(next - FRAME) < EPSILON, `${next}`);
  });

  it("still equals runFight after pause, resume, and the late frame", () => {
    assert.deepEqual(snapshot(live), reference(live.currentTime));
    assert.ok(Math.abs(live.currentTime - sum(secondsSeen)) < EPSILON);
  });

  it("ends the fight at 300 s, finished, equal to runFight (#153)", () => {
    const duration = k("batch.duration");
    assert.equal(duration, 300);
    let timestamp = 1000 + 3.6e6 + 300_000 + FRAME_MS;
    let frames = 0;
    while (pendingFrame) {
      timestamp += 1000;
      assert.ok(frame(timestamp) <= CAP);
      frames += 1;
      assert.ok(frames < 2000, "the fight ends");
    }
    assert.equal(live.currentTime, duration);
    assert.deepEqual(snapshot(live), reference(duration));
    const dps = (live.damageDone / duration).toFixed(1);
    assert.equal(
      element("#run-status-text").textContent,
      `Finished · 300\u00a0s · ${dps} DPS`,
    );
    const total = Math.floor(live.damageDone).toLocaleString("en-US");
    assert.equal(
      element("#run-announce").textContent,
      `Finished at 5 minutes. Total damage ${total}. ${Number(dps).toLocaleString("en-US", { minimumFractionDigits: 1 })} DPS.`,
    );
    assert.equal(element("#pause-button").disabled, true);
    assert.equal(element("#run-button").textContent, "Run again");
    assert.equal(element("#time-value").textContent, "05:00");
    // A click on the disabled button, had it reached the page, does nothing.
    element("#pause-button").click();
    assert.equal(pendingFrame, null);
    assert.match(element("#run-status-text").textContent, /^Finished/);
  });

  // The bar end to end on the page (#153): Run again replays the seed, Stop
  // discards, Run replays from 0:00, Reset empties.
  function runFor(frames) {
    let timestamp = 5e6;
    frame(timestamp);
    for (let index = 0; index < frames; index++) {
      timestamp += FRAME_MS;
      frame(timestamp);
    }
  }

  it("Stop then Run reproduces the same fight for the same seed", () => {
    element("#run-button").click();
    const first = sum(secondsSeen);
    runFor(120);
    const seconds = sum(secondsSeen) - first;
    const stoppedFight = live;
    assert.notEqual(stoppedFight, null);
    assert.ok(Math.abs(stoppedFight.currentTime - seconds) < EPSILON);
    const stopped = snapshot(stoppedFight);
    assert.deepEqual(
      stopped,
      reference(stoppedFight.currentTime),
      "a new fight from 0:00",
    );
    element("#stop-button").click();
    assert.equal(element("#stop-button").textContent, "Stop and discard");
    assert.equal(pendingFrame, null);
    assert.match(
      element("#run-status-text").textContent,
      new RegExp(
        `^Stopped at 00:0[12] · fight discarded · Run replays seed\u00a0${SEED} from 0:00$`,
      ),
    );
    assert.match(
      element("#run-announce").textContent,
      /^Stopped at [12] seconds?\. Fight discarded\.$/,
    );
    assert.equal(element("#reset-button").disabled, false);
    element("#run-button").click();
    const again = sum(secondsSeen);
    runFor(120);
    assert.notEqual(live, stoppedFight, "a new fight");
    assert.ok(Math.abs(sum(secondsSeen) - again - seconds) < EPSILON);
    assert.deepEqual(snapshot(live), stopped);
  });

  it("Reset ends the fight and empties the picture", () => {
    element("#reset-button").click();
    assert.equal(pendingFrame, null);
    assert.equal(
      element("#run-status-text").textContent,
      `Ready · 300\u00a0s · seed\u00a0${SEED}`,
    );
    assert.equal(element("#reset-button").disabled, true);
    assert.equal(element("#time-value").textContent, "00:00");
    assert.equal(element("#run-button").textContent, "Run");
  });

  it("a batch runs end to end and lands its result (main thread here)", async () => {
    const live = element("#run-mode-live");
    const batch = element("#run-mode-batch");
    batch.value = "batch";
    batch.checked = true;
    live.checked = false;
    batch.listeners.get("change")();
    assert.equal(element("#run-iterations-field").hidden, false);
    assert.equal(element("#run-button").textContent, "Run average");
    assert.equal(element("#stop-button").textContent, "Stop and keep partial");
    assert.equal(
      element("#pause-button").getAttribute("aria-disabled"),
      "true",
    );
    for (const [name, text] of [
      ["iterations", "4"],
      ["duration", "20"],
    ]) {
      element(`#run-${name}`).value = text;
      element(`#run-${name}`).listeners.get("input")();
    }
    element("#run-button").click();
    assert.equal(
      element("#run-status-text").textContent,
      "0/4 fights · Running",
    );
    assert.equal(element("#run-progress-row").hidden, false);
    assert.equal(element("#run-button").disabled, true);
    assert.equal(element("#run-duration").disabled, true);
    assert.equal(intervals.size, 1, "a running batch ticks its elapsed time");
    const expected = runBatch({
      seed: SEED,
      iterations: 4,
      duration: 20,
      config: pageDefaultConfig(),
    });
    const deadline = Date.now() + 30_000;
    while (!/Done$/.test(element("#run-status-text").textContent)) {
      assert.ok(Date.now() < deadline, "the batch settles");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(
      element("#run-status-text").textContent,
      `4 fights · ${expected.summary.mean.toFixed(1)} DPS mean · Done`,
    );
    assert.equal(intervals.size, 0, "and stops ticking when it settles");
    assert.equal(element("#run-progress-row").hidden, true);
    assert.equal(element("#reset-button").disabled, false);
  });
});

// Issue #107 follow-up. js/main.js only runs in a page, so this gives it a
// stand-in document that records what it builds, imports it, and drives its
// animation frames by hand. It checks the wiring that icons.test.js cannot see:
// that every icon <img> the page makes gets the fallback listener and a
// no-referrer policy before its src is set, and that a load error swaps in the
// fallback icon and then hides the image.
describe("icons on the live page (stub DOM)", () => {
  const FALLBACK = iconUrl(null);
  const created = [];
  const frames = [];
  let combatLog;

  class StubElement {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.listeners = new Map();
      this.operations = [];
      this.attributes = new Map();
      this.parent = null;
      this.style = {};
      this.hidden = false;
      this.isConnected = true;
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this.textContent = "";
      this.classList = { toggle() {} };
    }

    set src(value) {
      this.operations.push("src");
      this.source = value;
    }

    get src() {
      return this.source;
    }

    set referrerPolicy(value) {
      this.operations.push("referrerPolicy");
      this.policy = value;
    }

    get referrerPolicy() {
      return this.policy;
    }

    get firstChild() {
      return this.children[0] ?? null;
    }

    get lastElementChild() {
      return this.children.at(-1) ?? null;
    }

    addEventListener(type, listener) {
      this.operations.push(`listen:${type}`);
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    fire(type) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener();
      }
    }

    setAttribute(name, value) {
      this.attributes.set(name, value);
    }

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    replaceChildren(...nodes) {
      for (const child of [...this.children]) {
        child.remove();
      }
      this.append(...nodes.filter((node) => typeof node === "object"));
    }

    append(...nodes) {
      for (const node of nodes) {
        node.remove();
        node.parent = this;
        this.children.push(node);
      }
    }

    appendChild(node) {
      this.append(node);
      return node;
    }

    insertBefore(node, before) {
      node.parent = this;
      this.children.splice(before ? this.children.indexOf(before) : 0, 0, node);
    }

    remove() {
      if (this.parent) {
        this.parent.children = this.parent.children.filter(
          (child) => child !== this,
        );
        this.parent = null;
      }
      this.isConnected = false;
    }
  }

  const named = new Map();
  const stubDocument = {
    querySelector(selector) {
      if (!named.has(selector)) {
        named.set(selector, new StubElement(selector));
      }
      return named.get(selector);
    },
    querySelectorAll() {
      return [new StubElement("combo-point")];
    },
    createElement(tag) {
      const element = new StubElement(tag);
      created.push(element);
      return element;
    },
    // The results panel (#154) builds its body with js/svg.js toDom.
    createElementNS: (namespace, tag) => new StubElement(tag),
    createTextNode(text) {
      const node = new StubElement("#text");
      node.textContent = text;
      return node;
    },
  };

  // Frame timestamps are made up, 60 fps from 1000 ms.
  function frame(timestamp) {
    const callback = frames.pop();
    assert.ok(callback, "main.js asked for a frame");
    callback(timestamp);
  }

  before(async () => {
    globalThis.document = stubDocument;
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    globalThis.cancelAnimationFrame = () => {};
    await import("../js/main.js?icons-stub-dom");
    // The page opens in Batch mode (#242, UX4): this fight is live.
    const liveMode = stubDocument.querySelector("#run-mode-live");
    liveMode.value = "live";
    liveMode.checked = true;
    liveMode.fire("change");
    // The page starts idle (#153): Run starts the fight.
    stubDocument.querySelector("#run-button").fire("click");
    let timestamp = 1000;
    frame(timestamp);
    // Twelve seconds of fight: the poisons are up on the target by then, so
    // there are timed effects and log rows with icons. (The untalented
    // default casts no Blade Flurry or Adrenaline Rush, #199.)
    for (let index = 0; index < 720; index++) {
      timestamp += FRAME_MS;
      frame(timestamp);
    }
    combatLog = stubDocument.querySelector("#combat-log");
  });

  after(() => {
    delete globalThis.document;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });

  function icons() {
    return created.filter((element) => element.tag === "img");
  }

  it("draws icons in the combat log and in the timed effects", () => {
    assert.ok(combatLog.children.length > 0, "the log has rows");
    const inLog = icons().filter((image) => image.width === 16);
    const inEffects = icons().filter((image) => image.width === 32);
    assert.ok(inLog.length > 0, "a log row has an icon");
    assert.ok(inEffects.length > 0, "a timed effect has an icon");
  });

  it("listens for the load error on every icon, before the src is set", () => {
    for (const image of icons()) {
      assert.equal(image.listeners.get("error")?.length, 1, image.src);
      assert.ok(
        image.operations.indexOf("listen:error") <
          image.operations.indexOf("src"),
        image.src,
      );
    }
  });

  it("sends no referrer for any icon, set before the src", () => {
    for (const image of icons()) {
      assert.equal(image.referrerPolicy, "no-referrer", image.src);
      assert.ok(
        image.operations.indexOf("referrerPolicy") <
          image.operations.indexOf("src"),
        image.src,
      );
    }
  });

  it("swaps in the fallback on the first error, then hides the image", () => {
    for (const image of icons()) {
      const original = image.src;
      assert.notEqual(original, FALLBACK, "a real icon to start with");
      image.fire("error");
      assert.equal(image.src, FALLBACK, original);
      assert.equal(image.hidden, false, original);
      image.fire("error");
      assert.equal(image.src, FALLBACK, original);
      assert.equal(image.hidden, true, original);
      image.fire("error");
      assert.equal(image.src, FALLBACK, "never loops");
    }
  });
});
