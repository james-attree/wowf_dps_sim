// #296 (P5-11): "Remember my setup". A changed field survives a refresh at
// phone and desktop widths; Reset to defaults then a refresh shows the
// defaults; back/forward shows the inputs and the build from the same source
// (Fran's N4 from #299); a share link opened on load becomes the save; and a
// broken save, or storage that throws, loads the defaults with no page error.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import {
  SETUP_VERSION,
  decodeSetup,
  encodeSetup,
  setupDefaults,
} from "../js/build-codec.js";
import { SAVED_SETUP_KEY } from "../js/saved-setup.js";
import { k } from "../data/constants.js";

const WIDTHS = [320, 1440];
const SCREEN_HEIGHT = 900;
const HASTE = "#cfg-character-haste";
const POWER = "#cfg-character-attackPower";
const LENGTH = "#run-duration";
const LEVEL = "#talents-level";
// Long enough for the debounced write, with room for a slow CI machine.
const SETTLE = k("ui.saveSetupMs") + 400;
// Past the load, its pageshow and several debounces: a visit with no change
// must have written nothing by then (#320 B1 wrote at about 540 ms).
const LOAD_SETTLE = 4 * k("ui.saveSetupMs") + 600;
const ROTATION = "#cfg-rotation";

let server;
let base;
let browser;
// Chrome with the back/forward cache on (Playwright turns it off by default),
// for a real bfcache restore (pageshow persisted) (Kira's N4 on #320).
let bfcacheBrowser;

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
  await bfcacheBrowser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

// storage: "on", "throws" (the localStorage getter throws, as with storage
// turned off), or a text to put in the save before the page loads.
async function open(
  width,
  address = "",
  { storage = "on", from = browser } = {},
) {
  const context = await from.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: base,
  });
  if (storage === "throws") {
    await context.addInitScript(() => {
      Object.defineProperty(document.defaultView, "localStorage", {
        get() {
          throw new document.defaultView.DOMException(
            "The operation is insecure.",
            "SecurityError",
          );
        },
      });
    });
  } else if (storage !== "on") {
    await context.addInitScript(
      ([key, text]) => {
        if (document.defaultView.sessionStorage.getItem("seeded") === null) {
          document.defaultView.sessionStorage.setItem("seeded", "1");
          document.defaultView.localStorage.setItem(key, text);
        }
      },
      [SAVED_SETUP_KEY, storage],
    );
  }
  // Every write to the save, counted per document (window.__setupWrites), and
  // every pageshow's persisted flag (window.__shows).
  await context.addInitScript((key) => {
    const win = document.defaultView;
    win.__setupWrites = 0;
    win.__shows = [];
    win.addEventListener("pageshow", (event) =>
      win.__shows.push(event.persisted),
    );
    const setItem = win.Storage.prototype.setItem;
    win.Storage.prototype.setItem = function (name, text) {
      if (name === key) win.__setupWrites += 1;
      return setItem.call(this, name, text);
    };
  }, SAVED_SETUP_KEY);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The page's own errors and warnings; not the off-site requests this
    // test aborts (route, below).
    if (
      (message.type() === "error" || message.type() === "warning") &&
      !message.text().startsWith("Failed to load resource")
    ) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}${address}`);
  await ready(page);
  return { context, page, errors };
}

const ready = (page) =>
  page.locator("#run-button").waitFor({ state: "attached" });

const go = async (page, hash, selector) => {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

const set = async (page, hash, selector, value) => {
  await go(page, hash, selector);
  await page.locator(selector).fill(value);
  await page.locator(selector).blur();
};

const value = async (page, hash, selector) => {
  await go(page, hash, selector);
  return page.locator(selector).inputValue();
};

const saved = (page) =>
  page.evaluate(
    (key) => document.defaultView.localStorage.getItem(key),
    SAVED_SETUP_KEY,
  );

// The build the page holds (its store), read through its own share link.
async function build(page) {
  await go(page, "#results/average", "#share-link-average");
  await page.evaluate(() =>
    document.defaultView.navigator.clipboard.writeText(""),
  );
  await page.locator("#share-link-average").click();
  let link = "";
  for (let i = 0; i < 50 && link === ""; i += 1) {
    link = await page.evaluate(() =>
      document.defaultView.navigator.clipboard.readText(),
    );
    if (link === "") await page.waitForTimeout(20);
  }
  const read = decodeSetup(new URL(link).searchParams.get("s"));
  assert.equal(read.status, "ok", link);
  return read.setup;
}

const D = setupDefaults();

describe("Remember my setup (#296)", () => {
  for (const width of WIDTHS) {
    test(`a change survives a refresh, and Reset to defaults then a refresh shows the defaults, at ${width}`, async () => {
      const { context, page, errors } = await open(width, "#character/stats");
      try {
        assert.equal(await saved(page), null, "nothing saved before a change");
        await set(page, "#character/stats", HASTE, "5");
        await set(page, "#character/stats", POWER, "900");
        await set(page, "#fight", LENGTH, "120");
        await set(page, "#character/talents", LEVEL, "40");
        await page.waitForTimeout(SETTLE);
        const text = await saved(page);
        assert.match(text, new RegExp(`^${SETUP_VERSION}\\.`));

        await page.reload();
        await ready(page);
        assert.equal(await value(page, "#character/stats", HASTE), "5");
        assert.equal(await value(page, "#character/stats", POWER), "900");
        assert.equal(await value(page, "#fight", LENGTH), "120");
        assert.equal(await value(page, "#character/talents", LEVEL), "40");
        const kept = await build(page);
        assert.equal(kept.config.character.haste, 0.05);
        assert.equal(kept.config.character.attackPower, 900);
        assert.equal(kept.config.talentLevel, 40);
        assert.equal(kept.run.duration, 120);

        // Ruling A2: Reset to defaults resets the run settings too, and
        // Undo puts them back with the config, and saves them again.
        await go(page, "#character/stats", "#cfg-reset");
        await page.locator("#cfg-reset").click();
        await page.locator("#cfg-undo").click();
        await page.waitForTimeout(SETTLE);
        const undone = decodeSetup(await saved(page), { strict: false });
        assert.equal(undone.setup.config.character.haste, 0.05, "Undo");
        assert.equal(undone.setup.run.duration, 120, "Undo");
        assert.equal(await value(page, "#fight", LENGTH), "120", "Undo");

        await go(page, "#character/stats", "#cfg-reset");
        await page.locator("#cfg-reset").click();
        await page.waitForTimeout(SETTLE);
        assert.equal(await saved(page), null, "Reset to defaults clears it");
        assert.equal(
          await value(page, "#fight", LENGTH),
          String(D.run.duration),
          "Reset resets the run settings on screen, before any refresh",
        );
        await page.reload();
        await ready(page);
        assert.equal(
          await value(page, "#character/stats", HASTE),
          String(D.config.character.haste * 100),
        );
        assert.equal(
          await value(page, "#fight", LENGTH),
          String(D.run.duration),
        );
        assert.equal(
          await value(page, "#character/talents", LEVEL),
          String(D.config.talentLevel),
        );
        const reset = await build(page);
        assert.deepEqual(reset.config, D.config);
        assert.equal(reset.run.duration, D.run.duration);
        // #320 B1: the refresh after Reset saves nothing (no new seed).
        await page.waitForTimeout(LOAD_SETTLE);
        assert.equal(await saved(page), null, "a refresh after Reset");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  for (const storage of ["on", "throws"]) {
    test(`back/forward: the inputs and the build come from the same source (storage ${storage})`, async () => {
      const { context, page, errors } = await open(1440, "#character/stats", {
        storage,
      });
      try {
        await set(page, "#character/stats", HASTE, "5");
        await set(page, "#fight", LENGTH, "120");
        await page.waitForTimeout(SETTLE);
        await page.goto("about:blank");
        await page.goBack();
        await ready(page);
        // The page has redrawn on pageshow, after the browser put its form
        // values back.
        await page.waitForTimeout(100);
        const shown = {
          haste: await value(page, "#character/stats", HASTE),
          length: await value(page, "#fight", LENGTH),
        };
        const held = await build(page);
        assert.equal(shown.haste, String(held.config.character.haste * 100));
        assert.equal(shown.length, String(held.run.duration));
        if (storage === "on") {
          assert.equal(held.config.character.haste, 0.05);
          assert.equal(held.run.duration, 120);
        } else {
          assert.deepEqual(held.config, D.config);
          assert.equal(held.run.duration, D.run.duration);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test("back/forward with a field in error: the input shows the build, not the bad text", async () => {
    const { context, page, errors } = await open(1440, "#character/stats");
    try {
      await set(page, "#character/stats", HASTE, "5");
      await page.waitForTimeout(SETTLE);
      await set(page, "#character/stats", HASTE, "-5");
      await page.waitForTimeout(SETTLE);
      await page.goto("about:blank");
      await page.goBack();
      await ready(page);
      await page.waitForTimeout(100);
      assert.equal(await value(page, "#character/stats", HASTE), "5");
      assert.equal((await build(page)).config.character.haste, 0.05);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("storage that throws: the page works as it did, with no error or warning", async () => {
    const { context, page, errors } = await open(320, "#character/stats", {
      storage: "throws",
    });
    try {
      await set(page, "#character/stats", HASTE, "5");
      await page.waitForTimeout(SETTLE);
      assert.equal((await build(page)).config.character.haste, 0.05);
      await page.reload();
      await ready(page);
      assert.equal(
        await value(page, "#character/stats", HASTE),
        String(D.config.character.haste * 100),
      );
      // A short batch runs as before.
      await set(page, "#fight", "#run-iterations", "10");
      await page.locator("#run-button").click();
      await page.waitForTimeout(1500);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  for (const [name, text] of [
    ["broken", "1.!!!not-base64"],
    [
      "newer",
      `${SETUP_VERSION + 1}.${encodeSetup(setupDefaults()).split(".")[1]}`,
    ],
    ["not the codec's", '{"haste":5}'],
  ]) {
    test(`a ${name} save loads the defaults with no error`, async () => {
      const { context, page, errors } = await open(1024, "#character/stats", {
        storage: text,
      });
      try {
        assert.equal(
          await value(page, "#character/stats", HASTE),
          String(D.config.character.haste * 100),
        );
        assert.deepEqual((await build(page)).config, D.config);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test("a share link opened on load wins over the save and becomes the save", async () => {
    const old = encodeSetup({
      ...D,
      config: {
        ...D.config,
        character: { ...D.config.character, haste: 0.02 },
      },
    });
    const linked = encodeSetup({
      ...D,
      config: {
        ...D.config,
        character: { ...D.config.character, haste: 0.07 },
      },
    });
    const { context, page, errors } = await open(
      1440,
      `?s=${linked}#character/stats`,
      {
        storage: old,
      },
    );
    try {
      assert.equal(await value(page, "#character/stats", HASTE), "7");
      // The link (with the seed the page drew, as its own link would carry).
      const kept = decodeSetup(await saved(page)).setup;
      assert.equal(kept.config.character.haste, 0.07);
      await page.goto(`${base}#character/stats`);
      await ready(page);
      assert.equal(await value(page, "#character/stats", HASTE), "7");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  // #320 B1 (Kira's QA): opening the page, refreshing it or coming back to it
  // with no change writes nothing, so a save the page cannot read (newer,
  // broken) is kept as it was until the user changes something.
  const body = encodeSetup(setupDefaults()).split(".")[1];
  for (const [name, text] of [
    ["no", null],
    [
      "a",
      encodeSetup({
        ...D,
        config: {
          ...D.config,
          character: { ...D.config.character, haste: 0.04 },
        },
      }),
    ],
    ["an unreadable", "1.!!!not-base64"],
    ["a newer-version", `${SETUP_VERSION + 1}.${body}`],
  ]) {
    test(`a visit with no change writes nothing and leaves ${name} save byte-unchanged; an edit still saves`, async () => {
      const { context, page, errors } = await open(1440, "#character/stats", {
        storage: text ?? "on",
      });
      const writes = () =>
        page.evaluate(() => document.defaultView.__setupWrites);
      try {
        await page.waitForTimeout(LOAD_SETTLE);
        assert.equal(await saved(page), text, "after the load");
        assert.equal(await writes(), 0, "after the load");
        await page.reload();
        await ready(page);
        await page.waitForTimeout(LOAD_SETTLE);
        assert.equal(await saved(page), text, "after a refresh");
        assert.equal(await writes(), 0, "after a refresh");
        await page.goto("about:blank");
        assert.equal(await saved(page), text, "after leaving");
        await page.goBack();
        await ready(page);
        await page.waitForTimeout(LOAD_SETTLE);
        assert.equal(await saved(page), text, "after back");
        assert.equal(await writes(), 0, "after back");

        await set(page, "#character/stats", HASTE, "6");
        await page.waitForTimeout(SETTLE);
        const kept = decodeSetup(await saved(page));
        assert.equal(kept.status, "ok");
        assert.equal(kept.setup.config.character.haste, 0.06);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test("a real bfcache restore: a field in error shows the build's value, and nothing is written (N4)", async () => {
    bfcacheBrowser ??= await chromium.launch({
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : { channel: "chrome" }),
      ignoreDefaultArgs: ["--disable-back-forward-cache"],
      args: ["--enable-features=BackForwardCache"],
    });
    const { context, page, errors } = await open(1440, "#character/stats", {
      from: bfcacheBrowser,
    });
    try {
      await set(page, "#character/stats", HASTE, "5");
      await page.waitForTimeout(SETTLE);
      const text = await saved(page);
      await set(page, "#character/stats", HASTE, "-5");
      await page.waitForTimeout(SETTLE);
      await page.evaluate(() => {
        document.defaultView.__kept = true;
      });
      await page.goto(`${base}demo/charts.html`);
      await page.goBack({ waitUntil: "commit" });
      await page.waitForFunction(
        () => document.defaultView.__shows?.at(-1) === true,
      );
      assert.equal(
        await page.evaluate(() => document.defaultView.__kept),
        true,
        "restored from the bfcache, not loaded again",
      );
      await page.waitForTimeout(LOAD_SETTLE);
      assert.equal(await value(page, "#character/stats", HASTE), "5");
      assert.equal(
        await page.locator(`${HASTE}-error`).textContent(),
        "",
        "no error shown",
      );
      assert.equal((await build(page)).config.character.haste, 0.05);
      assert.equal(await saved(page), text, "nothing written");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("back after another tab changed the rotation: the rotation shown is the build's (the form revision redraw, N9)", async () => {
    const { context, page, errors } = await open(1440, "#rotation");
    try {
      await go(page, "#rotation", ROTATION);
      const choices = await page.$$eval(`${ROTATION} option`, (options) =>
        options.map((option) => option.value),
      );
      assert.ok(choices.length >= 3, choices.join());
      await page.locator(ROTATION).selectOption(choices[1]);
      await page.waitForTimeout(SETTLE);
      await page.goto(`${base}demo/charts.html`);
      const other = await context.newPage();
      await other.goto(`${base}#rotation`);
      await ready(other);
      await go(other, "#rotation", ROTATION);
      await other.locator(ROTATION).selectOption(choices[2]);
      await other.waitForTimeout(SETTLE);
      await other.close();
      await page.goBack();
      await ready(page);
      await page.waitForTimeout(100);
      assert.equal(await value(page, "#rotation", ROTATION), choices[2]);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("Reset while idle, then Undo during a run: the config at once, the run settings when the run stops (N8, A8)", async () => {
    const { context, page, errors } = await open(1440, "#character/stats");
    try {
      await set(page, "#character/stats", HASTE, "5");
      await set(page, "#fight", LENGTH, "120");
      await set(page, "#fight", "#run-seed", "4242");
      await page.waitForTimeout(SETTLE);
      await go(page, "#character/stats", "#cfg-reset");
      await page.locator("#cfg-reset").click();
      // The defaults' 1,000 fights of 300 s: long enough to Undo while it
      // runs. (Editing a run setting here would keep Reset's settings.)
      await page.locator("#run-button").click();
      await page.locator("#stop-button").waitFor({ state: "visible" });
      await go(page, "#character/stats", "#cfg-undo");
      await page.locator("#cfg-undo").click();
      assert.equal(await value(page, "#character/stats", HASTE), "5");
      assert.equal(
        await value(page, "#fight", LENGTH),
        String(D.run.duration),
        "not while the run is on",
      );
      await page.locator("#stop-button").click();
      await page.waitForTimeout(SETTLE);
      assert.equal(await value(page, "#fight", LENGTH), "120");
      assert.equal(await value(page, "#fight", "#run-seed"), "4242");
      const kept = decodeSetup(await saved(page), { strict: false }).setup;
      assert.equal(kept.config.character.haste, 0.05);
      assert.equal(kept.run.duration, 120);
      assert.equal(kept.run.seed, 4242);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
