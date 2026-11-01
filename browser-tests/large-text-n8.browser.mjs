// #287, Fran's #299 check N8: at 250% text with DejaVu (as CI has it), no
// nav label breaks inside a word, no nav badge sits on a label, and the
// "Run average" label stays inside its button. At 320, 360, 1024 and 1440,
// at 100% and 250% text; every nav link and Run button stays a 44px target.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const PINNED_FONT = "DejaVu Sans";
const WIDTHS = [320, 360, 1024, 1440];
const TEXT_SIZES = ["100%", "250%"];
const SCREEN_HEIGHT = 800;
const TARGET_LEAST = 44;
// Rounding slack for a layout rect, in CSS pixels.
const EDGE = 1;
// A two-digit count, the widest badge Fran saw ("43").
const BADGE_COUNT = "43";
const ROUTES = ["#rotation/share", "#results"];
const RUN_LABEL = "Run average";

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

async function open(width, text, hash) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${hash}`);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }
      html { font-size: ${text} !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  // Every badge shown with a two-digit count: the layout's worst case.
  await page.evaluate((count) => {
    for (const badge of document.querySelectorAll(".area-nav-badge")) {
      badge.hidden = false;
      badge.textContent = count;
    }
  }, BADGE_COUNT);
  await page.evaluate(
    () => new Promise((done) => globalThis.requestAnimationFrame(() => done())),
  );
  return { context, page, errors };
}

// The nav's labels, badges and links, measured in the page.
const measureNav = (page) =>
  page.evaluate(() => {
    const box = (rect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    return [...document.querySelectorAll(".area-nav a")].map((link) => {
      const label = link.querySelector(".area-nav-label");
      const badge = link.querySelector(".area-nav-badge");
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top)),
      ).size;
      const count = document.createRange();
      count.selectNodeContents(badge);
      return {
        text: label.textContent.trim(),
        lines,
        scroll: label.scrollWidth,
        client: label.clientWidth,
        textRect: box(range.getBoundingClientRect()),
        badge: box(badge.getBoundingClientRect()),
        badgeText: box(count.getBoundingClientRect()),
        link: box(link.getBoundingClientRect()),
      };
    });
  });

const overlaps = (a, b) =>
  a.left < b.right - EDGE &&
  b.left < a.right - EDGE &&
  a.top < b.bottom - EDGE &&
  b.top < a.bottom - EDGE;

// Each shown "Run average" button and its label's lines, against the
// button's content box (inside its border and padding).
const measureRunButtons = (page, label) =>
  page.evaluate((text) => {
    const out = [];
    for (const button of document.querySelectorAll("button")) {
      const style = globalThis.getComputedStyle(button);
      if (
        !button.checkVisibility() ||
        button.textContent.trim() !== text ||
        Number.parseFloat(style.fontSize) === 0
      ) {
        continue;
      }
      const rect = button.getBoundingClientRect();
      const px = (name) => Number.parseFloat(style[name]);
      const range = document.createRange();
      range.selectNodeContents(button);
      out.push({
        id: button.id,
        height: rect.height,
        width: rect.width,
        inner: {
          left: rect.left + px("borderLeftWidth") + px("paddingLeft"),
          right: rect.right - px("borderRightWidth") - px("paddingRight"),
          top: rect.top + px("borderTopWidth"),
          bottom: rect.bottom - px("borderBottomWidth"),
        },
        lines: [...range.getClientRects()].map((line) => ({
          left: line.left,
          right: line.right,
          top: line.top,
          bottom: line.bottom,
        })),
        overflows: button.scrollWidth > button.clientWidth,
      });
    }
    return out;
  }, label);

describe("large text: the nav and Run average fit (#287, Fran's N8)", () => {
  for (const width of WIDTHS) {
    for (const text of TEXT_SIZES) {
      test(`nav labels stay whole and badges clear at ${width}, ${text}`, async () => {
        const { context, page, errors } = await open(width, text, ROUTES[0]);
        try {
          const nav = await measureNav(page);
          for (const item of nav) {
            const words = item.text.split(/\s+/).length;
            assert.ok(
              item.scroll <= item.client,
              `${item.text} overflows: ${JSON.stringify(item)}`,
            );
            assert.equal(item.lines, words, `${item.text} breaks mid-word`);
            assert.ok(
              item.link.height >= TARGET_LEAST - EDGE &&
                item.link.width >= TARGET_LEAST - EDGE,
              `${item.text} target: ${JSON.stringify(item.link)}`,
            );
            // The count stays inside its pill.
            assert.ok(
              item.badgeText.top >= item.badge.top - EDGE &&
                item.badgeText.bottom <= item.badge.bottom + EDGE,
              `${item.text} badge text: ${JSON.stringify(item)}`,
            );
          }
          for (const item of nav) {
            for (const other of nav) {
              assert.ok(
                !overlaps(item.badge, other.textRect),
                `${item.text}'s badge is on "${other.text}"`,
              );
            }
          }
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });

      test(`"${RUN_LABEL}" stays inside its button at ${width}, ${text}`, async () => {
        let seen = 0;
        for (const hash of ROUTES) {
          const { context, page, errors } = await open(width, text, hash);
          try {
            for (const button of await measureRunButtons(page, RUN_LABEL)) {
              seen += 1;
              const where = `${hash} #${button.id}: ${JSON.stringify(button)}`;
              assert.equal(button.overflows, false, where);
              assert.ok(button.height >= TARGET_LEAST - EDGE, where);
              assert.ok(button.width >= TARGET_LEAST - EDGE, where);
              for (const line of button.lines) {
                assert.ok(
                  line.left >= button.inner.left - EDGE &&
                    line.right <= button.inner.right + EDGE &&
                    line.top >= button.inner.top - EDGE &&
                    line.bottom <= button.inner.bottom + EDGE,
                  where,
                );
              }
            }
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        }
        assert.ok(seen > 0, `no "${RUN_LABEL}" button shown at ${width}`);
      });
    }
  }
});
