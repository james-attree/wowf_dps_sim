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
const LONG_BATCH_FIGHTS = "4000";
const LONG_FIGHT_SECONDS = "600";
const RUN_TIMEOUT = 60_000;

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
  if (!(await control.isVisible())) {
    await page.locator("#run-settings-toggle").click();
  }
  return control;
}

const focused = (page) =>
  page.evaluate(() => {
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
