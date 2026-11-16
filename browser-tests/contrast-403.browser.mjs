// #403: leftover component edges now use --control and stay at 3:1
// against the colour they sit on, at 100% and 150% text. Text that
// used the leftover hex uses --text-muted at 4.5:1.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const SCREEN_HEIGHT = 900;
const TEXT = ["100%", "150%"];
const NON_TEXT = 3;
const AA_TEXT = 4.5;

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
    (route) =>
      route.request().resourceType() === "image"
        ? route.abort()
        : route.abort(),
  );
  // Images are aborted like other restyle tests; the page still paints edges.
  await page.goto(`${base}?e2e${hash}`, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `html { font-size: ${text} !important; }`,
  });
  await page.waitForFunction(() => globalThis.__store != null);
  return { context, page, errors };
}

// The contrast of an edge or of text on the colour under it, both
// composited down to the page, as the talent-edge check in
// character-screens.browser.mjs and the armed-key 4.5 check do.
const contrastOf = (page, specs) =>
  page.evaluate((specs) => {
    const rgba = (text) => {
      const values = (text.match(/[-\d.]+/g) ?? []).map(Number);
      if (/color\(srgb/i.test(text)) {
        return {
          r: values[0] * 255,
          g: values[1] * 255,
          b: values[2] * 255,
          a: values[3] ?? 1,
        };
      }
      const [r, g, b, a = 1] = values;
      return { r, g, b, a };
    };
    const over = (top, under) => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    });
    const fill = (node) => {
      const layers = [];
      for (let at = node; at !== null; at = at.parentElement) {
        layers.push(rgba(getComputedStyle(at).backgroundColor));
      }
      return layers.reduceRight((under, top) => over(top, under), {
        r: 0,
        g: 0,
        b: 0,
        a: 1,
      });
    };
    const lum = ({ r, g, b }) => {
      const lin = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    return specs.map((spec) => {
      const node = document.querySelector(spec.selector);
      if (node === null) {
        return { ...spec, missing: true, ratio: 0 };
      }
      const under = fill(spec.on === "parent" ? node.parentElement : node);
      const style = getComputedStyle(node, spec.pseudo ?? "");
      const paint =
        spec.kind === "text"
          ? rgba(style.color)
          : rgba(style[`border${spec.side ?? "Top"}Color`]);
      const edge = over(paint, under);
      return { ...spec, missing: false, ratio: ratio(edge, under) };
    });
  }, specs);

describe("leftover edges and text meet contrast (#403)", () => {
  for (const text of TEXT) {
    test(`rotation chips and rule icons are ${NON_TEXT}:1 at 1280, ${text} text`, async () => {
      const { context, page, errors } = await open(1280, text, "#rotation");
      try {
        await page.locator(".chip").first().waitFor({ state: "visible" });
        const rows = await contrastOf(page, [
          { selector: ".chip", kind: "edge", side: "Top", on: "self" },
          { selector: ".rule-icon", kind: "edge", side: "Top", on: "parent" },
        ]);
        for (const row of rows) {
          assert.equal(row.missing, false, `${row.selector} is drawn`);
          assert.ok(
            row.ratio >= NON_TEXT,
            `${row.selector} is ${row.ratio.toFixed(2)}:1`,
          );
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`talent ranks and tab points are ${NON_TEXT}:1 at 1280, ${text} text`, async () => {
      const { context, page, errors } = await open(
        1280,
        text,
        "#character/talents",
      );
      try {
        await page
          .locator(".talent-rank")
          .first()
          .waitFor({ state: "visible" });
        const rows = await contrastOf(page, [
          { selector: ".talent-rank", kind: "edge", side: "Top", on: "self" },
          {
            selector: ".talents-tab-points",
            kind: "edge",
            side: "Top",
            on: "parent",
          },
        ]);
        for (const row of rows) {
          assert.equal(row.missing, false, `${row.selector} is drawn`);
          assert.ok(
            row.ratio >= NON_TEXT,
            `${row.selector} is ${row.ratio.toFixed(2)}:1`,
          );
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`the inactive sort icon is ${AA_TEXT}:1 at 1280, ${text} text`, async () => {
      const { context, page, errors } = await open(1280, text, "#results");
      try {
        // A finished live run is not required: the table headers are drawn
        // with the empty results state. Fall back to injecting the class
        // if the page has not built the table yet.
        const hasIcon = await page.locator(".sort-icon").count();
        if (hasIcon === 0) {
          await page.evaluate(() => {
            const table =
              document.querySelector(".results-table") ?? document.body;
            const th = document.createElement("th");
            th.setAttribute("aria-sort", "none");
            th.className = "sort-button";
            th.innerHTML = `<span class="sort-icon"></span>`;
            table.prepend(th);
          });
        }
        await page
          .locator('th[aria-sort="none"] .sort-icon')
          .first()
          .waitFor({ state: "attached" });
        const rows = await contrastOf(page, [
          {
            selector: 'th[aria-sort="none"] .sort-icon',
            kind: "text",
            on: "self",
            pseudo: "::after",
          },
        ]);
        for (const row of rows) {
          assert.equal(row.missing, false, `${row.selector} is drawn`);
          assert.ok(
            row.ratio >= AA_TEXT,
            `${row.selector} is ${row.ratio.toFixed(2)}:1`,
          );
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
