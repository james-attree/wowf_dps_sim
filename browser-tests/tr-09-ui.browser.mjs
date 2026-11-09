// TR-09 / #339: the 70755 talent grid, builder pickers, breakdown labels
// and the temporary Combat swords start card. Screenshots land in
// TR09_SHOTS when that directory is set.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const SHOTS = process.env.TR09_SHOTS ?? null;
const WIDTHS = [1440, 1280, 1024, 390, 320];
const TALENTS = [
  ["assassination.venom", "Venom"],
  ["combat.flash-of-steel", "Flash of Steel"],
  ["combat.composure", "Composure"],
  ["subtlety.boot-knife", "Boot Knife"],
  ["subtlety.death-mark", "Death Mark"],
];

let server;
let base;
let browser;

before(async () => {
  if (SHOTS !== null) {
    await mkdir(SHOTS, { recursive: true });
  }
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

async function openPage(width, hash = "") {
  const context = await browser.newContext({
    viewport: { width, height: width < 1024 ? 844 : 900 },
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
  return { context, page, errors };
}

async function shot(page, name) {
  if (SHOTS === null) {
    return;
  }
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage: true,
  });
}

async function clickCentre(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await locator.boundingBox();
  await locator
    .page()
    .mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const optionTexts = (page, selector) =>
  page
    .locator(selector)
    .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));

describe("TR-09 talent grid (#339)", () => {
  for (const width of WIDTHS) {
    test(`reworked talents and icons at ${width}`, async () => {
      const { context, page, errors } = await openPage(width);
      try {
        await page.click("#talents-edit");
        await page.locator("#talent-tree").waitFor({ state: "visible" });
        for (const [id, name] of TALENTS) {
          const tree = id.slice(0, id.indexOf("."));
          const tab = page.locator(`#talents-tab-${tree}`);
          if (await tab.isVisible()) {
            await tab.click();
          }
          const tile = page.locator(`button.talent[data-id="${id}"]`);
          await tile.scrollIntoViewIfNeeded();
          assert.match(await tile.getAttribute("aria-label"), new RegExp(name));
          const src = await tile.locator("img").getAttribute("src");
          assert.match(src, /^https:\/\/.+\/[a-z0-9_]+\.jpg$/);
          assert.equal(
            await tile.locator(".talent-cov.is-notsim").getAttribute("hidden"),
            "",
            `${name} is mapped, so it has no pending badge`,
          );
        }
        assert.equal(
          await page
            .locator("#talents-legend")
            .getByText("not simulated yet")
            .count(),
          0,
        );
        const pageWidth = await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        );
        assert.equal(pageWidth, true);
        await shot(page, `talent-grid-${width}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe("TR-09 start screen (#339)", () => {
  for (const width of WIDTHS) {
    test(`temporary Combat swords and Custom at ${width}`, async () => {
      const { context, page, errors } = await openPage(width, "#character");
      try {
        await page.locator("#start-cards").waitFor();
        assert.deepEqual(
          await page.evaluate(() =>
            [...document.querySelectorAll("#start-cards button")].map((node) =>
              node.id.replace("start-card-", ""),
            ),
          ),
          ["combat-swords-temp", "custom"],
        );
        await shot(page, `start-${width}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe("TR-09 builder pickers (#339)", () => {
  for (const width of WIDTHS) {
    test(`Shank, Death Mark and the rework conditions at ${width}`, async () => {
      const { context, page, errors } = await openPage(width, "#rotation");
      try {
        await page.locator("#rotation-builder").waitFor();
        const rules = page.locator("#rotation-builder li.rule");
        await clickCentre(rules.nth(7).locator("[data-key$='.edit']"));
        await page.locator("#rotation-builder .rule-screen").waitFor();
        const actions = await optionTexts(
          page,
          "#rotation-builder .rule-action option",
        );
        assert.ok(actions.includes("Shank"));
        assert.ok(actions.includes("Death Mark (talent)"));
        const screen = page.locator("#rotation-builder .rule-screen");
        await screen
          .locator("[data-key$='.type']")
          .first()
          .selectOption("auraActive");
        const buffs = await optionTexts(page, "[data-key$='.aura'] option");
        for (const name of ["Venom", "Poised", "Ambush window"]) {
          assert.ok(buffs.includes(name), name);
        }
        await screen
          .locator("[data-key$='.type']")
          .first()
          .selectOption("debuffActive");
        const debuffs = await optionTexts(page, "[data-key$='.debuff'] option");
        assert.ok(debuffs.includes("Death Mark"));
        await page.locator("[data-key$='.debuff']").selectOption("death-mark");
        assert.equal(
          await page
            .locator("#rotation-builder option")
            .getByText("deathMarkStored", { exact: true })
            .count(),
          0,
        );
        const pageWidth = await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        );
        assert.equal(pageWidth, true);
        await shot(page, `pickers-${width}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});

describe("TR-09 breakdown labels (#339)", () => {
  for (const width of WIDTHS) {
    test(`Shank is labelled in the results table at ${width}`, async () => {
      const { context, page, errors } = await openPage(width, "#fight");
      try {
        await page.fill("#run-duration", "8");
        await page.locator("#run-duration").press("Tab");
        await page.locator("#run-button").click();
        await page.waitForFunction(
          () =>
            /finished/.test(
              document.getElementById("results-announce")?.textContent ?? "",
            ),
          null,
          { timeout: 60_000 },
        );
        const labels = await page
          .locator("[data-breakdown] tbody th")
          .allTextContents();
        assert.ok(
          labels.some((label) => label.includes("Shank")),
          labels.join(" | "),
        );
        await shot(page, `breakdown-${width}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
