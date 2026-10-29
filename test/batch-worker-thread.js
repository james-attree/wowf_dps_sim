import { parentPort } from "node:worker_threads";

// Runs the real js/batch-worker.js on a worker_threads thread, for
// test/batch-worker.test.js (issue #147). Node has no Web Worker `self`, so
// this gives the worker one over the thread's port: postMessage with its
// transfer list, and "message" listeners that receive { data }, as in a
// browser. Every message crosses a structured clone. `node --test` also loads
// this file on the main thread, where there is no parent port and it does
// nothing.

if (parentPort !== null) {
  globalThis.self = {
    postMessage: (message, transfer) =>
      parentPort.postMessage(message, transfer),
    addEventListener: (type, listener) => {
      if (type !== "message") {
        throw new TypeError(`The test worker has no ${type} event.`);
      }
      parentPort.on("message", (data) => listener({ data }));
    },
  };
  await import("../js/batch-worker.js");
}
