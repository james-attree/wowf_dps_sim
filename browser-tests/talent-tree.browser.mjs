// Browser tests for the talent tree (#204, Fran's QA of #208, and the U6
// polish: the narrow run bar's over-cap status). They drive the
// real page in Chrome through playwright-core, so they run apart from
// `npm test`: `npm run test:browser`. Chrome comes from CHROME_PATH, else the
// installed Google Chrome channel (ubuntu-latest ships it).
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const WIDTHS = [1280, 390];

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

// A page at the given width with the talent tree open. Icons come from a CDN;
// every off-box request gets a local icon instead, so a tile keeps a real <img>
// (the node the lost click landed on) and the test needs no network.
async function openTree(width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  const page = await context.newPage();
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) =>
      route.request().resourceType() === "image"
        ? route.fulfill({ status: 200, contentType: "image/jpeg", body: ICON })
        : route.abort(),
  );
  await page.goto(base);
  await page.click("#talents-edit");
  await page.locator("#talent-tree").waitFor({ state: "visible" });
  return { context, page };
}

const tile = (page, id) => page.locator(`button.talent[data-id="${id}"]`);
const spent = async (page) =>
  (await page.locator("#talents-points").textContent()).match(/\d+ of \d+/)[0];

// One real mouse click at the tile's centre, which is on its icon <img>.
async function clickCentre(page, id, modifiers = []) {
  const target = tile(page, id);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  for (const key of modifiers) await page.keyboard.up(key);
}

for (const width of WIDTHS) {
  describe(`talent tree in Chrome at ${width}px`, () => {
    let context;
    let page;
    beforeEach(async () => {
      await context?.close();
      ({ context, page } = await openTree(width));
    });
    after(() => context?.close());

    test("one click on an unfocused tile adds a point (1 of N)", async () => {
      const malice = "assassination.malice";
      assert.notEqual(
        await page.evaluate(() => document.activeElement?.dataset?.id),
        malice,
      );
      await clickCentre(page, malice);
      assert.match(await spent(page), /^1 of \d+$/);
      assert.match(
        await tile(page, malice).getAttribute("aria-label"),
        /1 of 5/,
      );
    });

    test("one Shift-click on an unfocused tile removes a point", async () => {
      const malice = "assassination.malice";
      await clickCentre(page, malice);
      await clickCentre(page, malice);
      // Move focus to another tile so Malice is unfocused again.
      await clickCentre(page, "assassination.remorseless-attacks");
      assert.match(await spent(page), /^3 of \d+$/);
      assert.equal(
        await page.evaluate(() => document.activeElement?.dataset?.id),
        "assassination.remorseless-attacks",
      );
      await clickCentre(page, malice, ["Shift"]);
      assert.match(await spent(page), /^2 of \d+$/);
      assert.match(
        await tile(page, malice).getAttribute("aria-label"),
        /1 of 5/,
      );
    });

    test("a tile keeps its nodes through a select and a rank change", async () => {
      const malice = "assassination.malice";
      await page.evaluate((id) => {
        const node = document.querySelector(`button.talent[data-id="${id}"]`);
        globalThis.__kids = [...node.children];
      }, malice);
      await clickCentre(page, malice);
      await clickCentre(page, malice);
      const same = await page.evaluate((id) => {
        const node = document.querySelector(`button.talent[data-id="${id}"]`);
        const kids = [...node.children];
        return (
          kids.length === globalThis.__kids.length &&
          kids.every((kid, i) => kid === globalThis.__kids[i])
        );
      }, malice);
      assert.equal(same, true);
    });

    test("over the cap, the run bar shows the whole status and stays compact", async () => {
      await clickCentre(page, "assassination.malice");
      await clickCentre(page, "assassination.malice");
      await page.fill("#talents-level", "10");
      await page.press("#talents-level", "Enter");
      const bar = await page.evaluate(() => {
        const text = document.querySelector("#run-status-text");
        const shown =
          getComputedStyle(text, "::before").content.match(
            /^"(.*)" \/ ""$/,
          )?.[1] ?? text.textContent;
        return {
          shown,
          clipped: text.scrollWidth > text.clientWidth,
          height: document
            .querySelector(".run-row-actions")
            .getBoundingClientRect().height,
          sticky: getComputedStyle(document.querySelector(".run-row-actions"))
            .position,
          reason: document.querySelector("#run-reason").textContent,
          describedBy: document
            .querySelector("#run-button")
            .getAttribute("aria-describedby"),
        };
      });
      // Narrow: one compact sticky row, 64 px or less (#153), with the short
      // text in full; wide: the full text in full.
      assert.equal(
        bar.shown,
        width < 520
          ? "Can't run · Talents over cap"
          : "Can't run · Talents over the level cap",
      );
      assert.equal(bar.clipped, false, "no ellipsis");
      if (width < 520) {
        assert.equal(bar.sticky, "sticky");
        assert.ok(bar.height <= 64, `row is ${bar.height} px`);
      }
      // Screen readers get the full text: Run is described by the reason.
      assert.equal(bar.reason, "Can't run · Talents over the level cap");
      assert.equal(bar.describedBy, "run-reason");
    });

    test("over the cap, Fix 1 setting opens the tree and focuses Level", async () => {
      await clickCentre(page, "assassination.malice");
      await clickCentre(page, "assassination.malice");
      await page.fill("#talents-level", "10");
      await page.press("#talents-level", "Enter");
      // Close the tree so the link has to open it again.
      await page.click("#talents-edit");
      await page.locator("#talent-tree").waitFor({ state: "hidden" });
      assert.equal(
        await page.locator("#run-reason").textContent(),
        "Can't run · Talents over the level cap",
      );
      const link = page.locator("#run-errors-link");
      assert.equal(await link.textContent(), "Fix 1 setting");
      await link.click();
      await page.locator("#talent-tree").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#talents-edit").getAttribute("aria-expanded"),
        "true",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "talents-level",
      );
    });
  });
}
