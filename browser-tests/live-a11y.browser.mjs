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
        /^\d\d:\d\d\.\d · .+ · .+ · \d{1,3}(,\d{3})*$/,
        "the visible reading, the damage with commas (U9 polish)",
      );
      // U9 polish: the hint stays the log's description, out of sight.
      assert.equal(
        await page.textContent("#log-hint"),
        "Paused. Left and Right arrow keys step through the log.",
      );
      assert.equal(await page.isVisible("#log-step"), true);
      assert.equal(
        await page.evaluate(() => {
          const box = document
            .querySelector("#log-hint")
            .getBoundingClientRect();
          return box.width * box.height <= 1;
        }),
        true,
        "the hint is visually hidden",
      );

      // U9 polish: the ends of the log, one message a press, a repeat too.
      // Home and End say the end and the row as one message (Scout, #221);
      // an arrow past an end says the end alone and stays on the row.
      const say = async (key) => {
        await page.keyboard.press(key);
        await settle(page);
        const said = await messages(page);
        assert.equal(said.length, 1, `${key}: ${JSON.stringify(said)}`);
        assert.equal(said[0].id, "log-readout", key);
        return said[0].text;
      };
      const spokenRow =
        /^\d+ minutes?( \d+(\.\d)?)?, [^,]+, [a-z ]+, [\d,]+ damage$|^\d+(\.\d)? seconds?, [^,]+, [a-z ]+, [\d,]+ damage$/;
      const home = await say("Home");
      assert.equal(await say("Home"), home, "Home again: said again");
      assert.equal(await say("ArrowLeft"), "Start of log");
      assert.equal(await say("ArrowLeft"), "Start of log", "said again");
      const earliestStep = await page.textContent("#log-step");
      await say("ArrowRight");
      const earliest = await say("ArrowLeft");
      assert.match(earliest, spokenRow);
      assert.equal(home, `Start of log. ${earliest}`);
      assert.equal(await page.textContent("#log-step"), earliestStep);
      // The first step went to the latest row: End says it.
      assert.equal(await say("End"), `End of log. ${stepped[0].text}`);
      assert.equal(await say("ArrowRight"), "End of log");
      assert.equal(await say("ArrowRight"), "End of log", "said again");
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.classList.contains("combat-log-scroll"),
        ),
        true,
        "focus stays on the log",
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
        await page.textContent("#run-status-text"),
        new RegExp(`^Finished · ${FIGHT_SECONDS} s · [\\d,]+\\.\\d DPS$`),
      );
      assert.match(
        await page.textContent("#damage-value"),
        /^\d{1,3}(,\d{3})*$/,
      );
      assert.match(await page.textContent("#dps-value"), /^\d{1,3}(,\d{3})*$/);
      assert.deepEqual(errors, []);
    });

    test("Reset says Ready once; Stop says Fran's copy once", async () => {
      await clickCentre(page.locator("#reset-button"));
      await settle(page);
      assert.deepEqual(await messages(page), [
        { id: "run-announce", text: "Ready" },
      ]);

      await clickCentre(page.locator("#run-button"));
      await page.waitForTimeout(1200);
      assert.deepEqual(await messages(page), [
        { id: "run-announce", text: "Running" },
      ]);
      await clickCentre(page.locator("#stop-button"));
      await settle(page);
      const stopped = await messages(page);
      assert.equal(stopped.length, 1, JSON.stringify(stopped));
      assert.equal(stopped[0].id, "run-announce");
      assert.match(
        stopped[0].text,
        /^Stopped at \d seconds?\. Fight discarded\.$/,
      );

      await clickCentre(page.locator("#reset-button"));
      await settle(page);
      assert.deepEqual(await messages(page), [
        { id: "run-announce", text: "Ready" },
      ]);
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
      assert.match(
        await page.textContent("#run-status-text"),
        new RegExp(`^${BATCH_FIGHTS} fights · [\\d,]+\\.\\d DPS mean · Done$`),
      );
      assert.deepEqual(errors, []);
    });
  });
}

// The tiles with commas (#45, Scout) fit on a phone: the widest likely
// numbers, written into the tiles, overflow neither the tile nor the page.
for (const width of [390, 360]) {
  test(`the damage and DPS tiles fit at ${width}px with commas (#45)`, async () => {
    const { context, page, errors } = await openPage(width);
    try {
      const fits = await page.evaluate(() => {
        document.querySelector("#damage-value").textContent = "9,999,999";
        document.querySelector("#dps-value").textContent = "99,999";
        return [...document.querySelectorAll("#damage-panel .stat-card")].map(
          (card) => {
            const value = card.querySelector(".stat-value");
            const box = card.getBoundingClientRect();
            const text = value.getBoundingClientRect();
            return {
              id: value.id,
              inside: text.left >= box.left && text.right <= box.right,
              clipped: value.scrollWidth > value.clientWidth,
            };
          },
        );
      });
      assert.equal(fits.length, 2);
      for (const { id, inside, clipped } of fits) {
        assert.equal(inside, true, `${id} inside its tile`);
        assert.equal(clipped, false, `${id} not clipped`);
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
        "no sideways scroll",
      );
      if (process.env.U9_SHOTS) {
        await page
          .locator("#damage-panel")
          .screenshot({ path: `${process.env.U9_SHOTS}/tiles-${width}.png` });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

// U9 polish (Fran's #220 check): the longest status lines with commas and a
// long log step, with the hint kept out of sight, fit on a phone.
for (const width of [390, 360]) {
  test(`the status line and the log step fit at ${width}px (U9 polish)`, async () => {
    const { context, page, errors } = await openPage(width);
    try {
      const fits = await page.evaluate(() => {
        const hint = document.querySelector("#log-hint");
        hint.textContent =
          "Paused. Left and Right arrow keys step through the log.";
        hint.classList.add("visually-hidden");
        const step = document.querySelector("#log-step");
        step.textContent = "10:00.0 · Sinister Strike · Crit · 12,345";
        const readout = step.parentElement;
        const panel = readout.parentElement.getBoundingClientRect();
        const box = readout.getBoundingClientRect();
        const lines = [];
        for (const text of [
          "Finished · 3,600 s · 12,345.6 DPS",
          "10,000 fights · 12,345.6 DPS mean · Done",
          "9,999/10K fights kept · 12,345.6 DPS mean (partial) · Stopped",
        ]) {
          const status = document.querySelector("#run-status-text");
          status.textContent = text;
          const at = status.getBoundingClientRect();
          lines.push({
            text,
            inside: at.left >= 0 && at.right <= globalThis.innerWidth,
            wide: document.documentElement.scrollWidth > globalThis.innerWidth,
          });
        }
        return {
          step: box.left >= panel.left && box.right <= panel.right,
          stepClipped: readout.scrollWidth > readout.clientWidth,
          lines,
        };
      });
      assert.equal(fits.step, true, "the log step inside its panel");
      assert.equal(fits.stepClipped, false, "the log step not clipped");
      for (const { text, inside, wide } of fits.lines) {
        assert.equal(inside, true, `${text}: on the page`);
        assert.equal(wide, false, `${text}: no sideways scroll`);
      }
      if (process.env.U9_SHOTS) {
        await page
          .locator(".log-readout")
          .locator("..")
          .screenshot({ path: `${process.env.U9_SHOTS}/log-${width}.png` });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
