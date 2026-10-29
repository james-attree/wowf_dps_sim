// Browser test for the live readouts' screen reader behaviour (U9, #45;
// Fran's answers and Scout's calls in the issue). A MutationObserver counts
// the messages every live region on the page says: a change that leaves a
// region with text. Emptying a region is not a message (#run-announce is
// emptied before each write). Run in Chrome through
// playwright-core with `npm run test:browser`, like the other browser tests.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [1280, 390];
// A short fight, so it finishes in the test: seconds of fight time, played
// in real time by the page.
const FIGHT_SECONDS = 4;
const BATCH_FIGHTS = 20;

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

// Starts counting: each observer callback adds one message per live region
// whose text changed and is not empty, as { id, text }.
function observeLiveRegions() {
  const LIVE_ROLES = { status: "polite", log: "polite", alert: "assertive" };
  // The live region a node is in, by the aria-live rules: the nearest
  // aria-live wins, else an implicit live role (output is role=status).
  const regionOf = (node) => {
    for (
      let at = node.nodeType === 1 ? node : node.parentElement;
      at;
      at = at.parentElement
    ) {
      const live = at.getAttribute("aria-live");
      if (live !== null) {
        return live === "off" ? null : at;
      }
      const role =
        at.getAttribute("role") ?? (at.tagName === "OUTPUT" ? "status" : null);
      if (role in LIVE_ROLES) {
        return at;
      }
    }
    return null;
  };
  const describe = (region) =>
    region.id || `${region.tagName.toLowerCase()}.${region.className}`;
  globalThis.__liveMessages = [];
  new globalThis.MutationObserver((records) => {
    const changed = new Set();
    for (const record of records) {
      const region = regionOf(record.target);
      if (region) {
        changed.add(region);
      }
    }
    for (const region of changed) {
      const text = region.textContent.trim();
      if (text !== "") {
        globalThis.__liveMessages.push({ id: describe(region), text });
      }
    }
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

async function openPage(width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
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
  await page.evaluate(observeLiveRegions);
  return { context, page, errors };
}

// The messages said since the last call.
function messages(page) {
  return page.evaluate(() => globalThis.__liveMessages.splice(0));
}

// One real mouse click at the centre of a control, scrolled to the middle
// of the screen first so the sticky run bar can't sit over it.
async function clickCentre(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await locator.boundingBox();
  await locator
    .page()
    .mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// The run settings, opened first where they fold away (below 520 px).
async function settingsField(page, id) {
  const field = page.locator(`#${id}`);
  if (!(await field.isVisible())) {
    await clickCentre(page.locator("#run-settings-toggle"));
  }
  return field;
}

async function setField(page, id, value) {
  await (await settingsField(page, id)).fill(value);
}

// A few frames' worth of quiet, for messages to land.
const settle = (page) => page.waitForTimeout(300);

for (const width of WIDTHS) {
  describe(`live readouts in Chrome at ${width}px (#45)`, () => {
    let context;
    let page;
    let errors;
    before(async () => {
      ({ context, page, errors } = await openPage(width));
    });
    after(() => context?.close());

    test("a live fight: Running once, one Pause, Running on Resume, one Finish", async () => {
      await setField(page, "run-duration", String(FIGHT_SECONDS));
      await settle(page);
      assert.deepEqual(await messages(page), [], "typing says nothing");

      await clickCentre(page.locator("#run-button"));
      await page.waitForTimeout(1500);
      assert.deepEqual(await messages(page), [
        { id: "run-announce", text: "Running" },
      ]);

      await clickCentre(page.locator("#pause-button"));
      await settle(page);
      const paused = await messages(page);
      assert.equal(paused.length, 1, JSON.stringify(paused));
      assert.equal(paused[0].id, "run-announce");
      assert.match(
        paused[0].text,
        /^Paused at \d seconds?\. Total damage [\d,]+\. [\d,]+ DPS\. Energy \d+ of \d+\. Combo points \d of 5\.$/,
      );
      assert.equal(
        await page.getAttribute("#pause-button", "aria-pressed"),
        null,
      );
      // The hint is the log's description, not a live message.
      assert.equal(
        await page
          .locator(".combat-log-scroll")
          .getAttribute("aria-describedby"),
        "log-hint",
      );
      assert.equal(
        await page.textContent("#log-hint"),
        "Paused. Left and Right arrow keys step through the log.",
      );

      // A step through the log: one spoken reading.
      await page.locator(".combat-log-scroll").focus();
      await page.keyboard.press("ArrowLeft");
      await settle(page);
      const stepped = await messages(page);
      assert.equal(stepped.length, 1, JSON.stringify(stepped));
      assert.equal(stepped[0].id, "log-readout");
      assert.match(
        stepped[0].text,
        /^\d+(\.\d)? seconds?, [^,]+, [a-z ]+, [\d,]+ damage$/,
      );
      assert.match(
        await page.textContent("#log-step"),
        /^\d\d:\d\d\.\d · .+ · .+ · \d+$/,
        "the visible reading as before",
      );

      await clickCentre(page.locator("#pause-button"));
      await settle(page);
      assert.deepEqual(
        await messages(page),
        [{ id: "run-announce", text: "Running" }],
        "Resume says Running, as Run does (#45, Scout)",
      );

      await page.waitForFunction(
        () =>
          document
            .querySelector("#run-status-text")
            .textContent.startsWith("Finished"),
        null,
        { timeout: 20_000 },
      );
      await settle(page);
      const finished = await messages(page);
      assert.equal(finished.length, 1, JSON.stringify(finished));
      assert.equal(finished[0].id, "run-announce");
      assert.match(
        finished[0].text,
        new RegExp(
          `^Finished at ${FIGHT_SECONDS} seconds\\. Total damage [\\d,]+\\. [\\d,]+\\.\\d DPS\\.$`,
        ),
      );
      assert.match(
        await page.textContent("#damage-value"),
        /^\d{1,3}(,\d{3})*$/,
      );
      assert.deepEqual(errors, []);
    });

    test("a batch: the results panel's messages, the bar quiet", async () => {
      await (await settingsField(page, "run-mode-batch")).check();
      await settle(page);
      assert.deepEqual(await messages(page), [
        { id: "run-announce", text: "Ready" },
      ]);
      await setField(page, "run-iterations", String(BATCH_FIGHTS));
      await clickCentre(page.locator("#run-button"));
      await page.waitForFunction(
        () =>
          /Done$/.test(document.querySelector("#run-status-text").textContent),
        null,
        { timeout: 60_000 },
      );
      await settle(page);
      const said = await messages(page);
      assert.ok(said.length >= 2, JSON.stringify(said));
      assert.ok(
        said.every(({ id }) => id === "results-announce"),
        JSON.stringify(said),
      );
      assert.equal(said[0].text, `Batch started, ${BATCH_FIGHTS} fights.`);
      for (const { text } of said.slice(1, -1)) {
        assert.match(text, /^Batch \d+% done, \d+ of \d+ fights\.$/);
      }
      assert.match(
        said.at(-1).text,
        /^Batch finished: [\d,.]+ DPS(, plus or minus [\d,.]+)?\.$/,
      );
      assert.deepEqual(errors, []);
    });
  });
}
