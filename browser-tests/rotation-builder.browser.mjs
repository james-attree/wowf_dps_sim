// Browser tests for the rotation builder (U7, #217; Fran's spec in
// design/u7-rotation-builder/). They drive the real page in Chrome through
// playwright-core, apart from `npm test`: `npm run test:browser`. Chrome
// comes from CHROME_PATH, else the installed Google Chrome channel.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [1280, 390, 360];
const NARROW_BAR_MAX_PX = 64;

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

// A page at the given width with the builder open. Off-box requests (the
// icon CDN) get a local icon, so the test needs no network.
async function openBuilder(width) {
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
  await page.click("#cfg-rotation-edit");
  await page.locator("#rotation-builder").waitFor({ state: "visible" });
  return { context, page, errors };
}

const rules = (page) => page.locator("#rotation-builder li.rule");
const rule = (page, at) => rules(page).nth(at);
const names = (page) =>
  page
    .locator("#rotation-builder .rule-name")
    .evaluateAll((nodes) => nodes.map((node) => node.lastChild.textContent));
const focusedKey = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute("data-key"));

// One real mouse click at the centre of a control.
// Scrolled to the middle of the screen first, so the sticky run bar at
// narrow widths can't sit over it.
async function clickCentre(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await locator.boundingBox();
  await locator
    .page()
    .mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Rule 6 (Eviscerate, if CP >= 5) opened, its value blanked: one error.
async function breakEviscerate(page) {
  await clickCentre(rule(page, 5).locator("[data-key$='.edit']"));
  const value = rule(page, 5).locator("input.cond-value");
  await value.fill("");
  return value;
}

for (const width of WIDTHS) {
  describe(`rotation builder in Chrome at ${width}px`, () => {
    let context;
    let page;
    let errors;
    beforeEach(async () => {
      await context?.close();
      ({ context, page, errors } = await openBuilder(width));
    });
    after(() => context?.close());

    test("opens from Fight setup with the picked rotation's rules", async () => {
      assert.equal(await rules(page).count(), 7);
      assert.equal(
        await page.getAttribute("#cfg-rotation-edit", "aria-expanded"),
        "true",
      );
      assert.deepEqual(errors, []);
    });

    test("one click on Edit conditions opens the rule", async () => {
      const edit = rule(page, 0).locator("[data-key$='.edit']");
      await clickCentre(edit);
      assert.equal(await edit.getAttribute("aria-expanded"), "true");
      await rule(page, 0).locator(".rule-body").waitFor({ state: "visible" });
    });

    test("the keyboard grab moves a rule and keeps focus on it", async () => {
      const before = await names(page);
      await rule(page, 1).locator(".rule-grip").focus();
      await page.keyboard.press("Space");
      assert.equal(
        await rule(page, 1).locator(".rule-grip").getAttribute("aria-pressed"),
        "true",
      );
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Space");
      const now = await names(page);
      assert.deepEqual(now, [before[1], before[0], ...before.slice(2)]);
      assert.match(await focusedKey(page), /\.grip$/);
      assert.equal(
        await page.evaluate(() => document.activeElement.ariaLabel),
        `Reorder rule 1, ${before[1]}`,
      );
      await page.waitForFunction(() =>
        /rule 1 of 7/.test(
          document.querySelector("#rotation-builder .builder-live").textContent,
        ),
      );
      assert.match(
        await page.locator("#cfg-rotation option:checked").textContent(),
        /· Edited$/,
      );
    });

    test("dragging a grip drops the rule where the line is", async () => {
      const before = await names(page);
      const grip = rule(page, 0).locator(".rule-grip");
      await grip.scrollIntoViewIfNeeded();
      const from = await grip.boundingBox();
      const to = await rule(page, 2).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2, to.y + to.height - 4, {
        steps: 8,
      });
      await page.mouse.up();
      assert.deepEqual(await names(page), [
        before[1],
        before[2],
        before[0],
        ...before.slice(3),
      ]);
    });

    test("↑ and ↓ move a rule; focus follows it", async () => {
      const before = await names(page);
      await clickCentre(rule(page, 0).locator("[data-key$='.down']"));
      assert.deepEqual((await names(page)).slice(0, 2), [before[1], before[0]]);
      assert.match(await focusedKey(page), /\.down$/);
    });

    test("an error blocks Run; the Fix link focuses it; fixing it runs", async () => {
      const value = await breakEviscerate(page);
      await value.blur();
      assert.equal(await page.isDisabled("#run-button"), true);
      assert.match(
        await page.locator("#run-status-text").textContent(),
        /Can't run · Rotation has 1 error/,
      );
      // Export is off too, and says why (D17); a press writes no file.
      assert.equal(
        await page.getAttribute("#cfg-export", "aria-disabled"),
        "true",
      );
      assert.equal(
        await page.locator("#cfg-export-why").textContent(),
        "Export is off: the rotation has 1 error.",
      );
      assert.equal(await page.isVisible("#cfg-export-why"), true);
      let downloads = 0;
      page.on("download", () => (downloads += 1));
      await clickCentre(page.locator("#cfg-export"));
      assert.equal(downloads, 0);
      // The summary is closed on a narrow screen; its note is there to open.
      assert.equal(
        await page.getAttribute("#cfg-summary-stale", "hidden"),
        null,
      );
      await page.click("#cfg-rotation-edit");
      assert.equal(await page.isVisible("#rotation-builder"), false);
      await clickCentre(page.locator("#run-errors-link"));
      assert.equal(await page.isVisible("#rotation-builder"), true);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        await value.getAttribute("id"),
      );
      await page.keyboard.type("4");
      assert.equal(await page.isDisabled("#run-button"), false);
      assert.equal(await page.getAttribute("#cfg-summary-stale", "hidden"), "");
      assert.equal(
        await page.getAttribute("#cfg-export", "aria-disabled"),
        null,
      );
      assert.equal(await page.isVisible("#cfg-export-why"), false);
      await page.waitForFunction(
        () =>
          document.querySelector("#rotation-builder .builder-live")
            .textContent === "No errors left.",
      );
    });

    test("a quick fix adds the missing combo point check", async () => {
      await clickCentre(rule(page, 5).locator("[data-key$='.edit']"));
      await clickCentre(rule(page, 5).locator("[data-key$='.rm']").first());
      const fix = rule(page, 5).locator(".fix-button");
      assert.match(await fix.first().textContent(), /CP/);
      await clickCentre(fix.first());
      assert.equal(await rule(page, 5).locator(".fix-button").count(), 0);
      assert.equal(await rule(page, 5).locator(".cond").count(), 1);
    });

    test("switching rotations keeps the draft; revert and undo", async () => {
      const before = await names(page);
      await clickCentre(rule(page, 0).locator("[data-key$='.down']"));
      const edited = await names(page);
      const other = await page
        .locator("#cfg-rotation option")
        .nth(1)
        .getAttribute("value");
      await page.selectOption("#cfg-rotation", other);
      await page.selectOption("#cfg-rotation", "default");
      assert.deepEqual(await names(page), edited);
      await clickCentre(page.locator("[data-key='revert']"));
      assert.deepEqual(await names(page), before);
      await clickCentre(page.locator("[data-key='undo']"));
      assert.deepEqual(await names(page), edited);
    });

    test("a refused import lists readable places, not raw paths (D4, section 5)", async () => {
      await page.evaluate(() => {
        document.querySelector(".paste-import").open = true;
      });
      await page.fill(
        "#cfg-import-text",
        JSON.stringify({
          schemaVersion: 1,
          name: "Bad",
          rules: [
            { action: "blade-flurry", conditions: [] },
            {
              action: "eviscerate",
              conditions: [{ type: "comboPoints", op: ">=", value: 2.5 }],
            },
          ],
        }),
      );
      await clickCentre(page.locator("#cfg-import-paste"));
      const detail = await page
        .locator("#cfg-import-detail-text")
        .textContent();
      assert.match(detail, /^Rule 1: Blade Flurry/m);
      assert.match(detail, /^Rule 2, condition 1: /m);
      assert.doesNotMatch(detail, /rules\[/);
    });

    test("a problem with the whole file reads 'File:' (Fran's P4 on #219)", async () => {
      await page.evaluate(() => {
        document.querySelector(".paste-import").open = true;
      });
      await page.fill(
        "#cfg-import-text",
        JSON.stringify({ schemaVersion: 99, name: "Bad", rules: [] }),
      );
      await clickCentre(page.locator("#cfg-import-paste"));
      const detail = await page
        .locator("#cfg-import-detail-text")
        .textContent();
      assert.match(detail, /^File: /m);
      assert.doesNotMatch(detail, /^schemaVersion:/m);
      await page.fill("#cfg-import-text", "{ nope");
      await clickCentre(page.locator("#cfg-import-paste"));
      assert.match(
        await page.locator("#cfg-import-detail-text").textContent(),
        /^File: /m,
      );
    });

    // Fran's B1 (#218 re-check): every action with an Undo banner puts the
    // focus on its Undo button.
    const onUndo = (page) =>
      page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("data-key") === "undo" &&
          document.activeElement.closest("#rotation-builder") !== null,
      );

    test("Delete focuses Undo", async () => {
      await clickCentre(rule(page, 6).locator("[data-key$='.del']"));
      await onUndo(page);
      assert.equal(await rules(page).count(), 6);
    });

    test("the duplicate warning's Delete rule N focuses Undo", async () => {
      await clickCentre(rule(page, 6).locator("[data-key$='.dup']"));
      assert.equal(await rules(page).count(), 8);
      const fix = rule(page, 7).locator(".fix-button", {
        hasText: "Delete rule 8",
      });
      await clickCentre(fix);
      await onUndo(page);
      assert.equal(await rules(page).count(), 7);
    });

    test("Clear all focuses Undo", async () => {
      await clickCentre(page.locator("[data-key='clear']"));
      await onUndo(page);
      assert.equal(await rules(page).count(), 0);
    });

    test("Revert focuses Undo", async () => {
      await clickCentre(rule(page, 0).locator("[data-key$='.down']"));
      await clickCentre(page.locator("[data-key='revert']"));
      await onUndo(page);
    });

    test("Tab while holding a rule drops it and says so", async () => {
      const grip = rule(page, 1).locator("[data-key$='.grip']");
      await grip.focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");
      await page.waitForFunction(() =>
        / dropped at rule 3 of 7\.$/.test(
          document.querySelector("#rotation-builder .builder-live").textContent,
        ),
      );
      assert.equal(
        await rules(page).locator(".is-lifted, [aria-grabbed='true']").count(),
        0,
      );
    });

    test("no sideways scroll, with an error and with the panel open", async () => {
      await breakEviscerate(page);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 0, `${overflow}px of sideways scroll`);
      if (width < 520) {
        const bar = await page.locator("#run-bar").boundingBox();
        assert.ok(bar.height <= NARROW_BAR_MAX_PX, `bar ${bar.height}px`);
        assert.equal(
          await page.getAttribute("#run-status-text", "data-short"),
          "Can't run · Rotation errors",
        );
      }
      assert.deepEqual(errors, []);
    });
  });
}

// #200 (Kira's #206 QA, c1): the rotation warnings lists below 520px, the
// imported file's "What to check" and the builder's warnings banner, are not
// clipped and the page does not scroll sideways.
for (const width of [390, 360]) {
  test(`the rotation warnings lists fit at ${width}px (#200)`, async () => {
    const { context, page, errors } = await openBuilder(width);
    try {
      // Fits: inside the viewport, nothing wider than its box, no sideways
      // scroll, for the element and each of its children.
      const fits = (selector) =>
        page.evaluate((selector) => {
          const root = document.querySelector(selector);
          const parts = [root, ...root.querySelectorAll("*")].filter(
            (el) => el.getClientRects().length > 0,
          );
          return {
            count: parts.length,
            outside: parts
              .filter((el) => {
                const at = el.getBoundingClientRect();
                return at.left < -1 || at.right > globalThis.innerWidth + 1;
              })
              .map((el) => el.outerHTML.slice(0, 80)),
            clipped: parts
              .filter(
                (el) =>
                  getComputedStyle(el).overflowX !== "visible" &&
                  el.scrollWidth > el.clientWidth + 1,
              )
              .map((el) => el.outerHTML.slice(0, 80)),
            wide:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          };
        }, selector);

      // An imported rotation with warnings: a duplicate rule, a rule that
      // starves the one below, and a finisher with no combo point check.
      await page.evaluate(() => {
        document.querySelector(".paste-import").open = true;
      });
      await page.fill(
        "#cfg-import-text",
        JSON.stringify({
          schemaVersion: 1,
          name: "Warned",
          rules: [
            { action: "sinister-strike", conditions: [] },
            { action: "sinister-strike", conditions: [] },
            { action: "eviscerate", conditions: [] },
          ],
        }),
      );
      await clickCentre(page.locator("#cfg-import-paste"));
      await page.locator("#cfg-import-warnings").waitFor({ state: "visible" });
      await page.evaluate(() => {
        document.querySelector("#cfg-import-warnings").open = true;
      });
      const text = await page.textContent("#cfg-import-warnings-text");
      assert.ok(text.split("\n").filter(Boolean).length >= 2, text);
      const imported = await fits("#cfg-import-warnings");
      assert.ok(imported.count > 1);
      assert.deepEqual(imported.outside, [], "import warnings on the page");
      assert.deepEqual(imported.clipped, [], "import warnings not clipped");
      assert.equal(imported.wide, false, "no sideways scroll (import)");
      if (process.env.U9_SHOTS) {
        await page.locator(".import-box").screenshot({
          path: `${process.env.U9_SHOTS}/import-warnings-${width}.png`,
        });
      }

      // The builder's banner (open since openBuilder): a duplicated rule
      // warns, with its fix links.
      await clickCentre(rule(page, 0).locator("[data-key$='.dup']"));
      await page.locator("#rb-warnings").waitFor({ state: "visible" });
      const banner = await fits("#rb-warnings");
      assert.ok(banner.count > 1);
      assert.deepEqual(banner.outside, [], "builder warnings on the page");
      assert.deepEqual(banner.clipped, [], "builder warnings not clipped");
      assert.equal(banner.wide, false, "no sideways scroll (builder)");
      if (process.env.U9_SHOTS) {
        await page.locator("#rb-warnings").screenshot({
          path: `${process.env.U9_SHOTS}/builder-warnings-${width}.png`,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
