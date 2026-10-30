// Browser test for #239 (Phase 4.5 UX1): the page's four areas and their
// nav. A deep link opens its area, Back and Forward move between areas and
// put the focus back, the nav works from the keyboard, the current link has
// aria-current="page", and the Run bar's Fix link shows the area its field
// is in. At each of the phone and desktop widths. Run in Chrome through
// playwright-core with `npm run test:browser`.
//
// Fran's QA of #251 adds: "Edit rotation…" leaves the focus on Rotation's
// h1 (B1); the batch's and the fight log's live regions still speak while
// another area is shown (B2); below the wide breakpoint a control the
// keyboard focuses is never under the bottom nav (B3); and an area's name
// in the hash is matched in any case.
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
// The narrow widths, where the nav is a bar at the bottom of the screen.
const BOTTOM_NAV_WIDTHS = [390, 360];
// Enough Tab presses to go through an area's controls.
const TAB_SWEEP = 160;
// A short batch and a live fight long enough to say a key event.
const BATCH_FIGHTS = "20";
const LIVE_FIGHT_SECONDS = "30";
const BATCH_TIMEOUT = 60_000;
const SPOKEN_TIMEOUT = 20_000;

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
      // Any case (Fran's QA of #251): #Fight is #fight.
      {
        const { context, page } = await open(width, "#Fight");
        const state = await assertAt(page, "fight", "#Fight");
        assert.equal(state.hash, "#fight");
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
      // From the keyboard (B1): the focus goes to Rotation's h1, not body.
      await page.locator("#cfg-rotation-edit").focus();
      await page.keyboard.press("Enter");
      const state = await assertAt(page, "rotation");
      assert.equal(state.focus, "area-rotation-title");
      assert.equal(await page.locator("#rotation-builder").isVisible(), true);
      await page.goBack();
      await assertAt(page, "character");
      assert.equal(await page.locator("#rotation-builder").isVisible(), false);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}

// The live regions' messages while another area is shown (B2): each change
// that leaves #results-announce or #live-announcer with text, with whether
// the region was in a hidden subtree (not in the accessibility tree) and
// the area shown at the time.
async function watchLiveRegions(page) {
  await page.evaluate(() => {
    const doc = globalThis.document;
    globalThis.__said = [];
    for (const id of ["results-announce", "live-announcer"]) {
      const region = doc.getElementById(id);
      new globalThis.MutationObserver(() => {
        if (region.textContent.trim() === "") {
          return;
        }
        globalThis.__said.push({
          id,
          text: region.textContent,
          inHidden: region.closest("[hidden]") !== null,
          area: [...doc.querySelectorAll("[data-area]")].find(
            (shell) => !shell.hidden,
          )?.dataset.area,
        });
      }).observe(region, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  });
}

const said = (page) => page.evaluate(() => globalThis.__said);

// The run settings fold away on phones: open them for a field.
async function settingsField(page, id) {
  const field = page.locator(`#${id}`);
  if (!(await field.isVisible())) {
    await page.locator("#run-settings-toggle").click();
  }
  return field;
}

// Whether the accessibility tree has the node (it is not ignored).
async function inAccessibilityTree(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
    nodeId,
    fetchRelatives: false,
  });
  await cdp.detach();
  return nodes.length > 0 && nodes[0].ignored !== true;
}

for (const width of WIDTHS) {
  describe(`announcements from another area at ${width}`, () => {
    test("a batch's progress and finish are said while Character is shown", async () => {
      const { context, page, errors } = await open(width, "#character");
      await (await settingsField(page, "run-mode-batch")).check();
      await (await settingsField(page, "run-iterations")).fill(BATCH_FIGHTS);
      await watchLiveRegions(page);
      await page.locator("#run-button").click();
      await assertAt(page, "results");
      await page.locator('[data-nav-area="character"]').click();
      await assertAt(page, "character");
      await page.waitForFunction(
        () =>
          /^Batch finished/.test(
            globalThis.document.getElementById("results-announce").textContent,
          ),
        null,
        { timeout: BATCH_TIMEOUT },
      );
      const messages = (await said(page)).filter(
        ({ id }) => id === "results-announce",
      );
      const finished = messages.at(-1);
      assert.match(finished.text, /^Batch finished/);
      assert.equal(finished.area, "character");
      assert.deepEqual(
        messages.filter(({ inHidden }) => inHidden),
        [],
        "no message went into a hidden subtree",
      );
      assert.equal(await inAccessibilityTree(page, "#results-announce"), true);
      assert.deepEqual(errors, []);
      await context.close();
    });

    test("the fight log's key events are said while Character is shown", async () => {
      const { context, page, errors } = await open(width, "#fight");
      await page.locator("#announce-toggle").check();
      // A live fight: the page opens in Batch mode (#242).
      await (await settingsField(page, "run-mode-live")).check();
      await (
        await settingsField(page, "run-duration")
      ).fill(LIVE_FIGHT_SECONDS);
      await watchLiveRegions(page);
      await page.locator('[data-nav-area="character"]').click();
      await assertAt(page, "character");
      await page.locator("#run-button").click();
      await assertAt(page, "fight");
      await page.locator('[data-nav-area="character"]').click();
      await assertAt(page, "character");
      await page.waitForFunction(
        () =>
          globalThis.__said.some(
            ({ id, area }) => id === "live-announcer" && area === "character",
          ),
        null,
        { timeout: SPOKEN_TIMEOUT },
      );
      const messages = (await said(page)).filter(
        ({ id }) => id === "live-announcer",
      );
      assert.deepEqual(
        messages.filter(({ inHidden }) => inHidden),
        [],
        "no message went into a hidden subtree",
      );
      assert.equal(await inAccessibilityTree(page, "#live-announcer"), true);
      await page.locator("#stop-button").click();
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}

// Tabs through an area from the top of the page and returns each focused
// control the chrome covers, by id or tag, with its box (B3). Below 1024px
// the chrome is the bottom nav, the dock's strip above it and, after a
// Duplicate, the builder's pinned messages at the top (#240).
async function coveredByNav(page) {
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.locator('[data-nav-area="results"]').focus();
  const covered = [];
  for (let press = 0; press < TAB_SWEEP; press += 1) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(() => {
      const doc = globalThis.document;
      const node = doc.activeElement;
      if (node === null || node.closest("[data-area]") === null) {
        return null;
      }
      const nav = doc.getElementById("area-nav").getBoundingClientRect();
      const strip = doc.getElementById("run-bar");
      const floor =
        getComputedStyle(strip).position === "fixed"
          ? strip.getBoundingClientRect().top
          : nav.top;
      const pinned = [...doc.querySelectorAll(".builder-messages")].find(
        (box) =>
          box.checkVisibility() &&
          getComputedStyle(box).position === "sticky" &&
          !box.contains(node),
      );
      const box = node.getBoundingClientRect();
      const messages = pinned?.getBoundingClientRect();
      const underMessages =
        messages !== undefined &&
        box.top < messages.bottom &&
        box.bottom > messages.top;
      return box.bottom > Math.min(floor, nav.top) || underMessages
        ? { id: node.id || node.tagName, top: box.top, bottom: box.bottom }
        : null;
    });
    if (hit !== null) {
      covered.push(hit);
    }
  }
  return covered;
}

for (const width of BOTTOM_NAV_WIDTHS) {
  describe(`the bottom nav at ${width}`, () => {
    test("covers no control the keyboard focuses", async () => {
      for (const area of AREAS) {
        const { context, page, errors } = await open(width, `#${area}`);
        await assertAt(page, area);
        assert.deepEqual(await coveredByNav(page), [], area);
        assert.deepEqual(errors, []);
        await context.close();
      }
    });

    // Fran's #251 check: widened to Results with a batch in it and to the
    // builder after a Duplicate brings up its warnings (#240).
    test("covers no control after a batch or a Duplicate", async () => {
      const { context, page, errors } = await open(width, "#fight");
      await (await settingsField(page, "run-mode-batch")).check();
      await (await settingsField(page, "run-iterations")).fill(BATCH_FIGHTS);
      await page.locator("#run-button").click();
      await assertAt(page, "results");
      await page.waitForFunction(
        () =>
          /^Batch finished/.test(
            globalThis.document.getElementById("results-announce").textContent,
          ),
        null,
        { timeout: BATCH_TIMEOUT },
      );
      assert.deepEqual(await coveredByNav(page), [], "results");
      await page.locator('[data-nav-area="rotation"]').click();
      await assertAt(page, "rotation");
      await page
        .locator("#rotation-builder li.rule [data-key$='.dup']")
        .first()
        .click();
      await page.locator("#rb-warnings").waitFor({ state: "visible" });
      assert.deepEqual(await coveredByNav(page), [], "after Duplicate");
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
