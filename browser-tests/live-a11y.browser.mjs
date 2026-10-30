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
// A fight long enough for the log to outgrow its box (#221).
const LONG_FIGHT_SECONDS = 60;

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
        "Paused. Newest events first. Left and Right arrow keys step through the log: Left goes to older events, Right to newer. Home jumps to the oldest event, End to the newest.",
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
        "Paused. Newest events first. Left and Right arrow keys step through the log: Left goes to older events, Right to newer. Home jumps to the oldest event, End to the newest.",
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
          "Paused. Newest events first. Left and Right arrow keys step through the log: Left goes to older events, Right to newer. Home jumps to the oldest event, End to the newest.";
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

// U9 log polish (Fran's #221 check): in a log longer than its box, Home and
// End scroll the selected row into the box's visible area; the rows' damage
// has commas and, with the longer hint, nothing overflows the page. At 360
// too, for the commas (Fran's #221 check).
for (const width of [...WIDTHS, 360]) {
  test(`Home and End scroll the row into view at ${width}px (#221)`, async () => {
    const { context, page, errors } = await openPage(width);
    try {
      await setField(page, "run-duration", String(LONG_FIGHT_SECONDS));
      await settle(page);
      assert.equal(
        await page
          .locator(".combat-log-scroll")
          .getAttribute("aria-keyshortcuts"),
        "ArrowLeft ArrowRight Home End",
      );
      await clickCentre(page.locator("#run-button"));
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#combat-log .combat-log-entry").length >=
          20,
        null,
        { timeout: 20_000 },
      );
      await clickCentre(page.locator("#pause-button"));
      await settle(page);
      await messages(page);
      assert.equal(
        await page.textContent("#log-hint"),
        "Paused. Newest events first. Left and Right arrow keys step through the log: Left goes to older events, Right to newer. Home jumps to the oldest event, End to the newest.",
      );
      const layout = () =>
        page.evaluate(() => {
          const box = document
            .querySelector(".combat-log-scroll")
            .getBoundingClientRect();
          const rows = [...document.querySelectorAll("#combat-log li")];
          const selected = document.querySelector("#combat-log .is-selected");
          const at = selected?.getBoundingClientRect();
          return {
            index: rows.indexOf(selected),
            count: rows.length,
            visible:
              at !== undefined &&
              at.top >= box.top - 1 &&
              at.bottom <= box.bottom + 1,
            scrollTop: document.querySelector(".combat-log-scroll").scrollTop,
            wide: document.documentElement.scrollWidth > globalThis.innerWidth,
          };
        });
      await page.locator(".combat-log-scroll").focus();

      await page.keyboard.press("Home");
      await settle(page);
      const home = await layout();
      assert.equal(home.index, home.count - 1, "Home: the earliest row");
      assert.equal(home.visible, true, "Home: the row in the box");
      assert.ok(home.scrollTop > 0, "Home: the log scrolled down to it");
      assert.match((await messages(page))[0].text, /^Start of log\. /);

      await page.keyboard.press("End");
      await settle(page);
      const end = await layout();
      assert.equal(end.index, 0, "End: the latest row");
      assert.equal(end.visible, true, "End: the row in the box");
      assert.match((await messages(page))[0].text, /^End of log\. /);

      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await settle(page);
      const arrow = await layout();
      assert.equal(arrow.index, arrow.count - 2);
      assert.equal(arrow.visible, true, "an arrow: the row in the box");

      // The rows' damage with commas; a wide one fits its row.
      const cells = await page.evaluate(() => {
        const all = [...document.querySelectorAll(".combat-log-damage")];
        const texts = all.map((cell) => cell.textContent);
        const row = all[0].parentElement;
        all[0].textContent = "1,234,567";
        const cell = all[0].getBoundingClientRect();
        const box = row.getBoundingClientRect();
        return {
          texts,
          inside: cell.left >= box.left && cell.right <= box.right,
          rowClipped: row.scrollWidth > row.clientWidth,
          wide: document.documentElement.scrollWidth > globalThis.innerWidth,
        };
      });
      for (const text of cells.texts) {
        assert.match(text, /^\d{1,3}(,\d{3})*$/);
      }
      assert.equal(cells.inside, true, "a wide damage inside its row");
      assert.equal(cells.rowClipped, false, "the row not clipped");
      assert.equal(cells.wide, false, "no sideways scroll");
      assert.equal(home.wide || end.wide || arrow.wide, false);
      if (process.env.U9_SHOTS) {
        await page
          .locator(".combat-log-scroll")
          .locator("..")
          .screenshot({ path: `${process.env.U9_SHOTS}/rows-${width}.png` });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

// #200 (Fran's #222 check): at 360px a six-digit damage can cut a skill name
// short ("Sinister …"); each row's name cell carries the full name as its
// title, and the damage itself is never cut.
for (const width of [390, 360]) {
  test(`a log row's name has its full name as a title at ${width}px (#200)`, async () => {
    const { context, page, errors } = await openPage(width);
    try {
      await clickCentre(page.locator("#run-button"));
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#combat-log .combat-log-entry").length >=
          5,
        null,
        { timeout: 20_000 },
      );
      await clickCentre(page.locator("#pause-button"));
      await settle(page);
      const rows = await page.evaluate(() => {
        const all = [...document.querySelectorAll("#combat-log li")];
        const titles = all.map((row) => {
          const name = row.querySelector(".combat-log-name");
          return [name.textContent.replace(/^↳ /, ""), name.title];
        });
        // The widest a realistic name and damage get, in the first row.
        const row = all[0];
        const name = row.querySelector(".combat-log-name");
        const damage = row.querySelector(".combat-log-damage");
        name.textContent = "Sinister Strike";
        name.title = "Sinister Strike";
        damage.textContent = "123,456";
        const box = row.getBoundingClientRect();
        const cell = damage.getBoundingClientRect();
        return {
          titles,
          cut: name.scrollWidth > name.clientWidth,
          damageInside: cell.left >= box.left && cell.right <= box.right,
          damageCut: damage.scrollWidth > damage.clientWidth,
          wide: document.documentElement.scrollWidth > globalThis.innerWidth,
        };
      });
      for (const [text, title] of rows.titles) {
        assert.ok(text.length > 0);
        assert.equal(title, text, "the title is the full name");
      }
      assert.equal(rows.damageInside, true, "the damage inside its row");
      assert.equal(rows.damageCut, false, "the damage not cut");
      assert.equal(rows.wide, false, "no sideways scroll");
      if (process.env.U9_SHOTS) {
        await page
          .locator("#combat-log li")
          .first()
          .screenshot({ path: `${process.env.U9_SHOTS}/row-${width}.png` });
      }
      // Whether the name is cut at this width, for the PR (not a pass/fail).
      console.log(
        `# ${width}px: Sinister Strike with 123,456 cut: ${rows.cut}`,
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

// #200 (Fran's #224 QA, N2): on a narrow screen a long name wraps, in full
// with no ellipsis however long (a touch screen cannot reach the title, Fran's
// #228 QA, nit 3; #234), and keeps its full name as the title; on a wide one
// it stays on one line. The damage stays right-aligned in its column, and the
// page never scrolls sideways.
for (const width of [1280, 390, 360]) {
  test(`a long log name wraps in full at ${width}px (#200, #234)`, async () => {
    const { context, page, errors } = await openPage(width);
    try {
      await clickCentre(page.locator("#run-button"));
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#combat-log .combat-log-entry").length >=
          5,
        null,
        { timeout: 20_000 },
      );
      await clickCentre(page.locator("#pause-button"));
      await settle(page);
      const LONG =
        "Instant Poison VI from a Sinister Strike off hand, a made-up name long enough for three lines";
      const at = await page.evaluate((long) => {
        const [first, second] = document.querySelectorAll(
          "#combat-log .combat-log-entry",
        );
        const name = first.querySelector(".combat-log-name");
        name.textContent = long;
        name.title = long;
        const short = second.querySelector(".combat-log-name");
        short.textContent = "Kick";
        first.querySelector(".combat-log-damage").textContent = "123,456";
        second.querySelector(".combat-log-damage").textContent = "7";
        const right = (row) =>
          row.querySelector(".combat-log-damage").getBoundingClientRect().right;
        const damage = first.querySelector(".combat-log-damage");
        return {
          lines:
            name.getBoundingClientRect().height /
            short.getBoundingClientRect().height,
          more: name.scrollHeight > name.clientHeight + 1,
          title: name.title,
          clamp: getComputedStyle(name).webkitLineClamp,
          damageRight: [right(first), right(second)],
          damageAlign: getComputedStyle(damage).textAlign,
          damageCut: damage.scrollWidth > damage.clientWidth,
          wide:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      }, LONG);
      if (width < 520) {
        assert.equal(at.clamp, "none", "no line clamp");
        assert.ok(at.lines > 2.5, `three lines or more: ${at.lines}`);
        assert.equal(at.more, false, "nothing cut off, no ellipsis");
      } else {
        assert.ok(at.lines < 1.5, `one line: ${at.lines}`);
      }
      assert.equal(at.title, LONG, "the full name is the title");
      assert.ok(
        Math.abs(at.damageRight[0] - at.damageRight[1]) <= 1,
        `damage right-aligned: ${at.damageRight}`,
      );
      assert.equal(at.damageCut, false, "the damage not cut");
      assert.equal(at.wide, false, "no sideways scroll");
      if (process.env.U9_SHOTS) {
        await page.locator("#combat-log").screenshot({
          path: `${process.env.U9_SHOTS}/log-name-wrap-${width}.png`,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

// #200 (Fran's #224 QA, N3): the log header and the paused hint say the
// order in one phrase, "Newest events first", and the header fits.
for (const width of [1280, 390, 360]) {
  test(`the log header and the hint say "Newest events first" at ${width}px (#200)`, async () => {
    const { context, page, errors } = await openPage(width);
    try {
      const phrase = "Newest events first";
      assert.equal(await page.textContent(".log-caption"), phrase);
      await clickCentre(page.locator("#run-button"));
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#combat-log .combat-log-entry").length >=
          5,
        null,
        { timeout: 20_000 },
      );
      await clickCentre(page.locator("#pause-button"));
      await settle(page);
      const hint = await page.textContent("#log-hint");
      assert.ok(hint.startsWith(`Paused. ${phrase}. `), hint);
      assert.match(hint, /Left goes to older events, Right to newer\./);
      const header = page.locator(".log-tools").locator("xpath=..");
      const fit = await header.evaluate((root) => {
        const parts = [root, ...root.querySelectorAll("*")].filter(
          (el) => el.getClientRects().length > 0,
        );
        return {
          cut: parts
            .filter(
              (el) =>
                el.scrollWidth > el.clientWidth + 1 ||
                el.scrollHeight > el.clientHeight + 1,
            )
            .map((el) => el.outerHTML.slice(0, 80)),
          outside: parts
            .filter((el) => {
              const at = el.getBoundingClientRect();
              return at.left < -1 || at.right > globalThis.innerWidth + 1;
            })
            .map((el) => el.outerHTML.slice(0, 80)),
          wide:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });
      assert.deepEqual(fit.cut, [], "nothing in the log header is cut");
      assert.deepEqual(fit.outside, [], "the log header is on the page");
      assert.equal(fit.wide, false, "no sideways scroll");
      if (process.env.U9_SHOTS) {
        await header.screenshot({
          path: `${process.env.U9_SHOTS}/log-header-${width}.png`,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
