import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { referenceBuild } from "../data/reference-build.js";
import { runBatch } from "../js/batch-runner.js";
import { buildLabel } from "../js/build-label.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { createRunActions, emptyBatch, emptyRan } from "../js/run-actions.js";
import { createStore } from "../js/store.js";
import { toMarkup } from "../js/svg.js";
import { cardModel } from "../js/views/results-card.js";
import { resultViewsModel, viewOf } from "../js/views/result-views.js";
import { followRoute, parseRoute, formatRoute } from "../js/views/router.js";
import { STALE_SHORT, dockDps, dockText } from "../js/views/run-model.js";
import { resultsStatus } from "../js/views/sections.js";
import {
  STALE_ANNOUNCEMENT,
  anyStale,
  changedNames,
  isStale,
  namesText,
  ranClock,
  staleBanner,
  staleKinds,
  staleStatus,
} from "../js/views/stale.js";

// #242 (UX4): Results keeps two results, the average and the live fight,
// each with its own label, out-of-date banner and Run buttons.

const config = () => ({ ...pageDefaultConfig(), talents: referenceBuild() });
const OPTIONS = { seed: 242, iterations: 6, duration: 30 };
const AT = new Date(2026, 9, 30, 9, 12).getTime();
const text = (nodes) =>
  nodes
    .map(toMarkup)
    .join("")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

let done;
before(() => {
  done = runBatch({ ...OPTIONS, config: config() });
});

const RUN = {
  mode: "batch",
  state: "idle",
  seed: OPTIONS.seed,
  duration: OPTIONS.duration,
  iterations: OPTIONS.iterations,
  stoppedAt: null,
  snapshot: null,
  shown: false,
  errors: {},
  fields: {},
};
const record = (cfg, extra = {}) => ({
  config: cfg,
  seed: OPTIONS.seed,
  duration: OPTIONS.duration,
  iterations: OPTIONS.iterations,
  at: AT,
  ...extra,
});

// A state with a finished average and a finished live fight, both run with
// `ranWith`, and `now` as today's settings.
function state({ ranWith = config(), now = ranWith, ...over } = {}) {
  return {
    config: now,
    form: { errors: {} },
    route: { area: "results", sub: null, param: null },
    run: { ...RUN, shown: true, state: "finished" },
    batch: { ...emptyBatch("worker"), status: "done", result: done },
    results: { time: 30, damage: 30000 },
    ran: { batch: record(ranWith), live: record(ranWith) },
    talents: {},
    rotationBuilder: {},
    ...over,
  };
}
const edited = () => {
  const now = config();
  now.character = { ...now.character, attackPower: 1234 };
  return now;
};

describe("stale state (#242)", () => {
  it("a kept result is out of date only when its settings changed", () => {
    assert.equal(anyStale(state()), false);
    const s = state({ now: edited() });
    assert.deepEqual(staleKinds(s), ["batch", "live"]);
    assert.equal(isStale(s, "batch"), true);
  });

  it("the run fields do not make a result out of date", () => {
    const s = state({ run: { ...RUN, shown: true, duration: 99, seed: 1 } });
    assert.equal(anyStale(s), false);
  });

  it("no result, nothing out of date", () => {
    const s = state({ now: edited(), ran: emptyRan() });
    assert.equal(anyStale(s), false);
    const noFights = state({
      now: edited(),
      batch: emptyBatch("worker"),
      run: { ...RUN, shown: false },
    });
    assert.deepEqual(staleKinds(noFights), []);
  });

  it("names what changed, two at most", () => {
    const a = config();
    const b = edited();
    assert.deepEqual(changedNames(a, b), ["Attack power"]);
    assert.equal(namesText([]), "the settings");
    assert.equal(namesText(["A", "B"]), "A and B");
    assert.equal(namesText(["A", "B", "C"]), "A, B and other settings");
  });

  it("the banner's copy", () => {
    const banner = staleBanner(state({ now: edited() }), "batch");
    assert.deepEqual(banner, {
      title: "Out of date — Run again.",
      detail:
        "You changed Attack power after this ran, so these numbers are for the old settings.",
      short: "Attack power changed after this ran.",
    });
    assert.equal(staleBanner(state(), "batch"), null);
  });

  it("the run bar's status and the announcement", () => {
    const s = state({ now: edited() });
    assert.equal(ranClock(AT), "09:12");
    assert.equal(ranClock(null), null);
    assert.equal(
      staleStatus(s, "batch"),
      "Out of date · edited after the 09:12 run",
    );
    assert.equal(STALE_ANNOUNCEMENT, "Results out of date");
  });

  it("the Results badge says edited while a result is out of date", () => {
    assert.equal(resultsStatus(state()).edited, false);
    assert.equal(resultsStatus(state({ now: edited() })).edited, true);
  });

  it("the dock says out of date for the mode's result", () => {
    const s = state({ now: edited() });
    assert.equal(dockText(s).status, STALE_SHORT);
    assert.equal(dockDps(s).label, "avg, was");
    assert.equal(dockText(state()).status.startsWith("Done"), true);
  });
});

describe("Results views (#242)", () => {
  it("the route picks the view, Average by default", () => {
    assert.equal(viewOf(parseRoute("#results")), "average");
    assert.equal(viewOf(parseRoute("#results/average")), "average");
    assert.equal(viewOf(parseRoute("#results/live")), "live");
    assert.equal(viewOf(parseRoute("#results/other")), "average");
    assert.equal(
      formatRoute({ area: "results", sub: "live" }),
      "#results/live",
    );
  });

  it("each view has its own label", () => {
    const model = resultViewsModel(state());
    assert.equal(
      model.average.label,
      "Average · 6 × 30 s fights · seed\u00a0242 · ran at 09:12",
    );
    assert.equal(
      model.live.label,
      "Live fight · 30 s · seed\u00a0242 · ran at 09:12 · finished",
    );
    // "seed" and its number are joined by a no-break space (#245, P5).
    assert.doesNotMatch(model.average.label, /seed 242/);
    // Its totals are the fight's own readouts now (#245), shown once it
    // has started.
    assert.equal(model.live.empty, false);
  });

  it("before any run both say none yet", () => {
    const model = resultViewsModel(
      state({
        ran: emptyRan(),
        batch: emptyBatch("worker"),
        run: { ...RUN },
        results: { time: 0, damage: 0 },
      }),
    );
    assert.equal(model.average.label, "Average · none yet");
    assert.equal(model.live.label, "Live fight · none yet");
    assert.equal(model.live.empty, true);
    assert.equal(model.average.run, "Run average");
    assert.equal(model.live.run, "Watch fight");
  });

  it("out of date, the buttons say run again", () => {
    const model = resultViewsModel(state({ now: edited() }));
    assert.equal(model.average.stale.title, "Out of date — Run again.");
    assert.equal(model.average.run, "Run average again");
    assert.equal(model.live.run, "Watch again");
  });

  it("a running batch is the Average's", () => {
    const model = resultViewsModel(
      state({
        batch: { ...emptyBatch("worker"), status: "running" },
        run: { ...RUN, state: "running", shown: true },
      }),
    );
    assert.equal(model.average.label, "Average · running");
    assert.equal(model.locked, true);
  });
});

describe("Run moves to the result it makes (#242)", () => {
  const idle = { run: { mode: "batch", state: "idle" } };
  const running = (mode) => ({
    run: { mode, state: "running" },
    batch: { status: mode === "batch" ? "running" : "idle" },
  });
  it("an average shows Results' Average view, from Live too", () => {
    const route = { area: "results", sub: "live" };
    assert.deepEqual(followRoute(idle, running("batch"), route), {
      area: "results",
      sub: null,
      param: null,
      run: true,
    });
    assert.equal(
      followRoute(idle, running("batch"), { area: "results", sub: null }),
      null,
    );
  });
  // A live fight shows Results' Live view (#245, UX7), where its meters
  // and combat log are, from any area or the Average view.
  it("a live fight shows Results' Live view", () => {
    for (const route of [
      { area: "results", sub: null },
      { area: "results", sub: "average" },
      { area: "fight", sub: null },
      { area: "character", sub: null },
    ]) {
      assert.deepEqual(followRoute(idle, running("live"), route), {
        area: "results",
        sub: "live",
        param: null,
        run: true,
      });
    }
    assert.equal(
      followRoute(idle, running("live"), { area: "results", sub: "live" }),
      null,
    );
  });
});

describe("the card mid-run and out of date (#242, N7)", () => {
  it("shows the progress, the running average and the previous average", () => {
    const s = state({
      batch: {
        ...emptyBatch("worker"),
        status: "running",
        progress: { completed: 3, total: 6, mean: 1234.5 },
        previous: done,
      },
      run: { ...RUN, state: "running" },
    });
    const body = text(cardModel(s, { buildLabel }).body);
    assert.match(body, /^Running batch · 3 of 6 fights/);
    assert.match(body, /Running average 1,234\.5 DPS/);
    assert.match(body, /Previous average/);
    assert.doesNotMatch(body, /Out of date/);
  });

  it("a first batch has no previous average", () => {
    const s = state({
      batch: {
        ...emptyBatch("worker"),
        status: "running",
        progress: { completed: 0, total: 6, mean: null },
      },
      run: { ...RUN, state: "running" },
    });
    const body = text(cardModel(s, { buildLabel }).body);
    assert.doesNotMatch(body, /Previous average|Running average/);
  });

  it("says when its average is out of date", () => {
    const model = cardModel(state({ now: edited() }), { buildLabel });
    assert.match(
      text(model.body),
      /^Out of date — Run again\. Attack power changed after this ran\./,
    );
    assert.match(model.live, / · out of date$/);
    assert.doesNotMatch(
      text(cardModel(state(), { buildLabel }).body),
      /Out of date/,
    );
  });
});

describe("runAs and the kept runs (#242)", () => {
  function setup() {
    const store = createStore({
      ...state({ ran: emptyRan(), batch: emptyBatch("worker") }),
      run: { ...RUN },
    });
    const calls = [];
    const live = { run: (options) => calls.push(["live", options]) };
    const client = {
      mode: "worker",
      running: false,
      run: (options) => {
        calls.push(["batch", options]);
        return new Promise(() => {});
      },
    };
    const actions = createRunActions({
      store,
      live,
      client,
      drawSeed: () => 7,
      now: () => 0,
      stamp: () => AT,
    });
    return { store, actions, calls };
  }

  it("runAs sets the mode, then runs it", () => {
    const { store, actions, calls } = setup();
    actions.runAs("live");
    assert.equal(store.get().run.mode, "live");
    assert.equal(calls[0][0], "live");
    assert.equal(store.get().ran.live.at, AT);
    assert.equal(store.get().ran.batch, null);
  });

  it("a live run keeps the average's record, and the reverse", () => {
    const { store, actions } = setup();
    store.set({ ran: { batch: record(config()), live: null } });
    actions.runAs("live");
    assert.notEqual(store.get().ran.batch, null);
    assert.notEqual(store.get().ran.live, null);
  });
});
