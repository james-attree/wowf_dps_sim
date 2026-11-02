// #318 (Phase 5): Weapon skill and Enemy level on Character › Stats, at
// 320, 360, 1024 and 1440 wide and 100% and 150% text, with DejaVu pinned as
// CI has it. Blank shows what it gives (the placeholder and the help), a
// value past the engine's bounds is a field error that turns Run off, and a
// share link carries a typed value.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import { setupDefaults, shareUrl } from "../js/build-codec.js";

const PINNED_FONT = "DejaVu Sans";
const WIDTHS = [320, 360, 1024, 1440];
const TEXT_SIZES = ["100%", "150%"];
const SCREEN_HEIGHT = 900;
const SKILL = "#cfg-character-weaponSkill";
const ENEMY = "#cfg-target-level";
const SKILL_HELP =
  "Leave blank for 300 (your level × 5). At most 350 at level 60.";
const ENEMY_HELP = "Leave blank for 63 (your level + 3). From 1 to 63.";
const SKILL_ERROR =
  "Weapon skill must be a whole number from 1 to 350 at level 60.";
const ENEMY_ERROR = "Enemy level must be a whole number from 1 to 63.";
// Rounding slack for a box edge, not a layout allowance.
const EDGE = 1;

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

async function open(width, text, address = `${base}#character/stats`) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(address);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }
      html { font-size: ${text} !important; }`,
  });
  await page.locator(SKILL).waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

const clean = (text) => text.replace(/\s+/g, " ").trim();

async function enter(page, selector, value) {
  await page.locator(selector).fill(value);
  await page.locator(selector).blur();
}

// The field's parts inside its fieldset, none over another, and the page
// not wider than the screen.
async function layout(page, selector) {
  return page.locator(selector).evaluate((input, edge) => {
    const field = input.closest(".field");
    const set = input.closest("fieldset").getBoundingClientRect();
    const parts = [
      field.querySelector("label"),
      input,
      ...field.querySelectorAll(".field-help, .field-error:not([hidden])"),
    ].map((node) => node.getBoundingClientRect());
    const inside = parts.every(
      (box) =>
        box.left >= set.left - edge &&
        box.right <= set.right + edge &&
        box.width > 0,
    );
    const stacked = parts.every(
      (box, i) => i === 0 || box.top >= parts[i - 1].bottom - edge,
    );
    const root = document.documentElement;
    return {
      inside,
      stacked,
      noSideScroll: root.scrollWidth <= root.clientWidth,
      textFits: [...field.querySelectorAll("label, .field-help, .field-error")]
        .filter((node) => !node.hidden)
        .every((node) => node.scrollWidth <= node.clientWidth + edge),
    };
  }, EDGE);
}

describe("Weapon skill and Enemy level on Character › Stats (#318)", () => {
  for (const width of WIDTHS) {
    for (const text of TEXT_SIZES) {
      test(`blank, errors and layout at ${width} wide, ${text} text`, async () => {
        const { context, page, errors } = await open(width, text);
        try {
          const skill = page.locator(SKILL);
          const enemy = page.locator(ENEMY);
          await enemy.waitFor({ state: "visible" });
          assert.equal(
            clean(
              await page
                .locator(`label[for="${SKILL.slice(1)}"]`)
                .textContent(),
            ),
            "Weapon skill",
          );
          assert.equal(
            clean(
              await page
                .locator(`label[for="${ENEMY.slice(1)}"]`)
                .textContent(),
            ),
            "Enemy level",
          );
          // Blank shows the value it gives.
          assert.equal(await skill.inputValue(), "");
          assert.equal(await enemy.inputValue(), "");
          assert.equal(await skill.getAttribute("placeholder"), "300");
          assert.equal(await enemy.getAttribute("placeholder"), "63");
          assert.equal(await skill.getAttribute("max"), "350");
          assert.equal(await enemy.getAttribute("max"), "63");
          assert.equal(
            clean(await page.locator(`${SKILL}-help`).textContent()),
            SKILL_HELP,
          );
          assert.equal(
            clean(await page.locator(`${ENEMY}-help`).textContent()),
            ENEMY_HELP,
          );
          assert.equal(
            await skill.getAttribute("aria-describedby"),
            "cfg-character-weaponSkill-help",
          );
          for (const selector of [SKILL, ENEMY]) {
            assert.deepEqual(
              await layout(page, selector),
              {
                inside: true,
                stacked: true,
                noSideScroll: true,
                textFits: true,
              },
              `${selector} blank`,
            );
          }

          // Past the bounds: the form's error style, and Run is off.
          await enter(page, SKILL, "351");
          await enter(page, ENEMY, "64");
          assert.equal(
            clean(await page.locator(`${SKILL}-error`).textContent()),
            `⚠ ${SKILL_ERROR}`,
          );
          assert.equal(
            clean(await page.locator(`${ENEMY}-error`).textContent()),
            `⚠ ${ENEMY_ERROR}`,
          );
          assert.equal(await skill.getAttribute("aria-invalid"), "true");
          assert.equal(
            await enemy.getAttribute("aria-describedby"),
            "cfg-target-level-help cfg-target-level-error",
          );
          assert.equal(await page.locator("#run-button").isDisabled(), true);
          const fixes = (
            await page.locator("#cfg-fix-list a").allTextContents()
          ).map(clean);
          assert.ok(
            fixes.some((line) => line.startsWith("Weapon skill")),
            fixes.join(" | "),
          );
          assert.ok(
            fixes.some((line) => line.startsWith("Enemy level")),
            fixes.join(" | "),
          );
          for (const selector of [SKILL, ENEMY]) {
            assert.deepEqual(
              await layout(page, selector),
              {
                inside: true,
                stacked: true,
                noSideScroll: true,
                textFits: true,
              },
              `${selector} in error`,
            );
          }

          // Text that is not a number is not blank.
          await skill.focus();
          await skill.fill("");
          await page.keyboard.type("e");
          await skill.blur();
          assert.equal(
            clean(await page.locator(`${SKILL}-error`).textContent()),
            "⚠ Enter a number, or leave it blank.",
          );

          // In bounds, then blank again: no errors, Run is back.
          await enter(page, SKILL, "320");
          await enter(page, ENEMY, "61");
          assert.equal(await page.locator(`${SKILL}-error`).isHidden(), true);
          assert.equal(await page.locator(`${ENEMY}-error`).isHidden(), true);
          assert.equal(await page.locator("#run-button").isDisabled(), false);
          await enter(page, SKILL, "");
          await enter(page, ENEMY, "");
          assert.equal(await page.locator(`${SKILL}-error`).isHidden(), true);
          assert.equal(await skill.getAttribute("aria-invalid"), null);
          assert.equal(await page.locator("#run-button").isDisabled(), false);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  test("a share link fills both fields", async () => {
    const d = setupDefaults();
    const address = shareUrl(`${base}#character/stats`, {
      ...d,
      config: {
        ...d.config,
        character: { ...d.config.character, weaponSkill: 315 },
        target: { ...d.config.target, level: 62 },
      },
    });
    const { context, page, errors } = await open(
      WIDTHS[2],
      TEXT_SIZES[0],
      `${address}#character/stats`,
    );
    try {
      assert.equal(await page.locator(SKILL).inputValue(), "315");
      assert.equal(await page.locator(ENEMY).inputValue(), "62");
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
