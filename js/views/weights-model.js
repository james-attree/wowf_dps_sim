// The Stat weights Results view's plain data (issue #282). No DOM: the
// tests run it in Node. The engine stays out of this module (no
// js/stat-weights.js, no attack table); the host stores jobs and the cap
// note, and this file formats them.
//
// Fran's ten decisions, each a coordinator call 15 Nov (James delegated):
//  1. Idle copy covers the default run only (no Precise).
//  2. A cancel marks the table stale only if the build changed.
//  3. Rows sort by AP equivalent, engine order as tie-break.
//  4. 2 dp per point and ±, 1 dp AP equivalent.
//  5. The ± column folds below 64em (CSS).
//  6. Text stands alone, with an aria-hidden CI bar from 64em up.
//  7. Fight length and seed go in the label and do not make the table stale.
//  8. The previous table hides during a run.
//  9. The done announcement is just "Stat weights finished."
// 10. Missing rows show "Not measured".

import { k } from "../../data/constants.js";
import { formatNumber } from "../charts.js";
import { timeEstimate } from "./results-render.js";
import {
  compact,
  fieldErrors,
  NO_BREAK_SPACE,
  formErrorCount,
  grouped,
  rotationErrorCount,
  secondsText,
  seedPart,
  staleFixTitle,
  talentErrorCount,
  unitPart,
  WEIGHTS_KEEP_AWAKE,
  WEIGHTS_WAKE_FALLBACK,
  weightsProgress,
  weightsRunning,
} from "./run-model.js";

import { ranClock, ranOf, staleBanner } from "./stale.js";

export const WEIGHTS_DPS_DECIMALS = 2;
export const WEIGHTS_AP_DECIMALS = 1;
export const WEIGHTS_RUNTIME_SECONDS = 73;
export const WEIGHTS_PROGRESS_MARKS = Object.freeze([0.25, 0.5, 0.75]);
export const WEIGHTS_ROW_IDS = Object.freeze([
  "attackPower",
  "mainHand",
  "offHand",
  "crit",
  "hit",
  "haste",
]);
export const MINUS_SIGN = "−";
export const MISSING_FIGURE = "—";
export const NOT_MEASURED = "Not measured";
export const WEIGHTS_STALE_ANNOUNCEMENT = "Stat weights out of date.";
export const WEIGHTS_DONE_ANNOUNCEMENT = "Stat weights finished.";
export const WEIGHTS_CANCEL_ANNOUNCEMENT = "Stat weights cancelled.";
export const WEIGHTS_FAILED_ANNOUNCEMENT = "Stat weights failed.";
export const WEIGHTS_HELP =
  "Cancel throws away this calculation; the last finished table stays, marked out of date if you changed the build.";
export const WEIGHTS_IDLE_LABEL = "Stat weights · none yet";
export const WEIGHTS_RUNNING_LABEL = "Stat weights · running";
export const WEIGHTS_INTRO_AP_EXAMPLE = 19.2;
export const WEIGHTS_INTRO_AP_ABOUT = 19;
const PERCENT = 100;
const HUNDRED = 100;
const FIRST = 0;
const ONE = 1;
const ZERO = 0;
const CHANCE_FIELDS = Object.freeze({
  crit: "critChance",
  hit: "bonusHitChance",
  haste: "haste",
});
const BOUND_NAMES = Object.freeze({
  crit: "crit",
  hit: "hit",
  haste: "haste",
});
const CENTRAL = Object.freeze(["crit", "hit", "haste"]);

const fightsWord = (count) => (count === ONE ? "fight" : "fights");

const emptyWeights = (slice) =>
  slice ?? {
    status: "idle",
    progress: null,
    startedAt: null,
    elapsedMs: 0,
    result: null,
    error: null,
    jobs: [],
  };

export function weightsRuntimeCopy() {
  return `About ${WEIGHTS_RUNTIME_SECONDS} s on a desktop. On a phone, longer. Background tabs and a sleeping phone slow it down.`;
}

export function weightsStartAnnouncement() {
  return `Stat weights started. About ${WEIGHTS_RUNTIME_SECONDS} s on a desktop.`;
}

function stepOf(id) {
  if (id === "attackPower") {
    return k("statWeights.attackPower");
  }
  if (id === "mainHand" || id === "offHand") {
    return k("statWeights.weaponDps");
  }
  if (id === "crit") {
    return k("statWeights.crit");
  }
  if (id === "hit") {
    return k("statWeights.hit");
  }
  return k("statWeights.haste");
}

function isChance(id) {
  return id === "crit" || id === "hit" || id === "haste";
}

function formatStep(id, sign) {
  const step = stepOf(id);
  if (isChance(id)) {
    const points = step / k("statWeights.onePercent");
    const n = formatNumber(points, ZERO);
    const signed = sign < ZERO ? `${MINUS_SIGN}${n}` : `+${n}`;
    return `${signed}%`;
  }
  const n = formatNumber(step, ZERO);
  return sign < ZERO ? `${MINUS_SIGN}${n}` : `+${n}`;
}

export function variantLabel(job) {
  if (job == null || job.id === "base") {
    return "Base";
  }
  const { id, sign } = job;
  const step = formatStep(id, sign);
  if (id === "attackPower") {
    return `Attack power ${step}`;
  }
  if (id === "mainHand") {
    return `Main-hand weapon DPS ${step}`;
  }
  if (id === "offHand") {
    return `Off-hand weapon DPS ${step}`;
  }
  if (id === "crit") {
    return `Crit ${step}`;
  }
  if (id === "hit") {
    return `Hit ${step}`;
  }
  return `Haste ${step}`;
}

export const WEIGHTS_ROW_LABELS = Object.freeze({
  attackPower: "Attack power (per 1)",
  mainHand: "Main-hand weapon DPS (per 1)",
  offHand: "Off-hand weapon DPS (per 1)",
  crit: "Crit (per 1%)",
  hit: "Hit (per 1%)",
  haste: "Haste (per 1%)",
});

// Short names for the desktop column card (#283). coordinator call 15 Nov
// (James delegated): every measured row, in table sort order (AP equivalent
// descending), 1 decimal place, no ellipsis. The issue's "AP 1 · crit 19.2
// · hit 14.8 …" line is the shape, not a different order or a cap on rows.
export const WEIGHTS_CARD_NAMES = Object.freeze({
  attackPower: "AP",
  mainHand: "MH",
  offHand: "OH",
  crit: "crit",
  hit: "hit",
  haste: "haste",
});

// coordinator call 15 Nov (James delegated), condition on decision 4:
// a card that stays during a re-run is marked as the previous result, in
// one line (the Average card's greyed "Previous average" block is heavier
// than this compact line needs). The stale short is omitted while running,
// as the Average card hides its stale line mid-batch. Progress uses the
// same weightsProgress / compact source as the dock.
export function weightsCardLine(state) {
  const result = state.weights?.result ?? null;
  const record = ranOf(state, "weights");
  if (result === null || record === null) {
    return null;
  }
  const parts = sortWeightRows(result.rows)
    .filter((row) => row.data != null && Number.isFinite(row.data.apEquivalent))
    .map(
      (row) =>
        `${WEIGHTS_CARD_NAMES[row.id]} ${formatNumber(row.data.apEquivalent, WEIGHTS_AP_DECIMALS)}`,
    );
  if (parts.length === ZERO) {
    return null;
  }
  const at = ranClock(record.at);
  // Non-breaking space so "(ran at 10:02)" does not wrap before the time
  // (coordinator call 15 Nov, James delegated; Fran's #377 N3).
  const clock = at === null ? "" : ` (ran at${NO_BREAK_SPACE}${at})`;
  const figures = `${parts.join(" · ")}${clock}`;
  if (weightsRunning(state)) {
    const { completed, total } = weightsProgress(state);
    return `Stat weights running · ${compact(completed)}/${compact(total)} · Previous: ${figures}`;
  }
  const stale = staleBanner(state, "weights");
  const note = stale === null ? "" : ` · ${stale.short}`;
  return `Stat weights: ${figures}${note}`;
}

export function weightsKeepAwake(state) {
  return state.weights?.status === "running" &&
    state.weights?.wakeLock === WEIGHTS_WAKE_FALLBACK
    ? WEIGHTS_KEEP_AWAKE
    : null;
}

export function formatDpsPerPoint(value) {
  return value == null || !Number.isFinite(value)
    ? MISSING_FIGURE
    : formatNumber(value, WEIGHTS_DPS_DECIMALS);
}

export function formatCi(value) {
  return value == null || !Number.isFinite(value)
    ? MISSING_FIGURE
    : formatNumber(value, WEIGHTS_DPS_DECIMALS);
}

export function formatApEquivalent(value) {
  if (value == null || !Number.isFinite(value)) {
    return MISSING_FIGURE;
  }
  return `= ${formatNumber(value, WEIGHTS_AP_DECIMALS)} AP`;
}

export function foldedDps(dps, ci) {
  const point = formatDpsPerPoint(dps);
  if (point === MISSING_FIGURE) {
    return point;
  }
  const half = formatCi(ci);
  if (half === MISSING_FIGURE) {
    return point;
  }
  return `${point} ± ${half}`;
}

// Decision 6: the bar is decorative. Width is the half-width relative to
// |dpsPerPoint|, capped at 100% of the cell.
export function ciBarPercent(dpsPerPoint, ci) {
  if (
    ci == null ||
    !Number.isFinite(ci) ||
    dpsPerPoint == null ||
    !Number.isFinite(dpsPerPoint)
  ) {
    return null;
  }
  const abs = Math.abs(dpsPerPoint);
  if (abs === ZERO) {
    return ci > ZERO ? HUNDRED : ZERO;
  }
  return Math.min(HUNDRED, (ci / abs) * PERCENT);
}

// Decision 3: AP equivalent descending, engine order as the tie-break.
// null / Not measured last, still in engine order among themselves.
export function sortWeightRows(rows) {
  const source = rows ?? {};
  return WEIGHTS_ROW_IDS.map((id, index) => ({
    id,
    index,
    data: source[id] ?? null,
  })).sort((a, b) => {
    const ae = a.data?.apEquivalent;
    const be = b.data?.apEquivalent;
    const aMissing = ae == null || !Number.isFinite(ae);
    const bMissing = be == null || !Number.isFinite(be);
    if (aMissing && bMissing) {
      return a.index - b.index;
    }
    if (aMissing) {
      return ONE;
    }
    if (bMissing) {
      return -ONE;
    }
    if (be !== ae) {
      return be - ae;
    }
    return a.index - b.index;
  });
}

function signsOf(jobs, id) {
  return (jobs ?? []).filter((job) => job.id === id).map((job) => job.sign);
}

function boundReason(id, config) {
  const field = CHANCE_FIELDS[id];
  if (field === undefined) {
    return null;
  }
  const value = config?.character?.[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const name = BOUND_NAMES[id];
  if (value === ZERO) {
    return `(${name} is 0)`;
  }
  if (value === ONE) {
    return `(${name} is 100%)`;
  }
  return null;
}

export function oneSidedNote(id, jobs, config) {
  if (!CENTRAL.includes(id)) {
    return null;
  }
  const signs = signsOf(jobs, id);
  if (signs.length !== ONE) {
    return null;
  }
  const step = formatStep(id, signs[FIRST]);
  const bound = boundReason(id, config);
  const extra = bound !== null ? ` ${bound}` : "";
  return `One-sided · ${step} only${extra}`;
}

function percentPointsText(fraction, decimals) {
  const points = fraction / k("statWeights.onePercent");
  const places = Number.isInteger(points) ? ZERO : decimals;
  return `${formatNumber(points, places)}%`;
}

export function capNoteText(note) {
  if (note == null) {
    return null;
  }
  const cap = percentPointsText(note.cap, ONE);
  const hit = percentPointsText(note.hit, ONE);
  const step = percentPointsText(note.step, ZERO);
  return `The yellow-hit cap is ${cap} at this target level. This build is at ${hit}, and hit is still measured ±${step}, so the two sides are not the same slope.`;
}

export function weightsIntro(result) {
  const fights = grouped(result.iterations);
  const variants = grouped(result.variants);
  const example = formatNumber(WEIGHTS_INTRO_AP_EXAMPLE, WEIGHTS_AP_DECIMALS);
  return `How much DPS one more point of each stat adds, from ${fights} paired fights across ${variants} variants. “= ${example} AP” means 1% crit is worth about ${formatNumber(WEIGHTS_INTRO_AP_ABOUT, ZERO)} attack power.`;
}
function leftoverEstimate(completed, total, elapsedMs) {
  if (!(elapsedMs > ZERO) || !(completed > ZERO)) {
    return null;
  }
  const estimate = timeEstimate(completed, total, elapsedMs);
  const about = "about ";
  const at = estimate.indexOf(about);
  if (at < ZERO) {
    return null;
  }
  const rest = estimate.slice(at + about.length);
  if (rest.startsWith("0 ")) {
    return null;
  }
  return `About ${rest}`;
}

export function progressMarksReached(completed, total) {
  if (!(total > ZERO)) {
    return [];
  }
  return WEIGHTS_PROGRESS_MARKS.filter((mark) => completed / total >= mark);
}

export function weightsAnnounceKey(state) {
  const weights = emptyWeights(state.weights);
  if (weights.status === "running") {
    const completed = weights.progress?.completed ?? ZERO;
    const total = weights.progress?.total ?? ZERO;
    const marks = progressMarksReached(completed, total).join(",");
    return `running:${marks}`;
  }
  if (
    weights.status === "done" ||
    weights.status === "cancelled" ||
    weights.status === "error"
  ) {
    return weights.status;
  }
  return "idle";
}

export function weightsAnnounce(state) {
  const weights = emptyWeights(state.weights);
  if (weights.status === "running") {
    const completed = weights.progress?.completed ?? ZERO;
    const total = weights.progress?.total ?? ZERO;
    const marks = progressMarksReached(completed, total);
    if (marks.length === ZERO) {
      return weightsStartAnnouncement();
    }
    const last = marks[marks.length - ONE];
    const percent = formatNumber(last * PERCENT, ZERO);
    let text = `Stat weights ${percent}% done. Variant ${grouped(completed)} of ${grouped(total)}.`;
    const left = leftoverEstimate(completed, total, weights.elapsedMs ?? ZERO);
    if (left !== null) {
      text = `${text} ${left}`;
    }
    return text;
  }
  if (weights.status === "done") {
    return WEIGHTS_DONE_ANNOUNCEMENT;
  }
  if (weights.status === "cancelled") {
    return WEIGHTS_CANCEL_ANNOUNCEMENT;
  }
  if (weights.status === "error") {
    return WEIGHTS_FAILED_ANNOUNCEMENT;
  }
  return null;
}

export function tableRows(result, jobs, config) {
  return sortWeightRows(result?.rows).map((row) => {
    const measured = row.data != null;
    const oneSided = oneSidedNote(row.id, jobs ?? result?.jobs, config);
    return {
      id: row.id,
      label: WEIGHTS_ROW_LABELS[row.id],
      measured,
      dps: measured ? formatDpsPerPoint(row.data.dpsPerPoint) : NOT_MEASURED,
      ci: measured ? formatCi(row.data.ci) : NOT_MEASURED,
      folded: measured
        ? foldedDps(row.data.dpsPerPoint, row.data.ci)
        : NOT_MEASURED,
      ap: measured ? formatApEquivalent(row.data.apEquivalent) : NOT_MEASURED,
      bar: measured ? ciBarPercent(row.data.dpsPerPoint, row.data.ci) : null,
      oneSided,
      capFlag: false,
    };
  });
}

function safeErrorMessage(error) {
  const text = String(error?.message ?? "").trim();
  if (text === "" || text.includes("\n")) {
    return null;
  }
  return text;
}

function weightsLabel(state) {
  const weights = emptyWeights(state.weights);
  if (weights.status === "running") {
    return WEIGHTS_RUNNING_LABEL;
  }
  const record = ranOf(state, "weights");
  const result = weights.result;
  if (record === null || result === null) {
    return WEIGHTS_IDLE_LABEL;
  }
  const parts = [
    "Stat weights",
    `${grouped(result.iterations)} × ${unitPart(secondsText(record.duration))} ${fightsWord(result.iterations)}`,
    seedPart(record.seed),
  ];
  const at = ranClock(record.at);
  if (at !== null) {
    parts.push(`ran at ${at}`);
  }
  return parts.join(" · ");
}

function caption(result, record) {
  const seed = record?.seed ?? result?.seed;
  return `Stat weights, ${grouped(result.iterations)} ${fightsWord(result.iterations)}, ${seedPart(seed)}`;
}

function currentJob(weights) {
  const completed = weights.progress?.completed ?? ZERO;
  const jobs = weights.jobs ?? [];
  if (completed <= ZERO || jobs.length === ZERO) {
    return null;
  }
  return jobs[completed - ONE] ?? null;
}

function progressModel(weights) {
  if (weights.status !== "running") {
    return null;
  }
  const total = weights.progress?.total ?? ZERO;
  const completed = weights.progress?.completed ?? ZERO;
  const job = currentJob(weights);
  const name = job !== null ? variantLabel(job) : null;
  const of = `${grouped(completed)} of ${grouped(total)}`;
  const valueText =
    name !== null ? `${of} variants, ${name}` : `${of} variants`;
  const visible = name !== null ? `Variant ${of} · ${name}` : `Variant ${of}`;
  return {
    completed,
    total,
    valueText,
    line: visible,
    estimate: timeEstimate(completed, total, weights.elapsedMs ?? ZERO),
  };
}

function buttonLabel(status, hasTable) {
  if (status === "running") {
    return "Cancel";
  }
  return hasTable ? "Run stat weights again" : "Run stat weights";
}

// coordinator call 15 Nov (James delegated): an invalid Fights field does
// not block Run stat weights, because the calculation always uses 1,000
// fights. Duration, seed, and real build errors still do. Average keeps
// using blocked() / fieldErrors, which still count Fights in batch mode.
export function weightsBlocked(state) {
  const fields = fieldErrors(state.run).filter((name) => name !== "iterations");
  return (
    fields.length +
      formErrorCount(state.form) +
      talentErrorCount(state) +
      rotationErrorCount(state) >
    0
  );
}

// coordinator call 15 Nov (James delegated): the cap note is computed
// from the settings the table was run with, so a stale table's note
// matches its figures.
export function weightsCapConfig(state) {
  return ranOf(state, "weights")?.config ?? null;
}

function statusLine(weights, hasTable) {
  // P1 (#376, Fran): a successful run keeps a visible status heading
  // so focus can land on it (spec section 7). Same words as the live
  // announcement; the heading is not itself a live region.
  if (weights.status === "done") {
    return WEIGHTS_DONE_ANNOUNCEMENT;
  }
  if (weights.status === "cancelled") {
    return hasTable
      ? "Calculation cancelled. The last finished table is still shown."
      : "Calculation cancelled. Nothing was kept.";
  }
  if (weights.status === "error") {
    return hasTable
      ? "Stat weights failed. The last finished table is unchanged."
      : "Stat weights failed.";
  }
  return null;
}

// capNote is { cap, hit, step } from the host, or null. Computed from
// ran.weights.config (weightsCapConfig), so a stale table's note matches
// its figures. coordinator call 15 Nov (James delegated).
export function weightsModel(state, { capNote = null } = {}) {
  const weights = emptyWeights(state.weights);
  const running = weights.status === "running";
  const result = weights.result;
  const record = ranOf(state, "weights");
  const hasTable = result !== null && record !== null;
  // Decision 8: hide the previous table while a new run is in progress.
  const showTable = hasTable && !running;
  const fix = weightsBlocked(state) ? staleFixTitle(state) : null;
  const stale = showTable ? staleBanner(state, "weights", fix) : null;
  const jobs = result?.jobs ?? weights.jobs;
  const cap = showTable ? capNoteText(capNote) : null;
  const rows = showTable
    ? tableRows(result, jobs, record.config).map((row) => ({
        ...row,
        capFlag: Boolean(cap) && row.id === "hit" && row.measured,
      }))
    : [];
  return {
    status: weights.status,
    label: weightsLabel(state),
    estimate: hasTable || running ? null : weightsRuntimeCopy(),
    intro: showTable ? weightsIntro(result) : null,
    help: WEIGHTS_HELP,
    button: buttonLabel(weights.status, hasTable || running),
    cancelling: running,
    blocked: weightsBlocked(state),
    stale,
    statusText: statusLine(weights, hasTable),
    errorDetail:
      weights.status === "error" ? safeErrorMessage(weights.error) : null,
    progress: progressModel(weights),
    showTable,
    caption: showTable ? caption(result, record) : null,
    rows,
    capNote: cap,
    keepAwake: weightsKeepAwake(state),
  };
}
