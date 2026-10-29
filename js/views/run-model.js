import { k } from "../../data/constants.js";

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

// "1 minute 12" for 72.4 s, "12 seconds" under a minute: what is announced.
export function spokenTime(seconds) {
  const whole = Math.floor(Math.max(seconds, 0));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) {
    return `${rest} ${rest === 1 ? "second" : "seconds"}`;
  }
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ${rest}`;
}

function dpsText(damage, time) {
  return (time > 0 ? damage / time : 0).toFixed(1);
}

function secondsText(seconds) {
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

// The stats form's errors that count (#151): one per message. A Min marked
// by its Max's error (null message) is the Max's error, counted once, the way
// the form's footer counts them (js/views/config-form.js).
export function formErrorCount(form) {
  return Object.values(form?.errors ?? {}).filter((message) => message !== null)
    .length;
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
// a talent build over its cap (#204) or a rotation with errors (#217).
function blocked(state) {
  return (
    fieldErrors(state.run).length > 0 ||
    Object.keys(state.form?.errors ?? {}).length > 0 ||
    talentErrorCount(state) > 0 ||
    rotationErrorCount(state) > 0
  );
}

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
  if (talentsOnly(state)) {
    return `Can't run · ${TALENTS_OVER_CAP_SHORT}`;
  }
  return rotationOnly(state) ? `Can't run · ${ROTATION_ERRORS_SHORT}` : null;
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
    announce = `Paused at ${spokenTime(time)}`;
  } else if (status === "finished") {
    text = `Finished · ${secondsText(time)} s · ${dpsText(damage, time)} DPS`;
    announce = `Finished, ${dpsText(damage, time)} DPS`;
  } else if (run.stoppedAt !== null) {
    text = `Stopped at ${clock(run.stoppedAt)} · fight discarded · Run replays seed ${seedText(run.seed)} from 0:00`;
    announce = "Stopped";
  } else {
    text = `Ready · seed ${seedText(run.seed)}`;
    announce = "Ready";
  }
  const reason = !active && blocked(state) ? blockedReason(state) : null;
  return {
    run: {
      label: status === "finished" ? "Run again" : "Run",
      disabled: active || blocked(state),
    },
    reason,
    pause: {
      label: status === "paused" ? "Resume" : "Pause",
      pressed: status === "paused",
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
    const mean = result.summary.mean.toFixed(1);
    text = `${fightCount(result.completed)} · ${mean} DPS mean · Done`;
    announce = null;
  } else if (status === "cancelled") {
    const kept = `${grouped(result.completed)}/${compact(result.iterations)} ${fightsWord(result.iterations)} kept`;
    text =
      result.completed > 0
        ? `${kept} · ${result.summary.mean.toFixed(1)} DPS mean (partial) · Stopped`
        : `${kept} · Stopped`;
    announce = null;
  } else if (status === "error") {
    text = `Batch failed: ${batch.error.message}`;
    announce = null;
  } else {
    text = `Ready · ${fightCount(run.iterations)} · seed ${seedText(run.seed)}`;
    announce = "Ready";
  }
  const reason = !running && blocked(state) ? blockedReason(state) : null;
  return {
    run: { label: "Run batch", disabled: running || blocked(state) },
    reason,
    // Visible, never pressable: aria-disabled with the help line as the
    // reason, so a screen reader finds it and hears why.
    pause: { label: "Pause", pressed: false, disabled: false, inert: true },
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
