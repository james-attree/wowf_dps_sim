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
// The phone dock's strip (#240), below the wide breakpoint.
const STRIP_PX = 48;
const WIDE_PX = 1024;

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

// Rotation's screens (#243, UX5): the list, a rule's screen and Export or
// import, each a route. A rule is edited on its own screen.
const screenShown = (page, hash) =>
  page.waitForFunction((hash) => globalThis.location.hash === hash, hash);
async function openRule(page, at) {
  await clickCentre(rule(page, at).locator("[data-key$='.edit']"));
  await screenShown(page, `#rotation/rule/${at + 1}`);
  await page.locator("#rotation-builder .rule-screen").waitFor();
  return page.locator("#rotation-builder .rule-screen");
}
async function openShare(page) {
  if (!(await page.isVisible("#rotation-builder"))) {
    await toArea(page, "rotation");
  }
  if (await page.isVisible("#rotation-back")) {
    const hash = await page.evaluate(() => globalThis.location.hash);
    if (hash !== "#rotation") {
      await clickCentre(page.locator("#rotation-back"));
      await screenShown(page, "#rotation");
    }
  }
  await clickCentre(page.locator("[data-key='share']"));
  await screenShown(page, "#rotation/share");
  await page.locator("#rotation-share").waitFor({ state: "visible" });
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
// Scrolled to the middle of the screen first, so the phone dock at narrow
// widths can't sit over it.
async function clickCentre(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await locator.boundingBox();
  await locator
    .page()
    .mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Rule 6 (Eviscerate, if CP >= 5) opened, its value blanked: one error.
async function breakEviscerate(page) {
  const screen = await openRule(page, 5);
  const value = screen.locator("input.cond-value");
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
        await page.evaluate(() => globalThis.location.hash),
        "#rotation",
      );
      assert.equal(
        await page.locator("#area-rotation-title").textContent(),
        "Rotation",
      );
      assert.deepEqual(errors, []);
    });

    test("one click on Edit opens the rule's screen (#243)", async () => {
      const name = (await names(page))[0];
      const screen = await openRule(page, 0);
      await screen.locator(".rule-body").waitFor({ state: "visible" });
      assert.equal(
        (await page.locator("#area-rotation-title").textContent()).trim(),
        `1Rule 1: ${name}`,
      );
      assert.equal(await rules(page).count(), 0, "the list is not drawn");
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
      await openShare(page);
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
      await toArea(page, "character");
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
      const screen = await openRule(page, 5);
      await clickCentre(screen.locator("[data-key$='.rm']").first());
      const fix = screen.locator(".fix-button");
      assert.match(await fix.first().textContent(), /CP/);
      await clickCentre(fix.first());
      assert.equal(await screen.locator(".fix-button").count(), 0);
      assert.equal(await screen.locator(".cond").count(), 1);
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
      await openShare(page);
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
      await openShare(page);
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
      // The copy's own screen (#243).
      await screenShown(page, "#rotation/rule/8");
      const fix = page.locator("#rotation-builder .rule-screen .fix-button", {
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
      if (width < WIDE_PX) {
        const bar = await page.locator("#run-bar").boundingBox();
        assert.equal(bar.height, STRIP_PX, `strip ${bar.height}px`);
        assert.equal(
          await page.getAttribute("#run-status-text", "data-dock"),
          "Rotation errors",
        );
      }
      assert.deepEqual(errors, []);
    });
  });
}

// #200 (Kira's #206 QA, c1): the rotation's warnings banner ("What to
// check", under Rotation's h1 since #243, the only list of them: the capped
// import copy is gone) is not clipped and the page does not scroll sideways.
// Fran's #224 QA (N1): nor cut off at the bottom. Fran's #226 QA (1): nor
// clipped by a box around it, one that hides its overflow or caps its
// height. Fran's #228 QA (nit 2; #234): nor by one that contains its paint at
// a fixed height, nor by a clip-path on it or around it. #234 D2 (closed by
// #243): nor by the banner, or a part of it, containing its own paint at a
// fixed height; the check looked only at overflow there. The last test here
// breaks the banner each of those ways and sees the check fail.
const fits = (page, selector) =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector);
    root.scrollIntoView({ block: "nearest" });
    // Paint containment clips to the box as overflow: hidden does
    // ("strict" and "content" include it).
    const paintContained = (el) =>
      /\b(paint|strict|content)\b/.test(getComputedStyle(el).contain);
    // Clips what overflows it across or down: overflow not visible, or
    // paint containment.
    const clipsX = (el) =>
      getComputedStyle(el).overflowX !== "visible" || paintContained(el);
    const clipsY = (el) =>
      getComputedStyle(el).overflowY !== "visible" || paintContained(el);
    // The boxes around it, up to the page, that can clip it: overflow not
    // visible (hidden, clip, auto or scroll), a max-height, or paint
    // containment.
    const around = [];
    const ancestors = [];
    for (
      let el = root.parentElement;
      el !== null && el !== document.body;
      el = el.parentElement
    ) {
      ancestors.push(el);
      if (
        clipsX(el) ||
        clipsY(el) ||
        getComputedStyle(el).maxHeight !== "none"
      ) {
        around.push(el);
      }
    }
    const at = root.getBoundingClientRect();
    const parts = [root, ...root.querySelectorAll("*")].filter(
      (el) => el.getClientRects().length > 0,
    );
    const html = (el) => el.outerHTML.slice(0, 80);
    return {
      count: parts.length,
      outside: parts
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.left < -1 || box.right > globalThis.innerWidth + 1;
        })
        .map(html),
      clipped: parts
        .filter((el) => clipsX(el) && el.scrollWidth > el.clientWidth + 1)
        .map(html),
      cutOff: parts
        .filter((el) => clipsY(el) && el.scrollHeight > el.clientHeight + 1)
        .map(html),
      // Its edges inside each box around it that can clip it, and that box
      // not cutting off what it holds.
      clippedAround: around
        .filter((el) => {
          const box = el.getBoundingClientRect();
          const outside =
            at.top < box.top - 1 ||
            at.bottom > box.bottom + 1 ||
            at.left < box.left - 1 ||
            at.right > box.right + 1;
          const capped = clipsY(el) && el.scrollHeight > el.clientHeight + 1;
          return outside || capped;
        })
        .map(html),
      // A clip-path on it, on a part of it or on a box around it; not a
      // visually hidden one-pixel text for screen readers.
      clipPathed: [...ancestors, ...parts]
        .filter((el) => {
          const { width, height } = el.getBoundingClientRect();
          return (
            getComputedStyle(el).clipPath !== "none" &&
            (width > 1 || height > 1)
          );
        })
        .map(html),
      wide:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  }, selector);

const fitsAll = (result) =>
  result.count > 1 &&
  result.outside.length === 0 &&
  result.clipped.length === 0 &&
  result.cutOff.length === 0 &&
  result.clippedAround.length === 0 &&
  result.clipPathed.length === 0 &&
  !result.wide;

// An imported rotation with warnings: a duplicate rule, a rule that starves
// the one below, and a finisher with no combo point check.
async function importWarned(page) {
  await openShare(page);
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
  await page.locator("#rb-warnings").waitFor({ state: "visible" });
}

for (const width of [1280, 390, 360]) {
  test(`the rotation warnings banner fits at ${width}px (#200, #243)`, async () => {
    const { context, page, errors } = await openBuilder(width);
    try {
      // Imported on Export or import: the banner is above it, under the h1.
      await importWarned(page);
      assert.match(
        await page.locator("#cfg-import-status").textContent(),
        /see What to check above\.$/,
      );
      const imported = await fits(page, "#rb-warnings");
      assert.ok(fitsAll(imported), JSON.stringify(imported));
      const text = await page.locator("#rb-warnings").innerText();
      assert.ok(text.split("\n").filter(Boolean).length >= 3, text);
      if (process.env.U9_SHOTS) {
        await page.locator("#rb-warnings").screenshot({
          path: `${process.env.U9_SHOTS}/import-warnings-${width}.png`,
        });
      }
      // A duplicated rule warns too, with its fix links.
      await clickCentre(page.locator("#rotation-back"));
      await screenShown(page, "#rotation");
      await clickCentre(rule(page, 0).locator("[data-key$='.dup']"));
      await screenShown(page, "#rotation/rule/2");
      const banner = await fits(page, "#rb-warnings");
      assert.ok(fitsAll(banner), JSON.stringify(banner));
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

// The check above, against a banner broken on purpose (#234 D2): it must
// catch each way of clipping it, or it proves nothing.
test("the fit check catches a clipped banner (#234 D2)", async () => {
  const { context, page, errors } = await openBuilder(1280);
  try {
    await importWarned(page);
    assert.ok(fitsAll(await fits(page, "#rb-warnings")), "fits unbroken");
    const broken = async (css, on = "#rb-warnings") => {
      await page.evaluate(
        ([css, on]) => {
          const style = document.createElement("style");
          style.id = "fit-mutation";
          style.textContent = `${on} { ${css} }`;
          document.head.append(style);
        },
        [css, on],
      );
      const result = await fits(page, "#rb-warnings");
      await page.evaluate(() =>
        document.getElementById("fit-mutation").remove(),
      );
      return result;
    };
    // The banner containing its own paint at a fixed height: the gap.
    const self = await broken("contain: paint; height: 1.5rem;");
    assert.ok(!fitsAll(self), "contain: paint on the banner");
    assert.notDeepEqual(self.cutOff, [], JSON.stringify(self));
    // A part of it doing the same.
    const part = await broken(
      "contain: paint; height: 0.4rem;",
      "#rb-warnings > :last-child",
    );
    assert.notDeepEqual(part.cutOff, [], JSON.stringify(part));
    // Strict containment includes paint.
    const strict = await broken("contain: strict; height: 1.5rem;");
    assert.notDeepEqual(strict.cutOff, [], JSON.stringify(strict));
    // A box around it, overflow hidden at a fixed height.
    const box = await broken(
      "overflow: hidden; max-height: 2rem;",
      "#rotation-builder .builder-messages",
    );
    assert.notDeepEqual(box.clippedAround, [], JSON.stringify(box));
    // A clip-path on it.
    const pathed = await broken("clip-path: inset(0 0 50% 0);");
    assert.notDeepEqual(pathed.clipPathed, [], JSON.stringify(pathed));
    // Unbroken again.
    assert.ok(fitsAll(await fits(page, "#rb-warnings")), "fits again");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
