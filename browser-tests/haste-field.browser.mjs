// #274 (P4.6-07): the "Haste (attack speed)" field on Character › Stats, at
// Fran's five widths, with DejaVu pinned as CI has it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const PINNED_FONT = "DejaVu Sans";
const FRAN_WIDTHS = [360, 390, 1024, 1280, 1440];
const SCREEN_HEIGHT = 900;
const FIELD = "#cfg-character-haste";
const SUMMARY = "#character-stats-summary";
const TOO_MUCH = "150";
const FIVE = "5";
const TWENTY = "20";
const ONE_FIGHT = "1";
const SEED = "424242";
const RUN_TIMEOUT = 60_000;
// A line box is at most this many line heights tall.
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
  await page.goto(`${base}${hash}`);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

const go = async (page, hash, selector) => {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

async function enter(page, value) {
  await go(page, "#character/stats", FIELD);
  await page.locator(FIELD).fill(value);
  await page.locator(FIELD).blur();
}

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

describe("the haste field on Character › Stats (#274)", () => {
  for (const width of FRAN_WIDTHS) {
    test(`label, help, check and summary at ${width}`, async () => {
      const { context, page, errors } = await open(width, "#character/stats");
      try {
        const field = page.locator(FIELD);
        await field.waitFor({ state: "visible" });
        const label = await page
          .locator(`label[for="${FIELD.slice(1)}"]`)
          .textContent();
        assert.match(
          label.replace(/\s+/g, " ").trim(),
          /^Haste \(attack speed\) \(percent\)$/,
        );
        assert.equal(await field.inputValue(), "0");
        const helpId = await field.getAttribute("aria-describedby");
        assert.equal(helpId, "cfg-character-haste-help");
        const help = (await page.locator(`#${helpId}`).textContent())
          .replace(/\s+/g, " ")
          .trim();
        assert.equal(
          help,
          "Melee attack speed from gear. Slice and Dice and Blade Flurry are added in the fight. Haste doesn't change energy or the global cooldown.",
        );

        const none = await summary(page);
        assert.doesNotMatch(none.text, /haste/);
        assert.ok(none.oneLine, `${width}: one line at 0`);

        await enter(page, TOO_MUCH);
        assert.match(
          await page.locator(`${FIELD}-error`).textContent(),
          /Enter a percentage from 0 to 100\./,
        );
        assert.equal(await page.locator("#run-button").isDisabled(), true);
        assert.match(
          await page.locator("#run-status-text").textContent(),
          /^Can't run/,
        );

        await enter(page, FIVE);
        assert.equal(await page.locator("#run-button").isDisabled(), false);
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
      await enter(page, TWENTY);
      assert.equal(await page.locator("#cfg-edited").isVisible(), true);
      assert.match(
        await page.locator("#cfg-edited").textContent(),
        /^\s*Edited — applies to the next run\./,
      );
      const withHaste = await mean();
      assert.notEqual(withHaste, without);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
