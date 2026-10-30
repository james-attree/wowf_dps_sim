// Browser tests for Rotation's screens (#243, UX5): the list (#rotation), a
// rule's own screen (#rotation/rule/<n>) and Export or import
// (#rotation/share). Each is a route with its own title, h1 and back link;
// the rotation's warnings are a banner under the h1, seen after a Duplicate
// at every size (Fran's #252 and #253 checks); the strip links to them; and
// from the wide breakpoint up an area's h1 comes before the Run column in
// the page (N3). `npm run test:browser`; Chrome as in the other files. Fonts
// are pinned to DejaVu Sans, CI's.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const FONT_CSS = ':root { font-family: "DejaVu Sans" !important; }';
const APP = "WoW Forever Rogue Simulator";
const SIZES = [
  [1440, 900],
  [1280, 800],
  [1100, 800],
  [1024, 768],
  [1024, 576],
  [390, 844],
  [360, 640],
];
const WIDE_PX = 1024;
// N3's screens off Results (#244, UX6), and how far to tab on each.
const WIDE_SCREENS = [
  "#character",
  "#character/gear",
  "#character/stats",
  "#character/talents",
  "#rotation",
  "#rotation/rule/1",
  "#rotation/share",
  "#fight",
];
const MAX_TABS = 40;

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

async function openPage(width, height, hash = "") {
  const context = await browser.newContext({ viewport: { width, height } });
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
  await page.goto(`${base}${hash}`);
  await page.addStyleTag({ content: FONT_CSS });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

const hashIs = (page, hash) =>
  page.waitForFunction((hash) => globalThis.location.hash === hash, hash);
// The route is drawn a moment after the hash changes: these wait for the
// focus or the title to settle, then give what they are.
async function focusOf(page, want) {
  await page
    .waitForFunction(
      (want) =>
        (document.activeElement?.dataset?.key ?? document.activeElement?.id) ===
        want,
      want,
      { timeout: 2000 },
    )
    .catch(() => {});
  return activeId(page);
}
async function titleOf(page, want) {
  await page
    .waitForFunction((want) => document.title.startsWith(want), want, {
      timeout: 2000,
    })
    .catch(() => {});
  return page.title();
}
const titleIs = async (page, want) =>
  assert.equal(await titleOf(page, want), want);
const activeId = (page) =>
  page.evaluate(
    () => document.activeElement?.dataset?.key ?? document.activeElement?.id,
  );
const h1 = (page) => page.locator("#area-rotation-title");
const ruleCard = (page, at) =>
  page.locator("#rotation-builder li.rule").nth(at);

// Where the banner and the h1 are, and the bottom of what can be seen: the
// phone dock's top when it is fixed over the page.
const placed = (page) =>
  page.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const dock = document.getElementById("run-controls");
    const fixed = getComputedStyle(dock).position === "fixed";
    const banner = document.getElementById("rb-warnings");
    return {
      seen: fixed ? dock.getBoundingClientRect().top : globalThis.innerHeight,
      h1: box("area-rotation-title"),
      banner: banner.checkVisibility() ? banner.getBoundingClientRect() : null,
      focused: document.activeElement?.id,
      hash: globalThis.location.hash,
    };
  });

describe("Rotation's screens", () => {
  test("each screen has its route, title, h1 and back link", async () => {
    const { context, page, errors } = await openPage(1280, 800);
    try {
      await page.click(`[data-nav-area="rotation"]`);
      await hashIs(page, "#rotation");
      await titleIs(page, `Rotation · ${APP}`);
      assert.equal(
        await focusOf(page, "area-rotation-title"),
        "area-rotation-title",
      );
      // The list is Rotation's top (#244, UX6): no back link, and the
      // preset the sim uses is on it.
      assert.equal(await page.isVisible("#rotation-back"), false);
      assert.ok(await page.isVisible("#cfg-rotation"));
      // A rule's screen, from its Edit link.
      const name = (await ruleCard(page, 1).locator(".rule-name").innerText())
        .trim()
        .replace(/^Rule \d+:\s*/, "");
      const edit = ruleCard(page, 1).locator("[data-key$='.edit']");
      const editKey = await edit.getAttribute("data-key");
      assert.equal(await edit.getAttribute("href"), "#rotation/rule/2");
      await edit.click();
      await hashIs(page, "#rotation/rule/2");
      await titleIs(page, `Rule 2: ${name} · ${APP}`);
      assert.equal(
        await focusOf(page, "area-rotation-title"),
        "area-rotation-title",
      );
      // The number is drawn, and read as "Rule 2:".
      assert.equal(
        await h1(page).locator(".rule-num").getAttribute("aria-hidden"),
        "true",
      );
      assert.equal(
        await h1(page).locator(".visually-hidden").textContent(),
        "Rule 2: ",
      );
      assert.equal(
        await page.locator("#rotation-back").getAttribute("href"),
        "#rotation",
      );
      // Back, a real link, to the list and its Edit link (not history).
      await page.click("#rotation-back");
      await hashIs(page, "#rotation");
      assert.equal(await focusOf(page, editKey), editKey);
      // Export or import, and Escape back to the list.
      await page.click("[data-key='share']");
      await hashIs(page, "#rotation/share");
      await titleIs(page, `Export or import · ${APP}`);
      assert.equal(
        await focusOf(page, "area-rotation-title"),
        "area-rotation-title",
      );
      assert.ok(await page.isVisible("#cfg-import-text"));
      await page.keyboard.press("Escape");
      await hashIs(page, "#rotation");
      assert.equal(await focusOf(page, "share"), "share");
      // Leaving Rotation closes the builder.
      await page.click(`[data-nav-area="character"]`);
      await hashIs(page, "#character");
      await focusOf(page, "area-character-title");
      assert.equal(await page.isVisible("#rotation-builder"), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("a rule's route opens its screen, a missing one the list", async () => {
    const { context, page, errors } = await openPage(
      390,
      844,
      "#rotation/rule/3",
    );
    try {
      await page.locator("#rotation-builder .rule-screen").waitFor();
      assert.match(await titleOf(page, "Rule 3: "), /^Rule 3: /);
      await page.goto(`${base}#rotation/rule/99`);
      await hashIs(page, "#rotation");
      await titleIs(page, `Rotation · ${APP}`);
      assert.equal(await page.locator("#rotation-builder li.rule").count(), 7);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  // Fran's #255 check, P6: Escape in a number box kept the edit and left
  // for the list with nothing said.
  test("Escape in a number box says the edit is kept", async () => {
    const { context, page, errors } = await openPage(1280, 800, "#rotation");
    try {
      await page.locator("#rotation-builder li.rule").first().waitFor();
      // The first rule whose screen has a number box.
      const box = page.locator("#rotation-builder .rule-screen input").first();
      for (let n = 1; (await box.count()) === 0; n += 1) {
        await ruleCard(page, n - 1)
          .locator("[data-key$='.edit']")
          .click();
        await page.locator("#rotation-builder .rule-screen").waitFor();
        if ((await box.count()) === 0) {
          await page.click("#rotation-back");
          await hashIs(page, "#rotation");
        }
      }
      await box.fill("4");
      await box.press("Escape");
      await hashIs(page, "#rotation");
      await page.waitForFunction(
        () =>
          document.querySelector("#rotation-builder .builder-live")
            ?.textContent === "Kept. Back to Rotation.",
        null,
        { timeout: 3000 },
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  // Fran's #255 check, P2: Delete on a rule's screen put the list on top of
  // it in the history, so Back reopened #rotation/rule/3 at the rule that
  // moved up into number 3. The list now takes the deleted rule's entry.
  test("Back after a Delete never opens the rule that took its number", async () => {
    const { context, page, errors } = await openPage(1280, 800, "#rotation");
    try {
      await page.locator("#rotation-builder li.rule").first().waitFor();
      const before = await page.evaluate(() => globalThis.history.length);
      const third = ruleCard(page, 2);
      const deleted = await third.getAttribute("data-uid");
      await third.locator("[data-key$='.edit']").click();
      await hashIs(page, "#rotation/rule/3");
      await page.locator("#rotation-builder .rule-screen").waitFor();
      await page.locator(`[data-key='${deleted}.del']`).click();
      await hashIs(page, "#rotation");
      await page.locator("#rotation-builder li.rule").first().waitFor();
      assert.equal(await page.locator("#rotation-builder li.rule").count(), 6);
      // The Delete added no entry: the list replaced the rule's.
      assert.equal(
        await page.evaluate(() => globalThis.history.length),
        before + 1,
      );
      const now = await page.evaluate(() =>
        [...document.querySelectorAll("#rotation-builder li.rule")].map(
          (rule) => rule.dataset.uid,
        ),
      );
      assert.equal(now.includes(deleted), false);
      await page.goBack();
      await page.waitForFunction(
        () => globalThis.location.hash !== "#rotation/rule/3",
      );
      assert.notEqual(
        await page.evaluate(() => globalThis.location.hash),
        "#rotation/rule/3",
      );
      assert.equal(
        await page.locator("#rotation-builder .rule-screen").count(),
        0,
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

// Fran's #255 check: P3, at 1024x576 the import status sat under the fold;
// P4, an import was spoken twice, its status then "Rotation: Imported:
// Warned." by the builder. The status is brought on screen, at every size,
// and is the one thing said.
for (const [width, height] of SIZES) {
  test(`an import on Export or import stays there, its status on screen and said once, at ${width}x${height}`, async () => {
    const { context, page, errors } = await openPage(
      width,
      height,
      "#rotation/share",
    );
    try {
      // What each live region says, in order.
      await page.evaluate(() => {
        globalThis.__said = [];
        const watch = new globalThis.MutationObserver((changes) => {
          for (const change of changes) {
            const region =
              change.target.closest?.("[role='status']") ??
              change.target.parentElement?.closest("[role='status']");
            const text = region?.textContent.trim();
            if (text) {
              globalThis.__said.push(text);
            }
          }
        });
        watch.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      await page.locator("#cfg-import-text").waitFor({ state: "visible" });
      await page.fill(
        "#cfg-import-text",
        JSON.stringify({
          schemaVersion: 1,
          name: "Warned",
          rules: [
            { action: "sinister-strike", conditions: [] },
            { action: "sinister-strike", conditions: [] },
          ],
        }),
      );
      await page.click("#cfg-import-paste");
      await page.locator("#rb-warnings").waitFor({ state: "visible" });
      assert.equal(
        await page.evaluate(() => globalThis.location.hash),
        "#rotation/share",
      );
      assert.ok(await page.isVisible("#cfg-import-status"));
      assert.match(
        await page.locator("#cfg-import-status").textContent(),
        /see What to check above\.$/,
      );
      const { banner, h1: title } = await placed(page);
      assert.ok(banner.top >= title.bottom - 1, "the banner is under the h1");
      // P3: on screen, above the dock where there is one.
      await page.waitForFunction(
        () => {
          const dock = document.getElementById("run-controls");
          const fixed = getComputedStyle(dock).position === "fixed";
          const seen = fixed
            ? dock.getBoundingClientRect().top
            : globalThis.innerHeight;
          const box = document
            .getElementById("cfg-import-status")
            .getBoundingClientRect();
          return box.top >= 0 && box.bottom <= seen;
        },
        null,
        { timeout: 3000 },
      );
      // P4: the builder says nothing of it.
      await page.waitForTimeout(300);
      const said = await page.evaluate(() => globalThis.__said);
      assert.equal(
        said.some((text) => text.startsWith("Rotation: ")),
        false,
        said.join(" | "),
      );
      assert.ok(
        said.some((text) => text.startsWith("Imported")),
        said.join(" | "),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

// Fran's #252 and #253 checks (D1, D2): after a Duplicate the warning is on
// screen under the h1, the h1 focused, and so after a second Duplicate.
for (const [width, height] of SIZES) {
  test(`after Duplicate, twice, the banner is under the h1 at ${width}x${height}`, async () => {
    const { context, page, errors } = await openPage(
      width,
      height,
      "#rotation",
    );
    try {
      await page.locator("#rotation-builder li.rule").first().waitFor();
      const copy = async (dup, hash) => {
        await dup.scrollIntoViewIfNeeded();
        await dup.click();
        await hashIs(page, hash);
        await page.locator("#rb-warnings").waitFor({ state: "visible" });
        const at = await placed(page);
        assert.equal(at.focused, "area-rotation-title");
        assert.ok(at.h1.top >= -1, JSON.stringify(at));
        assert.ok(at.banner.top >= at.h1.bottom - 1, JSON.stringify(at));
        assert.ok(at.banner.bottom <= at.seen + 1, JSON.stringify(at));
        return at;
      };
      await copy(
        ruleCard(page, 3).locator("[data-key$='.dup']"),
        "#rotation/rule/5",
      );
      if (process.env.U9_SHOTS) {
        await page.screenshot({
          path: `${process.env.U9_SHOTS}/dup1-${width}x${height}.png`,
        });
      }
      // The copy's screen has its own Duplicate, at its foot.
      await copy(
        page.locator("#rotation-builder .rule-foot [data-key$='.dup']"),
        "#rotation/rule/6",
      );
      if (process.env.U9_SHOTS) {
        await page.screenshot({
          path: `${process.env.U9_SHOTS}/dup2-${width}x${height}.png`,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

const positiveTabindex = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[tabindex]")]
      .filter((node) => node.tabIndex > 0)
      .map((node) => node.id || node.outerHTML.slice(0, 60)),
  );

// N3 (Fran's #253 check): from the wide breakpoint up, off Results, an
// area's h1 is read and tabbed to before the Run column; on Results the
// column is the bar above them (#242), and on a phone the dock is before
// the area (#240), as before.
for (const [width, height] of [
  [1440, 900],
  [1024, 576],
  [390, 844],
]) {
  test(`the area's h1 and the Run column, in order, at ${width}px (N3)`, async () => {
    const { context, page, errors } = await openPage(width, height);
    try {
      for (const area of ["character", "rotation", "fight", "results"]) {
        await page.click(`[data-nav-area="${area}"]`);
        await hashIs(page, `#${area}`);
        await focusOf(page, `area-${area}-title`);
        const h1First = await page.evaluate(
          (area) =>
            Boolean(
              document
                .querySelector(`#area-${area} h1`)
                .compareDocumentPosition(
                  document.getElementById("run-column"),
                ) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          area,
        );
        assert.equal(
          h1First,
          width >= WIDE_PX && area !== "results",
          `${area} at ${width}`,
        );
      }
      // The walks start at the nav, so a positive tabindex (first in the
      // tab order wherever it is) would slip past them (#245, Fran's #256
      // check): there is none, on any screen.
      assert.deepEqual(await positiveTabindex(page), [], `at ${width}`);
      // Every wide screen off Results (#244, UX6): in the page, its back
      // link (if it has one), then its h1, then the Run column; tabbing on
      // from its area's link in the nav reaches the back link, else the
      // area, before the Run button.
      if (width >= WIDE_PX) {
        for (const hash of WIDE_SCREENS) {
          const area = hash.slice(1).split("/")[0];
          await page.evaluate((to) => {
            globalThis.location.hash = to;
          }, hash);
          await hashIs(page, hash);
          await focusOf(page, `area-${area}-title`);
          const order = await page.evaluate((area) => {
            const shell = document.getElementById(`area-${area}`);
            const back = shell.querySelector(".back-link");
            const shown = back !== null && back.checkVisibility();
            const before = (a, b) =>
              Boolean(
                a.compareDocumentPosition(b) &
                globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
              );
            const title = shell.querySelector("h1");
            const column = document.getElementById("run-column");
            return {
              back: shown ? back.id : null,
              backFirst: shown ? before(back, title) : null,
              h1First: before(title, column),
            };
          }, area);
          assert.equal(order.h1First, true, `${hash} at ${width}`);
          assert.deepEqual(await positiveTabindex(page), [], hash);
          if (order.back !== null) {
            assert.equal(order.backFirst, true, `${hash} at ${width}`);
          }
          await page.locator(`[data-nav-area="${area}"]`).focus();
          const stops = [];
          for (let i = 0; i < MAX_TABS; i += 1) {
            await page.keyboard.press("Tab");
            stops.push(
              await page.evaluate((area) => {
                const at = document.activeElement;
                return {
                  id: at?.id || at?.dataset?.key || at?.tagName,
                  inArea: at?.closest(`#area-${area}`) !== null,
                  run: at?.id === "run-button",
                };
              }, area),
            );
          }
          const shown = stops.map((stop) => stop.id).join(" ");
          const firstIn = stops.findIndex((stop) => stop.inArea);
          const firstRun = stops.findIndex((stop) => stop.run);
          assert.ok(firstIn !== -1, `${hash}: ${shown}`);
          assert.ok(firstRun === -1 || firstIn < firstRun, `${hash}: ${shown}`);
          if (order.back !== null) {
            assert.equal(stops[firstIn].id, order.back, `${hash}: ${shown}`);
          }
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

// The strip's warnings link (#243): on any area, with the rotation's
// warning count; it opens Rotation, its h1 focused.
for (const width of [1280, 390]) {
  test(`the strip links to the rotation's warnings at ${width}px`, async () => {
    const { context, page, errors } = await openPage(width, 800, "#rotation");
    try {
      const link = page.locator("#run-warnings-link");
      assert.equal(await link.isVisible(), false);
      await ruleCard(page, 3).locator("[data-key$='.dup']").click();
      await hashIs(page, "#rotation/rule/5");
      await page.click(`[data-nav-area="character"]`);
      await hashIs(page, "#character");
      await link.waitFor({ state: "visible" });
      assert.match(await link.textContent(), /^⚠ \d+ rotation warnings?$/);
      assert.match(
        await link.getAttribute("aria-label"),
        /^\d+ rotation warnings?$/,
      );
      await link.click();
      await hashIs(page, "#rotation");
      assert.equal(
        await focusOf(page, "area-rotation-title"),
        "area-rotation-title",
      );
      assert.ok(await page.isVisible("#rb-warnings"));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
