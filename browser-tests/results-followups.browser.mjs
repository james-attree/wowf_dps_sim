// Fran's #258 check, folded into #245's fight-fields PR. P1: the empty
// combat log says how to fill it and shows only its Announce toggle until
// the first event. P3: the Average / Live fight switch, wrapped onto two
// rows with 200% text on a phone, is a rounded box rather than an oval.
// P5: in a result's label "seed" and its number stay on one line on a 360
// phone.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const SHOTS = process.env.SHOTS_DIR ?? null;
const PREFIX = process.env.SHOTS_PREFIX ?? "ff";
const WIDE = { width: 1280, height: 900 };
const PHONE = { width: 360, height: 800 };
const DOUBLE = "200%";
// CI's fallback font, the widest it may draw in.
const PINNED_FONT = "DejaVu Sans";
const EMPTY_LOG = "No events yet. Events appear here when you watch a fight.";
const LIVE_SECONDS = "4";
const BATCH_FIGHTS = "5";
const RUN_TIMEOUT = 60_000;
const HALF = 2;
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

async function open({ width, height }, hash, textSize = null) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${hash}`);
  const size = textSize === null ? "" : `html { font-size: ${textSize}; }`;
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; } ${size}`,
  });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

const shot = async (page, name) => {
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/${PREFIX}-${name}.png`,
      fullPage: true,
    });
  }
};

async function toFight(page) {
  await page.locator('[data-nav-area="fight"]').click();
  await page.locator("#area-fight").waitFor({ state: "visible" });
}

const shown = (page, selector) => page.locator(selector).isVisible();

describe("the empty combat log (#258 check, P1)", () => {
  for (const size of [WIDE, PHONE]) {
    test(`says how to fill it and keeps only Announce at ${size.width}px, then shows the rest with the first event`, async () => {
      const { context, page, errors } = await open(size, "#results/live");
      try {
        assert.equal(
          (await page.locator("#combat-log-empty").textContent()).trim(),
          EMPTY_LOG,
        );
        assert.equal(await shown(page, "#combat-log-empty"), true);
        assert.equal(await shown(page, "#announce-toggle"), true);
        assert.equal(await shown(page, ".log-caption"), false);
        assert.equal(await shown(page, "#procs-heading"), false);
        await shot(page, `p1-empty-log-${size.width}`);

        await toFight(page);
        await page.locator("#run-mode-live").check();
        await page.fill("#run-duration", LIVE_SECONDS);
        await page.locator("#run-button").click();
        await page.waitForFunction(
          () =>
            /^Finished/.test(
              globalThis.document.getElementById("run-status-text")?.dataset
                .dock ?? "",
            ),
          null,
          { timeout: RUN_TIMEOUT },
        );
        assert.equal(
          await page.evaluate(() => globalThis.location.hash),
          "#results/live",
        );
        assert.equal(await page.locator("#combat-log-empty").count(), 0);
        assert.equal(await shown(page, ".log-caption"), true);
        assert.equal(await shown(page, "#procs-heading"), true);
        await shot(page, `p1-log-after-watch-${size.width}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

// The switch's box and one of its links: rows, height and corner radius.
const switchShape = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const box = doc.querySelector(".result-switch");
    const links = [...box.querySelectorAll(".result-switch-link")];
    const tops = new Set(
      links.map((link) => Math.round(link.getBoundingClientRect().top)),
    );
    const style = globalThis.getComputedStyle(box);
    // One row: a link, the padding and the border above and below.
    const row =
      links[0].getBoundingClientRect().height +
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom) +
      Number.parseFloat(style.borderTopWidth) +
      Number.parseFloat(style.borderBottomWidth);
    return {
      rows: tops.size,
      row,
      height: box.getBoundingClientRect().height,
      radius: Number.parseFloat(
        globalThis.getComputedStyle(box).borderTopLeftRadius,
      ),
    };
  });

describe("the Average / Live fight switch's corners (#258 check, P3)", () => {
  test("one row is a pill: its radius is half its height", async () => {
    const { context, page, errors } = await open(WIDE, "#results/average");
    try {
      const shape = await switchShape(page);
      assert.equal(shape.rows, 1);
      assert.ok(
        Math.abs(shape.radius - shape.height / HALF) <= SLACK,
        JSON.stringify(shape),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test(`wrapped at ${PHONE.width}px with ${DOUBLE} text: a rounded box, not an oval`, async () => {
    const { context, page, errors } = await open(
      PHONE,
      "#results/average",
      DOUBLE,
    );
    try {
      const shape = await switchShape(page);
      assert.equal(shape.rows, HALF, JSON.stringify(shape));
      // A radius of half one row, not half the two-row box.
      assert.ok(
        Math.abs(shape.radius - shape.row / HALF) <= SLACK,
        JSON.stringify(shape),
      );
      assert.ok(shape.radius < shape.height / HALF - SLACK);
      await shot(page, `p3-switch-${PHONE.width}-200`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe(`"seed" and its number at ${PHONE.width}px (#258 check, P5)`, () => {
  test("stay on one line in the average's label", async () => {
    const { context, page, errors } = await open(PHONE, "#fight");
    try {
      await page.fill("#run-iterations", BATCH_FIGHTS);
      await page.locator("#run-iterations").blur();
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          /^Batch finished/.test(
            globalThis.document.getElementById("results-announce")
              ?.textContent ?? "",
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      await page.locator("#results-average-label").waitFor();
      const lines = await page
        .locator("#results-average-label")
        .evaluate((label) => {
          const text = label.firstChild;
          const at = text.data.indexOf("seed");
          const end = text.data.indexOf(" ", at);
          const range = label.ownerDocument.createRange();
          range.setStart(text, at);
          range.setEnd(text, end);
          const tops = new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          );
          return tops.size;
        });
      assert.equal(lines, 1);
      await shot(page, `p5-seed-${PHONE.width}`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
