import { k } from "../data/constants.js";
import { ERROR_NAMES, createBatchHost, nextTask } from "./batch-host.js";

// The batch client (S4, issue #147): runs a batch off the main thread, in a
// module Web Worker (js/batch-worker.js), and falls back to the main thread
// where module workers are not available. It is a host, not engine code: the
// page (or a script) calls it, and it reads a clock (for the fallback's
// slices) and creates the worker.
//
//   const client = new BatchClient();
//   const result = await client.run(
//     { seed: 1234, iterations: 10000, duration: 300, config },
//     { onProgress: ({ completed, total, mean }) => {} },
//   );
//   client.cancel(); // the run's promise resolves with cancelled: true
//
// run(options, { onProgress }) returns a promise of the batch result, the
// same plain data as runBatch(options) for the same options (js/batch-runner.js),
// on either path: result.dps is a Float64Array. The options are seed,
// iterations, duration and config. A batch that cannot start, or whose
// iteration throws, rejects the promise with an Error of the same name and
// message. One batch at a time: run() while one is running rejects.
//
// cancel() stops the running batch before its next iteration and resolves its
// promise with the iterations that completed (`cancelled: true`), within one
// slice (batch.sliceBudget) plus one fight. It returns false when nothing was
// running. A cancel() that returns true always gives `cancelled: true`, even
// when the last iteration finished before the cancel reached the host (a
// cancel from the progress handler of the last iteration, say), as
// BatchRunner's cancel() does (#155).
//
// Modes (`mode` option):
//   "auto"    the default. A module worker where the browser has one, else the
//             main thread. A worker that fails to load is dropped and the
//             batch reruns on the main thread, from its first iteration, so
//             the result is the same. Failing to load is: the Worker
//             constructor throws, the worker reports an error or exits before
//             it says it is ready, or it is not ready within
//             batch.workerLoadTimeout.
//   "worker"  always a worker. A worker that fails to load rejects the batch.
//
// A worker that exits after it loaded (a Worker-like object may send an
// "exit" event, as Node's worker_threads do; a browser Worker never does)
// rejects the running batch, as an error does, so a batch cannot hang on a
// worker that is gone.
//   "main"    always the main thread: the batch host runs in the page, in
//             slices of batch.sliceBudget, so the page can paint and take
//             input between them.
//
// Both paths run js/batch-host.js, so progress (throttled to
// batch.progressInterval), cancel and errors behave the same.

export const BATCH_CLIENT_MODES = Object.freeze(["auto", "worker", "main"]);

const CLIENT_OPTIONS = ["mode", "createWorker", "now", "schedule", "setTimer"];

// True when `WorkerClass` (default: the global Worker) takes the
// { type: "module" } option: the constructor reads `type` only if it knows it.
// The probe URL is never loaded.
export function supportsModuleWorkers(WorkerClass = globalThis.Worker) {
  if (typeof WorkerClass !== "function") {
    return false;
  }
  let supported = false;
  const probe = {
    get type() {
      supported = true;
      return "module";
    },
  };
  try {
    new WorkerClass("blob://", probe).terminate();
  } catch {
    // The probe URL is invalid on purpose; the option was read first.
  }
  return supported;
}

// The default worker: js/batch-worker.js, next to this module, so it resolves
// under any base path (GitHub Pages serves the site from /wowf_dps_sim/).
function defaultWorker() {
  return new globalThis.Worker(new URL("./batch-worker.js", import.meta.url), {
    type: "module",
  });
}

// The default timer: setTimer(callback, ms) returns a function that clears it.
// Unreferenced where the host has that (Node), so a pending load timeout never
// keeps a script alive.
function defaultTimer(callback, ms) {
  const handle = globalThis.setTimeout(callback, ms);
  handle?.unref?.();
  return () => globalThis.clearTimeout(handle);
}

// A serialized error (js/batch-host.js serializeError) as an Error again.
export function deserializeError(data) {
  const name = data !== null && typeof data === "object" ? data.name : "Error";
  const message =
    data !== null && typeof data === "object" ? data.message : String(data);
  const Class = ERROR_NAMES.includes(name) ? globalThis[name] : Error;
  const error = new Class(String(message));
  if (!ERROR_NAMES.includes(name)) {
    error.name = String(name);
  }
  return error;
}

export class BatchClient {
  #requested;
  #mode;
  #createWorker;
  #now;
  #schedule;
  #setTimer;
  #worker = null;
  // Clears the pending load timeout of #worker, or null.
  #clearLoadTimer = null;
  #ready = false;
  #host = null;
  // The running batch: { id, options, onProgress, resolve, reject,
  // cancelled }, or null.
  #job = null;
  #nextId = 1;

  // Options (all optional):
  //   mode          "auto" (default), "worker" or "main". See the header.
  //   createWorker  () => a Worker-like object (postMessage, addEventListener,
  //                 terminate). Default: a module worker of js/batch-worker.js.
  //                 With one, "auto" uses it without probing the browser.
  //   now           a clock in milliseconds for the main-thread path. Default
  //                 performance.now.
  //   schedule      schedule(callback) for the main-thread path. Default: the
  //                 next task (js/batch-host.js nextTask).
  //   setTimer      setTimer(callback, ms) => a function that clears it, for
  //                 the worker's load timeout. Default: setTimeout.
  constructor(options = {}) {
    if (options === null || typeof options !== "object") {
      throw new TypeError("A BatchClient takes an options object.");
    }
    for (const key of Object.keys(options)) {
      if (!CLIENT_OPTIONS.includes(key)) {
        throw new RangeError(
          `A BatchClient has no option ${JSON.stringify(key)}. Options: ${CLIENT_OPTIONS.join(", ")}.`,
        );
      }
    }
    const {
      mode = "auto",
      createWorker,
      now = () => performance.now(),
      schedule = nextTask,
      setTimer = defaultTimer,
    } = options;
    if (!BATCH_CLIENT_MODES.includes(mode)) {
      throw new RangeError(
        `A BatchClient mode is one of ${BATCH_CLIENT_MODES.join(", ")}. Got ${JSON.stringify(mode)}.`,
      );
    }
    for (const [name, value] of [
      ["createWorker", createWorker],
      ["now", now],
      ["schedule", schedule],
      ["setTimer", setTimer],
    ]) {
      if (value !== undefined && typeof value !== "function") {
        throw new TypeError(`A BatchClient's ${name} must be a function.`);
      }
    }
    this.#requested = mode;
    this.#now = now;
    this.#schedule = schedule;
    this.#setTimer = setTimer;
    this.#createWorker = createWorker ?? defaultWorker;
    if (mode === "main") {
      this.#mode = "main";
    } else if (
      mode === "worker" ||
      createWorker !== undefined ||
      supportsModuleWorkers()
    ) {
      this.#mode = "worker";
    } else {
      this.#mode = "main";
    }
  }

  // Where batches run: "worker" or "main". "auto" settles on one at
  // construction, and moves to "main" if the worker fails to load.
  get mode() {
    return this.#mode;
  }

  // True while a batch runs.
  get running() {
    return this.#job !== null;
  }

  run(options, { onProgress } = {}) {
    if (this.#job !== null) {
      return Promise.reject(
        new Error(
          "A batch is already running on this client. Cancel it, or wait for its result, before starting another.",
        ),
      );
    }
    if (onProgress !== undefined && typeof onProgress !== "function") {
      return Promise.reject(new TypeError("onProgress must be a function."));
    }
    return new Promise((resolve, reject) => {
      this.#job = {
        id: this.#nextId,
        options,
        onProgress,
        resolve,
        reject,
        cancelled: false,
      };
      this.#nextId += 1;
      this.#start(this.#job);
    });
  }

  cancel() {
    const job = this.#job;
    if (job === null) {
      return false;
    }
    job.cancelled = true;
    this.#send({ type: "cancel", id: job.id });
    return true;
  }

  // Stops the worker. A running batch rejects. The next run() starts a new
  // worker.
  terminate() {
    this.#dropWorker();
    this.#host = null;
    const job = this.#job;
    if (job !== null) {
      this.#job = null;
      job.reject(new Error("The batch client was terminated."));
    }
  }

  #start(job) {
    try {
      this.#send({ type: "start", id: job.id, options: job.options });
      if (job.cancelled) {
        this.#send({ type: "cancel", id: job.id });
      }
    } catch (error) {
      // postMessage could not clone the options (a function in the config,
      // say), or the worker could not be created.
      if (this.#job === job) {
        this.#job = null;
        job.reject(error);
      }
    }
  }

  #send(message) {
    if (this.#mode === "worker") {
      const port = this.#workerPort();
      if (port !== null) {
        port.postMessage(message);
        return;
      }
    }
    this.#mainHost().receive(message);
  }

  #mainHost() {
    if (this.#host === null) {
      this.#host = createBatchHost({
        // A microtask, so a progress handler never runs inside a slice and
        // one that throws cannot fail the batch.
        post: (message) => queueMicrotask(() => this.#receive(message)),
        now: this.#now,
        schedule: this.#schedule,
      });
    }
    return this.#host;
  }

  // The worker, created on first use, or null when it could not be created in
  // auto mode (the client has moved to the main thread).
  #workerPort() {
    if (this.#worker === null) {
      let worker;
      try {
        worker = this.#createWorker();
      } catch (error) {
        if (this.#requested !== "auto") {
          throw error;
        }
        // The constructor threw (a blocked script, no module workers after
        // all): a load failure, so run here instead (#155).
        this.#mode = "main";
        return null;
      }
      this.#worker = worker;
      this.#ready = false;
      const timeout = k("batch.workerLoadTimeout");
      this.#clearLoadTimer = this.#setTimer(() => {
        if (this.#worker === worker && !this.#ready) {
          this.#workerError({
            message: `it was not ready within ${timeout} ms`,
          });
        }
      }, timeout);
      worker.addEventListener("message", (event) => {
        if (this.#worker === worker) {
          this.#receive(event.data);
        }
      });
      worker.addEventListener("messageerror", () => {
        if (this.#worker === worker) {
          this.#fail(new Error("A batch message could not be read."));
        }
      });
      worker.addEventListener("error", (event) => {
        if (this.#worker === worker) {
          this.#workerError(event);
        }
      });
      worker.addEventListener("exit", (event) => {
        if (this.#worker === worker) {
          const code = event?.code === undefined ? "" : ` (code ${event.code})`;
          this.#workerError({ message: `it exited${code}` });
        }
      });
    }
    return this.#worker;
  }

  #stopLoadTimer() {
    const clear = this.#clearLoadTimer;
    this.#clearLoadTimer = null;
    clear?.();
  }

  #dropWorker() {
    this.#stopLoadTimer();
    if (this.#worker !== null) {
      const worker = this.#worker;
      this.#worker = null;
      this.#ready = false;
      worker.terminate();
    }
  }

  #workerError(event) {
    const loaded = this.#ready;
    this.#dropWorker();
    if (!loaded && this.#requested === "auto") {
      // The worker never loaded (no module workers after all, a blocked
      // script): run here instead, from the first iteration.
      event?.preventDefault?.();
      this.#mode = "main";
      if (this.#job !== null) {
        this.#start(this.#job);
      }
      return;
    }
    const detail = event?.message ? `: ${event.message}` : ".";
    this.#fail(new Error(`The batch worker failed${detail}`));
  }

  #fail(error) {
    const job = this.#job;
    if (job !== null) {
      this.#job = null;
      job.reject(error);
    }
  }

  #receive(message) {
    if (message?.type === "ready") {
      this.#ready = true;
      this.#stopLoadTimer();
      return;
    }
    const job = this.#job;
    if (job === null || message?.id !== job.id) {
      return;
    }
    if (message.type === "progress") {
      const { completed, total, mean } = message;
      job.onProgress?.({ completed, total, mean });
    } else if (message.type === "result") {
      this.#job = null;
      // A cancel() that returned true is a cancelled batch, even if the last
      // iteration finished before the host saw it (#155).
      const { result } = message;
      job.resolve(
        job.cancelled && result?.cancelled === false
          ? { ...result, cancelled: true }
          : result,
      );
    } else if (message.type === "error") {
      this.#job = null;
      job.reject(deserializeError(message.error));
    }
  }
}
