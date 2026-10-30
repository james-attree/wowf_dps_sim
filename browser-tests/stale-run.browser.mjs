// Browser test for #247 (Fran's QA of #246): Run never starts with settings
// the fields do not show. Min above Max, then Backspace and the same digit in
// Min gave back the value it had on focus, so no change fired, while typing
// had cleared the pair's error: Run started with the last valid Max. Also a
// blocked Run sends focus to the first setting to fix (nit 2), the Fix link
// and the footer name the same field (nit 4), and Max clears the pair's
// error while typed as Min does (nit 5). #240 (Fran's #249 Run nits): a pair
// in error is checked as typed, so the repro never shows Ready (N2) and a
// field's own error shows at once (N1); a press on the disabled Run sends
// focus to the field to fix (N5); and the run after the fix is checked for
// the settings it used (N6). Run in Chrome through playwright-core with
// `npm run test:browser`.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [1280, 390, 360];
const SCREEN_HEIGHT = 900;
// The pair the form refuses: Max under Min.
const PAIR_MIN = "50";
const PAIR_MAX = "40";
// Min's last digit: Backspace, then this, gives back PAIR_MIN.
const LAST_DIGIT = "0";
// Not whole: invalid on its own, so the pair's check does not apply.
const NOT_WHOLE = "4.5";
// A Max that fixes the pair.
const FIXED_MAX = "60";
// Long enough for a started run to show.
const SETTLE_MS = 300;
// N6's run: one seeded fight, so two runs of the same settings agree.
const N6_SEED = "424242";
const N6_FIGHTS = "1";
const BATCH_TIMEOUT = 60_000;
const MIN = "#cfg-weapons-mainHand-min";
const MAX = "#cfg-weapons-mainHand-max";

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

async function open(width) {
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
  await page.goto(base);
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

// Min 50 and Max 40, each committed by clicking away: the pair's error.
async function pairError(page) {
  const min = page.locator(MIN);
  const max = page.locator(MAX);
  await min.fill(PAIR_MIN);
  await min.blur();
  await max.fill(PAIR_MAX);
  await max.blur();
  return { min, max };
}

// What Run, the Fix link and the footer say, and where focus is.
const read = (page) =>
  page.evaluate(() => {
    const shown = (id) => {
      const node = document.getElementById(id);
      return node.hidden ? null : node.textContent.trim();
    };
    const number = (text) => {
      const match = /(\d+)/.exec(text ?? "");
      return match === null ? 0 : Number(match[1]);
    };
    const reason = document.getElementById("run-reason").textContent.trim();
    const gate = document.getElementById("cfg-run-gate").textContent.trim();
    const first = document.querySelector("#cfg-fix-list a");
    return {
      disabled: document.getElementById("run-button").disabled,
      status: document.getElementById("run-status-text").textContent.trim(),
      reason,
      runCount: number(reason),
      link: shown("run-errors-link"),
      footerCount: number(gate),
      footerOk: shown("cfg-status-ok") !== null,
      footerFirst: first?.getAttribute("href") ?? null,
      footerText: document.getElementById("cfg-fix-list").textContent.trim(),
      focus: document.activeElement?.id || document.activeElement?.tagName,
    };
  });

// The run settings are folded away at the narrow widths.
async function settingsField(page, id) {
  const field = page.locator(`#${id}`);
  if (!(await field.isVisible())) {
    await page.locator("#run-settings-toggle").click();
  }
  return field;
}

function agree(state, step) {
  assert.equal(state.runCount, state.footerCount, `${step}: the counts`);
  assert.equal(state.disabled, state.runCount > 0, `${step}: Run's state`);
  assert.equal(state.footerOk, state.footerCount === 0, `${step}: footer`);
  assert.equal(state.link !== null, state.runCount > 0, `${step}: Fix link`);
}

describe("Run never starts with stale settings (#247)", () => {
  for (const width of WIDTHS) {
    test(`Fran's repro: Backspace then the same digit in Min, then Run, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const { min, max } = await pairError(page);
      const before = await read(page);
      agree(before, "the pair's error");
      assert.match(before.status, /^Can't run/);

      await min.click();
      await min.press("End");
      await min.press("Backspace");
      assert.equal((await read(page)).runCount, 0, "Min 5 passes");
      await min.press(LAST_DIGIT);
      assert.equal(await min.inputValue(), PAIR_MIN, "Min reads 50 again");
      // #240 N2: the pair is checked as typed, so 50 again is not Ready.
      const typed = await read(page);
      agree(typed, "50 typed back");
      assert.equal(typed.runCount, 1, "the pair's error is back");
      assert.match(typed.status, /^Can't run/);
      // A press on the disabled Run (Chrome sends it no click, and drops
      // focus to the page): #240 N5 sends focus to the field to fix.
      await page.locator("#run-button").click({ force: true });
      await page.waitForTimeout(SETTLE_MS);

      const after = await read(page);
      assert.equal(await min.inputValue(), PAIR_MIN);
      assert.equal(await max.inputValue(), PAIR_MAX);
      assert.match(after.status, /^Can't run/, "no run started");
      assert.equal(await page.locator("#pause-button").isEnabled(), false);
      agree(after, "after Run");
      assert.equal(after.runCount, 1, "the pair's error, checked again");
      // Nit 2: focus goes to the first setting to fix, not the page.
      assert.equal(after.focus, MAX.slice(1), "focus on the field to fix");
      assert.equal(after.footerFirst, MAX, "the field the footer names");
      assert.deepEqual(errors, []);
      await context.close();
    });

    test(`the same digit typed back, then blur, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const { min } = await pairError(page);
      await min.click();
      await min.press("End");
      await min.press("Backspace");
      const typing = await read(page);
      agree(typing, "typing a value that passes");
      assert.equal(typing.runCount, 0);
      await min.press(LAST_DIGIT);
      assert.equal((await read(page)).runCount, 1, "#240 N2: checked as typed");
      await min.blur();
      const blurred = await read(page);
      agree(blurred, "blurred");
      assert.equal(blurred.runCount, 1, "checked on blur with no change");
      assert.equal(
        await page.locator(MAX).getAttribute("aria-invalid"),
        "true",
      );
      assert.deepEqual(errors, []);
      await context.close();
    });

    test(`a blocked Run sends focus to the first setting to fix, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const min = page.locator(MIN);
      const max = page.locator(MAX);
      await max.fill(FIXED_MAX);
      await max.blur();
      await min.fill(PAIR_MIN);
      await min.blur();
      // A field not in error is not marked while typed: Run checks it.
      await max.click();
      await max.fill(PAIR_MAX);
      assert.equal((await read(page)).disabled, false, "typing adds no error");
      await page.locator("#run-button").click();
      await page.waitForTimeout(SETTLE_MS);
      const state = await read(page);
      assert.match(state.status, /^Can't run/, "no run started");
      agree(state, "after Run");
      assert.equal(state.focus, MAX.slice(1), "nit 2: not the page body");
      assert.equal(state.footerFirst, MAX, "the field the footer names");
      assert.deepEqual(errors, []);
      await context.close();
    });

    test(`the Fix link goes to the field the footer names, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      await pairError(page);
      const state = await read(page);
      assert.equal(state.footerFirst, MAX);
      assert.match(state.footerText, /^Main hand, Max damage/);
      await page.locator("#run-errors-link").click();
      assert.equal((await read(page)).focus, MAX.slice(1), "nit 4");
      assert.deepEqual(errors, []);
      await context.close();
    });

    test(`Max typed invalid on its own swaps the pair's error for its own, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const { max } = await pairError(page);
      await max.click();
      await max.fill("");
      await max.pressSequentially(NOT_WHOLE);
      const typing = await read(page);
      agree(typing, "typing 4.5 into Max");
      // #240 N1: the Max's own message at once, not a lingering pair's.
      assert.equal(typing.runCount, 1, "the Max's own error, as typed");
      assert.doesNotMatch(typing.footerText, /at least the min/);
      assert.equal(await max.getAttribute("aria-invalid"), "true");
      assert.equal(
        await page.locator(MIN).getAttribute("aria-invalid"),
        null,
        "the Min is no longer marked",
      );
      await max.blur();
      const committed = await read(page);
      agree(committed, "committed");
      assert.equal(committed.runCount, 1, "the Max's own error, still");
      assert.equal(await max.getAttribute("aria-invalid"), "true");
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  // #240 N6: the run after the fix is one seeded fight, and its mean is the
  // one of the same fight with 50 and 60 committed directly, not the one with
  // the last valid Max (Min 50 and the page's own Max).
  async function oneFight(page) {
    await (await settingsField(page, "run-mode-batch")).check();
    await (await settingsField(page, "run-iterations")).fill(N6_FIGHTS);
    const seed = await settingsField(page, "run-seed");
    await seed.fill(N6_SEED);
    await seed.blur();
  }
  async function meanOf(page) {
    await page.waitForFunction(
      () =>
        / · Done$/.test(
          globalThis.document.getElementById("run-status-text").textContent,
        ),
      null,
      { timeout: BATCH_TIMEOUT },
    );
    const status = await page.locator("#run-status-text").textContent();
    return /([\d,.]+) DPS mean/.exec(status)[1];
  }
  async function committedRun(values) {
    const { context, page } = await open(WIDTHS[0]);
    await oneFight(page);
    for (const [selector, value] of values) {
      await page.locator(selector).fill(value);
      await page.locator(selector).blur();
    }
    await page.locator("#run-button").click();
    const mean = await meanOf(page);
    await context.close();
    return mean;
  }

  test("a run after the repro is fixed uses what the fields show (#240 N6)", async () => {
    const { context, page, errors } = await open(WIDTHS[0]);
    await oneFight(page);
    const { min, max } = await pairError(page);
    await max.click();
    await max.fill(FIXED_MAX);
    await page.locator("#run-button").click();
    const mean = await meanOf(page);
    assert.equal(await min.inputValue(), PAIR_MIN);
    assert.equal(await max.inputValue(), FIXED_MAX);
    assert.deepEqual(errors, []);
    await context.close();
    const shown = await committedRun([
      [MIN, PAIR_MIN],
      [MAX, FIXED_MAX],
    ]);
    const stale = await committedRun([[MIN, PAIR_MIN]]);
    assert.notEqual(shown, stale, "the two settings give two means");
    assert.equal(mean, shown, "the run used Min 50 and Max 60");
  });
});
