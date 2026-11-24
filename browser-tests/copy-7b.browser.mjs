// #287 PR 7b, Fran's copy spec: on Character › Stats the race fieldset
// has no legend and is named by the select's visible "Race" label (Fran's
// ruling), an Orc on the empty default rotation gets the
// "Simulated · not cast" chip and the one-sentence on-use line, and a
// preset that casts Blood Fury keeps "Simulated". The Custom start card
// shows the page defaults' talents. With only the poisons edited, the
// preset hint says the talents and level already match. 320 and 360 wide,
// 100% and 150% text, under Inter and with DejaVu pinned as CI has it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import { pageDefaultConfig } from "../js/config-form.js";
import { pointsText } from "../js/preset-build.js";

const PINNED_FONT = "DejaVu Sans";
const FONTS = [null, PINNED_FONT];
const TEXT_SIZES = ["100%", "150%"];
const WIDTHS = [320, 360];
const HEIGHT = 844;
const RACE = "#cfg-race";
const PICK = "#cfg-rotation";
const FURY = "#cfg-race-racials-list > li";
const NBSP = "\u00a0";
const HINT = "#cfg-preset-build-hint";
const NOT_CAST = "Simulated · not cast";
const NOT_CAST_LINE =
  "The preset rotations use it on cooldown, but yours has no rule for it, so it isn't used.";
const CAST_LINE =
  "Your rotation casts it on cooldown, as the preset rotations do.";
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

const clean = (text) => text.replace(/\s+/g, " ").trim();

const goTo = async (page, hash, selector) => {
  await page.evaluate((to) => {
    globalThis.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

// The rotation picker is on Rotation; the racials are on Stats.
async function pickRotation(page, choice) {
  await goTo(page, "#rotation", PICK);
  await page.selectOption(PICK, choice);
  await goTo(page, "#character/stats", RACE);
}

// Blood Fury's row: chip, line, and whether the chip fits its row.
const fury = (page) =>
  page.locator(FURY, { hasText: "Blood Fury" }).evaluate((item, edge) => {
    const chip = item.querySelector(".race-chip");
    const row = item.getBoundingClientRect();
    const box = chip.getBoundingClientRect();
    return {
      chip: chip.textContent,
      kind: chip.className,
      line: item.querySelector(".race-racial-line").textContent,
      fits:
        chip.scrollWidth <= chip.clientWidth + edge &&
        box.right <= row.right + edge &&
        box.left >= row.left - edge,
    };
  }, EDGE);

const cases = [];
for (const font of FONTS) {
  for (const text of TEXT_SIZES) {
    for (const width of WIDTHS) cases.push({ font, text, width });
  }
}

describe("#287 PR 7b copy on Stats, Rotation and the start panel", () => {
  for (const { font, text, width } of cases) {
    const label = `${width}, ${text} text, ${font ?? "Inter"}`;

    test(`race named by its label, and the not-cast chip at ${label}`, async () => {
      const { context, page, errors } = await open(
        width,
        text,
        font,
        "#character/stats",
      );
      try {
        await page.locator(RACE).waitFor({ state: "visible" });
        // Fran's ruling: no legend. The fieldset also holds the racials, so
        // it stays a group, named by the visible "Race" label.
        const fieldset = await page.locator(RACE).evaluate((select) => {
          const set = select.closest("fieldset");
          return {
            legends: set.querySelectorAll("legend").length,
            labelledBy: set.getAttribute("aria-labelledby"),
            label: globalThis.document.getElementById(
              set.getAttribute("aria-labelledby") ?? "",
            )?.htmlFor,
          };
        });
        assert.deepEqual(fieldset, {
          legends: 0,
          labelledBy: "cfg-race-label",
          label: "cfg-race",
        });
        // The computed accessible tree: one group and one combobox are named
        // "Race", and nothing else is (text runs aside).
        const cdp = await page.context().newCDPSession(page);
        const { nodes } = await cdp.send("Accessibility.getFullAXTree");
        await cdp.detach();
        const named = nodes
          .filter(
            (node) =>
              !node.ignored &&
              node.name?.value === "Race" &&
              !["StaticText", "InlineTextBox"].includes(node.role?.value),
          )
          .map((node) => node.role?.value)
          .sort();
        assert.deepEqual(named, ["combobox", "group"]);
        const tree = await page.locator(".race-fieldset").ariaSnapshot();
        assert.match(
          tree,
          /^- group "Race":\n {2}- text: Race\n {2}- combobox "Race"/,
        );

        await page.locator(RACE).selectOption("orc");
        await pickRotation(page, "default");
        const plain = await fury(page);
        assert.equal(plain.chip, NOT_CAST);
        assert.match(plain.kind, /is-simulated/);
        assert.ok(clean(plain.line).endsWith(NOT_CAST_LINE), plain.line);
        assert.ok(plain.fits, "the not-cast chip fits its row");

        await pickRotation(page, "combat-daggers");
        const cast = await fury(page);
        assert.equal(cast.chip, "Simulated");
        assert.ok(clean(cast.line).endsWith(CAST_LINE), cast.line);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`the Custom card shows the page defaults at ${label}`, async () => {
      const { context, page, errors } = await open(
        width,
        text,
        font,
        "#character/start",
      );
      try {
        const card = page.locator("#start-card-custom");
        await card.waitFor({ state: "visible" });
        const points = pointsText(pageDefaultConfig().talents);
        const rotation = pageDefaultConfig().rotation.name;
        assert.equal(
          clean(await card.locator(".start-card-short").textContent()),
          points,
        );
        assert.equal(
          clean(await card.locator(".start-card-detail").textContent()),
          `The page defaults: ${rotation} talents and rotation`,
        );
        assert.doesNotMatch(await card.textContent(), /temporary|16\/35\/0/);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test(`the preset hint names what already matches at ${label}`, async () => {
      const { context, page, errors } = await open(
        width,
        text,
        font,
        "#character/gear",
      );
      try {
        await page.locator("#cfg-poisons-mainHand").selectOption("deadly");
        await goTo(page, "#rotation", HINT);
        const points = pointsText(pageDefaultConfig().talents);
        assert.equal(
          await page.locator(HINT).textContent(),
          `Built for Combat${NBSP}${points}, Instant Poison on the main hand and Deadly Poison on the off hand. Your talents and level already match.`,
        );
        const fit = await page.locator(HINT).evaluate((hint, edge) => {
          const box = hint.getBoundingClientRect();
          const root = globalThis.document.documentElement;
          return {
            inside: box.left >= -edge && box.right <= root.clientWidth + edge,
            noSideScroll: root.scrollWidth <= root.clientWidth,
            wraps: hint.scrollWidth <= hint.clientWidth + edge,
          };
        }, EDGE);
        assert.deepEqual(fit, {
          inside: true,
          noSideScroll: true,
          wraps: true,
        });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
