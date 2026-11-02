// #328: the Combat daggers card, the fifth with Custom last. At 320, 360,
// 390, 1024 and 1440, at 100% and 150% text, with DejaVu pinned as CI has
// it: a pick puts in its build (two daggers, Instant / Deadly), its
// rotation, the line says so, and Undo puts the defaults back.
// PRESETS_328_SHOTS=<dir> saves screenshots there.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
const COMBAT_DAGGERS = "combat-daggers";

const PINNED_FONT = "DejaVu Sans";
const WIDTHS = [320, 360, 390, 1024, 1440];
const TEXT_SIZES = ["100%", "150%"];
const PHONE_HEIGHT = 844;
const WIDE_HEIGHT = 900;
const WIDE = 1024;
const TARGET_LEAST = 44;
const CARDS = 5;
const SHOTS = process.env.PRESETS_328_SHOTS ?? null;
const SETTLE = 5_000;
const LINE =
  "Combat daggers set: talents 16/33/2, two daggers, Instant and Deadly poisons and its rotation. Your stats and race are unchanged.";
const card = `#start-card-${COMBAT_DAGGERS}`;

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
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
});

const text = async (page, selector) =>
  ((await page.locator(selector).textContent()) ?? "")
    .replace(/[ \t\n\r]+/g, " ")
    .trim();

const box = (page, selector) =>
  page.locator(selector).evaluate((node) => {
    const { top, bottom, left, right, width, height } =
      node.getBoundingClientRect();
    return { top, bottom, left, right, width, height };
  });

describe("The Combat daggers card (#328)", () => {
  for (const width of WIDTHS) {
    for (const textSize of TEXT_SIZES) {
      test(`five cards and a Combat daggers pick at ${width}, ${textSize} text`, async () => {
        const context = await browser.newContext({
          viewport: {
            width,
            height: width < WIDE ? PHONE_HEIGHT : WIDE_HEIGHT,
          },
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(
          (url) => !url.href.startsWith(base),
          (route) => route.abort(),
        );
        const name = `${width}-${textSize.replace("%", "")}`;
        try {
          await page.goto(`${base}#character`);
          await page.addStyleTag({
            content: `:root { font-family: "${PINNED_FONT}" !important; } html { font-size: ${textSize} !important; }`,
          });
          await page.locator("#run-button").waitFor({ state: "attached" });
          await page.evaluate(() => document.fonts.ready);
          await page.locator("#start-panel").waitFor({ state: "visible" });

          const ids = await page.evaluate(() =>
            [...document.querySelectorAll("#start-cards button")].map((node) =>
              node.id.replace("start-card-", ""),
            ),
          );
          assert.equal(ids.length, CARDS);
          assert.equal(ids.at(-1), "custom", "Custom last");
          assert.ok(ids.indexOf(COMBAT_DAGGERS) < ids.indexOf("custom"));
          // No card is wider than the panel, and none leaves a gap beside
          // it: the odd last card (Custom) takes its whole row.
          const panel = await box(page, "#start-panel");
          const list = await box(page, "#start-cards");
          for (const id of ids) {
            const target = await box(page, `#start-card-${id}`);
            assert.ok(
              target.height >= TARGET_LEAST,
              `${id}: tall enough (${target.height} of ${TARGET_LEAST})`,
            );
            assert.ok(target.width >= TARGET_LEAST, `${id}: wide enough`);
            assert.ok(target.right <= panel.right + 1, `${id}: in the panel`);
          }
          const custom = await box(page, "#start-card-custom");
          assert.ok(
            custom.width >= list.width - 1,
            `${name}: Custom across the row (${custom.width} of ${list.width})`,
          );
          assert.match(await text(page, card), /^Combat daggers/);
          assert.match(await text(page, card), /16\/33\/2/);
          assert.ok(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
            `${name}: no sideways scroll`,
          );
          if (SHOTS !== null) {
            await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
          }

          await page.locator(card).click();
          await page.locator("#start-applied").waitFor({ state: "visible" });
          assert.equal(await text(page, "#start-summary"), "Combat daggers");
          assert.equal(await text(page, "#start-done"), LINE);
          assert.ok(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
            `${name}: the line fits`,
          );
          if (SHOTS !== null) {
            await page.screenshot({
              path: path.join(SHOTS, `${name}-picked.png`),
            });
          }

          await page.locator("#start-undo").click();
          await page.locator("#start-panel").waitFor({ state: "visible" });
          await page.waitForFunction(
            () =>
              document.querySelector("#start-cards [aria-current]")?.id ===
              "start-card-custom",
            null,
            { timeout: SETTLE },
          );
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }
});
