// The desktop results column at the edges Fran's check of #253 found:
// B1, the GCD readout inside its card at every width from 1360 to 1500 and
// in each font CI or a reader may have; N6, 200% text at 1024 (the root's
// font size, as Fran measured it, and the browser's own text size, which
// the em breakpoints follow); N1, the column scrolls on its own on a short
// screen; N2, a stopped batch says how many of its fights ran; N5, the Run
// panel's buttons two by two, none alone on a row. Fran's re-check at
// 3821ea4: B2, a mouse wheel over the column scrolls the page (it scrolls
// the column first when the column has more to show); and the cooldown
// grid never goes back to fewer columns as the window widens.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const SHOTS = process.env.SHOTS_DIR ?? null;
const SCREEN_HEIGHT = 900;
const SWEEP_FROM = 1360;
const SWEEP_TO = 1500;
const SWEEP_STEP = 20;
// Either side of the sweep too: the column's own widths and the wide edge.
const MORE_WIDTHS = [1024, 1100, 1280, 1600];
// The column count from the column's first width to a wide screen, and
// where the area stops growing (Fran's re-check: 2, 4, 2 from 1580 up).
const WIDEN_FROM = 1024;
const WIDEN_TO = 1920;
const WIDEN_STEP = 16;
const FULL_AREA_FROM = 1580;
const WHEEL_SCREENS = [
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
  { width: 1024, height: 576 },
];
const WHEEL_AREAS = ["character", "rotation"];
const WHEEL_PX = 400;
// A small notch, so a full column scrolls in steps and its end is seen.
const NOTCH_PX = 60;
const MAX_NOTCHES = 40;
// Past Chrome's wheel latching, so each notch picks its scroller afresh.
const NOTCH_GAP_MS = 350;
const SETTLE_MS = 2000;
// DejaVu Sans is CI's fallback, the widest; Inter is the page's own.
const FONTS = ["DejaVu Sans", "Liberation Sans", "Inter"];
const TEXT_WIDTH = 1024;
const DOUBLE = "200%";
const DOUBLE_DEFAULT_PX = 32;
const SHORT = [
  { width: 1024, height: 576, errors: false },
  { width: 1024, height: 600, errors: true },
];
const BUTTON_WIDTHS = [1024, 1060, 1100, 1280, 1440];
const SHORT_FIGHT_SECONDS = "4";
const BATCH_FIGHTS = "5";
const LONG_BATCH_FIGHTS = "4000";
const LONG_BATCH_SECONDS = "300";
const RUN_TIMEOUT = 60_000;
// Half a pixel of rounding either way.
const SLACK = 1;
const AREAS = ["character", "rotation", "fight", "results"];

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

const fontCss = (font) => `:root { font-family: "${font}" !important; }`;

async function open(
  width,
  { height = SCREEN_HEIGHT, font = FONTS[0], hash = "" } = {},
) {
  const context = await browser.newContext({ viewport: { width, height } });
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
  await page.addStyleTag({ content: fontCss(font) });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

async function toArea(page, area) {
  await page.locator(`[data-nav-area="${area}"]`).click();
  await page.waitForFunction(
    (name) =>
      globalThis.document.querySelector(`[data-area="${name}"]`)?.hidden ===
      false,
    area,
  );
}

const shot = async (page, name) => {
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/${process.env.SHOTS_PREFIX ?? "fix"}-${name}.png`,
    });
  }
};

// Whether a font is on this machine: its text measures differently from
// the monospace fallback's.
const hasFont = (page, font) =>
  page.evaluate((name) => {
    const context = globalThis.document
      .createElement("canvas")
      .getContext("2d");
    const sample = "GCD On cooldown 1.5s mmmwwwiii";
    context.font = "20px monospace";
    const fallback = context.measureText(sample).width;
    context.font = `20px "${name}", monospace`;
    return context.measureText(sample).width !== fallback;
  }, font);

// Anything drawn past its box: Fran's probe (#253). A box whose content is
// wider than it and that does not scroll or clip, tables and charts aside
// (they scroll on purpose).
const spills = (page, scope) =>
  page.evaluate(
    ({ scope, slack }) => {
      const out = [];
      for (const node of globalThis.document.querySelectorAll(scope)) {
        if (!node.checkVisibility() || node.clientWidth === 0) {
          continue;
        }
        const style = getComputedStyle(node);
        const name = node.id || String(node.className) || node.tagName;
        if (
          node.scrollWidth > node.clientWidth + slack + 1 &&
          style.overflowX === "visible" &&
          !/table|chart/.test(name)
        ) {
          out.push(`${name}: ${node.scrollWidth - node.clientWidth}`);
        }
      }
      return out;
    },
    { scope, slack: SLACK },
  );

// Each cooldown card's text inside the card, and the card inside the grid.
const cooldownFit = (page) =>
  page.evaluate((slack) => {
    const doc = globalThis.document;
    const grid = doc.querySelector(".cooldown-grid").getBoundingClientRect();
    const out = [];
    for (const card of doc.querySelectorAll(".cooldown-grid > *")) {
      const box = card.getBoundingClientRect();
      const name = String(card.className);
      if (box.right > grid.right + slack || box.left < grid.left - slack) {
        out.push(`${name} past the grid`);
      }
      for (const node of card.querySelectorAll("*")) {
        if (!node.checkVisibility()) {
          continue;
        }
        const at = node.getBoundingClientRect();
        if (at.right > box.right + slack || at.left < box.left - slack) {
          const what = node.id || String(node.className) || node.tagName;
          out.push(`${what} in ${name}: ${Math.round(at.right - box.right)}`);
        }
      }
      if (card.scrollWidth > card.clientWidth + slack) {
        out.push(`${name} wider than itself`);
      }
    }
    const status = doc.getElementById("gcd-status").getBoundingClientRect();
    if (
      status.height >
      parseFloat(
        getComputedStyle(doc.getElementById("gcd-status")).lineHeight,
      ) *
        1.5
    ) {
      out.push("the GCD status wraps");
    }
    return out;
  }, SLACK);

const gridColumns = (page) =>
  page.evaluate(
    () =>
      getComputedStyle(
        globalThis.document.querySelector(".cooldown-grid"),
      ).gridTemplateColumns.split(" ").length,
  );

describe("the GCD readout stays in its card (Fran's #253 check, B1)", () => {
  const widths = [];
  for (let width = SWEEP_FROM; width <= SWEEP_TO; width += SWEEP_STEP) {
    widths.push(width);
  }
  widths.push(...MORE_WIDTHS);
  for (const font of FONTS) {
    test(`${font}: nothing in the cooldown cards spills, ${SWEEP_FROM} to ${SWEEP_TO}; the grid never narrows to ${WIDEN_TO}`, async (t) => {
      const { context, page, errors } = await open(SWEEP_FROM, {
        font,
        hash: "#fight",
      });
      try {
        if (!(await hasFont(page, font))) {
          t.skip(`${font} is not installed here`);
          return;
        }
        await toArea(page, "fight");
        // The longest the readout says, as a paused fight shows it.
        await page.evaluate(() => {
          const doc = globalThis.document;
          doc.getElementById("gcd-status").textContent = "On cooldown";
          doc.getElementById("gcd-value").textContent = "1.5s";
        });
        const bad = [];
        for (const width of widths) {
          await page.setViewportSize({ width, height: SCREEN_HEIGHT });
          const found = [
            ...(await cooldownFit(page)),
            ...(await spills(page, ".cooldown-grid, .cooldown-grid *")),
          ];
          if (found.length > 0) {
            bad.push(`${width}: ${found.join("; ")}`);
          }
        }
        assert.deepEqual(bad, []);

        // Widening from 1024 to 1920: the cooldown grid never drops a
        // column, and from where the area stops growing nothing in it
        // spills (Fran's re-check: it went 2, 4, 2).
        const counts = [];
        const wide = [];
        for (let width = WIDEN_FROM; width <= WIDEN_TO; width += WIDEN_STEP) {
          await page.setViewportSize({ width, height: SCREEN_HEIGHT });
          counts.push([width, await gridColumns(page)]);
          if (width >= FULL_AREA_FROM) {
            const found = [
              ...(await cooldownFit(page)),
              ...(await spills(page, "[data-area]:not([hidden]) *")),
            ];
            if (found.length > 0) {
              wide.push(`${width}: ${found.join("; ")}`);
            }
          }
        }
        const drops = counts.filter(
          ([, count], at) => at > 0 && count < counts[at - 1][1],
        );
        assert.deepEqual(drops, [], JSON.stringify(counts));
        assert.equal(counts.at(-1)[1], 4, "four at a wide screen");
        assert.deepEqual(wide, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test("a real paused fight at 1380 and 1440: the readout is inside the card", async () => {
    for (const width of [SWEEP_FROM + SWEEP_STEP, 1440]) {
      const { context, page, errors } = await open(width, { hash: "#fight" });
      try {
        await toArea(page, "fight");
        // The page opens in Batch mode (#242).
        await page.check("#run-mode-live");
        await page.fill("#run-duration", "30");
        await page.locator("#run-button").click();
        await page.waitForFunction(
          () =>
            globalThis.document.getElementById("gcd-status").textContent ===
            "On cooldown",
          null,
          { timeout: RUN_TIMEOUT },
        );
        await page.locator("#pause-button").click();
        const past = await page.evaluate(() => {
          const doc = globalThis.document;
          const card = doc.querySelector(".gcd-panel").getBoundingClientRect();
          const out = doc.querySelector(".gcd-readout").getBoundingClientRect();
          return out.right - card.right;
        });
        assert.ok(past <= 0, `the readout ends ${past} past the card`);
        assert.deepEqual(await cooldownFit(page), []);
        await shot(page, `${width}-fight-paused`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  });
});

describe("200% text at 1024 (Fran's #253 check, N6)", () => {
  test("the root's font size doubled: nothing spills, the name field and Clear all fit", async () => {
    const { context, page, errors } = await open(TEXT_WIDTH);
    try {
      await page.evaluate(
        (size) => (globalThis.document.documentElement.style.fontSize = size),
        DOUBLE,
      );
      for (const area of AREAS) {
        await toArea(page, area);
        const found = await spills(
          page,
          "[data-area]:not([hidden]) *, .run-column *",
        );
        assert.deepEqual(found, [], area);
        const sideways = await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth -
            globalThis.document.documentElement.clientWidth,
        );
        assert.ok(sideways <= 0, `${area}: ${sideways} sideways`);
        await shot(page, `1024-text200-${area}`);
      }
      await toArea(page, "rotation");
      const fit = await page.evaluate(() => {
        const doc = globalThis.document;
        const inside = (node, box) => {
          const at = node.getBoundingClientRect();
          return at.left >= box.left - 1 && at.right <= box.right + 1;
        };
        const panel = doc.getElementById("rotation-builder");
        const panelBox = panel.getBoundingClientRect();
        const clear = panel.querySelector('[data-key="clear"]');
        const name = doc.getElementById("rb-name");
        return {
          name: inside(
            name,
            name.closest(".builder-name").getBoundingClientRect(),
          ),
          nameInPanel: inside(name, panelBox),
          clear: inside(clear, panelBox),
          clearWhole: clear.scrollWidth <= clear.clientWidth + 1,
        };
      });
      assert.deepEqual(fit, {
        name: true,
        nameInPanel: true,
        clear: true,
        clearWhole: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the browser's text size doubled: the em breakpoints follow, the phone layout at 1024", async () => {
    const { context, page, errors } = await open(TEXT_WIDTH);
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.setFontSizes", {
        fontSizes: { standard: DOUBLE_DEFAULT_PX },
      });
      await page.waitForFunction(
        () =>
          parseFloat(
            getComputedStyle(globalThis.document.documentElement).fontSize,
          ) > 16,
      );
      const at = await page.evaluate(() => ({
        column: getComputedStyle(
          globalThis.document.querySelector(".run-column"),
        ).display,
        dock: getComputedStyle(globalThis.document.getElementById("run-bar"))
          .position,
      }));
      assert.deepEqual(at, { column: "contents", dock: "fixed" });
      for (const area of AREAS) {
        await toArea(page, area);
        const sideways = await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth -
            globalThis.document.documentElement.clientWidth,
        );
        assert.ok(sideways <= 0, `${area}: ${sideways} sideways`);
      }
      await toArea(page, "rotation");
      await shot(page, "1024-browser-text200-rotation");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

// A finished batch fills the card, as tall as the column gets.
async function finishBatch(page) {
  await page.check("#run-mode-batch");
  await page.fill("#run-iterations", BATCH_FIGHTS);
  await page.fill("#run-duration", SHORT_FIGHT_SECONDS);
  await page.locator("#run-button").click();
  await page.waitForFunction(
    () =>
      /^Batch finished/.test(
        globalThis.document.getElementById("results-announce")?.textContent ??
          "",
      ),
    null,
    { timeout: RUN_TIMEOUT },
  );
}

describe("the column scrolls on its own on a short screen (Fran's #253 check, N1)", () => {
  for (const { width, height, errors: withErrors } of SHORT) {
    test(`${width}x${height}${withErrors ? " with run-field errors" : ""}: the live line is in reach at the top of the page`, async () => {
      const { context, page, errors } = await open(width, { height });
      try {
        await finishBatch(page);
        await toArea(page, "character");
        if (withErrors) {
          await page.fill("#run-duration", "0");
          await page.fill("#run-iterations", "0");
          await page.locator("#run-seed").fill("x");
          await page.locator("#run-seed").blur();
          await page.waitForFunction(
            () =>
              globalThis.document.querySelectorAll(
                ".run-column .field-error:not([hidden])",
              ).length > 0,
          );
        }
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        const at = await page.evaluate(() => {
          const doc = globalThis.document;
          const column = doc.querySelector(".run-column");
          const box = column.getBoundingClientRect();
          return {
            bottom: box.bottom,
            screen: globalThis.innerHeight,
            scrolls: column.scrollHeight > column.clientHeight,
            overflow: getComputedStyle(column).overflowY,
            sideways: column.scrollWidth - column.clientWidth,
          };
        });
        const say = JSON.stringify(at);
        assert.ok(at.bottom <= at.screen + SLACK, `inside the screen, ${say}`);
        assert.equal(at.overflow, "auto", say);
        assert.ok(at.sideways <= 0, `no sideways scroll in it, ${say}`);
        // Scrolled to its own foot, the live link and Open full results are
        // on the screen, and the page has not moved.
        const foot = await page.evaluate(() => {
          const doc = globalThis.document;
          const column = doc.querySelector(".run-column");
          column.scrollTop = column.scrollHeight;
          const seen = (node) => {
            const box = node.getBoundingClientRect();
            const hit = doc.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return (
              box.top >= 0 &&
              box.bottom <= globalThis.innerHeight &&
              (hit === node || node.contains(hit))
            );
          };
          return {
            open: seen(doc.getElementById("results-card-open")),
            live: seen(doc.querySelector(".results-card-live a")),
            page: globalThis.scrollY,
          };
        });
        assert.deepEqual(foot, { open: true, live: true, page: 0 });
        // And by keyboard: tabbing to the live link shows it.
        await page.evaluate(() => {
          const doc = globalThis.document;
          doc.querySelector(".run-column").scrollTop = 0;
          doc.getElementById("run-button").focus();
        });
        let shown = false;
        for (let step = 0; step < 40 && !shown; step += 1) {
          await page.keyboard.press("Tab");
          shown = await page.evaluate(() => {
            const doc = globalThis.document;
            const link = doc.activeElement;
            if (!link?.closest(".results-card-live")) {
              return false;
            }
            const box = link.getBoundingClientRect();
            return box.top >= 0 && box.bottom <= globalThis.innerHeight;
          });
        }
        assert.ok(shown, "tabbing to the live link scrolls it into view");
        await shot(
          page,
          `${width}x${height}${withErrors ? "-errors" : ""}-column`,
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe("a stopped batch on the card (Fran's #253 check, N2)", () => {
  test("says how many of the fights asked for ran", async () => {
    const { context, page, errors } = await open(1280, { hash: "#fight" });
    try {
      await page.check("#run-mode-batch");
      await page.fill("#run-iterations", LONG_BATCH_FIGHTS);
      await page.fill("#run-duration", LONG_BATCH_SECONDS);
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          /Running batch · [1-9][\d,]* of/.test(
            globalThis.document.getElementById("results-card").innerText,
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      await page.locator("#stop-button").click();
      await page.waitForFunction(
        () =>
          /PARTIAL/i.test(
            globalThis.document.getElementById("results-card").innerText,
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      await toArea(page, "fight");
      const text = await page.evaluate(() =>
        globalThis.document
          .getElementById("results-card")
          .innerText.replace(/\s+/g, " "),
      );
      assert.match(text, /[\d,]+ of 4,000 fights × 300 s · seed \d+/, text);
      await shot(page, "1280-card-stopped");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

// The Run panel's buttons, by row.
const buttonRows = (page) =>
  page.evaluate(() => {
    const rows = new Map();
    for (const button of globalThis.document.querySelectorAll(
      ".run-buttons button",
    )) {
      if (!button.checkVisibility()) {
        continue;
      }
      const top = Math.round(button.getBoundingClientRect().top);
      rows.set(top, [...(rows.get(top) ?? []), button.id]);
    }
    return [...rows.values()];
  });

describe("the Run panel's buttons in the column (Fran's #253 check, N5)", () => {
  for (const font of FONTS.slice(0, 2)) {
    test(`${font}: two by two from 1024 up, none alone on a row, live and batch`, async () => {
      const { context, page, errors } = await open(BUTTON_WIDTHS[0], { font });
      try {
        for (const mode of ["live", "batch"]) {
          await page.check(`#run-mode-${mode}`);
          for (const width of BUTTON_WIDTHS) {
            await page.setViewportSize({ width, height: SCREEN_HEIGHT });
            const rows = await buttonRows(page);
            const say = `${mode} at ${width}: ${JSON.stringify(rows)}`;
            assert.deepEqual(
              rows.map((row) => row.length),
              [2, 2],
              say,
            );
            const clipped = await spills(page, ".run-buttons, .run-buttons *");
            assert.deepEqual(clipped, [], say);
          }
          if (font === FONTS[0]) {
            await page.setViewportSize({
              width: BUTTON_WIDTHS[0],
              height: SCREEN_HEIGHT,
            });
            await shot(page, `1024-${mode}-buttons`);
          }
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

// Where the page and the column have scrolled to.
const scrolled = (page) =>
  page.evaluate(() => {
    const column = globalThis.document.querySelector(".run-column");
    return {
      page: globalThis.scrollY,
      column: column.scrollTop,
      columnEnd: column.scrollHeight - column.clientHeight,
    };
  });

// A point over the column, on its visible part and on no field (a wheel
// over a number field is the field's), as a resting pointer would be.
const overColumn = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const column = doc.querySelector(".run-column");
    const box = column.getBoundingClientRect();
    const top = Math.max(box.top, 0);
    const bottom = Math.min(box.bottom, globalThis.innerHeight);
    const x = box.left + box.width / 2;
    for (let y = bottom - 4; y > top; y -= 4) {
      const hit = doc.elementFromPoint(x, y);
      if (column.contains(hit) && !hit.closest("input, select, textarea")) {
        return { x, y };
      }
    }
    return { x, y: (top + bottom) / 2 };
  });

describe("a wheel over the column scrolls the page (Fran's #253 re-check, B2)", () => {
  for (const { width, height } of WHEEL_SCREENS) {
    for (const area of WHEEL_AREAS) {
      test(`${width}x${height}, ${area}: the page scrolls under a wheel over the column`, async () => {
        const { context, page, errors } = await open(width, { height });
        try {
          await toArea(page, area);
          await page.evaluate(() => globalThis.scrollTo(0, 0));
          const point = await overColumn(page);
          await page.mouse.move(point.x, point.y);
          const before = await scrolled(page);
          await page.mouse.wheel(0, WHEEL_PX);
          // The page moves, or the column if it has more to show; at
          // 1024x576 with nothing run the column fits, so the page.
          await page
            .waitForFunction(() => globalThis.scrollY > 0, null, {
              timeout: SETTLE_MS,
            })
            .catch(() => {});
          const after = await scrolled(page);
          const say = JSON.stringify({ point, before, after });
          assert.equal(before.page, 0, say);
          assert.ok(after.page > 0, `the page scrolled, ${say}`);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }

  test("1024x576 after a batch: a full column scrolls to its end first, then the page", async () => {
    const { context, page, errors } = await open(1024, { height: 576 });
    try {
      await finishBatch(page);
      await toArea(page, "character");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      const start = await scrolled(page);
      assert.ok(
        start.columnEnd > 0,
        `the column has more, ${JSON.stringify(start)}`,
      );
      const point = await overColumn(page);
      await page.mouse.move(point.x, point.y);
      const steps = [];
      for (let notch = 0; notch < MAX_NOTCHES; notch += 1) {
        await page.mouse.wheel(0, NOTCH_PX);
        await page.waitForTimeout(NOTCH_GAP_MS);
        const at = await scrolled(page);
        steps.push(at);
        if (at.page > 0 && at.column >= at.columnEnd - SLACK) {
          break;
        }
      }
      const say = JSON.stringify(steps);
      const firstPage = steps.findIndex((at) => at.page > 0);
      assert.ok(firstPage >= 0, `the page scrolled in the end, ${say}`);
      // Until the column was at its end, the page stayed put.
      for (const at of steps.slice(0, firstPage)) {
        assert.equal(at.page, 0, say);
      }
      assert.ok(steps[0].column > 0, `the column scrolled first, ${say}`);
      assert.ok(
        steps[firstPage].column >= start.columnEnd - SLACK,
        `the column was at its end when the page moved, ${say}`,
      );
      await shot(page, "1024x576-wheel-handoff");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
