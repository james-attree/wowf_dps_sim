import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { emptyBatch } from "../js/run-actions.js";
import {
  WEIGHTS_KEEP_AWAKE,
  WEIGHTS_RUNNING_REASON,
  controlsModel,
  dockDps,
  dockText,
} from "../js/views/run-model.js";
import { badgeOf, resultsStatus } from "../js/views/sections.js";

// #283: the dock badge, Run disabled during a weights run, and the
// wake-lock fallback on the Run bar.

const TOTAL = 9;
const DONE = 3;

function state(over = {}) {
  return {
    run: {
      mode: "batch",
      state: "idle",
      seed: 1,
      duration: 300,
      iterations: 1000,
      errors: {},
      fields: {},
      stoppedAt: null,
    },
    batch: { ...emptyBatch("worker"), status: "idle" },
    form: { errors: {} },
    results: { time: 0, damage: 0 },
    weights: {
      status: "running",
      progress: { completed: DONE, total: TOTAL },
      result: null,
      wakeLock: null,
    },
    ...over,
  };
}

describe("stat weights across screens (#283)", () => {
  it("disables Run with the reason while weights are running", () => {
    const model = controlsModel(state());
    assert.equal(model.run.disabled, true);
    assert.equal(model.reason, WEIGHTS_RUNNING_REASON);
    assert.equal(model.status, WEIGHTS_RUNNING_REASON);
    assert.equal(model.statusShort, "Weights · 3/9");
  });

  it("appends the wake-lock fallback to the Run status", () => {
    const model = controlsModel(
      state({
        weights: {
          status: "running",
          progress: { completed: DONE, total: TOTAL },
          wakeLock: "fallback",
        },
      }),
    );
    assert.equal(
      model.status,
      `${WEIGHTS_RUNNING_REASON}. ${WEIGHTS_KEEP_AWAKE}.`,
    );
    assert.equal(model.reason, WEIGHTS_RUNNING_REASON);
  });

  it("the dock strip shows weights progress, and keeps the last DPS", () => {
    const running = state({
      batch: {
        ...emptyBatch("worker"),
        status: "done",
        result: {
          completed: 4,
          summary: { mean: 123.4 },
        },
      },
    });
    assert.deepEqual(dockText(running), {
      summary: "Stat weights",
      status: "Running · 3/9",
    });
    assert.equal(dockDps(running).value, "123.4");
    assert.equal(dockDps(running).label, "DPS avg");
  });

  it("Results' status is a progress badge, gone when the run ends", () => {
    const running = resultsStatus(state());
    assert.deepEqual(running.progress, { completed: DONE, total: TOTAL });
    assert.deepEqual(badgeOf(running), {
      kind: "progress",
      count: "3/9",
      words: "stat weights running",
    });
    assert.equal(
      badgeOf(resultsStatus(state({ weights: { status: "done" } }))),
      null,
    );
  });

  it("an idle or done weights slice leaves Run as it was", () => {
    const model = controlsModel(
      state({ weights: { status: "done", result: {} } }),
    );
    assert.equal(model.run.disabled, false);
    assert.equal(model.reason, null);
    assert.match(model.status, /^Ready/);
  });
});

describe("the weights progress element (#377 N1)", () => {
  it("the native progress element has no redundant progressbar role", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    const open = html.match(
      /<progress\b[^>]*id="results-weights-progress-bar"[^>]*>/,
    );
    assert.ok(open, "expected #results-weights-progress-bar");
    assert.equal(/\brole\s*=/.test(open[0]), false);
  });
});
