// #245 PR 2, the Run and Results nits from Fran's and Kira's checks:
// a press on a Run disabled by a run in progress keeps the focus (Fran's
// #251 check); a middle-click on Run pastes nothing (#254); the mid-run
// card's previous average is a labelled group; a blocked Run's stale card
// says what to fix; the Average / Live switch is aria-current="page"; the
// warning's description is its message alone (#256 N1); Back on a phone
// shows the screen's h1 (#256).

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDE = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const LONG_BATCH_FIGHTS = "4000";
const LONG_FIGHT_SECONDS = "600";
const RUN_TIMEOUT = 60_000;
const MIDDLE = "middle";
// Fran's #254 case: "99" typed, "100" selected.
const TYPED = "99";
const SELECTED = "100";
// Back from a rule screen left scrolled down: the browser put the old
// scroll back after the router focused the h1 on some runs only, so the walk
// is done a few times (Fran's #256 L1: 6 of 8 runs on the PR then).
const BACK_TRIES = 3;
const RULE_TO_COPY = 3;
const SETTLE_MS = 300;

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

async function open({ width, height }, hash = "#character") {
  const context = await browser.newContext({ viewport: { width, height } });
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
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

async function field(page, id) {
  const control = page.locator(`#${id}`);
  // The fight's settings are in Fight (#245, the fight-fields move).
  if (!(await control.isVisible())) {
    await page.locator('[data-nav-area="fight"]').click();
    await control.waitFor({ state: "visible" });
  }
  return control;
}

// The focus once the press's own tasks (a timeout after it) have run.
const focused = (page) =>
  page.evaluate(async () => {
    await new Promise((resolve) => globalThis.setTimeout(resolve));
    await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
    const at = globalThis.document.activeElement;
    return at === globalThis.document.body ? "body" : at?.id;
  });

// A press at Run's middle, disabled or not (a locator's click waits for it
// to be enabled).
async function pressRun(page, button = "left") {
  const box = await page.locator("#run-button").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button,
  });
}

const runIsDisabled = (page) =>
  page.waitForFunction(
    () => globalThis.document.getElementById("run-button")?.disabled === true,
    null,
    { timeout: RUN_TIMEOUT },
  );

describe("a press on a Run disabled by a run in progress (#245)", () => {
  test("keeps the focus, or gives it to Stop or Pause, never the page", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      await (await field(page, "run-iterations")).fill(LONG_BATCH_FIGHTS);
      await page.locator("#run-button").click();
      await runIsDisabled(page);
      assert.equal(await page.locator("#run-button").isDisabled(), true);
      await page.locator("#stop-button").focus();
      await pressRun(page);
      assert.equal(await focused(page), "stop-button");
      // From the page: to the batch's main control, Stop.
      await page.evaluate(() => globalThis.document.activeElement?.blur());
      await pressRun(page);
      assert.equal(await focused(page), "stop-button");
      await page.locator("#stop-button").click();

      // A live fight: to Pause.
      await (await field(page, "run-mode-live")).check();
      await (await field(page, "run-duration")).fill(LONG_FIGHT_SECONDS);
      await page.locator("#run-button").click();
      await runIsDisabled(page);
      await page.evaluate(() => globalThis.document.activeElement?.blur());
      await pressRun(page);
      assert.equal(await focused(page), "pause-button");
      await page.locator("#stop-button").click();
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe("a middle-click on Run (#245, Fran's #254 check)", () => {
  test("pastes no selection into the field being typed in", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      const seed = await field(page, "run-seed");
      const fights = await field(page, "run-iterations");
      await fights.fill(TYPED);
      await seed.fill(SELECTED);
      // A selection made by the mouse is the primary selection.
      await seed.dblclick();
      await fights.focus();
      await page.keyboard.press("End");
      await pressRun(page, MIDDLE);
      assert.equal(await fights.inputValue(), TYPED);
      // The check itself: a middle-click on the field does paste.
      await seed.dblclick();
      await fights.focus();
      const box = await fights.boundingBox();
      await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2, {
        button: MIDDLE,
      });
      assert.equal(await fights.inputValue(), `${TYPED}${SELECTED}`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe("browser Back on a phone (#245, Fran's #256 L1)", () => {
  test("shows the screen's h1, which has the focus", async () => {
    for (let run = 0; run < BACK_TRIES; run += 1) {
      const { context, page, errors } = await open(PHONE, "#rotation");
      try {
        assert.equal(
          await page.evaluate(() => globalThis.history.scrollRestoration),
          "manual",
        );
        await page.locator("#rotation-builder li.rule").first().waitFor();
        // Two copies, each from far down its screen, then the Back link.
        const copy = page
          .locator("#rotation-builder li.rule")
          .nth(RULE_TO_COPY)
          .locator("[data-key$='.dup']");
        await copy.scrollIntoViewIfNeeded();
        await copy.focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(SETTLE_MS);
        const again = page.locator(
          "#rotation-builder .rule-foot [data-key$='.dup']",
        );
        await again.scrollIntoViewIfNeeded();
        await again.focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(SETTLE_MS);
        await page.locator("#rotation-back").focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(SETTLE_MS);
        for (const step of ["the second copy", "the first copy"]) {
          await page.goBack();
          await page.waitForTimeout(SETTLE_MS);
          const seen = await page.evaluate(() => {
            const h1 = globalThis.document.getElementById(
              "area-rotation-title",
            );
            const box = h1.getBoundingClientRect();
            return {
              focused: globalThis.document.activeElement === h1,
              inView: box.top >= 0 && box.bottom <= globalThis.innerHeight,
            };
          });
          assert.deepEqual(seen, { focused: true, inView: true }, step);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  });
});
