// Browser tests for the Stat weights Results view (#282). Fixtures are
// injected through the ?e2e store hook so the tests do not wait for a
// real 9 x 1,000-fight run. Layout is checked at 100% and 150% text only.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const SCREEN_HEIGHT = 900;
const SLACK = 1;
const AT = new Date(2026, 10, 15, 9, 12).getTime();
const ITERATIONS = 1000;
const DURATION = 300;
const SEED = 107;
const NINE = 9;

const JOBS = [
  { id: "base", sign: 0 },
  { id: "attackPower", sign: 1 },
  { id: "mainHand", sign: 1 },
  { id: "offHand", sign: 1 },
  { id: "crit", sign: 1 },
  { id: "crit", sign: -1 },
  { id: "hit", sign: 1 },
  { id: "hit", sign: -1 },
  { id: "haste", sign: 1 },
];

const ROWS = {
  attackPower: { dpsPerPoint: 1, ci: 0.05, apEquivalent: 1 },
  mainHand: { dpsPerPoint: 2.5, ci: 0.1, apEquivalent: 2.5 },
  offHand: { dpsPerPoint: 2.5, ci: 0.2, apEquivalent: 2.5 },
  crit: { dpsPerPoint: 19.23, ci: 0.4, apEquivalent: 19.23 },
  hit: { dpsPerPoint: 1.67, ci: 0.167, apEquivalent: 1.67 },
};

let server;
let base;
let browser;

before(async () => {
  server = await startStaticServer({ port: 0 });
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch(
    process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" },
  );
});

after(async () => {
  await browser?.close();
  await new Promise((done) => server?.close(done) ?? done());
});

async function open(width, { text = "100%", reduced = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) =>
      route.request().resourceType() === "image"
        ? route.fulfill({ status: 200, contentType: "image/jpeg", body: ICON })
        : route.abort(),
  );
  await page.goto(`${base}?e2e#results/weights`, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `html { font-size: ${text} !important; }`,
  });
  await page.locator("#results-weights").waitFor({ state: "visible" });
  await page.waitForFunction(() => globalThis.__store != null);
  return { context, page, errors };
}

const sampleResult = (rows = ROWS) => ({
  seed: SEED,
  iterations: ITERATIONS,
  variants: NINE,
  rows,
  jobs: JOBS,
});

async function show(
  page,
  {
    status = "done",
    rows = ROWS,
    progress = null,
    elapsedMs = 0,
    edit = false,
  } = {},
) {
  return page.evaluate(
    ({
      status,
      result,
      progress,
      elapsedMs,
      at,
      duration,
      iterations,
      seed,
      edit,
    }) => {
      const store = globalThis.__store;
      const state = store.get();
      const config = state.config;
      const now = edit
        ? {
            ...config,
            character: { ...config.character, attackPower: 1600 },
          }
        : config;
      store.batch(() => {
        if (now !== config) {
          store.set({ config: now });
        }
        store.set({
          weights: {
            ...(state.weights ?? {}),
            status,
            result,
            jobs: result?.jobs ?? [],
            progress,
            elapsedMs,
            error: null,
          },
          ran: {
            ...(state.ran ?? {}),
            weights:
              result == null
                ? null
                : {
                    config,
                    seed,
                    duration,
                    iterations,
                    at,
                  },
          },
        });
      });
    },
    {
      status,
      result: status === "idle" && rows === null ? null : sampleResult(rows),
      progress,
      elapsedMs,
      at: AT,
      duration: DURATION,
      iterations: ITERATIONS,
      seed: SEED,
      edit,
    },
  );
}

async function frames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
}

async function announce(page) {
  await frames(page);
  return page.locator("#run-announce").textContent();
}

function sideways(metrics) {
  return metrics.overflow > metrics.client + SLACK;
}

describe("Stat weights results view (#282)", () => {
  test("idle copy covers the default run only", async () => {
    const { context, page, errors } = await open(1280);
    try {
      const copy = await page.locator("#results-weights-estimate").innerText();
      assert.match(copy, /About 73 s on a desktop/);
      assert.doesNotMatch(copy, /Precise/);
      const help = await page.locator("#results-weights-help").innerText();
      assert.match(help, /marked out of date if you changed the build/);
      assert.equal(
        await page.locator("#results-weights-run").innerText(),
        "Run stat weights",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Decision 3, 4 and 10: sort, rounding and Not measured", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await show(page, { status: "done" });
      const ids = await page
        .locator("#results-weights-table tbody tr")
        .evaluateAll((rows) => rows.map((row) => row.dataset.stat));
      assert.deepEqual(ids, [
        "crit",
        "mainHand",
        "offHand",
        "hit",
        "attackPower",
        "haste",
      ]);
      const crit = page.locator('tr[data-stat="crit"]');
      assert.match(
        await crit.locator(".weights-dps-point").innerText(),
        /19\.23|19\.2/,
      );
      // 19.23 at 2 dp is 19.23; AP is 19.2
      assert.equal(
        await crit.locator(".weights-dps-point").innerText(),
        "19.23",
      );
      assert.equal(await crit.locator(".weights-ap").innerText(), "= 19.2 AP");
      const hit = page.locator('tr[data-stat="hit"]');
      assert.equal(await hit.locator(".weights-dps-point").innerText(), "1.67");
      assert.equal(await hit.locator(".weights-ci-text").innerText(), "± 0.17");
      assert.equal(
        await page.locator('tr[data-stat="haste"] .weights-ap').innerText(),
        "Not measured",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Decision 2 and 7: stale only when the build changed", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await show(page, { status: "cancelled" });
      assert.equal(
        await page.locator("#results-weights-stale").isHidden(),
        true,
      );
      assert.match(
        await page.locator("#results-weights-status").innerText(),
        /last finished table is still shown/,
      );
      await show(page, { status: "cancelled", edit: true });
      assert.equal(
        await page.locator("#results-weights-stale").isHidden(),
        false,
      );
      assert.match(
        await announce(page),
        /Stat weights out of date\.|Results out of date\./,
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Decision 8 and 9: the table hides during a run; done says Stat weights finished.", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await show(page, { status: "done" });
      assert.equal(
        await page.locator("#results-weights-table").isHidden(),
        false,
      );
      await show(page, {
        status: "running",
        progress: { completed: 0, total: NINE },
      });
      assert.equal(
        await page.locator("#results-weights-table").isHidden(),
        true,
      );
      assert.match(await announce(page), /Stat weights started/);
      await show(page, {
        status: "running",
        progress: { completed: 3, total: NINE },
      });
      assert.match(
        await announce(page),
        /Stat weights 25% done\. Variant 3 of 9/,
      );
      await show(page, { status: "done" });
      assert.equal(
        await page.locator("#results-weights-table").isHidden(),
        false,
      );
      assert.equal(await announce(page), "Stat weights finished.");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Decision 5 and 6: the ± column folds below 64em; the CI bar is aria-hidden", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await show(page, { status: "done" });
      const wide = await page.evaluate(() => {
        const col = globalThis.document.querySelector(".weights-ci-col");
        const folded = globalThis.document.querySelector(".weights-ci-folded");
        const bar = globalThis.document.querySelector(".weights-ci-bar");
        return {
          col: globalThis.getComputedStyle(col).display,
          folded: globalThis.getComputedStyle(folded).display,
          bar: bar ? globalThis.getComputedStyle(bar).display : "none",
          hidden: bar?.getAttribute("aria-hidden"),
        };
      });
      assert.notEqual(wide.col, "none");
      assert.equal(wide.folded, "none");
      assert.notEqual(wide.bar, "none");
      assert.equal(wide.hidden, "true");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }

    const phone = await open(360);
    try {
      await show(phone.page, { status: "done" });
      const narrow = await phone.page.evaluate(() => {
        const col = globalThis.document.querySelector(
          "thead .weights-ci-col, .weights-ci-col",
        );
        const folded = globalThis.document.querySelector(
          'tr[data-stat="hit"] .weights-ci-folded',
        );
        const bar = globalThis.document.querySelector(".weights-ci-bar");
        const doc = globalThis.document.documentElement;
        return {
          col: globalThis.getComputedStyle(col).display,
          folded: globalThis.getComputedStyle(folded).display,
          foldedText: folded.textContent,
          bar: bar ? globalThis.getComputedStyle(bar).display : "none",
          overflow: doc.scrollWidth,
          client: doc.clientWidth,
        };
      });
      assert.equal(narrow.col, "none");
      assert.notEqual(narrow.folded, "none");
      assert.equal(narrow.foldedText, "1.67 ± 0.17");
      assert.equal(narrow.bar, "none");
      assert.equal(sideways(narrow), false);
      assert.equal(phone.errors.length, 0, phone.errors.join("\n"));
    } finally {
      await phone.context.close();
    }
  });

  test("reduced motion hides the CI bar at 1280", async () => {
    const { context, page, errors } = await open(1280, { reduced: true });
    try {
      await show(page, { status: "done" });
      const display = await page.evaluate(() => {
        const bar = globalThis.document.querySelector(".weights-ci-bar");
        return bar ? globalThis.getComputedStyle(bar).display : "none";
      });
      assert.equal(display, "none");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  for (const text of ["100%", "150%"]) {
    for (const width of [360, 1280]) {
      test(`${width} at ${text} text: no sideways scroll, switch stays in the row`, async () => {
        const { context, page, errors } = await open(width, { text });
        try {
          await show(page, { status: "done" });
          const metrics = await page.evaluate(() => {
            const doc = globalThis.document.documentElement;
            const switcher = doc.ownerDocument.querySelector(".result-switch");
            const links = [
              ...doc.ownerDocument.querySelectorAll(".result-switch-link"),
            ];
            return {
              overflow: doc.scrollWidth,
              client: doc.clientWidth,
              links: links.length,
              switchWidth: switcher.getBoundingClientRect().width,
              current: doc.ownerDocument
                .querySelector("#result-view-weights")
                ?.getAttribute("aria-current"),
            };
          });
          assert.equal(metrics.links, 3);
          assert.equal(metrics.current, "page");
          assert.equal(
            sideways(metrics),
            false,
            `scroll ${metrics.overflow} > ${metrics.client}`,
          );
          assert.equal(errors.length, 0, errors.join("\n"));
        } finally {
          await context.close();
        }
      });
    }
  }
});
