// #245 PR 3, the targets and dock sweep: the screens it fixes at large
// text and on a phone. Inter is not on CI; DejaVu Sans, its fallback, is
// pinned, and at 250% root text it is as wide as Inter at 200%.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const SHOTS = process.env.SHOTS_DIR ?? null;
const PREFIX = process.env.SHOTS_PREFIX ?? "sweep-245";
const PINNED_FONT = "DejaVu Sans";
const PHONES = [
  { width: 320, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];
const PHONE = PHONES[1];
// Chrome's 200% text, and a size that makes DejaVu as wide as Inter at it.
const LARGE_TEXT = ["200%", "250%"];
const EDGE = 0.5;

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

async function open({ width, height }, hash, text = null) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${hash}`);
  const size = text === null ? "" : `html { font-size: ${text} !important; }`;
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; } ${size}`,
  });
  await page.locator("#run-button").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

const shot = async (page, name) => {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${PREFIX}-${name}.png` });
  }
};

const sideways = (page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

describe("Talents and Gear fit a phone at large text (#245)", () => {
  for (const hash of ["#character/talents", "#character/gear"]) {
    for (const viewport of PHONES) {
      for (const text of LARGE_TEXT) {
        test(`${hash} at ${viewport.width}, ${text} text: no sideways scroll`, async () => {
          const { context, page, errors } = await open(viewport, hash, text);
          try {
            assert.equal(await sideways(page), 0);
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        });
      }
    }
  }
});

describe("the talent tabs show their whole names (#245, item 28)", () => {
  for (const text of [null, ...LARGE_TEXT]) {
    test(`at ${PHONE.width}, ${text ?? "default"} text`, async () => {
      const { context, page } = await open(PHONE, "#character/talents", text);
      try {
        const tabs = await page.$$eval(".talents-tab", (all) =>
          all.map((tab) => {
            const name = tab.querySelector("span:nth-child(2)");
            const box = tab.getBoundingClientRect();
            const row = tab.parentElement.getBoundingClientRect();
            return {
              id: tab.id,
              cut: name.scrollWidth - name.clientWidth,
              left: box.left - row.left,
              right: row.right - box.right,
            };
          }),
        );
        assert.equal(tabs.length, 3);
        for (const tab of tabs) {
          assert.ok(tab.cut <= 0, `${tab.id} is cut by ${tab.cut}`);
          assert.ok(tab.left >= -EDGE && tab.right >= -EDGE, tab.id);
        }
        await shot(page, `talent-tabs-${text ?? "100%"}`);
      } finally {
        await context.close();
      }
    });
  }
});
