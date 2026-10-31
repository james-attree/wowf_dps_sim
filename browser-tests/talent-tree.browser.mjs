// Browser tests for the talent tree (#204, Fran's QA of #208, and the U6
// polish: the narrow run bar's over-cap status). They drive the
// real page in Chrome through playwright-core, so they run apart from
// `npm test`: `npm run test:browser`. Chrome comes from CHROME_PATH, else the
// installed Google Chrome channel (ubuntu-latest ships it).
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [1280, 390];
// The dock, under 64em, counts the talents alone as one issue (Fran's
// #260 re-check, B2b); a wide screen names them.
const DOCK_BELOW = 1024;
// The wide breakpoint (js/views/breakpoints.js) and the dock's strip (#240).
const WIDE_PX = 1024;
const STRIP_PX = 48;

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

// A page at the given width with the talent tree open. Icons come from a CDN;
// every off-box request gets a local icon instead, so a tile keeps a real <img>
// (the node the lost click landed on) and the test needs no network.
async function openTree(width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  const page = await context.newPage();
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) =>
      route.request().resourceType() === "image"
        ? route.fulfill({ status: 200, contentType: "image/jpeg", body: ICON })
        : route.abort(),
  );
  await page.goto(base);
  // Character's Talents row opens its screen (#244, UX6).
  await page.click("#talents-edit");
  await page.locator("#talent-tree").waitFor({ state: "visible" });
  return { context, page };
}

const tile = (page, id) => page.locator(`button.talent[data-id="${id}"]`);
const spent = async (page) =>
  (await page.locator("#talents-points").textContent()).match(/\d+ of \d+/)[0];

// One real mouse click at the tile's centre, which is on its icon <img>.
async function clickCentre(page, id, modifiers = []) {
  const target = tile(page, id);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  for (const key of modifiers) await page.keyboard.up(key);
}

for (const width of WIDTHS) {
  describe(`talent tree in Chrome at ${width}px`, () => {
    let context;
    let page;
    beforeEach(async () => {
      await context?.close();
      ({ context, page } = await openTree(width));
    });
    after(() => context?.close());

    test("one click on an unfocused tile adds a point (1 of N)", async () => {
      const malice = "assassination.malice";
      assert.notEqual(
        await page.evaluate(() => document.activeElement?.dataset?.id),
        malice,
      );
      await clickCentre(page, malice);
      assert.match(await spent(page), /^1 of \d+$/);
      assert.match(await tile(page, malice).getAttribute("aria-label"), /1\/5/);
    });

    test("one Shift-click on an unfocused tile removes a point", async () => {
      const malice = "assassination.malice";
      await clickCentre(page, malice);
      await clickCentre(page, malice);
      // Move focus to another tile so Malice is unfocused again.
      await clickCentre(page, "assassination.remorseless-attacks");
      assert.match(await spent(page), /^3 of \d+$/);
      assert.equal(
        await page.evaluate(() => document.activeElement?.dataset?.id),
        "assassination.remorseless-attacks",
      );
      await clickCentre(page, malice, ["Shift"]);
      assert.match(await spent(page), /^2 of \d+$/);
      assert.match(await tile(page, malice).getAttribute("aria-label"), /1\/5/);
    });

    test("a tile keeps its nodes through a select and a rank change", async () => {
      const malice = "assassination.malice";
      await page.evaluate((id) => {
        const node = document.querySelector(`button.talent[data-id="${id}"]`);
        globalThis.__kids = [...node.children];
      }, malice);
      await clickCentre(page, malice);
      await clickCentre(page, malice);
      const same = await page.evaluate((id) => {
        const node = document.querySelector(`button.talent[data-id="${id}"]`);
        const kids = [...node.children];
        return (
          kids.length === globalThis.__kids.length &&
          kids.every((kid, i) => kid === globalThis.__kids[i])
        );
      }, malice);
      assert.equal(same, true);
    });

    test("over the cap, the run bar shows the whole status and stays compact", async () => {
      await clickCentre(page, "assassination.malice");
      await clickCentre(page, "assassination.malice");
      await page.fill("#talents-level", "10");
      await page.press("#talents-level", "Enter");
      const bar = await page.evaluate(() => {
        const text = document.querySelector("#run-status-text");
        const shown =
          getComputedStyle(text, "::before").content.match(
            /^"(.*)" \/ ""$/,
          )?.[1] ?? text.textContent;
        return {
          shown,
          clipped: text.scrollWidth > text.clientWidth,
          height: document
            .querySelector(".run-row-actions")
            .getBoundingClientRect().height,
          sticky: getComputedStyle(document.querySelector(".run-row-actions"))
            .position,
          reason: document.querySelector("#run-reason").textContent,
          describedBy: document
            .querySelector("#run-button")
            .getAttribute("aria-describedby"),
        };
      });
      // Below the wide breakpoint: the phone dock's strip (#240), fixed and
      // 48 px tall, with the short text in full; wide: the full text in full.
      assert.equal(
        bar.shown,
        width < WIDE_PX
          ? "Talents over cap"
          : "Can't run · Talents over the level cap",
      );
      assert.equal(bar.clipped, false, "no ellipsis");
      if (width < WIDE_PX) {
        assert.equal(bar.sticky, "fixed");
        assert.equal(bar.height, STRIP_PX, `strip is ${bar.height} px`);
      }
      // Screen readers get the full text: Run is described by the reason.
      assert.equal(bar.reason, "Can't run · Talents over the level cap");
      assert.equal(bar.describedBy, "run-reason");
    });

    test("over the cap, Fix the talents opens the tree and focuses Level", async () => {
      await clickCentre(page, "assassination.malice");
      await clickCentre(page, "assassination.malice");
      await page.fill("#talents-level", "10");
      await page.press("#talents-level", "Enter");
      // Leave the tree's screen so the link has to open it again.
      await page.click("#character-back");
      await page.locator("#talent-tree").waitFor({ state: "hidden" });
      assert.equal(
        await page.locator("#run-reason").textContent(),
        "Can't run · Talents over the level cap",
      );
      const link = page.locator("#run-errors-link");
      assert.equal(
        await link.textContent(),
        width < DOCK_BELOW ? "Fix 1 issue" : "Fix the talents",
      );
      await link.click();
      await page.locator("#talent-tree").waitFor({ state: "visible" });
      assert.equal(
        await page.evaluate(() => globalThis.location.hash),
        "#character/talents",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "talents-level",
      );
    });
  });
}

// #200 (Fran's #232 QA, axe label-content-name-mismatch, WCAG 2.5.3): every
// shown tile's accessible name holds its visible text, as words in the same
// order, the way axe compares them (NFKD, so "ⓘ" reads "i"; punctuation and
// parentheticals dropped). Empty, partial, maxed, locked, not-simulated and
// no-DPS tiles all appear, at desktop and narrow widths.
for (const width of [1280, 390, 360]) {
  test(`each talent tile's name holds its visible text at ${width}px (#200)`, async () => {
    const { context, page } = await openTree(width);
    try {
      // Some points: Malice partial (1/5), Remorseless Attacks maxed (2/2).
      await clickCentre(page, "assassination.malice");
      await clickCentre(page, "assassination.remorseless-attacks");
      await clickCentre(page, "assassination.remorseless-attacks");
      // Narrow screens show one tree at a time: every tree is checked
      // (Fran's #233 QA, nit 6; #234), wide ones show all three at once.
      const tabs =
        width < 520 ? ["assassination", "combat", "subtlety"] : [null];
      const tiles = [];
      for (const tab of tabs) {
        if (tab !== null) {
          await page.locator(`#talents-tab-${tab}`).click();
        }
        const shown = await page.evaluate(() => {
          const words = (text) =>
            text
              .normalize("NFKD")
              .replace(/\([^()]*\)/g, "")
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .filter(Boolean);
          const within = (name, label) =>
            label.length === 0 ||
            name.some((_, at) =>
              label.every((word, j) => name[at + j] === word),
            );
          return [...document.querySelectorAll("button.talent")]
            .filter((tile) => tile.getClientRects().length > 0)
            .map((tile) => {
              const visible = tile.innerText.replace(/\s+/g, " ").trim();
              const name = tile.getAttribute("aria-label") ?? "";
              return {
                id: tile.dataset.id,
                visible,
                name,
                ok: within(words(name), words(visible)),
              };
            });
        });
        assert.ok(shown.length >= 17, `tiles shown (${tab}): ${shown.length}`);
        tiles.push(...shown);
      }
      assert.deepEqual(
        tiles.filter((tile) => !tile.ok),
        [],
        "every tile's name holds its visible text",
      );
      const named = (id) => tiles.find((tile) => tile.id === id).name;
      assert.match(named("assassination.malice"), /^Malice, 1\/5\b/);
      // "DPS" as the legend says it, and "ability" before a lock reason
      // (Fran's #233 QA, nits 4 and 5; #234).
      assert.match(named("combat.deflection"), /, no DPS effect$/);
      assert.match(
        named("combat.adrenaline-rush"),
        /^Adrenaline Rush, 0\/1, ability, locked: /,
      );
      // The coverage marks are drawn with empty alt text, not text nodes
      // (nits 2 and 3).
      const marks = await page.evaluate(() =>
        [...document.querySelectorAll(".talent-cov")].map((mark) => ({
          text: mark.textContent,
          content: getComputedStyle(mark, "::before").content,
        })),
      );
      assert.ok(marks.length > 0);
      assert.deepEqual(
        marks.filter((mark) => mark.text !== ""),
        [],
        "no text in a coverage mark",
      );
      assert.deepEqual(
        [...new Set(marks.map((mark) => mark.content))].sort(),
        ['"–" / ""', '"ⓘ" / ""'],
        "each mark's glyph has empty alt text",
      );
      if (process.env.U9_SHOTS) {
        await page.locator("#talent-tree").screenshot({
          path: `${process.env.U9_SHOTS}/talent-tiles-${width}.png`,
        });
      }
    } finally {
      await context.close();
    }
  });
}
