// #323: Start from a preset, at the top of Character on a first visit.
// Four cards; one press puts in the preset's #273 reference build and its
// rotation, the line after says so, with Undo (the rotation comes back
// too); the panel folds into the first Character row, "Starting point:
// X", which opens the cards again at #character/start. It opens only when
// the page started from the defaults (a link that failed included), never
// for a saved setup or a link that opened; Custom is remembered; Reset to
// defaults opens it again. At 320, 360, 390, 1024 and 1440, at 100% and
// 150% text, with DejaVu pinned as CI has it.
// START_PRESET_SHOTS=<dir> saves screenshots there.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import { CUSTOM_CHOSEN, START_KEY } from "../js/start-preset.js";
import { SAVED_SETUP_KEY } from "../js/saved-setup.js";
import { LINK_PARAM } from "../js/build-codec.js";

const PINNED_FONT = "DejaVu Sans";
const WIDTHS = [320, 360, 390, 1024, 1440];
const TEXT_SIZES = ["100%", "150%"];
const PHONE_HEIGHT = 844;
const WIDE_HEIGHT = 900;
const WIDE = 1024;
const TARGET_LEAST = 44;
// Where four cards cannot fit over the dock at 150% text (they scroll to).
const SCROLLS = new Set(["320-150%"]);
const SHOTS = process.env.START_PRESET_SHOTS ?? null;
const SETTLE = 5_000;
const RUN_TIMEOUT = 60_000;
const BATCH_FIGHTS = "5";
const BATCH_SECONDS = "30";

const ASSASSINATION = "assassination-daggers";
const COMBAT = "combat-swords";
const SUBTLETY = "subtlety-daggers";
const CUSTOM = "custom";
const ORDER = [ASSASSINATION, COMBAT, SUBTLETY, CUSTOM];
const PANEL = "#start-panel";
const ROW = "#start-row";
const ROW_ITEM = "#start-row-item";
const APPLIED = "#start-applied";
const UNDO = "#start-undo";
const card = (id) => `#start-card-${id}`;

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

async function open(
  width,
  { textSize = "100%", address = "#character", storage = {} } = {},
) {
  const context = await browser.newContext({
    viewport: {
      width,
      height: width < WIDE ? PHONE_HEIGHT : WIDE_HEIGHT,
    },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: base,
  });
  if (Object.keys(storage).length > 0) {
    await context.addInitScript((items) => {
      if (globalThis.sessionStorage.getItem("seeded") === null) {
        globalThis.sessionStorage.setItem("seeded", "1");
        for (const [key, value] of Object.entries(items)) {
          globalThis.localStorage.setItem(key, value);
        }
      }
    }, storage);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(address.startsWith("http") ? address : `${base}${address}`);
  await pin(page, textSize);
  return { context, page, errors };
}

async function pin(page, textSize = "100%") {
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; } html { font-size: ${textSize} !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
}

const text = async (page, selector) =>
  ((await page.locator(selector).textContent()) ?? "")
    .replace(/[ \t\n\r]+/g, " ")
    .trim();

const focused = (page) => page.evaluate(() => document.activeElement?.id);

const shown = (page, selector) => page.locator(selector).isVisible();

const go = async (page, hash, selector) => {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

const shot = async (page, name) => {
  if (SHOTS !== null) {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  }
};

const fitsPage = (page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

const box = (page, selector) =>
  page.locator(selector).evaluate((node) => {
    const { top, bottom, left, right, width, height } =
      node.getBoundingClientRect();
    return { top, bottom, left, right, width, height };
  });

// The top of what covers the page's foot: the dock (the Run bar and the
// nav) on a phone, else the window's bottom.
const dockTop = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector(".run-bar");
    const fixed =
      bar !== null &&
      ["fixed", "sticky"].includes(getComputedStyle(bar).position);
    return fixed
      ? Math.min(bar.getBoundingClientRect().top, globalThis.innerHeight)
      : globalThis.innerHeight;
  });

const announced = (page, pattern) =>
  page
    .waitForFunction(
      ([source, flags]) =>
        new RegExp(source, flags).test(
          document.getElementById("run-announce").textContent,
        ),
      [pattern.source, pattern.flags],
      { timeout: SETTLE },
    )
    .catch(async () =>
      assert.fail(
        `run-announce: ${await page.locator("#run-announce").textContent()}`,
      ),
    );

const waitHidden = (page, selector, why) =>
  page
    .waitForFunction(
      (target) => document.querySelector(target)?.hidden === true,
      selector,
      { timeout: SETTLE },
    )
    .catch(() => assert.fail(`${why}: ${selector} still showing`));

const rotation = async (page) => {
  await go(page, "#rotation", "#cfg-rotation");
  const value = await page.locator("#cfg-rotation").inputValue();
  return value;
};

const gear = (page) =>
  page.evaluate(() => {
    const value = (id) => document.getElementById(id).value;
    return {
      mainHand: value("cfg-weapons-mainHand-type"),
      offHand: value("cfg-weapons-offHand-type"),
      mainPoison: value("cfg-poisons-mainHand"),
      offPoison: value("cfg-poisons-offHand"),
    };
  });

const current = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#start-cards [aria-current]")].map((node) =>
      node.id.replace("start-card-", ""),
    ),
  );

const saved = (page) =>
  page.evaluate((key) => globalThis.localStorage.getItem(key), START_KEY);

describe("Start from a preset (#323)", () => {
  for (const width of WIDTHS) {
    for (const textSize of TEXT_SIZES) {
      const size = `${width}-${textSize}`;
      test(`the cards, a pick and Undo at ${width}, ${textSize} text`, async () => {
        const { context, page, errors } = await open(width, { textSize });
        const name = `${width}-${textSize.replace("%", "")}`;
        try {
          // A first visit: the panel at the top of the list, no row yet.
          await page.locator(PANEL).waitFor({ state: "visible" });
          assert.equal(await shown(page, ROW_ITEM), false, "no row yet");
          assert.deepEqual(
            await page.evaluate(() =>
              [...document.querySelectorAll("#start-cards button")].map(
                (node) => node.id.replace("start-card-", ""),
              ),
            ),
            ORDER,
          );
          assert.deepEqual(await current(page), [CUSTOM], "the defaults");
          const panel = await box(page, PANEL);
          const rows = await box(page, "#character-rows");
          assert.ok(panel.bottom <= rows.top + 1, `${name}: above the rows`);
          for (const id of ORDER) {
            const target = await box(page, card(id));
            assert.ok(target.height >= TARGET_LEAST, `${id}: tall enough`);
            assert.ok(target.width >= TARGET_LEAST, `${id}: wide enough`);
            assert.ok(target.right <= panel.right + 1, `${id}: in the panel`);
          }
          // All four over the dock, but where 150% text on the narrowest
          // phones makes them scroll.
          const last = await box(page, card(CUSTOM));
          if (!SCROLLS.has(size)) {
            assert.ok(
              last.bottom <= (await dockTop(page)) + 1,
              `${name}: the last card over the dock`,
            );
          }
          assert.ok(await fitsPage(page), `${name}: no sideways scroll`);
          await shot(page, `after-first-${name}`);

          // Assassination: the build and its rotation, the line, Undo.
          await page.locator(card(ASSASSINATION)).click();
          await page.locator(APPLIED).waitFor({ state: "visible" });
          assert.equal(await shown(page, PANEL), false, "folded");
          assert.equal(await shown(page, ROW_ITEM), true, "the row");
          assert.equal(await text(page, "#start-summary"), "Assassination");
          assert.match(
            await text(page, "#start-done"),
            /^Assassination set: talents 38\/11\/2, two daggers, Instant and Deadly poisons and its rotation\. Your stats and race are unchanged\.$/,
          );
          assert.equal(await focused(page), "start-undo");
          await announced(page, /replaced\.$/);
          assert.ok((await box(page, UNDO)).height >= TARGET_LEAST);
          assert.ok(await fitsPage(page), `${name}: the line fits`);
          await shot(page, `after-picked-${name}`);

          // Undo: the panel again, focus on the card, the rotation back.
          await page.locator(UNDO).click();
          await page.locator(PANEL).waitFor({ state: "visible" });
          assert.equal(await focused(page), `start-card-${ASSASSINATION}`);
          await announced(page, /put back\.$/);
          assert.equal(await shown(page, APPLIED), false);
          assert.deepEqual(await current(page), [CUSTOM]);
          assert.equal(await rotation(page), "default");
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  test("switching from the Starting point row, and Edited", async () => {
    const { context, page, errors } = await open(390, { textSize: "150%" });
    try {
      await page.locator(card(COMBAT)).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      assert.equal(await text(page, "#start-summary"), "Combat swords");

      // The row opens the cards at #character/start, Combat current.
      await page.locator(ROW).click();
      await page.locator(PANEL).waitFor({ state: "visible" });
      assert.equal(
        await page.evaluate(() => document.location.hash),
        "#character/start",
      );
      assert.deepEqual(await current(page), [COMBAT]);
      await shot(page, "after-start-screen-390-150");

      // A switch: back on the list, its line and Undo; Undo is Combat again.
      await page.locator(card(ASSASSINATION)).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      assert.equal(
        await page.evaluate(() => document.location.hash),
        "#character",
      );
      assert.equal(await focused(page), "start-undo");
      assert.equal(await text(page, "#start-summary"), "Assassination");
      await page.locator(UNDO).click();
      await waitHidden(page, APPLIED, "Undo");
      assert.equal(await text(page, "#start-summary"), "Combat swords");
      assert.equal(await focused(page), "start-row");

      // An edit makes it Edited; a press on Combat puts it back, clean.
      await go(page, "#character/gear", "#cfg-weapons-mainHand-type");
      await page.selectOption("#cfg-weapons-mainHand-type", "dagger");
      await go(page, "#character", ROW);
      assert.equal(
        await text(page, "#start-summary"),
        "Combat swords · Edited",
      );
      await page.locator(ROW).click();
      await page.locator(PANEL).waitFor({ state: "visible" });
      assert.match(await text(page, card(COMBAT)), /· Edited/);
      await shot(page, "after-switched-edited-390-150");
      await page.locator(card(COMBAT)).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      assert.equal(await text(page, "#start-summary"), "Combat swords");
      await go(page, "#character/gear", "#cfg-weapons-mainHand-type");
      assert.equal((await gear(page)).mainHand, "sword");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Custom is remembered; Reset to defaults opens the cards again", async () => {
    const { context, page, errors } = await open(1024);
    try {
      // Custom is the defaults: nothing to undo, the panel folds and the
      // focus goes on to Gear.
      await page.locator(card(CUSTOM)).click();
      await waitHidden(page, PANEL, "Custom");
      assert.equal(await focused(page), "character-row-gear");
      assert.equal(await shown(page, APPLIED), false, "nothing changed");
      assert.equal(await text(page, "#start-summary"), "Custom");
      assert.equal(await saved(page), CUSTOM_CHOSEN);

      await page.reload();
      await pin(page);
      await page.locator(ROW).waitFor({ state: "visible" });
      assert.equal(await shown(page, PANEL), false, "stays folded");

      // Reset to defaults: open again and forgotten; its Undo folds it.
      await page.locator("#cfg-reset").click();
      await page.locator(PANEL).waitFor({ state: "visible" });
      assert.equal(await saved(page), null);
      await page.locator("#cfg-undo").click();
      await waitHidden(page, PANEL, "Reset's Undo");
      assert.equal(await saved(page), CUSTOM_CHOSEN);

      // A preset's pick forgets Custom.
      await page.locator(ROW).click();
      await page.locator(card(SUBTLETY)).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      assert.equal(await saved(page), null);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("a saved setup and a link that opened start folded; a failed link opens", async () => {
    const first = await open(1024);
    let link;
    let setup;
    try {
      await first.page.locator(card(ASSASSINATION)).click();
      await first.page.locator(APPLIED).waitFor({ state: "visible" });
      await first.page.locator("#share-link-header").click();
      await announced(first.page, /copied/i);
      link = await first.page.evaluate(() =>
        document.defaultView.navigator.clipboard.readText(),
      );
      await first.page.waitForFunction(
        (key) => globalThis.localStorage.getItem(key) !== null,
        SAVED_SETUP_KEY,
        { timeout: SETTLE },
      );
      setup = await first.page.evaluate(
        (key) => globalThis.localStorage.getItem(key),
        SAVED_SETUP_KEY,
      );
      assert.deepEqual(first.errors, []);
    } finally {
      await first.context.close();
    }

    for (const [why, options] of [
      ["a saved setup", { storage: { [SAVED_SETUP_KEY]: setup } }],
      ["a link that opened", { address: link }],
    ]) {
      const { context, page, errors } = await open(1024, options);
      try {
        await page.locator(ROW).waitFor({ state: "visible" });
        assert.equal(await shown(page, PANEL), false, `${why}: folded`);
        assert.equal(await text(page, "#start-summary"), "Assassination", why);
        assert.equal(await shown(page, APPLIED), false, `${why}: no Undo`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }

    const broken = await open(1024, {
      address: `?${LINK_PARAM}=1.!!!not-base64#character`,
    });
    try {
      await broken.page.locator(PANEL).waitFor({ state: "visible" });
      assert.equal(await shown(broken.page, ROW_ITEM), false);
      assert.deepEqual(broken.errors, []);
    } finally {
      await broken.context.close();
    }
  });

  test("the Race select, and the Rotation screen's Starting point link", async () => {
    const { context, page, errors } = await open(390);
    try {
      await page.locator(card(SUBTLETY)).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      // No race: the line asks for one (Subtlety's rules use racials).
      assert.equal(await shown(page, "#start-race-ask"), true, "asks");
      await page.locator(ROW).click();
      await page.locator("#start-race").waitFor({ state: "visible" });
      await page.selectOption("#start-race", "orc");
      await go(page, "#character/stats", "#cfg-race");
      assert.equal(await page.locator("#cfg-race").inputValue(), "orc");
      await page.selectOption("#cfg-race", "troll");
      await go(page, "#character/start", "#start-race");
      assert.equal(await page.locator("#start-race").inputValue(), "troll");

      // On Rotation, the #273 hint's link opens the cards.
      await go(page, "#rotation", "#cfg-rotation");
      await page.selectOption("#cfg-rotation", ASSASSINATION);
      await page
        .locator("#cfg-preset-build-start")
        .waitFor({ state: "visible" });
      assert.equal(
        await page.getAttribute("#cfg-preset-build-start", "href"),
        "#character/start",
      );
      assert.ok(
        (await box(page, "#cfg-preset-build-start")).height >= TARGET_LEAST,
      );
      await page.locator("#cfg-preset-build-start").click();
      await page.locator(PANEL).waitFor({ state: "visible" });
      assert.deepEqual(await current(page), [ASSASSINATION]);
      assert.match(await text(page, card(ASSASSINATION)), /· Edited/);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Undo closes on an edit and on leaving Character", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      await page.locator(card(ASSASSINATION)).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      await go(page, "#character/gear", "#cfg-poisons-offHand");
      await page.selectOption("#cfg-poisons-offHand", "instant");
      await go(page, "#character", ROW);
      await waitHidden(page, APPLIED, "an edit");
      assert.equal(
        await text(page, "#start-summary"),
        "Assassination · Edited",
      );

      await page.locator(ROW).click();
      await page.locator(card(SUBTLETY)).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      await page.locator('[data-nav-area="rotation"]').first().click();
      await page.locator("#cfg-rotation").waitFor({ state: "visible" });
      assert.equal(await page.locator("#cfg-rotation").inputValue(), SUBTLETY);
      await page.locator('[data-nav-area="character"]').first().click();
      await page.locator(ROW).waitFor({ state: "visible" });
      await waitHidden(page, APPLIED, "leaving Character");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Undo survives Run's move to Results, and puts the rotation back", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      await go(page, "#fight", "#run-mode-batch");
      await page.locator("#run-mode-batch").check();
      await page.fill("#run-iterations", BATCH_FIGHTS);
      await page.fill("#run-duration", BATCH_SECONDS);
      await page.locator("#run-duration").press("Tab");
      await go(page, "#character", PANEL);
      await page.locator(card(ASSASSINATION)).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          /^Average finished/.test(
            document.getElementById("results-announce")?.textContent ?? "",
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      await page.locator('[data-nav-area="character"]').first().click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      await page.locator(UNDO).click();
      await announced(page, /put back\. Results out of date\.$/);
      assert.equal(await rotation(page), "default");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
