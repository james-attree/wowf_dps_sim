import { k } from "../../data/constants.js";
import { formatNumber } from "../charts.js";
import { isStale, staleStatus } from "./stale.js";

// What the run control bar (#153) shows, as plain data: the field rules, the
// buttons' labels and states, the status line, what a screen reader hears on
// a transition, and the help line. No DOM; js/views/controls.js draws it, and
// the tests walk every state through it.
//
// The bar has two modes. Live is one animated fight on the visualiser
// (js/live-run.js, SimRunner's states: idle, running, paused, finished).
// Batch is N fights through BatchClient (js/batch-client.js), with #154's
// statuses: idle, running, done, cancelled, error. run.state is the runner's
// state in live mode and batch.status in batch mode.
//
// Field rules. The fight length is a plain decimal number of seconds (no hex,
// binary or exponent, #155) from 1 to 3,600 s (UI rules, not game numbers, so
// not constants: the engine runs a 0 s fight to 0 DPS rather than an error,
// #154 §10, but a fight shorter than a global cooldown says nothing). Fights
// are a whole number from 1 to k("batch.maxIterations"). The seed is a whole number from 0 to 2^32 - 1, or
// empty: Run draws one then and fills it in.
export const MIN_FIGHT_SECONDS = 1;
export const MAX_FIGHT_SECONDS = 3600;
export const MAX_SEED = 4294967295;

export const LIVE_HELP =
  "Stop ends this fight and discards it. Run replays the same seed from 0:00.";
export const BATCH_HELP =
  "Batches can't pause. Stop keeps the fights done so far as a partial result.";

const WHOLE = /^\d+$/;
const DECIMAL = /^(\d+(\.\d*)?|\.\d+)$/;

// "100,000": comma thousands, the same in every locale.
export function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// "01:12" for 72.4 s.
export function clock(seconds) {
  const whole = Math.floor(Math.max(seconds, 0));
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
}

// "1 minute 12" for 72.4 s, "12 seconds" under a minute, "5 minutes" on the
// minute (#45, Fran: not "5 minutes 0"): what is announced.
export function spokenTime(seconds) {
  const whole = Math.floor(Math.max(seconds, 0));
  return spokenParts(Math.floor(whole / 60), whole % 60, String(whole % 60));
}

// The same to the tenth the combat log shows (#45, Scout: the arrow-step
// readout): "41.2 seconds", "1 minute 12.4", "5 minutes". A whole second
// drops its ".0": "41 seconds", "1 second".
export function spokenTenths(seconds) {
  const tenths = Math.floor(Math.max(seconds, 0) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return spokenParts(minutes, rest, String(rest));
}

function spokenParts(minutes, rest, restText) {
  if (minutes === 0) {
    return `${restText} ${rest === 1 ? "second" : "seconds"}`;
  }
  const lead = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return rest === 0 ? lead : `${lead} ${restText}`;
}

// #run-announce's numbers (#45, Fran's copy): damage whole with commas, DPS
// with commas to `decimals`.
function damageText(damage) {
  return formatNumber(Math.floor(damage), 0);
}

function dpsNumber(damage, time, decimals) {
  return formatNumber(time > 0 ? damage / time : 0, decimals);
}

// "Paused at 1 minute 23. Total damage 18,450. 219 DPS. Energy 41 of 100.
// Combo points 3 of 5." (#45, Fran): the one pause message, said once.
function pausedAnnouncement(state, time, damage) {
  const energy = state.resources?.energy;
  const combo = state.resources?.comboPoints;
  const energyText = `${Math.floor(energy?.value ?? 0)} of ${energy?.max ?? k("energy.max")}`;
  const comboText = `${combo?.value ?? 0} of ${combo?.max ?? k("combo.max")}`;
  return `Paused at ${spokenTime(time)}. Total damage ${damageText(damage)}. ${dpsNumber(damage, time, 0)} DPS. Energy ${energyText}. Combo points ${comboText}.`;
}

// The status line's DPS, to 1 dp with commas, as speech says it (U9 polish,
// Fran's #220 check): "2,541.1".
export function dpsText(damage, time) {
  return dpsNumber(damage, time, 1);
}

export function secondsText(seconds) {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

// One field's text read: { value, error }, error null when it is valid. An
// empty seed is valid, with value null.
export function parseRunField(name, text) {
  const trimmed = String(text).trim();
  if (name === "duration") {
    const value = DECIMAL.test(trimmed) ? Number(trimmed) : Number.NaN;
    return value >= MIN_FIGHT_SECONDS && value <= MAX_FIGHT_SECONDS
      ? { value, error: null }
      : {
          value: null,
          error: `Fight length must be a number of seconds from ${MIN_FIGHT_SECONDS} to ${grouped(MAX_FIGHT_SECONDS)}.`,
        };
  }
  if (name === "iterations") {
    const max = k("batch.maxIterations");
    const value = WHOLE.test(trimmed) ? Number(trimmed) : Number.NaN;
    return value >= 1 && value <= max
      ? { value, error: null }
      : {
          value: null,
          error: `Enter a whole number of fights from 1 to ${grouped(max)}.`,
        };
  }
  if (name === "seed") {
    if (trimmed === "") {
      return { value: null, error: null };
    }
    const value = WHOLE.test(trimmed) ? Number(trimmed) : Number.NaN;
    return value <= MAX_SEED
      ? { value, error: null }
      : {
          value: null,
          error: `Seed must be a whole number from 0 to ${grouped(MAX_SEED)}.`,
        };
  }
  throw new RangeError(`The run bar has no field ${JSON.stringify(name)}.`);
}

// True while the bar's fields and mode are locked: a live fight running or
// paused, or a batch running.
export function isLocked(run) {
  return run.state === "running" || run.state === "paused";
}

// The run fields with an error that counts in this mode, in the bar's order.
// Fights only count in batch mode: their field is hidden in live mode, so an
// error left there must not block a live Run where nobody can see or fix it.
export function fieldErrors(run) {
  const errors = run.errors ?? {};
  return ["duration", "iterations", "seed"].filter(
    (name) =>
      errors[name] !== undefined &&
      (name !== "iterations" || run.mode === "batch"),
  );
}

// The stats form's errors that count (#151, #237): the one count of them, so
// Run, the bar's Fix link and the form's footer (js/views/config-form.js)
// always agree. One per message: a Min marked by its Max's error (a null
// message) is the Max's error, counted once. FORM_ERROR, the normalizeConfig
// backstop, is one setting to fix; it only stands alone (js/config-form.js
// commit sets it when no field has an error).
export function formErrorCount(form) {
  return Object.values(form?.errors ?? {}).filter((message) => message !== null)
    .length;
}

// The form error to fix first (#247): the first with a message, the one the
// form's footer lists first. For Min above Max that is the Max, which holds
// the pair's message; the Min is only marked. Null when there is none.
export function firstFormError(form) {
  const found = Object.entries(form?.errors ?? {}).find(
    ([, message]) => message !== null,
  );
  return found === undefined ? null : found[0];
}

// The talent tree's build over its level's cap (#204): one setting to fix.
export const talentErrorCount = (state) =>
  typeof state.talents?.error === "string" ? 1 : 0;

// The rotation builder's draft with errors (#217, D17): one setting to fix,
// however many errors it has (Scout, 29 Oct). The form slice holds them.
export const rotationErrorCount = (state) =>
  (state.form?.rotationErrors?.length ?? 0) > 0 ? 1 : 0;

// Everything that blocks Run (#155, Fran's QA 1): the run fields with an
// error in this mode, the stats form's errors, the talent tree's (#204) and
// the rotation's (#217).
export function blockedCount(state) {
  return (
    fieldErrors(state.run).length +
    formErrorCount(state.form) +
    talentErrorCount(state) +
    rotationErrorCount(state)
  );
}

// Run is blocked by an invalid run field, an invalid stats form field (#151),
// a talent build over its cap (#204) or a rotation with errors (#217): by
// exactly what blockedCount counts, so it never says "0 settings to fix"
// (#237).
export const blocked = (state) => blockedCount(state) > 0;

// "1 fight", "4 fights" (#155, Fran's QA 5: never "1 fights").
const fightsWord = (count) => (count === 1 ? "fight" : "fights");
const fightCount = (count) => `${grouped(count)} ${fightsWord(count)}`;

const settings = (count) => `${count} ${count === 1 ? "setting" : "settings"}`;

// The status while Run is blocked (#155): never "Ready" then. When the only
// thing to fix is a talent build over its level's cap, it says so (#204,
// Fran's QA of #208).
export const TALENTS_OVER_CAP = "Talents over the level cap";

// The narrow sticky row (below NARROW_QUERY) is one compact row, 64 px or
// less: two 22 px lines beside the buttons (#153). The full reason does not
// fit its line at 390 px and wrapping it would add a third line, so the row
// shows this shorter text instead. The full one stays in #run-reason, which
// Run's aria-describedby names, and the status text itself is aria-hidden.
export const TALENTS_OVER_CAP_SHORT = "Talents over cap";

// When the only thing to fix is the rotation (#217, D17): "Rotation has 4
// errors", and its short form for the narrow row (Scout, 29 Oct).
export const rotationErrorsText = (count) =>
  `Rotation has ${count} ${count === 1 ? "error" : "errors"}`;
export const ROTATION_ERRORS_SHORT = "Rotation errors";

// `only` names the one thing to fix when there is just one: true for the
// talents (#204), or a rotation error count (#217).
export function blockedText(count, only = false) {
  if (only === true) {
    return `Can't run · ${TALENTS_OVER_CAP}`;
  }
  if (typeof only === "number") {
    return `Can't run · ${rotationErrorsText(only)}`;
  }
  return `Can't run · ${settings(count)} to fix`;
}

const talentsOnly = (state) => {
  const talents = talentErrorCount(state);
  return talents > 0 && blockedCount(state) === talents;
};

const rotationOnly = (state) => {
  const rotation = rotationErrorCount(state);
  return rotation > 0 && blockedCount(state) === rotation;
};

// The out-of-date banner's and card's title while Run is blocked (#245,
// Fran's #254 check), or null when it is not: what to fix, not "Run again",
// which Run cannot do yet. "Out of date — fix 2 settings, then Run again."
export function staleFixTitle(state) {
  if (!blocked(state)) {
    return null;
  }
  const what = rotationOnly(state)
    ? "the rotation"
    : talentsOnly(state)
      ? "the talents"
      : settings(blockedCount(state));
  return `Out of date — fix ${what}, then Run again.`;
}

function blockedReason(state) {
  if (rotationOnly(state)) {
    return blockedText(1, state.form.rotationErrors.length);
  }
  return blockedText(blockedCount(state), talentsOnly(state));
}

// The narrow row's shorter status, or null when the status fits as it is.
function narrowStatus(state, reason) {
  if (reason === null) {
    return null;
  }
  // The short reason alone (#242, Fran's #252 note): "Can't run" is said by
  // Run's state and the full reason in #run-reason.
  if (talentsOnly(state)) {
    return TALENTS_OVER_CAP_SHORT;
  }
  return rotationOnly(state) ? ROTATION_ERRORS_SHORT : null;
}

// "100k" for 100,000, "1.5k" for 1,500, "999" under a thousand: the total of
// a running batch, short enough for the narrow row (#155).
export function compact(value) {
  if (value < 1000) {
    return String(value);
  }
  return `${+(value / 1000).toFixed(1)}k`;
}

function seedText(seed) {
  return seed === null ? "new at Run" : String(seed);
}

function liveModel(state) {
  const { run, results } = state;
  const status = run.state;
  const active = status === "running" || status === "paused";
  const time = results?.time ?? 0;
  const damage = results?.damage ?? 0;
  let text;
  let announce;
  if (status === "running") {
    text = `Running · ${clock(time)} / ${clock(run.duration)}`;
    announce = "Running";
  } else if (status === "paused") {
    text = `Paused at ${clock(time)}`;
    announce = pausedAnnouncement(state, time, damage);
  } else if (status === "finished") {
    text = `Finished · ${secondsText(time)} s · ${dpsText(damage, time)} DPS`;
    // A natural finish says the set fight length (#45, Scout).
    announce = `Finished at ${spokenTime(run.duration)}. Total damage ${damageText(damage)}. ${dpsNumber(damage, time, 1)} DPS.`;
  } else if (run.stoppedAt !== null) {
    text = `Stopped at ${clock(run.stoppedAt)} · fight discarded · Run replays seed ${seedText(run.seed)} from 0:00`;
    announce = `Stopped at ${spokenTime(run.stoppedAt)}. Fight discarded.`;
  } else {
    text = `Ready · seed ${seedText(run.seed)}`;
    announce = "Ready";
  }
  const stale = !active && isStale(state, "live");
  if (stale) {
    text = staleStatus(state, "live");
  }
  const reason = !active && blocked(state) ? blockedReason(state) : null;
  return {
    run: {
      label: status === "finished" || stale ? "Run again" : "Run",
      disabled: active || blocked(state),
    },
    reason,
    pause: {
      label: status === "paused" ? "Resume" : "Pause",
      resume: status === "paused",
      disabled: !active,
      inert: false,
    },
    stop: { label: "Stop and discard", disabled: !active },
    reset: { disabled: !active && status !== "finished" && !run.shown },
    locked: active,
    help: LIVE_HELP,
    status: reason ?? text,
    statusShort: narrowStatus(state, reason),
    announce,
    progress: null,
  };
}

function batchModel(state) {
  const { run, batch } = state;
  const status = batch.status;
  const running = status === "running";
  const total = batch.progress?.total ?? run.iterations;
  const completed = batch.progress?.completed ?? 0;
  const result = batch.result;
  let text;
  let announce;
  // The totals lead (#155): the narrow row cuts the end of the line off.
  // The results panel's live region says each of these (#154 §9), so the bar
  // stays quiet for them and only says Ready (#155: no announcement twice).
  if (running) {
    text = `${grouped(completed)}/${compact(total)} ${fightsWord(total)} · Running batch`;
    announce = null;
  } else if (status === "done") {
    const mean = formatNumber(result.summary.mean, 1);
    text = `${fightCount(result.completed)} · ${mean} DPS mean · Done`;
    announce = null;
  } else if (status === "cancelled") {
    const kept = `${grouped(result.completed)}/${compact(result.iterations)} ${fightsWord(result.iterations)} kept`;
    text =
      result.completed > 0
        ? `${kept} · ${formatNumber(result.summary.mean, 1)} DPS mean (partial) · Stopped`
        : `${kept} · Stopped`;
    announce = null;
  } else if (status === "error") {
    text = `Batch failed: ${batch.error.message}`;
    announce = null;
  } else {
    text = `Ready · ${fightCount(run.iterations)} · seed ${seedText(run.seed)}`;
    announce = "Ready";
  }
  // An average run with other settings than today's (#242).
  const stale = !running && isStale(state, "batch");
  if (stale) {
    text = staleStatus(state, "batch");
  }
  const reason = !running && blocked(state) ? blockedReason(state) : null;
  return {
    run: {
      label: stale ? "Run again" : "Run batch",
      disabled: running || blocked(state),
    },
    reason,
    // Visible, never pressable: aria-disabled with the help line as the
    // reason, so a screen reader finds it and hears why.
    pause: { label: "Pause", resume: false, disabled: false, inert: true },
    stop: { label: "Stop and keep partial", disabled: !running },
    reset: {
      disabled: running || (result === null && batch.error === null),
    },
    locked: running,
    help: BATCH_HELP,
    status: reason ?? text,
    statusShort: narrowStatus(state, reason),
    announce,
    progress: running
      ? {
          value: completed,
          max: total,
          text: `${grouped(completed)} of ${fightCount(total)}`,
        }
      : null,
  };
}

// The narrow bar's one-line summary of the next run's settings (Scout, #153):
// "Live · 300 s · seed 1234" or "Batch · 1,000 × 300 s · seed 1234". It
// follows the fields as they are typed; a field with an error shows "?".
export function summaryText(run) {
  const bad = new Set(fieldErrors(run));
  const part = (name, text) => (bad.has(name) ? "?" : text);
  const seconds = part("duration", `${secondsText(run.duration)}`);
  const seed = part("seed", seedText(run.seed));
  if (run.mode === "batch") {
    const fights = part("iterations", grouped(run.iterations));
    return `Batch · ${fights} × ${seconds} s · seed ${seed}`;
  }
  return `Live · ${seconds} s · seed ${seed}`;
}

// An out-of-date result (#242): what the dock's status says.
export const STALE_SHORT = "⟳ Out of date";

// The phone dock's two lines (#240, UX2; proposal section 4), short enough
// to fit beside the DPS and two buttons on the narrowest phones: the summary
// without the seed ("Live · 300 s", "Batch · 1k × 300 s"), and a status
// that leaves out what the summary, the DPS readout or the results say (a
// live fight's length, a finished batch's total). The long lines, "Ready ·
// seed …" and the blocked reason, only come with no DPS beside them.
// Blocked, it is the narrow row's short reason ("Talents over cap") or
// "Can't run", over the "Fix N settings" link. A kept result of the mode's
// that ran with other settings says it is out of date (#242).
export function dockText(state) {
  const { run, batch, results } = state;
  const bad = new Set(fieldErrors(run));
  const part = (name, text) => (bad.has(name) ? "?" : text);
  const seconds = `${part("duration", secondsText(run.duration))} s`;
  const summary =
    run.mode === "batch"
      ? `Batch · ${part("iterations", compact(run.iterations))} × ${seconds}`
      : `Live · ${seconds}`;
  const model = controlsModel(state);
  if (model.reason !== null) {
    return { summary, status: model.statusShort ?? "Can't run" };
  }
  const ready = `Ready · seed ${seedText(run.seed)}`;
  if (!isLocked(run) && isStale(state, run.mode)) {
    return { summary, status: STALE_SHORT };
  }
  if (run.mode === "batch") {
    const result = batch.result;
    const total = batch.progress?.total ?? run.iterations;
    const completed = batch.progress?.completed ?? 0;
    const statuses = {
      running: () => `Running · ${compact(completed)}/${compact(total)}`,
      done: () =>
        `Done · ${compact(result.completed)} ${fightsWord(result.completed)}`,
      cancelled: () => `Stopped · ${compact(result.completed)}`,
      error: () => "Batch failed",
    };
    return { summary, status: statuses[batch.status]?.() ?? ready };
  }
  const time = results?.time ?? 0;
  const statuses = {
    running: () => `Running · ${clock(time)}`,
    paused: () => `Paused at ${clock(time)}`,
    finished: () => `Finished · ${secondsText(time)} s`,
  };
  const stopped =
    run.stoppedAt === null ? ready : `Stopped at ${clock(run.stoppedAt)}`;
  return { summary, status: statuses[run.state]?.() ?? stopped };
}

// The dock's DPS readout (#240): the live fight's DPS while it runs, is
// paused or has finished, or a batch's mean once it has fights ("DPS avg");
// a dash before then, and while a setting blocks Run (the strip's room goes
// to why).
export const NO_DPS = "—";
export function dockDps(state) {
  const { run, batch, results } = state;
  const blocked = controlsModel(state).reason !== null;
  if (run.mode === "batch") {
    const result = batch.result;
    const has =
      (batch.status === "done" || batch.status === "cancelled") &&
      result?.completed > 0;
    // No mean yet: the dash's label is the live one's, so the idle dock
    // keeps its room for "Ready · seed …" in Batch mode too (#242, the
    // page now opens in Batch).
    if (!has || blocked) {
      return { value: NO_DPS, label: "DPS" };
    }
    return {
      value: formatNumber(result.summary.mean, 1),
      // Out of date: "was, avg", the proposal's order (#245, Fran's #254
      // check).
      label: isStale(state, "batch") ? "was, avg" : "DPS avg",
    };
  }
  const time = results?.time ?? 0;
  const shown =
    !blocked && ["running", "paused", "finished"].includes(run.state);
  return {
    value: shown && time > 0 ? dpsText(results.damage ?? 0, time) : NO_DPS,
    label:
      shown && !isLocked(run) && isStale(state, "live") ? "DPS was" : "DPS",
  };
}

// The bar's link to the first setting with an error, at every width (#155),
// or null when there are none: "Fix 1 setting". It counts the run fields'
// errors and the stats form's (formCount, from formErrorCount).
export function errorsText(run, formCount = 0) {
  const count = fieldErrors(run).length + formCount;
  if (count === 0) {
    return null;
  }
  return `Fix ${settings(count)}`;
}

// The bar's link to the rotation's warnings (#243, UX5; proposal P5:
// "Ready · ⚠ 1 rotation warning"), or null: while nothing blocks Run and
// nothing runs, as the builder shows them (only with no errors). It goes to
// the Rotation messages, under the area's h1.
export function warningsText(state, blocked) {
  const count =
    (state.form?.rotationErrors?.length ?? 0) === 0
      ? (state.form?.rotationWarnings?.length ?? 0)
      : 0;
  if (count === 0 || blocked || isLocked(state.run)) {
    return null;
  }
  return `⚠ ${count} rotation ${count === 1 ? "warning" : "warnings"}`;
}

// Everything the bar draws, from the store's state.
export function controlsModel(state) {
  return state.run.mode === "batch" ? batchModel(state) : liveModel(state);
}

// What changes the announcement: the mode and the state, and whether an idle
// live fight was stopped. The ticking time is never announced.
export function announceKey(state) {
  const { run } = state;
  if (run.mode === "batch") {
    return `batch:${state.batch.status}`;
  }
  return `live:${run.state}:${run.stoppedAt !== null}`;
}

// Where focus goes after a transition: "pause" once a live fight runs,
// "stop" once a batch runs, "run" once a fight or batch ends or is reset.
export function focusTarget(state) {
  const { run } = state;
  if (run.mode === "batch") {
    return state.batch.status === "running" ? "stop" : "run";
  }
  return run.state === "running" || run.state === "paused" ? "pause" : "run";
}
