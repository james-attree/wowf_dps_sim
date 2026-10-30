// Browser test for #239 (Phase 4.5 UX1): the page's four areas and their
// nav. A deep link opens its area, Back and Forward move between areas and
// put the focus back, the nav works from the keyboard, the current link has
// aria-current="page", and the Run bar's Fix link shows the area its field
// is in. At each of the phone and desktop widths. Run in Chrome through
// playwright-core with `npm run test:browser`.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [1280, 390, 360];
const SCREEN_HEIGHT = 900;
const APP_TITLE = "WoW Forever Rogue Simulator";
const AREAS = ["character", "rotation", "fight", "results"];
const LABELS = {
  character: "Character",
  rotation: "Rotation",
  fight: "Fight",
  results: "Results",
};
// Max under Min: an error in the Character area.
const PAIR_MIN = "50";
const PAIR_MAX = "40";
const MIN = "#cfg-weapons-mainHand-min";
const MAX = "#cfg-weapons-mainHand-max";

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

async function open(width, hash = "") {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
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
  await page.goto(`${base}${hash}`);
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

// What the page shows: its hash, title, shown areas, the nav's current
// links, and the focused element's id.
const read = (page) =>
  page.evaluate(() => ({
    hash: globalThis.location.hash,
    title: globalThis.document.title,
    shown: [...globalThis.document.querySelectorAll("[data-area]")]
      .filter((shell) => !shell.hidden)
      .map((shell) => shell.dataset.area),
    current: [
      ...globalThis.document.querySelectorAll('[aria-current="page"]'),
    ].map((link) => link.dataset.navArea),
    focus: globalThis.document.activeElement?.id ?? null,
  }));

// The page at one area: only its shell shown, its link current, its title.
// A hash change is handled on its event, after the click or key returns.
async function assertAt(page, area, message) {
  await page.waitForFunction(
    (shown) =>
      globalThis.document.querySelector(`[data-area="${shown}"]`)?.hidden ===
      false,
    area,
  );
  const state = await read(page);
  assert.deepEqual(state.shown, [area], message);
  assert.deepEqual(state.current, [area], message);
  assert.equal(state.title, `${LABELS[area]} · ${APP_TITLE}`, message);
  return state;
}

for (const width of WIDTHS) {
  describe(`areas and nav at ${width}`, () => {
    test("a deep link opens its area; none or an unknown one opens Character", async () => {
      for (const area of AREAS) {
        const { context, page, errors } = await open(width, `#${area}`);
        const state = await assertAt(page, area, area);
        assert.equal(state.hash, `#${area}`);
        assert.ok(
          await page.locator(`[data-nav-area="${area}"]`).isVisible(),
          "the nav shows",
        );
        assert.deepEqual(errors, []);
        await context.close();
      }
      for (const hash of ["", "#nowhere"]) {
        const { context, page } = await open(width, hash);
        const state = await assertAt(page, "character", hash);
        assert.equal(state.hash, "#character");
        await context.close();
      }
    });

    test("Back and Forward move between areas and restore the focus", async () => {
      const { context, page, errors } = await open(width, "#character");
      await page.locator('[data-nav-area="fight"]').click();
      let state = await assertAt(page, "fight");
      assert.equal(state.hash, "#fight");
      assert.equal(state.focus, "area-fight-title");
      await page.locator('[data-nav-area="results"]').click();
      state = await assertAt(page, "results");
      assert.equal(state.focus, "area-results-title");
      await page.goBack();
      await assertAt(page, "fight");
      // Back puts the focus on the link that left this area.
      assert.equal(
        await page.evaluate(
          () => globalThis.document.activeElement?.dataset?.navArea,
        ),
        "results",
      );
      await page.goBack();
      await assertAt(page, "character");
      await page.goForward();
      await assertAt(page, "fight");
      await page.goForward();
      state = await assertAt(page, "results");
      assert.equal(state.focus, "area-results-title");
      assert.deepEqual(errors, []);
      await context.close();
    });

    test("the nav works from the keyboard", async () => {
      const { context, page, errors } = await open(width, "#character");
      await page.locator('[data-nav-area="character"]').focus();
      for (const area of AREAS.slice(1)) {
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(
            () => globalThis.document.activeElement?.dataset?.navArea,
          ),
          area,
          "Tab goes to the next link",
        );
      }
      await page.keyboard.press("Enter");
      let state = await assertAt(page, "results");
      assert.equal(state.focus, "area-results-title");
      await page.locator('[data-nav-area="fight"]').focus();
      await page.keyboard.press("Enter");
      state = await assertAt(page, "fight");
      assert.equal(state.focus, "area-fight-title");
      assert.deepEqual(errors, []);
      await context.close();
    });

    test("the Fix link shows the area its field is in", async () => {
      const { context, page, errors } = await open(width, "#character");
      await page.locator(MIN).fill(PAIR_MIN);
      await page.locator(MIN).blur();
      await page.locator(MAX).fill(PAIR_MAX);
      await page.locator(MAX).blur();
      const badge = page.locator('[data-nav-area="character"] [data-badge]');
      assert.equal(await badge.isVisible(), true);
      assert.match(await badge.textContent(), /^1 error$/);
      await page.locator('[data-nav-area="results"]').click();
      await assertAt(page, "results");
      // The Run bar stays on every area; its Fix link sends the focus to
      // the first setting to fix (#247), in Character.
      await page.locator("#run-errors-link").click();
      const state = await assertAt(page, "character");
      assert.equal(`#${state.focus}`, MAX);
      assert.deepEqual(errors, []);
      await context.close();
    });

    test("Edit rotation opens the builder in Rotation; Back closes it", async () => {
      const { context, page, errors } = await open(width, "#character");
      await page.locator("#cfg-rotation-edit").click();
      await assertAt(page, "rotation");
      assert.equal(await page.locator("#rotation-builder").isVisible(), true);
      await page.goBack();
      await assertAt(page, "character");
      assert.equal(await page.locator("#rotation-builder").isVisible(), false);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
