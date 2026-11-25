// #287 PR 7a, Fran's #426 note: on a phone the dock covers the manual board's
// lower slot row at 360 and 320 / 150% text. That is the board's first view
// after Start, which is taller than the window. The lower row and the Waits
// must still scroll clear of the dock: by scrolling, by Tab (html's
// scroll-padding), and after a press re-renders the board. 320, 360 and
// 390, at 100% and 150% text, under Inter and with DejaVu pinned as CI has it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const PINNED_FONT = "DejaVu Sans";
const FONTS = [null, PINNED_FONT];
const TEXT_SIZES = ["100%", "150%"];
const WIDTHS = [320, 360, 390];
const HEIGHT = 844;
const SEED = "1";
// html's scroll-padding leaves 12px over the dock; allow 4px of rounding.
const MIN_GAP = 8;

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

async function openBoard(width, text, font) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}#character/start`);
  const pin = font ? `:root { font-family: "${font}" !important; } ` : "";
  await page.addStyleTag({
    content: `${pin}html { font-size: ${text} !important; }`,
  });
  await page.evaluate(() => globalThis.document.fonts.ready);
  // Subtlety has the longest slot names and the tallest board.
  await page.locator("#start-card-subtlety-daggers").evaluate((card) => {
    card.scrollIntoView({ block: "center" });
    card.click();
  });
  await page.evaluate(() => {
    globalThis.location.hash = "#fight";
  });
  await page.locator("#run-button").waitFor({ state: "visible" });
  await page.locator("#fight-mode-manual").check();
  await page.locator("#run-seed").fill(SEED);
  await page.locator("#run-seed").blur();
  await page.locator("#run-button").click();
  await page.locator(".manual-slot").first().waitFor({ state: "visible" });
  return { context, page, errors };
}

// The dock's top edge and the lowest slot row and Wait row, in the viewport.
const rows = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const tops = ["#run-bar", "#area-nav"]
      .map((selector) => doc.querySelector(selector))
      .filter(
        (node) =>
          node !== null &&
          globalThis.getComputedStyle(node).position === "fixed",
      )
      .map((node) => node.getBoundingClientRect().top);
    const lowest = (selector) =>
      Math.max(
        ...[...doc.querySelectorAll(selector)].map(
          (node) => node.getBoundingClientRect().bottom,
        ),
      );
    return {
      dock: Math.min(...tops),
      slots: lowest(".manual-slot"),
      waits: lowest(".manual-wait"),
    };
  });

const cases = [];
for (const font of FONTS) {
  for (const text of TEXT_SIZES) {
    for (const width of WIDTHS) cases.push({ font, text, width });
  }
}

describe("the manual board's lower rows clear the phone dock (#287 PR 7a)", () => {
  for (const { font, text, width } of cases) {
    const label = `${width}, ${text} text, ${font ?? "Inter"}`;

    test(`scrolling, Tab and a press keep the lower rows clear at ${label}`, async () => {
      const { context, page, errors } = await openBoard(width, text, font);
      try {
        // Scrolled to the end, the lower slot row and the Waits sit above
        // the dock.
        await page.evaluate(() =>
          globalThis.scrollTo(0, globalThis.document.body.scrollHeight),
        );
        const end = await rows(page);
        assert.ok(
          end.slots <= end.dock - MIN_GAP,
          `slot row ${end.slots} vs dock ${end.dock}`,
        );
        assert.ok(
          end.waits <= end.dock - MIN_GAP,
          `Wait row ${end.waits} vs dock ${end.dock}`,
        );

        // The board's own bottom padding gives that room: with the footer
        // under it hidden, the rows still scroll clear.
        await page.addStyleTag({
          content: ".site-footer { display: none !important; }",
        });
        await page.evaluate(() =>
          globalThis.scrollTo(0, globalThis.document.body.scrollHeight),
        );
        const bare = await rows(page);
        assert.ok(
          bare.waits <= bare.dock - MIN_GAP,
          `Wait row ${bare.waits} vs dock ${bare.dock} without the footer`,
        );

        // Tab from the first slot through every slot and Wait: each lands
        // whole between the top of the window and the dock.
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        await page.locator(".manual-slot").first().focus();
        const count = await page.locator(".manual-slot, .manual-wait").count();
        for (let index = 0; index < count; index += 1) {
          const focused = await page.evaluate(() => {
            const node = globalThis.document.activeElement;
            const dock = globalThis.document
              .getElementById("run-bar")
              .getBoundingClientRect().top;
            const { top, bottom } = node.getBoundingClientRect();
            return {
              name: node.textContent.trim().split("\n")[0],
              onBoard: node.matches(".manual-slot, .manual-wait"),
              top,
              bottom,
              dock,
            };
          });
          assert.ok(focused.onBoard, `focus left the board at ${index}`);
          assert.ok(focused.top >= 0, `${focused.name} top ${focused.top}`);
          assert.ok(
            focused.bottom <= focused.dock - MIN_GAP,
            `${focused.name} bottom ${focused.bottom} vs dock ${focused.dock}`,
          );
          await page.keyboard.press("Tab");
        }

        // Press the last Wait once it is clear; after the board re-renders,
        // the Wait row is still clear.
        const wait = page.locator(".manual-wait:not([disabled])").last();
        await wait.focus();
        await wait.click();
        await page.waitForTimeout(200);
        const pressed = await rows(page);
        assert.ok(
          pressed.waits <= pressed.dock - MIN_GAP,
          `Wait row ${pressed.waits} vs dock ${pressed.dock} after a press`,
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
