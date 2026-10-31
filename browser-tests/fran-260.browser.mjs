// Fran's #260 check. B1: Fight's settings fit a phone at large text, with
// no sideways scroll. B2: the phone dock's Fix link counts the causes
// ("Fix 5 issues") on one line clear of the nav and the status, and
// the wide one names them. The order: the link goes to the first cause
// named. The stats footer's run field links go to the field in Fight.
// Inter is not on CI; DejaVu Sans, its fallback, is pinned, and at 250%
// root text it is as wide as Inter at 200%.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const SHOTS = process.env.SHOTS_DIR ?? null;
const PREFIX = process.env.SHOTS_PREFIX ?? "fran-260";
const PINNED_FONT = "DejaVu Sans";
const WIDE = { width: 1280, height: 900 };
const PHONES = [
  { width: 320, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];
const DOCKED = PHONES.slice(1);
// Root text sizes: Chrome's 200% text, and a size that makes DejaVu as
// wide as Inter at 200%.
const LARGE_TEXT = ["200%", "250%"];
const EDGE = 0.5;
const BAD_LENGTH = "0";
const BAD_SEED = "abc";
const BAD_AP = "-5";
const AP = '[name="character.attackPower"]';
// Two points in Malice, then a level whose cap they are over.
const TALENT = 'button.talent[data-id="assassination.malice"]';
const TALENT_POINTS = 2;
const LOW_LEVEL = "10";
// A rule's condition left empty is a rotation error.
const RULE = "#rotation/rule/6";
const CONDITION = "input.cond-value";
const ALL_NAMED = "3 settings, the talents and the rotation";
const ALL_COUNTED = "Fix 5 issues";

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
  return { context, page, errors };
}

const shot = async (page, name) => {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${PREFIX}-${name}.png` });
  }
};

const go = async (page, hash) => {
  await page.evaluate((to) => {
    globalThis.location.hash = to;
  }, hash);
  await page.waitForFunction((to) => globalThis.location.hash === to, hash);
};

async function setField(locator, value) {
  await locator.fill(value);
  await locator.press("Tab");
}

const focusId = (page) =>
  page.evaluate(() => globalThis.document.activeElement?.id ?? "");

const focused = (page, id) =>
  page.waitForFunction(
    (want) => globalThis.document.activeElement?.id === want,
    id,
  );

async function overCap(page) {
  await go(page, "#character/talents");
  const level = page.locator("#talents-level");
  await level.waitFor({ state: "visible" });
  for (let point = 0; point < TALENT_POINTS; point += 1) {
    const talent = page.locator(TALENT);
    await talent.scrollIntoViewIfNeeded();
    await talent.click();
  }
  await level.fill(LOW_LEVEL);
  await level.press("Enter");
}

async function breakRotation(page) {
  await go(page, RULE);
  const condition = page.locator(CONDITION).first();
  await condition.waitFor({ state: "visible" });
  await setField(condition, "");
}

// Each cause Fran's check had: the rotation, the talents, two run fields
// and a stats field, five issues.
async function breakAll(page) {
  await breakRotation(page);
  await overCap(page);
  await go(page, "#fight");
  await setField(page.locator("#run-duration"), BAD_LENGTH);
  await setField(page.locator("#run-seed"), BAD_SEED);
  await go(page, "#character/stats");
  await setField(page.locator(AP), BAD_AP);
}

// The dock's Fix link's text, as drawn: its lines and their box; the line
// under the status's (the dock's grid's second row) and the nav under the
// dock. (The status's own box is taller than its line, from its text's
// zero font size, so its row is what the link must stay below.)
const dockBoxes = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const link = doc.getElementById("run-errors-link");
    const text = doc.createRange();
    text.selectNodeContents(link);
    const lines = new Set(
      [...text.getClientRects()].map((line) => Math.round(line.top)),
    );
    const strip = link.closest(".run-row-actions");
    const style = globalThis.getComputedStyle(strip);
    const [first] = style.gridTemplateRows.split(" ").map(Number.parseFloat);
    const drawn = text.getBoundingClientRect();
    return {
      lines: lines.size,
      text: { top: drawn.top, bottom: drawn.bottom, right: drawn.right },
      box: link.getBoundingClientRect().top,
      row:
        strip.getBoundingClientRect().top +
        Number.parseFloat(style.paddingTop) +
        first,
      dps: doc.querySelector(".run-dps").getBoundingClientRect().left,
      nav: doc.getElementById("area-nav").getBoundingClientRect().top,
    };
  });

describe("B1: Fight's settings fit a phone at large text (Fran's #260 check)", () => {
  for (const size of PHONES) {
    for (const text of LARGE_TEXT) {
      test(`${size.width}px, ${text} text: no sideways scroll`, async () => {
        const { context, page, errors } = await open(size, "#fight", text);
        try {
          await page.locator("#run-seed").waitFor({ state: "visible" });
          const fit = await page.evaluate(() => {
            const doc = globalThis.document;
            const panel = doc.getElementById("run-settings");
            const seed = doc.getElementById("run-seed");
            return {
              wide: doc.documentElement.scrollWidth,
              view: doc.documentElement.clientWidth,
              seed: seed.getBoundingClientRect().right,
              panel: panel.getBoundingClientRect().right,
            };
          });
          assert.ok(fit.wide <= fit.view, `scrolls: ${JSON.stringify(fit)}`);
          assert.ok(fit.seed <= fit.panel + EDGE, JSON.stringify(fit));
          await shot(page, `b1-${size.width}-${text.replace("%", "")}`);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }
});

describe("B2: the dock's Fix link counts, the wide one names (Fran's #260 check)", () => {
  for (const size of DOCKED) {
    for (const text of [null, ...LARGE_TEXT.slice(0, 1)]) {
      const label = text ?? "100%";
      test(`${size.width}px, ${label} text: "${ALL_COUNTED}", one line, clear of the nav and status`, async () => {
        const { context, page, errors } = await open(size, "#character", text);
        try {
          await breakAll(page);
          const link = page.locator("#run-errors-link");
          await link.waitFor({ state: "visible" });
          await shot(page, `b2-${size.width}-${label.replace("%", "")}`);
          assert.equal(await link.textContent(), ALL_COUNTED);
          const at = await dockBoxes(page);
          const where = JSON.stringify(at);
          assert.equal(at.lines, 1, `lines: ${where}`);
          assert.ok(at.text.bottom <= at.nav + EDGE, `on the nav: ${where}`);
          assert.ok(at.box >= at.row - EDGE, `on the status: ${where}`);
          assert.ok(at.text.right <= at.dps + EDGE, `on the DPS: ${where}`);
          // The order: it goes to the first run field, a setting.
          await link.click();
          await focused(page, "run-duration");
          assert.equal(await focusId(page), "run-duration");
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  test("1280px: the link and the reason name the causes, settings first, and go there", async () => {
    const { context, page, errors } = await open(WIDE, "#character");
    try {
      await breakAll(page);
      const link = page.locator("#run-errors-link");
      await link.waitFor({ state: "visible" });
      assert.equal(await link.textContent(), `Fix ${ALL_NAMED}`);
      assert.equal(
        await page.locator("#run-reason").textContent(),
        `Can't run · fix ${ALL_NAMED}`,
      );
      await shot(page, "b2-1280");
      await link.click();
      await focused(page, "run-duration");
      assert.equal(await focusId(page), "run-duration");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe("the Fix link goes to the first cause it names (Fran's #260 check)", () => {
  for (const size of [WIDE, DOCKED[0]]) {
    test(`${size.width}px: the talents and the rotation, the talents first`, async () => {
      const { context, page, errors } = await open(size, "#character");
      try {
        await breakRotation(page);
        await overCap(page);
        await go(page, "#fight");
        const link = page.locator("#run-errors-link");
        await link.waitFor({ state: "visible" });
        const wide = size.width === WIDE.width;
        assert.equal(
          await link.textContent(),
          wide ? "Fix the talents and the rotation" : "Fix 2 issues",
        );
        assert.equal(
          await page.locator("#run-reason").textContent(),
          "Can't run · fix the talents and the rotation",
        );
        await link.click();
        await focused(page, "talents-level");
        assert.equal(await focusId(page), "talents-level");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe("the stats footer's run field links (Fran's #260 check)", () => {
  for (const size of [WIDE, DOCKED[0]]) {
    test(`${size.width}px: "Fight, Seed" goes to Fight's seed, in one step`, async () => {
      const { context, page, errors } = await open(size, "#fight");
      try {
        await setField(page.locator("#run-seed"), BAD_SEED);
        await go(page, "#character/stats");
        await setField(page.locator(AP), BAD_AP);
        const link = page
          .locator("#cfg-fix-list a")
          .filter({ hasText: "Fight, Seed" });
        await link.waitFor({ state: "visible" });
        assert.equal(await link.getAttribute("href"), "#run-seed");
        await link.click();
        await focused(page, "run-seed");
        assert.equal(await focusId(page), "run-seed");
        assert.equal(await page.locator("#run-seed").isVisible(), true);
        await page.waitForFunction(() => globalThis.location.hash === "#fight");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
