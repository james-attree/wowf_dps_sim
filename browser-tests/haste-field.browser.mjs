// #274 / #385: haste is a derived gear stat, not a typed Character field.
// The Stats summary still names it when the sheet has some, at Fran's widths.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const PINNED_FONT = "DejaVu Sans";
const FRAN_WIDTHS = [360, 390, 1024, 1280, 1440];
const SCREEN_HEIGHT = 900;
const FIELD = "#cfg-character-haste";
const SUMMARY = "#character-stats-summary";
const ONE_FIGHT = "1";
const SEED = "424242";
const RUN_TIMEOUT = 60_000;
const ONE_LINE = 1.5;

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
  await new Promise((resolve) => server?.close(resolve));
});

async function open(width, hash) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}?e2e${hash}`);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "attached" });
  await page.waitForFunction(() => globalThis.__store != null);
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

const go = async (page, hash, selector) => {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

const summary = async (page) => {
  await go(page, "#character", SUMMARY);
  return page.locator(SUMMARY).evaluate(
    (node, oneLine) => ({
      text: node.textContent.trim(),
      oneLine:
        node.getBoundingClientRect().height <=
        Number.parseFloat(getComputedStyle(node).lineHeight) * oneLine,
      fits: node.scrollWidth <= node.clientWidth,
    }),
    ONE_LINE,
  );
};

async function setHaste(page, haste) {
  await page.evaluate((value) => {
    const { config } = globalThis.__store.get();
    const next = structuredClone(config);
    next.character = { ...next.character, haste: value };
    globalThis.__store.set({ config: next });
  }, haste);
}

describe("haste is derived, not typed (#274, #385)", () => {
  for (const width of FRAN_WIDTHS) {
    test(`the typed field is gone; the summary still names haste at ${width}`, async () => {
      const { context, page, errors } = await open(width, "#character/stats");
      try {
        assert.equal(await page.locator(FIELD).count(), 0);
        const none = await summary(page);
        assert.doesNotMatch(none.text, /haste/);
        // The 0.65rem phone summary is gone with the typed sheet (#385).
        // At 360/390 the line may wrap; one line is required at 1024+.
        if (width >= 1024) {
          assert.ok(none.oneLine, `${width}: one line at 0`);
        }
        await setHaste(page, 0.05);
        const set = await summary(page);
        assert.match(set.text, / · 5% haste$/);
        assert.ok(set.fits, `${width}: the summary fits its row`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test("it reaches the run: the mean changes, and an edit is out of date", async () => {
    const { context, page, errors } = await open(
      FRAN_WIDTHS[3],
      "#fight/settings",
    );
    const mean = async () => {
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          / · Done$/.test(
            document.getElementById("run-status-text").textContent,
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      const status = await page.locator("#run-status-text").textContent();
      return /([\d,.]+) DPS mean/.exec(status)[1];
    };
    try {
      await page.locator("#run-mode-batch").check();
      await page.locator("#run-iterations").fill(ONE_FIGHT);
      await page.locator("#run-seed").fill(SEED);
      await page.locator("#run-seed").blur();
      const without = await mean();
      await setHaste(page, 0.2);
      // store.set does not mark the form edited; the check is the mean.
      const withHaste = await mean();
      assert.notEqual(withHaste, without);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
