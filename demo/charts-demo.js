import { BatchClient } from "../js/batch-client.js";
import {
  histogramChart,
  histogramTable,
  timelineChart,
  timelineTable,
} from "../js/charts.js";
import { toDom } from "../js/svg.js";

// The charts demo harness (#148): run a real batch through the batch client
// and draw its charts, without a page reload. The charts are node
// descriptions (js/charts.js) made into DOM nodes by toDom (js/svg.js): no
// innerHTML anywhere.

const client = new BatchClient();
const $ = (id) => document.getElementById(id);
let last = null;

function show(container, node) {
  container.replaceChildren(toDom(node, document));
}

function mode() {
  return document.querySelector('input[name="demo-mode"]:checked').value;
}

function render(result) {
  show($("demo-histogram"), histogramChart(result, { id: "demo-hist" }));
  show($("demo-histogram-table"), histogramTable(result));
  show(
    $("demo-timeline"),
    timelineChart(result.timeline, { id: "demo-time", mode: mode() }),
  );
  show($("demo-timeline-table"), timelineTable(result.timeline));
}

$("demo-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const options = {
    seed: Number($("demo-seed").value),
    iterations: Number($("demo-iterations").value),
    duration: Number($("demo-duration").value),
  };
  $("demo-run").disabled = true;
  $("demo-cancel").disabled = false;
  $("demo-status").textContent = `Running ${options.iterations} fights...`;
  const started = performance.now();
  try {
    last = await client.run(options, {
      onProgress: ({ completed, total }) => {
        $("demo-status").textContent = `Running: ${completed} of ${total}`;
      },
    });
    render(last);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    $("demo-status").textContent =
      `${last.cancelled ? "Cancelled" : "Done"}: ${last.completed} fights in ${seconds} s (${client.mode} mode).`;
  } catch (error) {
    $("demo-status").textContent = `${error.name}: ${error.message}`;
  } finally {
    $("demo-run").disabled = false;
    $("demo-cancel").disabled = true;
  }
});

$("demo-cancel").addEventListener("click", () => client.cancel());

for (const input of document.querySelectorAll('input[name="demo-mode"]')) {
  input.addEventListener("change", () => {
    if (last !== null) {
      render(last);
    }
  });
}
