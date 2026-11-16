// #318 (Phase 5): Weapon skill on Character › Stats and Target level in
// Fight, next to its "Target:" note (Fran's qa-319 P1), at 320, 360, 1024
// and 1440 wide and 100% and 150% text, with DejaVu pinned as CI has it.
// Blank shows what it gives (the placeholder and the help), a value past the
// engine's bounds is a field error that turns Run off and is counted on the
// screen it is on, and a share link carries a typed value.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import { setupDefaults, shareUrl } from "../js/build-codec.js";

const PINNED_FONT = "DejaVu Sans";
const WIDTHS = [320, 360, 1024, 1440];
const TEXT_SIZES = ["100%", "150%"];
const SCREEN_HEIGHT = 900;
const NB = "\u00A0";
const SKILL = "#cfg-character-weaponSkill";
const TARGET = "#cfg-target-level";
const TYPED_STAYS = "Typed values stay fixed when you change level.";
const TARGET_HELP = `Leave blank for 63 (your level${NB}+${NB}3, a raid boss). From 1 to 63. Higher levels mean more misses and glancing blows. ${TYPED_STAYS}`;
const SUMMARY = "#character-stats-summary";
const STATS_CHIP = "#character-stats-status";
const RUN_SUMMARY = "#run-summary";
const RUN_STATUS = "#run-status-text";
const NOTE = "#fight-target";
const LEVEL = "#talents-level";
const TARGET_ERROR = "Target level must be a whole number from 1 to 63.";
const badge = (area) => `[data-nav-area="${area}"] .area-nav-badge`;
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

async function open(
  width,
  text,
  address = `${base}#character/stats`,
  ready = "#cfg-race",
) {
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
  await page.locator(ready).waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

// Spaces are folded, but a no-break space is kept: the help's formulas
// carry them (qa-319 N2).
const clean = (text) => text.replace(/[ \t\n\r]+/g, " ").trim();
const textOf = async (page, selector) =>
  clean(await page.locator(selector).textContent());

async function enter(page, selector, value) {
  await page.locator(selector).fill(value);
  await page.locator(selector).blur();
}

const go = async (page, hash, selector) => {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

// The Stats row's summary on Character's list: its text, and whether it
// fits its row.
async function summary(page) {
  await go(page, "#character", SUMMARY);
  return page.locator(SUMMARY).evaluate((node) => ({
    text: node.textContent.replace(/\s+/g, " ").trim(),
    fits: node.scrollWidth <= node.clientWidth,
  }));
}

// The field's parts inside its box (the fieldset on Stats, the Fight
// panel's field), none over another, the page not wider than the screen,
// and the help's formula on one line.
async function layout(page, selector) {
  return page.locator(selector).evaluate((input, edge) => {
    const field = input.closest(".field");
    const set = input
      .closest("fieldset, .fight-target-level")
      .getBoundingClientRect();
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
    const help = field.querySelector(".field-help").firstChild;
    const at = help.textContent.search(/level\u00A0[×+]\u00A0\d/);
    const range = document.createRange();
    range.setStart(help, at);
    range.setEnd(help, at + "level × 5".length);
    const lines = new Set(
      [...range.getClientRects()].map((box) => Math.round(box.top)),
    );
    const root = document.documentElement;
    return {
      inside,
      stacked,
      formulaOnOneLine: at >= 0 && lines.size === 1,
      noSideScroll: root.scrollWidth <= root.clientWidth,
      textFits: [...field.querySelectorAll("label, .field-help, .field-error")]
        .filter((node) => !node.hidden)
        .every((node) => node.scrollWidth <= node.clientWidth + edge),
    };
  }, EDGE);
}

const GOOD = {
  inside: true,
  stacked: true,
  formulaOnOneLine: true,
  noSideScroll: true,
  textFits: true,
};

describe("Weapon skill on Character › Stats (#318, #385)", () => {
  test("the typed weapon skill field is gone; a config skill still shows in the summary", async () => {
    const { context, page, errors } = await open(WIDTHS[2], TEXT_SIZES[0]);
    try {
      await go(page, "#character/stats", "#cfg-race");
      assert.equal(await page.locator(SKILL).count(), 0);
      // Target level is Fight's, not Character's (qa-319 P1).
      assert.equal(await page.locator(`#area-character ${TARGET}`).count(), 0);
      await page.goto(`${base}?e2e#character`);
      await page.waitForFunction(() => globalThis.__store != null);
      await page.evaluate(() => {
        const { config } = globalThis.__store.get();
        const next = structuredClone(config);
        next.character = { ...next.character, weaponSkill: 315 };
        globalThis.__store.set({ config: next });
      });
      const stats = (await summary(page)).text;
      assert.match(stats, / · 315 weapon skill$/);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe("Target level in Fight, next to its note (qa-319 P1)", () => {
  for (const width of WIDTHS) {
    for (const text of TEXT_SIZES) {
      test(`blank, errors and layout at ${width} wide, ${text} text`, async () => {
        const { context, page, errors } = await open(
          width,
          text,
          `${base}#fight`,
          TARGET,
        );
        try {
          const target = page.locator(TARGET);
          assert.equal(
            await textOf(page, `label[for="${TARGET.slice(1)}"]`),
            "Target level",
          );
          assert.equal(await page.locator(`#area-fight ${TARGET}`).count(), 1);
          // Under the "Target:" note, in the same settings.
          const place = await page.evaluate(
            ([note, field, edge]) => {
              const a = document.querySelector(note);
              const b = document.querySelector(field).closest(".field");
              const n = a.getBoundingClientRect();
              const f = b.getBoundingClientRect();
              return {
                below: f.top >= n.bottom - edge,
                sameSettings:
                  a.closest("#run-settings") !== null &&
                  a.closest("#run-settings") === b.closest("#run-settings"),
                next: a.nextElementSibling?.contains(b) === true,
                leftAligned: Math.abs(f.left - n.left) <= edge,
              };
            },
            [NOTE, TARGET, EDGE],
          );
          assert.deepEqual(place, {
            below: true,
            sameSettings: true,
            next: true,
            leftAligned: true,
          });
          assert.equal(await target.inputValue(), "");
          assert.equal(await target.getAttribute("placeholder"), "63");
          assert.equal(await target.getAttribute("max"), "63");
          assert.equal(await textOf(page, `${TARGET}-help`), TARGET_HELP);
          assert.deepEqual(await layout(page, TARGET), GOOD, "blank");
          // Scrolled to, nothing (the phone's Run dock) covers it.
          await target.scrollIntoViewIfNeeded();
          assert.equal(
            await target.evaluate((input) => {
              const box = input.getBoundingClientRect();
              const hit = document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
              return hit === input;
            }),
            true,
            "the field is not under the dock",
          );
          assert.doesNotMatch(await textOf(page, RUN_SUMMARY), /target|enemy/i);

          // Past the bounds: the error, Run off, and it is Fight's to fix,
          // not the Stats row's.
          await enter(page, TARGET, "64");
          assert.equal(
            await textOf(page, `${TARGET}-error`),
            `⚠ ${TARGET_ERROR}`,
          );
          assert.equal(await target.getAttribute("aria-invalid"), "true");
          assert.equal(
            await target.getAttribute("aria-describedby"),
            "cfg-target-level-help cfg-target-level-error",
          );
          assert.equal(await page.locator("#run-button").isDisabled(), true);
          assert.deepEqual(await layout(page, TARGET), GOOD, "in error");
          assert.match(await textOf(page, badge("fight")), /^1\b/);
          assert.equal(await page.locator(badge("character")).isHidden(), true);
          await go(page, "#character", SUMMARY);
          assert.equal(await page.locator(STATS_CHIP).isHidden(), true);
          await go(page, "#fight", TARGET);

          // In bounds: the run summary and the Ready line name it, last.
          await enter(page, TARGET, "61");
          assert.equal(await page.locator(`${TARGET}-error`).isHidden(), true);
          assert.equal(await page.locator("#run-button").isDisabled(), false);
          assert.match(
            await textOf(page, RUN_SUMMARY),
            new RegExp(`${NB}· target level${NB}61$`),
          );
          assert.match(
            await textOf(page, RUN_STATUS),
            new RegExp(`^Ready · .*${NB}· target level${NB}61$`),
          );
          // The "·" before it stays on the line before (qa-319 D-N2): the
          // no-break space and the dot are on one line, where the Ready
          // line shows (the wide status; the dock has its own short text).
          if (width >= WIDTHS[2]) {
            const dotLines = await page.locator(RUN_STATUS).evaluate((node) => {
              const textNode = node.firstChild;
              const at = textNode.textContent.indexOf("\u00a0· target");
              const range = document.createRange();
              range.setStart(textNode, at);
              range.setEnd(textNode, at + "\u00a0·".length);
              return at < 0
                ? -1
                : new Set(
                    [...range.getClientRects()].map((box) =>
                      Math.round(box.top),
                    ),
                  ).size;
            });
            assert.equal(dotLines, 1, `${width} ${text}: the dot's line`);
          }
          const root = await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          );
          assert.ok(root, "no side scroll with the summary");
          await enter(page, TARGET, "");
          assert.equal(await target.getAttribute("aria-invalid"), null);
          assert.doesNotMatch(await textOf(page, RUN_SUMMARY), /target/);
          assert.doesNotMatch(await textOf(page, RUN_STATUS), /target/);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  for (const width of [WIDTHS[0], WIDTHS[2]]) {
    test(`the fix links open Fight at the field, ${width} wide`, async () => {
      const { context, page, errors } = await open(
        width,
        TEXT_SIZES[0],
        `${base}#fight`,
        TARGET,
      );
      try {
        await enter(page, TARGET, "64");
        await go(page, "#character/stats", "#cfg-race");
        // The form footer's link.
        const link = page.locator("#cfg-fix-list a", {
          hasText: "Target level",
        });
        await link.click();
        await page.waitForFunction(() => document.location.hash === "#fight");
        await page.waitForFunction(
          (id) => document.activeElement?.id === id,
          TARGET.slice(1),
        );
        // The Run panel's "Fix" link.
        await go(page, "#character/stats", "#cfg-race");
        const fix = page.locator("#run-errors-link");
        if (await fix.isVisible()) {
          await fix.click();
          await page.waitForFunction(() => document.location.hash === "#fight");
          await page.waitForFunction(
            (id) => document.activeElement?.id === id,
            TARGET.slice(1),
          );
        }
        await page.locator(TARGET).waitFor({ state: "visible" });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe("Weapon skill and Target level together (#318, #385)", () => {
  test("a typed target level stays through a level change; gear builds block Run under 60", async () => {
    const { context, page, errors } = await open(WIDTHS[2], TEXT_SIZES[0]);
    try {
      await go(page, "#fight", TARGET);
      await enter(page, TARGET, "62");
      const setLevel = async (level) => {
        await go(page, "#character/talents", LEVEL);
        if (level === "40") {
          await page.locator("#talents-reset").click();
          await page.waitForFunction(() =>
            /\b0 of \d+/.test(
              document.querySelector("#talents-points")?.textContent ?? "",
            ),
          );
        }
        await enter(page, LEVEL, level);
      };
      await setLevel("40");
      // A gear build cannot run under 60 (coordinator call 16 Nov,
      // James delegated). A typed target level stays.
      assert.equal(await page.locator("#run-button").isDisabled(), true);
      await go(page, "#fight", TARGET);
      assert.equal(await page.locator(TARGET).inputValue(), "62");
      await setLevel("60");
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      await go(page, "#fight", TARGET);
      assert.equal(await page.locator(TARGET).inputValue(), "62");
      assert.match(
        await textOf(page, RUN_SUMMARY),
        new RegExp(`${NB}· target level${NB}62$`),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("a share link carries a config weapon skill and a typed target level", async () => {
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
      assert.equal(await page.locator(SKILL).count(), 0);
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      assert.match((await summary(page)).text, / · 315 weapon skill$/);
      await go(page, "#fight", TARGET);
      assert.equal(await page.locator(TARGET).inputValue(), "62");
      assert.match(
        await textOf(page, RUN_SUMMARY),
        new RegExp(`${NB}· target level${NB}62$`),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Copy link carries a typed target level to a new page", async () => {
    const { context, page, errors } = await open(WIDTHS[2], TEXT_SIZES[0]);
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: base,
      });
      await go(page, "#fight", TARGET);
      await enter(page, TARGET, "61");
      await page.locator("#share-link-header").click();
      await page.waitForFunction(
        () => document.getElementById("run-announce").textContent !== "",
      );
      const link = await page.evaluate(() =>
        document.defaultView.navigator.clipboard.readText(),
      );
      const fresh = await context.newPage();
      fresh.on("pageerror", (error) => errors.push(error.message));
      await fresh.goto(`${link}#fight`);
      await fresh.locator(TARGET).waitFor({ state: "visible" });
      assert.equal(await fresh.locator(TARGET).inputValue(), "61");
      assert.match(
        await textOf(fresh, RUN_SUMMARY),
        new RegExp(`${NB}· target level${NB}61$`),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
