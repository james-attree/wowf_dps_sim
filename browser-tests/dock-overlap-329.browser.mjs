// Phone dock vs the start-preset cards (#329 regression). At 320 / 100%,
// 360 / 100% and 360 / 150% text, the last preset and the rest of the
// start panel (the race field under the cards) must sit above the dock
// within 1px. Viewport height 844, as the #329 harness. The live fonts
// are left unpinned so Cinzel headings stay (Inter + Cinzel).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const CASES = [
  { width: 320, textSize: "100%" },
  { width: 360, textSize: "100%" },
  { width: 360, textSize: "150%" },
];
const PHONE_HEIGHT = 844;
const WIDE = 1024;
const SLACK = 1;

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

const dockTop = (page) =>
  page.evaluate(() => {
    const tops = ["#run-bar", "#area-nav"]
      .map((selector) => document.querySelector(selector))
      .filter(
        (element) =>
          element !== null && getComputedStyle(element).position === "fixed",
      )
      .map((element) => element.getBoundingClientRect().top);
    return tops.length === 0 ? null : Math.min(...tops);
  });

const box = (page, selector) =>
  page.locator(selector).evaluate((node) => {
    const { top, bottom, height } = node.getBoundingClientRect();
    return { top, bottom, height };
  });

async function open(width, textSize) {
  const context = await browser.newContext({
    viewport: { width, height: PHONE_HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}#character/start`);
  await page.addStyleTag({
    content: `html { font-size: ${textSize} !important; }`,
  });
  await page.locator("#start-panel").waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  return { context, page, errors };
}

describe("start cards stay above the phone dock (#329)", () => {
  for (const { width, textSize } of CASES) {
    test(`the last preset and the start-race field clear the dock at ${width}, ${textSize} text`, async () => {
      const { context, page, errors } = await open(width, textSize);
      const name = `${width}-${textSize.replace("%", "")}`;
      try {
        assert.deepEqual(errors, [], errors.join("\n"));
        const dock = await dockTop(page);
        assert.equal(
          dock !== null,
          width < WIDE,
          `${name}: a fixed dock on phones`,
        );
        const foot =
          dock ?? (await page.evaluate(() => globalThis.innerHeight));
        const cards = page.locator("#start-cards button");
        const count = await cards.count();
        assert.ok(count >= 1, `${name}: start cards are on the page`);
        for (let index = 0; index < count; index += 1) {
          const cardBox = await cards.nth(index).evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return { id: node.id, bottom: rect.bottom };
          });
          assert.ok(
            cardBox.bottom <= foot + SLACK,
            `${name}: ${cardBox.id} over the dock (${cardBox.bottom} against ${foot})`,
          );
        }
        const last = await box(page, "#start-cards li:last-child button");
        assert.ok(
          last.bottom <= foot + SLACK,
          `${name}: the last card over the dock (${last.bottom} against ${foot})`,
        );
        const race = await box(page, ".start-race");
        assert.ok(
          race.bottom <= foot + SLACK,
          `${name}: the race field over the dock (${race.bottom} against ${foot})`,
        );
        const clipped = await page.evaluate((slack) => {
          const issues = [];
          for (const button of document.querySelectorAll(
            "#start-cards button",
          )) {
            const card = button.getBoundingClientRect();
            if (button.scrollWidth > button.clientWidth + slack) {
              issues.push(
                `${button.id}: scrollWidth ${button.scrollWidth} > clientWidth ${button.clientWidth}`,
              );
            }
            // A name's own scrollWidth can be 0 or can match a box that
            // has already grown past the card, so also compare each
            // visible label's line boxes to the card edge.
            for (const node of button.querySelectorAll(
              ".start-card-name, .start-card-short, .start-card-detail, .start-card-edited",
            )) {
              if (getComputedStyle(node).display === "none") {
                continue;
              }
              for (const rect of node.getClientRects()) {
                if (rect.width <= 0 || rect.height <= 0) {
                  continue;
                }
                if (
                  rect.right > card.right + slack ||
                  rect.left < card.left - slack
                ) {
                  issues.push(
                    `${button.id}: label ${rect.right} outside card ${card.right}`,
                  );
                }
              }
            }
          }
          return issues;
        }, SLACK);
        assert.deepEqual(clipped, [], `${name}: ${clipped.join("; ")}`);
        // Full name stays in the accessibility tree (visually hidden
        // detail on the compact grid), and the visible short label is
        // still in that name (WCAG 2.5.3).
        assert.equal(
          await page
            .getByRole("button", {
              name: /Assassination daggers 37\/11\/3 Mutilate · 37\/11\/3 · Instant \/ Deadly/,
            })
            .count(),
          1,
          `${name}: Assassination card has its full accessible name`,
        );
        assert.equal(
          await page
            .getByRole("button", {
              name: /Custom 16\/35\/0 The page defaults/,
            })
            .count(),
          1,
          `${name}: Custom card has its full accessible name`,
        );
      } finally {
        await context.close();
      }
    });
  }
});
