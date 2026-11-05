// TR-02 / #332: whole file skipped — empty presets until #333
// #326 (Phase 5): the launch polish from #287, on the page, at 100% and
// 150% text and 320 to 1440 wide, with DejaVu pinned as CI has it. The
// copy and models are test/launch-polish-326.test.js's.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const PINNED_FONT = "DejaVu Sans";
const TEXT_SIZES = ["100%", "150%"];
const NARROW = [320, 360, 390];
const WIDE = [1024, 1440];
const SCREEN_HEIGHT = 900;
const SKILL = "#cfg-character-weaponSkill";
const TARGET = "#cfg-target-level";
const DURATION = "#run-duration";
const SPEED = "#cfg-weapons-mainHand-speed";
const ANNOUNCER = "#run-announce";
const SETUP_KEY = "wowf_dps_sim.setup";
const MOST_COLUMNS = 2;
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
  address,
  { context: options = {}, init } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    ...options,
  });
  if (init) {
    await context.addInitScript(init.script, init.arg);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${address}`);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }
      html { font-size: ${text} !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

async function done({ context, errors }) {
  await context.close();
  assert.deepEqual(errors, []);
}

const clean = (text) => text.replace(/\s+/g, " ").trim();
const textOf = async (page, selector) =>
  clean(await page.locator(selector).textContent());

async function enter(page, selector, value) {
  await page.locator(selector).fill(value);
  await page.locator(selector).blur();
}

async function go(page, hash) {
  await page.evaluate((to) => {
    globalThis.location.hash = to;
  }, hash);
  await page.locator(`#area-${hash.slice(1).split("/")[0]}-title`).waitFor();
}

function listen(page) {
  return page.evaluate((selector) => {
    globalThis.said = [];
    const node = document.querySelector(selector);
    new globalThis.MutationObserver(() => {
      if (node.textContent) {
        globalThis.said.push(node.textContent);
      }
    }).observe(node, { childList: true, characterData: true, subtree: true });
  }, ANNOUNCER);
}

const savedWith = (payload) => ({
  script: ([key, text]) => {
    if (!globalThis.sessionStorage.getItem("seeded")) {
      globalThis.localStorage.setItem(key, text);
      globalThis.sessionStorage.setItem("seeded", "1");
    }
  },
  arg: [
    SETUP_KEY,
    `1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`,
  ],
});

describe.skip("#326 item 1: a touch Fix shows its field above the dock", () => {
  for (const text of TEXT_SIZES) {
    for (const [field, area, value] of [
      [SKILL, "#character/stats", "351"],
      [TARGET, "#fight", "64"],
    ]) {
      test(`${field} at 320 wide, ${text} text`, async () => {
        const session = await open(320, text, area, {
          context: { hasTouch: true, isMobile: true },
        });
        const { page } = session;
        await enter(page, field, value);
        await go(page, "#character/stats");
        await page.locator("#run-errors-link").tap();
        await page.waitForFunction(
          (id) => document.activeElement?.id === id,
          field.slice(1),
        );
        await page.waitForTimeout(500);
        const box = await page.evaluate((id) => {
          const error = document.getElementById(`${id}-error`);
          const dock = document.getElementById("run-bar");
          return {
            bottom: error.getBoundingClientRect().bottom,
            dock: dock.getBoundingClientRect().top,
            top: error.getBoundingClientRect().top,
          };
        }, field.slice(1));
        assert.ok(box.top >= -EDGE, `error starts on screen: ${box.top}`);
        assert.ok(
          box.bottom <= box.dock + EDGE,
          `error ${box.bottom} over the dock at ${box.dock}`,
        );
        await done(session);
      });
    }
  }
});

describe.skip("#326 item 2: the area labels keep to one line with a badge", () => {
  for (const width of NARROW) {
    for (const text of TEXT_SIZES) {
      test(`${width} wide, ${text} text`, async () => {
        const session = await open(width, text, "#character/stats");
        const { page } = session;
        await enter(page, SKILL, "351");
        await page.locator(".area-nav-badge:not([hidden])").first().waitFor();
        const labels = await page.$$eval(".area-nav-label", (all) =>
          all.map((label) => ({
            text: label.textContent,
            lines:
              label.getBoundingClientRect().height /
              parseFloat(getComputedStyle(label).lineHeight),
          })),
        );
        for (const label of labels) {
          assert.ok(label.lines < 1.5, `${label.text}: ${label.lines} lines`);
        }
        await done(session);
      });
    }
  }
});

describe.skip("#326 item 3: the fix list keeps the Fight's target last", () => {
  test("stats, gear, run fields, then the target", async () => {
    const session = await open(1024, "100%", "#character/stats");
    const { page } = session;
    await enter(page, SKILL, "351");
    await go(page, "#fight");
    await enter(page, TARGET, "64");
    await enter(page, DURATION, "0");
    await go(page, "#character/gear");
    await enter(page, SPEED, "0");
    const links = (await page.locator("#cfg-fix-list a").allTextContents()).map(
      clean,
    );
    assert.deepEqual(links, [
      "Weapon skill",
      "Main hand, Speed",
      "Fight, Fight length",
      "Fight, Target level",
    ]);
    await done(session);
  });
});

describe.skip("#326 item 4: the preset cards are never three and one", () => {
  for (const width of WIDE) {
    for (const text of TEXT_SIZES) {
      test(`${width} wide, ${text} text`, async () => {
        const session = await open(width, text, "#character/start");
        const { page } = session;
        await page.locator(".start-cards").waitFor();
        const columns = await page.$eval(
          ".start-cards",
          (cards) =>
            getComputedStyle(cards).gridTemplateColumns.split(" ").length,
        );
        assert.ok(columns <= MOST_COLUMNS, `${columns} across`);
        await done(session);
      });
    }
  }
});

describe.skip("#326 items 5 and 8: Reset and Undo, both values, and focus", () => {
  for (const text of TEXT_SIZES) {
    test(`${text} text`, async () => {
      const session = await open(1024, text, "#fight");
      const { page } = session;
      await enter(page, DURATION, "120");
      await enter(page, TARGET, "62");
      await go(page, "#character");
      await page.locator("#cfg-reset").click();
      const values = () =>
        page.evaluate(
          ([duration, target]) => [
            document.querySelector(duration).value,
            document.querySelector(target).value,
          ],
          [DURATION, TARGET],
        );
      const reset = await values();
      assert.notEqual(reset[0], "120");
      assert.notEqual(reset[1], "62");
      await page.locator("#cfg-undo").focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => document.activeElement?.id === "cfg-reset",
      );
      assert.deepEqual(await values(), ["120", "62"]);
      await done(session);
    });
  }
});

describe.skip("#326 item 7: a first pick names the whole build, a re-pick what changed", () => {
  test("the line, and the announcement the same", async () => {
    const session = await open(1024, "100%", "#character/start");
    const { page } = session;
    await listen(page);
    const pick = async () => {
      await page.locator("#start-card-assassination-daggers").click();
      await page.locator("#start-applied").waitFor({ state: "visible" });
      const line = await textOf(page, "#start-done");
      await page.waitForFunction(
        (want) => globalThis.said.at(-1) === want,
        line,
      );
      return line;
    };
    assert.equal(
      await pick(),
      "Assassination set: talents 38/11/2, two daggers, Instant and Deadly poisons and its rotation. Your stats and race are unchanged.",
    );
    await go(page, "#character/gear");
    await enter(page, SPEED, "2.9");
    await go(page, "#character/start");
    assert.equal(
      await pick(),
      "Assassination set: two daggers. Your stats and race are unchanged.",
    );
    await done(session);
  });
});

describe.skip("#326 items 9 to 12: Copy link", () => {
  test("item 9: over the level's cap says why, by the button", async () => {
    const session = await open(1024, "100%", "#character/talents");
    const { page } = session;
    for (let i = 0; i < 2; i += 1) {
      await page
        .locator('button.talent[data-id="assassination.malice"]')
        .click();
    }
    await page.locator("#talents-level").fill("10");
    await page.locator("#talents-level").press("Enter");
    await page.locator("#share-link-header").click();
    const note = page.locator("#share-over-cap-header");
    await note.waitFor({ state: "visible" });
    assert.equal(
      await textOf(page, "#share-over-cap-header"),
      "Your talents are over the level's cap, so the link would share an older build. Fix them in Talents first.",
    );
    assert.match(
      await page.locator("#share-link-header").getAttribute("aria-describedby"),
      /share-over-cap-header/,
    );
    await done(session);
  });

  // Fran's qa-327 P1: the note and what it said go once the talents are
  // within the cap, whichever area makes them so, and stay gone on Fight.
  const overCapNote = async (page) => {
    await go(page, "#character/talents");
    for (let i = 0; i < 2; i += 1) {
      await page
        .locator('button.talent[data-id="assassination.malice"]')
        .click();
    }
    await page.locator("#talents-level").fill("10");
    await page.locator("#talents-level").press("Enter");
    await page.locator("#share-link-header").click();
    await page.locator("#share-over-cap-header").waitFor({ state: "visible" });
    await page.waitForFunction(
      (selector) =>
        /over the level's cap/.test(
          document.querySelector(selector).textContent,
        ),
      ANNOUNCER,
    );
  };
  const gone = async (page) => {
    await page.locator("#share-over-cap-header").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#share-feedback-header").isHidden(), true);
    assert.doesNotMatch(
      await page.locator(ANNOUNCER).textContent(),
      /over the level's cap/,
    );
  };

  test("item 9: the note goes when the level is back to 60, and stays gone on Fight", async () => {
    const session = await open(1280, "100%", "#character/talents");
    const { page } = session;
    await overCapNote(page);
    await page.locator("#talents-level").fill("60");
    await page.locator("#talents-level").press("Enter");
    await gone(page);
    await go(page, "#fight");
    assert.equal(await page.locator("#share-over-cap-header").isHidden(), true);
    await done(session);
  });

  test("item 9: the note goes when a card from Character fixes the talents", async () => {
    const session = await open(1280, "100%", "#character/talents");
    const { page } = session;
    await overCapNote(page);
    await go(page, "#fight");
    assert.equal(
      await page.locator("#share-over-cap-header").isVisible(),
      true,
      "still over the cap: still shown",
    );
    await go(page, "#character/start");
    await page.locator("#start-card-combat-swords").click();
    await gone(page);
    await done(session);
  });

  test("item 10: Dismiss puts focus on the area's title", async () => {
    const session = await open(1024, "100%", "?s=1.e30#character");
    const { page } = session;
    await page.locator("#share-banner-close").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.activeElement?.id === "area-character-title",
    );
    assert.equal(await page.locator("#share-banner").isHidden(), true);
    await done(session);
  });

  for (const text of TEXT_SIZES) {
    test(`item 11: the fallback's label, 320 wide, ${text} text`, async () => {
      const session = await open(320, text, "#character", {
        init: {
          script: () =>
            Object.defineProperty(globalThis.navigator, "clipboard", {
              value: undefined,
              configurable: true,
            }),
        },
      });
      const { page } = session;
      await page.locator("#share-link-header").click();
      await page.locator("#share-fallback-header").waitFor();
      assert.equal(
        await textOf(page, "#share-fallback-header label"),
        "Couldn't copy automatically. Copy this link:",
      );
      await done(session);
    });
  }

  test("item 12: copying again while it says Copied says it once", async () => {
    const session = await open(1024, "100%", "#character", {
      context: { permissions: ["clipboard-read", "clipboard-write"] },
    });
    const { page } = session;
    await listen(page);
    const button = page.locator("#share-link-header");
    for (let i = 0; i < 3; i += 1) {
      await button.click();
    }
    await page.waitForFunction(() => globalThis.said.length > 0);
    const said = await page.evaluate(() => globalThis.said);
    assert.equal(
      said.filter((line) => /copied/i.test(line)).length,
      1,
      said.join(" | "),
    );
    await done(session);
  });
});

describe.skip("#326 item 13: a save's unreadable field is named", () => {
  test("an armour of -1 keeps the level and says the armour reset", async () => {
    const session = await open(1024, "100%", "#fight", {
      init: savedWith({ config: { target: { level: 62, armor: -1 } } }),
    });
    const { page } = session;
    await page.locator("#share-banner").waitFor({ state: "visible" });
    assert.equal(
      await textOf(page, "#share-banner-text"),
      "Part of your saved setup couldn't be read, so the target's armour is back to its default.",
    );
    assert.equal(await page.locator(TARGET).inputValue(), "62");
    await done(session);
  });

  // Fran's qa-327 P2: each stat named, and only what was reset.
  test("an attack power of -5 alone is named, the weapon skill kept", async () => {
    const session = await open(1024, "100%", "#character/stats", {
      init: savedWith({
        config: { character: { attackPower: -5, weaponSkill: 305 } },
      }),
    });
    const { page } = session;
    await page.locator("#share-banner").waitFor({ state: "visible" });
    assert.equal(
      await textOf(page, "#share-banner-text"),
      "Part of your saved setup couldn't be read, so the attack power is back to its default.",
    );
    assert.equal(await page.locator(SKILL).inputValue(), "305");
    await done(session);
  });

  test("two bad fields and a bad run field: those three, no more", async () => {
    const session = await open(1024, "100%", "#fight", {
      init: savedWith({
        config: {
          target: { level: 62, armor: -1 },
          character: { attackPower: 900, weaponSkill: "x" },
        },
        run: { duration: 0, iterations: 300 },
      }),
    });
    const { page } = session;
    await page.locator("#share-banner").waitFor({ state: "visible" });
    assert.equal(
      await textOf(page, "#share-banner-text"),
      "Part of your saved setup couldn't be read, so the weapon skill, the target's armour and the fight length are back to their defaults.",
    );
    assert.equal(await page.locator(TARGET).inputValue(), "62");
    assert.equal(await page.locator("#run-iterations").inputValue(), "300");
    assert.equal(
      await page.locator("#cfg-character-attackPower").inputValue(),
      "900",
    );
    await done(session);
  });

  test("a good save shows no banner", async () => {
    const session = await open(1024, "100%", "#fight", {
      init: savedWith({ config: { target: { level: 62 } } }),
    });
    const { page } = session;
    assert.equal(await page.locator(TARGET).inputValue(), "62");
    assert.equal(await page.locator("#share-banner").isHidden(), true);
    await done(session);
  });
});

describe.skip("#326 item 14: a racial the race can't cast shows in its rule", () => {
  for (const width of [320, 1024]) {
    test(`Combat's rule 1 at ${width} wide`, async () => {
      const session = await open(width, "100%", "#rotation");
      const { page } = session;
      await page.selectOption("#cfg-rotation", "combat-swords");
      await go(page, "#rotation/rule/1");
      const select = page.locator(".rule-action select");
      await select.waitFor();
      const shown = await select.evaluate((node) => ({
        value: node.value,
        text: node.selectedOptions[0]?.textContent,
        disabled: node.selectedOptions[0]?.disabled,
      }));
      assert.deepEqual(shown, {
        value: "blood-fury",
        text: "Blood Fury (Orc racial)",
        disabled: true,
      });
      await done(session);
    });
  }
});

describe.skip("#326 item 15: Touch of the Grave, and the fold on a new race", () => {
  for (const text of TEXT_SIZES) {
    test(`320 wide, ${text} text`, async () => {
      const session = await open(320, text, "#character/stats");
      const { page } = session;
      await page.locator("#cfg-race").selectOption("undead");
      await page.locator("#cfg-race-racials-more-summary").click();
      assert.equal(
        await page.locator("#cfg-race-racials-more").evaluate((d) => d.open),
        true,
      );
      const line = await page.$$eval(
        ".race-racial",
        (all) =>
          all
            .find((item) => /Touch of the Grave/.test(item.textContent))
            ?.querySelector(".race-racial-line")?.textContent,
      );
      assert.match(clean(line), /which the simulator doesn't model\.$/);
      const indent = await page.$eval("#cfg-race-racials-more-list", (list) =>
        parseFloat(getComputedStyle(list).paddingInlineStart),
      );
      assert.ok(indent > 0, "the folded list is set in");
      await page.locator("#cfg-race").selectOption("troll");
      await page.waitForFunction(
        () => !document.getElementById("cfg-race-racials-more").open,
      );
      await done(session);
    });
  }
});
