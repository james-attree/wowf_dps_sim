// Browser test for #237: Run's blocked check and its count are one rule, and
// Run's "N settings to fix" matches the form footer's count at every step of
// the edit that used to split them. A Min marked by its Max's error (a null
// message) was kept while the Min was typed invalid on its own, which left
// Run disabled saying "0 settings to fix" while the footer said all was well.
// Run in Chrome through playwright-core with `npm run test:browser`.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [1280, 390, 360];
const SCREEN_HEIGHT = 900;
// A pair the form refuses (Max under Min), then a Min that is invalid on its
// own (not whole) and so leaves the Max fine.
const PAIR_MIN = "50";
const PAIR_MAX = "40";
const NOT_WHOLE = "1.5";

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
  // The weapons' fields are on Character's Gear and weapons (#244, UX6).
  await page.goto(`${base}#character/gear`);
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

// What Run and the footer say: Run's state and count, the bar's Fix link,
// and the footer's count (its Run gate) or its all-clear.
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
    return {
      disabled: document.getElementById("run-button").disabled,
      reason,
      runCount: number(reason),
      link: shown("run-errors-link"),
      footerCount: number(gate),
      footerOk: shown("cfg-status-ok") !== null,
    };
  });

function agree(state, step) {
  assert.equal(state.runCount, state.footerCount, `${step}: the counts`);
  assert.equal(state.disabled, state.runCount > 0, `${step}: Run's state`);
  assert.equal(state.footerOk, state.footerCount === 0, `${step}: footer`);
  assert.equal(state.link !== null, state.runCount > 0, `${step}: Fix link`);
  assert.doesNotMatch(state.reason, /\b0 settings/, step);
}

describe("Run's blocked check is its count (#237)", () => {
  for (const width of WIDTHS) {
    test(`a Min typed invalid after its pair's error, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      const min = page.locator("#cfg-weapons-mainHand-min");
      const max = page.locator("#cfg-weapons-mainHand-max");
      await min.fill(PAIR_MIN);
      await min.blur();
      await max.fill(PAIR_MAX);
      await max.blur();
      const pair = await read(page);
      agree(pair, "the pair's error");
      assert.equal(pair.runCount, 1, "the Max's error, once");

      await min.click();
      await min.fill(NOT_WHOLE);
      const typing = await read(page);
      agree(typing, "typing");
      // A pair in error is checked as typed (#240, Fran's #249 N1): the
      // Min's own message takes the pair's at once.
      assert.equal(typing.runCount, 1, "the Min's own error, as typed");
      assert.equal(await min.getAttribute("aria-invalid"), "true");

      await min.blur();
      const committed = await read(page);
      agree(committed, "committed");
      assert.equal(committed.runCount, 1, "the Min's own error");
      assert.equal(await min.getAttribute("aria-invalid"), "true");
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
});
