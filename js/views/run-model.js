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
// Field rules. The fight length is more than 0 and at most 3,600 s (a UI rule,
// not a game number, so not a constant: a 0 s fight gives 0 DPS rather than an
// error, #154 §10). Fights are a whole number from 1 to
// k("batch.maxIterations"). The seed is a whole number from 0 to 2^32 - 1, or
// empty: Run draws one then and fills it in.
export const MAX_FIGHT_SECONDS = 3600;
export const MAX_SEED = 4294967295;

export const LIVE_HELP =
  "Stop ends this fight and discards it. Run replays the same seed from 0:00.";
export const BATCH_HELP =
  "Batches can't pause. Stop keeps the fights done so far as a partial result.";

const WHOLE = /^\d+$/;

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
    const value = trimmed === "" ? Number.NaN : Number(trimmed);
    return Number.isFinite(value) && value > 0 && value <= MAX_FIGHT_SECONDS
      ? { value, error: null }
      : {
          value: null,
          error: `Fight length must be more than 0 and at most ${grouped(MAX_FIGHT_SECONDS)} seconds.`,
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

// Run is blocked by an invalid run field or an invalid stats form field (#151).
function blocked(state) {
  return (
    fieldErrors(state.run).length > 0 ||
    Object.keys(state.form?.errors ?? {}).length > 0
  );
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
  return {
    run: {
      label: status === "finished" ? "Run again" : "Run",
      disabled: active || blocked(state),
    },
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
    status: text,
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
  if (running) {
    text = `Running batch · ${grouped(completed)} of ${grouped(total)} fights`;
    announce = `Batch running, ${grouped(total)} fights`;
  } else if (status === "done") {
    const mean = result.summary.mean.toFixed(1);
    text = `Done · ${grouped(result.completed)} fights · ${mean} DPS mean`;
    announce = `Batch done, ${mean} DPS`;
  } else if (status === "cancelled") {
    const kept = `${grouped(result.completed)} of ${grouped(result.iterations)} fights kept`;
    text =
      result.completed > 0
        ? `Stopped · ${kept} · ${result.summary.mean.toFixed(1)} DPS mean (partial)`
        : `Stopped · ${kept}`;
    announce = `Batch stopped, ${kept}`;
  } else if (status === "error") {
    text = `Batch failed: ${batch.error.message}`;
    announce = text;
  } else {
    text = `Ready · ${grouped(run.iterations)} fights · seed ${seedText(run.seed)}`;
    announce = "Ready";
  }
  return {
    run: { label: "Run batch", disabled: running || blocked(state) },
    // Visible, never pressable: aria-disabled with the help line as the
    // reason, so a screen reader finds it and hears why.
    pause: { label: "Pause", pressed: false, disabled: false, inert: true },
    stop: { label: "Stop and keep partial", disabled: !running },
    reset: {
      disabled: running || (result === null && batch.error === null),
    },
    locked: running,
    help: BATCH_HELP,
    status: text,
    announce,
    progress: running
      ? {
          value: completed,
          max: total,
          text: `${grouped(completed)} of ${grouped(total)} fights`,
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

// The narrow bar's link to the settings with an error, or null when there
// are none: "Fix 1 setting".
export function errorsText(run) {
  const count = fieldErrors(run).length;
  if (count === 0) {
    return null;
  }
  return `Fix ${count} ${count === 1 ? "setting" : "settings"}`;
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
