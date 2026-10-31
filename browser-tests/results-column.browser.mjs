// The desktop results column (#241, UX3; proposal sections 3 and 5): from
// 1024px up the Run panel and the summary card sit in a column beside the
// areas, 360 to 440 wide and sticky, and nothing sticks to the top of the
// page. No sideways scroll at 1024, 1100, 1280 or 1440; the card shows the
// average and always a live fight line, and is not shown on Results; each
// area's h1 is bigger than "Rogue" (James on #241). Below 1024px the phone
// dock (#240) is unchanged: browser-tests/phone-dock.browser.mjs.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [1024, 1100, 1280, 1440];
const CARD_WIDTH = 1280;
// Just under the wide breakpoint, and a phone.
const NARROWER = [1023, 390];
const SCREEN_HEIGHT = 800;
const COLUMN_MIN_PX = 360;
const COLUMN_MAX_PX = 440;
const COLUMN_TOP_PX = 16;
const SHORT_FIGHT_SECONDS = "4";
const BATCH_FIGHTS = "5";
const RUN_TIMEOUT = 60_000;
// CI's Chrome falls back to DejaVu Sans, much wider than the fonts here:
// the page's text is pinned so a fit does not hang on the fallback.
const FONT_CSS = ':root { font-family: "Liberation Sans" !important; }';
const AREAS = ["character", "rotation", "fight", "results"];

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

async function open(width, hash = "") {
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
  await page.goto(`${base}${hash}`);
  await page.addStyleTag({ content: FONT_CSS });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

// The run settings are Fight's (#245): shown first where they are not.
async function settingsField(page, selector) {
  const field = page.locator(selector);
  if (!(await field.isVisible())) {
    await page.locator('[data-nav-area="fight"]').click();
  }
  return field;
}

async function toArea(page, area) {
  await page.locator(`[data-nav-area="${area}"]`).click();
  await page.waitForFunction(
    (name) =>
      globalThis.document.querySelector(`[data-area="${name}"]`)?.hidden ===
      false,
    area,
  );
}

// Where the column, Run and the shown area are, scrolled to the foot.
const layout = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    globalThis.scrollTo(0, doc.body.scrollHeight);
    const box = (node) => node.getBoundingClientRect().toJSON();
    const controls = doc.getElementById("run-controls");
    const column = controls.closest(".run-column");
    const area = doc.querySelector("[data-area]:not([hidden])");
    const root = getComputedStyle(doc.documentElement);
    const card = doc.getElementById("results-card");
    const size = (node) => parseFloat(getComputedStyle(node).fontSize);
    return {
      sideways:
        doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
      scrolled: globalThis.scrollY,
      controlsPosition: getComputedStyle(controls).position,
      columnPosition: column ? getComputedStyle(column).position : null,
      column: column ? box(column) : null,
      run: box(doc.getElementById("run-button")),
      runInColumn: column?.contains(doc.getElementById("run-button")) ?? false,
      area: box(area),
      strip: getComputedStyle(doc.getElementById("run-bar")).position,
      dps: doc.getElementById("run-dps").checkVisibility(),
      card: card.checkVisibility(),
      cardInColumn: column?.contains(card) ?? false,
      chromeTop: parseFloat(root.getPropertyValue("--chrome-top")),
      chromeBottom: parseFloat(root.getPropertyValue("--chrome-bottom")),
      viewport: globalThis.innerWidth,
      h1: size(area.querySelector("h1")),
      rogue: size(doc.querySelector(".app-title")),
    };
  });

for (const width of WIDTHS) {
  describe(`the desktop results column at ${width}px (#241)`, () => {
    test("Run is in a sticky column beside the areas, a bar on Results; nothing sticks to the top; no sideways scroll", async () => {
      const { context, page, errors } = await open(width);
      try {
        for (const area of AREAS) {
          await toArea(page, area);
          const at = await layout(page);
          const say = `${area}: ${JSON.stringify(at)}`;
          assert.ok(at.sideways <= 0, `no sideways scroll, ${say}`);
          assert.notEqual(at.controlsPosition, "sticky", say);
          assert.notEqual(at.controlsPosition, "fixed", say);
          assert.equal(at.chromeTop, 0, say);
          assert.equal(at.chromeBottom, 0, say);
          assert.notEqual(at.strip, "fixed", `no dock, ${say}`);
          assert.equal(at.dps, false, say);
          assert.equal(at.runInColumn, true, say);
          if (area === "results") {
            // Results has its own Run (#242, UX4; Fran's #253 N4): the run
            // bar goes across the top of the area, which gets the width.
            assert.equal(at.columnPosition, "static", say);
            assert.ok(Math.abs(at.column.left - at.area.left) <= 1, say);
            assert.ok(Math.abs(at.column.width - at.area.width) <= 1, say);
            assert.ok(at.column.bottom <= at.area.top + 1, say);
          } else {
            assert.equal(at.columnPosition, "sticky", say);
            assert.ok(at.column.width >= COLUMN_MIN_PX - 1, say);
            assert.ok(at.column.width <= COLUMN_MAX_PX + 1, say);
            // Beside the area, on its right, inside the screen.
            assert.ok(at.column.left >= at.area.right, say);
            assert.ok(at.column.right <= at.viewport, say);
            // Still in reach at the foot of the page.
            if (at.scrolled > 0) {
              assert.ok(
                Math.abs(at.column.top - COLUMN_TOP_PX) <= 1,
                `the column stays at the top when scrolled, ${say}`,
              );
            }
          }
          assert.ok(at.run.top >= 0 && at.run.bottom <= SCREEN_HEIGHT, say);
          // The card: in the column on every area but Results.
          assert.equal(at.cardInColumn, true, say);
          assert.equal(at.card, area !== "results", say);
          // The heading scale (James on #241): the area's h1 is the biggest.
          assert.ok(at.h1 > at.rogue, `the h1 is bigger than Rogue, ${say}`);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

const cardText = (page) =>
  page.evaluate(() =>
    globalThis.document
      .getElementById("results-card")
      .innerText.replace(/\s+/g, " ")
      .trim(),
  );

describe("the desktop summary card (#241)", () => {
  test("shows the average after a batch, links to the full results and always to the live fight", async () => {
    const { context, page, errors } = await open(CARD_WIDTH, "#fight");
    try {
      const card = page.locator("#results-card");
      assert.match(await cardText(page), /^Average No average yet\./i);
      assert.match(await cardText(page), /Live fight: none yet · open$/);
      assert.equal(await page.locator("#results-card-open").isVisible(), false);

      // A short live fight: its DPS is on the card's live line. The page
      // opens in Batch mode (#242).
      await (await settingsField(page, "#run-mode-live")).check();
      await (
        await settingsField(page, "#run-duration")
      ).fill(SHORT_FIGHT_SECONDS);
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          /^Finished/.test(
            globalThis.document.getElementById("run-status-text").dataset.dock,
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      assert.match(await cardText(page), /Live fight: [\d,]+\.\d DPS · open$/);

      // A batch: the average, its fights and the link to Results.
      await (await settingsField(page, "#run-mode-batch")).check();
      await (await settingsField(page, "#run-iterations")).fill(BATCH_FIGHTS);
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          /^Average finished/.test(
            globalThis.document.getElementById("results-announce")
              ?.textContent ?? "",
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      // A finished batch shows Results; the card is back on Fight.
      await toArea(page, "fight");
      const text = await cardText(page);
      assert.match(text, /^Average [\d,]+\.\d DPS ± [\d,]+\.\d \(95% CI\)/i);
      assert.match(text, /5 fights × 4 s · seed \d+/);
      assert.match(text, /Damage per fight [\d,]+ Top ability /);
      assert.match(text, /Open full results/);
      assert.match(text, /Live fight: [\d,]+\.\d DPS · open$/);

      await card.getByRole("link", { name: "Open full results" }).click();
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector('[data-area="results"]')?.hidden ===
          false,
      );
      assert.equal(await card.isVisible(), false, "not shown on Results");
      await toArea(page, "character");
      // The live fight is under Results' Live view since #245 (UX7).
      await card.getByRole("link", { name: "Open the live fight" }).click();
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector('[data-area="results"]')?.hidden ===
            false && globalThis.location.hash === "#results/live",
      );
      assert.equal(await page.locator("#damage-panel").isVisible(), true);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("below 1024px the column adds no box and the card is not shown", async () => {
    for (const width of NARROWER) {
      const { context, page, errors } = await open(width);
      try {
        const at = await page.evaluate(() => ({
          column: getComputedStyle(
            globalThis.document.querySelector(".run-column"),
          ).display,
          card: globalThis.document
            .getElementById("results-card")
            .checkVisibility(),
          strip: getComputedStyle(globalThis.document.getElementById("run-bar"))
            .position,
        }));
        assert.deepEqual(at, {
          column: "contents",
          card: false,
          strip: "fixed",
        });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  });
});
