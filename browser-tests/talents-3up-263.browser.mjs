// #263 (Fran's spec, Option 1; coordinator call 25 Nov, James delegated):
// from 80em, on the Talents screen only, the run column becomes a
// full-width bar above the area, so the three talent trees sit side by
// side, at 100% and 150% text. Every tile still takes its own clicks and
// stays a 44 px target, and nothing scrolls sideways. Below 80em (1279 and
// 1024 wide) nothing changes: the trees wrap or stack and the run column
// stays sticky on the right. Gear keeps the side column at 1280. A phone
// keeps the tree tabs. Inter is not on CI; DejaVu Sans, its fallback, is
// pinned, and the page's own font stack is checked too.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import { TALENTS_3UP_PX } from "../js/views/breakpoints.js";

const PINNED_FONT = "DejaVu Sans";
const FONTS = [PINNED_FONT, null];
const TEXT_SIZES = ["100%", "150%"];
const THREE_UP = [TALENTS_3UP_PX, 1440, 1920];
const JUST_UNDER = TALENTS_3UP_PX - 1;
const LAPTOP = 1024;
const PHONE = { width: 360, height: 844 };
const HEIGHT = 900;
const TREES = 3;
const TARGET = 44;
// Three trees at the floor (248) plus two 12 gaps.
const THREE_UP_LEAST = 768;
const TALENTS = "#character/talents";
const GEAR = "#character/gear";
// Rounding slack for a box edge, not a layout allowance.
const EDGE = 1;

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

async function open(viewport, text, font, hash = TALENTS) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${hash}`);
  const pin = font ? `:root { font-family: "${font}" !important; } ` : "";
  await page.addStyleTag({
    content: `${pin}html { font-size: ${text} !important; }`,
  });
  await page.evaluate(() => globalThis.document.fonts.ready);
  return { context, page, errors };
}

// The trees' rows and columns, the grid's width, the run column against
// the area, small tiles, tiles whose centre something else covers, and
// sideways scroll.
const layout = (page) =>
  page.evaluate(
    ({ target, edge }) => {
      const doc = globalThis.document;
      const HALF = 2;
      const shown = (node) => node.getClientRects().length > 0;
      const trees = [...doc.querySelectorAll(".talent-tree")].filter(shown);
      const boxes = trees.map((tree) => tree.getBoundingClientRect());
      const column = doc.getElementById("run-column");
      const area = doc.getElementById("area-character");
      const small = [];
      const covered = [];
      for (const tile of doc.querySelectorAll(".talent")) {
        if (!shown(tile)) continue;
        tile.scrollIntoView({ block: "center", inline: "center" });
        const box = tile.getBoundingClientRect();
        const name = tile.getAttribute("aria-label") ?? tile.id;
        if (box.width < target - edge || box.height < target - edge) {
          small.push(name);
        }
        const hit = doc.elementFromPoint(
          box.left + box.width / HALF,
          box.top + box.height / HALF,
        );
        if (!hit || !tile.contains(hit)) covered.push(name);
      }
      globalThis.scrollTo(0, 0);
      const root = doc.documentElement;
      return {
        trees: trees.length,
        xs: new Set(boxes.map((box) => Math.round(box.left))).size,
        ys: new Set(boxes.map((box) => Math.round(box.top))).size,
        grid: doc.querySelector(".talent-trees").getBoundingClientRect().width,
        column: column.getBoundingClientRect().toJSON(),
        position: globalThis.getComputedStyle(column).position,
        area: area.getBoundingClientRect().toJSON(),
        tabs: shown(doc.getElementById("talents-tabs")),
        small,
        covered,
        sideways: root.scrollWidth - root.clientWidth,
      };
    },
    { target: TARGET, edge: EDGE },
  );

const fontName = (font) => font ?? "the page's fonts";

describe("three talent trees across from 80em (#263)", () => {
  for (const font of FONTS) {
    for (const text of TEXT_SIZES) {
      for (const width of THREE_UP) {
        test(`one row of three at ${width}, ${text} text, ${fontName(font)}`, async () => {
          const { context, page, errors } = await open(
            { width, height: HEIGHT },
            text,
            font,
          );
          try {
            const seen = await layout(page);
            assert.equal(seen.trees, TREES);
            assert.equal(seen.xs, TREES, "three columns");
            assert.equal(seen.ys, 1, "one row");
            assert.ok(seen.grid >= THREE_UP_LEAST, `grid ${seen.grid}`);
            // The run column is a full-width bar above the area.
            assert.equal(seen.position, "static");
            assert.ok(
              seen.column.bottom <= seen.area.top + EDGE,
              `column ends ${seen.column.bottom}, area starts ${seen.area.top}`,
            );
            assert.ok(
              Math.abs(seen.column.width - seen.area.width) <= EDGE,
              `column ${seen.column.width}, area ${seen.area.width}`,
            );
            assert.deepEqual(seen.small, []);
            assert.deepEqual(seen.covered, []);
            assert.equal(seen.sideways, 0);
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        });
      }

      for (const width of [JUST_UNDER, LAPTOP]) {
        test(`no change below 80em at ${width}, ${text} text, ${fontName(font)}`, async () => {
          const { context, page, errors } = await open(
            { width, height: HEIGHT },
            text,
            font,
          );
          try {
            const seen = await layout(page);
            assert.equal(seen.trees, TREES);
            assert.ok(seen.ys > 1, "the trees wrap or stack");
            assert.equal(seen.position, "sticky");
            assert.ok(
              seen.column.left >= seen.area.right - EDGE,
              `column at ${seen.column.left}, area ends ${seen.area.right}`,
            );
            assert.deepEqual(seen.small, []);
            assert.deepEqual(seen.covered, []);
            assert.equal(seen.sideways, 0);
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        });
      }

      test(`Gear keeps the side column at ${TALENTS_3UP_PX}, ${text} text, ${fontName(font)}`, async () => {
        const { context, page, errors } = await open(
          { width: TALENTS_3UP_PX, height: HEIGHT },
          text,
          font,
          GEAR,
        );
        try {
          const seen = await layout(page);
          assert.equal(seen.position, "sticky");
          assert.ok(
            seen.column.left >= seen.area.right - EDGE,
            `column at ${seen.column.left}, area ends ${seen.area.right}`,
          );
          assert.equal(seen.sideways, 0);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });

      test(`a phone keeps the tree tabs, ${text} text, ${fontName(font)}`, async () => {
        const { context, page, errors } = await open(PHONE, text, font);
        try {
          const seen = await layout(page);
          assert.ok(seen.tabs, "the tablist shows");
          assert.equal(seen.trees, 1, "one tree");
          assert.deepEqual(seen.small, []);
          assert.equal(seen.sideways, 0);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }
});
