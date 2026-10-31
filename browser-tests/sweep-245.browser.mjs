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

// The longest seed the field takes, so the dock's "Ready · seed …" is at its
// widest.
const LONGEST_SEED = "4294967295";
const DOCK_PARTS = [
  "#run-summary",
  "#run-status-text",
  "#run-errors-link",
  ".run-dps",
  ".run-buttons",
];

const CUT_LINES = ["#run-summary", "#run-status-text"];

const boxes = (page, selectors) =>
  page.evaluate((list) => {
    const found = {};
    for (const selector of list) {
      const node = document.querySelector(selector);
      if (!node || node.getClientRects().length === 0) {
        continue;
      }
      const { left, top, right, bottom } = node.getBoundingClientRect();
      found[selector] = {
        left,
        top,
        right,
        bottom,
        cut: node.scrollWidth - node.clientWidth,
      };
    }
    return found;
  }, selectors);

const overlap = (a, b) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > EDGE &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > EDGE;

function assertDockFits(parts, width, label) {
  const names = Object.keys(parts);
  for (const name of names) {
    const part = parts[name];
    // The links' wider touch area overhangs them, so only the two lines,
    // which used to end in an ellipsis, are checked for a cut.
    if (CUT_LINES.includes(name)) {
      assert.ok(part.cut <= 0, `${label}: ${name} is cut by ${part.cut}`);
    }
    assert.ok(
      part.left >= -EDGE && part.right <= width + EDGE,
      `${label}: ${name} runs past the screen (${part.left}, ${part.right})`,
    );
  }
  for (const [index, name] of names.entries()) {
    for (const other of names.slice(index + 1)) {
      assert.ok(
        !overlap(parts[name], parts[other]),
        `${label}: ${name} and ${other} touch`,
      );
    }
  }
}

// Longer than RUN_TAP_GUARD_MS (js/views/controls.js): a Pause press that
// soon after Run is taken as a double tap.
const TAP_GUARD_WAIT_MS = 600;

async function watchThenPause(page) {
  await page.locator("#run-mode-live").check({ force: true });
  await page.locator("#run-button").click();
  await page.locator("#pause-button").waitFor({ state: "visible" });
  await page.waitForTimeout(TAP_GUARD_WAIT_MS);
  await page.locator("#pause-button").click();
  await page.locator("#run-status.is-paused").waitFor({ state: "attached" });
}

async function setField(page, selector, value) {
  await page.locator(selector).fill(value);
  await page.locator(selector).press("Tab");
}

describe("the dock's lines wrap, not cut, at large text (#245, items 20, 21 and 25)", () => {
  for (const viewport of PHONES) {
    for (const text of [null, ...LARGE_TEXT]) {
      const size = text ?? "100%";
      test(`at ${viewport.width}, ${size} text: ready, with the longest seed`, async () => {
        const { context, page, errors } = await open(viewport, "#fight", text);
        try {
          await setField(page, "#run-seed", LONGEST_SEED);
          const parts = await boxes(page, DOCK_PARTS);
          assert.ok(parts["#run-status-text"], "the status shows");
          assertDockFits(parts, viewport.width, `ready ${size}`);
          const strip = await page.evaluate(() => {
            const bar = document.getElementById("run-bar");
            return {
              least: parseFloat(getComputedStyle(bar).minHeight),
              root: parseFloat(
                getComputedStyle(document.documentElement).fontSize,
              ),
              top: bar.getBoundingClientRect().top,
            };
          });
          // The strip's least height is in rem, so it grows with the text.
          assert.equal(strip.least, 3 * strip.root);
          assert.ok(strip.top >= 0);
          assert.equal(await sideways(page), 0);
          await shot(page, `dock-ready-${viewport.width}-${size}`);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });

      test(`at ${viewport.width}, ${size} text: blocked, the status and its Fix link apart`, async () => {
        const { context, page } = await open(viewport, "#fight", text);
        try {
          await setField(page, "#run-duration", "0");
          const parts = await boxes(page, DOCK_PARTS);
          assert.ok(parts["#run-errors-link"], "the Fix link shows");
          assertDockFits(parts, viewport.width, `blocked ${size}`);
          await shot(page, `dock-blocked-${viewport.width}-${size}`);
        } finally {
          await context.close();
        }
      });
    }
  }

  for (const text of LARGE_TEXT) {
    test(`at ${PHONE.width}, ${text} text: 'Paused at' clears the DPS (P2)`, async () => {
      const { context, page } = await open(PHONE, "#fight", text);
      try {
        await watchThenPause(page);
        const parts = await boxes(page, DOCK_PARTS);
        assertDockFits(parts, PHONE.width, `paused ${text}`);
        await shot(page, `dock-paused-${text}`);
      } finally {
        await context.close();
      }
    });
  }
});

const lineCount = (page, selector) =>
  page.$$eval(selector, (all) =>
    all.map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const tops = new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top)),
      );
      return { text: node.textContent.trim(), lines: tops.size };
    }),
  );

describe("the phone nav's labels stay whole at large text (#245; Fran's #258 check)", () => {
  for (const viewport of PHONES) {
    test(`at ${viewport.width}, 200% text`, async () => {
      const { context, page } = await open(viewport, "#fight", "200%");
      try {
        const labels = await lineCount(page, ".area-nav-label");
        assert.equal(labels.length, 4);
        for (const label of labels) {
          assert.equal(label.lines, 1, `${label.text} breaks`);
        }
        await shot(page, `nav-${viewport.width}`);
      } finally {
        await context.close();
      }
    });
  }
});

describe("the run help on a phone (#245)", () => {
  test("is not above the area's heading off Results, and stays Stop's description", async () => {
    const { context, page } = await open(PHONE, "#fight");
    try {
      await watchThenPause(page);
      assert.ok(await page.locator("#run-help").isVisible(), "on Results");
      await page.evaluate(() => {
        globalThis.location.hash = "#fight";
      });
      await page.locator("#area-results").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#run-help").isVisible(), false);
      assert.notEqual(await page.locator("#run-help").textContent(), "");
      assert.equal(
        await page.locator("#stop-button").getAttribute("aria-describedby"),
        "run-help",
      );
    } finally {
      await context.close();
    }
  });
});

const WIDE = { width: 1024, height: 800 };

describe("the wide layout at 200% text (#245, items 22 and 23; Fran's #260 check)", () => {
  test("the nav column holds its links, clear of the area heading", async () => {
    const { context, page } = await open(WIDE, "#character", "200%");
    try {
      const fit = await page.evaluate(() => {
        const links = [...document.querySelectorAll(".area-nav a")];
        const heading = document
          .getElementById("area-character-title")
          .getBoundingClientRect();
        return {
          cut: links.map((link) => link.scrollWidth - link.clientWidth),
          right: Math.max(
            ...links.map((link) => link.getBoundingClientRect().right),
          ),
          heading: heading.left,
        };
      });
      assert.deepEqual(
        fit.cut.filter((cut) => cut > 0),
        [],
      );
      assert.ok(fit.right < fit.heading, JSON.stringify(fit));
      await shot(page, "wide-nav");
    } finally {
      await context.close();
    }
  });

  test("Fight's labels clear their inputs", async () => {
    const { context, page } = await open(WIDE, "#fight", "200%");
    try {
      const gaps = await page.$$eval(".fight-settings .run-field", (fields) =>
        fields
          .filter((field) => field.getClientRects().length > 0)
          .map((field) => ({
            label: field.querySelector("label").textContent,
            gap:
              field.querySelector("input").getBoundingClientRect().top -
              field.querySelector("label").getBoundingClientRect().bottom,
          })),
      );
      assert.equal(gaps.length, 3);
      for (const { label, gap } of gaps) {
        assert.ok(gap > 0, `${label}: ${gap}`);
      }
      await shot(page, "wide-fight");
    } finally {
      await context.close();
    }
  });

  test("the run status's dot keeps its size when the status wraps", async () => {
    const { context, page } = await open(WIDE, "#fight", "200%");
    try {
      const pill = await page.evaluate(() => {
        const status = document.getElementById("run-status");
        const dot = status.querySelector(".live-dot");
        return {
          dot: dot.getBoundingClientRect().width,
          height: status.getBoundingClientRect().height,
          radius: getComputedStyle(status).borderTopLeftRadius,
          root: getComputedStyle(document.documentElement).fontSize,
        };
      });
      assert.equal(pill.dot, 8);
      assert.equal(pill.radius, pill.root);
    } finally {
      await context.close();
    }
  });
});
