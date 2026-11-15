// Browser tests for stat weights across screens (#283): the dock badge,
// Run disabled during a weights run, the wake-lock fallback text, and
// the desktop card. Layout is checked at 100% and 150% text only.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const AXE = await readFile(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const SCREEN_HEIGHT = 900;
const SLACK = 1;
const AT = new Date(2026, 10, 15, 10, 2).getTime();
const ITERATIONS = 1000;
const DURATION = 300;
const SEED = 107;
const NINE = 9;
const WIDTHS = [360, 390, 1024, 1280, 1440];

const ROWS = {
  attackPower: { dpsPerPoint: 1, ci: 0.05, apEquivalent: 1 },
  mainHand: { dpsPerPoint: 2.5, ci: 0.1, apEquivalent: 2.5 },
  offHand: { dpsPerPoint: 2.5, ci: 0.2, apEquivalent: 2.5 },
  crit: { dpsPerPoint: 19.23, ci: 0.4, apEquivalent: 19.23 },
  hit: { dpsPerPoint: 14.8, ci: 0.2, apEquivalent: 14.8 },
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

async function open(width, { text = "100%", hash = "#character" } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
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
  await page.goto(`${base}?e2e${hash}`, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `html { font-size: ${text} !important; }`,
  });
  await page.waitForFunction(() => globalThis.__store != null);
  return { context, page, errors };
}

async function setWeights(
  page,
  { status, result, progress = null, wakeLock = null, at = AT } = {},
) {
  await page.evaluate(
    ({
      status,
      result,
      progress,
      wakeLock,
      at,
      duration,
      iterations,
      seed,
    }) => {
      const store = globalThis.__store;
      const state = store.get();
      store.set({
        weights: {
          ...(state.weights ?? {}),
          status,
          result,
          jobs: result?.jobs ?? [],
          progress,
          error: null,
          wakeLock,
        },
        ran: {
          ...(state.ran ?? {}),
          weights:
            result == null
              ? null
              : {
                  config: state.config,
                  seed,
                  duration,
                  iterations,
                  at,
                },
        },
      });
    },
    {
      status,
      result,
      progress,
      wakeLock,
      at,
      duration: DURATION,
      iterations: ITERATIONS,
      seed: SEED,
    },
  );
}

const runningResult = null;
const doneResult = {
  seed: SEED,
  iterations: ITERATIONS,
  variants: NINE,
  rows: ROWS,
};

async function runGoing(page, { wakeLock = null } = {}) {
  await setWeights(page, {
    status: "running",
    result: runningResult,
    progress: { completed: 3, total: NINE },
    wakeLock,
  });
}

function badge(page) {
  return page.locator('#area-nav a[data-nav-area="results"] [data-badge]');
}

function resultsNav(page) {
  return page.getByRole("link", {
    name: "Results 3/9 stat weights running",
    exact: true,
  });
}

async function assertResultsNavName(page) {
  const link = page.locator('a[data-nav-area="results"]');
  await assert.equal(await link.getAttribute("aria-label"), null);
  await assert.equal(await resultsNav(page).count(), 1);
  if (!(await page.evaluate(() => "axe" in globalThis))) {
    await page.addScriptTag({ content: AXE });
  }
  const violations = await page.evaluate(async () => {
    const el = globalThis.document.querySelector('a[data-nav-area="results"]');
    const result = await globalThis.axe.run(el, {
      runOnly: {
        type: "rule",
        values: ["label-content-name-mismatch"],
      },
    });
    return result.violations.map((v) => v.id);
  });
  assert.deepEqual(violations, []);
}

async function cardLine(page) {
  return page
    .locator("#results-card-weights-text")
    .evaluate((el) => el.textContent);
}

async function clockBox(page) {
  return page
    .locator("#results-card-weights-text .results-card-clock")
    .evaluate((el) => {
      const style = globalThis.getComputedStyle(el);
      return {
        whiteSpace: style.whiteSpace,
        boxes: el.getClientRects().length,
      };
    });
}

describe("stat weights across screens (#283)", () => {
  for (const text of ["100%", "150%"]) {
    test(`leaving the screen shows the Results progress badge at 360 / ${text}`, async () => {
      const { context, page, errors } = await open(360, { text });
      try {
        await runGoing(page);
        await page.locator("#area-character").waitFor({ state: "visible" });
        const pill = badge(page);
        await assert.equal(await pill.isVisible(), true);
        await assert.equal(await pill.getAttribute("data-kind"), "progress");
        await assert.equal(
          await pill.getAttribute("data-badge"),
          "3/9 stat weights running",
        );
        await assertResultsNavName(page);
        await assert.equal(
          await page.locator("#run-summary").getAttribute("data-dock"),
          "Stat weights",
        );
        await assert.equal(
          await page.locator("#run-status-text").getAttribute("data-dock"),
          "Running · 3/9",
        );
        await assert.equal(
          await page.locator("#run-button").isDisabled(),
          true,
        );
        await assert.equal(
          await page.locator("#run-reason").innerText(),
          "Stat weights are running",
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`Average and Live Run stay disabled on Results at 1024 / ${text}`, async () => {
      const { context, page, errors } = await open(1024, {
        text,
        hash: "#results/average",
      });
      try {
        await runGoing(page);
        const pill = badge(page);
        await assert.equal(await pill.isVisible(), true);
        await assert.equal(await pill.getAttribute("data-kind"), "progress");
        await assert.equal(
          await page.locator("#run-button").isDisabled(),
          true,
        );
        await assert.equal(
          await page
            .locator("#results-average-run")
            .getAttribute("aria-disabled"),
          "true",
        );
        await assert.equal(
          await page
            .locator("#results-average-run")
            .getAttribute("aria-describedby"),
          "results-weights-busy-reason",
        );
        await page.locator("#result-view-live").click();
        await page.locator("#results-live").waitFor({ state: "visible" });
        await assert.equal(
          await page.locator("#results-live-run").getAttribute("aria-disabled"),
          "true",
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`the wake-lock fallback is visible at 1024 / ${text}`, async () => {
      const { context, page, errors } = await open(1024, {
        text,
        hash: "#results/weights",
      });
      try {
        await runGoing(page);
        await page.waitForFunction(() => {
          const lock = globalThis.__store.get().weights?.wakeLock;
          return lock === "held" || lock === "fallback";
        });
        await setWeights(page, {
          status: "running",
          result: null,
          progress: { completed: 3, total: NINE },
          wakeLock: "fallback",
        });
        const bar = page.locator("#results-weights-progress-bar");
        await assert.equal(
          await page
            .getByRole("progressbar", {
              name: "Stat weights progress",
              exact: true,
            })
            .count(),
          1,
        );
        await assert.equal(await bar.getAttribute("role"), null);
        const note = page.locator("#results-weights-keep-awake");
        await assert.equal(await note.isVisible(), true);
        await assert.equal(await note.innerText(), "Keep the screen on");
        await assert.match(
          await page.locator("#run-status-text").innerText(),
          /Keep the screen on/,
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`the desktop card appears only after a finished run at 1024 / ${text}`, async () => {
      const { context, page, errors } = await open(1024, {
        text,
        hash: "#character",
      });
      try {
        const card = page.locator("#results-card-weights");
        await assert.equal(await card.isVisible(), false);
        await runGoing(page);
        await assert.equal(await card.isVisible(), false);
        await setWeights(page, { status: "done", result: doneResult });
        await assert.equal(await card.isVisible(), true);
        await assert.equal(
          await cardLine(page),
          "Stat weights: crit 19.2 · hit 14.8 · MH 2.5 · OH 2.5 · AP 1.0 (ran at 10:02)",
        );
        await assert.equal(
          await page
            .locator("#results-card-weights a.results-card-link")
            .getAttribute("href"),
          "#results/weights",
        );
        await setWeights(page, {
          status: "running",
          result: doneResult,
          progress: { completed: 3, total: NINE },
        });
        await assert.equal(await card.isVisible(), true);
        await assert.equal(
          await cardLine(page),
          "Stat weights running · 3/9 · Previous: crit 19.2 · hit 14.8 · MH 2.5 · OH 2.5 · AP 1.0 (ran at 10:02)",
        );
        await assertResultsNavName(page);
        const link = page.locator("#results-card-weights a.results-card-link");
        await assert.equal(await link.innerText(), "open");
        await assert.equal(
          await link.getAttribute("aria-label"),
          "Open the stat weights",
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test("the card clock stays together at 1024 and 1280", async () => {
    for (const text of ["100%", "150%"]) {
      const { context, page, errors } = await open(1024, {
        text,
        hash: "#character",
      });
      try {
        await setWeights(page, {
          status: "running",
          result: doneResult,
          progress: { completed: 3, total: NINE },
        });
        await page
          .locator("#results-card-weights-text .results-card-clock")
          .waitFor({ state: "visible" });
        for (const width of [1024, 1280]) {
          await page.setViewportSize({ width, height: SCREEN_HEIGHT });
          const box = await clockBox(page);
          assert.equal(box.boxes, 1, `the clock wrapped at ${width} / ${text}`);
          assert.equal(
            box.whiteSpace,
            "nowrap",
            `white-space at ${width} / ${text}`,
          );
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  });

  test("the card and badge do not overflow the five review widths", async () => {
    const { context, page, errors } = await open(1440, { hash: "#character" });
    try {
      const cardStates = [
        { status: "done", result: doneResult },
        {
          status: "running",
          result: doneResult,
          progress: { completed: 3, total: NINE },
        },
      ];
      for (const cardState of cardStates) {
        await setWeights(page, cardState);
        for (const text of ["100%", "150%"]) {
          await page.addStyleTag({
            content: `html { font-size: ${text} !important; }`,
          });
          for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: SCREEN_HEIGHT });
            const box = await page.evaluate(() => {
              const doc = globalThis.document.documentElement;
              return { overflow: doc.scrollWidth, width: doc.clientWidth };
            });
            assert.ok(
              box.overflow <= box.width + SLACK,
              `${cardState.status} ${width} at ${text}: scrollWidth ${box.overflow} > ${box.width}`,
            );
          }
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
