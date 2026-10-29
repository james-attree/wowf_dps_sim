import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, describe, it } from "node:test";
import { Worker } from "node:worker_threads";
import { k } from "../data/constants.js";
import {
  BATCH_CLIENT_MODES,
  BatchClient,
  deserializeError,
  supportsModuleWorkers,
} from "../js/batch-client.js";
import {
  BATCH_MESSAGE_TYPES,
  START_OPTIONS,
  createBatchHost,
  nextTask,
  serializeError,
} from "../js/batch-host.js";
import { BatchRunner, runBatch } from "../js/batch-runner.js";
import { referenceBuild } from "./talentsforever.js";

// Issue #147 (S4): the batch Web Worker. These are contract tests of the
// protocol (js/batch-host.js), the client (js/batch-client.js) and a real
// second thread running js/batch-worker.js (worker_threads,
// test/batch-worker-thread.js). They read
// messages and results, never an engine step. The browser's Worker is checked
// in headless Chrome by hand (see the PR).

const FIGHT = 20; // seconds per iteration in these tests
// A batch that never settles (a lost message) fails its test instead of
// hanging the run.
const SETTLE = { timeout: 30_000 }; // ms
const TALENTED = {
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
};
const OPTIONS = { seed: 147, iterations: 12, duration: FIGHT };

// The same result, to the byte: deep-equal, the same JSON (with dps as an
// array), and the same DPS bytes.
function assertSameResult(actual, expected) {
  assert.deepStrictEqual(actual, expected);
  assert.ok(actual.dps instanceof Float64Array);
  const json = (result) =>
    JSON.stringify({ ...result, dps: Array.from(result.dps) });
  assert.equal(json(actual), json(expected));
  assert.deepEqual(
    new Uint8Array(
      actual.dps.buffer,
      actual.dps.byteOffset,
      actual.dps.byteLength,
    ),
    new Uint8Array(
      expected.dps.buffer,
      expected.dps.byteOffset,
      expected.dps.byteLength,
    ),
  );
}

// A host on a fake clock and a task queue the test runs by hand. Messages are
// structured-cloned with their transfer list, as postMessage does.
function fakeHost({ tick = 0, createRunner } = {}) {
  const messages = [];
  const tasks = [];
  const clock = { time: 0 };
  const transferred = [];
  const host = createBatchHost({
    post: (message, transfer) => {
      transferred.push(...(transfer ?? []));
      messages.push(structuredClone(message, { transfer }));
    },
    now: () => {
      clock.time += tick;
      return clock.time;
    },
    schedule: (task) => tasks.push(task),
    ...(createRunner === undefined ? {} : { createRunner }),
  });
  const runTask = () => tasks.shift()();
  const drain = () => {
    let count = 0;
    while (tasks.length > 0) {
      runTask();
      count += 1;
    }
    return count;
  };
  return { host, messages, tasks, clock, transferred, runTask, drain };
}

// A BatchRunner whose every advance() moves the fake clock by `step` ms.
function timedRunner(clock, step) {
  return (options) => {
    const runner = new BatchRunner(options);
    const advance = runner.advance.bind(runner);
    runner.advance = (count) => {
      clock.time += step;
      return advance(count);
    };
    return runner;
  };
}

function ofType(messages, type) {
  return messages.filter((message) => message.type === type);
}

// Every progress before the end, completed only growing, the last progress at
// the result's count, and exactly one result or error, last.
function assertOrdered(messages, id) {
  const own = messages.filter((message) => message.id === id);
  const ends = own.filter((message) => message.type !== "progress");
  assert.equal(ends.length, 1);
  assert.equal(own.at(-1), ends[0]);
  let last = 0;
  for (const message of own.slice(0, -1)) {
    assert.equal(message.type, "progress");
    assert.ok(message.completed > last, `${message.completed} after ${last}`);
    last = message.completed;
  }
  if (ends[0].type === "result" && ends[0].result.completed > 0) {
    assert.equal(last, ends[0].result.completed);
  }
}

describe("batch host protocol (#147)", () => {
  it("gives the result of runBatch, byte for byte, with the DPS buffer transferred", () => {
    for (const options of [
      OPTIONS,
      { ...OPTIONS, seed: 9, config: TALENTED },
    ]) {
      const fake = fakeHost();
      fake.host.receive({ type: "start", id: "a", options });
      fake.drain();
      const [result] = ofType(fake.messages, "result");
      assert.equal(result.id, "a");
      assertSameResult(result.result, runBatch(options));
      assert.equal(fake.transferred.length, 1);
      assert.equal(fake.transferred[0].byteLength, 0, "the buffer moved");
      assertOrdered(fake.messages, "a");
    }
  });

  it("sends nothing until the first slice runs", () => {
    const fake = fakeHost();
    fake.host.receive({ type: "start", id: 1, options: OPTIONS });
    assert.deepEqual(fake.messages, []);
    assert.equal(fake.tasks.length, 1);
  });

  it("throttles progress to batch.progressInterval and always sends the last", () => {
    const interval = k("batch.progressInterval");
    // A clock that stands still: the first progress, then only the last.
    const still = fakeHost();
    still.host.receive({ type: "start", id: 1, options: OPTIONS });
    still.drain();
    assert.deepEqual(
      ofType(still.messages, "progress").map((message) => message.completed),
      [1, OPTIONS.iterations],
    );

    // An iteration exactly one interval long: every progress goes out.
    const each = fakeHost();
    const eachRunner = timedRunner(each.clock, interval);
    const host = createBatchHost({
      post: (message) => each.messages.push(message),
      now: () => each.clock.time,
      schedule: (task) => each.tasks.push(task),
      createRunner: eachRunner,
    });
    host.receive({ type: "start", id: 2, options: OPTIONS });
    each.drain();
    assert.deepEqual(
      ofType(each.messages, "progress").map((message) => message.completed),
      Array.from({ length: OPTIONS.iterations }, (_, index) => index + 1),
    );
    assertOrdered(each.messages, 2);

    // Just under an interval: every other one, then the last.
    const under = fakeHost();
    const underHost = createBatchHost({
      post: (message) => under.messages.push(message),
      now: () => under.clock.time,
      schedule: (task) => under.tasks.push(task),
      createRunner: timedRunner(under.clock, interval - 1),
    });
    underHost.receive({ type: "start", id: 3, options: OPTIONS });
    under.drain();
    const sent = ofType(under.messages, "progress");
    assert.deepEqual(
      sent.map((message) => message.completed),
      [1, 3, 5, 7, 9, 11, 12],
    );
    for (const [index, message] of sent.entries()) {
      assert.equal(message.total, OPTIONS.iterations);
      assert.equal(
        message.mean,
        runBatch({ ...OPTIONS, iterations: message.completed }).summary.mean,
        `progress ${index}`,
      );
    }
    assertOrdered(under.messages, 3);
  });

  it("runs whole iterations in slices of batch.sliceBudget", () => {
    const budget = k("batch.sliceBudget");
    const fake = fakeHost();
    const host = createBatchHost({
      post: (message) => fake.messages.push(message),
      now: () => fake.clock.time,
      schedule: (task) => fake.tasks.push(task),
      createRunner: timedRunner(fake.clock, budget / 4),
    });
    host.receive({ type: "start", id: 1, options: OPTIONS });
    const counts = [];
    while (fake.tasks.length > 0) {
      fake.runTask();
      counts.push(
        ofType(fake.messages, "progress").at(-1)?.completed ??
          fake.messages.at(-1).result?.completed,
      );
    }
    // Four iterations reach the budget: 12 iterations are three slices.
    assert.equal(counts.length, 3);
    assert.equal(ofType(fake.messages, "result")[0].result.completed, 12);

    // A slice longer than the budget still runs one whole iteration.
    const slow = fakeHost();
    const slowHost = createBatchHost({
      post: (message) => slow.messages.push(message),
      now: () => slow.clock.time,
      schedule: (task) => slow.tasks.push(task),
      createRunner: timedRunner(slow.clock, budget * 2),
    });
    slowHost.receive({ type: "start", id: 1, options: OPTIONS });
    slow.runTask();
    assert.deepEqual(
      ofType(slow.messages, "progress").map((message) => message.completed),
      [1],
    );
    assert.equal(slow.tasks.length, 1);
    assert.equal(slow.drain(), OPTIONS.iterations - 1);
  });

  it("cancels between slices with the partial result, a prefix of the batch", () => {
    const budget = k("batch.sliceBudget");
    const fake = fakeHost();
    const host = createBatchHost({
      post: (message, transfer) =>
        fake.messages.push(structuredClone(message, { transfer })),
      now: () => fake.clock.time,
      schedule: (task) => fake.tasks.push(task),
      createRunner: timedRunner(fake.clock, budget / 4),
    });
    host.receive({ type: "start", id: 5, options: OPTIONS });
    fake.runTask();
    host.receive({ type: "cancel", id: 5 });
    const [end] = ofType(fake.messages, "result");
    assert.equal(end.result.cancelled, true);
    assert.equal(end.result.completed, 4);
    assert.equal(end.result.iterations, OPTIONS.iterations);
    const full = runBatch(OPTIONS);
    const prefix = runBatch({ ...OPTIONS, iterations: 4 });
    assert.deepEqual(
      Array.from(end.result.dps),
      Array.from(full.dps.slice(0, 4)),
    );
    assert.deepStrictEqual(end.result.summary, prefix.summary);
    assert.deepStrictEqual(end.result.breakdown, prefix.breakdown);
    assertOrdered(fake.messages, 5);
    // The slice that was already scheduled does nothing: no fight runs after
    // the cancel, and nothing more is sent.
    const sent = fake.messages.length;
    fake.drain();
    assert.equal(fake.messages.length, sent);

    // The host is free again: a new batch runs from its first iteration.
    host.receive({ type: "start", id: 6, options: OPTIONS });
    fake.drain();
    assertSameResult(
      ofType(fake.messages, "result")[1].result,
      runBatch(OPTIONS),
    );
  });

  it("cancels before the first iteration with an empty result", () => {
    const fake = fakeHost();
    fake.host.receive({ type: "start", id: 1, options: OPTIONS });
    fake.host.receive({ type: "cancel", id: 1 });
    assert.deepEqual(
      fake.messages.map((message) => message.type),
      ["result"],
    );
    assert.equal(fake.messages[0].result.completed, 0);
    assert.equal(fake.messages[0].result.cancelled, true);
    assert.equal(fake.messages[0].result.summary.count, 0);
    assert.equal(fake.messages[0].result.summary.mean, null);
    fake.drain();
    assert.equal(fake.messages.length, 1);
  });

  it("ignores a cancel for another batch or one that ended", () => {
    const fake = fakeHost();
    fake.host.receive({ type: "cancel", id: 1 });
    assert.deepEqual(fake.messages, []);
    fake.host.receive({ type: "start", id: 1, options: OPTIONS });
    fake.host.receive({ type: "cancel", id: 2 });
    fake.host.receive({ type: "cancel", id: "1" });
    fake.drain();
    const [end] = ofType(fake.messages, "result");
    assert.equal(end.result.cancelled, false);
    const sent = fake.messages.length;
    fake.host.receive({ type: "cancel", id: 1 });
    assert.equal(fake.messages.length, sent);
  });

  it("reports bad options as the error BatchRunner throws", () => {
    for (const options of [
      { seed: 1, iterations: 0 },
      { seed: 1, duration: -1 },
      { iterations: 2 },
      { seed: 1, config: { talents: { nope: 1 } } },
    ]) {
      let expected;
      try {
        new BatchRunner(options);
      } catch (error) {
        expected = error;
      }
      assert.ok(expected, JSON.stringify(options));
      const fake = fakeHost();
      fake.host.receive({ type: "start", id: 3, options });
      assert.deepEqual(fake.messages, [
        {
          type: "error",
          id: 3,
          error: { name: expected.name, message: expected.message },
        },
      ]);
      assert.equal(fake.tasks.length, 0);
    }
  });

  it("refuses options that cannot cross a thread, and a missing options object", () => {
    for (const key of ["signal", "driver", "onProgress", "nope"]) {
      const fake = fakeHost();
      fake.host.receive({
        type: "start",
        id: 1,
        options: { seed: 1, [key]: undefined },
      });
      assert.equal(fake.messages[0].type, "error");
      assert.equal(fake.messages[0].error.name, "RangeError");
      assert.match(fake.messages[0].error.message, new RegExp(`"${key}"`));
      assert.match(
        fake.messages[0].error.message,
        /seed, iterations, duration, config/,
      );
    }
    for (const options of [undefined, null, [], 3]) {
      const fake = fakeHost();
      fake.host.receive({ type: "start", id: 1, options });
      assert.equal(fake.messages[0].error.name, "RangeError");
      assert.match(fake.messages[0].error.message, /options object/);
    }
  });

  it("runs one batch at a time", () => {
    const fake = fakeHost();
    fake.host.receive({ type: "start", id: 1, options: OPTIONS });
    fake.host.receive({ type: "start", id: 2, options: OPTIONS });
    assert.deepEqual(fake.messages, [
      {
        type: "error",
        id: 2,
        error: {
          name: "Error",
          message:
            "A batch (id 1) is already running. Cancel it, or wait for its result, before starting another.",
        },
      },
    ]);
    fake.drain();
    assertSameResult(
      ofType(fake.messages, "result")[0].result,
      runBatch(OPTIONS),
    );
    assert.equal(ofType(fake.messages, "result")[0].id, 1);
  });

  it("answers a message it does not know with an error", () => {
    const fake = fakeHost();
    fake.host.receive(null);
    fake.host.receive("start");
    fake.host.receive({ type: "start" });
    fake.host.receive({ type: "start", id: Infinity, options: OPTIONS });
    fake.host.receive({ type: "start", id: {}, options: OPTIONS });
    fake.host.receive({ type: "go", id: 4 });
    fake.host.receive({ id: 5 });
    assert.deepEqual(
      fake.messages.map(({ id, error }) => [id, error.name]),
      [
        [null, "TypeError"],
        [null, "TypeError"],
        [null, "TypeError"],
        [null, "TypeError"],
        [null, "TypeError"],
        [4, "TypeError"],
        [5, "TypeError"],
      ],
    );
    assert.match(
      fake.messages[5].error.message,
      /Unknown batch message type "go"/,
    );
    assert.match(fake.messages[2].error.message, /needs an id/);
    assert.equal(fake.tasks.length, 0);
  });

  it("reports an iteration that throws, after its progress, and recovers", () => {
    const fake = fakeHost();
    let calls = 0;
    const host = createBatchHost({
      post: (message) => fake.messages.push(message),
      now: () => fake.clock.time,
      schedule: (task) => fake.tasks.push(task),
      createRunner: (options) => {
        const runner = new BatchRunner(options);
        const advance = runner.advance.bind(runner);
        runner.advance = (count) => {
          calls += 1;
          fake.clock.time += k("batch.progressInterval");
          if (calls === 3) {
            throw new TypeError("iteration 3 broke");
          }
          return advance(count);
        };
        return runner;
      },
    });
    host.receive({ type: "start", id: 8, options: OPTIONS });
    fake.drain();
    assert.deepEqual(
      fake.messages.map((message) => message.type),
      ["progress", "progress", "error"],
    );
    assert.deepEqual(fake.messages.at(-1), {
      type: "error",
      id: 8,
      error: { name: "TypeError", message: "iteration 3 broke" },
    });
    assertOrdered(fake.messages, 8);
    host.receive({
      type: "start",
      id: 9,
      options: { ...OPTIONS, iterations: 1 },
    });
    fake.drain();
    assert.equal(fake.messages.at(-1).type, "result");
  });

  it("checks its own arguments", () => {
    const post = () => {};
    const now = () => 0;
    assert.throws(() => createBatchHost({ now }), TypeError);
    assert.throws(() => createBatchHost({ post }), TypeError);
    assert.throws(() => createBatchHost({ post, now, schedule: 1 }), TypeError);
    assert.throws(
      () => createBatchHost({ post, now, createRunner: 1 }),
      TypeError,
    );
  });

  it("serializes errors as plain data and back", () => {
    assert.deepEqual(serializeError(new RangeError("r")), {
      name: "RangeError",
      message: "r",
    });
    assert.deepEqual(serializeError("plain"), {
      name: "Error",
      message: "plain",
    });
    for (const Class of [Error, RangeError, TypeError]) {
      const back = deserializeError(serializeError(new Class("m")));
      assert.equal(back.constructor, Class);
      assert.equal(back.message, "m");
    }
    const odd = deserializeError({ name: "DataCloneError", message: "x" });
    assert.equal(odd.constructor, Error);
    assert.equal(odd.name, "DataCloneError");
    assert.equal(odd.message, "x");
    assert.equal(deserializeError("bare").message, "bare");
    // #155: missing fields are not the text "undefined".
    for (const data of [{}, { name: undefined, message: undefined }]) {
      const empty = deserializeError(data);
      assert.equal(empty.constructor, Error);
      assert.equal(empty.name, "Error");
      assert.equal(empty.message, "");
    }
    assert.equal(deserializeError({ name: "RangeError" }).message, "");
    assert.equal(deserializeError({ message: "only" }).constructor, Error);
    // #187: a field that is present but falsy is kept, not replaced by the
    // default (the ?? in deserializeError, not ||). serializeError always
    // sends strings, so an empty name round-trips as an empty name.
    assert.equal(deserializeError({ name: "Error", message: 0 }).message, "0");
    assert.equal(deserializeError({ name: "", message: "m" }).name, "");
    const unnamed = new Error("m");
    unnamed.name = "";
    assert.equal(deserializeError(serializeError(unnamed)).name, "");
  });

  it("states the protocol", () => {
    assert.deepEqual(Object.keys(BATCH_MESSAGE_TYPES), [
      "start",
      "cancel",
      "ready",
      "progress",
      "result",
      "error",
    ]);
    assert.deepEqual(START_OPTIONS, [
      "seed",
      "iterations",
      "duration",
      "config",
    ]);
    assert.ok(Object.isFrozen(BATCH_MESSAGE_TYPES));
    assert.ok(Object.isFrozen(START_OPTIONS));
  });

  it("schedules the next task without holding the process open", async () => {
    const order = [];
    await new Promise((resolve) => {
      nextTask(() => {
        order.push("task");
        resolve();
      });
      queueMicrotask(() => order.push("microtask"));
      order.push("sync");
    });
    assert.deepEqual(order, ["sync", "microtask", "task"]);
  });
});

// Every thread these tests start, so after() can stop the ones a failed test
// left running (a test that times out never reaches its own terminate()).
const threads = new Set();
after(() => Promise.all([...threads].map((thread) => thread.terminate())));

// The real js/batch-worker.js on a worker_threads thread
// (test/batch-worker-thread.js gives it a `self`), as the Worker-like object
// BatchClient takes.
function threadWorker() {
  const worker = new Worker(
    new URL("./batch-worker-thread.js", import.meta.url),
  );
  threads.add(worker);
  worker.once("exit", () => threads.delete(worker));
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer),
    addEventListener: (type, listener) => {
      if (type === "message") {
        worker.on("message", (data) => listener({ data }));
      } else if (type === "error") {
        worker.on("error", (error) => listener({ message: error.message }));
      } else if (type === "messageerror") {
        worker.on("messageerror", listener);
      } else if (type === "exit") {
        worker.on("exit", (code) => listener({ code }));
      }
    },
    terminate: () => worker.terminate(),
  };
}

describe("batch on a second thread (worker_threads)", SETTLE, () => {
  it("gives the result of runBatch, byte for byte, with ordered progress", async () => {
    const client = new BatchClient({ createWorker: threadWorker });
    assert.equal(client.mode, "worker");
    try {
      for (const options of [
        OPTIONS,
        { ...OPTIONS, seed: 2, config: TALENTED },
      ]) {
        const progress = [];
        const result = await client.run(options, {
          onProgress: (event) => progress.push(event),
        });
        assertSameResult(result, runBatch(options));
        assert.ok(progress.length >= 1);
        assert.deepEqual(progress.at(-1), {
          completed: options.iterations,
          total: options.iterations,
          mean: result.summary.mean,
        });
        for (let index = 1; index < progress.length; index += 1) {
          assert.ok(progress[index].completed > progress[index - 1].completed);
        }
      }
    } finally {
      client.terminate();
    }
  });

  it("cancels on the other thread with a prefix of the batch", async () => {
    const client = new BatchClient({ createWorker: threadWorker });
    try {
      const options = { seed: 3, iterations: 2000, duration: FIGHT };
      const run = client.run(options, {
        onProgress: () => client.cancel(),
      });
      const result = await run;
      assert.equal(result.cancelled, true);
      assert.ok(result.completed >= 1 && result.completed < 2000);
      const prefix = runBatch({ ...options, iterations: result.completed });
      assert.deepEqual(Array.from(result.dps), Array.from(prefix.dps));
      assert.deepStrictEqual(result.summary, prefix.summary);
      assert.equal(client.running, false);
      assert.equal(client.cancel(), false);
    } finally {
      client.terminate();
    }
  });

  it("rejects bad options, and options that cannot be cloned", async () => {
    const client = new BatchClient({ createWorker: threadWorker });
    try {
      await assert.rejects(client.run({ seed: 1, iterations: 0 }), {
        name: "RangeError",
        message: /whole number of iterations/,
      });
      await assert.rejects(
        client.run({ seed: 1, config: { rotation: () => {} } }),
        { name: "DataCloneError" },
      );
      assert.equal(client.running, false);
      assertSameResult(await client.run(OPTIONS), runBatch(OPTIONS));
    } finally {
      client.terminate();
    }
  });
});

// A Worker-like object that fails to load, as a browser's does when it cannot
// run a module worker.
function brokenWorker(log) {
  const listeners = {};
  setTimeout(
    () =>
      listeners.error?.({
        message: "no modules",
        preventDefault: () => log.push("prevented"),
      }),
    0,
  );
  return {
    postMessage: (message) => log.push(message),
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    terminate: () => log.push("terminated"),
  };
}

describe("batch client (#147)", SETTLE, () => {
  it("runs on the main thread in slices and gives the result of runBatch", async () => {
    const client = new BatchClient({ mode: "main" });
    assert.equal(client.mode, "main");
    const progress = [];
    const run = client.run(OPTIONS, {
      onProgress: (event) => progress.push(event),
    });
    assert.equal(client.running, true);
    assert.deepEqual(progress, [], "nothing runs inside run()");
    assertSameResult(await run, runBatch(OPTIONS));
    assert.equal(client.running, false);
    assert.equal(progress.at(-1).completed, OPTIONS.iterations);
  });

  it("falls back to the main thread where there are no module workers", async () => {
    const client = new BatchClient();
    assert.equal(
      supportsModuleWorkers(),
      typeof globalThis.Worker === "function",
    );
    assert.equal(client.mode, supportsModuleWorkers() ? "worker" : "main");
    if (client.mode === "main") {
      assertSameResult(await client.run(OPTIONS), runBatch(OPTIONS));
    }
  });

  it("detects module workers by whether Worker reads the type option", () => {
    class Modern {
      constructor(url, options) {
        void options.type;
        throw new Error("blocked");
      }
    }
    class Classic {
      constructor() {}
      terminate() {}
    }
    assert.equal(supportsModuleWorkers(Modern), true);
    assert.equal(supportsModuleWorkers(Classic), false);
    assert.equal(supportsModuleWorkers(undefined), false);
  });

  it("reruns on the main thread when the worker fails to load (auto)", async () => {
    const log = [];
    const client = new BatchClient({ createWorker: () => brokenWorker(log) });
    assert.equal(client.mode, "worker");
    const result = await client.run(OPTIONS);
    assert.equal(client.mode, "main");
    assertSameResult(result, runBatch(OPTIONS));
    assert.equal(log[0].type, "start");
    // The load error is handled: the browser does not report it as uncaught.
    assert.deepEqual(log.slice(1), ["terminated", "prevented"]);

    // A cancel sent before the fallback carries over.
    const second = new BatchClient({ createWorker: () => brokenWorker([]) });
    const run = second.run(OPTIONS);
    assert.equal(second.cancel(), true);
    const cancelled = await run;
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.completed, 0);
  });

  it("rejects when a forced worker fails to load", async () => {
    const log = [];
    const client = new BatchClient({
      mode: "worker",
      createWorker: () => brokenWorker(log),
    });
    await assert.rejects(client.run(OPTIONS), {
      message: "The batch worker failed: no modules",
    });
    assert.ok(!log.includes("prevented"));
    assert.equal(client.mode, "worker");
    assert.equal(client.running, false);
  });

  it("rejects when a loaded worker fails, and starts a new worker next time", async () => {
    let made = 0;
    let fire;
    const client = new BatchClient({
      createWorker: () => {
        made += 1;
        const listeners = {};
        fire = (type, event) => listeners[type](event);
        return {
          postMessage: () => {},
          addEventListener: (type, listener) => {
            listeners[type] = listener;
          },
          terminate: () => {},
        };
      },
    });
    const run = client.run(OPTIONS);
    fire("message", { data: { type: "ready" } });
    fire("error", {});
    await assert.rejects(run, { message: "The batch worker failed." });
    assert.equal(client.mode, "worker");
    const again = client.run(OPTIONS);
    assert.equal(made, 2);
    fire("messageerror", {});
    await assert.rejects(again, {
      message: "A batch message could not be read.",
    });
  });

  it("ignores messages for other batches", async () => {
    let fire;
    const client = new BatchClient({
      createWorker: () => {
        const listeners = {};
        fire = (data) => listeners.message({ data });
        return {
          postMessage: () => {},
          addEventListener: (type, listener) => {
            listeners[type] = listener;
          },
          terminate: () => {},
        };
      },
    });
    const progress = [];
    const run = client.run(OPTIONS, {
      onProgress: (event) => progress.push(event),
    });
    fire({ type: "result", id: 99, result: "stale" });
    fire({ type: "progress", id: 99, completed: 1, total: 1, mean: 1 });
    fire({
      type: "progress",
      id: 1,
      completed: 2,
      total: 12,
      mean: 3,
      extra: 1,
    });
    fire({
      type: "error",
      id: 1,
      error: { name: "RangeError", message: "bad" },
    });
    await assert.rejects(run, { name: "RangeError", message: "bad" });
    assert.deepEqual(progress, [{ completed: 2, total: 12, mean: 3 }]);
  });

  it("runs one batch at a time, and cancel says whether it stopped one", async () => {
    const client = new BatchClient({ mode: "main" });
    assert.equal(client.cancel(), false);
    const first = client.run({ ...OPTIONS, iterations: 200 });
    await assert.rejects(client.run(OPTIONS), /already running/);
    assert.equal(client.cancel(), true);
    const result = await first;
    assert.equal(result.cancelled, true);
    assert.ok(result.completed < 200);
    assertSameResult(await client.run(OPTIONS), runBatch(OPTIONS));
  });

  it("rejects a terminated run, bad options and a bad progress handler", async () => {
    const client = new BatchClient({ mode: "main" });
    const run = client.run(OPTIONS);
    client.terminate();
    await assert.rejects(run, { message: "The batch client was terminated." });
    assert.equal(client.running, false);
    await assert.rejects(client.run({ seed: 1, nope: 1 }), {
      name: "RangeError",
      message: /no option "nope"/,
    });
    await assert.rejects(client.run(OPTIONS, { onProgress: 1 }), TypeError);
    assertSameResult(await client.run(OPTIONS), runBatch(OPTIONS));
  });

  it("calls the progress handler after the slice, not inside it", async () => {
    const tasks = [];
    const client = new BatchClient({
      mode: "main",
      schedule: (task) => tasks.push(task),
    });
    const progress = [];
    const run = client.run(OPTIONS, {
      onProgress: (event) => progress.push(event.completed),
    });
    while (tasks.length > 0) {
      const seen = progress.length;
      tasks.shift()();
      assert.equal(progress.length, seen, "no handler inside the slice");
      await Promise.resolve();
    }
    assertSameResult(await run, runBatch(OPTIONS));
    assert.equal(progress.at(-1), OPTIONS.iterations);
  });

  it("checks its options", () => {
    assert.deepEqual(BATCH_CLIENT_MODES, ["auto", "worker", "main"]);
    assert.throws(() => new BatchClient({ mode: "thread" }), RangeError);
    assert.throws(() => new BatchClient({ worker: 1 }), RangeError);
    assert.throws(() => new BatchClient(null), TypeError);
    for (const name of ["createWorker", "now", "schedule", "setTimer"]) {
      assert.throws(() => new BatchClient({ [name]: 1 }), TypeError);
    }
  });

  it("uses the injected clock and schedule on the main thread", async () => {
    let time = 0;
    let scheduled = 0;
    const client = new BatchClient({
      mode: "main",
      now: () => time,
      schedule: (task) => {
        scheduled += 1;
        time += k("batch.sliceBudget");
        setImmediate(task);
      },
    });
    const progress = [];
    const result = await client.run(OPTIONS, {
      onProgress: (event) => progress.push(event.completed),
    });
    assertSameResult(result, runBatch(OPTIONS));
    // A clock that stands still in a slice: the whole batch is one slice.
    assert.equal(scheduled, 1);
    assert.deepEqual(progress, [1, OPTIONS.iterations]);
  });
});

describe("the worker file (#147)", () => {
  it("is a thin module worker over the batch host", async () => {
    const source = await readFile(
      new URL("../js/batch-worker.js", import.meta.url),
      "utf8",
    );
    const imports = [
      ...source.matchAll(/^import\b[^;]*? from "([^"]+)";$/gm),
    ].map((match) => match[1]);
    assert.deepEqual(imports, ["./batch-host.js"]);
    assert.match(source, /self\.addEventListener\("message"/);
    assert.match(source, /self\.postMessage\(\{ type: "ready" \}\)/);
    const client = await readFile(
      new URL("../js/batch-client.js", import.meta.url),
      "utf8",
    );
    assert.match(
      client,
      /new URL\("\.\/batch-worker\.js", import\.meta\.url\)/,
    );
    assert.match(client, /type: "module"/);
  });
});

// Issue #155 (Kira's QA of #147 in #170): four worker and batch bugs, one
// regression test (or more) each.

// A Worker-like object the test drives by hand: fire(type, event) calls the
// listener, and `posted` keeps what the client sent.
function handWorker() {
  const listeners = {};
  const worker = {
    posted: [],
    terminated: false,
    fire: (type, event) => listeners[type]?.(event),
    postMessage: (message) => worker.posted.push(message),
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    terminate: () => {
      worker.terminated = true;
    },
  };
  return worker;
}

// A setTimer the test fires by hand.
function handTimer() {
  const timers = [];
  const setTimer = (callback, ms) => {
    const timer = { callback, ms, cleared: false };
    timers.push(timer);
    return () => {
      timer.cleared = true;
    };
  };
  return { timers, setTimer };
}

// A worker_threads thread that exits as it starts, as the Worker-like object
// BatchClient takes (with the "exit" event).
function exitingWorker() {
  const worker = new Worker("process.exit(3);", { eval: true });
  threads.add(worker);
  worker.once("exit", () => threads.delete(worker));
  return {
    postMessage: () => {},
    addEventListener: (type, listener) => {
      if (type === "exit") {
        worker.on("exit", (code) => listener({ code }));
      }
    },
    terminate: () => worker.terminate(),
  };
}

describe("worker and batch fixes (#155)", SETTLE, () => {
  // Bug 1: cancel() on the last iteration reports a cancelled batch.
  it("calls a batch cancelled when cancel() comes from the last progress (runner)", () => {
    const runner = new BatchRunner({ ...OPTIONS });
    runner.onProgress(({ completed }) => {
      if (completed === OPTIONS.iterations) {
        runner.cancel();
      }
    });
    runner.run();
    runner.advance(OPTIONS.iterations);
    const { result } = runner;
    assert.equal(result.cancelled, true);
    assert.equal(result.completed, OPTIONS.iterations);
    assert.deepEqual(result.dps, runBatch(OPTIONS).dps);
  });

  for (const [label, makeClient] of [
    ["main thread", () => new BatchClient({ mode: "main" })],
    ["worker thread", () => new BatchClient({ createWorker: threadWorker })],
  ]) {
    it(`calls a batch cancelled when cancel() comes from the last progress (client, ${label})`, async () => {
      const client = makeClient();
      try {
        let answered;
        const result = await client.run(OPTIONS, {
          onProgress: ({ completed }) => {
            if (completed === OPTIONS.iterations) {
              answered = client.cancel();
            }
          },
        });
        assert.equal(answered, true);
        assert.equal(result.cancelled, true);
        assert.equal(result.completed, OPTIONS.iterations);
        // Only the flag differs from the uncancelled batch.
        assertSameResult(result, { ...runBatch(OPTIONS), cancelled: true });
        // A batch nobody cancelled still says so.
        const plain = await client.run(OPTIONS);
        assert.equal(plain.cancelled, false);
        assertSameResult(plain, runBatch(OPTIONS));
      } finally {
        client.terminate();
      }
    });
  }

  // Bug 2: a load timeout and an exit watcher, so the client cannot hang.
  it("drops a worker that is not ready in time: main thread in auto, a rejection in worker mode", async () => {
    const auto = handTimer();
    const lost = handWorker();
    const client = new BatchClient({
      createWorker: () => lost,
      setTimer: auto.setTimer,
    });
    const run = client.run(OPTIONS);
    assert.equal(auto.timers.length, 1);
    assert.equal(auto.timers[0].ms, k("batch.workerLoadTimeout"));
    auto.timers[0].callback();
    assert.equal(lost.terminated, true);
    assert.equal(client.mode, "main");
    assertSameResult(await run, runBatch(OPTIONS));

    const forced = handTimer();
    const silent = handWorker();
    const strict = new BatchClient({
      mode: "worker",
      createWorker: () => silent,
      setTimer: forced.setTimer,
    });
    const rejected = strict.run(OPTIONS);
    forced.timers[0].callback();
    await assert.rejects(rejected, {
      message: `The batch worker failed: it was not ready within ${k("batch.workerLoadTimeout")} ms`,
    });
    assert.equal(silent.terminated, true);
    assert.equal(strict.running, false);
  });

  it("clears the load timeout when the worker is ready, and on terminate", () => {
    const { timers, setTimer } = handTimer();
    const worker = handWorker();
    const client = new BatchClient({ createWorker: () => worker, setTimer });
    void client.run(OPTIONS).catch(() => {});
    worker.fire("message", { data: { type: "ready" } });
    assert.equal(timers[0].cleared, true);
    // A late timeout does nothing to a ready worker.
    timers[0].callback();
    assert.equal(worker.terminated, false);
    assert.equal(client.running, true);
    client.terminate();

    const second = handTimer();
    const other = new BatchClient({
      createWorker: () => handWorker(),
      setTimer: second.setTimer,
    });
    void other.run(OPTIONS).catch(() => {});
    other.terminate();
    assert.equal(second.timers[0].cleared, true);
  });

  it("treats a worker that exits before it is ready as one that failed to load", async () => {
    const worker = handWorker();
    const client = new BatchClient({ createWorker: () => worker });
    const run = client.run(OPTIONS);
    worker.fire("exit", { code: 1 });
    assert.equal(client.mode, "main");
    assertSameResult(await run, runBatch(OPTIONS));

    const strict = new BatchClient({
      mode: "worker",
      createWorker: exitingWorker,
    });
    await assert.rejects(strict.run(OPTIONS), {
      message: "The batch worker failed: it exited (code 3)",
    });
    assert.equal(strict.running, false);
  });

  it("rejects the batch when a loaded worker exits, and starts a new one next time", async () => {
    const made = [];
    const client = new BatchClient({
      createWorker: () => {
        made.push(handWorker());
        return made.at(-1);
      },
    });
    const run = client.run(OPTIONS);
    made[0].fire("message", { data: { type: "ready" } });
    made[0].fire("exit", {});
    await assert.rejects(run, {
      message: "The batch worker failed: it exited",
    });
    assert.equal(client.mode, "worker");
    assert.equal(client.running, false);
    void client.run(OPTIONS).catch(() => {});
    assert.equal(made.length, 2);
    client.terminate();
  });

  it("ignores a late exit from a worker it already replaced", async () => {
    const made = [];
    const client = new BatchClient({
      createWorker: () => {
        made.push(handWorker());
        return made.at(-1);
      },
    });
    const first = client.run(OPTIONS);
    made[0].fire("message", { data: { type: "ready" } });
    client.terminate();
    await first.catch(() => {});
    const second = client.run(OPTIONS);
    assert.equal(made.length, 2);
    made[0].fire("exit", { code: 1 });
    assert.equal(client.running, true);
    assert.equal(client.mode, "worker");
    let settled = false;
    second.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.equal(settled, false);
    client.terminate();
    await second.catch(() => {});
  });

  // Bug 3: a Worker constructor that throws is a load failure.
  it("falls back to the main thread when the Worker constructor throws (auto)", async () => {
    const client = new BatchClient({
      createWorker: () => {
        throw new globalThis.DOMException("blocked", "SecurityError");
      },
    });
    assert.equal(client.mode, "worker");
    const progress = [];
    const result = await client.run(OPTIONS, {
      onProgress: (event) => progress.push(event.completed),
    });
    assert.equal(client.mode, "main");
    assertSameResult(result, runBatch(OPTIONS));
    assert.equal(progress.at(-1), OPTIONS.iterations);

    const strict = new BatchClient({
      mode: "worker",
      createWorker: () => {
        throw new globalThis.DOMException("blocked", "SecurityError");
      },
    });
    await assert.rejects(strict.run(OPTIONS), {
      name: "SecurityError",
      message: "blocked",
    });
    assert.equal(strict.mode, "worker");
    assert.equal(strict.running, false);
  });

  // Bug 4: a runner whose run() throws does not leave the host busy.
  it("is not left busy by a runner whose run() throws", () => {
    let calls = 0;
    const { host, messages, drain } = fakeHost({
      createRunner: (options) => {
        calls += 1;
        const runner = new BatchRunner(options);
        if (calls === 1) {
          runner.run = () => {
            throw new Error("run failed");
          };
        }
        return runner;
      },
    });
    host.receive({ type: "start", id: 1, options: OPTIONS });
    assert.deepEqual(messages, [
      { type: "error", id: 1, error: { name: "Error", message: "run failed" } },
    ]);
    host.receive({ type: "start", id: 2, options: OPTIONS });
    drain();
    const results = ofType(messages, "result");
    assert.equal(ofType(messages, "error").length, 1, "not already running");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 2);
    assertSameResult(results[0].result, runBatch(OPTIONS));
  });
});
