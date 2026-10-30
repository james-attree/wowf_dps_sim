// The phone run dock (#240, UX2): below 1024px the run bar's row is a 48px
// strip fixed above the 52px bottom nav, a 100px dock; on Results the strip
// goes back into the page and the dock is the nav alone. The strip's DPS is
// never clipped at 360px, the dock sits above the safe-area inset, and no
// banner or focused control is left under the chrome. At 1024px and up the
// run controls keep their sticky top bar.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const PHONE_WIDTHS = [390, 360];
const DESKTOP_WIDTH = 1280;
const SCREEN_HEIGHT = 800;
const DOCK_PX = 100;
const NAV_PX = 52;
const STRIP_PX = 48;
const SAFE_AREA_PX = 34;
const SHORT_FIGHT_SECONDS = "4";
const LONG_FIGHT_SECONDS = "600";
const BATCH_FIGHTS = "5";
const RUN_TIMEOUT = 60_000;
// Longer than RUN_TAP_GUARD_MS (js/views/controls.js).
const TAP_GUARD_WAIT_MS = 600;
const WIDEST_DPS = "123,456.7";
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

async function toArea(page, area) {
  await page.locator(`[data-nav-area="${area}"]`).click();
  await page.waitForFunction(
    (name) =>
      globalThis.document.querySelector(`[data-area="${name}"]`)?.hidden ===
      false,
    area,
  );
}

// The run settings fold away on phones: open them for a field.
async function settingsField(page, id) {
  const field = page.locator(`#${id}`);
  if (!(await field.isVisible())) {
    await page.locator("#run-settings-toggle").click();
  }
  return field;
}

async function closeSettings(page) {
  if (
    (await page.getAttribute("#run-settings-toggle", "aria-expanded")) ===
    "true"
  ) {
    await page.locator("#run-settings-toggle").click();
  }
}

const statusIs = (page, pattern) =>
  page.waitForFunction(
    (source) =>
      new RegExp(source).test(
        globalThis.document.getElementById("run-status-text").dataset.dock,
      ),
    pattern.source,
    { timeout: RUN_TIMEOUT },
  );

// The dock's boxes: the strip, the nav, and each line in the strip.
const dock = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const box = (id) => doc.getElementById(id).getBoundingClientRect();
    const clipped = (id) => {
      const node = doc.getElementById(id);
      return node.scrollWidth > node.clientWidth;
    };
    const strip = doc.getElementById("run-bar");
    const parts = ["run-button", "pause-button", "stop-button", "run-dps"];
    return {
      height: globalThis.innerHeight,
      width: doc.documentElement.clientWidth,
      fixed: getComputedStyle(strip).position === "fixed",
      strip: box("run-bar").toJSON(),
      nav: box("area-nav").toJSON(),
      dps: box("run-dps").toJSON(),
      dpsText: doc
        .getElementById("run-dps")
        .textContent.trim()
        .replace(/\s+/g, " "),
      shown: parts
        .filter((id) => doc.getElementById(id).checkVisibility())
        .map((id) => ({ id, ...box(id).toJSON() })),
      clipped: ["run-dps-value", "run-summary", "run-status-text"].filter(
        clipped,
      ),
      summary: doc.getElementById("run-summary").dataset.dock,
      status: doc.getElementById("run-status-text").dataset.dock,
    };
  });

const overlaps = (a, b) =>
  a.left < b.right - 1 &&
  b.left < a.right - 1 &&
  a.top < b.bottom - 1 &&
  b.top < a.bottom - 1;

// The DPS is whole: inside the screen and the strip, not ellipsized, and
// clear of the buttons beside it.
function assertDpsShown(at, state) {
  const where = `${state}: ${JSON.stringify(at)}`;
  assert.deepEqual(at.clipped, [], where);
  assert.ok(at.dps.left >= 0 && at.dps.right <= at.width, where);
  assert.ok(at.dps.top >= at.strip.top - 1, where);
  assert.ok(at.dps.bottom <= at.strip.bottom + 1, where);
  for (const part of at.shown.filter(({ id }) => id !== "run-dps")) {
    assert.ok(!overlaps(part, at.dps), `${part.id} on the DPS, ${where}`);
  }
}

for (const width of PHONE_WIDTHS) {
  describe(`the phone dock at ${width}`, () => {
    test("is 100px on Character, Rotation and Fight, the nav alone on Results", async () => {
      const { context, page, errors } = await open(width);
      try {
        for (const area of ["character", "rotation", "fight", "results"]) {
          await toArea(page, area);
          await page.evaluate(() =>
            globalThis.scrollTo(0, globalThis.document.body.scrollHeight),
          );
          const at = await dock(page);
          const results = area === "results";
          assert.equal(at.fixed, !results, area);
          assert.equal(at.height - at.nav.top, NAV_PX, area);
          if (results) {
            // The strip is back in the page, not over the screen's foot.
            assert.ok(at.strip.bottom <= at.nav.top, area);
          } else {
            assert.equal(at.height - at.strip.top, DOCK_PX, area);
            assert.equal(at.strip.height, STRIP_PX, area);
            assert.equal(at.strip.bottom, at.nav.top, area);
          }
          // The run settings are not pinned at the top (UX2 drops the top bar).
          const controls = await page.evaluate(
            () =>
              getComputedStyle(
                globalThis.document.getElementById("run-controls"),
              ).position,
          );
          assert.equal(controls, "static", area);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("the DPS is never clipped, from idle to a batch", async () => {
      const { context, page, errors } = await open(width, "#fight");
      try {
        assertDpsShown(await dock(page), "idle");

        // A live run, running and paused.
        await (
          await settingsField(page, "run-duration")
        ).fill(LONG_FIGHT_SECONDS);
        await closeSettings(page);
        await page.locator("#run-button").click();
        await page.waitForFunction(
          () =>
            globalThis.document.getElementById("run-dps-value").textContent !==
            "—",
          null,
          { timeout: RUN_TIMEOUT },
        );
        await statusIs(page, /^Running/);
        assertDpsShown(await dock(page), "running");
        // Past the double-tap guard (N3), a Pause press pauses.
        await page.waitForTimeout(TAP_GUARD_WAIT_MS);
        await page.locator("#pause-button").click();
        await statusIs(page, /^Paused/);
        assertDpsShown(await dock(page), "paused");
        await page.locator("#stop-button").click();
        await statusIs(page, /^Stopped/);
        assertDpsShown(await dock(page), "stopped");

        // A short live run to its end.
        await (
          await settingsField(page, "run-duration")
        ).fill(SHORT_FIGHT_SECONDS);
        await closeSettings(page);
        await page.locator("#reset-button").click();
        await page.locator("#run-button").click();
        await statusIs(page, /^Finished/);
        const finished = await dock(page);
        assert.match(finished.dpsText, /^[\d,]+\.\d DPS$/);
        assertDpsShown(finished, "finished");

        // A batch, done: its average.
        await (await settingsField(page, "run-mode-batch")).check();
        await (await settingsField(page, "run-iterations")).fill(BATCH_FIGHTS);
        await closeSettings(page);
        await page.locator("#run-button").click();
        await page.waitForFunction(
          () =>
            !globalThis.document.querySelector("#area-results").hidden &&
            /^Done/.test(
              globalThis.document.getElementById("run-status-text").dataset
                .dock,
            ),
          null,
          { timeout: RUN_TIMEOUT },
        );
        await toArea(page, "fight");
        const batch = await dock(page);
        assert.match(batch.dpsText, /^[\d,]+\.\d DPS avg$/);
        assertDpsShown(batch, "batch");

        // Blocked, with the widest status.
        await toArea(page, "character");
        await page.locator(MIN).fill("50");
        await page.locator(MAX).fill("40");
        await page.locator(MAX).blur();
        await statusIs(page, /^Can't run/);
        assertDpsShown(await dock(page), "blocked");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    // The widest line each state can show, with the widest DPS beside it
    // (a dash where there is none: Ready, a batch running, blocked).
    test("the widest lines fit beside the widest DPS", async () => {
      const { context, page, errors } = await open(width, "#fight");
      try {
        const lines = [
          ["Running · 59:59", WIDEST_DPS],
          ["Paused at 59:59", WIDEST_DPS],
          ["Stopped at 59:59", WIDEST_DPS],
          ["Finished · 3,600 s", WIDEST_DPS],
          ["Done · 100k fights", WIDEST_DPS],
          ["Stopped · 99.9k", WIDEST_DPS],
          ["Running · 99.9k/100k", "—"],
          ["Ready · seed 4294967295", "—"],
          ["Can't run · Talents over cap", "—"],
          ["Can't run · Rotation errors", "—"],
        ];
        for (const [status, dps] of lines) {
          await page.evaluate(
            ({ status, dps }) => {
              const doc = globalThis.document;
              doc.getElementById("run-summary").dataset.dock =
                "Batch · 100k × 3,600 s";
              doc.getElementById("run-status-text").dataset.dock = status;
              doc.getElementById("run-dps-value").textContent = dps;
            },
            { status, dps },
          );
          assertDpsShown(await dock(page), status);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("a double tap on Run starts the run, not Run then Pause (N3)", async () => {
      const { context, page, errors } = await open(width, "#fight");
      try {
        await (
          await settingsField(page, "run-duration")
        ).fill(LONG_FIGHT_SECONDS);
        await closeSettings(page);
        await page.locator("#run-button").dblclick();
        await statusIs(page, /^Running/);
        await page.waitForTimeout(300);
        const at = await dock(page);
        assert.match(at.status, /^Running/, JSON.stringify(at));
        await page.locator("#stop-button").click();
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("no banner sits under the chrome", async () => {
      const { context, page, errors } = await open(width, "#fight");
      try {
        // A stopped batch's banner on Results, the builder's after Duplicate.
        await (await settingsField(page, "run-mode-batch")).check();
        await (await settingsField(page, "run-iterations")).fill("100000");
        await closeSettings(page);
        await page.locator("#run-button").click();
        await page.waitForFunction(
          () => !globalThis.document.querySelector("#area-results").hidden,
        );
        await page.waitForTimeout(300);
        await page.locator("#stop-button").click();
        await page.locator(".results-banner").first().waitFor();
        await assertBannersClear(page, ".results-banner");
        await toArea(page, "rotation");
        await page
          .locator("#rotation-builder li.rule [data-key$='.dup']")
          .first()
          .click();
        await page.locator("#rb-warnings").waitFor({ state: "visible" });
        await assertBannersClear(page, ".rot-banner");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("the dock sits above the safe-area inset", async () => {
      const { context, page, errors } = await open(width);
      try {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { bottom: SAFE_AREA_PX },
        });
        await page.waitForTimeout(100);
        const at = await dock(page);
        const nav = await page.evaluate(() => {
          const nav = globalThis.document.getElementById("area-nav");
          return {
            paddingBottom: parseFloat(getComputedStyle(nav).paddingBottom),
            chromeBottom: parseFloat(
              getComputedStyle(
                globalThis.document.documentElement,
              ).getPropertyValue("--chrome-bottom"),
            ),
          };
        });
        assert.equal(at.nav.bottom, at.height, JSON.stringify(at));
        assert.equal(nav.paddingBottom, SAFE_AREA_PX, JSON.stringify(nav));
        assert.equal(nav.chromeBottom, DOCK_PX + SAFE_AREA_PX);
        assert.equal(at.height - at.strip.top, DOCK_PX + SAFE_AREA_PX);
        assert.equal(at.strip.bottom, at.nav.top);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

// Each banner, scrolled to the top and to the foot of the screen, is clear of
// the chrome: below the top bar or the builder's pinned messages (when it is
// not one of them), above the dock and nav.
async function assertBannersClear(page, selector) {
  for (const block of ["start", "end"]) {
    const at = await page.evaluate(
      ({ selector, block }) => {
        const doc = globalThis.document;
        const root = getComputedStyle(doc.documentElement);
        const length = (name) => parseFloat(root.getPropertyValue(name));
        return [...doc.querySelectorAll(selector)]
          .filter((banner) => banner.checkVisibility())
          .map((banner) => {
            banner.scrollIntoView({ block });
            const pinned = [...doc.querySelectorAll(".builder-messages")].find(
              (box) =>
                box.checkVisibility() &&
                getComputedStyle(box).position === "sticky" &&
                !box.contains(banner),
            );
            const box = banner.getBoundingClientRect();
            return {
              block,
              top: box.top,
              bottom: box.bottom,
              ceiling:
                length("--chrome-top") +
                (pinned?.getBoundingClientRect().height ?? 0),
              floor: globalThis.innerHeight - length("--chrome-bottom"),
            };
          });
      },
      { selector, block },
    );
    assert.ok(at.length > 0, `a ${selector} is shown`);
    for (const one of at) {
      assert.ok(one.top >= one.ceiling - 1, JSON.stringify(one));
      assert.ok(one.bottom <= one.floor + 1, JSON.stringify(one));
    }
  }
}

describe(`the desktop at ${DESKTOP_WIDTH}`, () => {
  test("keeps the sticky top bar, with no dock", async () => {
    const { context, page, errors } = await open(DESKTOP_WIDTH);
    try {
      for (const area of ["character", "rotation", "fight", "results"]) {
        await toArea(page, area);
        await page.evaluate(() =>
          globalThis.scrollTo(0, globalThis.document.body.scrollHeight),
        );
        const at = await page.evaluate(() => {
          const doc = globalThis.document;
          const controls = doc.getElementById("run-controls");
          const style = getComputedStyle(controls);
          const root = getComputedStyle(doc.documentElement);
          return {
            position: style.position,
            // Scrolled past the bar's place in the page.
            scrolled: globalThis.scrollY > controls.offsetTop,
            top: style.top,
            boxTop: controls.getBoundingClientRect().top,
            barHeight: controls.getBoundingClientRect().height,
            strip: getComputedStyle(doc.getElementById("run-bar")).position,
            dps: doc.getElementById("run-dps").checkVisibility(),
            chromeTop: parseFloat(root.getPropertyValue("--chrome-top")),
            chromeBottom: parseFloat(root.getPropertyValue("--chrome-bottom")),
          };
        });
        assert.equal(at.position, "sticky", area);
        assert.equal(at.top, "0px", area);
        if (at.scrolled) {
          assert.equal(at.boxTop, 0, `${area} still at the top when scrolled`);
        }
        assert.notEqual(at.strip, "fixed", area);
        assert.equal(at.dps, false, area);
        assert.ok(Math.abs(at.chromeTop - at.barHeight) <= 1, area);
        assert.equal(at.chromeBottom, 0, area);
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
