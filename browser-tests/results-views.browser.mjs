// Browser tests for #242 (UX4; Fran's approved UX proposal §5 and §6, and
// the leftovers of Fran's checks of #252 and #253): Results keeps two
// results, the average and the live fight, with a switch between them;
// running one never clears the other; an edit marks the kept results out
// of date, in Results, in the desktop column's card and in the Run bar, and
// "Results out of date" is said once per change; Run defaults to an
// average. Also, with real mouse buttons in Chrome (page.mouse): a right or
// middle press on Run neither focuses it nor commits the field being typed
// in, and a middle press on a disabled Run leaves the focus where it was
// (#249 N4); the phone dock's whole summary reaches screen readers under its
// ellipsis; the damage table fits Results without scrolling sideways at
// 1280 and 1440 now that the column is a bar there (#253 N4), and says when
// it has more columns to scroll to where it does not fit. Run in Chrome
// through playwright-core with `npm run test:browser`.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const SCREEN_HEIGHT = 900;
const WIDE = 1280;
const PHONE = 360;
const MOUSE_WIDTHS = [1280, 390];
const FIT_WIDTHS = [1280, 1440];
const HINT_WIDTH = 1100;
// DejaVu Sans is CI's fallback, the widest; Liberation Sans has Arial's
// metrics. Pinned so the fit does not hang on this machine's fonts.
const FONTS = ["DejaVu Sans", "Liberation Sans"];
const SETTLE_MS = 400;
const RUN_TIMEOUT = 60_000;
const BATCH_FIGHTS = "5";
const SHORT_FIGHT_SECONDS = "4";
const ATTACK_POWER = "#cfg-character-attackPower";
const MIN = "#cfg-weapons-mainHand-min";
const MAX = "#cfg-weapons-mainHand-max";
const PAIR_MIN = "50";
const PAIR_MAX = "40";
// The widest summary the dock has (Fran's #252 note).
const LONG = { iterations: "100000", duration: "3600", seed: "4294967295" };
const LONG_SUMMARY = "Batch · 100,000 × 3600 s · seed 4294967295";
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
  await new Promise((done) => server?.close(done) ?? done());
});

async function open(width, { hash = "", font = null } = {}) {
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
  if (font !== null) {
    await page.addStyleTag({
      content: `:root { font-family: "${font}" !important; }`,
    });
  }
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

const hasFont = (page, font) =>
  page.evaluate((name) => {
    const context = globalThis.document
      .createElement("canvas")
      .getContext("2d");
    const sample = "Damage by ability mmmwwwiii";
    context.font = "20px monospace";
    const fallback = context.measureText(sample).width;
    context.font = `20px "${name}", monospace`;
    return context.measureText(sample).width !== fallback;
  }, font);

async function toArea(page, area) {
  const link = page.locator(`[data-nav-area="${area}"]:visible`).first();
  await link.click();
  await page.waitForFunction(
    (name) =>
      globalThis.document.querySelector(`[data-area="${name}"]`)?.hidden ===
      false,
    area,
  );
}

// A Character sub-screen (#244, UX6): the fields live on #character/gear
// and #character/stats.
async function toScreen(page, hash) {
  await page.evaluate((to) => {
    globalThis.location.hash = to;
  }, hash);
  await page.waitForFunction((to) => globalThis.location.hash === to, hash);
}

// The run settings, opened first where they fold away (below 520 px).
async function settingsField(page, selector) {
  const field = page.locator(selector);
  if (!(await field.isVisible())) {
    await page.locator("#run-settings-toggle").click();
  }
  return field;
}

async function batchDone(page) {
  await page.waitForFunction(
    () =>
      /^Batch finished/.test(
        globalThis.document.getElementById("results-announce")?.textContent ??
          "",
      ),
    null,
    { timeout: RUN_TIMEOUT },
  );
}

async function liveDone(page) {
  await page.waitForFunction(
    () =>
      /^Finished/.test(
        globalThis.document.getElementById("run-status-text")?.dataset.dock ??
          globalThis.document.getElementById("run-status-text")?.textContent ??
          "",
      ),
    null,
    { timeout: RUN_TIMEOUT },
  );
}

// Each message the Run bar's live region says from here on.
const observeRunAnnounce = (page) =>
  page.evaluate(() => {
    const node = globalThis.document.getElementById("run-announce");
    globalThis.__said = [];
    new globalThis.MutationObserver(() => {
      const text = node.textContent.trim();
      if (text !== "") {
        globalThis.__said.push(text);
      }
    }).observe(node, { childList: true, subtree: true, characterData: true });
  });
const said = (page) => page.evaluate(() => globalThis.__said.splice(0));

const focusId = (page) =>
  page.evaluate(() => globalThis.document.activeElement?.id ?? "");

// A real press of a mouse button at Run's centre (Fran's #252 note: the
// unit test's stand-in event is not how Chrome moves focus).
async function pressRun(page, button) {
  const box = await page.locator("#run-button").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button,
  });
  await page.waitForTimeout(SETTLE_MS);
}

describe("Run defaults to an average (#242)", () => {
  test("the page opens in Batch mode, Run runs an average and shows it", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      assert.equal(await page.isChecked("#run-mode-batch"), true);
      assert.equal(await page.isChecked("#run-mode-live"), false);
      await observeRunAnnounce(page);
      await page.fill("#run-iterations", BATCH_FIGHTS);
      await page.fill("#run-duration", SHORT_FIGHT_SECONDS);
      await page.locator("#run-button").click();
      await batchDone(page);
      assert.equal(
        await page.locator("#area-results").isVisible(),
        true,
        "Run moved to Results",
      );
      // The move is said, and the focus stays in the run bar (comment a).
      assert.ok((await said(page)).includes("Showing Results."));
      assert.equal(
        await page.evaluate(() =>
          Boolean(globalThis.document.activeElement?.closest(".run-controls")),
        ),
        true,
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe("two kept results (#242)", () => {
  test("running live never clears the average, or the reverse; each has its own label", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      await page.fill("#run-iterations", BATCH_FIGHTS);
      await page.fill("#run-duration", SHORT_FIGHT_SECONDS);
      await page.locator("#run-button").click();
      await batchDone(page);
      const label = page.locator("#results-average-label");
      assert.match(
        await label.textContent(),
        /^Average · 5 × 4 s fights · seed \d+ · ran at \d\d:\d\d$/,
      );
      const average = await page.locator("#results-panel").innerText();
      assert.match(average, /Damage by ability/);

      // Live fight view: nothing yet, then Watch fight runs one, on Fight.
      await page.locator("#result-view-live").click();
      await page.locator("#results-live").waitFor({ state: "visible" });
      assert.equal(await page.locator("#results-panel").isVisible(), false);
      assert.equal(
        await page.locator("#result-view-live").getAttribute("aria-current"),
        "true",
      );
      assert.equal(
        await page.locator("#results-live-label").textContent(),
        "Live fight · none yet",
      );
      await page.locator("#results-live-run").click();
      await liveDone(page);
      assert.equal(await page.locator("#area-fight").isVisible(), true);

      await page.goto(`${base}#results/live`);
      await page.locator("#results-live").waitFor({ state: "visible" });
      assert.match(
        await page.locator("#results-live-label").textContent(),
        /^Live fight · 4 s · seed \d+ · ran at \d\d:\d\d · finished$/,
      );
      assert.match(
        await page.locator("#results-live-dps").textContent(),
        /^[\d,]+\.\d$/,
      );
      // The average is still there.
      await page.locator("#result-view-average").click();
      await page.locator("#results-panel").waitFor({ state: "visible" });
      assert.match(await label.textContent(), /^Average · 5 × 4 s fights/);
      assert.equal(await page.locator("#results-panel").innerText(), average);

      // Another average keeps the live fight.
      await page.locator("#results-average-run").click();
      await batchDone(page);
      await page.locator("#result-view-live").click();
      assert.match(
        await page.locator("#results-live-label").textContent(),
        /· finished$/,
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe("out of date after an edit (#242)", () => {
  test("Results, the column's card and the Run bar say so; it is said once", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      await page.fill("#run-iterations", BATCH_FIGHTS);
      await page.fill("#run-duration", SHORT_FIGHT_SECONDS);
      await page.locator("#run-button").click();
      await batchDone(page);
      await toArea(page, "character");
      await toScreen(page, "#character/stats");
      await observeRunAnnounce(page);
      const card = page.locator("#results-card");
      assert.doesNotMatch(await card.innerText(), /Out of date/);

      await page.fill(ATTACK_POWER, "1234");
      await page.press(ATTACK_POWER, "Tab");
      await page.waitForTimeout(SETTLE_MS);
      await page.fill(ATTACK_POWER, "1300");
      await page.press(ATTACK_POWER, "Tab");
      await page.waitForTimeout(SETTLE_MS);
      const messages = await said(page);
      assert.equal(
        messages.filter((text) => /Results out of date/.test(text)).length,
        1,
        JSON.stringify(messages),
      );
      // The desktop column's card (comment c).
      assert.match(
        await card.innerText(),
        /Out of date — Run again\.\s+Attack power changed after this ran\./,
      );
      assert.match(
        await page.locator("#run-status-text").textContent(),
        /^Out of date · edited after the \d\d:\d\d run$/,
      );
      assert.equal(await page.locator("#cfg-edited").isVisible(), true);

      await toArea(page, "results");
      const banner = page.locator("#results-average-stale");
      assert.equal(await banner.isVisible(), true);
      assert.equal(
        (await banner.innerText()).replace(/\s+/g, " "),
        "Out of date — Run again. You changed Attack power after this ran, so these numbers are for the old settings.",
      );
      assert.equal(
        (await page.locator("#results-average-run").textContent()).trim(),
        "Run average again",
      );
      // Running again clears it.
      await page.locator("#results-average-run").click();
      await batchDone(page);
      assert.equal(await banner.isVisible(), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

for (const width of MOUSE_WIDTHS) {
  describe(`other mouse buttons on Run in Chrome at ${width}px (#249 N4)`, () => {
    test("a right or middle press neither focuses Run nor commits the field", async () => {
      const { context, page, errors } = await open(width);
      try {
        await observeRunAnnounce(page);
        for (const button of ["right", "middle"]) {
          await toScreen(page, "#character/gear");
          await page.fill(MAX, PAIR_MAX);
          await page.fill(MIN, PAIR_MIN);
          await toScreen(page, "#character/stats");
          // Typed, not committed: the focus is in Attack power.
          await page.locator(ATTACK_POWER).focus();
          await page.locator(ATTACK_POWER).pressSequentially("9");
          const before = await page.inputValue(ATTACK_POWER);
          await pressRun(page, button);
          assert.equal(
            await focusId(page),
            "cfg-character-attackPower",
            button,
          );
          assert.equal(await page.inputValue(ATTACK_POWER), before, button);
          assert.doesNotMatch(
            await page.locator("#run-status-text").textContent(),
            /^Running/,
            `${button}: no run`,
          );
          await toScreen(page, "#character/gear");
          await page.fill(MIN, "");
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("a middle or right press on a disabled Run leaves the focus where it was", async () => {
      const { context, page, errors } = await open(width, {
        hash: "#character/gear",
      });
      try {
        await page.fill(MIN, PAIR_MIN);
        await page.fill(MAX, PAIR_MAX);
        await page.locator(MAX).blur();
        await page.waitForTimeout(SETTLE_MS);
        await toScreen(page, "#character/stats");
        assert.equal(await page.isDisabled("#run-button"), true);
        for (const button of ["middle", "right"]) {
          await page.locator(ATTACK_POWER).focus();
          await pressRun(page, button);
          assert.equal(
            await focusId(page),
            "cfg-character-attackPower",
            button,
          );
        }
        // The main button still sends the focus to the setting to fix.
        await page.locator(ATTACK_POWER).focus();
        await pressRun(page, "left");
        assert.notEqual(await focusId(page), "");
        assert.notEqual(await focusId(page), "cfg-character-attackPower");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

describe("the phone dock's summary under its ellipsis (#252 note)", () => {
  test(`screen readers get the whole summary at ${PHONE}px`, async () => {
    const { context, page, errors } = await open(PHONE, { font: FONTS[0] });
    try {
      await (
        await settingsField(page, "#run-iterations")
      ).fill(LONG.iterations);
      await page.fill("#run-duration", LONG.duration);
      await page.fill("#run-seed", LONG.seed);
      await page.locator("#run-seed").blur();
      await page.locator("#run-settings-toggle").click();
      await page.waitForTimeout(SETTLE_MS);
      const summary = page.locator("#run-summary");
      // Seen: the dock's shorter line; heard: the whole one.
      assert.equal(
        await summary.getAttribute("data-dock"),
        "Batch · 100k × 3600 s",
      );
      const snapshot = await summary.ariaSnapshot();
      assert.ok(snapshot.includes(LONG_SUMMARY), snapshot);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

// How far the damage table scrolls sideways inside its box, in px.
const tableOverflow = (page) =>
  page.evaluate(() => {
    const scroller = globalThis.document.querySelector(
      "#results-panel [data-breakdown-section] .table-scroll",
    );
    return scroller.scrollWidth - scroller.clientWidth;
  });

describe("the damage table on Results (#253 N4, #242)", () => {
  for (const width of FIT_WIDTHS) {
    for (const font of FONTS) {
      test(`fits without scrolling sideways at ${width}px in ${font}`, async (t) => {
        const { context, page, errors } = await open(width, { font });
        try {
          if (!(await hasFont(page, font))) {
            t.skip(`${font} is not installed here`);
            return;
          }
          await page.fill("#run-iterations", BATCH_FIGHTS);
          await page.fill("#run-duration", SHORT_FIGHT_SECONDS);
          await page.locator("#run-button").click();
          await batchDone(page);
          const overflow = await tableOverflow(page);
          assert.ok(overflow <= SLACK, `${overflow}px of sideways scroll`);
          assert.equal(
            await page
              .locator("[data-breakdown-section] [data-scroll-hint]")
              .getAttribute("data-overflow"),
            "none",
          );
          assert.equal(await page.locator(".scroll-hint").isVisible(), false);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  test(`says it has more columns where it scrolls (${HINT_WIDTH}px and a phone)`, async () => {
    for (const width of [HINT_WIDTH, PHONE]) {
      const { context, page, errors } = await open(width, { font: FONTS[0] });
      try {
        await (await settingsField(page, "#run-iterations")).fill(BATCH_FIGHTS);
        await page.fill("#run-duration", SHORT_FIGHT_SECONDS);
        await page.locator("#run-button").click();
        await batchDone(page);
        const overflow = await tableOverflow(page);
        const wrap = page.locator(
          "[data-breakdown-section] [data-scroll-hint]",
        );
        const hint = wrap.locator(".scroll-hint");
        if (overflow <= SLACK) {
          assert.equal(await wrap.getAttribute("data-overflow"), "none");
          assert.equal(await hint.isVisible(), false);
          continue;
        }
        assert.equal(await wrap.getAttribute("data-overflow"), "more");
        await hint.scrollIntoViewIfNeeded();
        assert.equal(await hint.isVisible(), true, `${width}px`);
        assert.equal(await hint.textContent(), "Scroll for more columns →");
        await page.evaluate(() => {
          const scroller = globalThis.document.querySelector(
            "[data-breakdown-section] .table-scroll",
          );
          scroller.scrollLeft = scroller.scrollWidth;
        });
        await page.waitForTimeout(SETTLE_MS);
        assert.equal(await wrap.getAttribute("data-overflow"), "end");
        assert.equal(await hint.isVisible(), false);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  });
});
