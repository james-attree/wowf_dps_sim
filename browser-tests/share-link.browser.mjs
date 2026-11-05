// #284 (P5-07, H6-lite): "Copy link to this build" by "Rogue" and on the
// Results run label, its feedback, the fallback field when the clipboard
// refuses, the 8 KB cap, and opening a link (the banner, the build restored,
// ?s= taken out). At 320, 1024 and 1440, with DejaVu pinned as CI has it.
// SHARE_SHOTS=<dir> saves screenshots there.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import {
  LINK_PARAM,
  LINK_VERSION,
  decodeSetup,
  setupDefaults,
  shareUrl,
} from "../js/build-codec.js";
import { defaultRotation } from "../js/rotation-default.js";
import { referenceBuild } from "../js/preset-reference-builds.js";
import { presetRotation } from "../js/rotation-presets.js";
import { editedName } from "../js/config-form.js";
import { SAVED_SETUP_KEY } from "../js/saved-setup.js";
import { k } from "../data/constants.js";
import {
  BUTTON_NAMES,
  BUTTON_TEXT,
  COPIED_MS,
  COPIED_TEXT,
  NOTICES,
} from "../js/views/share-link.js";

const PINNED_FONT = "DejaVu Sans";
const WIDTHS = [320, 1024, 1440];
const SCREEN_HEIGHT = 900;
const TARGET_LEAST = 44;
const SHOTS = process.env.SHARE_SHOTS ?? null;
const HASTE = "#cfg-character-haste";
const POWER = "#cfg-character-attackPower";
const SEED = "424242";
const LENGTH = "120";
const FIVE = "5";
const POWER_VALUE = "900";
const TOO_LONG =
  "This rotation is too long to share as a link. Export it as a file instead (Rotation › Export or import).";
const SHARE_HINT =
  "To share talents, gear and the rotation together, use Copy link to this build, at the top of the page and on Results.";

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

// clipboard: "allow" (permission granted), "reject" (writeText rejects) or
// "missing" (no navigator.clipboard).
async function open(width, address, { clipboard = "allow" } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
  });
  if (clipboard === "allow") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: base,
    });
  } else {
    await context.addInitScript((how) => {
      const nav = document.defaultView.navigator;
      if (how === "missing") {
        Object.defineProperty(nav, "clipboard", { value: undefined });
      } else {
        Object.defineProperty(nav, "clipboard", {
          value: { writeText: () => Promise.reject(new Error("denied")) },
        });
      }
    }, clipboard);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(address.startsWith("http") ? address : `${base}${address}`);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

const go = async (page, hash, selector) => {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

const set = async (page, hash, selector, value) => {
  await go(page, hash, selector);
  await page.locator(selector).fill(value);
  await page.locator(selector).blur();
};

const text = async (page, selector) =>
  ((await page.locator(selector).textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();

const shot = async (page, width, name) => {
  if (SHOTS !== null) {
    await page.screenshot({ path: path.join(SHOTS, `${width}-${name}.png`) });
  }
};

const fitsPage = (page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

const height = (page, selector) =>
  page
    .locator(selector)
    .evaluate((node) => node.getBoundingClientRect().height);

describe("Copy link to this build (#284)", () => {
  for (const width of WIDTHS) {
    test(`copy, feedback, and the link restores the build at ${width}`, async () => {
      const { context, page, errors } = await open(width, "#character");
      try {
        const header = page.locator("#share-link-header");
        assert.equal(await text(page, "#share-link-header"), BUTTON_TEXT);
        // Fran's #299 P2: each button's name says its row, visible text first.
        for (const [name, label] of Object.entries(BUTTON_NAMES)) {
          assert.ok(label.startsWith(BUTTON_TEXT), label);
          assert.equal(
            await page.getAttribute(`#share-link-${name}`, "aria-label"),
            label,
          );
          assert.equal(
            await page.getAttribute(`#share-link-${name}`, "aria-describedby"),
            `share-too-long-${name} share-over-cap-${name}`,
          );
        }
        assert.equal(new Set(Object.values(BUTTON_NAMES)).size, 3);
        assert.equal(
          await page
            .getByRole("button", { name: BUTTON_NAMES.header, exact: true })
            .count(),
          1,
        );
        assert.ok((await height(page, "#share-link-header")) >= TARGET_LEAST);
        assert.ok(await fitsPage(page), `${width}: the header fits`);

        // An edited build: haste, attack power, and the fight settings.
        await set(page, "#character/stats", HASTE, FIVE);
        await set(page, "#character/stats", POWER, POWER_VALUE);
        await page.evaluate(() => document.defaultView.scrollTo(0, 0));
        await go(page, "#fight", "#run-duration");
        await page.locator("#run-mode-live").check();
        await set(page, "#fight", "#run-duration", LENGTH);
        await set(page, "#fight", "#run-seed", SEED);
        await go(page, "#character", "#area-character-title");

        await header.click();
        await page.waitForFunction(
          (copied) =>
            document.getElementById("run-announce").textContent === copied,
          COPIED_TEXT,
        );
        assert.equal(await text(page, "#share-link-header"), COPIED_TEXT);
        assert.equal(
          await page.locator("#share-feedback-header").isHidden(),
          true,
        );
        await page.evaluate(() => document.defaultView.scrollTo(0, 0));
        await shot(page, width, "copied");
        const link = await page.evaluate(() =>
          document.defaultView.navigator.clipboard.readText(),
        );
        const url = new URL(link);
        assert.equal(url.origin + url.pathname, base);
        assert.equal(url.hash, "");
        // #306: a short version 2 link.
        assert.match(url.searchParams.get(LINK_PARAM), /^2\.[\w-]+$/);
        // "Link copied" for 2 s, then the label again.
        await page.waitForFunction(
          (label) =>
            document.getElementById("share-link-header").textContent.trim() ===
            label,
          BUTTON_TEXT,
          { timeout: COPIED_MS * 3 },
        );

        // The Results run label's button copies the same build.
        await go(page, "#results/average", "#share-link-average");
        assert.ok((await height(page, "#share-link-average")) >= TARGET_LEAST);
        await page.locator("#share-link-average").click();
        await page.waitForFunction(
          (copied) =>
            document.getElementById("share-link-average").textContent.trim() ===
            copied,
          COPIED_TEXT,
        );
        assert.equal(
          await page.evaluate(() =>
            document.defaultView.navigator.clipboard.readText(),
          ),
          link,
        );
        assert.ok(await fitsPage(page), `${width}: the Results row fits`);
        await shot(page, width, "results-row");
        assert.deepEqual(errors, []);

        // Opening the link elsewhere restores the build.
        const other = await open(width, link);
        try {
          const { page: opened } = other;
          const banner = opened.locator("#share-banner");
          await banner.waitFor({ state: "visible" });
          assert.equal(
            await text(opened, "#share-banner-text"),
            NOTICES.loaded,
          );
          // Under the shown area's h1.
          assert.equal(
            await opened.evaluate(
              () =>
                document.getElementById("share-banner").previousElementSibling
                  ?.id,
            ),
            "area-character-title",
          );
          assert.equal(
            await opened.evaluate(() => document.location.search),
            "",
          );
          assert.ok(await fitsPage(opened), `${width}: the banner fits`);
          await shot(opened, width, "restored");
          await go(opened, "#character/stats", HASTE);
          assert.equal(await opened.locator(HASTE).inputValue(), FIVE);
          assert.equal(await opened.locator(POWER).inputValue(), POWER_VALUE);
          // The banner follows the route to the shown area's h1.
          assert.equal(
            await opened.evaluate(
              () =>
                document.getElementById("share-banner").previousElementSibling
                  ?.id,
            ),
            "area-character-title",
          );
          await go(opened, "#fight", "#run-duration");
          assert.equal(
            await opened.locator("#run-duration").inputValue(),
            LENGTH,
          );
          assert.equal(await opened.locator("#run-seed").inputValue(), SEED);
          assert.equal(
            await opened.locator("#run-mode-live").isChecked(),
            true,
          );
          assert.equal(
            await opened.evaluate(
              () =>
                document.getElementById("share-banner").previousElementSibling
                  ?.id,
            ),
            "area-fight-title",
          );
          await opened.locator("#share-banner-close").click();
          assert.equal(await banner.isHidden(), true);
          // ?s= is gone, so a reload does not load the link over later edits.
          await opened.reload();
          await opened.locator("#run-button").waitFor({ state: "attached" });
          assert.equal(await banner.isHidden(), true);
          assert.deepEqual(other.errors, []);
        } finally {
          await other.context.close();
        }
      } finally {
        await context.close();
      }
    });

    test(`a refused or missing clipboard shows the link to copy at ${width}`, async () => {
      for (const clipboard of ["reject", "missing"]) {
        const { context, page, errors } = await open(width, "#character", {
          clipboard,
        });
        try {
          await page.locator("#share-link-header").click();
          const field = page.locator("#share-url-header");
          await field.waitFor({ state: "visible" });
          assert.equal(
            await text(page, "label[for=share-url-header]"),
            "Couldn't copy automatically. Copy this link:",
          );
          assert.equal(await field.getAttribute("readonly"), "");
          const value = await field.inputValue();
          assert.match(value, /\?s=2\./);
          const selected = await field.evaluate(
            (node) =>
              document.activeElement === node &&
              node.selectionStart === 0 &&
              node.selectionEnd === node.value.length,
          );
          assert.ok(selected, `${clipboard}: the link is selected`);
          assert.equal(await text(page, "#share-link-header"), BUTTON_TEXT);
          assert.ok(await fitsPage(page), `${width}: the field fits`);
          if (clipboard === "reject") await shot(page, width, "fallback");
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      }
    });
  }

  test("a link over 8 KB says to export the rotation, and the button stays", async () => {
    // Not the base's own rule: a version-2 link sends that as a reference
    // (#306), so a rule of its own (25 energy made 26) fills the link.
    const first = defaultRotation().rules[0];
    const rule = {
      ...first,
      conditions: first.conditions.map((c) =>
        c.type === "resource" ? { ...c, value: c.value + 1 } : c,
      ),
    };
    const d = setupDefaults();
    const rotation = {
      ...defaultRotation(),
      rules: Array.from({ length: k("rotation.maxRules") }, () => rule),
    };
    const link = shareUrl(base, {
      config: { ...d.config, rotation },
      run: d.run,
    });
    for (const width of WIDTHS) {
      const { context, page, errors } = await open(width, link);
      try {
        assert.equal(await text(page, "#share-banner-text"), NOTICES.loaded);
        assert.equal(
          await page.evaluate(
            () =>
              getComputedStyle(document.getElementById("share-banner"))
                .borderTopColor,
          ),
          "rgb(231, 189, 85)",
        );
        await go(page, "#results/average", "#share-link-average");
        await page.locator("#share-link-average").click();
        await page
          .locator("#share-too-long-average")
          .waitFor({ state: "visible" });
        assert.equal(await text(page, "#share-too-long-average"), TOO_LONG);
        // Fran's #299 P1: said aloud, not only shown.
        await page.waitForFunction(
          (said) =>
            document.getElementById("run-announce").textContent === said,
          TOO_LONG,
        );
        assert.equal(
          await page.locator("#share-link-average").isDisabled(),
          false,
        );
        assert.equal(
          await page.locator("#share-fallback-average").isHidden(),
          true,
        );
        await shot(page, width, "too-long");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  });

  test("a newer or damaged link loads nothing and says so", async () => {
    const newer = `${base}?${LINK_PARAM}=${LINK_VERSION + 1}.e30#character/stats`;
    const damaged = `${base}?${LINK_PARAM}=1.not-json#character/stats`;
    // #306: a version 2 link with a byte too many.
    const damagedV2 = `${base}?${LINK_PARAM}=2.AAAA#character/stats`;
    for (const [address, notice] of [
      [newer, NOTICES.newer],
      [damaged, NOTICES.corrupt],
      [damagedV2, NOTICES.corrupt],
    ]) {
      const { context, page, errors } = await open(WIDTHS[0], address);
      try {
        assert.equal(await text(page, "#share-banner-text"), notice);
        assert.match(notice, /Nothing was loaded/);
        // Fran's #299 P4: a warning does not look like the success banner.
        const border = await page.evaluate(
          () =>
            getComputedStyle(document.getElementById("share-banner"))
              .borderTopColor,
        );
        assert.equal(border, "rgb(241, 147, 137)");
        await page.locator(HASTE).waitFor({ state: "visible" });
        assert.equal(await page.locator(HASTE).inputValue(), "0");
        assert.equal(
          await page.evaluate(() => document.location.href),
          `${base}#character/stats`,
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  });

  test("Rotation › Export or import points to Copy link to this build", async () => {
    const { context, page } = await open(WIDTHS[0], "#rotation/share");
    try {
      await page.locator(".share-hint").waitFor({ state: "visible" });
      assert.equal(await text(page, ".share-hint"), SHARE_HINT);
    } finally {
      await context.close();
    }
  });

  // #306: a preset with a typical edit copies as a short link, and the link
  // opens that build in a fresh browser (the saved setup it leaves is still
  // version 1).
  // TR-02 / #332: empty presets until #333
test.skip("a preset's link is short, and it opens the build elsewhere (#306)", async () => {
    const PRESET_LINK_MAX = 64;
    const SPEED = "#cfg-weapons-mainHand-speed";
    const { context, page, errors } = await open(WIDTHS[1], "#character");
    try {
      await page.locator("#start-card-combat-swords").click();
      await page.locator("#start-applied").waitFor({ state: "visible" });
      await set(page, "#character/gear", SPEED, "1.9");
      await page.evaluate(() => document.defaultView.scrollTo(0, 0));
      await page.locator("#share-link-header").click();
      await page.waitForFunction(
        (copied) =>
          document.getElementById("run-announce").textContent === copied,
        COPIED_TEXT,
      );
      const link = await page.evaluate(() =>
        document.defaultView.navigator.clipboard.readText(),
      );
      assert.ok(link.startsWith(`${base}?${LINK_PARAM}=2.`), link);
      assert.ok(
        link.length - base.length <= PRESET_LINK_MAX,
        `${link.length - base.length}: ${link}`,
      );
      const read = decodeSetup(new URL(link).searchParams.get(LINK_PARAM));
      assert.equal(read.status, "ok");
      const build = referenceBuild("combat-swords");
      assert.deepEqual(read.setup.config.talents, build.talents);
      assert.equal(read.setup.config.weapons.mainHand.speed, 1.9);
      assert.deepEqual(errors, []);

      const other = await open(WIDTHS[1], link);
      try {
        const { page: opened, errors: openedErrors } = other;
        await opened.locator("#share-banner").waitFor({ state: "visible" });
        assert.equal(await text(opened, "#share-banner-text"), NOTICES.loaded);
        await go(opened, "#character/gear", SPEED);
        assert.equal(await opened.locator(SPEED).inputValue(), "1.9");
        await opened.waitForFunction(
          (key) => document.defaultView.localStorage.getItem(key) !== null,
          SAVED_SETUP_KEY,
        );
        const saved = await opened.evaluate(
          (key) => document.defaultView.localStorage.getItem(key),
          SAVED_SETUP_KEY,
        );
        assert.match(saved, /^1\./);
        assert.deepEqual(decodeSetup(saved).setup.config, read.setup.config);
        assert.deepEqual(openedErrors, []);
      } finally {
        await other.context.close();
      }
    } finally {
      await context.close();
    }
  });
  // TR-02 / #332: empty presets until #333
test.skip("a rule deleted in the builder still gives a short link (#330 B1)", async () => {
    const PRESET_LINK_MAX = 64;
    const { context, page, errors } = await open(WIDTHS[1], "#character");
    try {
      await page.locator("#start-card-combat-swords").click();
      await page.locator("#start-applied").waitFor({ state: "visible" });
      await go(page, "#rotation", "#rotation-builder");
      const rules = page.locator("#rotation-builder li.rule");
      const before = await rules.count();
      await rules.first().locator("[data-key$='.del']").click();
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll("#rotation-builder li.rule").length === n,
        before - 1,
      );
      await go(page, "#character", "#share-link-header");
      await page.evaluate(() => document.defaultView.scrollTo(0, 0));
      await page.locator("#share-link-header").click();
      await page.waitForFunction(
        (copied) =>
          document.getElementById("run-announce").textContent === copied,
        COPIED_TEXT,
      );
      const link = await page.evaluate(() =>
        document.defaultView.navigator.clipboard.readText(),
      );
      assert.ok(link.startsWith(`${base}?${LINK_PARAM}=2.`), link);
      assert.ok(
        link.length - base.length <= PRESET_LINK_MAX,
        `${link.length - base.length}: ${link}`,
      );
      const { rotation } = decodeSetup(
        new URL(link).searchParams.get(LINK_PARAM),
      ).setup.config;
      const preset = presetRotation("combat-swords");
      assert.equal(rotation.name, editedName(preset.name));
      assert.deepEqual(rotation.rules, preset.rules.slice(1));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
