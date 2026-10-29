import { k } from "../../data/constants.js";
import {
  formatNumber,
  histogramChart,
  histogramTable,
  timelineChart,
  timelineTable,
} from "../charts.js";
import { el } from "../svg.js";

// The batch results panel (#154): pure functions from the store's batch and
// run slices to js/svg.js nodes. Fran's spec (design/154-results-panel,
// spec.md) gives the layout and the copy; section 0 is binding.
//
// Every figure is per fight (decision 1): a pooled total over F fights is
// divided by F, the one exception being the pooled shares and uptimes. The
// view (js/views/results-panel.js) turns the nodes into DOM, handles the sort
// buttons and the live region. Nothing here reads the DOM, a clock or the
// engine; the build label comes in from js/main.js (js/build-label.js), since
// a view may not import the talent or poison catalogues.

// The z of a 95% interval (two-sided normal, as in js/batch-stats.js). The
// standard error is the CI half-width over it (decision 1).
export const Z95 = 1.959964;

const ORIGIN = {
  white: "Auto attack",
  yellow: "Ability",
  poison: "Poison",
  dot: "Over time",
};
export const OUTCOMES = ["crit", "miss", "dodge", "glancing", "parry", "block"];
const OUTCOME_LABEL = {
  crit: "Crit",
  miss: "Miss",
  dodge: "Dodge",
  glancing: "Glance",
  parry: "Parry",
  block: "Block",
};
export const SORT_COLUMNS = {
  name: { label: "Ability", type: "text" },
  damage: { label: "Damage", type: "number" },
  share: { label: "% total", type: "number" },
  dps: { label: "DPS", type: "number" },
  uses: { label: "Uses", type: "number" },
  avg: { label: "Avg hit", type: "number" },
  ...Object.fromEntries(
    OUTCOMES.map((key) => [key, { label: OUTCOME_LABEL[key], type: "number" }]),
  ),
};
export const DEFAULT_SORT = { key: "damage", direction: "descending" };

const present = (value) =>
  value !== null && value !== undefined && Number.isFinite(value);
// "—" for a figure that does not exist (no attempts, one fight's SD).
export const num = (value, decimals = 1) =>
  present(value) ? formatNumber(value, decimals) : "—";
export const pct = (value, decimals = 1) =>
  present(value) ? `${formatNumber(value * 100, decimals)}%` : "—";
const count = (value) => formatNumber(value, 0);
const plural = (n, word) => `${word}${n === 1 ? "" : "s"}`;

// The standard error of the mean DPS, from the 95% interval; null without one.
export function standardError(summary) {
  return summary?.ci95 ? summary.ci95.halfWidth / Z95 : null;
}

// The energy-cap flag (decision 4): pooled time at the cap strictly over
// ui.energyCapWarnFraction of the fight, from ui.energyCapWarnMinFights fights.
export function energyCapFlag(resources) {
  const fraction = resources?.energyCappedFraction;
  return (
    present(fraction) &&
    resources.fights >= k("ui.energyCapWarnMinFights") &&
    fraction > k("ui.energyCapWarnFraction")
  );
}

// ---- Breakdown model -------------------------------------------------------

export function isUtility(row) {
  return row.damage === 0 && row.outcomes.cast === row.attempts;
}

// The damage rows (per fight), the utility chips, the outcome columns shown
// and the totals.
export function breakdownModel(result) {
  const { fights, totalDamage, rows } = result.breakdown;
  const duration = result.duration;
  const damageRows = [];
  const utility = [];
  for (const row of rows) {
    if (isUtility(row)) {
      utility.push({
        id: row.id,
        name: row.name,
        perFight: row.casts / fights,
      });
      continue;
    }
    const perTick = row.ticks.count > 0 && row.directDamage === 0;
    const rate = (key) =>
      row.attempts > 0 ? row.outcomes[key] / row.attempts : null;
    const uses = row.origin === "yellow" ? row.casts : row.attempts;
    damageRows.push({
      id: row.id,
      name: row.name,
      origin: row.origin,
      damage: row.damage / fights,
      share: row.share,
      dps: duration > 0 ? row.damage / fights / duration : null,
      uses: uses / fights,
      avg: perTick ? row.ticks.average : row.averageHit,
      perTick,
      crit: perTick ? row.ticks.crits / row.ticks.count : rate("crit"),
      miss: rate("miss"),
      dodge: rate("dodge"),
      // A glance is a white-swing outcome only (spec section 3).
      glancing: row.origin === "white" ? rate("glancing") : null,
      parry: rate("parry"),
      block: rate("block"),
    });
  }
  damageRows.sort((a, b) => b.damage - a.damage);
  utility.sort((a, b) => b.perFight - a.perFight);
  const outcomes = OUTCOMES.filter((key) =>
    damageRows.some((row) => (row[key] ?? 0) > 0),
  );
  return {
    fights,
    damageRows,
    utility,
    outcomes,
    totalPerFight: totalDamage / fights,
    totalDps: duration > 0 ? totalDamage / fights / duration : null,
  };
}

// The rows in `sort` order. A missing figure ("—") sorts last either way;
// ties keep the damage order.
export function sortRows(rows, sort = DEFAULT_SORT) {
  const sign = sort.direction === "ascending" ? 1 : -1;
  const text = SORT_COLUMNS[sort.key]?.type === "text";
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = a.row[sort.key];
      const y = b.row[sort.key];
      const xMissing = !text && !present(x);
      const yMissing = !text && !present(y);
      if (xMissing || yMissing) {
        return xMissing === yMissing ? a.index - b.index : xMissing ? 1 : -1;
      }
      const order = text ? (x < y ? -1 : x > y ? 1 : 0) : x - y;
      return order === 0 ? a.index - b.index : sign * order;
    })
    .map(({ row }) => row);
}

// The next sort after pressing a column's button: numbers go high to low
// first, the ability name A to Z; pressing the sorted column again reverses.
export function nextSort(sort, key) {
  const first = SORT_COLUMNS[key].type === "text" ? "ascending" : "descending";
  if (sort.key !== key) {
    return { key, direction: first };
  }
  return {
    key,
    direction: sort.direction === "ascending" ? "descending" : "ascending",
  };
}

export function sortMessage(sort) {
  return `Sorted by ${SORT_COLUMNS[sort.key].label}, ${sort.direction}.`;
}

// ---- Blocks -----------------------------------------------------------------

function statCard(label, value, unit) {
  return el("div", { class: "stat-card" }, [
    el("span", { class: "stat-label" }, [label]),
    el("span", { class: "stat-value" }, value),
    unit && el("span", { class: "stat-unit" }, [unit]),
  ]);
}

export function headline(result, id) {
  const summary = result.summary;
  if (summary.count === 0) {
    return [];
  }
  const partial = result.cancelled;
  const ci = summary.ci95;
  const fights = `${count(summary.count)} ${plural(summary.count, "fight")} of ${count(result.duration)} s`;
  const sentence = ci
    ? `Average over ${fights}${partial ? " (the fights that finished before Stop)" : ""}. The true average is very likely between ${num(ci.low)} and ${num(ci.high)} DPS${partial ? " for these fights; more fights would narrow it" : ""}.`
    : "One fight only: a single fight's DPS, not an average.";
  return [
    el(
      "div",
      { class: `stat-card results-headline${partial ? " is-partial" : ""}` },
      [
        el("span", { class: "stat-label", id: `${id}-dps-label` }, [
          "Average DPS",
          partial && el("span", { class: "badge badge-partial" }, ["PARTIAL"]),
        ]),
        el(
          "p",
          { class: "results-dps", "aria-labelledby": `${id}-dps-label` },
          [num(summary.mean), el("span", { class: "stat-unit" }, ["DPS"])],
        ),
        ci
          ? el("p", { class: "results-ci" }, [
              `± ${num(ci.halfWidth)} `,
              el("span", { class: "ci-range" }, [
                `(95% CI ${num(ci.low)}–${num(ci.high)})`,
              ]),
            ])
          : el("p", { class: "results-ci" }, [
              "No confidence interval from one fight",
            ]),
        el("p", { class: "results-sentence" }, [sentence]),
      ],
    ),
    el("div", { class: "stats-grid" }, [
      statCard("Spread (SD)", [num(summary.stdDev)], "DPS"),
      statCard("Lowest fight", [num(summary.min)], "DPS"),
      statCard("Highest fight", [num(summary.max)], "DPS"),
      statCard(
        "Fights",
        partial
          ? [
              count(result.completed),
              el("span", { class: "muted" }, [
                ` / ${count(result.iterations)}`,
              ]),
            ]
          : [count(result.completed)],
        null,
      ),
    ]),
  ];
}

function sortHeader(key, sort) {
  const sorted = sort.key === key;
  return el(
    "th",
    {
      scope: "col",
      "aria-sort": sorted ? sort.direction : "none",
      "data-key": key,
    },
    [
      el("button", { type: "button", class: "sort-button", "data-sort": key }, [
        SORT_COLUMNS[key].label,
        el("span", { class: "sort-icon", "aria-hidden": "true" }, []),
      ]),
    ],
  );
}

function outcomeCell(row, key) {
  return el("td", {}, [pct(row[key])]);
}

// The breakdown table alone, so the view can swap it on a sort.
export function breakdownTable(model, { sort = DEFAULT_SORT } = {}) {
  const columns = ["name", "damage", "share", "dps", "uses", "avg"];
  const rows = sortRows(model.damageRows, sort).map((row) =>
    el("tr", { "data-id": row.id }, [
      el("th", { scope: "row" }, [
        row.name,
        el("span", { class: "origin" }, [ORIGIN[row.origin] ?? row.origin]),
      ]),
      el("td", {}, [num(row.damage, 0)]),
      el("td", {}, [
        el("span", { class: "share" }, [
          el("span", { class: "share-bar", "aria-hidden": "true" }, [
            el("span", { style: `width:${(row.share * 100).toFixed(1)}%` }, []),
          ]),
          pct(row.share),
        ]),
      ]),
      el("td", {}, [num(row.dps)]),
      el("td", {}, [num(row.uses)]),
      el("td", {}, [
        num(row.avg, 0),
        row.perTick && " ",
        row.perTick && el("span", { class: "muted" }, ["/tick"]),
      ]),
      ...model.outcomes.map((key) => outcomeCell(row, key)),
    ]),
  );
  return el("table", { class: "results-table", "data-sortable": "" }, [
    el("caption", {}, [
      `Mean per fight over ${count(model.fights)} ${plural(model.fights, "fight")}. Outcome columns are % of attempts. Sort with the column buttons.`,
    ]),
    el("thead", {}, [
      el("tr", {}, [
        ...columns.map((key) => sortHeader(key, sort)),
        ...model.outcomes.map((key) => sortHeader(key, sort)),
      ]),
    ]),
    el("tbody", {}, rows),
    el("tfoot", {}, [
      el("tr", {}, [
        el("th", { scope: "row" }, ["Total"]),
        el("td", {}, [num(model.totalPerFight, 0)]),
        el("td", {}, ["100.0%"]),
        el("td", {}, [num(model.totalDps)]),
        el("td", { colspan: 2 + model.outcomes.length }, []),
      ]),
    ]),
  ]);
}

export function breakdown(result, id, { sort = DEFAULT_SORT } = {}) {
  const model = breakdownModel(result);
  const ticking = model.damageRows.filter((row) => row.perTick);
  const tickNote = ticking.map(
    (row) =>
      ` ${row.name} does its damage in ticks, so its average and crit rate are per tick and its miss rate is of applications.`,
  );
  return el("div", { class: "results-section" }, [
    el("h3", { id: `${id}-breakdown-h` }, ["Damage by ability"]),
    el(
      "div",
      {
        class: "table-scroll",
        role: "region",
        "aria-labelledby": `${id}-breakdown-h`,
        tabindex: "0",
        "data-breakdown": "",
      },
      [breakdownTable(model, { sort })],
    ),
    el(
      "p",
      { class: "visually-hidden", role: "status", "data-sort-status": "" },
      [],
    ),
    el("p", { class: "results-note" }, [
      "Uses: casts for abilities, swings for auto attacks, procs for poisons.",
      ...tickNote,
      ` Total damage per fight = average DPS × ${count(result.duration)} s.`,
    ]),
    model.utility.length > 0 &&
      el("p", { class: "results-note" }, [
        "No direct damage (casts per fight):",
      ]),
    model.utility.length > 0 &&
      el(
        "ul",
        {
          class: "utility-list",
          "aria-label": "Abilities with no direct damage, casts per fight",
        },
        model.utility.map((chip) =>
          el("li", {}, [
            `${chip.name} `,
            el("strong", {}, [num(chip.perFight)]),
          ]),
        ),
      ),
  ]);
}

export function auras(result, id) {
  const { fights, rows } = result.auras;
  const body = [...rows]
    .sort((a, b) => b.uptimeFraction - a.uptimeFraction)
    .map((row) =>
      el("tr", {}, [
        el("th", { scope: "row" }, [row.name]),
        el("td", {}, [row.target === "self" ? "You" : "Target"]),
        el("td", {}, [
          el("span", { class: "share" }, [
            el("span", { class: "uptime-bar", "aria-hidden": "true" }, [
              el(
                "span",
                { style: `width:${(row.uptimeFraction * 100).toFixed(1)}%` },
                [],
              ),
            ]),
            pct(row.uptimeFraction),
          ]),
        ]),
        el("td", {}, [num(row.applications / fights)]),
        el("td", {}, [num(row.refreshes / fights)]),
        el("td", {}, [
          row.stacks
            ? `${num(row.stacks.meanStacks, 2)} of ${row.maxStacks} · at ${row.maxStacks}: ${pct(row.stacks.fullStackFraction)}`
            : "—",
        ]),
      ]),
    );
  const head = [
    "Aura",
    "On",
    "Uptime",
    "Applied",
    "Refreshed",
    "Stacks (mean · full)",
  ];
  return el("div", { class: "results-section" }, [
    el("h3", { id: `${id}-auras-h` }, ["Aura uptime"]),
    el(
      "div",
      {
        class: "table-scroll",
        role: "region",
        "aria-labelledby": `${id}-auras-h`,
        tabindex: "0",
      },
      [
        el("table", { class: "results-table" }, [
          el("caption", {}, [
            "Share of fight time each aura was up, pooled over all fights. Applied and refreshed are per fight.",
          ]),
          el("thead", {}, [
            el(
              "tr",
              {},
              head.map((label) => el("th", { scope: "col" }, [label])),
            ),
          ]),
          el("tbody", {}, body),
        ]),
      ],
    ),
  ]);
}

export function resources(result, id) {
  const r = result.resources;
  const fights = r.fights;
  const worst = r.perFight?.energyCappedFraction?.max ?? null;
  const warn = energyCapFlag(r);
  const limit = pct(k("ui.energyCapWarnFraction"), 0);
  const capAttrs = warn
    ? { class: "stat-card is-warning", "aria-describedby": `${id}-cap-warn` }
    : { class: "stat-card" };
  return el("div", { class: "results-section" }, [
    el("h3", { id: `${id}-res-h` }, ["Wasted resources"]),
    el("div", { class: "resource-grid" }, [
      el("div", capAttrs, [
        el("span", { class: "stat-label" }, [
          "Time at energy cap",
          warn && el("span", { class: "badge badge-warning" }, ["HIGH"]),
        ]),
        el("span", { class: "stat-value" }, [
          `${num(r.energyCappedTime / fights)} s`,
        ]),
        el("span", { class: "stat-sub" }, [
          `per fight · ${pct(r.energyCappedFraction)} of the fight${present(worst) ? ` · worst fight ${pct(worst)}` : ""}`,
        ]),
        warn &&
          el("span", { class: "stat-warning", id: `${id}-cap-warn` }, [
            el("span", { "aria-hidden": "true" }, ["⚠ "]),
            `Over ${limit} of the fight at full energy. That regeneration is lost; the rotation could spend energy sooner.`,
          ]),
      ]),
      el("div", { class: "stat-card" }, [
        el("span", { class: "stat-label" }, ["Energy lost to the cap"]),
        el("span", { class: "stat-value" }, [num(r.energyOverflow / fights)]),
        el("span", { class: "stat-sub" }, [
          "energy per fight that regeneration or gains could not add",
        ]),
      ]),
      el("div", { class: "stat-card" }, [
        el("span", { class: "stat-label" }, ["Combo points wasted"]),
        el("span", { class: "stat-value" }, [num(r.comboPointWaste / fights)]),
        el("span", { class: "stat-sub" }, ["per fight, gained at 5 points"]),
      ]),
    ]),
    el("p", { class: "results-note" }, [
      `Lower is better. Time at the cap is energy regeneration thrown away; it is flagged above ${limit} of the fight.`,
    ]),
  ]);
}

export function runDetails(result, id, { label, poisonName, mode, elapsedMs }) {
  const poisons = result.config?.poisons ?? {};
  const poison = (key) => (key ? poisonName(key) : "None");
  const rotation = result.config?.rotation?.name;
  const ran =
    mode === "main"
      ? "On the page (main thread)"
      : "In the background (worker)";
  const pair = (term, ...value) => [el("dt", {}, [term]), el("dd", {}, value)];
  return el("div", { class: "results-section" }, [
    el("h3", { id: `${id}-run-h` }, ["Run details"]),
    el("dl", { class: "run-details" }, [
      ...pair(
        "Fights",
        `${count(result.completed)} of ${count(result.iterations)}${result.cancelled ? " (stopped)" : ""}`,
      ),
      ...pair("Fight length", `${count(result.duration)} s`),
      ...pair("Seed", String(result.seed)),
      ...pair("Build", label),
      ...pair("Rotation", rotation ? rotation : "Default rotation"),
      ...pair(
        "Poisons",
        `${poison(poisons.mainHand)} (main hand), ${poison(poisons.offHand)} (off hand)`,
      ),
      ...pair("Data version", el("code", {}, [String(result.dataVersion)])),
      ...pair(
        "Ran",
        present(elapsedMs) ? `${ran}, ${num(elapsedMs / 1000)} s` : ran,
      ),
    ]),
  ]);
}

// The id prefix of the shown result's headings, charts and radios.
export const RESULT_ID = "results";

// ---- Charts (spec section 6) -----------------------------------------------

export const TIMELINE_MODES = Object.freeze([
  Object.freeze({ value: "cumulative", label: "Cumulative damage" }),
  Object.freeze({ value: "perSecond", label: "Damage per second" }),
]);

// The timeline chart alone, so the view can swap it when the mode changes
// without redrawing (and losing focus on) the radios.
export function timelineFigure(result, id, mode = "cumulative") {
  return timelineChart(result.timeline, { id: `${id}-timeline`, mode });
}

// The charts go after every table (decision: tables and text first): the
// histogram, then damage over time, each from js/charts.js (#148) in a
// sideways-scrolling region with its table in a <details>.
export function charts(result, id, { timelineMode = "cumulative" } = {}) {
  const scroller = (label, extra, children) =>
    el(
      "div",
      {
        class: "chart-scroll",
        role: "region",
        "aria-label": `${label} chart, scrolls sideways`,
        tabindex: "0",
        ...extra,
      },
      children,
    );
  return el("div", { class: "results-section" }, [
    el("h3", { id: `${id}-charts-h` }, ["Charts"]),
    el("div", { class: "chart-block" }, [
      el("h4", {}, ["DPS per fight"]),
      scroller("DPS per fight", {}, [
        histogramChart(result, { id: `${id}-hist` }),
      ]),
      el("details", {}, [
        el("summary", {}, ["The histogram as a table"]),
        histogramTable(result),
      ]),
    ]),
    el("div", { class: "chart-block", "data-timeline-block": "" }, [
      el("h4", {}, ["Damage over time"]),
      el("fieldset", { class: "chart-mode" }, [
        el("legend", {}, ["Show"]),
        ...TIMELINE_MODES.map(({ value, label }) =>
          el("label", {}, [
            el("input", {
              type: "radio",
              name: `${id}-mode`,
              value,
              "data-timeline-mode": "",
              ...(value === timelineMode ? { checked: "" } : {}),
            }),
            ` ${label}`,
          ]),
        ),
      ]),
      scroller("Damage over time", { "data-timeline": "" }, [
        timelineFigure(result, id, timelineMode),
      ]),
      el("details", {}, [
        el("summary", {}, ["The damage over time as a table"]),
        timelineTable(result.timeline),
      ]),
    ]),
  ]);
}

// A result's body: headline, breakdown, auras, resources, charts, run
// details.
export function resultBody(result, id, options) {
  return [
    ...headline(result, id),
    breakdown(result, id, options),
    auras(result, id),
    resources(result, id),
    charts(result, id, options),
    runDetails(result, id, options),
  ];
}

// ---- States ---------------------------------------------------------------

function banner(kind, heading, paragraphs, extra) {
  return el(
    "div",
    {
      class: `results-banner is-${kind}`,
      role: kind === "error" ? "alert" : "status",
    },
    [
      el("strong", {}, [heading]),
      ...paragraphs.map((paragraph) => el("p", {}, paragraph)),
      extra,
    ],
  );
}

const pressRun = (before, after) => [before, el("strong", {}, ["Run"]), after];

function partialBanner(result) {
  const done = count(result.completed);
  const all = count(result.iterations);
  const ci = result.summary.ci95;
  const fightsWord = plural(result.iterations, "fight");
  const heading = `Partial result: stopped after ${done} of ${all} ${fightsWord}`;
  if (!ci) {
    return banner("partial", heading, [
      [
        `${result.completed === 1 ? "One fight gives" : "These fights give"} a DPS figure but no confidence interval. `,
        ...pressRun(
          `To run all ${all} ${fightsWord}, press `,
          " in the run controls above.",
        ),
      ],
    ]);
  }
  return banner("partial", heading, [
    [
      `Everything below covers only the ${done} fights that finished. The confidence interval (± ${num(ci.halfWidth)}) is about those fights and is wider than a full run's would be. Don't compare it with a full batch as if it were one.`,
    ],
    pressRun(
      `To run all ${all} ${fightsWord}, press `,
      ` in the run controls above. The same seed repeats these ${done} fights first.`,
    ),
  ]);
}

function zeroBanner() {
  return banner("partial", "Stopped before any fight finished", [
    pressRun(
      "No results from this run: Stop came before the first fight completed. Your settings are unchanged; press ",
      " in the run controls above to start again.",
    ),
  ]);
}

function errorBanner(error) {
  const detail = [error?.name, error?.message].filter(Boolean).join(": ");
  return banner(
    "error",
    "The batch stopped with an error",
    [
      pressRun(
        "No results were kept from this run. Check the fight settings, then press ",
        " in the run controls above to try again. If it keeps happening, copy the detail below into an issue.",
      ),
    ],
    el("details", {}, [
      el("summary", {}, ["Technical detail"]),
      el("code", {}, [detail || "No detail was given."]),
    ]),
  );
}

function emptyState() {
  return el("div", { class: "results-empty" }, [
    el("strong", {}, ["No batch results yet"]),
    "Pick a build, rotation and poisons, switch to Batch and ",
    ...pressRun("press ", " in the run controls above. "),
    "You'll get the average DPS with its confidence interval, damage by ability, aura uptime and wasted energy.",
  ]);
}

// The running estimate: shown once ui.batchEstimateMinFraction of the fights
// or ui.batchEstimateMinSeconds have passed, and only with a fight done.
export function timeEstimate(completed, total, elapsedMs) {
  const seconds = elapsedMs / 1000;
  if (completed === 0) {
    return "starting…";
  }
  const shown =
    completed / total >= k("ui.batchEstimateMinFraction") ||
    seconds >= k("ui.batchEstimateMinSeconds");
  const elapsed = `${count(seconds)} s elapsed`;
  if (!shown) {
    return elapsed;
  }
  const left = (seconds / completed) * (total - completed);
  return `${elapsed} · about ${count(left)} s left`;
}

function progressBlock(batch, id) {
  const total = batch.progress?.total ?? 0;
  const completed = batch.progress?.completed ?? 0;
  const mean = batch.progress?.mean;
  const percent = total > 0 ? Math.floor((completed / total) * 100) : 0;
  return el("div", { class: "results-progress" }, [
    el("label", { for: `${id}-progress`, class: "visually-hidden" }, [
      "Batch progress",
    ]),
    el("progress", { id: `${id}-progress`, max: total, value: completed }, [
      `${count(completed)} of ${fightsText(total)}`,
    ]),
    el("p", { class: "progress-line", "aria-hidden": "true" }, [
      el("span", {}, [
        el("strong", {}, [count(completed)]),
        ` of ${fightsText(total)} · ${percent}%`,
      ]),
      el("span", { class: "muted" }, [
        timeEstimate(completed, total, batch.elapsedMs ?? 0),
      ]),
    ]),
    completed > 0 &&
      present(mean) &&
      el("p", { class: "progress-line" }, [
        el("span", {}, [
          "Running average ",
          el("strong", {}, [`${num(mean)} DPS`]),
        ]),
        el("span", { class: "muted" }, ["settles as more fights finish"]),
      ]),
    batch.mode === "main" &&
      el("p", { class: "results-note" }, [
        "Running on the page; it may be slow to respond until the batch finishes.",
      ]),
    el("p", { class: "results-note" }, [
      "To end early, press ",
      el("strong", {}, ["Stop and keep partial"]),
      completed > 0
        ? ` in the run controls above: a batch keeps the ${fightsText(completed)} done so far and shows them as a partial result.`
        : " in the run controls above: a batch keeps the fights done so far and shows them as a partial result.",
    ]),
  ]);
}

const fightsText = (n) => `${count(n)} ${plural(n, "fight")}`;

// The whole panel for a state: { title, meta, busy, body }. `run` is the
// store's run slice (seed, duration and the config snapshot of the batch
// that is running); `options` = { buildLabel, poisonName, sort, timelineMode }.
export function panelModel({ batch, run }, options) {
  const { buildLabel } = options;
  const status = batch.status;
  const result = batch.result;
  if (status === "running") {
    const total = batch.progress?.total ?? run.iterations;
    const config = run.snapshot ?? run.config;
    const previous = batch.previous;
    const body = [progressBlock(batch, "results")];
    if (previous && previous.completed > 0) {
      body.push(
        el("div", { class: "previous-wrap" }, [
          el("span", { class: "previous-label" }, [
            `PREVIOUS RESULT · seed ${previous.seed} · replaced when the first fight finishes`,
          ]),
          el("div", { class: "previous-result", inert: "" }, [
            ...headline(previous, "results-prev"),
            breakdown(previous, "results-prev"),
          ]),
        ]),
      );
    }
    return {
      title: "Running batch…",
      meta: [
        `${count(total)} × ${count(run.duration)} s ${plural(total, "fight")}`,
        `seed ${run.seed}`,
        config ? buildLabel(config) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      busy: true,
      body,
    };
  }
  if ((status === "done" || status === "cancelled") && result) {
    const label = buildLabel(result.config);
    if (result.completed === 0) {
      return {
        title: "Results",
        meta: `Stopped · 0 of ${fightsText(result.iterations)} · seed ${result.seed} · ${label}`,
        busy: false,
        body: [zeroBanner()],
      };
    }
    const partial = result.cancelled;
    const meta = `${count(result.completed)} × ${count(result.duration)} s ${plural(result.completed, "fight")} · seed ${result.seed} · ${label}`;
    if (partial && !result.summary.ci95) {
      return {
        title: "Results (partial)",
        meta,
        busy: false,
        body: [partialBanner(result), ...headline(result, RESULT_ID)],
      };
    }
    return {
      title: partial ? "Results (partial)" : "Results",
      meta,
      busy: false,
      body: [
        partial && partialBanner(result),
        ...resultBody(result, RESULT_ID, {
          ...options,
          label,
          mode: batch.mode,
          elapsedMs: batch.elapsedMs,
        }),
      ].filter(Boolean),
    };
  }
  if (status === "error") {
    const total = batch.progress?.total ?? run.iterations;
    return {
      title: "Results",
      meta: `${count(total)} × ${count(run.duration)} s ${plural(total, "fight")} · seed ${run.seed}`,
      busy: false,
      body: [errorBanner(batch.error)],
    };
  }
  return { title: "Results", meta: "", busy: false, body: [emptyState()] };
}

// ---- Live region (spec section 9) -----------------------------------------

// The quarter (0 to 3) a progress has crossed, by ui.batchAnnounceStep.
export function announceStep(completed, total) {
  if (!(total > 0) || completed >= total) {
    return 0;
  }
  return Math.floor(completed / total / k("ui.batchAnnounceStep"));
}

// What the panel's live region says when the batch slice goes from `before`
// to `after`, or null to say nothing.
export function announcement(before, after) {
  const total = after.progress?.total ?? 0;
  if (after.status === "running") {
    if (before?.status !== "running") {
      return `Batch started, ${fightsText(total)}.`;
    }
    const was = announceStep(before.progress?.completed ?? 0, total);
    const now = announceStep(after.progress?.completed ?? 0, total);
    if (now > was) {
      const share = Math.round(now * k("ui.batchAnnounceStep") * 100);
      return `Batch ${share}% done, ${count(after.progress.completed)} of ${fightsText(total)}.`;
    }
    return null;
  }
  if (before?.status !== "running" || !after.result) {
    return null;
  }
  const result = after.result;
  if (after.status === "done") {
    const ci = result.summary.ci95;
    return ci
      ? `Batch finished: ${num(result.summary.mean)} DPS, plus or minus ${num(ci.halfWidth)}.`
      : `Batch finished: ${num(result.summary.mean)} DPS.`;
  }
  if (after.status === "cancelled") {
    return result.completed > 0
      ? `Batch stopped: partial result from ${count(result.completed)} of ${fightsText(result.iterations)}.`
      : "Batch stopped before any fight finished.";
  }
  return null;
}
