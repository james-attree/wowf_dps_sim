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

// The page's areas (#239): Fight setup's rotation controls are in the
// Character area and the builder in Rotation. The nav moves between them;
// the builder closes on leaving Rotation and opens on coming back.
async function toArea(page, area) {
  await page.click(`[data-nav-area="${area}"]`);
  await page.waitForFunction(
    (shown) =>
      document.querySelector(`[data-area="${shown}"]`)?.hidden === false,
    area,
  );
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
      await toArea(page, "character");
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
      // Leaving Rotation closed the builder.
      assert.equal(await page.isVisible("#rotation-builder"), false);
      await clickCentre(page.locator("#run-errors-link"));
      assert.equal(await page.isVisible("#rotation-builder"), true);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        await value.getAttribute("id"),
      );
      await page.keyboard.type("4");
      assert.equal(await page.isDisabled("#run-button"), false);
      await page.waitForFunction(
        () =>
          document.querySelector("#rotation-builder .builder-live")
            .textContent === "No errors left.",
      );
      await toArea(page, "character");
      assert.equal(await page.getAttribute("#cfg-summary-stale", "hidden"), "");
      assert.equal(
        await page.getAttribute("#cfg-export", "aria-disabled"),
        null,
      );
      assert.equal(await page.isVisible("#cfg-export-why"), false);
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
      await toArea(page, "character");
      await page.selectOption("#cfg-rotation", other);
      await page.selectOption("#cfg-rotation", "default");
      await toArea(page, "rotation");
      assert.deepEqual(await names(page), edited);
      await clickCentre(page.locator("[data-key='revert']"));
      assert.deepEqual(await names(page), before);
      await clickCentre(page.locator("[data-key='undo']"));
      assert.deepEqual(await names(page), edited);
    });

    test("a refused import lists readable places, not raw paths (D4, section 5)", async () => {
      await toArea(page, "character");
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
      await toArea(page, "character");
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

// Fran's #228 QA (nit 1; #234): a Duplicate that brings up the warnings
// banner above the screen scrolls it into view, below the sticky run bar,
// when the focus it moves to the new rule stays on screen too. When the two
// cannot both be on screen the focus wins (WCAG 2.4.11), and the new rule's
// own warning is brought on screen instead.
const DUPLICATED_NEAR = 0;
const DUPLICATED_FAR = 3;
// A screen tall enough for the banner and the new rule's first condition.
const TALL_SCREEN = 1400;
const SCREEN = 900;
for (const width of [1280, 390, 360]) {
  test(`the warnings banner a Duplicate brings up is in view at ${width}px (#234)`, async () => {
    const opened = [];
    try {
      const after = async (at, height) => {
        const { context, page, errors } = await openBuilder(width);
        opened.push({ context, errors });
        await page.setViewportSize({ width, height });
        assert.equal(await page.locator("#rb-warnings").count(), 0);
        await clickCentre(rule(page, at).locator("[data-key$='.dup']"));
        await page.locator("#rb-warnings").waitFor({ state: "visible" });
        await page.evaluate(
          () =>
            new Promise((done) =>
              globalThis.requestAnimationFrame(() => done()),
            ),
        );
        return page.evaluate((at) => {
          const bar = document.querySelector("#run-bar");
          const banner = document.querySelector("#rb-warnings");
          const margin = parseFloat(getComputedStyle(banner).scrollMarginTop);
          const focus = document.activeElement.getBoundingClientRect();
          const card = document.querySelectorAll("#rotation-builder li.rule")[
            at + 1
          ];
          // The new rule's own warning: it is never reached.
          const chip = card.querySelector(".rule-msgs");
          return {
            margin,
            sticky: getComputedStyle(bar).position === "sticky",
            barBottom: bar.getBoundingClientRect().bottom,
            bannerTop: banner.getBoundingClientRect().top,
            focusTop: focus.top,
            focusBottom: focus.bottom,
            chipTop: chip?.getBoundingClientRect().top ?? null,
            key: document.activeElement.getAttribute("data-key"),
            height: globalThis.innerHeight,
          };
        }, at);
      };
      const onScreen = (at, top, bottom = top) =>
        top >= (at.sticky ? at.barBottom : 0) - 1 && bottom <= at.height + 1;

      const near = await after(DUPLICATED_NEAR, TALL_SCREEN);
      assert.ok(near.key !== null, "the focus is on the new rule");
      assert.ok(
        onScreen(near, near.focusTop, near.focusBottom),
        `the focus on screen: ${JSON.stringify(near)}`,
      );
      assert.ok(
        onScreen(near, near.bannerTop),
        `the banner in view below the bar: ${JSON.stringify(near)}`,
      );
      assert.ok(near.bannerTop >= near.margin - 1, "not under the run bar");

      // A rule far below the banner, on a shorter screen.
      const far = await after(DUPLICATED_FAR, SCREEN);
      assert.ok(
        onScreen(far, far.focusTop, far.focusBottom),
        `the focus wins: ${JSON.stringify(far)}`,
      );
      assert.ok(
        far.chipTop !== null && onScreen(far, far.chipTop),
        `the new rule's warning on screen: ${JSON.stringify(far)}`,
      );
      for (const { errors } of opened) {
        assert.deepEqual(errors, []);
      }
    } finally {
      for (const { context } of opened) {
        await context.close();
      }
    }
  });
}

// #200 (Kira's #206 QA, c1): the rotation warnings lists below 520px, the
// imported file's "What to check" and the builder's warnings banner, are not
// clipped and the page does not scroll sideways. Fran's #224 QA (N1): nor
// cut off at the bottom. A box that still scrolls (the "What to check" text
// at its 160px cap on wide screens) must be a focusable, labelled region.
// Fran's #226 QA (1): nor clipped by a box around it, one that hides its
// overflow or caps its height (her mutation E, an import box capped at 100px
// with its overflow hidden, passed before). Fran's #228 QA (nit 2; #234): nor
// by one that contains its paint at a fixed height, nor by a clip-path on it
// or around it.
for (const width of [1280, 390, 360]) {
  test(`the rotation warnings lists fit at ${width}px (#200)`, async () => {
    const { context, page, errors } = await openBuilder(width);
    try {
      // Fits: inside the viewport, nothing wider than its box, no sideways
      // scroll, for the element and each of its children.
      const fits = (selector) =>
        page.evaluate((selector) => {
          const root = document.querySelector(selector);
          root.scrollIntoView({ block: "nearest" });
          const region = (el) =>
            el.tabIndex === 0 &&
            el.getAttribute("role") === "region" &&
            el.hasAttribute("aria-label");
          // Paint containment clips to the box as overflow: hidden does
          // ("strict" and "content" include it).
          const paintContained = (el) =>
            /\b(paint|strict|content)\b/.test(getComputedStyle(el).contain);
          // The boxes around it, up to the page, that can clip it: overflow
          // not visible (hidden, clip, auto or scroll), a max-height, or
          // paint containment.
          const around = [];
          const ancestors = [];
          for (
            let el = root.parentElement;
            el !== null && el !== document.body;
            el = el.parentElement
          ) {
            ancestors.push(el);
            const style = getComputedStyle(el);
            if (
              style.overflowX !== "visible" ||
              style.overflowY !== "visible" ||
              style.maxHeight !== "none" ||
              paintContained(el)
            ) {
              around.push(el);
            }
          }
          const at = root.getBoundingClientRect();
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
            cutOff: parts
              .filter(
                (el) =>
                  getComputedStyle(el).overflowY !== "visible" &&
                  el.scrollHeight > el.clientHeight + 1 &&
                  !region(el),
              )
              .map((el) => el.outerHTML.slice(0, 80)),
            // Its edges inside each box around it that can clip it, and that
            // box not cutting off what it holds (unless it is a region).
            clippedAround: around
              .filter((el) => {
                const box = el.getBoundingClientRect();
                const outside =
                  at.top < box.top - 1 ||
                  at.bottom > box.bottom + 1 ||
                  at.left < box.left - 1 ||
                  at.right > box.right + 1;
                const capped =
                  (getComputedStyle(el).overflowY !== "visible" ||
                    paintContained(el)) &&
                  el.scrollHeight > el.clientHeight + 1 &&
                  !region(el);
                return outside || capped;
              })
              .map((el) => el.outerHTML.slice(0, 80)),
            // A clip-path on it, on a part of it or on a box around it; not
            // a visually hidden one-pixel text for screen readers.
            clipPathed: [...ancestors, ...parts]
              .filter((el) => {
                const { width, height } = el.getBoundingClientRect();
                return (
                  getComputedStyle(el).clipPath !== "none" &&
                  (width > 1 || height > 1)
                );
              })
              .map((el) => el.outerHTML.slice(0, 80)),
            wide:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          };
        }, selector);

      // An imported rotation with warnings: a duplicate rule, a rule that
      // starves the one below, and a finisher with no combo point check.
      await toArea(page, "character");
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
      assert.deepEqual(imported.cutOff, [], "import warnings not cut off");
      assert.deepEqual(
        imported.clippedAround,
        [],
        "import warnings not clipped by a box around them",
      );
      assert.deepEqual(
        imported.clipPathed,
        [],
        "import warnings not clip-pathed",
      );
      // Three warnings fit the box at every width, so it is not a Tab stop
      // (Fran's #226 QA, 2; the region case is the next test), and below
      // 520px it has no height cap, so all of it shows.
      const box = await page.evaluate(() => {
        const pre = document.querySelector("#cfg-import-warnings-text");
        return {
          tabIndex: pre.tabIndex,
          role: pre.getAttribute("role"),
          label: pre.getAttribute("aria-label"),
          maxHeight: getComputedStyle(pre).maxHeight,
          scrolls: pre.scrollHeight > pre.clientHeight + 1,
        };
      });
      assert.equal(box.scrolls, false, "three warnings fit");
      assert.equal(box.tabIndex, -1, "not a Tab stop");
      assert.equal(box.role, null);
      assert.equal(box.label, null);
      if (width < 520) {
        assert.equal(box.maxHeight, "none");
        assert.equal(box.scrolls, false, "all of the text shows");
      }
      assert.equal(imported.wide, false, "no sideways scroll (import)");
      if (process.env.U9_SHOTS) {
        await page.locator(".import-box").screenshot({
          path: `${process.env.U9_SHOTS}/import-warnings-${width}.png`,
        });
      }

      // The builder's banner (open again in Rotation): a duplicated rule
      // warns, with its fix links.
      await toArea(page, "rotation");
      await clickCentre(rule(page, 0).locator("[data-key$='.dup']"));
      await page.locator("#rb-warnings").waitFor({ state: "visible" });
      const banner = await fits("#rb-warnings");
      assert.ok(banner.count > 1);
      assert.deepEqual(banner.outside, [], "builder warnings on the page");
      assert.deepEqual(banner.clipped, [], "builder warnings not clipped");
      assert.deepEqual(banner.cutOff, [], "builder warnings not cut off");
      assert.deepEqual(
        banner.clippedAround,
        [],
        "builder warnings not clipped by a box around them",
      );
      assert.deepEqual(
        banner.clipPathed,
        [],
        "builder warnings not clip-pathed",
      );
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

// #200 (Fran's #226 QA, 2): the "What to check" text is a focusable,
// labelled region only while it scrolls. Many warnings overflow its cap on a
// wide screen; on a narrow one it has no cap, so the same text is not a region,
// and it changes over as the window is resized.
test("the What to check box is a region only while it scrolls (#200)", async () => {
  const { context, page, errors } = await openBuilder(1280);
  try {
    const box = () =>
      page.evaluate(() => {
        const pre = document.querySelector("#cfg-import-warnings-text");
        return {
          scrolls: pre.scrollHeight > pre.clientHeight,
          tabIndex: pre.tabIndex,
          role: pre.getAttribute("role"),
          label: pre.getAttribute("aria-label"),
        };
      });
    const region = { tabIndex: 0, role: "region", label: "What to check" };
    const none = { tabIndex: -1, role: null, label: null };
    await toArea(page, "character");
    await page.evaluate(() => {
      document.querySelector(".paste-import").open = true;
    });
    await page.fill(
      "#cfg-import-text",
      JSON.stringify({
        schemaVersion: 1,
        name: "Many warnings",
        rules: Array.from({ length: 12 }, (_, at) => ({
          action: at % 2 === 0 ? "sinister-strike" : "eviscerate",
          conditions: [],
        })),
      }),
    );
    await clickCentre(page.locator("#cfg-import-paste"));
    await page.locator("#cfg-import-warnings").waitFor({ state: "visible" });
    // Closed, it has no size, so it is not a region; opening it is read.
    await page.evaluate(() => {
      document.querySelector("#cfg-import-warnings").open = false;
    });
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#cfg-import-warnings-text")
          .hasAttribute("role"),
    );
    assert.deepEqual(
      { ...(await box()), scrolls: undefined },
      {
        ...none,
        scrolls: undefined,
      },
    );
    await page.evaluate(() => {
      document.querySelector("#cfg-import-warnings").open = true;
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector("#cfg-import-warnings-text")
          .getAttribute("role") === "region",
    );
    const wide = await box();
    assert.equal(wide.scrolls, true, "many warnings scroll at 1280px");
    assert.deepEqual(
      { ...wide, scrolls: undefined },
      {
        ...region,
        scrolls: undefined,
      },
    );
    if (process.env.U9_SHOTS) {
      await page.locator(".import-box").screenshot({
        path: `${process.env.U9_SHOTS}/import-region-1280.png`,
      });
    }
    // Resizes that leave it a region do not re-set its attributes (Fran's
    // #228 QA, nit 5; #234).
    const resets = await page.evaluate(async () => {
      const pre = document.querySelector("#cfg-import-warnings-text");
      const seen = [];
      const observer = new globalThis.MutationObserver((records) =>
        seen.push(...records.map((record) => record.attributeName)),
      );
      observer.observe(pre, {
        attributes: true,
        attributeFilter: ["tabindex", "role", "aria-label"],
      });
      for (let resize = 0; resize < 3; resize += 1) {
        globalThis.dispatchEvent(new globalThis.Event("resize"));
        await new Promise((done) =>
          globalThis.requestAnimationFrame(() => done()),
        );
      }
      observer.disconnect();
      return seen;
    });
    assert.deepEqual(resets, [], "no attribute re-set on resize");
    // Focused, then the window narrows: no cap, no region, and the focus
    // goes to the box's summary rather than being lost.
    await page.focus("#cfg-import-warnings-text");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#cfg-import-warnings-text")
          .hasAttribute("role"),
    );
    const narrow = await box();
    assert.equal(narrow.scrolls, false, "no cap below 520px");
    assert.deepEqual(
      { ...narrow, scrolls: undefined },
      {
        ...none,
        scrolls: undefined,
      },
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.matches("#cfg-import-warnings > summary"),
      ),
      true,
    );
    // Wide again: a region again.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(
      () =>
        document
          .querySelector("#cfg-import-warnings-text")
          .getAttribute("role") === "region",
    );
    assert.deepEqual(
      { ...(await box()), scrolls: undefined },
      {
        ...region,
        scrolls: undefined,
      },
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// #200 (Fran's #226 QA, 5): after Duplicate, the builder's warnings banner
// scrolled into view lands fully below the sticky run bar, not under it. The
// sticky part is the whole bar at 520px and up, the compact row below.
for (const width of [1280, 390, 360]) {
  test(`the warnings banner scrolls in below the run bar at ${width}px (#200)`, async () => {
    const { context, page, errors } = await openBuilder(width);
    try {
      await clickCentre(rule(page, 0).locator("[data-key$='.dup']"));
      await page.locator("#rb-warnings").waitFor({ state: "visible" });
      // Scrolled past it first, so it comes in from above the bar.
      await page.evaluate(() => {
        globalThis.scrollTo(0, document.documentElement.scrollHeight);
        document
          .querySelector("#rb-warnings")
          .scrollIntoView({ block: "start" });
      });
      await page.waitForTimeout(100);
      const at = await page.evaluate(() => {
        const narrow = globalThis.matchMedia("(max-width: 519.98px)").matches;
        const bar = document.querySelector(
          narrow ? "#run-bar" : "#run-controls",
        );
        const banner = document
          .querySelector("#rb-warnings")
          .getBoundingClientRect();
        return {
          barPosition: getComputedStyle(bar).position,
          barBottom: bar.getBoundingClientRect().bottom,
          top: banner.top,
          bottom: banner.bottom,
          height: banner.height,
          viewport: globalThis.innerHeight,
        };
      });
      assert.equal(at.barPosition, "sticky");
      assert.ok(at.barBottom > 0, JSON.stringify(at));
      assert.ok(at.top >= at.barBottom, JSON.stringify(at));
      if (at.height <= at.viewport - at.barBottom) {
        assert.ok(at.bottom <= at.viewport, JSON.stringify(at));
      }
      if (process.env.U9_SHOTS) {
        await page.screenshot({
          path: `${process.env.U9_SHOTS}/builder-banner-scroll-${width}.png`,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
