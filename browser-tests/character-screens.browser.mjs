// Browser test for Character's screens (#244, UX6): #character is a list of
// three rows (Gear and weapons, Stats, Talents), each with its summary and a
// chip for what it needs fixed; each row opens its screen, whose h1 takes
// the focus and whose back link returns it to the row. Fight's Target says
// the sim attacks from behind (no control); Rotation's list has the preset the
// sim uses. Talent tiles' and the narrow tab strip's edges are 3:1 or more
// on what they sit on (WCAG 1.4.11). Fonts are pinned to DejaVu Sans, CI's.
// `npm run test:browser`; Chrome as in the other files.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const FONT_CSS = ':root { font-family: "DejaVu Sans" !important; }';
const APP = "WoW Forever Rogue Simulator";
const WIDE = 1280;
const PHONE = 390;
const HEIGHT = 900;
const NON_TEXT = 3;
const ROWS = [
  {
    row: "character-row-gear",
    hash: "#character/gear",
    title: "Gear and weapons",
    summary:
      "Main hand Sword 100–187 · Instant Poison / Off hand Sword 90–168 · Deadly Poison",
    field: "#cfg-weapons-mainHand-min",
  },
  {
    row: "character-row-stats",
    hash: "#character/stats",
    title: "Stats",
    summary: "767 attack power · 22.45% crit · 7% hit",
    field: "#cfg-character-attackPower",
  },
  {
    row: "talents-edit",
    hash: "#character/talents",
    title: "Talents",
    summary: null,
    field: "#talents-level",
  },
];

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

async function open(width, hash = "#character") {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) =>
      route.request().resourceType() === "image"
        ? route.fulfill({ status: 200, contentType: "image/jpeg", body: ICON })
        : route.abort(),
  );
  await page.goto(`${base}${hash}`);
  await page.addStyleTag({ content: FONT_CSS });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

const hashIs = (page, hash) =>
  page.waitForFunction((want) => globalThis.location.hash === want, hash);
const titled = (page, want) =>
  page
    .waitForFunction((want) => globalThis.document.title === want, want, {
      timeout: 2000,
    })
    .catch(() => {})
    .then(() => page.title());
const focused = (page) =>
  page.evaluate(() => globalThis.document.activeElement?.id ?? null);
// What a screen reader is given for an element: Chrome's own accessible
// name and description, from its accessibility tree.
async function axOf(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodeId } = await cdp
      .send("DOM.getDocument")
      .then(({ root }) =>
        cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector }),
      );
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
      nodeId,
      fetchRelatives: false,
    });
    const node = nodes[0];
    return {
      name: node?.name?.value ?? "",
      description: node?.description?.value ?? "",
    };
  } finally {
    await cdp.detach();
  }
}
async function focusIs(page, id) {
  await page
    .waitForFunction(
      (want) => globalThis.document.activeElement?.id === want,
      id,
      { timeout: 2000 },
    )
    .catch(() => {});
  return focused(page);
}

for (const width of [WIDE, PHONE]) {
  describe(`Character's screens at ${width}px (#244)`, () => {
    test("each row opens its screen, named, and Back returns to the row", async () => {
      const { context, page, errors } = await open(width);
      try {
        assert.equal(await page.title(), `Character · ${APP}`);
        assert.equal(await page.isVisible("#character-back"), false);
        assert.equal(await page.isVisible("#config-form .hands"), false);
        assert.equal(await page.isVisible("#talent-tree"), false);
        for (const { row, hash, title, summary, field } of ROWS) {
          const link = page.locator(`#${row}`);
          assert.equal(await link.getAttribute("href"), hash);
          if (summary !== null) {
            assert.equal(
              (await link.locator(".character-row-summary").innerText()).trim(),
              summary,
            );
          }
          // Named by its text, as a link (no expanded state, #244).
          assert.equal(await link.getAttribute("aria-expanded"), null);
          await link.click();
          await hashIs(page, hash);
          assert.equal(
            await titled(page, `${title} · ${APP}`),
            `${title} · ${APP}`,
          );
          assert.equal(
            await focusIs(page, "area-character-title"),
            "area-character-title",
          );
          assert.equal(
            (await page.locator("#area-character-title").innerText()).trim(),
            title,
          );
          assert.ok(await page.isVisible(field), `${hash} shows ${field}`);
          assert.equal(await page.isVisible("#character-rows"), false);
          assert.equal(
            await page
              .getByRole("link", { name: "Back to Character", exact: true })
              .getAttribute("id"),
            "character-back",
          );
          await page.click("#character-back");
          await hashIs(page, "#character");
          assert.equal(await focusIs(page, row), row, `back to ${row}`);
          assert.equal(
            await titled(page, `Character · ${APP}`),
            `Character · ${APP}`,
          );
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("a row's chip counts what its screen needs fixed", async () => {
      const { context, page, errors } = await open(width, "#character/gear");
      try {
        const chip = page.locator("#character-gear-status");
        await page.fill("#cfg-weapons-mainHand-min", "50");
        await page.fill("#cfg-weapons-mainHand-max", "40");
        await page.locator("#cfg-weapons-mainHand-max").blur();
        await page.click("#character-back");
        await hashIs(page, "#character");
        await chip.waitFor({ state: "visible" });
        assert.match((await chip.innerText()).trim(), /^\d+ to fix$/);
        assert.equal(await page.isVisible("#character-stats-status"), false);
        // Read once each: the row's name is its label and its chip, its
        // description its summary (Fran's qa-256 P-a).
        const fix = (await chip.innerText()).trim();
        assert.deepEqual(await axOf(page, "#character-row-gear"), {
          name: `Gear and weapons, ${fix}`,
          description: (
            await page
              .locator("#character-row-gear .character-row-summary")
              .innerText()
          ).trim(),
        });
        assert.deepEqual(await axOf(page, "#character-row-stats"), {
          name: "Stats",
          description: ROWS[1].summary,
        });
        assert.deepEqual(await axOf(page, "#talents-edit"), {
          name: "Talents",
          description: "No talents",
        });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

describe("Fight's target and Rotation's preset (#244)", () => {
  test("Fight's Target note says the sim attacks from behind, with no control", async () => {
    const { context, page, errors } = await open(WIDE, "#fight");
    try {
      assert.equal(
        (await page.locator("#fight-target strong").innerText()).trim(),
        "Target:",
      );
      assert.equal(
        (await page.locator("#fight-target-text").innerText()).trim(),
        "You attack from behind: the target can't parry or block. Attacks from the front are out of scope.",
      );
      assert.equal(
        await page.locator("#fight-target input, #fight-target select").count(),
        0,
      );
      assert.equal(await page.locator("#cfg-target-behind").count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Rotation's list has the preset select and what it does", async () => {
    const { context, page, errors } = await open(WIDE, "#rotation");
    try {
      const select = page.getByRole("combobox", {
        name: "Rotation the sim uses",
      });
      assert.equal(await select.getAttribute("id"), "cfg-rotation");
      assert.ok(await page.isVisible("#cfg-summary"));
      assert.equal(
        (await page.locator("#cfg-summary > summary").innerText()).trim(),
        "What this rotation does",
      );
      // Not on Character any more, nor on a rule's screen.
      await page.evaluate(() => {
        globalThis.location.hash = "#rotation/rule/1";
      });
      await hashIs(page, "#rotation/rule/1");
      assert.equal(await page.isVisible("#rotation-pick"), false);
      await page.click(`[data-nav-area="character"]`);
      await hashIs(page, "#character");
      assert.equal(await page.isVisible("#cfg-rotation"), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

// The contrast of an edge's colour on the colour under it, both composited
// down to the page's opaque background.
const edges = (page, specs) =>
  page.evaluate((specs) => {
    const rgba = (text) => {
      const [r, g, b, a = 1] = text.match(/[\d.]+/g).map(Number);
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
    return specs.map(({ selector, side, on }) => {
      const node = document.querySelector(selector);
      const under = fill(on === "self" ? node : node.parentElement);
      const edge = over(
        rgba(getComputedStyle(node)[`border${side}Color`]),
        under,
      );
      return { selector, ratio: ratio(edge, under) };
    });
  }, specs);

for (const width of [WIDE, PHONE]) {
  test(`talent tiles' and tabs' edges are ${NON_TEXT}:1 or more at ${width}px (#244)`, async () => {
    const { context, page, errors } = await open(width, "#character/talents");
    try {
      await page.locator("button.talent").first().waitFor();
      const specs = [
        { selector: "button.talent", side: "Top", on: "parent" },
        { selector: "button.talent", side: "Top", on: "self" },
      ];
      // A tile with no points to spend yet: one that needs a deeper tier.
      const locked = await page.evaluate(() => {
        const tile = [...document.querySelectorAll("button.talent")].find(
          (node) =>
            getComputedStyle(node).borderTopColor !==
            getComputedStyle(document.querySelector("button.talent"))
              .borderTopColor,
        );
        tile?.setAttribute("data-edge-test", "");
        return tile !== undefined;
      });
      assert.ok(locked, "a locked tile is drawn");
      specs.push(
        {
          selector: "button.talent[data-edge-test]",
          side: "Top",
          on: "parent",
        },
        { selector: "button.talent[data-edge-test]", side: "Top", on: "self" },
      );
      if (width === PHONE) {
        specs.push(
          { selector: "#talents-tabs", side: "Bottom", on: "parent" },
          {
            selector: '.talents-tab[aria-selected="true"]',
            side: "Top",
            on: "parent",
          },
        );
      }
      for (const { selector, ratio } of await edges(page, specs)) {
        assert.ok(ratio >= NON_TEXT, `${selector}: ${ratio.toFixed(2)}:1`);
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
