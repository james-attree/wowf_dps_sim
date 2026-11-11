// Manual fight B1 board (#348): 3-column phone bar, 44px slots, 100% and
// 150% text with no sideways scroll, reduced motion, keybinds, Replay.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [360, 390, 1024, 1280, 1440];
const PHONE = [360, 390];
const SCREEN_HEIGHT = 900;
const TARGET_PX = 44;
const COLUMNS = 3;

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

async function open(width, { text = "100%", reduced = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    reducedMotion: reduced ? "reduce" : "no-preference",
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
  await page.goto(`${base}#fight`, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `html { font-size: ${text} !important; }`,
  });
  await page.locator("#area-fight").waitFor({ state: "visible" });
  await page.locator("#run-button").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const duration = globalThis.document.getElementById("run-duration");
    const button = globalThis.document.getElementById("run-button");
    return Boolean(duration?.value) && button && !button.disabled;
  });
  return { context, page, errors };
}

async function startManual(page) {
  await page.locator("#fight-mode-manual").check();
  await page.locator("#manual-board").waitFor({ state: "visible" });
  const live = page.locator("#run-mode-live");
  if (await live.count()) {
    await live.check();
  }
  await page.locator("#run-button").click();
  await page.locator(".manual-slot").first().waitFor({ state: "visible" });
}

describe("Manual fight board layout and behaviour (#348)", () => {
  for (const text of ["100%", "150%"]) {
    for (const width of WIDTHS) {
      test(`${width} at ${text} text: no sideways scroll, slots at least 44px`, async () => {
        const { context, page, errors } = await open(width, { text });
        try {
          await startManual(page);
          const metrics = await page.evaluate(() => {
            const doc = globalThis.document;
            const scrolled =
              doc.documentElement.scrollWidth >
              doc.documentElement.clientWidth + 1;
            const slots = [...doc.querySelectorAll(".manual-slot")].map(
              (slot) => {
                const box = slot.getBoundingClientRect();
                return { w: box.width, h: box.height };
              },
            );
            const bar = doc.querySelector(".manual-bar");
            const style = globalThis.getComputedStyle(bar);
            return {
              scrolled,
              slots,
              columns: style.gridTemplateColumns.split(" ").length,
              overflow: doc.documentElement.scrollWidth,
              client: doc.documentElement.clientWidth,
            };
          });
          assert.equal(errors.length, 0, errors.join("\n"));
          assert.equal(
            metrics.scrolled,
            false,
            `scroll ${metrics.overflow} > ${metrics.client}`,
          );
          assert.ok(metrics.slots.length > 0, "slots rendered");
          for (const slot of metrics.slots) {
            assert.ok(slot.w + 0.01 >= TARGET_PX, `width ${slot.w}`);
            assert.ok(slot.h + 0.01 >= TARGET_PX, `height ${slot.h}`);
          }
          if (PHONE.includes(width)) {
            assert.equal(metrics.columns, COLUMNS);
          }
        } finally {
          await context.close();
        }
      });
    }
  }

  test("keys 1 and W, initials path, reduced motion, Replay keeps the seed", async () => {
    const { context, page, errors } = await open(390, { reduced: true });
    try {
      await startManual(page);
      const first = page.locator(".manual-slot").first();
      await first.focus();
      const clockBefore = await page.locator("#manual-clock").textContent();
      await page.keyboard.press("1");
      const clockAfter = await page.locator("#manual-clock").textContent();
      assert.notEqual(clockAfter, clockBefore);
      assert.match(clockAfter, /00:01\./);
      const fill = await page
        .locator("#manual-mock-health-fill")
        .evaluate((node) => node.style.width);
      assert.notEqual(fill, "100%");
      const well = await page.locator("#manual-well-event").textContent();
      assert.ok(well.trim().length > 0, `well was ${well}`);
      assert.notEqual(await first.getAttribute("aria-disabled"), "true");
      await page.keyboard.press("w");
      const waitFocused = await page.evaluate(() =>
        globalThis.document.activeElement?.classList.contains("manual-wait"),
      );
      assert.equal(waitFocused, true);
      const floats = await page.locator(".manual-float").count();
      assert.equal(floats, 0, "reduced motion has no floats");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Replay restarts the same seed from 0:00", async () => {
    const { context, page, errors } = await open(390);
    try {
      await page.locator("#run-duration").fill("1");
      await page.locator("#run-duration").press("Tab");
      await startManual(page);
      const seed = await page.locator("#run-seed").inputValue();
      await page.locator(".manual-wait[data-wait-kind='time']").click();
      const reached = await page.locator("#manual-well-event").textContent();
      assert.equal(reached.trim(), "Reached the wait");
      await page.locator(".manual-wait[data-wait-kind='time']").click();
      await page.locator("#manual-review").waitFor({ state: "visible" });
      const announced = await page.locator("#manual-announce").textContent();
      assert.match(announced, /Fight ended before the wait finished/);
      await page.locator("#manual-review-replay").click();
      const after = await page.locator("#run-seed").inputValue();
      assert.equal(after, seed);
      const time = await page.locator("#manual-clock").textContent();
      assert.match(time, /00:00\.0/);
      assert.equal(await page.locator("#manual-review").isHidden(), true);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });
});
