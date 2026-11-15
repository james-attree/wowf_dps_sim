import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { referenceBuild } from "../data/reference-build.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { emptyRan, emptyWeights } from "../js/run-actions.js";
import { weightsCapNote } from "../js/weights-support.js";
import { blocked, WEIGHTS_KEEP_AWAKE } from "../js/views/run-model.js";
import {
  NOT_MEASURED,
  WEIGHTS_DONE_ANNOUNCEMENT,
  WEIGHTS_HELP,
  capNoteText,
  ciBarPercent,
  foldedDps,
  formatApEquivalent,
  formatCi,
  formatDpsPerPoint,
  oneSidedNote,
  sortWeightRows,
  variantLabel,
  weightsAnnounce,
  weightsAnnounceKey,
  weightsIntro,
  weightsModel,
  weightsBlocked,
  weightsCapConfig,
  weightsCardLine,
  weightsKeepAwake,
  weightsRuntimeCopy,
  weightsStartAnnouncement,
} from "../js/views/weights-model.js";
import { parseRoute } from "../js/views/router.js";
import { APP_TITLE, titleFor } from "../js/views/router.js";
import { isStale, ranOf } from "../js/views/stale.js";
import { viewOf } from "../js/views/result-views.js";

const AT = new Date(2026, 10, 15, 9, 12).getTime();
const ITERATIONS = 1000;
const DURATION = 300;
const SEED = 107;
const NINE = 9;
const MS = 1000;

const jobs = [
  { id: "base", sign: 0 },
  { id: "attackPower", sign: 1 },
  { id: "mainHand", sign: 1 },
  { id: "offHand", sign: 1 },
  { id: "crit", sign: 1 },
  { id: "crit", sign: -1 },
  { id: "hit", sign: 1 },
  { id: "hit", sign: -1 },
  { id: "haste", sign: 1 },
];

const rows = {
  attackPower: { dpsPerPoint: 1, ci: 0.05, apEquivalent: 1 },
  mainHand: { dpsPerPoint: 2.5, ci: 0.1, apEquivalent: 2.5 },
  offHand: { dpsPerPoint: 2.5, ci: 0.2, apEquivalent: 2.5 },
  crit: { dpsPerPoint: 19.23, ci: 0.4, apEquivalent: 19.23 },
  hit: { dpsPerPoint: 1.67, ci: 0.167, apEquivalent: 1.67 },
};

function resultOf(over = {}) {
  return {
    seed: SEED,
    iterations: ITERATIONS,
    variants: NINE,
    rows,
    jobs,
    ...over,
  };
}

function state({
  status = "done",
  result = resultOf(),
  config = pageDefaultConfig(),
  now = config,
  duration = DURATION,
  progress = null,
  error = null,
  elapsedMs = 0,
} = {}) {
  return {
    config: now,
    form: { errors: {} },
    route: { area: "results", sub: "weights", param: null },
    run: {
      mode: "batch",
      state: "idle",
      seed: SEED,
      duration,
      iterations: 5,
      errors: {},
      fields: {},
    },
    weights: {
      ...emptyWeights(),
      status,
      result,
      jobs: result?.jobs ?? jobs,
      progress,
      error,
      elapsedMs,
    },
    ran: {
      ...emptyRan(),
      weights:
        result === null
          ? null
          : {
              config,
              seed: SEED,
              duration,
              iterations: ITERATIONS,
              at: AT,
            },
    },
  };
}

describe("stat weights model (#282)", () => {
  it("the weights route is a Results sub-screen with its own title", () => {
    const route = parseRoute("#results/weights");
    assert.deepEqual(route, {
      area: "results",
      sub: "weights",
      param: null,
    });
    assert.equal(viewOf(route), "weights");
    assert.equal(titleFor(route), `Stat weights · ${APP_TITLE}`);
    assert.equal(viewOf(parseRoute("#results")), "average");
    assert.equal(viewOf(parseRoute("#results/other")), "average");
  });

  it("Decision 3: rows sort by AP equivalent, engine order as tie-break", () => {
    const ordered = sortWeightRows(rows).map((row) => row.id);
    assert.deepEqual(ordered, [
      "crit",
      "mainHand",
      "offHand",
      "hit",
      "attackPower",
      "haste",
    ]);
  });

  // Kira N1 from #376: a fixture where DPS-per-point order and AP-equivalent
  // order differ, so a mutant that sorts by DPS per point fails.
  it("Kira N1 (#376): sort is by AP equivalent, not DPS per point", () => {
    const mixed = {
      attackPower: { dpsPerPoint: 2, ci: 0.1, apEquivalent: 1 },
      haste: { dpsPerPoint: 8, ci: 0.2, apEquivalent: 0.4 },
      crit: { dpsPerPoint: 5, ci: 0.2, apEquivalent: 2.5 },
      hit: { dpsPerPoint: 3, ci: 0.1, apEquivalent: 1.5 },
    };
    assert.deepEqual(
      sortWeightRows(mixed).map((row) => row.id),
      ["crit", "hit", "attackPower", "haste", "mainHand", "offHand"],
    );
    const byDps = [...sortWeightRows(mixed)].sort((a, b) => {
      const ae = a.data?.dpsPerPoint;
      const be = b.data?.dpsPerPoint;
      const aMissing = ae == null || !Number.isFinite(ae);
      const bMissing = be == null || !Number.isFinite(be);
      if (aMissing && bMissing) {
        return a.index - b.index;
      }
      if (aMissing) {
        return 1;
      }
      if (bMissing) {
        return -1;
      }
      return be - ae;
    });
    assert.notDeepEqual(
      byDps.map((row) => row.id),
      sortWeightRows(mixed).map((row) => row.id),
    );
  });

  it("Decision 4: 2 dp per point and ±, 1 dp AP equivalent", () => {
    assert.equal(formatDpsPerPoint(1.67), "1.67");
    assert.equal(formatDpsPerPoint(1.67), "1.67");
    assert.equal(formatCi(0.167), "0.17");
    assert.equal(formatApEquivalent(19.23), "= 19.2 AP");
    assert.equal(formatApEquivalent(1), "= 1.0 AP");
    assert.equal(foldedDps(2.34, 0.12), "2.34 ± 0.12");
  });

  it("shows Not measured: no off hand when that row carries the reason", () => {
    const bare = {
      ...rows,
      offHand: { reason: "Not measured: no off hand" },
    };
    const model = weightsModel(
      state({ result: resultOf({ rows: bare, variants: 8 }) }),
    );
    const off = model.rows.find((row) => row.id === "offHand");
    assert.equal(off.measured, false);
    assert.equal(off.dps, "Not measured: no off hand");
    assert.equal(off.ci, "Not measured: no off hand");
    assert.equal(off.ap, "Not measured: no off hand");
    assert.equal(off.bar, null);
  });

  it("Decision 10: a missing row shows Not measured and sorts last", () => {
    const model = weightsModel(state());
    const haste = model.rows.find((row) => row.id === "haste");
    assert.equal(haste.dps, NOT_MEASURED);
    assert.equal(haste.ci, NOT_MEASURED);
    assert.equal(haste.ap, NOT_MEASURED);
    assert.equal(haste.folded, NOT_MEASURED);
    assert.equal(model.rows.at(-1).id, "haste");
  });

  it("Decision 8: the previous table hides during a run", () => {
    const running = weightsModel(
      state({
        status: "running",
        progress: { completed: 0, total: NINE },
      }),
    );
    assert.equal(running.showTable, false);
    assert.equal(running.progress.line, "Variant 0 of 9");
    assert.equal(running.button, "Cancel");
    assert.equal(running.label, "Stat weights · running");
    const done = weightsModel(state({ status: "done" }));
    assert.equal(done.showTable, true);
    assert.equal(done.rows.length, 6);
  });

  it("Decision 9: the done announcement is just Stat weights finished.", () => {
    assert.equal(
      weightsAnnounce(state({ status: "done" })),
      WEIGHTS_DONE_ANNOUNCEMENT,
    );
    assert.equal(WEIGHTS_DONE_ANNOUNCEMENT, "Stat weights finished.");
  });

  it("statusLine on done is Stat weights finished. (#376 P1)", () => {
    const done = weightsModel(state({ status: "done" }));
    assert.equal(done.statusText, "Stat weights finished.");
    assert.equal(done.statusText, weightsAnnounce(state({ status: "done" })));
  });

  it("Decision 1: idle copy covers the default run only", () => {
    const idle = weightsModel(state({ status: "idle", result: null }));
    assert.equal(idle.estimate, weightsRuntimeCopy());
    assert.match(idle.estimate, /About 73 s on a desktop/);
    assert.doesNotMatch(idle.estimate, /Precise/);
    assert.equal(idle.intro, null);
    assert.equal(idle.help, WEIGHTS_HELP);
    assert.doesNotMatch(idle.help, /can't pause/);
    assert.equal(idle.button, "Run stat weights");
  });

  it("Decision 2 and 7: cancel and run fields do not, by themselves, mark stale", () => {
    const same = pageDefaultConfig();
    const cancelled = state({ status: "cancelled", config: same, now: same });
    assert.equal(isStale(cancelled, "weights"), false);
    const model = weightsModel(cancelled);
    assert.equal(model.stale, null);
    assert.match(model.statusText, /last finished table is still shown/);
    const longer = state({
      status: "done",
      config: same,
      now: same,
      duration: DURATION + DURATION,
    });
    longer.run.duration = DURATION + DURATION;
    longer.run.seed = SEED + SEED;
    assert.equal(isStale(longer, "weights"), false);
    const edited = pageDefaultConfig();
    edited.character = { ...edited.character, attackPower: 1600 };
    const stale = state({ status: "cancelled", config: same, now: edited });
    assert.equal(isStale(stale, "weights"), true);
    assert.ok(weightsModel(stale).stale);
  });

  it("a kept table is out of date only when ran.weights.config changed", () => {
    const s = state();
    assert.equal(ranOf(s, "weights") !== null, true);
    assert.equal(isStale(s, "weights"), false);
  });

  it("Decision 6: the CI bar is a capped percentage of |dpsPerPoint|", () => {
    assert.equal(ciBarPercent(2, 1), 50);
    assert.equal(ciBarPercent(1, 2), 100);
    assert.equal(ciBarPercent(0, 1), 100);
    assert.equal(ciBarPercent(1.67, 0.167), 10);
  });

  it("variant labels use a minus sign and the constant steps", () => {
    assert.equal(variantLabel({ id: "base", sign: 0 }), "Base");
    assert.equal(
      variantLabel({ id: "attackPower", sign: 1 }),
      "Attack power +50",
    );
    assert.equal(
      variantLabel({ id: "mainHand", sign: 1 }),
      "Main-hand weapon DPS +2",
    );
    assert.equal(variantLabel({ id: "crit", sign: -1 }), "Crit −1%");
    assert.equal(variantLabel({ id: "hit", sign: 1 }), "Hit +2%");
    assert.equal(variantLabel({ id: "haste", sign: -1 }), "Haste −2%");
  });

  it("a one-sided haste row states the side that ran and the bound", () => {
    const config = pageDefaultConfig();
    assert.equal(config.character.haste, 0);
    assert.equal(
      oneSidedNote("haste", jobs, config),
      "One-sided · +2% only (haste is 0)",
    );
    const model = weightsModel(state());
    const haste = model.rows.find((row) => row.id === "haste");
    assert.equal(haste.oneSided, "One-sided · +2% only (haste is 0)");
  });

  it("announcements fire at start and when progress crosses 25, 50 and 75%", () => {
    const start = state({
      status: "running",
      progress: { completed: 0, total: NINE },
    });
    assert.equal(weightsAnnounceKey(start), "running:");
    assert.equal(weightsAnnounce(start), weightsStartAnnouncement());
    const at25 = state({
      status: "running",
      progress: { completed: 3, total: NINE },
      elapsedMs: 0,
    });
    assert.equal(weightsAnnounceKey(at25), "running:0.25");
    assert.equal(
      weightsAnnounce(at25),
      "Stat weights 25% done. Variant 3 of 9.",
    );
    const at50 = state({
      status: "running",
      progress: { completed: 5, total: NINE },
      elapsedMs: 8 * MS,
    });
    assert.match(
      weightsAnnounce(at50),
      /^Stat weights 50% done\. Variant 5 of 9/,
    );
    const at75 = state({
      status: "running",
      progress: { completed: 7, total: NINE },
      elapsedMs: 20 * MS,
    });
    assert.match(
      weightsAnnounce(at75),
      /^Stat weights 75% done\. Variant 7 of 9/,
    );
    const mid = state({
      status: "running",
      progress: { completed: 4, total: NINE },
    });
    assert.equal(weightsAnnounceKey(mid), "running:0.25");
  });

  it("the intro uses the result's fight and variant counts", () => {
    const intro = weightsIntro(resultOf());
    assert.match(intro, /1,000 paired fights across 9 variants/);
    assert.match(intro, /= 19\.2 AP/);
  });

  it("the done label includes fights, duration, seed and the ran clock", () => {
    const model = weightsModel(state());
    assert.match(model.label, /Stat weights · 1,000 × 300\s+s fights/);
    assert.match(model.label, /seed/);
    assert.match(model.label, /107/);
    assert.match(model.label, /ran at 09:12/);
    assert.equal(model.button, "Run stat weights again");
    assert.match(model.caption, /Stat weights, 1,000 fights, seed/);
    assert.match(model.caption, /107/);
  });

  it("the cap note copy fills cap, build hit and the ± window", () => {
    const text = capNoteText({ cap: 0.09, hit: 0.1, step: 0.02 });
    assert.equal(
      text,
      "The yellow-hit cap is 9% at this target level. This build is at 10%, and hit is still measured ±2%, so the two sides are not the same slope.",
    );
  });

  it("cancel with no table and an error have the signed-off status lines", () => {
    const empty = weightsModel(state({ status: "cancelled", result: null }));
    assert.equal(empty.statusText, "Calculation cancelled. Nothing was kept.");
    assert.equal(empty.showTable, false);
    const failed = weightsModel(
      state({
        status: "error",
        result: null,
        error: { name: "Error", message: "worker failed" },
      }),
    );
    assert.equal(failed.statusText, "Stat weights failed.");
    assert.equal(failed.errorDetail, "worker failed");
    const kept = weightsModel(
      state({
        status: "error",
        error: { name: "Error", message: "worker failed" },
      }),
    );
    assert.equal(
      kept.statusText,
      "Stat weights failed. The last finished table is unchanged.",
    );
  });

  it("a stale table keeps the cap note from the run's config after hit or levels change", () => {
    const ranWith = { ...pageDefaultConfig(), talents: referenceBuild() };
    ranWith.character = { ...ranWith.character };
    const afterLevel = structuredClone(ranWith);
    afterLevel.target = { ...afterLevel.target, level: 60 };
    const afterHit = structuredClone(ranWith);
    afterHit.character = { ...afterHit.character, bonusHitChance: 0 };
    const ranNote = capNoteText(weightsCapNote(ranWith));
    assert.match(ranNote, /The yellow-hit cap is 9%/);
    assert.match(ranNote, /This build is at 10%/);
    assert.notEqual(capNoteText(weightsCapNote(afterLevel)), ranNote);
    assert.notEqual(capNoteText(weightsCapNote(afterHit)), ranNote);
    for (const now of [afterLevel, afterHit]) {
      const s = state({ config: ranWith, now, status: "done" });
      assert.equal(isStale(s, "weights"), true);
      assert.equal(weightsCapConfig(s), ranWith);
      const model = weightsModel(s, {
        capNote: weightsCapNote(weightsCapConfig(s)),
      });
      assert.equal(model.capNote, ranNote);
      assert.ok(model.stale);
    }
  });

  it("an invalid Fights field does not block Run stat weights; Average stays blocked", () => {
    const s = state({ status: "idle", result: null });
    s.run = {
      ...s.run,
      mode: "batch",
      errors: {
        iterations: "Enter a whole number of fights from 1 to 100,000.",
      },
    };
    assert.equal(blocked(s), true);
    assert.equal(weightsBlocked(s), false);
    assert.equal(weightsModel(s).blocked, false);
  });

  it("a real build error still blocks Run stat weights", () => {
    const duration = state({ status: "idle", result: null });
    duration.run = {
      ...duration.run,
      errors: {
        duration: "Fight length must be a number of seconds from 1 to 3,600.",
      },
    };
    assert.equal(weightsBlocked(duration), true);
    assert.equal(weightsModel(duration).blocked, true);
    const build = state({ status: "idle", result: null });
    build.form = {
      errors: {
        "character.attackPower": "Attack power must be a whole number.",
      },
    };
    assert.equal(blocked(build), true);
    assert.equal(weightsBlocked(build), true);
    assert.equal(weightsModel(build).blocked, true);
  });
});

describe("stat weights across screens (#283)", () => {
  it("the desktop card lists measured rows in AP-equivalent order, with the ran clock", () => {
    const line = weightsCardLine(state());
    assert.equal(
      line,
      "Stat weights: crit 19.2 · MH 2.5 · OH 2.5 · hit 1.7 · AP 1.0 (ran at 09:12)",
    );
    assert.equal(
      weightsCardLine(state({ status: "idle", result: null })),
      null,
    );
  });

  it("a re-run marks the last finished card as previous, without the stale short", () => {
    const running = state({
      status: "running",
      progress: { completed: 3, total: 9 },
    });
    assert.equal(
      weightsCardLine(running),
      "Stat weights running · 3/9 · Previous: crit 19.2 · MH 2.5 · OH 2.5 · hit 1.7 · AP 1.0 (ran at 09:12)",
    );
    const staleRunning = state({
      status: "running",
      progress: { completed: 3, total: 9 },
      now: { ...pageDefaultConfig(), character: { attackPower: 200 } },
    });
    assert.equal(weightsCardLine(staleRunning), weightsCardLine(running));
    const stale = state({
      now: { ...pageDefaultConfig(), character: { attackPower: 200 } },
    });
    assert.match(weightsCardLine(stale), /changed after this ran\.$/);
    assert.equal(
      weightsCardLine(
        state({
          status: "running",
          result: null,
          progress: { completed: 1, total: 9 },
        }),
      ),
      null,
    );
  });

  it("the keep-awake line shows only when a run is going and the lock fell back", () => {
    const running = state({
      status: "running",
      result: null,
      progress: { completed: 1, total: 9 },
    });
    running.weights.wakeLock = "fallback";
    assert.equal(weightsKeepAwake(running), WEIGHTS_KEEP_AWAKE);
    assert.equal(weightsModel(running).keepAwake, WEIGHTS_KEEP_AWAKE);
    running.weights.wakeLock = "held";
    assert.equal(weightsKeepAwake(running), null);
    const done = state();
    done.weights.wakeLock = "fallback";
    assert.equal(weightsKeepAwake(done), null);
  });
});
