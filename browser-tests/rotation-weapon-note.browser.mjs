// #406 P2: a short note next to the Rotation preset when the chosen
// rotation's abilities require a weapon type the equipped hand does not
// match. coordinator call 16 Nov (James delegated). It does not block
// Run and does not change gear.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const NOTE = "#cfg-rotation-weapon-note";
const NOTE_TEXT = "#cfg-rotation-weapon-note-text";
const NOTE_LINK = "#cfg-rotation-weapon-note-gear";
const SWORD = "Shortsword of Vengeance";
const DAGGER = "The Lobotomizer";

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

async function open(width = 1280, hash = "#rotation") {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
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
  await page.goto(`${base}?e2e${hash}`);
  await page.waitForFunction(() => globalThis.__store != null);
  return { context, page, errors };
}

async function go(page, hash, selector) {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
}

async function equipMainHand(page, name) {
  await go(page, "#character/gear", "#gear-screen");
  await page.click("#gear-slot-mainHand");
  await page.locator("#gear-picker").waitFor({ state: "visible" });
  await page.fill("#gear-search", name);
  await page
    .locator("#gear-list [role='option']")
    .filter({ hasText: name })
    .first()
    .click();
  await page.waitForFunction(
    (wanted) =>
      document
        .querySelector("#gear-slot-mainHand .gear-slot-name")
        ?.textContent?.includes(wanted) === true,
    name,
  );
}

const clean = (text) => text.replace(/\s+/g, " ").trim();

async function noteText(page) {
  const hidden = await page.locator(NOTE).getAttribute("hidden");
  if (hidden !== null) {
    return null;
  }
  return clean(await page.locator(NOTE_TEXT).textContent());
}

describe("weapon-type mismatch note next to the preset (#406 P2)", () => {
  test("the page default hides the note", async () => {
    const { context, page, errors } = await open();
    try {
      await page.locator("#cfg-rotation").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#cfg-rotation").inputValue(),
        "combat-daggers",
      );
      assert.equal(await page.locator(NOTE).isVisible(), false);
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Combat daggers with a sword main hand names both types and does not block Run", async () => {
    const { context, page, errors } = await open(1280, "#character/gear");
    try {
      const before = await page.evaluate(
        () => globalThis.__store.get().config.weapons.mainHand.type,
      );
      assert.equal(before, "dagger");
      await equipMainHand(page, SWORD);
      const afterEquip = await page.evaluate(
        () => globalThis.__store.get().config.weapons.mainHand.type,
      );
      assert.equal(afterEquip, "sword");
      await go(page, "#rotation", "#cfg-rotation");
      assert.equal(
        await page.locator("#cfg-rotation").inputValue(),
        "combat-daggers",
      );
      assert.equal(await page.locator(NOTE).isVisible(), true);
      assert.equal(
        await noteText(page),
        "This preset's rotation uses daggers; your main hand is a sword.",
      );
      assert.equal(
        await page.locator(NOTE_LINK).getAttribute("href"),
        "#character/gear",
      );
      assert.equal(
        clean(await page.locator(NOTE_LINK).innerText()),
        "Go to Gear",
      );
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      const afterNote = await page.evaluate(
        () => globalThis.__store.get().config.weapons.mainHand.type,
      );
      assert.equal(afterNote, "sword", "the note must not auto-equip a dagger");
      await page.click(NOTE_LINK);
      await page.locator("#gear-screen").waitFor({ state: "visible" });
      assert.match(
        await page.evaluate(() => document.location.hash),
        /#character\/gear/,
      );
      await equipMainHand(page, DAGGER);
      await go(page, "#rotation", "#cfg-rotation");
      assert.equal(await page.locator(NOTE).isVisible(), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Combat swords with a dagger main hand stays quiet; Assassination names the off hand", async () => {
    const { context, page, errors } = await open();
    try {
      await page.locator("#cfg-rotation").waitFor({ state: "visible" });
      // Default gear is a dagger main hand and an axe off hand.
      await page.selectOption("#cfg-rotation", "combat-swords-temp");
      assert.equal(await page.locator(NOTE).isVisible(), false);
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      const weapons = await page.evaluate(
        () => globalThis.__store.get().config.weapons.mainHand.type,
      );
      assert.equal(weapons, "dagger", "switching preset must not change gear");
      await page.selectOption("#cfg-rotation", "assassination-daggers");
      assert.equal(await page.locator(NOTE).isVisible(), true);
      assert.equal(
        await noteText(page),
        "This preset's rotation uses daggers; your off hand is an axe.",
      );
      assert.equal(await page.locator("#run-button").isDisabled(), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
