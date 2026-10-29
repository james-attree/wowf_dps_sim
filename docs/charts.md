# Batch charts (S5, issue #148)

Two charts of a batch result (`runBatch` or `BatchClient`, see
[batch.md](batch.md)), drawn as plain SVG with no chart library and no build
step:

- **DPS histogram** (`histogramChart`): the DPS of each iteration
  (`result.dps`) in bins, with the mean (`result.summary.mean`) as a solid line
  with a text label and its 95% confidence interval (`result.summary.ci95`) as
  a shaded band with dashed edges. Each bar has its own `<title>` (for example
  "150.0–155.0 DPS: 4 fights").
- **Damage over time** (`timelineChart`): from the batch result's new
  `timeline` field. `mode: "cumulative"` (the default) draws the mean damage
  dealt from the start of the fight, with a band from the lowest to the
  highest fight. `mode: "perSecond"` draws the mean damage of each second as
  steps.

Each has a table alternative: `histogramTable` (one row per bin) and
`timelineTable` (the mean, lowest and highest damage dealt every
`chart.timelineTableStep` seconds, 30 s, and at the end of the fight).

The batch results panel (#154, `js/views/results-render.js`) puts both charts
on the page after its tables, each in a `.chart-scroll` region with its table
in a `<details>`; it builds the rest of the panel with `js/svg.js` and formats
its numbers with `formatNumber`. Below the page's narrow breakpoint the SVG
keeps a 520 px minimum width and scrolls sideways (a narrow layout is on the
Phase 5 polish list). `demo/charts.html` is a development
harness that runs a real batch through `BatchClient` and draws both charts
without a reload. It is not deployed (Pages copies only `index.html`,
`styles.css`, `js/`, `data/` and `img/`). Run `npm run serve` and open
`http://127.0.0.1:8000/demo/charts.html`.

## Modules

| Module                  | What it is                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `js/damage-timeline.js` | `FightTimeline` (a `hit` subscriber), `timelineFromEvents`, `BatchTimeline` (sums fights in iteration order).     |
| `js/svg.js`             | Node descriptions: `el`, `text`, `toMarkup` (a string), `toDom` (DOM nodes), `escapeText`, `escapeAttribute`.     |
| `js/charts.js`          | `histogramBins`, `niceTicks`, `linearScale`, `timelineSeries`, the two charts, the two tables, number formatting. |

All three are engine modules for lint: no DOM, no clock, no locale, no numeric
literal beyond 0, 1 and -1. The charts return node descriptions, so they are
tested in Node as markup.

## The timeline (`result.timeline`)

A fight of `duration` seconds has `ceil(duration / timeline.bucketSeconds)`
buckets (`timeline.bucketSeconds` is 1 s, so 300 for a 300 s fight). A hit at
time `t` adds its damage to bucket `floor(t / bucketSeconds)`; a hit at exactly
the end of the fight goes in the last bucket. When the duration is not a whole
number of buckets, the last bucket is shorter. A fight of no length has no
bucket, and the batch timeline then has length 0.

`FightTimeline` subscribes to the fight's `hit` events (as the breakdown and
the aura metrics do), so it changes nothing in the engine and no rng draw.
`BatchTimeline.add` takes each fight's summary in iteration order and keeps
compensated (Neumaier) sums per bucket, so the result does not depend on how
the batch was sliced.

| Field             | Meaning                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `fights`          | Fights in the timeline (`completed`).                                                                               |
| `bucketSeconds`   | `timeline.bucketSeconds` (1 s).                                                                                     |
| `duration`        | Seconds per fight.                                                                                                  |
| `length`          | Buckets per fight: `ceil(duration / bucketSeconds)`. Fixed for a duration, whatever the iteration count.            |
| `meanTotalDamage` | The mean total damage of a fight. `null` with no fight.                                                             |
| `damage`          | An array of `length` numbers: the mean damage dealt in each bucket. `null` with no fight.                           |
| `cumulative.mean` | An array of `length` numbers: the mean damage dealt from the start to the end of each bucket. `null` with no fight. |
| `cumulative.min`  | The same for the fight with the least damage dealt by then (bucket by bucket, so not always the same fight).        |
| `cumulative.max`  | The same for the fight with the most.                                                                               |

The last `cumulative.mean` equals `meanTotalDamage`, which is
`summary.mean × duration`, within rounding. The arrays are plain arrays of
numbers (the batch result stays plain data but for `dps`). In the worker they
are copied by `postMessage` (four arrays of 300 numbers for a 300 s fight),
not transferred; only `dps` is transferred.

## Histogram bins

`n` values give `min(chart.histogramMaxBins, ceil(sqrt(n)))` bins (at most 40) of equal width from the lowest value to the highest. Bin `i` holds the
values `v` with `floor((v - min) / width) = i`, and the highest value goes in
the last bin, so every value is in exactly one bin and the counts add up to
`n`. When every value is the same (one iteration, or no variance) there is one
bin of width 0 holding all of them, drawn one tick step wide. No value, no
bin: the chart then says "No completed fight".

One iteration has no confidence interval (`summary.ci95` is `null`), so the
histogram draws no band, has no band in its legend, and its description and
table caption say "no confidence interval from one fight".

## Axes

`niceTicks(low, high)` gives round ticks: about `chart.axisTicks.target` (5)
intervals, each a step of 1, 2 or 5 times a power of 10, with the axis ends on
ticks that cover `[low, high]`. A range of no width is widened by one unit
either side. Counts use whole-number steps. The histogram's x axis covers the
data and the confidence interval; its y axis starts at 0. The timeline's x
axis is the fight time from 0 to the first tick at or past the duration; its y axis starts at 0.

Numbers are formatted without the locale: `chart.decimals.value` (1) decimals
for values, a comma between thousands, as many decimals as a tick needs, and
SVG coordinates rounded to `chart.decimals.coordinate` (2) decimals. The
layout (size, margins, gaps, legend) is `chart.layout`. Colours come from CSS
classes (`.chart-bar`, `.chart-mean`, `.chart-ci-band`, `.chart-band` in
`styles.css`); the markup uses `currentColor` and opacity, so a chart is
readable unstyled.

## Accessibility

Each chart is an `<svg role="img">` labelled (`aria-labelledby`) by its own
`<title>` and `<desc>`. The description gives the numbers that matter: the
fight count, the bins, the range, the mean and the interval for the
histogram; the fight count, the duration and the end values for the timeline.
`id` (default `dps-histogram`, `damage-timeline`) prefixes those ids, so two
charts on a page do not clash. Nothing is told by colour alone: the mean is a
solid line with a text label, the interval a shaded band with dashed edges,
and the legend draws each swatch in its item's own style. The tables are the
text alternative.

## Safety

`js/svg.js` escapes every text node (`&`, `<`, `>`) and attribute value (also
`"` and `'`), allows only a fixed list of SVG and HTML tags, and refuses an
attribute name that is not a plain name or that starts with `on`. `toDom`
uses `createElementNS` for SVG, `setAttribute` and `createTextNode`: no
`innerHTML`.

## Tests

`test/charts.test.js` checks the bins (counts add up to `n`, the zero-variance
and one-iteration cases, no value), the ticks, the scales and the series
directly, and the charts as markup against snapshots in `test/snapshots/` (a
fixed dataset, so they move only when the charts do; run with
`UPDATE_SNAPSHOTS=1` to rewrite them after a deliberate change and read the
diff). Contract tests draw a real batch result. `test/damage-timeline.test.js`
checks the buckets, the timeline against the fight's own total, the fixed
length, the last cumulative mean against the mean total damage, and the same
timeline however the batch is sliced. `test/svg.test.js` checks the escaping
and the refusals.
