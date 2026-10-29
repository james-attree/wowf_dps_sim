import { nextRunConfig } from "./config-form.js";

// The control bar's actions (#153): what Run, Pause, Stop, Reset, the mode
// toggle, the fields and "New seed" do to the page's store (js/store.js). The
// bar (js/views/controls.js) calls these and never writes the store itself.
// No DOM and no clock: the host hands in the live run (js/live-run.js), a
// BatchClient (js/batch-client.js), drawSeed() for a random uint32 and now()
// in milliseconds for the batch's elapsed time.
//
//   const actions = createRunActions({ store, live, client, drawSeed, now });
//
// The run slice:
//   mode        "live" | "batch"
//   state       the live runner's state in live mode (written by js/live-run.js),
//               batch.status in batch mode (written here)
//   seed        the seed field's value, null while empty (Run draws one)
//   duration    fight length in seconds, both modes
//   iterations  fights per batch
//   fields      { duration, iterations, seed }: the fields' text
//   errors      { field: message } for each invalid field
//   stoppedAt   the time a live fight was stopped at, else null
//   shown       true once a live fight has started, until Reset
//   snapshot    the config of the fight or batch on the page, else null
//
// The batch slice is #154's (docs/design 154 §10):
//   { status, progress, startedAt, elapsedMs, result, error, previous, mode }
//
// Config applies to the next run: Run snapshots nextRunConfig(state)
// (js/config-form.js), and the fight or batch keeps it.
export function emptyBatch(mode) {
  return {
    status: "idle",
    progress: null,
    startedAt: null,
    elapsedMs: 0,
    result: null,
    error: null,
    previous: null,
    mode,
  };
}

export function createRunActions({ store, live, client, drawSeed, now }) {
  const run = () => store.get().run;
  const setRun = (patch) =>
    store.update((state) => ({ run: { ...state.run, ...patch } }));
  const setBatch = (patch) =>
    store.update((state) => ({ batch: { ...state.batch, ...patch } }));
  const locked = () => run().state === "running" || run().state === "paused";

  // A field error that blocks Run in this mode. Fights only count in batch
  // mode, where their field is shown (js/views/run-model.js fieldErrors).
  const blocking = ({ mode, errors }) =>
    Object.keys(errors).some(
      (name) => name !== "iterations" || mode === "batch",
    );

  // The config for Run, with the seed drawn and shown if the field is empty;
  // null when a field is invalid.
  function prepare() {
    const state = store.get();
    const config = nextRunConfig(state);
    if (config === null || blocking(state.run)) {
      return null;
    }
    let { seed } = state.run;
    if (seed === null) {
      seed = drawSeed();
      setRun({ seed, fields: { ...state.run.fields, seed: String(seed) } });
    }
    return { config, seed };
  }

  function runLive() {
    if (locked()) {
      return;
    }
    const prepared = prepare();
    if (prepared === null) {
      return;
    }
    const { duration } = run();
    store.batch(() => {
      setRun({ stoppedAt: null, shown: true, snapshot: prepared.config });
      live.run({ seed: prepared.seed, duration, config: prepared.config });
    });
  }

  function runBatch() {
    if (client.running || locked()) {
      return;
    }
    const prepared = prepare();
    if (prepared === null) {
      return;
    }
    const { duration, iterations } = run();
    // At once, before any message: running, 0 of N, the last result greyed.
    store.batch(() => {
      store.update((state) => ({
        batch: {
          ...emptyBatch(client.mode),
          status: "running",
          progress: { completed: 0, total: iterations, mean: null },
          startedAt: now(),
          previous: state.batch.result,
        },
      }));
      setRun({ state: "running", snapshot: prepared.config });
    });
    let settled = false;
    const startedAt = store.get().batch.startedAt;
    const settle = (patch) => {
      settled = true;
      store.batch(() => {
        setBatch({
          ...patch,
          previous: null,
          elapsedMs: now() - startedAt,
          mode: client.mode,
        });
        if (run().mode === "batch") {
          setRun({ state: patch.status });
        }
      });
    };
    client
      .run(
        { seed: prepared.seed, iterations, duration, config: prepared.config },
        {
          onProgress(progress) {
            if (settled) {
              return;
            }
            setBatch({
              progress: { ...progress },
              previous: null,
              elapsedMs: now() - startedAt,
              mode: client.mode,
            });
          },
        },
      )
      .then(
        (result) =>
          settle({
            status: result.cancelled ? "cancelled" : "done",
            result,
            progress: {
              completed: result.completed,
              total: result.iterations,
              mean: result.completed > 0 ? result.summary.mean : null,
            },
          }),
        (error) =>
          settle({
            status: "error",
            error: {
              name: error?.name ?? "Error",
              message: String(error?.message ?? error),
            },
          }),
      );
  }

  return {
    run() {
      if (run().mode === "batch") {
        runBatch();
      } else {
        runLive();
      }
    },
    pause() {
      if (run().mode === "live" && run().state === "running") {
        live.pause();
      }
    },
    resume() {
      if (run().mode === "live" && run().state === "paused") {
        live.resume();
      }
    },
    // Live: discard the fight, keep its picture (dimmed) and where it stopped.
    // Batch: cancel; the partial result arrives as "cancelled".
    stop() {
      if (run().mode === "batch") {
        if (client.running) {
          client.cancel();
        }
        return;
      }
      if (!locked()) {
        return;
      }
      store.batch(() => {
        setRun({ stoppedAt: store.get().results.time, snapshot: null });
        live.stop();
      });
    },
    // Live: back to an empty fight at 0:00. Batch: forget the result.
    reset() {
      if (run().mode === "batch") {
        if (client.running) {
          return;
        }
        store.batch(() => {
          store.set({ batch: emptyBatch(client.mode) });
          setRun({ state: "idle", snapshot: null });
        });
        return;
      }
      store.batch(() => {
        if (live.state !== "idle") {
          live.reset();
        }
        const { seed } = run();
        live.clear({ seed: seed ?? 0, config: store.get().config });
        setRun({ stoppedAt: null, shown: false, snapshot: null });
      });
    },
    // Switch between live and batch while nothing runs.
    setMode(mode) {
      if (mode !== "live" && mode !== "batch") {
        throw new RangeError(
          `A run mode is "live" or "batch". Got ${JSON.stringify(mode)}.`,
        );
      }
      if (locked() || mode === run().mode) {
        return;
      }
      const state = mode === "batch" ? store.get().batch.status : live.state;
      setRun({ mode, state });
    },
    // A field's text, read by the bar: { text, value, error }. A valid value
    // is the next run's; an invalid one leaves the last valid value and blocks
    // Run until it is fixed.
    edit(name, { text, value, error }) {
      if (locked()) {
        return;
      }
      const { fields, errors } = run();
      const nextErrors = { ...errors };
      delete nextErrors[name];
      if (error !== null) {
        nextErrors[name] = error;
      }
      setRun({
        fields: { ...fields, [name]: text },
        errors: nextErrors,
        ...(error === null ? { [name]: value } : {}),
      });
    },
    // A random seed in the field.
    newSeed() {
      if (locked()) {
        return;
      }
      const seed = drawSeed();
      const { fields, errors } = run();
      const nextErrors = { ...errors };
      delete nextErrors.seed;
      setRun({
        seed,
        fields: { ...fields, seed: String(seed) },
        errors: nextErrors,
      });
    },
  };
}
