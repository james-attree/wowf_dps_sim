import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { runBatch } from "../js/batch-runner.js";
import {
  formatCoordinate,
  formatNumber,
  histogramBins,
  histogramChart,
  histogramTable,
  linearScale,
  niceTicks,
  timelineChart,
  timelineSeries,
  timelineTable,
} from "../js/charts.js";
import { BatchTimeline, timelineFromEvents } from "../js/damage-timeline.js";
import { RunningStats } from "../js/running-stats.js";
import { toMarkup } from "../js/svg.js";

// Issue #148 (S5): the batch charts. The numbers (bins, ticks, series) are
// tested directly; the charts are tested as markup against snapshots in
// test/snapshots/ (named .snap, so neither Prettier nor the stray-icon check
// reads them), drawn from a fixed dataset, and as contract tests on a real
// batch result. Run with UPDATE_SNAPSHOTS=1 to rewrite the snapshots after a
// deliberate change, and read the diff.

const SNAPSHOTS = new URL("./snapshots/", import.meta.url);

async function matchesSnapshot(name, markup) {
  const file = new URL(name, SNAPSHOTS);
  if (process.env.UPDATE_SNAPSHOTS === "1") {
    await mkdir(SNAPSHOTS, { recursive: true });
    await writeFile(file, `${markup}\n`);
  }
  assert.equal(`${markup}\n`, await readFile(file, "utf8"), name);
}

// A batch result's chart inputs, made by hand: dps, its summary and a
// timeline. No engine, so the snapshots move only when the charts do.
function fixedResult(dps, fights) {
  const stats = new RunningStats();
  for (const value of dps) {
    stats.add(value);
  }
  return {
    dps: Float64Array.from(dps),
    summary: stats.summary(),
    timeline: fights,
  };
}

function fixedTimeline(duration, fights) {
  const batch = new BatchTimeline({ duration });
  for (const hits of fights) {
    batch.add(
      timelineFromEvents(
        hits.map(([time, damage]) => ({ type: "hit", time, damage })),
        { duration },
      ),
    );
  }
  return batch.summary();
}

const FIXED_DPS = [140, 150, 150, 160, 145, 155, 148, 152, 147, 151.5];
const FIXED_TIMELINE = fixedTimeline(4, [
  [
    [0, 100],
    [1.5, 200],
    [3.2, 150],
  ],
  [
    [0.5, 300],
    [2, 50],
    [3.9, 120],
  ],
  [
    [0, 80],
    [1, 90],
    [2, 100],
    [3, 110],
  ],
]);

// A deterministic spread of values for the binning tests.
function spread(count, seed = 1) {
  const values = [];
  let state = seed;
  for (let index = 0; index < count; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    values.push(100 + (state / 2147483648) * 50);
  }
  return values;
}

describe("formatNumber and formatCoordinate", () => {
  it("writes the same digits on every machine, with a comma per thousand", () => {
    assert.equal(k("chart.decimals").value, 1);
    assert.equal(formatNumber(1234567.891), "1,234,567.9");
    assert.equal(formatNumber(999.95), "1,000.0");
    assert.equal(formatNumber(-1234.5), "-1,234.5");
    assert.equal(formatNumber(12, 0), "12");
    assert.equal(formatNumber(1000, 0), "1,000");
    assert.equal(formatNumber(0.25, 2), "0.25");
    assert.equal(formatNumber(-0), "0.0");
    assert.equal(formatNumber(-0.04), "0.0");
    assert.throws(() => formatNumber(NaN), RangeError);
    assert.throws(() => formatNumber("1"), RangeError);
  });

  it("writes coordinates with at most two decimals and no negative zero", () => {
    assert.equal(k("chart.decimals").coordinate, 2);
    assert.equal(formatCoordinate(12.3456), "12.35");
    assert.equal(formatCoordinate(10), "10");
    assert.equal(formatCoordinate(10.5), "10.5");
    assert.equal(formatCoordinate(-0.001), "0");
    assert.equal(formatCoordinate(-3.333), "-3.33");
    assert.throws(() => formatCoordinate(Infinity), RangeError);
  });
});

describe("niceTicks", () => {
  it("picks round steps of 1, 2 or 5 times a power of ten", () => {
    assert.deepEqual(niceTicks(0, 300), {
      low: 0,
      high: 300,
      step: 100,
      ticks: [0, 100, 200, 300],
    });
    assert.deepEqual(niceTicks(131.2, 158.7).ticks, [130, 140, 150, 160]);
    assert.deepEqual(
      niceTicks(0, 47000).ticks,
      [0, 10000, 20000, 30000, 40000, 50000],
    );
    assert.deepEqual(niceTicks(0, 0.3).ticks, [0, 0.1, 0.2, 0.3]);
    assert.deepEqual(niceTicks(0, 1).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
    assert.deepEqual(niceTicks(-12, 7).ticks, [-15, -10, -5, 0, 5, 10]);
  });

  it("never has more than the target number of intervals, and covers the range", () => {
    const { target } = k("chart.axisTicks");
    for (const [low, high] of [
      [0, 1],
      [0, 7],
      [3, 1003],
      [0.001, 0.0093],
      [129.4, 160.2],
      [0, 43162.7],
      [-5, 5],
      [0, 999],
    ]) {
      const ticks = niceTicks(low, high);
      assert.ok(ticks.ticks.length - 1 <= target, `${low}..${high}`);
      assert.ok(ticks.low <= low && ticks.high >= high, `${low}..${high}`);
    }
  });

  it("widens a range of no width, and keeps counts whole", () => {
    assert.deepEqual(niceTicks(150, 150).ticks, [149, 149.5, 150, 150.5, 151]);
    assert.deepEqual(
      niceTicks(150.5, 150.5).ticks,
      [149.5, 150, 150.5, 151, 151.5],
    );
    assert.deepEqual(niceTicks(0, 0).ticks, [-1, -0.5, 0, 0.5, 1]);
    assert.deepEqual(niceTicks(0, 1, { integer: true }).ticks, [0, 1]);
    assert.deepEqual(niceTicks(0, 3, { integer: true }).ticks, [0, 1, 2, 3]);
    assert.deepEqual(
      niceTicks(0, 26, { integer: true }).ticks,
      [0, 10, 20, 30],
    );
  });

  it("refuses a reversed or non-finite range", () => {
    assert.throws(() => niceTicks(2, 1), RangeError);
    assert.throws(() => niceTicks(0, NaN), RangeError);
    assert.throws(() => niceTicks(-Infinity, 0), RangeError);
  });
});

describe("linearScale", () => {
  it("maps the domain onto the range, and a domain of no width to the middle", () => {
    const scale = linearScale(0, 10, 100, 200);
    assert.equal(scale(0), 100);
    assert.equal(scale(5), 150);
    assert.equal(scale(10), 200);
    assert.equal(linearScale(0, 10, 200, 100)(10), 100);
    assert.equal(linearScale(3, 3, 100, 200)(3), 150);
  });
});

describe("histogramBins", () => {
  it("uses min(maxBins, ceil(sqrt(n))) equal bins from min to max", () => {
    assert.equal(k("chart.histogramMaxBins"), 40);
    for (const [count, bins] of [
      [2, 2],
      [10, 4],
      [100, 10],
      [1000, 32],
      [1601, 40],
      [10000, 40],
    ]) {
      const histogram = histogramBins(spread(count));
      assert.equal(histogram.bins.length, bins, `${count}`);
      assert.equal(histogram.width, (histogram.max - histogram.min) / bins);
    }
  });

  it("puts every value in exactly one bin: the counts add up to n", () => {
    for (const count of [2, 3, 7, 50, 999, 5000]) {
      const values = spread(count, count);
      const histogram = histogramBins(values);
      assert.equal(histogram.count, count);
      assert.equal(
        histogram.bins.reduce((sum, bin) => sum + bin.count, 0),
        count,
        `${count}`,
      );
      assert.equal(histogram.bins[0].low, Math.min(...values));
      assert.equal(histogram.bins.at(-1).high, Math.max(...values));
      for (let index = 1; index < histogram.bins.length; index += 1) {
        assert.equal(histogram.bins[index].low, histogram.bins[index - 1].high);
      }
      // Each value is in the bin whose edges hold it.
      for (const value of values) {
        const holding = histogram.bins.filter(
          (bin, index) =>
            value >= bin.low &&
            (value < bin.high || index === histogram.bins.length - 1),
        );
        assert.equal(holding.length, 1, `${value}`);
      }
    }
  });

  it("counts by hand on a small set, the highest value in the last bin", () => {
    // 10 values: ceil(sqrt(10)) = 4 bins of (160 - 140) / 4 = 5 DPS.
    assert.deepEqual(histogramBins(FIXED_DPS), {
      count: 10,
      min: 140,
      max: 160,
      width: 5,
      bins: [
        { low: 140, high: 145, count: 1 },
        { low: 145, high: 150, count: 3 },
        { low: 150, high: 155, count: 4 },
        { low: 155, high: 160, count: 2 },
      ],
    });
  });

  it("ends the last bin exactly at the highest value, not at min + bins * width", () => {
    // min + 3 * width is 65.44143090248106 here, one ulp short of the max, so
    // a last bin computed from the width would leave the highest value out
    // of its own range.
    const values = [
      36.51730505041778, 5.052085018157959, 12.173984742164611,
      30.976618623733522, 65.44143090248107,
    ];
    const histogram = histogramBins(values);
    assert.notEqual(histogram.min + 3 * histogram.width, histogram.max);
    assert.equal(histogram.bins.length, 3);
    assert.equal(histogram.bins.at(-1).high, 65.44143090248107);
    for (const [index, bin] of histogram.bins.entries()) {
      assert.equal(bin.low, histogram.min + index * histogram.width);
    }
  });

  it("has one bin for one value or no variance, and none for no value", () => {
    assert.deepEqual(histogramBins([150.5]), {
      count: 1,
      min: 150.5,
      max: 150.5,
      width: 0,
      bins: [{ low: 150.5, high: 150.5, count: 1 }],
    });
    assert.deepEqual(histogramBins(Float64Array.of(7, 7, 7)).bins, [
      { low: 7, high: 7, count: 3 },
    ]);
    assert.deepEqual(histogramBins(new Float64Array(0)), {
      count: 0,
      min: null,
      max: null,
      width: null,
      bins: [],
    });
  });

  it("refuses values that are not finite numbers", () => {
    assert.throws(() => histogramBins([1, NaN]), RangeError);
    assert.throws(() => histogramBins([1, Infinity]), RangeError);
    assert.throws(() => histogramBins("1,2"), TypeError);
    assert.throws(() => histogramBins(null), TypeError);
  });
});

describe("timelineSeries", () => {
  it("is (0, 0) then the end of each bucket, cumulative", () => {
    const series = timelineSeries(FIXED_TIMELINE);
    assert.deepEqual(series.mean, [
      [0, 0],
      [1, 160],
      [2, 256.6666666666667],
      [3, 306.6666666666667],
      [4, 433.3333333333333],
    ]);
    assert.deepEqual(series.min[4], [4, 380]);
    assert.deepEqual(series.max[4], [4, 470]);
  });

  it("is steps of damage per second, a part bucket divided by its own length", () => {
    const timeline = fixedTimeline(2.5, [
      [
        [0, 10],
        [2.25, 5],
      ],
    ]);
    assert.deepEqual(timelineSeries(timeline, "perSecond"), {
      mean: [
        [0, 10],
        [1, 10],
        [1, 0],
        [2, 0],
        [2, 10],
        [2.5, 10],
      ],
      min: null,
      max: null,
    });
  });

  it("is empty with no fight or no fight time, and refuses a bad mode", () => {
    const none = { mean: null, min: null, max: null };
    assert.deepEqual(timelineSeries(fixedTimeline(4, [])), none);
    assert.deepEqual(timelineSeries(fixedTimeline(0, [[]])), none);
    assert.throws(() => timelineSeries(FIXED_TIMELINE, "rate"), RangeError);
    assert.throws(() => timelineSeries({}), TypeError);
  });
});

describe("the charts (snapshots of a fixed dataset)", () => {
  const result = fixedResult(FIXED_DPS, FIXED_TIMELINE);

  it("draws the histogram", async () => {
    await matchesSnapshot(
      "histogram.svg.snap",
      toMarkup(histogramChart(result)),
    );
  });

  it("draws the histogram's table", async () => {
    await matchesSnapshot(
      "histogram-table.html.snap",
      toMarkup(histogramTable(result)),
    );
  });

  it("draws the cumulative timeline", async () => {
    await matchesSnapshot(
      "timeline-cumulative.svg.snap",
      toMarkup(timelineChart(FIXED_TIMELINE)),
    );
  });

  it("draws the per-second timeline", async () => {
    await matchesSnapshot(
      "timeline-per-second.svg.snap",
      toMarkup(
        timelineChart(FIXED_TIMELINE, { id: "per-second", mode: "perSecond" }),
      ),
    );
  });

  it("draws the timeline's table", async () => {
    await matchesSnapshot(
      "timeline-table.html.snap",
      toMarkup(timelineTable(FIXED_TIMELINE)),
    );
  });

  it("draws one fight, and no fight", async () => {
    const one = fixedResult([150.5], fixedTimeline(4, [[[1, 10]]]));
    await matchesSnapshot(
      "histogram-one.svg.snap",
      toMarkup(histogramChart(one)),
    );
    const none = fixedResult([], fixedTimeline(4, []));
    await matchesSnapshot(
      "histogram-none.svg.snap",
      toMarkup(histogramChart(none)),
    );
    await matchesSnapshot(
      "timeline-none.svg.snap",
      toMarkup(timelineChart(none.timeline)),
    );
  });
});

describe("accessibility", () => {
  const result = fixedResult(FIXED_DPS, FIXED_TIMELINE);

  it("labels each chart by its own title and description", () => {
    for (const [chart, id] of [
      [histogramChart(result, { id: "h1" }), "h1"],
      [timelineChart(FIXED_TIMELINE, { id: "t1" }), "t1"],
      [timelineChart(FIXED_TIMELINE, { id: "t2", mode: "perSecond" }), "t2"],
    ]) {
      assert.equal(chart.tag, "svg");
      assert.equal(chart.attrs.role, "img");
      assert.equal(chart.attrs["aria-labelledby"], `${id}-title ${id}-desc`);
      assert.deepEqual(chart.children[0], {
        tag: "title",
        attrs: { id: `${id}-title` },
        children: [chart.children[0].children[0]],
      });
      assert.equal(chart.children[1].tag, "desc");
      assert.equal(chart.children[1].attrs.id, `${id}-desc`);
    }
  });

  it("says the numbers in the description and names the mean and the interval in text", () => {
    const markup = toMarkup(histogramChart(result));
    assert.match(
      markup,
      /<desc id="dps-histogram-desc">Histogram of the DPS of each of 10 fights in 4 bins of 5\.0 DPS, from 140\.0 to 160\.0 DPS\. Mean 149\.8 DPS, 95% confidence interval 146\.5 to 153\.2 DPS\. The tallest bin has 4 fights\.<\/desc>/,
    );
    // Not by colour alone: the mean is labelled on the chart and both marks
    // are in a text legend, the interval drawn dashed.
    assert.match(markup, />mean 149\.8<\/text>/);
    assert.match(markup, />mean DPS<\/text>/);
    assert.match(markup, />95% confidence interval<\/text>/);
    assert.match(markup, /class="chart-ci-edge"[^>]*stroke-dasharray/);
    // Each bar names its range and count.
    assert.equal(markup.match(/<rect class="chart-bar"/g).length, 4);
    assert.match(markup, /<title>150\.0–155\.0 DPS: 4 fights<\/title>/);
    const timeline = toMarkup(timelineChart(FIXED_TIMELINE));
    assert.match(timeline, />lowest to highest fight<\/text>/);
    assert.match(
      timeline,
      /At the end the mean is 433\.3 damage, the lowest fight 380\.0 and the highest 470\.0\./,
    );
  });

  it("has a table alternative of every bin and every 30 s", () => {
    assert.equal(k("chart.timelineTableStep"), 30);
    const table = histogramTable(result);
    assert.equal(table.tag, "table");
    assert.equal(table.children[0].tag, "caption");
    assert.equal(table.children[2].children.length, 4);
    const rows = (duration) =>
      timelineTable(
        fixedTimeline(duration, [[[0, 1]]]),
      ).children[2].children.map((row) => row.children[0].children[0].text);
    assert.deepEqual(rows(300), [
      "30",
      "60",
      "90",
      "120",
      "150",
      "180",
      "210",
      "240",
      "270",
      "300",
    ]);
    assert.deepEqual(rows(45), ["30", "45"]);
    assert.deepEqual(rows(30), ["30"]);
    assert.deepEqual(rows(10.5), ["10.5"]);
    // A part-second duration is written as it is, not rounded.
    const part = fixedTimeline(10.5, [[[0, 1]]]);
    assert.equal(
      timelineTable(part).children[0].children[0].text,
      "Damage dealt over a 10.5 s fight, 1 fight",
    );
    assert.match(
      toMarkup(timelineChart(part)),
      /<title id="damage-timeline-title">Cumulative damage over a 10\.5 s fight, mean of 1 fight<\/title>/,
    );
    assert.deepEqual(
      timelineTable(fixedTimeline(4, [])).children[2].children,
      [],
    );
  });

  it("refuses an id that could break the markup or clash", () => {
    for (const id of ["", "1a", "a b", 'a"b', "a<b", null]) {
      assert.throws(
        () => histogramChart(result, { id }),
        RangeError,
        String(id),
      );
      assert.throws(
        () => timelineChart(FIXED_TIMELINE, { id }),
        RangeError,
        String(id),
      );
    }
    assert.throws(() => histogramChart(null), TypeError);
    assert.throws(() => histogramChart({ dps: [] }), TypeError);
    assert.throws(
      () => timelineChart(FIXED_TIMELINE, { mode: "x" }),
      RangeError,
    );
  });
});

describe("the charts of a real batch result (contract)", () => {
  it("draws every fight, the same markup every run", async () => {
    const options = { seed: 148, iterations: 40, duration: 60 };
    const result = await runBatch(options);
    const again = await runBatch(options);
    const histogram = toMarkup(histogramChart(result));
    assert.equal(histogram, toMarkup(histogramChart(again)));
    assert.equal(
      toMarkup(timelineChart(result.timeline)),
      toMarkup(timelineChart(again.timeline)),
    );
    const bins = histogramBins(result.dps);
    assert.equal(bins.bins.length, Math.ceil(Math.sqrt(40)));
    assert.equal(
      bins.bins.reduce((sum, bin) => sum + bin.count, 0),
      result.completed,
    );
    const counts = [
      ...histogram.matchAll(/<title>[^<]*DPS: (\d+) fights?<\/title>/g),
    ].map((match) => Number(match[1]));
    assert.equal(
      counts.reduce((sum, count) => sum + count, 0),
      40,
    );
    // The table's last row is the end of the fight and the mean total damage.
    const table = timelineTable(result.timeline);
    const last = table.children[2].children
      .at(-1)
      .children.map((cell) => cell.children[0].text);
    assert.deepEqual(last.slice(0, 2), [
      "60",
      formatNumber(result.summary.mean * 60),
    ]);
  });
});
