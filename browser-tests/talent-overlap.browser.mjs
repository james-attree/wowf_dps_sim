// #245, Fran's #263 check (B1): the three talent trees squeezed into one row
// overlapped their tiles at 520-740 and 1040-1260 wide, and at 1024 with
// 200% text, so some talents could not be clicked. Every tile's centre must
// hit that tile. Inter is not on CI; DejaVu Sans, its fallback, is pinned.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const PINNED_FONT = "DejaVu Sans";
const HEIGHT = 900;
const FIRST_WIDTH = 520;
const LAST_WIDTH = 1260;
const STEP = 40;
const EDGES = [740, 1040, LAST_WIDTH];
const WIDTHS = [
  ...new Set([
    ...Array.from(
      { length: Math.floor((LAST_WIDTH - FIRST_WIDTH) / STEP) + 1 },
      (_, index) => FIRST_WIDTH + index * STEP,
    ),
    ...EDGES,
  ]),
].sort((a, b) => a - b);
const LAPTOP = { width: 1024, height: 768 };
const LARGE_TEXT = "200%";
const TALENTS = "#character/talents";

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

async function open(viewport, text = null) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${TALENTS}`);
  const size = text === null ? "" : `html { font-size: ${text} !important; }`;
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; } ${size}`,
  });
  await page.locator(".talent").first().waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

// The shown tiles whose centre is covered by something else, by name.
const coveredTiles = (page) =>
  page.evaluate(() => {
    const HALF = 2;
    const covered = [];
    for (const tile of document.querySelectorAll(".talent")) {
      if (tile.getClientRects().length === 0) continue;
      tile.scrollIntoView({ block: "center", inline: "center" });
      const box = tile.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / HALF,
        box.top + box.height / HALF,
      );
      if (!hit || !tile.contains(hit)) {
        covered.push(tile.getAttribute("aria-label") ?? tile.id);
      }
    }
    return covered;
  });

describe("every talent tile can be clicked (#245, Fran's #263 B1)", () => {
  test(`at ${LAPTOP.width} with ${LARGE_TEXT} text`, async () => {
    const { context, page } = await open(LAPTOP, LARGE_TEXT);
    try {
      assert.deepEqual(await coveredTiles(page), []);
    } finally {
      await context.close();
    }
  });

  test(`from ${FIRST_WIDTH} to ${LAST_WIDTH} wide`, async () => {
    const { context, page } = await open({
      width: FIRST_WIDTH,
      height: HEIGHT,
    });
    try {
      const found = {};
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: HEIGHT });
        const covered = await coveredTiles(page);
        if (covered.length > 0) found[width] = covered.length;
      }
      assert.deepEqual(found, {});
    } finally {
      await context.close();
    }
  });
});
