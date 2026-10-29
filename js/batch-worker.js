import { createBatchHost } from "./batch-host.js";

// The batch Web Worker (S4, issue #147), a module worker: js/batch-client.js
// starts it with new Worker(url, { type: "module" }). It is a host, not engine
// code: it wires the worker's messages and clock to the batch host
// (js/batch-host.js), which runs the BatchRunner and speaks the protocol
// documented there. No other logic lives here, so the Node tests of the host
// cover what the worker does.

const host = createBatchHost({
  post: (message, transfer) => self.postMessage(message, transfer ?? []),
  now: () => performance.now(),
});

self.addEventListener("message", (event) => host.receive(event.data));
self.postMessage({ type: "ready" });
