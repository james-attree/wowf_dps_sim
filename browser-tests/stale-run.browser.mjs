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
// Target level is still typable (#385). 0 is out of range; 62 is a
// legal typed level (blank follows the character and is 63).
const INVALID = "0";
const VALID = "62";
const NOT_WHOLE = "4.5";
// Long enough for a started run to show.
const SETTLE_MS = 300;
// N6's run: one seeded fight, so two runs of the same settings agree.
const N6_SEED = "424242";
const N6_FIGHTS = "1";
const BATCH_TIMEOUT = 60_000;
const FIELD = "#cfg-target-level";

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
  await page.goto(`${base}#fight`);
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

async function fieldError(page) {
  const field = page.locator(FIELD);
  await field.fill(INVALID);
  await field.blur();
  return field;
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

// The run settings are Fight's (#245): shown first for a field.
async function settingsField(page, id) {
  const field = page.locator(`#${id}`);
  if (!(await field.isVisible())) {
    await page.locator('[data-nav-area="fight"]').click();
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
    test(`an invalid target level blocks Run, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const field = await fieldError(page);
      const before = await read(page);
      agree(before, "the field's error");
      assert.match(before.status, /^Can't run/);
      await page.locator("#run-button").click({ force: true });
      await page.waitForTimeout(SETTLE_MS);
      const after = await read(page);
      assert.equal(await field.inputValue(), INVALID);
      assert.match(after.status, /^Can't run/, "no run started");
      assert.equal(await page.locator("#pause-button").isEnabled(), false);
      agree(after, "after Run");
      assert.equal(after.runCount, 1);
      assert.equal(after.focus, FIELD.slice(1), "focus on the field to fix");
      assert.equal(after.footerFirst, FIELD, "the field the footer names");
      assert.deepEqual(errors, []);
      await context.close();
    });

    test(`a valid value typed over an error clears it, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const field = await fieldError(page);
      await field.click();
      await field.fill(VALID);
      const typing = await read(page);
      agree(typing, "typing a value that passes");
      assert.equal(typing.runCount, 0);
      await field.blur();
      const blurred = await read(page);
      agree(blurred, "blurred");
      assert.equal(blurred.runCount, 0);
      assert.equal(await field.getAttribute("aria-invalid"), null);
      assert.deepEqual(errors, []);
      await context.close();
    });

    test(`a blocked Run sends focus to the first setting to fix, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const field = page.locator(FIELD);
      await field.fill(VALID);
      await field.blur();
      await field.click();
      await field.fill(INVALID);
      assert.equal(
        (await read(page)).disabled,
        false,
        "typing adds no error yet",
      );
      await page.locator("#run-button").click();
      await page.waitForTimeout(SETTLE_MS);
      const state = await read(page);
      assert.match(state.status, /^Can't run/, "no run started");
      agree(state, "after Run");
      assert.equal(state.focus, FIELD.slice(1), "nit 2: not the page body");
      assert.equal(state.footerFirst, FIELD, "the field the footer names");
      assert.deepEqual(errors, []);
      await context.close();
    });

    test(`the Fix link goes to the field the footer names, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      await fieldError(page);
      const state = await read(page);
      assert.equal(state.footerFirst, FIELD);
      await page.locator("#run-errors-link").click();
      assert.equal((await read(page)).focus, FIELD.slice(1), "nit 4");
      assert.deepEqual(errors, []);
      await context.close();
    });

    test(`a not-whole target level is its own error as typed, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const field = await fieldError(page);
      await field.click();
      await field.fill("");
      await field.pressSequentially(NOT_WHOLE);
      const typing = await read(page);
      agree(typing, "typing 4.5");
      assert.equal(typing.runCount, 1, "the field's own error, as typed");
      assert.equal(await field.getAttribute("aria-invalid"), "true");
      await field.blur();
      const committed = await read(page);
      agree(committed, "committed");
      assert.equal(committed.runCount, 1);
      assert.equal(await field.getAttribute("aria-invalid"), "true");
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  // #240 N6: the run after the typo is fixed uses the typed target level,
  // not the blank default (63).
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
  async function committedRun(value) {
    const { context, page } = await open(WIDTHS[0]);
    await oneFight(page);
    if (value !== null) {
      await page.locator(FIELD).fill(value);
      await page.locator(FIELD).blur();
    }
    await page.locator("#run-button").click();
    const mean = await meanOf(page);
    await context.close();
    return mean;
  }

  test("a run after the typo is fixed uses what the fields show (#240 N6)", async () => {
    const { context, page, errors } = await open(WIDTHS[0]);
    await oneFight(page);
    const field = await fieldError(page);
    await field.fill(VALID);
    await page.locator("#run-button").click();
    const mean = await meanOf(page);
    assert.equal(await field.inputValue(), VALID);
    assert.deepEqual(errors, []);
    await context.close();
    const shown = await committedRun(VALID);
    const stale = await committedRun(null);
    assert.notEqual(shown, stale, "the two settings give two means");
    assert.equal(mean, shown, "the run used target level 62");
  });
});
