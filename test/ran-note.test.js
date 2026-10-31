import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { referenceBuild } from "../data/reference-build.js";
import { runBatch } from "../js/batch-runner.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { emptyBatch } from "../js/run-actions.js";
import { toMarkup } from "../js/svg.js";
import { cardModel } from "../js/views/results-card.js";
import { resultViewsModel } from "../js/views/result-views.js";
import { dockText, lengthNote } from "../js/views/run-model.js";

// #245, Fran's #260 check: the phone dock describes the result it shows,
// and a changed fight length gets a light, neutral note beside the result
// ("Ran with 5 × 10 s · Fight is now 50 × 120 s"), not the out-of-date
// banner. A change to the fights or the seed alone says nothing.

const NBSP = "\u00a0";
const RAN = { seconds: 10, fights: 5, seed: 7 };
const NOW = { seconds: 120, fights: 50, seed: 7 };
const CONFIG = { ...pageDefaultConfig(), talents: referenceBuild() };
const AT = new Date(2026, 9, 31, 2, 30).getTime();
const BUILD = { buildLabel: () => "Build" };

let done;
before(() => {
  done = runBatch({
    config: CONFIG,
    seed: RAN.seed,
    iterations: RAN.fights,
    duration: RAN.seconds,
  });
});

const record = () => ({
  config: CONFIG,
  seed: RAN.seed,
  duration: RAN.seconds,
  iterations: RAN.fights,
  at: AT,
});

function state({
  mode = "batch",
  now = NOW,
  errors = {},
  status = "done",
} = {}) {
  return {
    config: CONFIG,
    form: { errors: {} },
    route: { area: "results", sub: null, param: null },
    run: {
      mode,
      state: mode === "batch" ? status : "finished",
      seed: now.seed,
      duration: now.seconds,
      iterations: now.fights,
      stoppedAt: null,
      snapshot: null,
      shown: true,
      errors,
      fields: {},
    },
    batch: {
      ...emptyBatch("worker"),
      status,
      result: done,
    },
    results: { time: RAN.seconds, damage: 10000 },
    ran: { batch: record(), live: record() },
    talents: {},
    rotationBuilder: {},
  };
}

describe("the fight-length note (#245, Fran's #260 check)", () => {
  it("says what the average ran with and what the fight is now", () => {
    assert.equal(
      lengthNote(state(), "batch"),
      `Ran with 5 × 10${NBSP}s · Fight is now 50 × 120${NBSP}s`,
    );
  });

  it("says the live fight's lengths", () => {
    assert.equal(
      lengthNote(state({ mode: "live" }), "live"),
      `Ran with 10${NBSP}s · Fight is now 120${NBSP}s`,
    );
  });

  it("says nothing for the fights or the seed alone", () => {
    const now = { seconds: RAN.seconds, fights: 50, seed: 9 };
    assert.equal(lengthNote(state({ now }), "batch"), null);
    assert.equal(lengthNote(state({ mode: "live", now }), "live"), null);
  });

  it("says nothing while the length has an error, or a run is going", () => {
    assert.equal(
      lengthNote(state({ errors: { duration: "Too long" } }), "batch"),
      null,
    );
    assert.equal(lengthNote(state({ status: "running" }), "batch"), null);
  });

  it("is not the out-of-date banner: no amber, no Run again", () => {
    const model = resultViewsModel(state());
    assert.equal(model.average.stale, null);
    assert.match(model.average.note, /^Ran with 5 × 10/);
    const card = cardModel(state(), BUILD).body.map(toMarkup).join("");
    assert.match(card, /class="ran-note"/);
    assert.doesNotMatch(card, /results-card-stale|Run again/);
  });
});

describe("the phone dock beside a result (#245, Fran's #260 check)", () => {
  it("describes the average it shows, not the next run", () => {
    assert.equal(dockText(state()).summary, `Average · 5 × 10${NBSP}s`);
  });

  it("describes the live fight it shows", () => {
    assert.equal(
      dockText(state({ mode: "live" })).summary,
      `Live fight · 10${NBSP}s`,
    );
  });

  it("describes the next run once nothing is shown", () => {
    const idle = state({ status: "idle" });
    idle.batch.result = null;
    assert.match(dockText(idle).summary, /50 × 120/);
  });
});
