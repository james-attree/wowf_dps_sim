import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { referenceBuild } from "../data/reference-build.js";
import { BatchRunner, runBatch } from "../js/batch-runner.js";
import { buildLabel } from "../js/build-label.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { emptyBatch } from "../js/run-actions.js";
import { toMarkup } from "../js/svg.js";
import { cardModel, liveText } from "../js/views/results-card.js";
import { breakdownModel, num, pct } from "../js/views/results-render.js";

// #241 (UX3): the desktop results column's summary card. Its model is pure
// and returns js/svg.js nodes, so these tests read their text.

const LABELS = { buildLabel };
const config = () => ({ ...pageDefaultConfig(), talents: referenceBuild() });
const OPTIONS = { seed: 241, iterations: 12, duration: 30 };
const text = (nodes) =>
  nodes
    .map(toMarkup)
    .join("")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const RUN = {
  mode: "batch",
  state: "idle",
  seed: OPTIONS.seed,
  duration: OPTIONS.duration,
  iterations: OPTIONS.iterations,
  stoppedAt: null,
  snapshot: null,
};
const NO_FIGHT = { time: 0, damage: 0 };
const state = (batch, run = {}, results = NO_FIGHT) => ({
  batch: { ...emptyBatch("worker"), ...batch },
  run: { ...RUN, ...run },
  results,
});

function stopped(fights) {
  const runner = new BatchRunner({ ...OPTIONS, config: config() });
  runner.run();
  if (fights > 0) {
    runner.advance(fights);
  }
  runner.cancel();
  return runner.result;
}

let done;
let partial;
let single;
let zero;
before(() => {
  done = runBatch({ ...OPTIONS, config: config() });
  partial = stopped(4);
  single = stopped(1);
  zero = stopped(0);
});

describe("the desktop summary card (#241)", () => {
  it("before any batch: no average yet, says how to get one, no link to open", () => {
    const model = cardModel(state({ status: "idle" }), LABELS);
    assert.equal(
      text(model.body),
      "No average yet. Choose Batch above, then Run batch.",
    );
    assert.equal(model.open, false);
    assert.equal(model.busy, false);
  });

  it("a finished batch: the average ± its interval, fights, build, damage per fight and top ability", () => {
    const model = cardModel(state({ status: "done", result: done }), LABELS);
    const body = text(model.body);
    const ci = done.summary.ci95;
    const rows = breakdownModel(done).damageRows;
    assert.ok(body.startsWith(`${num(done.summary.mean)} DPS`), body);
    assert.ok(body.includes(`± ${num(ci.halfWidth)} (95% CI)`), body);
    assert.ok(body.includes(`12 fights × 30 s · seed ${OPTIONS.seed}`), body);
    assert.ok(body.includes(buildLabel(done.config)), body);
    assert.ok(body.includes("Damage per fight"), body);
    assert.ok(
      body.includes(`Top ability ${rows[0].name} · ${pct(rows[0].share)}`),
      body,
    );
    for (const row of rows.slice(1)) {
      assert.ok(row.damage <= rows[0].damage, "the top row did most");
    }
    assert.equal(body.includes("PARTIAL"), false);
    assert.equal(body.includes(" of 12 fights"), false, "all of them ran");
    assert.equal(model.open, true);
  });

  it("a stopped batch is marked partial; one fight has no interval", () => {
    const cut = text(
      cardModel(state({ status: "cancelled", result: partial }), LABELS).body,
    );
    assert.ok(cut.includes("PARTIAL"), cut);
    // How many of the fights asked for ran (Fran's #253 check, N2).
    assert.ok(cut.includes(`4 of ${OPTIONS.iterations} fights × 30 s`), cut);
    const one = text(
      cardModel(state({ status: "cancelled", result: single }), LABELS).body,
    );
    assert.ok(one.includes("One fight: no confidence interval"), one);
    assert.ok(one.includes(`1 of ${OPTIONS.iterations} fights × 30 s`), one);
  });

  it("stopped early out of thousands: the count asked for is grouped, 3 of 4,000 (#253, N2)", () => {
    const runner = new BatchRunner({
      ...OPTIONS,
      iterations: 4000,
      config: config(),
    });
    runner.run();
    runner.advance(3);
    runner.cancel();
    const cut = text(
      cardModel(state({ status: "cancelled", result: runner.result }), LABELS)
        .body,
    );
    assert.ok(cut.includes("3 of 4,000 fights × 30 s"), cut);
  });

  it("stopped before the first fight: no average, nothing to open on Results but the banner", () => {
    const model = cardModel(
      state({ status: "cancelled", result: zero }),
      LABELS,
    );
    assert.equal(
      text(model.body),
      "Stopped before the first fight finished: no average.",
    );
    assert.equal(model.open, true);
  });

  it("while a batch runs: its progress, busy, and a link to watch it", () => {
    const model = cardModel(
      state({ status: "running", progress: { completed: 3, total: 12 } }),
      LABELS,
    );
    assert.equal(text(model.body), "Running batch · 3 of 12 fights");
    assert.equal(model.busy, true);
    assert.equal(model.open, true);
  });

  it("the previous average mid-run is a group its h3 names (#245)", () => {
    const markup = cardModel(
      state({
        status: "running",
        progress: { completed: 3, total: 12, mean: 300 },
        previous: done,
      }),
      LABELS,
    )
      .body.map(toMarkup)
      .join("");
    assert.match(
      markup,
      /<div class="results-card-previous" role="group" aria-labelledby="results-card-previous-title"><h3 id="results-card-previous-title" class="results-card-previous-title">Previous average<\/h3>/,
    );
  });

  it("a failed batch says so", () => {
    const model = cardModel(state({ status: "error", error: "boom" }), LABELS);
    assert.equal(text(model.body), "The batch failed.");
  });
});

describe("the card's live fight line (#241)", () => {
  const live = (run, results) =>
    liveText({ run: { ...RUN, mode: "live", ...run }, results });
  it("is always there, with the live fight's DPS when it has one", () => {
    const fight = { time: 4, damage: 1000 };
    assert.equal(live({ state: "running" }, fight), "250.0 DPS so far");
    assert.equal(
      live({ state: "paused" }, fight),
      "250.0 DPS, paused at 00:04",
    );
    assert.equal(live({ state: "finished" }, fight), "250.0 DPS");
    assert.equal(live({ state: "idle" }, NO_FIGHT), "none yet");
    assert.equal(
      live({ state: "idle", stoppedAt: 12 }, NO_FIGHT),
      "stopped at 00:12",
    );
    assert.equal(
      cardModel(state({ status: "idle" }, { mode: "live" }), LABELS).live,
      "Live fight: none yet",
    );
  });

  it("in Batch mode it shows the live fight kept from before", () => {
    const batch = (run, results) =>
      liveText({ run: { ...RUN, state: "done", ...run }, results });
    assert.equal(batch({}, { time: 4, damage: 1000 }), "250.0 DPS");
    assert.equal(
      batch({ stoppedAt: 2 }, { time: 2, damage: 300 }),
      "stopped at 00:02",
    );
    assert.equal(batch({}, NO_FIGHT), "none yet");
  });
});
