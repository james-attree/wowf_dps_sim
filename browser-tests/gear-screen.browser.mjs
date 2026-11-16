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

  test("empty main hand disables Run with a clear reason", async () => {
    // coordinator call 16 Nov (James delegated).
    const { context, page, errors } = await open(1280);
    try {
      await page.click("#gear-slot-mainHand");
      await page.locator("#gear-opt-empty").click();
      assert.equal(await page.locator("#run-button").isDisabled(), true);
      const reason =
        (await page.locator("#run-reason").innerText()) +
        " " +
        (await page.locator("#run-status-text").innerText()) +
        " " +
        (await page.locator("#cfg-form-error").innerText()) +
        " " +
        (await page.locator("#gear-mh-block").innerText());
      assert.match(reason, /Equip a main-hand weapon|Can't run|setting/);
      const weapons = await page.evaluate(
        () => globalThis.__store.get().config.weapons,
      );
      assert.equal(weapons.mainHand, null);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("empty off hand leaves Run on and clears the axe from config", async () => {
    // coordinator call 16 Nov (James delegated): MH-only, do not block Run.
    const { context, page, errors } = await open(1280);
    try {
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      await page.click("#gear-slot-offHand");
      await page.locator("#gear-opt-empty").click();
      assert.equal(
        (
          await page.locator("#gear-slot-offHand .gear-slot-name").innerText()
        ).trim(),
        "Empty",
      );
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      const weapons = await page.evaluate(
        () => globalThis.__store.get().config.weapons,
      );
      assert.equal(weapons.offHand, null);
      assert.ok(weapons.mainHand);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the phone picker is a dialog above the dock (P2)", async () => {
    const { context, page, errors } = await open(360);
    try {
      await page.click("#gear-slot-chest");
      const picker = page.locator("#gear-picker");
      await picker.waitFor({ state: "visible" });
      assert.equal(await picker.getAttribute("role"), "dialog");
      assert.equal(await picker.getAttribute("aria-modal"), "true");
      const stack = await page.evaluate(() => {
        const picker = document.getElementById("gear-picker");
        const dock = document.getElementById("run-bar");
        const nav = document.getElementById("area-nav");
        const z = (el) => Number.parseFloat(getComputedStyle(el).zIndex);
        const suffix = document.getElementById("gear-suffix");
        const suffixBox = suffix.getBoundingClientRect();
        const dockBox = dock.getBoundingClientRect();
        return {
          pickerZ: z(picker),
          dockZ: z(dock),
          navZ: z(nav),
          suffixBottom: suffixBox.bottom,
          dockTop: dockBox.top,
        };
      });
      assert.ok(stack.pickerZ > stack.dockZ, "picker above the dock");
      assert.ok(stack.pickerZ > stack.navZ, "picker above the nav");
      assert.ok(
        stack.suffixBottom <= stack.dockTop + 1,
        "suffix is not under the dock",
      );
      const last = page
        .locator("#gear-picker select, #gear-picker-close")
        .last();
      await last.focus();
      await page.keyboard.press("Tab");
      const stayed = await page.evaluate(() =>
        document.getElementById("gear-picker").contains(document.activeElement),
      );
      assert.equal(stayed, true, "Tab is trapped in the phone picker");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("right-hand slots stay icon-left when the 20rem fallback stacks (P3)", async () => {
    const { context, page, errors } = await open(1024, "150%");
    try {
      const side = await page.evaluate(() => {
        const face = document.querySelector("#gear-slot-hands .gear-slot-face");
        const name = document.querySelector("#gear-slot-hands .gear-slot-name");
        return {
          face: face.getBoundingClientRect().left,
          name: name.getBoundingClientRect().left,
          figure: getComputedStyle(document.getElementById("gear-figure"))
            .display,
        };
      });
      assert.equal(side.figure, "none");
      assert.ok(side.face < side.name, "hands icon is on the left");
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

describe("read-only stats and gear builds (#385)", () => {
  test("the typed sheet and the 0.65rem phone summary are gone", async () => {
    const { context, page, errors } = await open(
      360,
      "100%",
      "#character/stats",
    );
    try {
      assert.equal(await page.locator("#cfg-character-attackPower").count(), 0);
      assert.equal(await page.locator("#cfg-character-haste").count(), 0);
      assert.equal(await page.locator("#cfg-weapons-mainHand-min").count(), 0);
      const size = await page.evaluate(() => {
        const node = document.getElementById("character-stats-summary");
        return getComputedStyle(node).fontSize;
      });
      const root = await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      );
      assert.ok(
        Number.parseFloat(size) / root > 0.7,
        `summary is not the cramped 0.65rem size (got ${size} over ${root})`,
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Tab from the last picker control wraps to the first, and Shift+Tab the other way (N1)", async () => {
    const { context, page, errors } = await open(360);
    try {
      await page.click("#gear-slot-chest");
      const picker = page.locator("#gear-picker");
      await picker.waitFor({ state: "visible" });
      const count = await page.evaluate(() => {
        const items = (function tabbable() {
          const root = document.getElementById("gear-picker");
          return [
            ...root.querySelectorAll(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ].filter((node) => {
            if (node.disabled || node.hidden) return false;
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") {
              return false;
            }
            return node.tabIndex >= 0;
          });
        })();
        items[0]?.setAttribute("data-trap", "first");
        items.at(-1)?.setAttribute("data-trap", "last");
        return items.length;
      });
      assert.ok(count >= 2, "the picker has more than one tab stop");
      await page.evaluate(() => {
        document.querySelector("#gear-picker [data-trap=last]").focus();
      });
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("data-trap"),
        ),
        "first",
      );
      await page.evaluate(() => {
        document.querySelector("#gear-picker [data-trap=first]").focus();
      });
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("data-trap"),
        ),
        "last",
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the picker's heading does not skip a level with the picker open", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await page.click("#gear-slot-chest");
      await page.locator("#gear-picker").waitFor({ state: "visible" });
      const ranks = await page.evaluate(() =>
        [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
          .filter((node) => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              box.height > 0 &&
              box.width > 0
            );
          })
          .map((node) => Number(node.tagName.slice(1))),
      );
      assert.ok(ranks.includes(2), "the picker title is an h2");
      for (let i = 1; i < ranks.length; i += 1) {
        assert.ok(
          ranks[i] <= ranks[i - 1] + 1,
          `heading order ${ranks.join(" → ")} skips a level`,
        );
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the 3-column doll at 1024 / 100% does not mid-word wrap", async () => {
    const { context, page, errors } = await open(1024, "100%");
    try {
      const wrap = await page.evaluate(() => {
        const name = document.querySelector("#gear-slot-head .gear-slot-name");
        const copy = document.querySelector("#gear-slot-head .gear-slot-copy");
        const style = (node) => {
          const computed = getComputedStyle(node);
          return {
            overflowWrap: computed.overflowWrap,
            wordBreak: computed.wordBreak,
            display: getComputedStyle(document.getElementById("gear-figure"))
              .display,
          };
        };
        return { name: style(name), copy: style(copy) };
      });
      assert.notEqual(
        wrap.name.display,
        "none",
        "the 3-column figure is shown",
      );
      assert.notEqual(wrap.name.overflowWrap, "anywhere");
      assert.notEqual(wrap.copy.overflowWrap, "anywhere");
      assert.notEqual(wrap.name.wordBreak, "break-word");
      assert.notEqual(wrap.copy.wordBreak, "break-word");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("builds can be saved, loaded, renamed and deleted, with name guards", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await page.fill("#gear-save-name", "   ");
      await page.click("#gear-save-build");
      assert.match(
        await page.locator("#gear-builds-live").innerText(),
        /Enter a name/,
      );
      await page.fill("#gear-save-name", "Raid P1");
      await page.click("#gear-save-build");
      await page.waitForFunction(() =>
        document
          .getElementById("gear-builds-live")
          .textContent.includes("saved"),
      );
      const names = await page
        .locator(".gear-build-name span")
        .allTextContents();
      assert.ok(names.some((name) => name.includes("Raid P1")));
      await page.fill("#gear-save-name", "Raid P1");
      await page.click("#gear-save-build");
      assert.match(
        await page.locator("#gear-builds-live").innerText(),
        /already exists/,
      );
      const row = page.locator(".gear-build-row", { hasText: "Raid P1" });
      await row.locator("button[data-act='rename']").click();
      await page
        .locator(".gear-build-row input[aria-label='New name']")
        .fill("Raid P1b");
      await page
        .locator(".gear-build-row button", { hasText: "Save name" })
        .click();
      await page.waitForFunction(() =>
        document.body.innerText.includes("Raid P1b"),
      );
      await page
        .locator(".gear-build-row", { hasText: "Raid P1b" })
        .locator("button[data-act='remove']")
        .click();
      await page.waitForFunction(
        () => !document.body.innerText.includes("Raid P1b"),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("a storage failure is shown in the live region", async () => {
    const { context, page, errors } = await open(1280);
    try {
      await page.evaluate(() => {
        const storage = document.defaultView.localStorage;
        storage.setItem = () => {
          throw new Error("full");
        };
      });
      await page.fill("#gear-save-name", "Full store");
      await page.click("#gear-save-build");
      const live = page.locator("#gear-builds-live");
      await live.waitFor({ state: "visible" });
      assert.match(await live.innerText(), /could not be saved/);
      assert.equal(await live.getAttribute("role"), "status");
      const polite = await live.getAttribute("aria-live");
      assert.ok(polite === "polite" || polite === "assertive");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("a gear build at level 40 blocks Run; a legacy sheet does not", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/gear",
    );
    try {
      await page.evaluate(() => {
        document.location.hash = "#character/talents";
      });
      await page.locator("#talents-level").waitFor({ state: "visible" });
      await page.locator("#talents-reset").click();
      await page.waitForFunction(() =>
        /\b0 of \d+/.test(
          document.querySelector("#talents-points")?.textContent ?? "",
        ),
      );
      await page.fill("#talents-level", "40");
      await page.locator("#talents-level").blur();
      assert.equal(await page.locator("#run-button").isDisabled(), true);
      await page.evaluate(() => {
        document.location.hash = "#character/gear";
      });
      await page.locator("#gear-level-block").waitFor({ state: "visible" });
      assert.match(
        await page.locator("#gear-level-block").innerText(),
        /level 60 only/,
      );
      await page.evaluate(() => {
        document.location.hash = "#character/talents";
      });
      await page.locator("#talents-level").waitFor({ state: "visible" });
      await page.evaluate(() => {
        const { config } = globalThis.__store.get();
        const next = structuredClone(config);
        delete next.gear;
        globalThis.__store.set({ config: next });
      });
      // store.set of config alone does not refresh form errors; change the
      // level so the talent subscription re-runs formWithGearErrors.
      await page.fill("#talents-level", "41");
      await page.locator("#talents-level").blur();
      await page.fill("#talents-level", "40");
      await page.locator("#talents-level").blur();
      // A legacy sheet still runs at any level.
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      await page.evaluate(() => {
        document.location.hash = "#character/stats";
      });
      await page.locator("#gear-legacy").waitFor({ state: "visible" });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
