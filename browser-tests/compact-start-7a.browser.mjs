// #287 PR 7a: the compact start typography (#329, #417) is one rule block
// that two queries turn on (Kira's #417 N6). Kira's #417 N2: the start
// column under 16rem (1024 / 150% text) gets it from the container query.
// Kira's #417 N3: the page query's 30em to 32.5em band gets it, the first
// width past 32.5em does not, and wider windows (500, 768, 1024) have no
// sideways scroll and can scroll the cards and the race field clear of the
// dock. 100%
// and 150% text, with DejaVu pinned as CI has it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const PINNED_FONT = "DejaVu Sans";
const FONTS = [null, PINNED_FONT];
const TEXT_SIZES = ["100%", "150%"];
const HEIGHT = 844;
const WIDE = 1024;
// Inside the page query's 30em to 32.5em band (480 to 520 in the initial
// 16 CSS-pixel font), and the first width past it.
const BAND = [500, 519];
const PAST_BAND = 521;
const WIDER = [500, 768, 1024];
const COMPACT_COLUMN_REM = 16;
const TITLE_REM = 1;
const NAME_REM = 0.875;
const PANEL_PAD_REM = 0.75;
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

async function open(width, text, font) {
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
  await page.locator("#start-panel").waitFor({ state: "visible" });
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  return { context, page, errors };
}

// What the compact block sets, read back from the page.
const compactLook = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const style = (selector) =>
      globalThis.getComputedStyle(doc.querySelector(selector));
    const root = parseFloat(style("html").fontSize);
    const panel = doc.getElementById("start-panel");
    const panelStyle = globalThis.getComputedStyle(panel);
    const column =
      panel.clientWidth -
      parseFloat(panelStyle.paddingLeft) -
      parseFloat(panelStyle.paddingRight);
    return {
      root,
      columnRem: column / root,
      panelPadRem: parseFloat(panelStyle.paddingTop) / root,
      titleRem: parseFloat(style(".start-title").fontSize) / root,
      nameRem: parseFloat(style(".start-card-name").fontSize) / root,
      leadMore: style(".start-lead-more").display,
      detail: style(".start-card-detail").position,
      // A flex item is blockified, so read the margin the block sets.
      shortMargin: parseFloat(style(".start-card-short").marginTop),
      card: style(".start-card").display,
    };
  });

function assertCompact(look, name) {
  assert.equal(look.titleRem, TITLE_REM, `${name}: title`);
  assert.equal(look.nameRem, NAME_REM, `${name}: card name`);
  assert.equal(look.leadMore, "none", `${name}: lead's second sentence`);
  assert.equal(look.detail, "absolute", `${name}: detail visually hidden`);
  assert.equal(look.shortMargin, 0, `${name}: short label`);
  assert.equal(look.card, "flex", `${name}: card layout`);
}

describe("compact start typography (#287 PR 7a)", () => {
  for (const font of FONTS) {
    const label = font ?? "the page font";
    test(`1024 / 150% text: the start column under 16rem is compact (Kira's #417 N2), ${label}`, async () => {
      const { context, page, errors } = await open(WIDE, "150%", font);
      try {
        const look = await compactLook(page);
        assert.ok(
          look.columnRem < COMPACT_COLUMN_REM,
          `column ${look.columnRem}rem`,
        );
        assertCompact(look, "1024/150");
        // The container query cannot style its own container, so the
        // panel keeps its normal padding here, as before the dedupe.
        assert.equal(look.panelPadRem, PANEL_PAD_REM);
        assert.deepEqual(errors, [], errors.join("\n"));
      } finally {
        await context.close();
      }
    });

    test(`1024 / 100% text: the start column is not compact, ${label}`, async () => {
      const { context, page, errors } = await open(WIDE, "100%", font);
      try {
        const look = await compactLook(page);
        assert.ok(look.columnRem >= COMPACT_COLUMN_REM);
        assert.notEqual(look.leadMore, "none");
        assert.notEqual(look.detail, "absolute");
        assert.notEqual(look.nameRem, NAME_REM);
        assert.deepEqual(errors, [], errors.join("\n"));
      } finally {
        await context.close();
      }
    });
  }

  for (const text of TEXT_SIZES) {
    test(`the 30em to 32.5em band is compact and ${PAST_BAND} is not, at ${text} text (Kira's #417 N3)`, async () => {
      const { context, page, errors } = await open(BAND[0], text, PINNED_FONT);
      try {
        for (const width of BAND) {
          await page.setViewportSize({ width, height: HEIGHT });
          const look = await compactLook(page);
          assertCompact(look, `${width}/${text}`);
          assert.ok(look.panelPadRem < PANEL_PAD_REM, `${width}: panel`);
        }
        await page.setViewportSize({ width: PAST_BAND, height: HEIGHT });
        const past = await compactLook(page);
        assert.notEqual(past.leadMore, "none", `${PAST_BAND}/${text}`);
        assert.equal(past.panelPadRem, PANEL_PAD_REM, `${PAST_BAND}/${text}`);
        assert.deepEqual(errors, [], errors.join("\n"));
      } finally {
        await context.close();
      }
    });
  }
});

const dockTop = (page) =>
  page.evaluate(() => {
    const tops = ["#run-bar", "#area-nav"]
      .map((selector) => globalThis.document.querySelector(selector))
      .filter(
        (element) =>
          element !== null &&
          globalThis.getComputedStyle(element).position === "fixed",
      )
      .map((element) => element.getBoundingClientRect().top);
    return tops.length === 0 ? null : Math.min(...tops);
  });

describe("start cards above the dock, wider than a phone (Kira's #417 N3)", () => {
  for (const font of FONTS) {
    for (const text of TEXT_SIZES) {
      for (const width of WIDER) {
        const label = font ?? "the page font";
        test(`${width} / ${text} text, ${label}: no sideways scroll, cards and race scroll clear of the dock`, async () => {
          const { context, page, errors } = await open(width, text, font);
          const name = `${width}/${text}/${label}`;
          try {
            const dock = await dockTop(page);
            assert.equal(dock !== null, width < WIDE, `${name}: dock`);
            const foot =
              dock ?? (await page.evaluate(() => globalThis.innerHeight));
            const layout = await page.evaluate((slack) => {
              const doc = globalThis.document;
              const issues = [];
              for (const button of doc.querySelectorAll(
                "#start-cards button",
              )) {
                const card = button.getBoundingClientRect();
                if (button.scrollWidth > button.clientWidth + slack) {
                  issues.push(`${button.id} scrolls`);
                }
                for (const node of button.querySelectorAll(
                  ".start-card-name, .start-card-short, .start-card-detail",
                )) {
                  if (globalThis.getComputedStyle(node).display === "none") {
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
                      issues.push(`${button.id} label outside the card`);
                    }
                  }
                }
              }
              return {
                issues,
                scroll:
                  doc.documentElement.scrollWidth -
                  doc.documentElement.clientWidth,
              };
            }, SLACK);
            assert.deepEqual(layout.issues, [], name);
            assert.ok(
              layout.scroll <= SLACK,
              `${name}: scroll ${layout.scroll}`,
            );
            // The last card and the race field can be scrolled clear of
            // the dock (a phone fits them unscrolled, #329; wider windows
            // may scroll).
            const lowest = () =>
              page.evaluate(() =>
                Math.max(
                  ...[
                    ...globalThis.document.querySelectorAll(
                      "#start-cards button",
                    ),
                    globalThis.document.querySelector(".start-race"),
                  ].map((node) => node.getBoundingClientRect().bottom),
                ),
              );
            const before = await lowest();
            if (before > foot) {
              await page.evaluate(
                (by) => globalThis.scrollBy(0, by),
                before - foot,
              );
            }
            const after = await lowest();
            assert.ok(
              after <= foot + SLACK,
              `${name}: ${after} against the dock at ${foot}`,
            );
            assert.deepEqual(errors, [], errors.join("\n"));
          } finally {
            await context.close();
          }
        });
      }
    }
  }
});
