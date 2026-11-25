// #287 7a layout follow-up (#432). Fran's #322 N: on a phone a rotation
// condition's remove button (✕) sat on its own line under the type and
// ability selects, about 50 px per condition. It now stays at the end of the
// first line wherever the type select's longest choice ("Race or talent
// granted") still fits beside it, from 360 wide; at 320 it still drops
// under the fields. Either way, no select is cut short of its longest
// choice (#244) and the button keeps its 44 px target. Fran's #299 P5: the
// phone header stays one line, with the icon-sized share button (#417).
// 320, 360 and 390 wide, 100% and 150% text, under Inter and with DejaVu
// pinned as CI has it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const PINNED_FONT = "DejaVu Sans";
const FONTS = [null, PINNED_FONT];
const TEXT_SIZES = ["100%", "150%"];
const WIDTHS = [320, 360, 390];
// The ✕ shares the first line from 360 wide; at 320 the type select's
// longest choice and the ✕ don't fit side by side.
const BESIDE_FROM = 360;
const HEIGHT = 844;
const TARGET = 44;
// Orc, so the presets' Blood Fury rules show the "Race or talent granted"
// guard, the type select's longest choice.
const RACE = "orc";
// The default rotation's rules (data/rotations.js's Default (Combat)).
const RULES = 7;
const SHARE_NAME = "Copy link to this build (header)";
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

async function open(width, text, font, hash) {
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
  await page.goto(`${base}${hash}`);
  const pin = font ? `:root { font-family: "${font}" !important; } ` : "";
  await page.addStyleTag({
    content: `${pin}html { font-size: ${text} !important; }`,
  });
  await page.evaluate(() => globalThis.document.fonts.ready);
  return { context, page, errors };
}

async function show(page, hash) {
  await page.evaluate((to) => {
    globalThis.location.hash = to;
  }, hash);
  await page.waitForFunction((to) => globalThis.location.hash === to, hash);
  await page.evaluate(
    () =>
      new Promise((done) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(done),
        ),
      ),
  );
}

// Each condition on the shown rule screen: where its ✕ sits on its row,
// and any select narrower than its longest choice.
const conditions = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const panel = [...doc.querySelectorAll(".rotation-panel")].find((node) =>
      node.checkVisibility(),
    );
    return [...(panel?.querySelectorAll(".cond") ?? [])].map((cond) => {
      const row = cond.querySelector(".cond-row").getBoundingClientRect();
      const fields = cond.querySelector(".cond-fields").getBoundingClientRect();
      const remove = cond.querySelector(".is-remove").getBoundingClientRect();
      const cut = [];
      for (const select of cond.querySelectorAll("select")) {
        if (!select.checkVisibility()) {
          continue;
        }
        // The select's own width with nothing stretching or squeezing it:
        // its longest choice.
        const copy = select.cloneNode(true);
        copy.removeAttribute("id");
        Object.assign(copy.style, {
          position: "absolute",
          width: "auto",
          minWidth: "0",
          maxWidth: "none",
        });
        select.after(copy);
        const needs = copy.getBoundingClientRect().width;
        copy.remove();
        const has = select.getBoundingClientRect().width;
        if (needs > has + 1) {
          cut.push(`${select.dataset.key}: ${needs} > ${has}`);
        }
      }
      return {
        rowTop: row.top,
        rowRight: row.right,
        fieldsBottom: fields.bottom,
        remove: {
          top: remove.top,
          right: remove.right,
          width: remove.width,
          height: remove.height,
        },
        cut,
      };
    });
  });

const cases = [];
for (const font of FONTS) {
  for (const text of TEXT_SIZES) {
    for (const width of WIDTHS) cases.push({ font, text, width });
  }
}

describe("a phone condition's ✕ shares the first line when it fits (#322 N, #432)", () => {
  for (const { font, text, width } of cases) {
    const label = `${width}, ${text} text, ${font ?? "Inter"}`;
    const beside = width >= BESIDE_FROM;

    test(`the ✕ ${beside ? "ends the first line" : "drops under the fields"} at ${label}`, async () => {
      const { context, page, errors } = await open(
        width,
        text,
        font,
        "#character/stats",
      );
      try {
        await page.locator("#cfg-race").selectOption(RACE);
        let seen = 0;
        for (let at = 1; at <= RULES; at += 1) {
          await show(page, `#rotation/rule/${at}`);
          for (const cond of await conditions(page)) {
            seen += 1;
            const where = `rule ${at}, condition ${seen}`;
            assert.ok(cond.remove.width >= TARGET - EDGE, where);
            assert.ok(cond.remove.height >= TARGET - EDGE, where);
            assert.ok(
              Math.abs(cond.remove.right - cond.rowRight) <= EDGE,
              `${where}: the ✕ ends the line`,
            );
            if (beside) {
              assert.ok(
                Math.abs(cond.remove.top - cond.rowTop) <= EDGE,
                `${where}: the ✕ at ${cond.remove.top}, row at ${cond.rowTop}`,
              );
            } else {
              assert.ok(
                cond.remove.top >= cond.fieldsBottom - EDGE,
                `${where}: the ✕ at ${cond.remove.top}, fields end ${cond.fieldsBottom}`,
              );
            }
            assert.deepEqual(cond.cut, [], where);
          }
        }
        assert.ok(seen > RULES, "the default rotation's conditions to check");
        const sideways = await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth -
            globalThis.document.documentElement.clientWidth,
        );
        assert.equal(sideways, 0);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe("the phone header stays one line (#299 P5, #432)", () => {
  for (const { font, text, width } of cases) {
    const label = `${width}, ${text} text, ${font ?? "Inter"}`;

    test(`the share button is an icon beside the title at ${label}`, async () => {
      const { context, page, errors } = await open(
        width,
        text,
        font,
        "#character/start",
      );
      try {
        const header = await page.evaluate(() => {
          const doc = globalThis.document;
          const box = doc
            .querySelector(".simulator-header")
            .getBoundingClientRect();
          const title = doc
            .querySelector(".simulator-header > div")
            .getBoundingClientRect();
          const share = doc
            .querySelector("#share-link-header")
            .getBoundingClientRect();
          const label = doc
            .querySelector("#share-link-header .share-button-label")
            .getBoundingClientRect();
          return { box, title, share, label };
        });
        assert.ok(
          header.share.top < header.title.bottom,
          `share at ${header.share.top}, title ends ${header.title.bottom}`,
        );
        assert.ok(
          header.box.height <=
            Math.max(header.title.height, header.share.height) + EDGE,
          `header ${header.box.height} tall`,
        );
        assert.ok(Math.abs(header.share.width - TARGET) <= EDGE);
        assert.ok(header.share.height >= TARGET - EDGE);
        assert.ok(header.label.width <= EDGE, "the label is visually hidden");
        assert.equal(
          await page
            .locator("#share-link-header")
            .evaluate((node) => node.getAttribute("aria-label")),
          SHARE_NAME,
        );
        await assert.doesNotReject(
          page
            .getByRole("button", { name: SHARE_NAME, exact: true })
            .waitFor({ state: "visible" }),
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
