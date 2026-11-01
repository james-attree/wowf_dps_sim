// #273: the preset's reference build under the Rotation select. The hint
// says what the preset is built for; its button ("Use its … too") puts in
// the talents, weapons and poisons that differ, and level 60 below 60; the
// line after says what was set, with Undo. At 320, 360, 1024 and 1440, at
// 100% and 150% text, with DejaVu pinned as CI has it.
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
const RUN_TIMEOUT = 60_000;
const LIVE_SECONDS = "10";
const BATCH_FIGHTS = "5";
const BATCH_SECONDS = "30";
const LOW_LEVEL = "40";
const POWER = "#cfg-character-attackPower";
const POWER_STEP = 10;

const ASSASSINATION = "assassination-daggers";
const SUBTLETY = "subtlety-daggers";
const COMBAT = "combat-swords";
const HINT = "#cfg-preset-build-hint";
const APPLY = "#cfg-preset-build-apply";
const UNDO = "#cfg-preset-build-undo";
const DONE = "#cfg-preset-build-done";
const OFFER = "#cfg-preset-build-offer";
const APPLIED = "#cfg-preset-build-applied";
const BOX = "#cfg-preset-build";
const SELECT = "#cfg-rotation";
const HINT_ID = "cfg-preset-build-hint";

const HINTS = {
  [ASSASSINATION]: `Built for Assassination${NBSP}41/10/0 with two daggers.`,
  [SUBTLETY]: `Built for Subtlety${NBSP}15/0/36 with two daggers.`,
  [COMBAT]: `Built for Combat${NBSP}18/33/0 with two swords.`,
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

const focused = (page) => page.evaluate(() => document.activeElement?.id);

const announced = (page, said) =>
  page.waitForFunction(
    (want) => document.getElementById("run-announce").textContent === want,
    said,
    { timeout: SETTLE },
  );

const talentsLiveChanges = (page) =>
  page.evaluate(() => globalThis.talentsLiveChanges);

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

const level = async (page) => {
  await go(page, "#character/talents", "#talents-level");
  return page.locator("#talents-level").inputValue();
};

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

async function runField(page, id) {
  const field = page.locator(`#${id}`);
  if (!(await field.isVisible())) {
    const toggle = page.locator("#run-settings-toggle");
    if ((await toggle.count()) > 0 && (await toggle.isVisible())) {
      await toggle.click();
    } else {
      await page.locator('[data-nav-area="fight"]').click();
    }
    await field.waitFor({ state: "visible" });
  }
  return field;
}

async function setRunField(page, id, value) {
  const field = await runField(page, id);
  await field.fill(value);
  await field.press("Tab");
}

// Fight settings for a short batch. At 1024 they are on Fight: going
// there closes Undo, so this comes before any apply.
async function shortBatch(page) {
  await (await runField(page, "run-mode-batch")).check();
  await setRunField(page, "run-iterations", BATCH_FIGHTS);
  await setRunField(page, "run-duration", BATCH_SECONDS);
}

// Run from where the page is (the Run bar is on every page).
async function runHere(page) {
  await page.evaluate(() => {
    document.getElementById("results-announce").textContent = "";
  });
  await page.locator("#run-button").click();
  await page.waitForFunction(
    () =>
      /^Average finished/.test(
        document.getElementById("results-announce")?.textContent ?? "",
      ),
    null,
    { timeout: RUN_TIMEOUT },
  );
}

// The amber "Out of date" on the Average card beside the page (1024 up).
const staleSaid = (page) =>
  page.evaluate(() => {
    const node = document.querySelector(".results-card-stale");
    return node === null ? null : node.textContent.replace(/\s+/g, " ").trim();
  });

const isStaleNow = (page) =>
  page
    .waitForFunction(
      () =>
        /^Out of date/.test(
          document.querySelector(".results-card-stale")?.textContent.trim() ??
            "",
        ),
      null,
      { timeout: SETTLE },
    )
    .then(() => true)
    .catch(() => false);

async function expectHint(page, id, label) {
  await page.locator(OFFER).waitFor({ state: "visible" });
  assert.equal(await text(page, APPLY), label, `${id}: label`);
  assert.equal((await describedBy(page))[0], HINT_ID, `${id}: described`);
  assert.equal(
    await page.getByRole("button", { name: label }).count(),
    1,
    `${id}: the button's name starts with its label`,
  );
}

async function expectNoHint(page, why) {
  await page.waitForFunction(
    (selector) => document.querySelector(selector).hidden,
    OFFER,
    { timeout: SETTLE },
  );
  assert.ok(!(await describedBy(page)).includes(HINT_ID), `${why}: described`);
}

const closedUndo = (page, why) =>
  page
    .waitForFunction(
      (selector) => document.querySelector(selector).hidden,
      APPLIED,
      { timeout: SETTLE },
    )
    .catch(() => assert.fail(`${why}: Undo still showing`));

describe("A preset's reference build (#273)", () => {
  for (const width of WIDTHS) {
    for (const textSize of TEXT_SIZES) {
      test(`hint, apply and Undo at ${width}, ${textSize} text`, async () => {
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

          // Assassination: talents and weapons differ from the page's.
          await page.selectOption(SELECT, ASSASSINATION);
          await expectHint(
            page,
            ASSASSINATION,
            "Use its talents and weapons too",
          );
          const hint = await page.locator(HINT).textContent();
          assert.equal(
            hint.replace(/[ \t\n\r]+/g, " ").trim(),
            HINTS[ASSASSINATION],
          );

          // Placement: under the select, above "What this rotation does".
          const select = await box(page, SELECT);
          const here = await box(page, BOX);
          const summary = await box(page, "#cfg-summary");
          assert.ok(here.top >= select.bottom, `${name}: under the select`);
          assert.ok(here.bottom <= summary.top, `${name}: above the summary`);
          assert.equal(
            await page.evaluate(() => {
              const pick = document.getElementById("rotation-pick");
              const order = [
                ...pick.querySelectorAll(
                  "#cfg-rotation, #cfg-preset-build, #cfg-summary",
                ),
              ];
              return order.map((node) => node.id).join(" ");
            }),
            "cfg-rotation cfg-preset-build cfg-summary",
          );
          // It wraps in its panel: nothing wider than the page or the panel.
          const panel = await box(page, "#rotation-pick");
          assert.ok(here.right <= panel.right + 1, `${name}: in the panel`);
          assert.ok(await fitsPage(page), `${name}: the page fits`);
          assert.ok((await box(page, APPLY)).height >= TARGET_LEAST);
          assert.ok((await box(page, APPLY)).right <= panel.right + 1);
          await shoot("hint");

          // Apply: Undo has focus, one announcement, the tree silent.
          const before = await talentsLiveChanges(page);
          await page.locator(APPLY).click();
          await page.locator(APPLIED).waitFor({ state: "visible" });
          assert.equal(await page.locator(OFFER).isHidden(), true);
          assert.equal(
            await text(page, DONE),
            "Talents and weapons set to the Assassination daggers build.",
          );
          assert.equal(await focused(page), "cfg-preset-build-undo");
          assert.ok(
            (await page.getAttribute(UNDO, "aria-label")).startsWith("Undo"),
          );
          assert.equal(
            await page.getAttribute(UNDO, "aria-label"),
            "Undo: put back your talents and weapons",
          );
          await announced(page, "Talents and weapons replaced.");
          assert.ok(!(await describedBy(page)).includes(HINT_ID));
          assert.ok((await box(page, UNDO)).height >= TARGET_LEAST);
          assert.ok(await fitsPage(page), `${name}: applied fits`);
          await shoot("applied");
          assert.equal(await talentsLiveChanges(page), before, "tree silent");

          // Undo: everything back, focus on the button.
          await page.locator(UNDO).click();
          await page.locator(OFFER).waitFor({ state: "visible" });
          assert.equal(await page.locator(APPLIED).isHidden(), true);
          assert.equal(await focused(page), "cfg-preset-build-apply");
          await announced(page, "Talents and weapons put back.");
          assert.equal((await describedBy(page))[0], HINT_ID);
          assert.equal(await talentsLiveChanges(page), before, "tree silent");

          // The longest copy: every part differs and the level is below 60.
          await setLevel(page, LOW_LEVEL);
          await setSelect(
            page,
            "#character/gear",
            "#cfg-poisons-offHand",
            "instant",
          );
          await choose(page, ASSASSINATION);
          await expectHint(
            page,
            ASSASSINATION,
            "Use its talents, weapons and poisons too",
          );
          assert.equal(
            await text(page, HINT),
            `Built for Assassination${NBSP}41/10/0 at level${NBSP}60 with two daggers, Instant Poison on the main hand and Deadly Poison on the off hand.`,
          );
          assert.ok(
            (await page.locator(HINT).textContent()).includes(`level${NBSP}60`),
          );
          assert.ok(await fitsPage(page), `${name}: long hint fits`);
          assert.ok((await box(page, APPLY)).right <= panel.right + 1);
          await shoot("hint-all-level-40");
          await page.locator(APPLY).click();
          await page.locator(APPLIED).waitFor({ state: "visible" });
          assert.equal(
            await text(page, DONE),
            `Talents, weapons and poisons set to the Assassination daggers build. Level set to${NBSP}60.`,
          );
          await announced(
            page,
            `Talents, weapons and poisons replaced. Level set to${NBSP}60.`,
          );
          assert.ok(await fitsPage(page), `${name}: long line fits`);
          assert.ok((await box(page, UNDO)).right <= panel.right + 1);
          await shoot("applied-level-60");
          await page.locator(UNDO).click();
          await page.locator(OFFER).waitFor({ state: "visible" });
          assert.equal(await level(page), LOW_LEVEL);
          assert.equal((await gear(page)).offPoison, "instant");
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }
});

const STATE_WIDTHS = [320, 1024];
const STALE = "Results out of date.";

async function applyNow(page, said) {
  await page.locator(APPLY).click();
  await page.locator(APPLIED).waitFor({ state: "visible" });
  if (said !== undefined) {
    await announced(page, said);
  }
}

describe("The reference build's states (#273)", () => {
  for (const width of STATE_WIDTHS) {
    test(`labels for what differs, and edits after applying, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      try {
        // Combat swords on the page's swords: only the talents differ.
        await choose(page, COMBAT);
        await expectHint(page, COMBAT, "Use its talents too");
        assert.equal(await text(page, HINT), HINTS[COMBAT]);
        await applyNow(page, "Talents replaced.");
        assert.equal(
          await text(page, DONE),
          "Talents set to the Combat swords build.",
        );
        assert.equal(await page.locator(OFFER).isHidden(), true, "matches");

        // Assassination, applied, then a sword in the main hand: Undo
        // closes, and the hint offers the weapons only.
        await choose(page, ASSASSINATION);
        await expectHint(
          page,
          ASSASSINATION,
          "Use its talents and weapons too",
        );
        await applyNow(page);
        await setSelect(
          page,
          "#character/gear",
          "#cfg-weapons-mainHand-type",
          "sword",
        );
        await toRotation(page);
        await closedUndo(page, "a weapon edit");
        await expectHint(page, ASSASSINATION, "Use its weapons too");
        assert.equal((await gear(page)).offHand, "dagger");

        // The weapons back, then Instant on the off hand: the poisons only.
        await toRotation(page);
        await applyNow(page, "Weapons replaced.");
        await setSelect(
          page,
          "#character/gear",
          "#cfg-poisons-offHand",
          "instant",
        );
        await toRotation(page);
        await closedUndo(page, "a poison edit");
        await expectHint(page, ASSASSINATION, "Use its poisons too");
        assert.equal(
          await text(page, HINT),
          `Built for Assassination${NBSP}41/10/0 with two daggers, Instant Poison on the main hand and Deadly Poison on the off hand.`,
        );
        await applyNow(page, "Poisons replaced.");

        // A stat edit is a build edit too: Undo closes, no hint (stats are
        // not compared, nor are weapon numbers).
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
        await setField(
          page,
          "#character/gear",
          "#cfg-weapons-mainHand-speed",
          "1.5",
        );
        await toRotation(page);
        await closedUndo(page, "a stat edit");
        assert.equal(await page.locator(BOX).isHidden(), true, "no hint");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`Undo closes on a rotation change and on leaving the page, at ${width}`, async () => {
      const { context, page, errors } = await open(width);
      try {
        await choose(page, ASSASSINATION);
        await applyNow(page);
        await page.selectOption(SELECT, SUBTLETY);
        await closedUndo(page, "a rotation change");
        await expectHint(page, SUBTLETY, "Use its talents too");
        assert.equal(await text(page, HINT), HINTS[SUBTLETY]);

        await applyNow(page, "Talents replaced.");
        await go(page, "#character", "#area-character-title");
        await toRotation(page);
        await closedUndo(page, "leaving the page");
        assert.equal(await page.locator(BOX).isHidden(), true);

        // Default: no hint; the select's description is its own again.
        await page.selectOption(SELECT, "default");
        await expectNoHint(page, "Default");
        assert.equal(await page.locator(BOX).isHidden(), true);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

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
      await expectHint(page, SUBTLETY, "Use its talents and weapons too");
      assert.equal(await text(page, HINT), HINTS[SUBTLETY]);
      await applyNow(page, "Talents and weapons replaced.");
      await page.locator(UNDO).click();
      await page.locator(OFFER).waitFor({ state: "visible" });

      // An edited preset keeps its hint.
      await choose(page, ASSASSINATION);
      await expectHint(page, ASSASSINATION, "Use its talents and weapons too");
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
      await expectHint(page, ASSASSINATION, "Use its talents and weapons too");
      await applyNow(page, "Talents and weapons replaced.");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the share link carries the applied build, under the link cap", async () => {
    const { context, page, errors } = await open(1024);
    try {
      await choose(page, ASSASSINATION);
      await applyNow(page);
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
      // About 2.5K with the whole build: over 2048 (N10, #306), under the
      // 8 KB cap, so it copies without the too-long line.
      process.stdout.write(`# full-build link length: ${link.length}\n`);
      assert.ok(link.length <= LINK_CAP, `${link.length}`);
      const opened = await open(1024, { address: link });
      try {
        await toRotation(opened.page);
        assert.equal(
          await opened.page.locator(SELECT).inputValue(),
          ASSASSINATION,
        );
        // The link's build is the reference build: nothing to offer.
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

  test("a run in progress, the stale results, and Undo after a run", async () => {
    const { context, page, errors } = await open(1024);
    try {
      await shortBatch(page);
      await choose(page, ASSASSINATION);
      await runHere(page);
      await toRotation(page);
      assert.equal(await staleSaid(page), null, "fresh");

      // Applying after a run: one line, with the results out of date.
      await applyNow(page, `Talents and weapons replaced. ${STALE}`);
      assert.ok(await isStaleNow(page), "amber Out of date");
      assert.equal(await focused(page), "cfg-preset-build-undo");

      // Run moves the page to Results (#242): that is leaving the page,
      // so Undo is gone when Rotation is back, and the build matches.
      await runHere(page);
      assert.equal(await staleSaid(page), null, "fresh with the build");
      await toRotation(page);
      await closedUndo(page, "Run's move to Results");
      assert.equal(await page.locator(BOX).isHidden(), true, "it matches");

      // During a live fight: the button works and the fight goes on; Undo
      // is still there when it has finished, and puts the build back.
      await (await runField(page, "run-mode-live")).check();
      await setRunField(page, "run-duration", LIVE_SECONDS);
      await choose(page, SUBTLETY);
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          /^Running/.test(
            document.getElementById("run-status-text")?.dataset.dock ?? "",
          ),
        null,
        { timeout: SETTLE },
      );
      await toRotation(page);
      await expectHint(page, SUBTLETY, "Use its talents too");
      await page.locator(APPLY).click();
      await page.locator(APPLIED).waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          /^Talents replaced\./.test(
            document.getElementById("run-announce").textContent,
          ),
        null,
        { timeout: SETTLE },
      );
      assert.match(
        await page.evaluate(
          () => document.getElementById("run-status-text").dataset.dock,
        ),
        /^Running/,
        "still running",
      );
      // Finished, and out of date: it ran without the build.
      await page.waitForFunction(
        () =>
          /Out of date/.test(
            document.getElementById("run-status-text")?.dataset.dock ?? "",
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      assert.equal(await page.locator(APPLIED).isVisible(), true, "Undo stays");
      await page.locator(UNDO).click();
      await page.waitForFunction(
        () =>
          /^Talents put back\./.test(
            document.getElementById("run-announce").textContent,
          ),
        null,
        { timeout: SETTLE },
      );
      assert.equal(await focused(page), "cfg-preset-build-apply");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
