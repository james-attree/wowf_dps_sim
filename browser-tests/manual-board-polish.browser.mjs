// #287 PR 5 (#425): Manual board polish with item 7c. On the Subtlety
// daggers board: long slot names wrap inside their slot at 100% and 150%
// text, under Inter and under DejaVu as CI has it; Review leaves out 0-damage
// rows; a fading float keeps 4.5:1 on the well and is hidden at the end;
// the board's live region names quiet casts (#369 N4) and skipped armed
// reasons (#373 item 4); forced colours paint the board's labels at 4.5:1
// (#373 item 5); slots and Waits have a pointer hover (#373 item 6).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const AXE = await readFile(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const PINNED_FONT = "DejaVu Sans";
const PHONES = [360, 390];
const TEXT_SIZES = ["100%", "150%"];
const SCREEN_HEIGHT = 900;
const WIDE = 1280;
const TARGET_PX = 44;
const TEXT_CONTRAST = 4.5;
const EDGE_CONTRAST = 3;
const FLOAT_TRIES = 6;
// Points in the 800ms rise, in ms, where the fade is checked.
const FADE_POINTS = [0, 400, 799];
const SLACK = 0.5;
// A fixed seed, so the 1 s Review always has a landed white hit.
const SEED = "1";

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

async function open(
  width,
  { text = "100%", font = null, forcedColors = null, e2e = false } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    reducedMotion: "no-preference",
    ...(forcedColors ? { forcedColors } : {}),
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
  await page.goto(`${base}${e2e ? "?e2e" : ""}#fight`, {
    waitUntil: "networkidle",
  });
  const pin = font ? `:root { font-family: "${font}" !important; } ` : "";
  await page.addStyleTag({
    content: `${pin}html { font-size: ${text} !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

async function pickSubtlety(page) {
  await page.evaluate(() => {
    globalThis.location.hash = "#character";
  });
  const card = page.locator("#start-card-subtlety-daggers");
  await card.waitFor({ state: "visible" });
  await card.click();
  await page.evaluate(() => {
    globalThis.location.hash = "#fight";
  });
  await page.locator("#run-button").waitFor({ state: "visible" });
}

async function startManual(page, seconds) {
  await page.locator("#fight-mode-manual").check();
  await page.waitForFunction(
    () => globalThis.document.getElementById("run-mode-live")?.checked,
  );
  const duration = page.locator("#run-duration");
  await duration.fill(seconds);
  await duration.press("Tab");
  await page.locator("#run-seed").fill(SEED);
  await page.locator("#run-seed").blur();
  await page.locator("#run-button").click();
  await page.locator(".manual-slot").first().waitFor({ state: "visible" });
}

// Contrast of two computed colours, after `opacity` is applied to the first.
const CONTRAST_SOURCE = `
  const parse = (text) => {
    const values = (text.match(/[-\\d.]+/g) ?? []).map(Number);
    if (/color\\(srgb/i.test(text)) {
      return { r: values[0] * 255, g: values[1] * 255, b: values[2] * 255, a: values[3] ?? 1 };
    }
    return { r: values[0], g: values[1], b: values[2], a: values[3] ?? 1 };
  };
  const lum = ({ r, g, b }) => {
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (fg, bg) => {
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const backdrop = (node) => {
    for (let el = node; el; el = el.parentElement) {
      const bg = parse(globalThis.getComputedStyle(el).backgroundColor);
      if (bg.a > 0) {
        return bg;
      }
    }
    return parse(globalThis.getComputedStyle(globalThis.document.documentElement).backgroundColor);
  };
`;

describe("Manual slot names wrap inside the slot (#287 PR 5)", () => {
  for (const font of [null, PINNED_FONT]) {
    for (const text of TEXT_SIZES) {
      const label = font ?? "the page font";
      test(`Subtlety names stay in their slots at ${text} text with ${label}`, async () => {
        const { context, page, errors } = await open(PHONES[0], {
          text,
          font,
        });
        try {
          await pickSubtlety(page);
          await startManual(page, "30");
          for (const width of PHONES) {
            await page.setViewportSize({ width, height: SCREEN_HEIGHT });
            const metrics = await page.evaluate(
              ({ slack, least }) => {
                const doc = globalThis.document;
                const spill = [...doc.querySelectorAll(".manual-slot")]
                  .map((slot) => {
                    const name = slot.querySelector(".manual-slot-name");
                    const box = slot.getBoundingClientRect();
                    const inner = name.getBoundingClientRect();
                    return {
                      text: name.textContent,
                      out:
                        inner.left < box.left - slack ||
                        inner.right > box.right + slack ||
                        name.scrollWidth > name.clientWidth + slack,
                      w: box.width,
                      h: box.height,
                    };
                  })
                  .filter((row) => row.out || row.w < least || row.h < least);
                return {
                  spill,
                  premed:
                    doc.querySelector(
                      '.manual-slot[data-ability-id="premeditation"]',
                    ) !== null,
                  scroll:
                    doc.documentElement.scrollWidth -
                    doc.documentElement.clientWidth,
                };
              },
              { slack: SLACK, least: TARGET_PX },
            );
            assert.equal(metrics.premed, true, "Premeditation is on the bar");
            assert.deepEqual(metrics.spill, [], `${width}px`);
            assert.ok(
              metrics.scroll <= 1,
              `${width}px scrolls ${metrics.scroll}`,
            );
          }
          assert.equal(errors.length, 0, errors.join("\n"));
        } finally {
          await context.close();
        }
      });
    }
  }
});

describe("Review and the board's live region (#287 PR 5, 7c)", () => {
  test("Review after Premeditation and Preparation has no 0-damage rows", async () => {
    const { context, page, errors } = await open(390);
    try {
      await pickSubtlety(page);
      await startManual(page, "1");
      await page
        .locator('.manual-slot[data-ability-id="premeditation"]')
        .click();
      await page.locator('.manual-slot[data-ability-id="preparation"]').click();
      await page.locator("#manual-review").waitFor({ state: "visible" });
      const rows = await page.$$eval("#manual-review-breakdown li", (items) =>
        items.map((item) => item.textContent),
      );
      assert.ok(rows.length > 0, "breakdown is empty");
      for (const row of rows) {
        assert.doesNotMatch(row, / · 0 · /, row);
      }
      const timing = await page.locator("#manual-review-timing").textContent();
      assert.match(timing, /00:00\.0\s+Premeditation/);
      assert.match(timing, /00:00\.0\s+Preparation/);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Premeditation then Preparation are announced in a longer fight", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      await pickSubtlety(page);
      await startManual(page, "30");
      await page
        .locator('.manual-slot[data-ability-id="premeditation"]')
        .click();
      await page.locator('.manual-slot[data-ability-id="preparation"]').click();
      assert.equal(
        await page.locator("#manual-announce").textContent(),
        "Premeditation, cast. Preparation, cast",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  // No preset board has a pair where firing one armed ability makes the
  // next one unready at the same instant, so this drives the board's store
  // through the ?e2e hook with the skip the host records (#373 item 4).
  test("a skipped armed ability's reason reaches the live region", async () => {
    const { context, page, errors } = await open(390, { e2e: true });
    try {
      await pickSubtlety(page);
      await startManual(page, "30");
      await page
        .locator('.manual-slot[data-ability-id="premeditation"]')
        .click();
      await page.locator('.manual-slot[data-ability-id="preparation"]').click();
      await page.evaluate(() => {
        globalThis.__store.update((current) => ({
          manual: {
            ...current.manual,
            skipped: [
              { abilityId: "premeditation", reason: "On cooldown, 3.0 s left" },
            ],
          },
        }));
      });
      assert.equal(
        await page.locator("#manual-announce").textContent(),
        "On cooldown, 3.0 s left Premeditation, cast. Preparation, cast",
      );
      assert.equal(
        await page.locator("#manual-announce").getAttribute("role"),
        "status",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });
});

describe("Fading floats keep their contrast (#287 PR 5)", () => {
  test("a float stays at 4.5:1 on the well through the fade and is hidden after", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      await startManual(page, "30");
      await page.addScriptTag({ content: AXE });
      const strike = page.locator(
        '.manual-slot[data-ability-id="sinister-strike"]',
      );
      for (let n = 0; n < FLOAT_TRIES; n += 1) {
        if ((await page.locator(".manual-float").count()) > 0) {
          break;
        }
        if ((await strike.getAttribute("aria-disabled")) === "true") {
          await page.locator(".manual-wait[data-wait-kind='time']").click();
        } else {
          await strike.click();
        }
      }
      assert.ok((await page.locator(".manual-float").count()) > 0, "no float");
      for (const at of FADE_POINTS) {
        const result = await page.evaluate(
          async ({ at, source }) => {
            const read = new Function(
              `${source}; return { parse, ratio, backdrop };`,
            )();
            const floats = [
              ...globalThis.document.querySelectorAll(".manual-float"),
            ];
            for (const node of floats) {
              for (const animation of node.getAnimations()) {
                animation.pause();
                animation.currentTime = at;
              }
            }
            const lows = floats.map((node) => {
              const style = globalThis.getComputedStyle(node);
              const fg = read.parse(style.color);
              const bg = read.backdrop(node.parentElement);
              const a = Number(style.opacity);
              const shown = {
                r: a * fg.r + (1 - a) * bg.r,
                g: a * fg.g + (1 - a) * bg.g,
                b: a * fg.b + (1 - a) * bg.b,
              };
              return read.ratio(shown, bg);
            });
            const axeRun = await globalThis.axe.run(
              globalThis.document.getElementById("manual-well"),
              { runOnly: ["color-contrast"] },
            );
            return {
              lows,
              violations: axeRun.violations.flatMap((v) =>
                v.nodes.map((n) => n.target.join(" ")),
              ),
            };
          },
          { at, source: CONTRAST_SOURCE },
        );
        for (const low of result.lows) {
          assert.ok(low >= TEXT_CONTRAST, `${at}ms: ${low.toFixed(2)}:1`);
        }
        assert.deepEqual(result.violations, [], `${at}ms`);
      }
      const ended = await page.evaluate(() =>
        [...globalThis.document.querySelectorAll(".manual-float")].map(
          (node) => {
            for (const animation of node.getAnimations()) {
              animation.finish();
            }
            return globalThis.getComputedStyle(node).visibility;
          },
        ),
      );
      assert.ok(ended.length > 0);
      for (const visibility of ended) {
        assert.equal(visibility, "hidden");
      }
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });
});

describe("Forced colours and hover on the Manual board (#287 PR 5, 7c)", () => {
  // axe reads the author colours here (#d4c8b1 on white) and reports them;
  // this checks the colours Chrome paints in forced colours (#373 item 5).
  test("forced colours paint the board's labels at 4.5:1", async () => {
    const { context, page, errors } = await open(WIDE, {
      forcedColors: "active",
    });
    try {
      await startManual(page, "30");
      const rows = await page.evaluate((source) => {
        const read = new Function(
          `${source}; return { parse, ratio, backdrop };`,
        )();
        const doc = globalThis.document;
        const nodes = [
          "#manual-player-label",
          "#manual-target-label",
          "#manual-energy-text",
          "#manual-combo-text",
          "#manual-remaining",
          ".manual-mock-health-label",
          ".manual-slot-name",
          ".manual-wait-label",
        ].map((selector) => doc.querySelector(selector));
        return nodes.map((node) => ({
          id: node.id || node.className,
          ratio: read.ratio(
            read.parse(globalThis.getComputedStyle(node).color),
            read.backdrop(node),
          ),
        }));
      }, CONTRAST_SOURCE);
      assert.equal(rows[0].id, "manual-player-label");
      for (const row of rows) {
        assert.ok(
          row.ratio >= TEXT_CONTRAST,
          `${row.id} ${row.ratio.toFixed(2)}:1`,
        );
      }
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("a ready slot and a Wait change on hover; armed and disabled slots do not", async () => {
    const { context, page, errors } = await open(WIDE);
    try {
      await pickSubtlety(page);
      await startManual(page, "30");
      const look = (locator) =>
        locator.evaluate((node, source) => {
          const read = new Function(
            `${source}; return { parse, ratio, backdrop };`,
          )();
          const style = globalThis.getComputedStyle(node);
          const face = read.parse(style.backgroundColor);
          const texts = [...node.querySelectorAll("span")]
            .filter((span) => span.textContent.trim())
            .map((span) =>
              read.ratio(
                read.parse(globalThis.getComputedStyle(span).color),
                face,
              ),
            );
          return {
            border: style.borderTopColor,
            background: style.backgroundColor,
            edge: Math.min(
              read.ratio(read.parse(style.borderTopColor), face),
              read.ratio(
                read.parse(style.borderTopColor),
                read.backdrop(node.parentElement),
              ),
            ),
            text: Math.min(...texts),
          };
        }, CONTRAST_SOURCE);
      const ready = page.locator(
        '.manual-slot[data-ability-id="sinister-strike"]',
      );
      const wait = page.locator(".manual-wait[data-wait-kind='time']");
      const premed = page.locator(
        '.manual-slot[data-ability-id="premeditation"]',
      );
      const disabled = page
        .locator('.manual-slot[aria-disabled="true"]')
        .first();
      for (const target of [ready, wait]) {
        await page.mouse.move(0, 0);
        const rest = await look(target);
        await target.hover();
        const over = await look(target);
        assert.notEqual(over.border, rest.border);
        assert.notEqual(over.background, rest.background);
        assert.ok(over.edge >= EDGE_CONTRAST, `edge ${over.edge}`);
        assert.ok(over.text >= TEXT_CONTRAST, `text ${over.text}`);
      }
      await premed.click();
      assert.equal(await premed.getAttribute("aria-pressed"), "true");
      await page.mouse.move(0, 0);
      const armedRest = await look(premed);
      await premed.hover();
      assert.deepEqual(await look(premed), armedRest);
      await page.mouse.move(0, 0);
      const disabledRest = await look(disabled);
      await disabled.hover({ force: true });
      assert.deepEqual(await look(disabled), disabledRest);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });
});
