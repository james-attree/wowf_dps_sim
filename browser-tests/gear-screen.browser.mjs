// #297 PR6 (#384): paper doll, item search and the derived stats panel.
// Journeys at 360 / 1024 / 1280 (and 390 / 1440 for overflow), keyboard
// only, 44 px audit, axe, 100% / 150% text. Goldens are not touched.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const AXE = await readFile(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];
const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [360, 1024, 1280];
const OVERFLOW = [360, 390, 1024, 1440];
const TEXT = ["100%", "150%"];
const SCREEN_HEIGHT = 900;
const SEARCH_START = 2;
const RESULT_CAP = 20;

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

async function open(width, text = "100%", hash = "#character/gear") {
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
  await page.goto(`${base}?e2e${hash}`, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `html { font-size: ${text} !important; }`,
  });
  await page.waitForFunction(() => globalThis.__store != null);
  await page.locator("#gear-screen").waitFor({ state: "visible" });
  return { context, page, errors };
}

function smallTargets() {
  const doc = globalThis.document;
  const SELECTOR = [
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='option']",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");
  const landsOn = (control) => {
    if (control.tagName !== "INPUT") {
      return control;
    }
    const label =
      control.closest("label") ??
      (control.id ? doc.querySelector(`label[for="${control.id}"]`) : null);
    const own = control.getBoundingClientRect();
    const tiny = own.width <= 1 || own.height <= 1;
    const check = control.type === "radio" || control.type === "checkbox";
    return label && (check || tiny) ? label : control;
  };
  return [...doc.querySelectorAll(SELECTOR)]
    .filter((node) => {
      if (
        node.disabled ||
        node.hidden ||
        node.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }
      const style = doc.defaultView.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const box = landsOn(node).getBoundingClientRect();
      if (box.width === 0 && box.height === 0) {
        return false;
      }
      return box.width < 44 - 0.5 || box.height < 44 - 0.5;
    })
    .map((node) => {
      const box = landsOn(node).getBoundingClientRect();
      return {
        id: node.id || node.getAttribute("data-slot") || node.tagName,
        width: box.width,
        height: box.height,
      };
    });
}

describe("gear screen paper doll (#384)", () => {
  for (const width of WIDTHS) {
    for (const text of TEXT) {
      test(`P1 doll and stats at ${width} ${text} (M20)`, async () => {
        const { context, page, errors } = await open(width, text);
        try {
          assert.equal(await page.locator("#gear-build-ui").isVisible(), true);
          assert.match(
            await page.locator("#gear-lead").innerText(),
            /Level 60 Human rogue/,
          );
          assert.equal(
            (
              await page
                .locator("#gear-slot-mainHand .gear-slot-name")
                .innerText()
            ).trim(),
            "The Lobotomizer",
          );
          assert.match(
            await page.locator("#gear-slot-mainHand").innerText(),
            /Epic/,
          );
          assert.equal(
            (
              await page
                .locator("#gear-slot-offHand .gear-slot-name")
                .innerText()
            ).trim(),
            "Dark Iron Destroyer",
          );
          const stats = await page.locator("#gear-stats-list").innerText();
          assert.match(stats, /608/);
          assert.match(stats, /18\.0%/);
          assert.match(stats, /8\.7%/);
          assert.match(stats, /121/);
          assert.match(stats, /289/);
          const shouldShowFigure = await page.evaluate(() => {
            const rem = Number.parseFloat(
              globalThis.getComputedStyle(globalThis.document.documentElement)
                .fontSize,
            );
            const screen = globalThis.document.getElementById("gear-screen");
            return (
              globalThis.matchMedia("(width >= 64em)").matches &&
              screen.getBoundingClientRect().width >= 20 * rem
            );
          });
          assert.equal(
            await page.locator("#gear-figure").isVisible(),
            shouldShowFigure,
          );
          assert.equal(
            await page.locator("#gear-credit-link").getAttribute("href"),
            "https://github.com/wowsims/forever",
          );
          assert.match(
            (await page.locator("#gear-credit").innerText()).trim(),
            /Item data from wowsims\/forever \(MIT\)\./,
          );
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  test("typing two letters searches, one letter does not (M21)", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await page.click("#gear-slot-chest");
      await page.locator("#gear-search").waitFor({ state: "visible" });
      assert.equal(await page.locator("#gear-opt-empty").isVisible(), true);
      await page.fill("#gear-search", "s");
      const hint = await page.locator("#gear-search-status").innerText();
      assert.match(hint, /Type at least two letters/);
      assert.equal(await page.locator("#gear-list [role='option']").count(), 1);
      await page.fill("#gear-search", "sh");
      const status = await page.locator("#gear-search-status").innerText();
      assert.match(status, /\d+ matches/);
      const count = await page.locator("#gear-list [role='option']").count();
      assert.ok(count >= SEARCH_START);
      assert.ok(count <= RESULT_CAP + 1, "Leave empty plus at most 20 hits");
      if (count === RESULT_CAP + 1) {
        assert.match(status, /Refine your search/);
      }
      const names = await page
        .locator("#gear-list [role='option']")
        .allInnerTexts();
      assert.ok(names.some((text) => /Leave empty/.test(text)));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("keyboard: arrows, Enter, Escape, and Leave empty (M22)", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await page.click("#gear-slot-ranged");
      const search = page.locator("#gear-search");
      await search.waitFor({ state: "visible" });
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "gear-search",
      );
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await search.getAttribute("aria-activedescendant"),
        "gear-opt-empty",
      );
      await page.fill("#gear-search", "fahrad");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#gear-picker").isVisible(), true);
      assert.match(
        await page.locator("#gear-slot-ranged .gear-slot-name").innerText(),
        /Fahrad/,
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#gear-picker").isVisible(), false);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "gear-slot-ranged",
      );
      await page.keyboard.press("Enter");
      await search.waitFor({ state: "visible" });
      await page.keyboard.press("Enter");
      assert.equal(
        (
          await page.locator("#gear-slot-ranged .gear-slot-name").innerText()
        ).trim(),
        "Empty",
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("a unique ring is omitted from the other finger (M23)", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await page.click("#gear-slot-finger2");
      await page.fill("#gear-search", "don jul");
      const texts = await page
        .locator("#gear-list [role='option']")
        .allInnerTexts();
      assert.equal(
        texts.some((text) => text.includes("Don Julio's Band")),
        false,
      );
      await page.keyboard.press("Escape");
      await page.click("#gear-slot-finger1");
      await page.fill("#gear-search", "don jul");
      const first = await page
        .locator("#gear-list [role='option']")
        .allInnerTexts();
      assert.ok(first.some((text) => text.includes("Don Julio's Band")));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Clear empties the query, not the slot (M24)", async () => {
    const { context, page, errors } = await open(1280);
    try {
      const before = (
        await page.locator("#gear-slot-head .gear-slot-name").innerText()
      ).trim();
      await page.click("#gear-slot-head");
      await page.fill("#gear-search", "ra");
      await page.click("#gear-search-clear");
      assert.equal(await page.locator("#gear-search").inputValue(), "");
      assert.match(
        await page.locator("#gear-search-status").innerText(),
        /Type at least two letters/,
      );
      assert.equal(
        (
          await page.locator("#gear-slot-head .gear-slot-name").innerText()
        ).trim(),
        before,
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("no-results copy keeps Leave empty (M25)", async () => {
    const { context, page, errors } = await open(360);
    try {
      await page.click("#gear-slot-feet");
      await page.locator("#gear-picker").waitFor({ state: "visible" });
      await page.fill("#gear-search", "viskag");
      assert.match(
        await page.locator("#gear-search-status").innerText(),
        /No feet items match “viskag”/,
      );
      assert.equal(await page.locator("#gear-list [role='option']").count(), 1);
      assert.match(
        await page.locator("#gear-opt-empty").innerText(),
        /Leave empty/,
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("empty main hand warns on the gear screen (M26)", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await page.click("#gear-slot-mainHand");
      await page.locator("#gear-opt-empty").click();
      assert.equal(await page.locator("#gear-mh-block").isVisible(), true);
      assert.equal(
        (await page.locator("#gear-mh-block").innerText()).trim(),
        "Equip a main-hand weapon.",
      );
      assert.equal(
        (
          await page.locator("#gear-slot-mainHand .gear-slot-name").innerText()
        ).trim(),
        "Empty",
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe("gear screen overflow, targets and axe (#384)", () => {
  for (const width of OVERFLOW) {
    for (const text of TEXT) {
      test(`no sideways scroll at ${width} ${text} (M27)`, async () => {
        const { context, page, errors } = await open(width, text);
        try {
          const overflow = await page.evaluate(() => {
            const root = document.documentElement;
            return {
              scroll: root.scrollWidth - root.clientWidth,
              body: document.body.scrollWidth - document.body.clientWidth,
            };
          });
          assert.ok(overflow.scroll <= 1, `html scroll ${overflow.scroll}`);
          assert.ok(overflow.body <= 1, `body scroll ${overflow.body}`);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  for (const width of WIDTHS) {
    for (const text of TEXT) {
      test(`44px targets at ${width} ${text} (M28)`, async () => {
        const { context, page, errors } = await open(width, text);
        try {
          await page.click("#gear-slot-chest");
          await page.locator("#gear-search").waitFor({ state: "visible" });
          await page.fill("#gear-search", "sh");
          const small = await page.evaluate(smallTargets);
          assert.deepEqual(small, [], JSON.stringify(small, null, 2));
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });

      test(`axe at ${width} ${text} (M29)`, async () => {
        const { context, page, errors } = await open(width, text);
        try {
          await page.addScriptTag({ content: AXE });
          const results = await page.evaluate(async (tags) => {
            const run = await globalThis.axe.run(document, {
              runOnly: { type: "tag", values: tags },
            });
            return run.violations.map((violation) => ({
              id: violation.id,
              nodes: violation.nodes.map((node) => node.target),
            }));
          }, AXE_TAGS);
          assert.deepEqual(results, []);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  test("item tooltip names quality in text (M30)", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await page.click("#gear-slot-mainHand");
      await page.fill("#gear-search", "lo");
      const well = page.locator("#gear-item-tooltip");
      if (await well.isVisible()) {
        const text = await well.innerText();
        assert.match(text, /Epic|Rare|Legendary|Uncommon|Common/);
        const color = await well.evaluate(
          (node) => getComputedStyle(node).borderColor,
        );
        assert.doesNotMatch(color, /rgb\(0,\s*112,\s*221\)/);
        assert.doesNotMatch(color, /rgb\(163,\s*53,\s*238\)/);
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
