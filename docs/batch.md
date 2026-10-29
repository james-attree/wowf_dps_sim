# Batch runner (S1, issue #144)

`js/batch-runner.js` runs N seeded fights of one config and gives the statistics
of their DPS. It has no DOM, reads no clock and uses no randomness except through
the fights' seeds, so Node, the page and a Web Worker (#147) can all run it.

Every iteration is a `SimRunner` fight ([Run controller](mechanics.md#run-controller-p3-1-issue-136)),
and the batch reads the plain result that `runFight` returns. It reaches into no
engine internals and its interface names no step and no frame, so the Phase 3.5
engine can replace what is under `SimRunner` and leave this module and its tests
as they are. A unit of work is one whole fight: an iteration.

## Using it

```js
import { runBatch } from "./js/batch-runner.js";

const result = runBatch({ seed: 1234, iterations: 1000, duration: 300 });
result.summary.mean; // mean DPS
result.summary.ci95; // { low, high, halfWidth }
```

`runBatch(options)` runs the whole batch in one call (Node, tests, scripts). It
blocks until the end, so a page does not call it for a big batch. For a page,
use `BatchRunner`, which hands the work over in slices:

```js
const runner = new BatchRunner({
  seed,
  onProgress: ({ completed, total }) => {},
});
runner.run(); // idle -> running
// from a timer or a message, with the page free in between:
runner.advance(5); // up to 5 iterations, then returns
runner.cancel(); // stops before the next iteration
runner.result; // null until finished or cancelled
```

With an injected `driver` (`{ start(advance), stop() }`, as on `SimRunner`),
`start` gets `advance` when the runner enters `running` and `stop` is called when
it leaves; the driver decides when to call `advance` and how big a slice is.
The module reads no clock, so the host also does the throttling of progress.

### Options

| Option       | Default                      | Meaning                                                             |
| ------------ | ---------------------------- | ------------------------------------------------------------------- |
| `seed`       | required                     | Base seed (an integer, wrapped to unsigned 32 bits).                |
| `iterations` | `fight.iterations` (1,000)   | A whole number from 1 to `batch.maxIterations` (100,000).           |
| `duration`   | `batch.duration` (300 s)     | Seconds per fight, a finite number of 0 or more.                    |
| `config`     | `defaultConfig()`            | A SimConfig (talents, weapons, poisons, rotation), checked at once. |
| `signal`     | none                         | An `AbortSignal`, or any object with a boolean `aborted`.           |
| `driver`     | none (`runBatch` takes none) | `{ start(advance), stop() }`.                                       |
| `onProgress` | none                         | A progress handler, subscribed at construction.                     |

An option not in this list is a `RangeError` that names it.

### Defaults: what changed

A batch runs 300-second fights and 1,000 iterations by default (the issue's
decision). `fight.duration` stays at 180 s, which is the live page's and
`SimRunner`'s default; the 300 s is a new, separate constant, `batch.duration`
(`assumption`, retune on, so it stays on the list of values to confirm). The
iteration default is the existing `fight.iterations` row, read here for the
first time.

## States

| Action   | From                            | To          |
| -------- | ------------------------------- | ----------- |
| `run`    | `idle`, `finished`, `cancelled` | `running`   |
| `cancel` | `running`                       | `cancelled` |
| `reset`  | any state                       | `idle`      |

An action from any other state throws an `Error` naming the action, the state and
the states that allow it, and changes nothing. `advance(iterations)` is not a
transition: it does nothing unless the state is `running`. Reaching the last
iteration moves `running` to `finished`. `run` starts a fresh batch from the
first iteration. If an iteration throws, the driver is stopped, the batch goes
back to `idle` with no result and the error is thrown from `advance`.

## Events

| Subscription             | Handler gets                                      |
| ------------------------ | ------------------------------------------------- |
| `onProgress(handler)`    | `{ completed, total, mean }` after each iteration |
| `onStateChange(handler)` | `{ from, to }` after each change                  |
| `onError(handler)`       | `{ error, type }` for a handler that threw        |

Delivery follows [Events](events.md): a handler that throws goes to `onError`
(or is rethrown from a microtask) and never stops the batch. Progress is not
throttled here; the host has the clock.

## Cancelling

`cancel()`, or an aborted `signal`, stops the batch before the next iteration
starts. An iteration that has begun finishes, so a cancel takes effect within one
fight (tens of milliseconds). The batch is `cancelled` and `result` holds the
statistics of the iterations that completed, with `cancelled: true`. A cancelled
batch is exactly the first `completed` iterations of the batch that was not
cancelled. If nothing completed, the statistics are `null` (see below).

The signal is read before each iteration, so a batch given an already-aborted
signal is cancelled at `run()` with `completed: 0`. A batch whose last iteration
completed is `finished`, not cancelled, whatever the signal says afterwards.

## Seeds

Iteration `i` (0-based) of a batch with base seed `s` is the fight
`runFight({ seed: deriveSeed(s, i), duration, config })`. The derivation is

```text
deriveSeed(s, i) = mix( s xor mix(i + 1) )
mix(x)           = the MurmurHash3 32-bit finalizer
                   x ^= x >>> 16;  x *= 0x85ebca6b;
                   x ^= x >>> 13;  x *= 0xc2b2ae35;
                   x ^= x >>> 16        (all unsigned 32-bit)
```

Why not `s + i`? The fight's generator (`mulberry32`, `js/rng.js`) adds a fixed
constant to its state on every draw, so two seeds that differ by a small multiple
of that constant give the same stream shifted by a few draws, and consecutive
seeds would be nearly the same fight. The finalizer scrambles every bit, so
neighbouring indexes and neighbouring base seeds give unrelated streams.

- **No repeats in a batch.** `mix` is a bijection on 32-bit integers, and so is
  `x -> s xor x`. For a fixed `s`, `i -> mix(i + 1)` is one-to-one while
  `i + 1 < 2^32`, so no two iterations of a batch share a seed. The test checks it
  for every index up to the batch limit, for several base seeds.
- **Different base seeds are unrelated batches.** They share a seed only by
  chance (about one in 2^32 per pair of iterations). The test checks it.
- **Depends on `(s, i)` only.** It does not depend on what ran before, on the
  slice sizes, on the clock or on which thread ran it. A batch of 100 is the first
  100 iterations of a batch of 1,000, so raising `iterations` keeps the results
  already seen.

The mix's shifts and multipliers are in `data/constants.js` (`batch.seedMix`),
with the source. The first seeds for base 1 are pinned in the test.

## Statistics

`RunningStats` is Welford's online algorithm: a count, a mean, a sum of squared
differences, a minimum and a maximum. Memory does not grow with the iteration
count, and it keeps its accuracy when the values are large and close together.
Iterations are always added in index order, so the floating-point result is the
same however the work was sliced.

`result.summary`:

| Field    | Meaning                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `count`  | Iterations in the statistics (`completed`).                                                                                         |
| `mean`   | Mean DPS. `null` with no iteration.                                                                                                 |
| `stdDev` | Sample standard deviation (n - 1). `null` with fewer than two iterations.                                                           |
| `min`    | Lowest DPS. `null` with no iteration.                                                                                               |
| `max`    | Highest DPS. `null` with no iteration.                                                                                              |
| `ci95`   | `{ low, high, halfWidth }`, the 95% interval of the mean: `mean ± z · stdDev / sqrt(count)`. `null` with fewer than two iterations. |

`z` is `batch.confidenceZ` (1.959964, the normal quantile). It is a z, not a t, so
the interval is slightly narrow below roughly 30 iterations; the defaults are far
above that.

## The result

`BatchRunner#result` and `runBatch(...)` give plain data:

| Field         | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `seed`        | The base seed, as an unsigned 32-bit integer.                          |
| `iterations`  | The iterations asked for.                                              |
| `completed`   | The iterations that finished (equal to `iterations` unless cancelled). |
| `cancelled`   | `true` if the batch was cancelled before the last iteration.           |
| `duration`    | Seconds per fight.                                                     |
| `dataVersion` | The data snapshot the fights ran on.                                   |
| `config`      | The SimConfig used, normalised (a copy).                               |
| `summary`     | The statistics above.                                                  |
| `dps`         | A `Float64Array` of length `completed`: the DPS of each iteration.     |

Only `dps` is not JSON. `structuredClone` and `postMessage` carry it; for JSON use
`Array.from(result.dps)`.

## Shape

`runFight`'s result, `SimConfig` and the rotation JSON are unchanged. The new
shape is the batch result above. New exports of `js/batch-runner.js`:
`BatchRunner`, `runBatch`, `RunningStats`, `deriveSeed`, `BATCH_STATES`. New
constants: `batch.duration`, `batch.maxIterations`, `batch.confidenceZ`,
`batch.seedMix`. The `fight.iterations` note now names the batch runner.
