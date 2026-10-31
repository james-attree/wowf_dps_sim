// Every out-of-date surface says what blocks Run (#245, Fran's #259 check,
// B1 and P2). With both results kept and then edited, each blocking cause,
// alone and together (the run fields, a stats field, the talents over the
// level cap, the rotation), changes the summary card beside the Run column,
// the Average and Live fight banners and the dock's status at once, with no
// move between areas to redraw them; fixing each cause puts them back.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const SHOTS = process.env.SHOTS_DIR ?? null;
const WIDE = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
// CI's fallback font, the widest it may draw in.
const PINNED_FONT = "DejaVu Sans";
const LIVE_SECONDS = "4";
const BATCH_FIGHTS = "5";
const BATCH_SECONDS = "30";
const RUN_TIMEOUT = 60_000;
const SETTLE = 3000;
// Attack power, raised by this after both runs: both results out of date.
const AP_STEP = 10;
const BAD_AP = "-5";
const BAD_LENGTH = "0";
const BAD_SEED = "abc";
const N_SEED = "259";
// Two points in Malice, then a level whose cap they are over.
const TALENT = 'button.talent[data-id="assassination.malice"]';
const TALENT_POINTS = 2;
const LOW_LEVEL = "10";
const TOP_LEVEL = "60";
// A rule's condition left empty is a rotation error.
const RULE = "#rotation/rule/6";
const CONDITION = "input.cond-value";
const AP = '[name="character.attackPower"]';

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

async function open({ width, height }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}#character`);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

const go = async (page, hash) => {
  await page.evaluate((to) => {
    globalThis.location.hash = to;
  }, hash);
  await page.waitForFunction((to) => globalThis.location.hash === to, hash);
};

// A run field, wherever the run settings are at this width.
async function runField(page, id) {
  const field = page.locator(`#${id}`);
  if (!(await field.isVisible())) {
    const toggle = page.locator("#run-settings-toggle");
    if ((await toggle.count()) > 0 && (await toggle.isVisible())) {
      await toggle.click();
    } else {
      await page.locator('[data-nav-area="fight"]').click();
    }
    await field.waitFor({ state: "visible" });
  }
  return field;
}

async function setField(locator, value) {
  await locator.fill(value);
  await locator.press("Tab");
}

const dockSaid = (page) =>
  page.evaluate(
    () =>
      globalThis.document.getElementById("run-status-text")?.dataset.dock ?? "",
  );

async function keepBoth(page) {
  await (await runField(page, "run-mode-live")).check();
  await setField(await runField(page, "run-duration"), LIVE_SECONDS);
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
  await (await runField(page, "run-mode-batch")).check();
  await setField(await runField(page, "run-iterations"), BATCH_FIGHTS);
  await setField(await runField(page, "run-duration"), BATCH_SECONDS);
  await page.locator("#run-button").click();
  await page.waitForFunction(
    () =>
      /^Average finished/.test(
        globalThis.document.getElementById("results-announce")?.textContent ??
          "",
      ),
    null,
    { timeout: RUN_TIMEOUT },
  );
  await go(page, "#character/stats");
  const ap = page.locator(AP);
  await setField(ap, String(Number(await ap.inputValue()) + AP_STEP));
}

// What each surface says now, read where it is without moving to it.
const surfaces = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const said = (selector) => {
      const node = doc.querySelector(selector);
      return node === null
        ? null
        : node.textContent.replace(/\s+/g, " ").trim();
    };
    return {
      card: said(".results-card-stale"),
      average: said("#results-average-stale"),
      live: said("#results-live-stale"),
      status: said("#run-status-text"),
    };
  });

const title = (what) =>
  what === null
    ? "Out of date — Run again."
    : `Out of date — fix ${what}, then Run again.`;

async function expect(page, what, step, { card, issues = 1 }) {
  const want = title(what);
  // Wait for the Average banner, then read them all; a banner left behind
  // fails below with what it still says.
  await page
    .waitForFunction(
      (text) =>
        globalThis.document
          .getElementById("results-average-stale")
          ?.textContent.includes(text),
      want,
      { timeout: SETTLE },
    )
    .catch(() => {});
  const now = await surfaces(page);
  if (card) {
    assert.ok(now.card?.startsWith(want), `${step}: card ${now.card}`);
  }
  assert.ok(now.average.startsWith(want), `${step}: Average ${now.average}`);
  assert.ok(now.live.startsWith(want), `${step}: Live ${now.live}`);
  if (what === null) {
    assert.match(now.status, /Out of date/, `${step}: status`);
  } else {
    assert.match(now.status, /^Can't run/, `${step}: status`);
    // Fran's #245 N1: the Fix link and, with more than one cause, the
    // reason name the same causes as the banners.
    // On a phone the dock's link counts every cause as issues (Fran's
    // #260 check, B2 and B2b, and her #263 note: the settings alone too).
    // The reason, which describes it, no longer repeats "Can't run".
    const fix = await page.locator("#run-errors-link").textContent();
    const named = card;
    const counted = `Fix ${issues} ${issues === 1 ? "issue" : "issues"}`;
    assert.equal(fix, named ? `Fix ${what}` : counted, `${step}: the Fix link`);
    if (what.includes(" and ")) {
      assert.equal(
        await page.locator("#run-reason").textContent(),
        // It says what is wrong, not what to do (Fran's #263 P3).
        `${what[0].toUpperCase()}${what.slice(1)} need fixing`,
        `${step}: the reason`,
      );
    }
    assert.match(await dockSaid(page), /^Can't run|over cap|errors/, step);
  }
}

async function rotation(page, broken, value) {
  await go(page, RULE);
  const condition = page.locator(CONDITION).first();
  await condition.waitFor({ state: "visible" });
  const was = await condition.inputValue();
  await setField(condition, broken ? "" : value);
  return was;
}

async function talents(page, over) {
  await go(page, "#character/talents");
  const level = page.locator("#talents-level");
  await level.waitFor({ state: "visible" });
  if (over) {
    for (let point = 0; point < TALENT_POINTS; point += 1) {
      const talent = page.locator(TALENT);
      await talent.scrollIntoViewIfNeeded();
      await talent.click();
    }
  }
  await level.fill(over ? LOW_LEVEL : TOP_LEVEL);
  await level.press("Enter");
}

for (const size of [WIDE, PHONE]) {
  const card = size.width === WIDE.width;
  describe(`what blocks Run, on every out-of-date surface at ${size.width}px (#259 check)`, () => {
    test("each cause and each mix of them, then each fixed", async () => {
      const { context, page, errors } = await open(size);
      try {
        await keepBoth(page);
        await expect(page, null, "edited", { card });

        // B1: the talents alone, then a stats field alone.
        await talents(page, true);
        await expect(page, "the talents", "talents", { card });
        if (SHOTS) {
          await page.screenshot({
            path: `${SHOTS}/b1-talents-${size.width}.png`,
          });
        }
        await talents(page, false);
        await expect(page, null, "talents fixed", { card });
        await go(page, "#character/stats");
        const ap = page.locator(AP);
        const goodAp = await ap.inputValue();
        await setField(ap, BAD_AP);
        await expect(page, "1 setting", "stats", { card });
        await setField(ap, goodAp);
        await expect(page, null, "stats fixed", { card });

        // P1: the causes named together.
        const value = await rotation(page, true);
        await expect(page, "the rotation", "rotation", { card });
        await talents(page, true);
        await expect(page, "the talents and the rotation", "+ talents", {
          card,
          issues: 2,
        });
        await setField(await runField(page, "run-duration"), BAD_LENGTH);
        await setField(await runField(page, "run-seed"), BAD_SEED);
        await expect(
          page,
          "2 settings, the talents and the rotation",
          "+ 2 settings",
          { card, issues: 4 },
        );
        await rotation(page, false, value);
        await expect(page, "2 settings and the talents", "rotation fixed", {
          card,
          issues: 3,
        });
        await talents(page, false);
        await expect(page, "2 settings", "talents fixed again", {
          card,
          issues: 2,
        });
        await setField(await runField(page, "run-duration"), BATCH_SECONDS);
        await expect(page, "1 setting", "length fixed", { card });
        await setField(await runField(page, "run-seed"), N_SEED);
        await expect(page, null, "all fixed", { card });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
