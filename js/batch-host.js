import { k } from "../data/constants.js";
import { BatchRunner } from "./batch-runner.js";

// The batch host (S4, issue #147): the message side of a batch, between a
// BatchRunner (js/batch-runner.js) and whoever sends it messages. The Web
// Worker (js/batch-worker.js) is this module plus three lines of wiring, and
// the main-thread fallback of js/batch-client.js runs the same module in the
// page, so both paths run the same code. It touches no global: the host gives
// it post(message, transfer), now() (a clock in milliseconds, for the slices
// and the progress throttle) and schedule(callback) (run callback in a later
// task). A Node test drives it with a fake clock and a queue.
//
// The protocol. Every message is plain, structured-clone-safe data with a
// `type`, and every message about a batch carries the `id` the client chose
// for it. Nothing in it names a step or a frame: the unit of work is one
// iteration (one whole fight).
//
//   client -> host
//     { type: "start", id, options: { seed, iterations, duration, config } }
//         Run a batch. The options are BatchRunner's, without the ones that
//         cannot cross a thread (signal, driver, onProgress): cancel with the
//         cancel message, and read progress from the progress messages.
//     { type: "cancel", id }
//         Stop the batch `id` before its next iteration. A cancel for a batch
//         that is not running (it ended, or it never started) is ignored.
//
//   host -> client
//     { type: "ready" }
//         Sent once by the worker when its modules have loaded.
//     { type: "progress", id, completed, total, mean }
//         How many iterations are done, how many were asked for, and the mean
//         DPS so far. At most one per batch.progressInterval, and the last one
//         (completed equal to the result's) always, before the result.
//     { type: "result", id, result }
//         The batch ended: BatchRunner#result, finished or cancelled
//         (`cancelled: true`, the iterations that completed). result.dps is a
//         Float64Array whose buffer is transferred, not copied.
//     { type: "error", id, error: { name, message } }
//         The batch could not start (bad options, a batch already running, a
//         message the host does not know) or an iteration threw. `id` is null
//         when the message had no usable id.
//
// Order: for one batch, every progress message comes before its result or
// error, `completed` only grows, and exactly one result or error ends it.
//
// Running. A start builds a BatchRunner and schedules the first slice. A slice
// runs whole iterations until batch.sliceBudget has passed (at least one),
// then schedules the next, so the host reads its messages between slices: a
// cancel takes effect within one slice plus one fight. One batch at a time.

export const BATCH_MESSAGE_TYPES = Object.freeze({
  start: "start",
  cancel: "cancel",
  ready: "ready",
  progress: "progress",
  result: "result",
  error: "error",
});

// The options a start message may carry.
export const START_OPTIONS = Object.freeze([
  "seed",
  "iterations",
  "duration",
  "config",
]);

// The error names that come back as their own class (js/batch-client.js).
// Any other name comes back as an Error with that name.
export const ERROR_NAMES = Object.freeze(["Error", "RangeError", "TypeError"]);

// An Error (or anything thrown) as plain data for a message.
export function serializeError(error) {
  if (error instanceof Error) {
    return { name: String(error.name), message: String(error.message) };
  }
  return { name: "Error", message: String(error) };
}

function isId(id) {
  return typeof id === "string" || Number.isFinite(id);
}

function readStart(message) {
  const { options } = message;
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new RangeError(
      "A start message needs an options object: { seed, iterations, duration, config }.",
    );
  }
  for (const key of Object.keys(options)) {
    if (!START_OPTIONS.includes(key)) {
      throw new RangeError(
        `A worker batch has no option ${JSON.stringify(key)}. Options: ${START_OPTIONS.join(", ")}. Cancel with the cancel message and read progress from the progress messages.`,
      );
    }
  }
  return options;
}

// A schedule(callback) that runs callback in a later task: a fresh
// MessageChannel per call where there is one (no timer clamping, and the
// channel is closed once used, so it holds nothing open), else setTimeout.
export function nextTask(callback) {
  const scope = globalThis;
  if (typeof scope.MessageChannel === "function") {
    const channel = new scope.MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      callback();
    };
    channel.port2.postMessage(null);
    return;
  }
  scope.setTimeout(callback, 0);
}

// Returns { receive(message) }. Options:
//   post(message, transfer)  required, sends a message to the client
//   now()                    required, a clock in milliseconds
//   schedule(callback)       runs callback in a later task. Default nextTask.
//   createRunner(options)    builds the BatchRunner. Default new
//                            BatchRunner(options). For tests.
export function createBatchHost({
  post,
  now,
  schedule = nextTask,
  createRunner = (options) => new BatchRunner(options),
}) {
  if (typeof post !== "function" || typeof now !== "function") {
    throw new TypeError(
      "A batch host needs post(message) and now() functions.",
    );
  }
  if (typeof schedule !== "function" || typeof createRunner !== "function") {
    throw new TypeError(
      "A batch host's schedule and createRunner are functions.",
    );
  }
  // The running batch: { id, runner, sent, sentAt }, or null.
  let job = null;

  function sendError(id, error) {
    post({ type: "error", id, error: serializeError(error) });
  }

  function sendProgress(current, { completed, total, mean }, time) {
    current.sent = completed;
    current.sentAt = time;
    post({ type: "progress", id: current.id, completed, total, mean });
  }

  // The batch ended (finished or cancelled): the last progress, then the
  // result, with the DPS buffer transferred.
  function end(current) {
    job = null;
    const { result } = current.runner;
    if (result.completed > current.sent) {
      sendProgress(
        current,
        {
          completed: result.completed,
          total: result.iterations,
          mean: result.summary.mean,
        },
        now(),
      );
    }
    post({ type: "result", id: current.id, result }, [result.dps.buffer]);
  }

  function slice(current) {
    if (job !== current) {
      return;
    }
    const started = now();
    const budget = k("batch.sliceBudget");
    let state;
    try {
      do {
        state = current.runner.advance(1);
      } while (state === "running" && now() - started < budget);
    } catch (error) {
      job = null;
      sendError(current.id, error);
      return;
    }
    if (state === "running") {
      schedule(() => slice(current));
    } else {
      end(current);
    }
  }

  function start(message) {
    if (job !== null) {
      throw new Error(
        `A batch (id ${JSON.stringify(job.id)}) is already running. Cancel it, or wait for its result, before starting another.`,
      );
    }
    const options = readStart(message);
    const runner = createRunner({ ...options });
    const current = { id: message.id, runner, sent: 0, sentAt: -Infinity };
    runner.onProgress((progress) => {
      const time = now();
      if (time - current.sentAt >= k("batch.progressInterval")) {
        sendProgress(current, progress, time);
      }
    });
    // The job is set before run(), so the host is busy from the moment the
    // batch exists. A run() that throws clears it again, so the host is not
    // left stuck on a batch that never started (#155, Kira's #170 item 4).
    job = current;
    try {
      runner.run();
    } catch (error) {
      job = null;
      throw error;
    }
    schedule(() => slice(current));
  }

  function cancel(message) {
    if (job === null || job.id !== message.id) {
      return;
    }
    const current = job;
    current.runner.cancel();
    end(current);
  }

  function receive(message) {
    if (message === null || typeof message !== "object") {
      sendError(
        null,
        new TypeError("A batch message must be an object with a type."),
      );
      return;
    }
    const id = isId(message.id) ? message.id : null;
    try {
      if (id === null) {
        throw new TypeError(
          "A batch message needs an id: a string or a finite number.",
        );
      }
      if (message.type === "start") {
        start(message);
      } else if (message.type === "cancel") {
        cancel(message);
      } else {
        throw new TypeError(
          `Unknown batch message type ${JSON.stringify(message.type)}. Types: start, cancel.`,
        );
      }
    } catch (error) {
      sendError(id, error);
    }
  }

  return { receive };
}
