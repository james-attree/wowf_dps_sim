// TR-02 / #332: whole file skipped — empty presets until #333
// #273: the preset's reference build under the Rotation select. The hint
// says what the preset is built for while the page's build differs; since
// #323 its "Starting point" link opens Start from a preset on Character,
// where a card puts the build in (browser-tests/start-preset.browser.mjs
// has the pick, its line and Undo). At 320, 360, 1024 and 1440, at 100%
// and 150% text, with DejaVu pinned as CI has it.
// PRESET_BUILD_SHOTS=<dir> saves screenshots there.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import { exportRotation } from "../js/rotation-io.js";
import { presetRotation } from "../js/rotation-presets.js";
import { LINK_CAP } from "../js/views/share-link.js";

const PINNED_FONT = "DejaVu Sans";
const WIDTHS = [320, 360, 1024, 1440];
const SHOT_WIDTHS = [320, 1024, 1440];
const TEXT_SIZES = ["100%", "150%"];
const SCREEN_HEIGHT = 900;
const TARGET_LEAST = 44;
const SHOTS = process.env.PRESET_BUILD_SHOTS ?? null;
const NBSP = "\u00a0";
const SETTLE = 5_000;
const LOW_LEVEL = "40";
const POWER = "#cfg-character-attackPower";
const POWER_STEP = 10;

const ASSASSINATION = "assassination-daggers";
const SUBTLETY = "subtlety-daggers";
const COMBAT = "combat-swords";
const HINT = "#cfg-preset-build-hint";
const LINK = "#cfg-preset-build-start";
const BOX = "#cfg-preset-build";
const SELECT = "#cfg-rotation";
const HINT_ID = "cfg-preset-build-hint";

const HINTS = {
  [ASSASSINATION]: `Built for Assassination${NBSP}38/11/2 with two daggers.`,
  [SUBTLETY]: `Built for Subtlety${NBSP}12/8/31 with two daggers.`,
  [COMBAT]: `Built for Combat${NBSP}18/33/0 with two swords, Deadly Poison on the main hand and Instant Poison on the off hand.`,
};

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

async function open(width, { textSize = "100%", address = "#rotation" } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: base,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(address.startsWith("http") ? address : `${base}${address}`);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; } html { font-size: ${textSize} !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  // #talents-live must stay silent: count every change to it.
  await page.evaluate(() => {
    const live = document.getElementById("talents-live");
    globalThis.talentsLiveChanges = 0;
    new globalThis.MutationObserver(() => {
      globalThis.talentsLiveChanges += 1;
    }).observe(live, { childList: true, characterData: true, subtree: true });
  });
  return { context, page, errors };
}

const go = async (page, hash, selector) => {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

const toRotation = (page) => go(page, "#rotation", SELECT);

const text = async (page, selector) =>
  ((await page.locator(selector).textContent()) ?? "")
    .replace(/[ \t\n\r]+/g, " ")
    .trim();

const shot = async (page, name) => {
  if (SHOTS !== null) {
    await page.locator("#rotation-pick").scrollIntoViewIfNeeded();
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
    const { top, bottom, left, right, height } = node.getBoundingClientRect();
    return { top, bottom, left, right, height };
  });

const describedBy = async (page) =>
  ((await page.getAttribute(SELECT, "aria-describedby")) ?? "")
    .split(/\s+/)
    .filter((id) => id !== "");

async function choose(page, id) {
  await toRotation(page);
  await page.selectOption(SELECT, id);
}

async function setField(page, hash, selector, value) {
  await go(page, hash, selector);
  await page.locator(selector).fill(value);
  await page.locator(selector).press("Tab");
}

const setLevel = (page, level) =>
  setField(page, "#character/talents", "#talents-level", level);

async function setSelect(page, hash, selector, value) {
  await go(page, hash, selector);
  await page.selectOption(selector, value);
}

const gear = async (page) => {
  await go(page, "#character/gear", "#cfg-weapons-mainHand-type");
  return page.evaluate(() => {
    const value = (id) => document.getElementById(id).value;
    return {
      mainHand: value("cfg-weapons-mainHand-type"),
      offHand: value("cfg-weapons-offHand-type"),
      mainPoison: value("cfg-poisons-mainHand"),
      offPoison: value("cfg-poisons-offHand"),
    };
  });
};

async function expectHint(page, id) {
  await page.locator(BOX).waitFor({ state: "visible" });
  assert.equal(await text(page, LINK), "Starting point", `${id}: link`);
  assert.equal(
    await page.getAttribute(LINK, "href"),
    "#character/start",
    `${id}: href`,
  );
  assert.equal((await describedBy(page))[0], HINT_ID, `${id}: described`);
}

async function expectNoHint(page, why) {
  await page.waitForFunction(
    (selector) => document.querySelector(selector).hidden,
    BOX,
    { timeout: SETTLE },
  );
  assert.ok(!(await describedBy(page)).includes(HINT_ID), `${why}: described`);
}

describe.skip("A preset's reference build (#273)", () => {
  for (const width of WIDTHS) {
    for (const textSize of TEXT_SIZES) {
      test(`the hint and its Starting point link at ${width}, ${textSize} text`, async () => {
        const { context, page, errors } = await open(width, { textSize });
        const name = `${width}-${textSize.replace("%", "")}`;
        const shoot = SHOT_WIDTHS.includes(width)
          ? (what) => shot(page, `${name}-${what}`)
          : async () => {};
        try {
          // The page's Default rotation has no reference build.
          await toRotation(page);
          assert.equal(await page.locator(BOX).isHidden(), true, "default");
          assert.ok(!(await describedBy(page)).includes(HINT_ID));

          await page.selectOption(SELECT, ASSASSINATION);
          await expectHint(page, ASSASSINATION);
          assert.equal(await text(page, HINT), HINTS[ASSASSINATION]);

          // Placement: under the select, above "What this rotation does".
          const select = await box(page, SELECT);
          const here = await box(page, BOX);
          const summary = await box(page, "#cfg-summary");
          assert.ok(here.top >= select.bottom, `${name}: under the select`);
          assert.ok(here.bottom <= summary.top, `${name}: above the summary`);
          const panel = await box(page, "#rotation-pick");
          assert.ok(here.right <= panel.right + 1, `${name}: in the panel`);
          assert.ok(await fitsPage(page), `${name}: the page fits`);
          const link = await box(page, LINK);
          assert.ok(link.height >= TARGET_LEAST, `${name}: link tall enough`);
          assert.ok(link.right <= panel.right + 1, `${name}: link in panel`);
          await shoot("hint");

          // The longest hint: every part differs and the level is below 60.
          await setLevel(page, LOW_LEVEL);
          await setSelect(
            page,
            "#character/gear",
            "#cfg-poisons-offHand",
            "instant",
          );
          await choose(page, ASSASSINATION);
          await expectHint(page, ASSASSINATION);
          assert.equal(
            await text(page, HINT),
            `Built for Assassination${NBSP}38/11/2 at level${NBSP}60 with two daggers, Instant Poison on the main hand and Deadly Poison on the off hand.`,
          );
          assert.ok(await fitsPage(page), `${name}: long hint fits`);
          await shoot("hint-all-level-40");

          // The link opens the cards, the preset current and Edited.
          await page.locator(LINK).click();
          await page.locator("#start-panel").waitFor({ state: "visible" });
          assert.equal(
            await page.evaluate(() => document.location.hash),
            "#character/start",
          );
          assert.equal(
            await page.getAttribute(
              `#start-card-${ASSASSINATION}`,
              "aria-current",
            ),
            "true",
          );
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }
});

describe.skip("The reference build's hint (#273)", () => {
  test("what differs, after edits", async () => {
    const { context, page, errors } = await open(1024);
    try {
      // Combat swords on the page's swords: the talents and poisons differ.
      await choose(page, COMBAT);
      await expectHint(page, COMBAT);
      assert.equal(await text(page, HINT), HINTS[COMBAT]);
      await choose(page, SUBTLETY);
      await expectHint(page, SUBTLETY);
      assert.equal(await text(page, HINT), HINTS[SUBTLETY]);

      // Its build put in from the cards: no hint, nothing to offer.
      await go(page, "#character/start", `#start-card-${SUBTLETY}`);
      await page.locator(`#start-card-${SUBTLETY}`).click();
      await page.locator("#start-applied").waitFor({ state: "visible" });
      await toRotation(page);
      await expectNoHint(page, "the build matches");
      assert.equal(await page.locator(SELECT).inputValue(), SUBTLETY);

      // A weapon edit brings the hint back; a stat edit does not.
      await setSelect(
        page,
        "#character/gear",
        "#cfg-weapons-mainHand-type",
        "sword",
      );
      await toRotation(page);
      await expectHint(page, SUBTLETY);
      await setSelect(
        page,
        "#character/gear",
        "#cfg-weapons-mainHand-type",
        "dagger",
      );
      const power = Number(
        await (async () => {
          await go(page, "#character/stats", POWER);
          return page.locator(POWER).inputValue();
        })(),
      );
      await setField(
        page,
        "#character/stats",
        POWER,
        String(power + POWER_STEP),
      );
      await toRotation(page);
      await expectNoHint(page, "a stat edit");

      // Default: no hint; the select's description is its own again.
      await page.selectOption(SELECT, "default");
      await expectNoHint(page, "Default");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("imported rotations, and an edited preset", async () => {
    const { context, page, errors } = await open(1024);
    try {
      const paste = async (json) => {
        await go(page, "#rotation/share", "#cfg-import-text");
        await page.fill("#cfg-import-text", json);
        await page.click("#cfg-import-paste");
        await toRotation(page);
        await page.waitForFunction(
          () => document.getElementById("cfg-rotation").value === "imported",
          null,
          { timeout: SETTLE },
        );
      };
      // An import that is not a preset: no hint.
      await paste(
        JSON.stringify({
          schemaVersion: 1,
          name: "Mine",
          rules: [{ action: "sinister-strike", conditions: [] }],
        }),
      );
      await expectNoHint(page, "an import");
      // An import identical to Subtlety is Subtlety.
      await paste(exportRotation(presetRotation(SUBTLETY)));
      await expectHint(page, SUBTLETY);
      assert.equal(await text(page, HINT), HINTS[SUBTLETY]);

      // An edited preset keeps its hint.
      await choose(page, ASSASSINATION);
      await expectHint(page, ASSASSINATION);
      await page.fill("#rb-name", "Assassination, mine");
      await page.locator("#rb-name").press("Tab");
      await page.waitForFunction(
        () =>
          /mine|edited/i.test(
            document.getElementById("cfg-rotation").selectedOptions[0]
              ?.textContent ?? "",
          ),
        null,
        { timeout: SETTLE },
      );
      await expectHint(page, ASSASSINATION);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the share link carries a picked build, under the link cap", async () => {
    const { context, page, errors } = await open(1024, {
      address: "#character",
    });
    try {
      await page.locator(`#start-card-${ASSASSINATION}`).click();
      await page.locator("#start-applied").waitFor({ state: "visible" });
      await page.locator("#share-link-header").click();
      await page.waitForFunction(
        () =>
          /copied/i.test(document.getElementById("run-announce").textContent),
        null,
        { timeout: SETTLE },
      );
      assert.equal(
        await page.locator("#share-too-long-header").isHidden(),
        true,
      );
      const link = await page.evaluate(() =>
        document.defaultView.navigator.clipboard.readText(),
      );
      process.stdout.write(`# full-build link length: ${link.length}\n`);
      assert.ok(link.length <= LINK_CAP, `${link.length}`);
      const opened = await open(1024, { address: link });
      try {
        await toRotation(opened.page);
        assert.equal(
          await opened.page.locator(SELECT).inputValue(),
          ASSASSINATION,
        );
        // The link's build is the reference build: no hint.
        assert.equal(await opened.page.locator(BOX).isHidden(), true);
        assert.equal(
          (await gear(opened.page)).mainHand,
          "dagger",
          "the weapons came with the link",
        );
        assert.deepEqual(opened.errors, []);
      } finally {
        await opened.context.close();
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
