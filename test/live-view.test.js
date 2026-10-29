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

// Issue #76. The live page is a view of the engine runFight uses: js/main.js
// turns animation frames into whole fixed steps (js/frame-clock.js), steps the
// same Simulation, and draws it. Nothing here reads a real clock: every frame
// timestamp is made up by the test.

const STEP = k("sim.fixedStep");
const CAP_STEPS = k("sim.maxFrameTime") / STEP;
const FRAME_MS = 1000 / 60;

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
  it("takes no step on the first frame, whatever its timestamp", () => {
    for (const first of [0, 1234.5, 9e9]) {
      assert.equal(new FrameClock().steps(first), 0, String(first));
    }
  });

  it("gives one step for a frame of one step and none for half of one", () => {
    const clock = new FrameClock();
    clock.steps(0);
    assert.equal(clock.steps(STEP * k("sim.msPerSecond")), 1);
    assert.equal(clock.steps(STEP * k("sim.msPerSecond") * 1.5), 0);
    assert.equal(clock.steps(STEP * k("sim.msPerSecond") * 2), 1);
  });

  it("carries the part of a frame that does not fill a step", () => {
    const clock = new FrameClock();
    let timestamp = 1000;
    clock.steps(timestamp);
    let total = 0;
    const frames = 600; // 10 s at 60 fps
    for (let frame = 0; frame < frames; frame++) {
      timestamp += FRAME_MS;
      total += clock.steps(timestamp);
    }
    // Nothing is lost: the steps taken plus the carry are the time elapsed.
    const elapsed = (timestamp - 1000) / k("sim.msPerSecond");
    assert.ok(Math.abs(total * STEP + clock.carry - elapsed) < 1e-9);
    assert.ok(clock.carry >= 0 && clock.carry < STEP);
  });

  it("cuts a late frame to k('sim.maxFrameTime') and drops the rest", () => {
    const clock = new FrameClock();
    clock.steps(0);
    // A backgrounded tab: the next frame is ten seconds late.
    assert.equal(clock.steps(10_000), CAP_STEPS);
    assert.ok(clock.carry < STEP);
    // The ten seconds are gone, not owed: the next normal frame is normal.
    assert.ok(clock.steps(10_000 + FRAME_MS) <= 2);
    // A long gap of any size gives the same cap.
    assert.equal(clock.steps(1e12), CAP_STEPS);
  });

  it("never takes more than the cap in one frame, whatever the gaps", () => {
    const clock = new FrameClock();
    let timestamp = 0;
    clock.steps(timestamp);
    for (const gap of [1, 16, 17, 250, 251, 1000, 5000, 3.6e6, 0.5, 0, 33]) {
      timestamp += gap;
      const steps = clock.steps(timestamp);
      assert.ok(steps <= CAP_STEPS, `${gap} ms gave ${steps} steps`);
      assert.ok(Number.isInteger(steps));
    }
  });

  it("takes no steps when time does not move forward", () => {
    const clock = new FrameClock();
    clock.steps(5000);
    assert.equal(clock.steps(5000), 0);
    assert.equal(clock.steps(4000), 0); // backwards: ignored, not negative
    assert.equal(clock.carry, 0);
    // Time is measured from the last timestamp seen, so 4000 is the new base.
    assert.equal(clock.steps(4000 + STEP * k("sim.msPerSecond")), 1);
  });

  it("restart() drops the gap but keeps the carry", () => {
    const clock = new FrameClock();
    clock.steps(0);
    clock.steps(STEP * k("sim.msPerSecond") * 1.5); // one step, half a step carried
    const carried = clock.carry;
    assert.equal(carried, STEP / 2);
    clock.restart();
    // An hour later: the first frame after restart takes no step at all.
    assert.equal(clock.steps(3.6e6), 0);
    assert.equal(clock.carry, carried);
    // Then it carries on from that frame.
    assert.equal(clock.steps(3.6e6 + STEP * k("sim.msPerSecond") * 0.5), 1);
  });

  it("rejects a timestamp that is not a finite number", () => {
    const clock = new FrameClock();
    for (const bad of [Number.NaN, Infinity, -Infinity, undefined, null, "5"]) {
      assert.throws(() => clock.steps(bad), RangeError, String(bad));
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
      simulation.step(STEP);
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
      timestamp += 4 + ((frame * 37) % 37);
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

  it("matches runFight for the same seed and the same number of steps", () => {
    for (const seed of [1, 99, 20261025]) {
      const { simulation } = createFight(seed);
      const clock = new FrameClock();
      let steps = 0;
      for (const timestamp of frameTimes()) {
        const count = clock.steps(timestamp);
        assert.ok(count <= CAP_STEPS);
        for (let index = 0; index < count; index++) {
          simulation.step(STEP);
        }
        steps += count;
      }
      assert.equal(simulation.currentTime, steps * STEP, "whole steps only");
      assert.ok(steps > 0);
      assert.deepEqual(
        snapshot(simulation),
        fromRunFight(runFight({ seed, duration: steps * STEP })),
        `seed ${seed}`,
      );
    }
  });

  it("does not depend on how the frames are cut", () => {
    // 60 fps and 144 fps over the same wall time end within one step of each
    // other, and a fight stepped to the same step count is the same fight.
    const run = (fps) => {
      const { simulation } = createFight(5);
      const clock = new FrameClock();
      const gap = 1000 / fps;
      let timestamp = 0;
      clock.steps(timestamp);
      for (let frame = 0; frame < fps * 30; frame++) {
        timestamp += gap;
        for (let n = clock.steps(timestamp); n > 0; n--) {
          simulation.step(STEP);
        }
      }
      return simulation;
    };
    const slow = run(60);
    const fast = run(144);
    assert.ok(Math.abs(slow.currentTime - fast.currentTime) <= STEP);
    const common = Math.min(slow.currentTime, fast.currentTime);
    assert.deepEqual(
      snapshot(slow),
      fromRunFight(runFight({ seed: 5, duration: slow.currentTime })),
    );
    assert.ok(common > 0);
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
  const stepsSeen = [];
  let pendingFrame = null;
  const intervals = new Set();
  let cancelled = 0;
  let live;
  // Off while the test runs runFight, which steps a Simulation too.
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
  // Run one animation frame at `timestamp` and report how the engine moved.
  function frame(timestamp) {
    assert.ok(pendingFrame, "a frame was requested");
    const callback = pendingFrame;
    pendingFrame = null;
    const before = stepsSeen.length;
    callback(timestamp);
    return stepsSeen.slice(before);
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
    // Record every step the page gives the engine, and which simulation it is.
    const original = Simulation.prototype.step;
    Simulation.prototype.step = function recordedStep(dt) {
      if (recording) {
        live = this;
        stepsSeen.push(dt);
      }
      return original.call(this, dt);
    };
    await import("../js/main.js");
  });

  it("starts idle with the seed in the bar, and Run starts the fight (#153)", () => {
    assert.equal(element("#run-seed").value, String(SEED));
    assert.equal(
      element("#run-status-text").textContent,
      `Ready · seed ${SEED}`,
    );
    assert.equal(pendingFrame, null, "nothing runs at load");
    assert.equal(element("#pause-button").disabled, true);
    assert.equal(element("#run-button").disabled, false);
    element("#run-button").click();
    assert.equal(stepsSeen.length, 0, "no step before the first frame");
    assert.ok(pendingFrame, "Run asks for a frame");
    assert.equal(element("#run-button").disabled, true);
    assert.equal(element("#run-announce").textContent, "Running");
  });

  it("takes no step on the first frame, then fixed steps only", () => {
    assert.deepEqual(frame(1000), []);
    let timestamp = 1000;
    let total = 0;
    for (let index = 0; index < 600; index++) {
      timestamp += FRAME_MS;
      const steps = frame(timestamp);
      assert.ok(steps.every((dt) => dt === STEP));
      assert.ok(steps.length <= 2);
      total += steps.length;
    }
    assert.ok(
      total >= 630 && total <= 640,
      `10 s is about 640 steps: ${total}`,
    );
    assert.equal(live.currentTime, total * STEP);
    assert.equal(live.seed, SEED);
    assert.match(element("#time-value").textContent, /^00:0[89]$|^00:10$/);
    // The page and runFight agree for this seed and this many steps.
    assert.deepEqual(snapshot(live), reference(total * STEP));
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
    const stepsBefore = stepsSeen.length;
    staleFrame(1e9);
    assert.equal(stepsSeen.length, stepsBefore);
    assert.equal(live.currentTime, timeBefore);
    assert.equal(live.damageDone, damageBefore);
    paused = { timeBefore, stepsBefore };
  });

  it("Resume after a long pause takes no catch-up step", () => {
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
    assert.deepEqual(frame(resumedAt), []);
    assert.equal(live.currentTime, paused.timeBefore);
    const steps = frame(resumedAt + FRAME_MS);
    assert.ok(steps.length <= 2 && steps.every((dt) => dt === STEP));
    assert.ok(live.currentTime - paused.timeBefore <= 2 * STEP);
  });

  it("a backgrounded tab's late frame is capped, and is not one huge step", () => {
    const timeBefore = live.currentTime;
    // The tab was hidden for 5 minutes: the next frame arrives 300 s late.
    const steps = frame(1000 + 3.6e6 + 300_000);
    assert.equal(steps.length, CAP_STEPS);
    assert.ok(
      steps.every((dt) => dt === STEP),
      "every step is a fixed step",
    );
    assert.ok(Math.max(...steps) <= STEP);
    const advanced = live.currentTime - timeBefore;
    assert.ok(Math.abs(advanced - k("sim.maxFrameTime")) <= STEP);
    // The next frame is back to normal.
    const next = frame(1000 + 3.6e6 + 300_000 + FRAME_MS);
    assert.ok(next.length <= 2);
  });

  it("still equals runFight after pause, resume, and the late frame", () => {
    assert.deepEqual(snapshot(live), reference(stepsSeen.length * STEP));
    assert.equal(live.currentTime, stepsSeen.length * STEP);
  });

  it("ends the fight at 300 s, finished, equal to runFight (#153)", () => {
    const duration = k("batch.duration");
    assert.equal(duration, 300);
    let timestamp = 1000 + 3.6e6 + 300_000 + FRAME_MS;
    let frames = 0;
    while (pendingFrame) {
      timestamp += 1000;
      const steps = frame(timestamp);
      assert.ok(steps.length <= CAP_STEPS);
      frames += 1;
      assert.ok(frames < 2000, "the fight ends");
    }
    assert.equal(live.currentTime, duration);
    assert.equal(stepsSeen.length * STEP, duration);
    assert.deepEqual(snapshot(live), reference(duration));
    const dps = (live.damageDone / duration).toFixed(1);
    assert.equal(
      element("#run-status-text").textContent,
      `Finished · 300 s · ${dps} DPS`,
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
    const first = stepsSeen.length;
    runFor(120);
    const steps = stepsSeen.length - first;
    const stoppedFight = live;
    assert.notEqual(stoppedFight, null);
    const stopped = snapshot(stoppedFight);
    assert.deepEqual(stopped, reference(steps * STEP), "a new fight from 0:00");
    element("#stop-button").click();
    assert.equal(element("#stop-button").textContent, "Stop and discard");
    assert.equal(pendingFrame, null);
    assert.match(
      element("#run-status-text").textContent,
      new RegExp(
        `^Stopped at 00:0[12] · fight discarded · Run replays seed ${SEED} from 0:00$`,
      ),
    );
    assert.match(
      element("#run-announce").textContent,
      /^Stopped at [12] seconds?\. Fight discarded\.$/,
    );
    assert.equal(element("#reset-button").disabled, false);
    element("#run-button").click();
    const again = stepsSeen.length;
    runFor(120);
    assert.notEqual(live, stoppedFight, "a new fight");
    assert.equal(stepsSeen.length - again, steps);
    assert.deepEqual(snapshot(live), stopped);
  });

  it("Reset ends the fight and empties the picture", () => {
    element("#reset-button").click();
    assert.equal(pendingFrame, null);
    assert.equal(
      element("#run-status-text").textContent,
      `Ready · seed ${SEED}`,
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
    assert.equal(element("#run-button").textContent, "Run batch");
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
      "0/4 fights · Running batch",
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
    // The page starts idle (#153): Run starts the fight.
    stubDocument.querySelector("#run-button").fire("click");
    let timestamp = 1000;
    frame(timestamp);
    // Four seconds of fight: Blade Flurry and Adrenaline Rush are cast, so
    // there are timed effects and log rows with icons.
    for (let index = 0; index < 240; index++) {
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
