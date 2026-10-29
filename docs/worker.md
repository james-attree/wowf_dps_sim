# Batch worker (S4, issue #147)

A batch of 10,000 five-minute fights takes minutes. The batch client runs it off
the main thread, in a module Web Worker, so the page keeps painting and taking
input. Where a module worker is not available it runs on the main thread in
short slices instead. Both paths give the same result as `runBatch` with the same
options, to the byte.

Three modules:

- `js/batch-host.js` is the message side of a batch: it takes `start` and
  `cancel` messages, drives a `BatchRunner` ([Batch runner](batch.md)) in slices,
  and posts `progress`, `result` and `error` messages. It touches no global: its
  host gives it `post`, a clock (`now`) and `schedule`. It is engine code and the
  engine-purity lint applies to it.
- `js/batch-worker.js` is the worker: the host, with `self.postMessage`,
  `performance.now()` and a message listener. It posts `ready` once it has
  loaded.
- `js/batch-client.js` is what the page calls: `BatchClient`. It creates the
  worker, or runs the host in the page, and turns the messages into a promise.

The worker and the client are hosts, like `js/main.js`: they may read a clock
and use `self`, `URL`, `queueMicrotask` and `Worker`. They may not use the DOM
(`document`, `window`), `Math.random` or `console`, and the no-magic-numbers
rule applies. A Worker is created only in `js/batch-client.js`; no engine module
names one. The page does not use the client yet (the batch UI is #149 onwards).

## Using it

```js
import { BatchClient } from "./js/batch-client.js";

const client = new BatchClient(); // mode "auto"
const result = await client.run(
  { seed: 1234, iterations: 10000, duration: 300, config },
  { onProgress: ({ completed, total, mean }) => {} },
);
// result is runBatch's result: summary, dps (a Float64Array), breakdown,
// auras, resources, completed, cancelled, ...

client.cancel(); // the running batch resolves with cancelled: true
client.terminate(); // stops the worker; a running batch rejects
```

- `run(options, { onProgress })` returns a promise of the batch result. The
  options are `seed`, `iterations`, `duration` and `config`, as for `runBatch`.
  `signal`, `driver` and `onProgress` cannot cross a thread, so a start with one
  rejects with a `RangeError`: cancel with `cancel()` and read progress from the
  `onProgress` callback. Options that cannot be cloned (a function in the
  config) reject with the browser's `DataCloneError`. A batch that cannot start
  (bad options) or whose iteration throws rejects with an `Error`, `RangeError`
  or `TypeError` of the same name and message as `runBatch` would throw. One
  batch at a time: `run()` while one is running rejects.
- `onProgress({ completed, total, mean })` is called at most once per
  `batch.progressInterval` (100 ms), always once at the start, and once with the
  final count before the promise settles. `completed` only grows. It runs
  outside the slice (a microtask after it on the main thread, a message event
  with a worker), so a handler that throws is reported as an uncaught error and
  the batch goes on.
- `cancel()` returns `true` if a batch was running. The batch stops before its
  next iteration, and the promise resolves with the iterations that completed
  and `cancelled: true`: exactly the first `completed` iterations of the
  uncancelled batch ([Cancelling](batch.md#cancelling)). A `cancel()` that
  returns `true` always gives `cancelled: true`, even when the last iteration
  finished before the cancel reached the host (a cancel from the last
  `onProgress`, say): then `completed` is the full count, and only the flag
  differs from the uncancelled result, as with `BatchRunner`'s `cancel()`
  (issue #155).
- `mode` is `"worker"` or `"main"`, where batches run. `running` is true while a
  batch runs.

`new BatchClient({ mode, createWorker, now, schedule, setTimer })`, all optional:

| Option         | Default                                 | Meaning                                                                                           |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `mode`         | `"auto"`                                | `"auto"`, `"worker"` or `"main"`. See below.                                                      |
| `createWorker` | a module worker of `js/batch-worker.js` | Returns a Worker-like object (`postMessage`, `addEventListener`, `terminate`). For tests.         |
| `now`          | `performance.now`                       | The main-thread path's clock.                                                                     |
| `schedule`     | `nextTask` (a `MessageChannel` task)    | How the main-thread path runs its next slice.                                                     |
| `setTimer`     | `setTimeout` (unreferenced in Node)     | `setTimer(callback, ms)` returns a function that clears it. The worker's load timeout. For tests. |

An unknown option is a `RangeError`.

### Modes

- `"auto"` uses a module worker where the browser has one (the constructor
  probes whether `Worker` reads the `type` option) and the main thread
  otherwise. If the worker fails to load, the client drops it, moves to `"main"`, and reruns the batch from its first
  iteration, so the result is the same. A cancel made before the move still
  applies.
- `"worker"` always uses a worker. One that fails to load rejects the batch with
  "The batch worker failed" (or, if the constructor threw, with its error).

A worker fails to load when (issue #155):

- the `Worker` constructor throws (a blocked script, a content security
  policy);
- it reports an `error`, or sends an `exit` event, before its `ready`;
- it is not `ready` within `batch.workerLoadTimeout` (10 s), so a worker that
  never loads cannot leave the batch hanging.
- `"main"` runs the host in the page, in slices of `batch.sliceBudget` (16 ms,
  about one frame at 60 Hz, and at least one fight), each in its own task, so
  the page paints and takes input between slices.

A worker that fails after `ready` (an `error`, or an `exit` event: Node's
`worker_threads` send one, a browser `Worker` never does) rejects the running
batch in every mode, and the next `run()` starts a new worker. A message that cannot be read
(`messageerror`) rejects the batch.

The worker URL is `new URL("./batch-worker.js", import.meta.url)`, so it
resolves next to the client under any base path: GitHub Pages serves the site
from `/wowf_dps_sim/` and copies `js/` whole.

## The protocol

Every message is plain, structured-clone-safe data with a `type`. Every message
about a batch carries the `id` the client chose for it, so a late message about
an earlier batch is ignored. Nothing names a step or a frame: the unit of work
is one iteration (one whole fight).

| Direction     | Message                                            | Meaning                                                                                                                         |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| client → host | `{ type: "start", id, options }`                   | Run a batch. `options` is `{ seed, iterations, duration, config }`.                                                             |
| client → host | `{ type: "cancel", id }`                           | Stop batch `id` before its next iteration. Ignored if `id` is not running.                                                      |
| host → client | `{ type: "ready" }`                                | The worker has loaded (worker only, once).                                                                                      |
| host → client | `{ type: "progress", id, completed, total, mean }` | Throttled to `batch.progressInterval`. The last one (the final count) comes just before the result.                             |
| host → client | `{ type: "result", id, result }`                   | `BatchRunner#result`, finished or cancelled. `result.dps.buffer` is transferred, not copied.                                    |
| host → client | `{ type: "error", id, error: { name, message } }`  | The batch could not start, or an iteration threw. `id` is `null` when the message had no usable id (a string or finite number). |

For one batch, every progress message comes before its result or error and
exactly one result or error ends it. The host runs one batch at a time; a start
while one runs is an error for the new id, and the running batch goes on. An
iteration that throws ends its batch with an error, and the host takes the next
start. So does a batch whose runner throws as it starts (`run()`): the host is
busy from the moment the batch exists, and free again after the error (issue
#155).

## Slices and cancel latency

The host advances the `BatchRunner` one iteration at a time until
`batch.sliceBudget` has passed, then schedules the next slice. It reads its
messages between slices, so a cancel waits for at most the rest of the slice
plus one fight, then the result message. On the main-thread path the page
itself can only call `cancel()` between slices, so the batch stops at once.

Measured in headless Chrome (live page served under `/wowf_dps_sim/`, real
module worker, 300 s fights, 29 Oct 2026):

| What                                               | Worker                                        | Main thread (`mode: "main"`)       |
| -------------------------------------------------- | --------------------------------------------- | ---------------------------------- |
| 1,000 × 300 s (`runBatch` in the page: 21.2 s)     | 22.2 s                                        | 22.3 s                             |
| Result equal to `runBatch`, `dps` bytes included   | yes                                           | yes                                |
| Cancel latency, `cancel()` to the resolved promise | median 18.9 ms, max 26.3 ms (10 runs)         | median 0.2 ms, max 0.4 ms (5 runs) |
| Frame gaps during the run (p50 / p99 / max)        | 16.7 / 16.8 / 16.8 ms (10,000 × 300 s, 154 s) | 16.7 / 33.4 / 33.5 ms              |

During the 10,000-fight worker run the live fight on the page kept advancing,
50 ms timers were at most 9.5 ms late, and a script round trip to the page took
3 ms (median; max 30 ms). `runBatch` on the main thread blocks the page for the
whole batch.

## Constants

- `batch.progressInterval` (100 ms): the least time between progress messages.
- `batch.sliceBudget` (16 ms): how long a slice runs before the host reads its
  messages again.

Both are engineering choices ([provenance](provenance.md)), not game values.

## Shape

`runBatch`'s result, `BatchRunner`, `runFight`'s result, `SimConfig` and the
rotation JSON are unchanged. New: the message protocol above;
`js/batch-host.js` (`createBatchHost`, `nextTask`, `serializeError`,
`BATCH_MESSAGE_TYPES`, `START_OPTIONS`, `ERROR_NAMES`); `js/batch-worker.js`;
`js/batch-client.js` (`BatchClient`, `BATCH_CLIENT_MODES`,
`supportsModuleWorkers`, `deserializeError`); constants
`batch.progressInterval` and `batch.sliceBudget`.

## Tests

`test/batch-worker.test.js` drives the host through its messages with a fake
clock and queue (results equal to `runBatch` to the byte, the transfer, the
progress throttle and order, slices, cancel, stale ids, errors), runs the real
`js/batch-worker.js` on a `worker_threads` thread through the client
(`test/batch-worker-thread.js` gives it a `self` over Node's `parentPort`), and
covers the client's
modes, fallback and errors with fake workers. `test/pages.test.js` and
`test/serve.test.js` check that the worker is served and resolves on the site.
The browser numbers above come from a manual headless Chrome check, not CI.
