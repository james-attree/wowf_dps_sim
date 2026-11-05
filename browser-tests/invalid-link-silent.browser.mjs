// Kira N3 on #332 (James 5 Nov 2026) + Scout follow-up: an invalid or
// damaged/garbage share link shows no banner. Covers an unknown race /
// weapon type / poison, an old-era (pre-SETUP_ERA) link, and pure garbage
// (`1.nope!`). The page loads the defaults (or a save) in silence. A newer
// link still shows its banner (share-link.browser).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import {
  LINK_PARAM,
  SETUP_ERA,
  SETUP_VERSION,
  encodeSetup,
  setupDefaults,
} from "../js/build-codec.js";
import { SAVED_SETUP_KEY } from "../js/saved-setup.js";

const WIDTH = 1024;
const SCREEN_HEIGHT = 900;
const HASTE = "#cfg-character-haste";

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

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const v1 = (payload) => `${SETUP_VERSION}.${b64(payload)}`;

async function open(address) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: SCREEN_HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(address.startsWith("http") ? address : `${base}${address}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(HASTE).waitFor({ state: "visible" });
  return { context, page, errors };
}

describe("invalid and garbage share links stay silent (Kira N3 / Scout #332)", () => {
  const cases = [
    ["unknown race", v1({ era: SETUP_ERA, config: { race: "not-a-race" } })],
    [
      "unknown weapon type",
      v1({
        era: SETUP_ERA,
        config: {
          weapons: {
            mainHand: { type: "potato", min: 10, max: 20, speed: 2.0 },
            offHand: { type: "sword", min: 10, max: 20, speed: 2.0 },
          },
        },
      }),
    ],
    [
      "unknown poison",
      v1({
        era: SETUP_ERA,
        config: { poisons: { mainHand: "banana", offHand: null } },
      }),
    ],
    [
      "old setup era",
      v1({
        era: 0,
        config: {
          character: {
            ...setupDefaults().config.character,
            attackPower: 900,
          },
        },
      }),
    ],
    ["pure garbage body", "1.nope!"],
  ];

  for (const [label, text] of cases) {
    test(`${label}: no share banner, defaults load`, async () => {
      const address = `${base}?${LINK_PARAM}=${text}#character/stats`;
      const { context, page, errors } = await open(address);
      try {
        assert.equal(
          await page.locator("#share-banner").isHidden(),
          true,
          `${label}: banner must stay hidden`,
        );
        assert.equal(await page.locator(HASTE).inputValue(), "0");
        assert.equal(
          await page.evaluate(() => document.location.href),
          `${base}#character/stats`,
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test("invalid link with a valid save keeps the save and shows no banner", async () => {
    const saved = encodeSetup({
      ...setupDefaults(),
      config: {
        ...setupDefaults().config,
        character: {
          ...setupDefaults().config.character,
          attackPower: 900,
        },
      },
    });
    const bad = v1({ era: SETUP_ERA, config: { race: "not-a-race" } });
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: SCREEN_HEIGHT },
    });
    await context.addInitScript(
      ([key, value]) => {
        document.defaultView.localStorage.setItem(key, value);
      },
      [SAVED_SETUP_KEY, saved],
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    try {
      await page.goto(`${base}?${LINK_PARAM}=${bad}#character/stats`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#cfg-character-attackPower").waitFor({
        state: "visible",
      });
      assert.equal(await page.locator("#share-banner").isHidden(), true);
      assert.equal(
        await page.locator("#cfg-character-attackPower").inputValue(),
        "900",
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
