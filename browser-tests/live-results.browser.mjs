// The live fight under Results' Live view (#245, UX7): Watch fight, from
// any area, lands on #results/live with the fight's meters, effects and log
// there; before the first Watch the view says there is none yet and still
// has the log (its Announce toggle can be set beforehand). Fight has no
// "Open the fight" link and no meters. With 200% text on a 360 phone no
// area scrolls sideways (the Average / Live fight switch wraps).

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const SHOTS = process.env.SHOTS_DIR ?? null;
const WIDTHS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];
const PHONE = { width: 360, height: 800 };
const DOUBLE = "200%";
// CI's fallback font, the widest it may draw in.
const PINNED_FONT = "DejaVu Sans";
const SCREENS = [
  "#character",
  "#rotation",
  "#fight",
  "#results/average",
  "#results/live",
];
const LIVE_SECONDS = "4";
const LONG_SECONDS = "600";
const RUN_TIMEOUT = 60_000;
// Half a pixel of rounding either way.
const SLACK = 1;

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

async function open({ width, height }, hash) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${hash}`);
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

async function field(page, id) {
  const control = page.locator(`#${id}`);
  if (!(await control.isVisible())) {
    await page.locator("#run-settings-toggle").click();
  }
  return control;
}

async function watchShort(page) {
  await (await field(page, "run-mode-live")).check();
  await (await field(page, "run-duration")).fill(LIVE_SECONDS);
  await page.locator("#run-button").click();
  await page.waitForFunction(
    () =>
      /^Finished/.test(
        globalThis.document.getElementById("run-status-text")?.dataset.dock ??
          "",
      ),
    null,
    { timeout: RUN_TIMEOUT },
  );
}

const hashOf = (page) => page.evaluate(() => globalThis.location.hash);

describe("Watch fight lands on Results' Live view (#245)", () => {
  for (const size of WIDTHS) {
    test(`an empty view, then the fight, from Character at ${size.width}px`, async () => {
      const { context, page, errors } = await open(size, "#results/live");
      try {
        assert.equal(
          await page.locator("#results-live-empty").isVisible(),
          true,
        );
        assert.equal(
          (await page.locator("#results-live-empty").textContent()).trim(),
          "No live fight yet. Watch fight to see its meters and effects here.",
        );
        assert.equal(await page.locator("#damage-panel").isVisible(), false);
        assert.equal(await page.locator("#combat-log").isVisible(), true);
        assert.equal(await page.locator("#announce-toggle").isVisible(), true);
        if (SHOTS) {
          await page.screenshot({
            path: `${SHOTS}/live-empty-${size.width}.png`,
            fullPage: true,
          });
        }

        await page.locator('[data-nav-area="character"]').click();
        await watchShort(page);
        assert.equal(await hashOf(page), "#results/live");
        assert.equal(
          await page.locator('[data-area="results"]').isVisible(),
          true,
        );
        assert.equal(
          await page.locator("#results-live-empty").isVisible(),
          false,
        );
        for (const selector of [
          "#damage-panel",
          ".resources-panel",
          "#combat-log",
        ]) {
          assert.equal(
            await page.locator(selector).isVisible(),
            true,
            selector,
          );
        }
        assert.match(await page.locator("#dps-value").textContent(), /\d/);
        assert.ok((await page.locator("#combat-log li").count()) > 0);
        if (SHOTS) {
          await page.screenshot({
            path: `${SHOTS}/live-fight-${size.width}.png`,
            fullPage: true,
          });
        }

        // Fight has no meters and no link to open them.
        await page.locator('[data-nav-area="fight"]').click();
        assert.equal(await hashOf(page), "#fight");
        const fight = page.locator("#area-fight");
        assert.equal(await fight.locator("#damage-panel").count(), 0);
        assert.equal(
          await fight.getByRole("link", { name: /open the fight/i }).count(),
          0,
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe("200% text on a 360px phone (#245)", () => {
  test("no area scrolls sideways, with a live fight shown", async () => {
    const { context, page, errors } = await open(PHONE, "#character");
    try {
      await watchShort(page);
      await page.addStyleTag({
        content: `:root { font-family: "${PINNED_FONT}" !important; } html { font-size: ${DOUBLE} !important; }`,
      });
      for (const hash of SCREENS) {
        await page.evaluate((to) => {
          globalThis.location.hash = to;
        }, hash);
        await page.waitForFunction(
          (to) => globalThis.location.hash === to,
          hash,
        );
        const wide = await page.evaluate(() => {
          const doc = globalThis.document.documentElement;
          return { scroll: doc.scrollWidth, client: doc.clientWidth };
        });
        assert.ok(
          wide.scroll <= wide.client + SLACK,
          `${hash}: ${JSON.stringify(wide)}`,
        );
        if (SHOTS) {
          await page.screenshot({
            path: `${SHOTS}/double-360-${hash.slice(1).replace("/", "-")}.png`,
            fullPage: true,
          });
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

// Watch lands on Results, where the strip sits in the page, narrower than
// the dock by the page's margins: with CI's widest font and a four-figure
// DPS its status line wrapped there rather than being cut (#245).
const WIDE_DPS = "6,083.4";
describe("the strip on Results on a 360px phone (#245)", () => {
  test("a running fight's lines are whole beside a wide DPS", async () => {
    const { context, page, errors } = await open(PHONE, "#character");
    try {
      await page.addStyleTag({
        content: `:root, button, input { font-family: "${PINNED_FONT}" !important; }`,
      });
      await (await field(page, "run-mode-live")).check();
      await (await field(page, "run-duration")).fill(LONG_SECONDS);
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          /^Running/.test(
            globalThis.document.getElementById("run-status-text")?.dataset
              .dock ?? "",
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      assert.equal(await hashOf(page), "#results/live");
      const at = await page.evaluate((dps) => {
        const doc = globalThis.document;
        doc.getElementById("run-dps-value").textContent = dps;
        const cut = (id) => {
          const node = doc.getElementById(id);
          return node.scrollWidth > node.clientWidth;
        };
        return {
          cut: ["run-dps-value", "run-summary", "run-status-text"].filter(cut),
          status: doc.getElementById("run-status-text").dataset.dock,
        };
      }, WIDE_DPS);
      assert.deepEqual(at.cut, [], JSON.stringify(at));
      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/strip-results-360.png` });
      }
      await page.locator("#stop-button").click();
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
