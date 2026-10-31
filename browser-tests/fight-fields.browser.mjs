// Fight's settings (#245; proposal sections 3 and 5): the run type, the
// fight length, fights and seed are in Fight at every width, with the target
// note under them. On wide screens the Run panel keeps Run and its status
// and links to them ("Change fight settings"); on a phone the dock keeps Run
// and its status. The Fix link takes you to Fight and the field to fix, a
// field's error is in view beside the Fight nav's badge (Fran's #258 check,
// P4), and Run uses what a field shows even before it is left.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const SHOTS = process.env.SHOTS_DIR ?? null;
const PREFIX = process.env.SHOTS_PREFIX ?? "ff";
const WIDE = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
// CI's fallback font, the widest it may draw in.
const PINNED_FONT = "DejaVu Sans";
const FIELDS = [
  "run-mode-batch",
  "run-mode-live",
  "run-duration",
  "run-iterations",
  "run-seed",
  "run-seed-new",
];
const BAD_LENGTH = "0";
const TYPED_LENGTH = "7";
const NEXT_LENGTH = "8";
const BATCH_FIGHTS = "5";
const RUN_TIMEOUT = 60_000;

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

async function open({ width, height }, hash) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${hash}`);
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }`,
  });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

const hashIs = (page, hash) =>
  page.waitForFunction((to) => globalThis.location.hash === to, hash);

const toArea = async (page, area) => {
  await page.locator(`[data-nav-area="${area}"]`).click();
  await hashIs(page, `#${area}`);
  await page.locator(`#area-${area}`).waitFor({ state: "visible" });
};

const focusId = (page) =>
  page.evaluate(() => globalThis.document.activeElement?.id ?? "");

const shot = async (page, name) => {
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/${PREFIX}-${name}.png`,
      fullPage: true,
    });
  }
};

// Where each field is: in Fight, and shown.
const placed = (page) =>
  page.evaluate(
    (ids) =>
      ids.map((id) => {
        const node = globalThis.document.getElementById(id);
        return {
          id,
          inFight: node.closest("#area-fight") !== null,
          inRun: node.closest("#run-controls") !== null,
        };
      }),
    FIELDS,
  );

describe("the fight's settings are Fight's (#245)", () => {
  test("wide: in Fight, above the target note; the Run panel links there", async () => {
    const { context, page, errors } = await open(WIDE, "#character");
    try {
      for (const at of await placed(page)) {
        assert.deepEqual(at, { id: at.id, inFight: true, inRun: false });
      }
      const link = page.locator("#run-fight-link");
      assert.equal(await link.isVisible(), true, "the link off Fight");
      assert.equal(await link.textContent(), "Change fight settings");
      assert.equal(await link.getAttribute("href"), "#fight");
      assert.equal(
        await page
          .locator("#run-fight-link")
          .evaluate((node) => node.closest("#run-controls")?.id ?? null),
        "run-controls",
      );
      await link.click();
      await hashIs(page, "#fight");
      await page.locator("#area-fight").waitFor({ state: "visible" });
      assert.equal(await page.locator("#run-duration").isVisible(), true);
      assert.equal(await link.isVisible(), false, "no link on Fight");
      // The note is under the fields.
      const below = await page.evaluate(() => {
        const doc = globalThis.document;
        const note = doc.getElementById("fight-target").getBoundingClientRect();
        const seed = doc.getElementById("run-seed").getBoundingClientRect();
        return note.top >= seed.bottom;
      });
      assert.equal(below, true);
      assert.equal(
        await page.locator("legend").filter({ hasText: "Run type" }).count(),
        1,
      );
      assert.equal(
        await page.getByRole("radio", { name: "Average" }).isChecked(),
        true,
      );
      assert.equal(
        await page.getByRole("radio", { name: "Live fight" }).isChecked(),
        false,
      );
      assert.equal(
        await page.getByRole("button", { name: "New seed" }).count(),
        1,
      );
      await shot(page, "fight-1280");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("phone: the dock keeps Run and its status, the fields are in Fight", async () => {
    const { context, page, errors } = await open(PHONE, "#character");
    try {
      assert.equal(await page.locator("#run-fight-link").isVisible(), false);
      assert.equal(await page.locator("#run-button").isVisible(), true);
      assert.equal(
        await page
          .locator("#run-status-text")
          .evaluate((node) => node.closest("#run-controls") !== null),
        true,
      );
      assert.equal(await page.locator("#run-duration").isVisible(), false);
      await toArea(page, "fight");
      for (const id of FIELDS.filter((one) => !one.startsWith("run-mode"))) {
        assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
      }
      await shot(page, "fight-390");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

for (const size of [WIDE, PHONE]) {
  describe(`a fight field's error at ${size.width}px (#245)`, () => {
    test("Fix takes you to Fight and the field; the error is in view with Fight's badge (P4)", async () => {
      const { context, page, errors } = await open(size, "#fight");
      try {
        await page.fill("#run-duration", BAD_LENGTH);
        await page.locator("#run-duration").blur();
        const badge = page.locator('[data-nav-area="fight"] [data-badge]');
        await badge.waitFor({ state: "visible" });
        // P4: the badge and the error it counts are both on the screen.
        assert.equal(
          await page.locator("#run-duration-error").isVisible(),
          true,
        );
        assert.equal(
          await page.getAttribute("#run-duration", "aria-invalid"),
          "true",
        );
        await shot(page, `p4-badge-${size.width}`);

        await toArea(page, "rotation");
        const fix = page.locator("#run-errors-link");
        await fix.waitFor({ state: "visible" });
        assert.equal(await fix.textContent(), "Fix 1 setting");
        await fix.click();
        await hashIs(page, "#fight");
        await page.locator("#area-fight").waitFor({ state: "visible" });
        await page.waitForFunction(
          () => globalThis.document.activeElement?.id === "run-duration",
        );
        assert.equal(await focusId(page), "run-duration");
        assert.equal(await page.locator("#run-duration").isVisible(), true);
        assert.equal(await page.locator("#run-button").isDisabled(), true);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

describe("Run uses what Fight's fields show (#245, commitEdits)", () => {
  test("a length typed and not left is the one the batch runs; editing it after leaves the average current", async () => {
    const { context, page, errors } = await open(WIDE, "#fight");
    try {
      await page.fill("#run-iterations", BATCH_FIGHTS);
      await page.locator("#run-iterations").blur();
      await page.fill("#run-duration", TYPED_LENGTH);
      // Still in the field: Run commits it first.
      assert.equal(await focusId(page), "run-duration");
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          /^Batch finished/.test(
            globalThis.document.getElementById("results-announce")
              ?.textContent ?? "",
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      assert.match(
        await page.locator("#results-average-label").textContent(),
        // The length keeps its unit: a no-break space (#245).
        new RegExp(
          `^Average · ${BATCH_FIGHTS} × ${TYPED_LENGTH}\u00a0s fights`,
        ),
      );
      // The run fields are the next run's (js/views/stale.js): moving them
      // to Fight does not put the kept average out of date.
      await toArea(page, "fight");
      await page.fill("#run-duration", NEXT_LENGTH);
      await page.locator("#run-duration").blur();
      await toArea(page, "results");
      assert.doesNotMatch(
        await page.locator("#results-card").innerText(),
        /Out of date/,
      );
      assert.doesNotMatch(
        await page.locator("#run-status-text").textContent(),
        /Out of date/,
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
