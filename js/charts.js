import { k } from "../data/constants.js";
import { SVG_NS, el } from "./svg.js";

// The batch charts (Phase 3, #148, roadmap task S5): a histogram of the DPS
// of each iteration, with the mean and its 95% confidence interval marked, and
// the damage over time of the fight (cumulative or per second, the mean over
// the iterations with the lowest-to-highest band), each with a table that says
// the same in text.
//
// Plain SVG and no chart library. Everything here is a pure function of a
// batch result (js/batch-runner.js): the numbers (bins, ticks, scales) are
// plain data, and the charts are node descriptions (js/svg.js) that toMarkup()
// writes as a string and toDom() as DOM nodes. Nothing here touches a DOM,
// reads a clock or formats with the locale, so the same result gives the same
// markup on every run and every machine. The definitions are in
// docs/charts.md.
//
// Accessibility. Each chart is an <svg role="img"> labelled by its own <title>
// and <desc>: what it shows and the numbers that matter. Each has a table
// alternative (histogramTable, timelineTable). Nothing is told by colour
// alone: the mean is a solid line with a text label, the confidence interval
// a shaded band with dashed edges and a label, the lowest-to-highest band is
// named in the legend, and every bar has its own <title>.

const EN_DASH = "\u2013";

// The point `centre` of the way from a to b (k("chart.layout").centre, a
// half): where a centred label or the plot's middle sits.
function midpoint(a, b) {
  return a + (b - a) * k("chart.layout").centre;
}

function layout() {
  const box = k("chart.layout");
  return {
    ...box,
    left: box.marginLeft,
    right: box.width - box.marginRight,
    top: box.marginTop,
    bottom: box.height - box.marginBottom,
  };
}

// ---------------------------------------------------------------- numbers

function readFinite(value, what) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${what} needs a finite number. Got ${value}.`);
  }
  return value;
}

function readValues(values) {
  if (!(values instanceof Float64Array) && !Array.isArray(values)) {
    throw new TypeError(
      "Chart values are a Float64Array or an array of numbers.",
    );
  }
  for (const value of values) {
    readFinite(value, "Each chart value");
  }
  return values;
}

// `value` with `decimals` decimals and a comma between thousands, the same on
// every machine (no locale). Negative zero is written 0.
export function formatNumber(value, decimals = k("chart.decimals").value) {
  readFinite(value, "formatNumber");
  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith("-") && Number(fixed) !== 0;
  const [whole, fraction] = fixed.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

// An SVG coordinate: k("chart.decimals").coordinate decimals at most, no
// trailing zeros, no negative zero.
export function formatCoordinate(value) {
  readFinite(value, "formatCoordinate");
  const rounded = Number(value.toFixed(k("chart.decimals").coordinate));
  return String(rounded === 0 ? 0 : rounded);
}

// Round-number axis ticks over [low, high]: about k("chart.axisTicks").target
// intervals, each a step of 1, 2 or 5 times a power of 10. `integer` keeps the
// step a whole number (for counts). A range of no width is widened by one unit
// either side, so there is always an axis.
//
// Returns { low, high, step, ticks }: low and high the axis ends (round
// numbers around the range), ticks every step from low to high.
export function niceTicks(low, high, { integer = false } = {}) {
  readFinite(low, "niceTicks low");
  readFinite(high, "niceTicks high");
  if (high < low) {
    throw new RangeError(`niceTicks needs low <= high. Got ${low} > ${high}.`);
  }
  let from = low;
  let to = high;
  if (from === to) {
    from -= 1;
    to += 1;
  }
  const { target, base, steps } = k("chart.axisTicks");
  const raw = (to - from) / target;
  const magnitude = base ** Math.floor(Math.log(raw) / Math.log(base));
  let step = steps[steps.length - 1] * magnitude;
  for (const multiple of steps) {
    const candidate = multiple * magnitude;
    if (Math.ceil(to / candidate) - Math.floor(from / candidate) <= target) {
      step = candidate;
      break;
    }
  }
  if (integer) {
    step = Math.max(Math.round(step), 1);
  }
  const first = Math.floor(from / step);
  const last = Math.ceil(to / step);
  const ticks = [];
  for (let index = first; index <= last; index += 1) {
    ticks.push(clean(index * step, step));
  }
  return { low: ticks[0], high: ticks[ticks.length - 1], step, ticks };
}

// index * step without the floating-point tail (0.30000000000000004): rounded
// to the step's own decimals.
function clean(value, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(value.toFixed(decimals));
}

// A linear map from [domainLow, domainHigh] to [rangeLow, rangeHigh].
export function linearScale(domainLow, domainHigh, rangeLow, rangeHigh) {
  const span = domainHigh - domainLow;
  return (value) =>
    span === 0
      ? midpoint(rangeLow, rangeHigh)
      : rangeLow + ((value - domainLow) / span) * (rangeHigh - rangeLow);
}

// ---------------------------------------------------------------- histogram

// The histogram bins of `values` (a batch result's dps).
//
// The rule: n values give min(chart.histogramMaxBins, ceil(sqrt(n))) bins of
// equal width from the lowest value to the highest. Bin i holds the values v
// with floor((v - min) / width) = i, and the highest value goes in the last
// bin, so every value is in exactly one bin and the counts add up to n. When
// every value is the same (one iteration, or no variance) there is one bin of
// width 0 holding all of them. No value, no bin.
//
// Returns { count, min, max, width, bins }: bins an array of
// { low, high, count }, low to high. min, max and width are null with no value.
export function histogramBins(values) {
  readValues(values);
  const count = values.length;
  if (count === 0) {
    return { count, min: null, max: null, width: null, bins: [] };
  }
  let min = values[0];
  let max = values[0];
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min === max) {
    return {
      count,
      min,
      max,
      width: 0,
      bins: [{ low: min, high: max, count }],
    };
  }
  const binCount = Math.min(
    k("chart.histogramMaxBins"),
    Math.ceil(Math.sqrt(count)),
  );
  const width = (max - min) / binCount;
  const counts = new Array(binCount).fill(0);
  for (const value of values) {
    counts[Math.min(Math.floor((value - min) / width), binCount - 1)] += 1;
  }
  const bins = counts.map((binTotal, index) => ({
    low: min + index * width,
    high: index === binCount - 1 ? max : min + (index + 1) * width,
    count: binTotal,
  }));
  return { count, min, max, width, bins };
}

function readIdPrefix(id) {
  if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9-]*$/.test(id)) {
    throw new RangeError(
      `A chart id is a letter then letters, digits or "-". Got ${JSON.stringify(id)}.`,
    );
  }
  return id;
}

function readBatch(result) {
  if (
    result === null ||
    typeof result !== "object" ||
    result.summary === null ||
    typeof result.summary !== "object"
  ) {
    throw new TypeError(
      "A chart needs a batch result (BatchRunner#result, runBatch, BatchClient).",
    );
  }
  return result;
}

// The <svg> root: role="img", labelled by its <title> and <desc>.
function chartRoot(id, className, title, desc, children) {
  const box = layout();
  return el(
    "svg",
    {
      xmlns: SVG_NS,
      viewBox: `0 0 ${box.width} ${box.height}`,
      class: `chart ${className}`,
      role: "img",
      "aria-labelledby": `${id}-title ${id}-desc`,
    },
    [
      el("title", { id: `${id}-title` }, [title]),
      el("desc", { id: `${id}-desc` }, [desc]),
      ...children,
    ],
  );
}

function line(x1, y1, x2, y2, attrs) {
  return el("line", {
    x1: formatCoordinate(x1),
    y1: formatCoordinate(y1),
    x2: formatCoordinate(x2),
    y2: formatCoordinate(y2),
    ...attrs,
  });
}

function label(x, y, content, attrs) {
  return el(
    "text",
    { x: formatCoordinate(x), y: formatCoordinate(y), ...attrs },
    [content],
  );
}

// The two axes, their ticks and tick labels, and their titles.
function axes(xTicks, yTicks, xScale, yScale, xTitle, yTitle, yFormat) {
  const box = layout();
  const children = [
    line(box.left, box.bottom, box.right, box.bottom, {
      class: "chart-axis-line",
      stroke: "currentColor",
    }),
    line(box.left, box.top, box.left, box.bottom, {
      class: "chart-axis-line",
      stroke: "currentColor",
    }),
  ];
  for (const tick of xTicks.ticks) {
    const x = xScale(tick);
    children.push(
      line(x, box.bottom, x, box.bottom + box.tickLength, {
        stroke: "currentColor",
      }),
      label(
        x,
        box.bottom + box.tickLength + box.tickLabelGap,
        formatTick(tick),
        {
          "text-anchor": "middle",
          "dominant-baseline": "hanging",
        },
      ),
    );
  }
  for (const tick of yTicks.ticks) {
    const y = yScale(tick);
    children.push(
      line(box.left - box.tickLength, y, box.left, y, {
        stroke: "currentColor",
      }),
      line(box.left, y, box.right, y, {
        class: "chart-grid",
        stroke: "currentColor",
        "stroke-opacity": "0.15",
      }),
      label(box.left - box.tickLength - box.tickLabelGap, y, yFormat(tick), {
        "text-anchor": "end",
        "dominant-baseline": "middle",
      }),
    );
  }
  children.push(
    label(
      midpoint(box.left, box.right),
      box.bottom + box.xAxisTitleGap,
      xTitle,
      {
        class: "chart-axis-title",
        "text-anchor": "middle",
        "dominant-baseline": "hanging",
      },
    ),
    label(box.left - box.yAxisTitleGap, midpoint(box.top, box.bottom), yTitle, {
      class: "chart-axis-title",
      "text-anchor": "middle",
      transform: `rotate(-90 ${formatCoordinate(box.left - box.yAxisTitleGap)} ${formatCoordinate(midpoint(box.top, box.bottom))})`,
    }),
  );
  return el(
    "g",
    { class: "chart-axes", "font-size": "11", fill: "currentColor" },
    children,
  );
}

// A time in seconds: whole seconds without decimals, a part second (a
// duration of 10.5 s) with k("chart.decimals").value.
function formatSeconds(value) {
  return formatNumber(
    value,
    Number.isInteger(value) ? 0 : k("chart.decimals").value,
  );
}

// A tick label: as many decimals as the tick needs (none for whole numbers).
function formatTick(value) {
  const decimals = Number.isInteger(value)
    ? 0
    : String(value).split(".")[1].length;
  return formatNumber(value, decimals);
}

// A legend along the top: each item a swatch drawn in the item's own style
// (so the legend does not lean on colour) and its name.
function legend(items) {
  const box = layout();
  const y = box.top - box.legendGap;
  const children = [];
  let x = box.left;
  for (const item of items) {
    children.push(
      item.swatch(x, y),
      label(x + box.legendSwatch + box.tickLength, y, item.name, {
        "dominant-baseline": "middle",
      }),
    );
    x +=
      box.legendSwatch +
      box.tickLength +
      item.name.length * box.legendCharWidth +
      box.legendItemGap;
  }
  return el(
    "g",
    { class: "chart-legend", "font-size": "11", fill: "currentColor" },
    children,
  );
}

function meanSwatch(x, y) {
  const box = layout();
  return line(x, y, x + box.legendSwatch, y, {
    class: "chart-mean",
    stroke: "currentColor",
    "stroke-width": "2",
  });
}

function bandSwatch(className, dashed) {
  return (x, y) => {
    const box = layout();
    return el("rect", {
      x: formatCoordinate(x),
      y: formatCoordinate(y - box.legendSwatchHeight * box.centre),
      width: formatCoordinate(box.legendSwatch),
      height: formatCoordinate(box.legendSwatchHeight),
      class: className,
      fill: "currentColor",
      "fill-opacity": "0.2",
      stroke: "currentColor",
      ...(dashed ? { "stroke-dasharray": "3 2" } : {}),
    });
  };
}

// The histogram of a batch result's per-iteration DPS (result.dps), with the
// mean (result.summary.mean) and its 95% confidence interval
// (result.summary.ci95) marked. `id` prefixes the ids of the chart's <title>
// and <desc>, so two charts on one page do not clash.
export function histogramChart(result, { id = "dps-histogram" } = {}) {
  readBatch(result);
  const prefix = readIdPrefix(id);
  const histogram = histogramBins(result.dps);
  const title = `DPS per iteration, ${formatNumber(histogram.count, 0)} ${histogram.count === 1 ? "fight" : "fights"}`;
  if (histogram.count === 0) {
    return chartRoot(
      prefix,
      "chart-histogram",
      title,
      "No completed fight, so no histogram.",
      [emptyMessage("No completed fight")],
    );
  }
  const { mean, ci95 } = result.summary;
  const box = layout();
  // One fight has no confidence interval (RunningStats gives ci95 null).
  const xTicks = niceTicks(
    Math.min(histogram.min, ci95?.low ?? histogram.min),
    Math.max(histogram.max, ci95?.high ?? histogram.max),
  );
  const xScale = linearScale(xTicks.low, xTicks.high, box.left, box.right);
  const highest = Math.max(...histogram.bins.map((bin) => bin.count));
  const yTicks = niceTicks(0, highest, { integer: true });
  const yScale = linearScale(yTicks.low, yTicks.high, box.bottom, box.top);
  // A bin of no width (every fight the same DPS) is drawn one tick step wide.
  const barLow = (bin) =>
    histogram.width === 0 ? bin.low - xTicks.step * box.centre : bin.low;
  const barHigh = (bin) =>
    histogram.width === 0 ? bin.high + xTicks.step * box.centre : bin.high;
  const bars = histogram.bins.map((bin) =>
    el(
      "rect",
      {
        class: "chart-bar",
        x: formatCoordinate(xScale(barLow(bin))),
        y: formatCoordinate(yScale(bin.count)),
        width: formatCoordinate(xScale(barHigh(bin)) - xScale(barLow(bin))),
        height: formatCoordinate(yScale(0) - yScale(bin.count)),
        fill: "currentColor",
        "fill-opacity": "0.55",
        stroke: "currentColor",
        "stroke-opacity": "0.9",
      },
      [el("title", {}, [binText(bin)])],
    ),
  );
  const meanX = xScale(mean);
  const desc =
    `Histogram of the DPS of ${histogram.count === 1 ? "one fight" : `each of ${formatNumber(histogram.count, 0)} fights`} in ${histogram.bins.length} ${histogram.bins.length === 1 ? "bin" : "bins"}` +
    `${histogram.width === 0 ? " (every fight has the same DPS)" : ` of ${formatNumber(histogram.width)} DPS`}, ` +
    `from ${formatNumber(histogram.min)} to ${formatNumber(histogram.max)} DPS. ` +
    `Mean ${formatNumber(mean)} DPS, ${ciText(ci95)}. ` +
    `The tallest bin has ${formatNumber(highest, 0)} ${highest === 1 ? "fight" : "fights"}.`;
  return chartRoot(prefix, "chart-histogram", title, desc, [
    axes(xTicks, yTicks, xScale, yScale, "DPS", "Fights", (tick) =>
      formatTick(tick),
    ),
    ci95 !== null && ciMarker(ci95, xScale),
    el("g", { class: "chart-bars" }, bars),
    el("g", { class: "chart-mean-marker" }, [
      line(meanX, box.top, meanX, box.bottom, {
        class: "chart-mean",
        stroke: "currentColor",
        "stroke-width": "2",
      }),
      label(
        meanX + box.tickLength,
        box.top + box.tickLabelGap,
        `mean ${formatNumber(mean)}`,
        {
          class: "chart-mean-label",
          "font-size": "11",
          fill: "currentColor",
          "dominant-baseline": "hanging",
        },
      ),
    ]),
    legend([
      { name: "mean DPS", swatch: meanSwatch },
      ...(ci95 === null
        ? []
        : [
            {
              name: "95% confidence interval",
              swatch: bandSwatch("chart-ci-band", true),
            },
          ]),
    ]),
  ]);
}

// The 95% confidence interval of the mean, as a band with dashed edges.
function ciMarker(ci95, xScale) {
  const box = layout();
  const low = xScale(ci95.low);
  const high = xScale(ci95.high);
  const edge = (x) =>
    line(x, box.top, x, box.bottom, {
      class: "chart-ci-edge",
      stroke: "currentColor",
      "stroke-dasharray": "4 3",
    });
  return el("g", { class: "chart-ci" }, [
    el("rect", {
      class: "chart-ci-band",
      x: formatCoordinate(low),
      y: formatCoordinate(box.top),
      width: formatCoordinate(high - low),
      height: formatCoordinate(box.bottom - box.top),
      fill: "currentColor",
      "fill-opacity": "0.12",
    }),
    edge(low),
    edge(high),
  ]);
}

function ciText(ci95) {
  return ci95 === null
    ? "no confidence interval from one fight"
    : `95% confidence interval ${formatNumber(ci95.low)} to ${formatNumber(ci95.high)} DPS`;
}

function binText(bin) {
  return `${formatNumber(bin.low)}${EN_DASH}${formatNumber(bin.high)} DPS: ${formatNumber(bin.count, 0)} ${bin.count === 1 ? "fight" : "fights"}`;
}

function emptyMessage(message) {
  const box = layout();
  return label(midpoint(0, box.width), midpoint(0, box.height), message, {
    class: "chart-empty",
    "text-anchor": "middle",
    fill: "currentColor",
  });
}

function table(caption, head, rows, className) {
  return el("table", { class: `chart-table ${className}` }, [
    el("caption", {}, [caption]),
    el("thead", {}, [
      el(
        "tr",
        {},
        head.map((name) => el("th", { scope: "col" }, [name])),
      ),
    ]),
    el(
      "tbody",
      {},
      rows.map((row) =>
        el(
          "tr",
          {},
          row.map((cell) => el("td", {}, [cell])),
        ),
      ),
    ),
  ]);
}

// The histogram's table alternative: one row per bin.
export function histogramTable(result) {
  readBatch(result);
  const histogram = histogramBins(result.dps);
  const { mean, ci95 } = result.summary;
  const caption =
    histogram.count === 0
      ? "DPS per iteration: no completed fight"
      : `DPS per iteration, ${formatNumber(histogram.count, 0)} ${histogram.count === 1 ? "fight" : "fights"}: mean ${formatNumber(mean)} DPS, ${ciText(ci95)}`;
  return table(
    caption,
    ["DPS from", "DPS to", "Fights"],
    histogram.bins.map((bin) => [
      formatNumber(bin.low),
      formatNumber(bin.high),
      formatNumber(bin.count, 0),
    ]),
    "chart-table-histogram",
  );
}

// ---------------------------------------------------------------- timeline

const MODES = ["cumulative", "perSecond"];

function readTimeline(timeline) {
  if (
    timeline === null ||
    typeof timeline !== "object" ||
    !Number.isInteger(timeline.fights) ||
    !Number.isInteger(timeline.length)
  ) {
    throw new TypeError(
      "A timeline chart needs a batch result's timeline (BatchTimeline#summary()).",
    );
  }
  return timeline;
}

function readMode(mode) {
  if (!MODES.includes(mode)) {
    throw new RangeError(
      `A timeline chart's mode is one of ${MODES.join(", ")}. Got ${JSON.stringify(mode)}.`,
    );
  }
  return mode;
}

// The fight time at the end of bucket `index`: the last one ends at the
// duration, which may be part way through a bucket.
function bucketEnd(timeline, index) {
  return Math.min((index + 1) * timeline.bucketSeconds, timeline.duration);
}

function bucketStart(timeline, index) {
  return index * timeline.bucketSeconds;
}

// The series a timeline chart draws, as plain points [time, value].
//
//   cumulative  the mean, lowest and highest damage dealt from the start of
//               the fight: (0, 0), then one point at the end of each bucket
//   perSecond   the mean damage per second of each bucket, as steps: a point
//               at the start and the end of each bucket. A last bucket shorter
//               than bucketSeconds is divided by its own length.
//
// Returns { mean, min, max }: arrays of [time, value]. min and max are null
// in perSecond mode. All null with no fight.
export function timelineSeries(timeline, mode = "cumulative") {
  readTimeline(timeline);
  readMode(mode);
  if (timeline.fights === 0 || timeline.length === 0) {
    return { mean: null, min: null, max: null };
  }
  if (mode === "cumulative") {
    const series = (values) => [
      [0, 0],
      ...Array.from(values, (value, index) => [
        bucketEnd(timeline, index),
        value,
      ]),
    ];
    return {
      mean: series(timeline.cumulative.mean),
      min: series(timeline.cumulative.min),
      max: series(timeline.cumulative.max),
    };
  }
  const mean = [];
  for (let index = 0; index < timeline.length; index += 1) {
    const start = bucketStart(timeline, index);
    const end = bucketEnd(timeline, index);
    const rate = timeline.damage[index] / (end - start);
    mean.push([start, rate], [end, rate]);
  }
  return { mean, min: null, max: null };
}

function points(series, xScale, yScale) {
  return series
    .map(
      ([x, y]) =>
        `${formatCoordinate(xScale(x))},${formatCoordinate(yScale(y))}`,
    )
    .join(" ");
}

// The damage-over-time chart of a batch result's timeline
// (result.timeline). mode "cumulative" (the default) draws the mean damage
// dealt from the start of the fight with the band from the lowest to the
// highest fight; "perSecond" draws the mean damage of each second.
export function timelineChart(
  timeline,
  { id = "damage-timeline", mode = "cumulative" } = {},
) {
  readTimeline(timeline);
  const prefix = readIdPrefix(id);
  readMode(mode);
  const cumulative = mode === "cumulative";
  const yTitle = cumulative ? "Damage dealt" : "Damage per second";
  const title = `${cumulative ? "Cumulative damage" : "Damage per second"} over a ${formatSeconds(timeline.duration)} s fight, mean of ${formatNumber(timeline.fights, 0)} ${timeline.fights === 1 ? "fight" : "fights"}`;
  const series = timelineSeries(timeline, mode);
  if (series.mean === null) {
    return chartRoot(
      prefix,
      "chart-timeline",
      title,
      timeline.fights === 0
        ? "No completed fight, so no timeline."
        : "The fight has no length, so no timeline.",
      [
        emptyMessage(
          timeline.fights === 0 ? "No completed fight" : "No fight time",
        ),
      ],
    );
  }
  const box = layout();
  const values = [...series.mean, ...(series.max ?? [])].map(
    ([, value]) => value,
  );
  const peak = Math.max(...values);
  const xTicks = niceTicks(0, timeline.duration);
  const xScale = linearScale(xTicks.low, xTicks.high, box.left, box.right);
  const yTicks = niceTicks(0, peak);
  const yScale = linearScale(yTicks.low, yTicks.high, box.bottom, box.top);
  const children = [
    axes(xTicks, yTicks, xScale, yScale, "Fight time (s)", yTitle, (tick) =>
      formatTick(tick),
    ),
  ];
  const items = [
    {
      name: cumulative ? "mean damage" : "mean damage per second",
      swatch: meanSwatch,
    },
  ];
  if (cumulative) {
    const band = [...series.max, ...[...series.min].reverse()];
    children.push(
      el("polygon", {
        class: "chart-band",
        points: points(band, xScale, yScale),
        fill: "currentColor",
        "fill-opacity": "0.2",
        stroke: "currentColor",
        "stroke-opacity": "0.5",
        "stroke-dasharray": "3 2",
      }),
    );
    items.push({
      name: "lowest to highest fight",
      swatch: bandSwatch("chart-band", true),
    });
  }
  children.push(
    el("polyline", {
      class: "chart-line chart-mean",
      points: points(series.mean, xScale, yScale),
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
    }),
    legend(items),
  );
  const last = timeline.length - 1;
  const desc = cumulative
    ? `Line chart of the mean damage dealt from the start of the fight, second by second, over ${formatNumber(timeline.fights, 0)} ${timeline.fights === 1 ? "fight" : "fights"} of ${formatSeconds(timeline.duration)} s, with a band from the lowest to the highest fight. ` +
      `At the end the mean is ${formatNumber(timeline.cumulative.mean[last])} damage, the lowest fight ${formatNumber(timeline.cumulative.min[last])} and the highest ${formatNumber(timeline.cumulative.max[last])}.`
    : `Step chart of the mean damage dealt in each ${formatSeconds(timeline.bucketSeconds)} s of the fight over ${formatNumber(timeline.fights, 0)} ${timeline.fights === 1 ? "fight" : "fights"} of ${formatSeconds(timeline.duration)} s. ` +
      `The highest second averages ${formatNumber(peak)} damage per second, and the fight overall ${formatNumber(timeline.meanTotalDamage / timeline.duration)}.`;
  return chartRoot(prefix, "chart-timeline", title, desc, children);
}

// The timeline's table alternative: the mean, lowest and highest damage dealt
// by every k("chart.timelineTableStep") seconds of the fight, and by its end.
export function timelineTable(timeline) {
  readTimeline(timeline);
  const caption = `Damage dealt over a ${formatSeconds(timeline.duration)} s fight, ${formatNumber(timeline.fights, 0)} ${timeline.fights === 1 ? "fight" : "fights"}`;
  const head = [
    "Time (s)",
    "Mean damage dealt",
    "Lowest fight",
    "Highest fight",
  ];
  if (timeline.fights === 0 || timeline.length === 0) {
    return table(caption, head, [], "chart-table-timeline");
  }
  const step = k("chart.timelineTableStep");
  const indices = [];
  for (let time = step; time < timeline.duration; time += step) {
    indices.push(Math.ceil(time / timeline.bucketSeconds) - 1);
  }
  indices.push(timeline.length - 1);
  const rows = indices.map((index) => [
    formatSeconds(bucketEnd(timeline, index)),
    formatNumber(timeline.cumulative.mean[index]),
    formatNumber(timeline.cumulative.min[index]),
    formatNumber(timeline.cumulative.max[index]),
  ]);
  return table(caption, head, rows, "chart-table-timeline");
}
