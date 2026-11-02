// #321 (Phase 5): the Race picker on Character › Stats, at 320, 360, 1024
// and 1440 wide and 100% and 150% text, with DejaVu pinned as CI has it.
// The select lists None and every race by faction, a race shows its
// racials with a chip and a plain line, the Stats row leads with it, and
// nothing runs off the screen. Then, at one size: a share link and a refresh
// keep the race, Reset to defaults clears it, a race change puts the results
// out of date, and the DPS moves as the engine says (Human's Ruthless is
// simulated; Undead's racials do nothing to DPS).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import { setupDefaults, shareUrl } from "../js/build-codec.js";
import { k } from "../data/constants.js";
import { raceCatalogue } from "../js/racials.js";

const PINNED_FONT = "DejaVu Sans";
const WIDTHS = [320, 360, 1024, 1440];
const TEXT_SIZES = ["100%", "150%"];
const SCREEN_HEIGHT = 900;
const RACE = "#cfg-race";
const RACIALS = "#cfg-race-racials";
const ITEMS = "#cfg-race-racials-list > li";
const SUMMARY = "#character-stats-summary";
const HELP = "Enter your stats without racials; the race adds them.";
const STATS_LINE = "767 attack power · 22.45% crit · 7% hit";
const CHIPS = ["Simulated", "No DPS effect", "Not simulated yet"];
const SETTLE = k("ui.saveSetupMs") + 400;
const RUN_TIMEOUT = 60_000;
// Rounding slack for a box edge, not a layout allowance.
const EDGE = 1;

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

async function open(width, text, address = `${base}#character/stats`) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(address);
  await pin(page, text);
  return { context, page, errors };
}

async function pin(page, text) {
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }
      html { font-size: ${text} !important; }`,
  });
  await page.locator(RACE).waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
}

const clean = (text) => text.replace(/\s+/g, " ").trim();

const go = async (page, hash, selector) => {
  await page.evaluate((to) => {
    document.location.hash = to;
  }, hash);
  await page.locator(selector).waitFor({ state: "visible" });
};

async function summary(page) {
  await go(page, "#character", SUMMARY);
  const text = clean(await page.locator(SUMMARY).textContent());
  await go(page, "#character/stats", RACE);
  return text;
}

// The select's choices: [{ group, value, label }], group null for None.
const choices = (page) =>
  page.locator(`${RACE} option`).evaluateAll((options) =>
    options.map((option) => ({
      group: option.parentElement.getAttribute("label"),
      value: option.value,
      label: option.textContent,
    })),
  );

// What the racials show: each item's name, chip and line.
const racials = (page) =>
  page.locator(ITEMS).evaluateAll((items) =>
    items.map((item) => ({
      name: item.querySelector(".race-racial-name").textContent,
      chip: item.querySelector(".race-chip").textContent,
      line: item.querySelector(".race-racial-line").textContent,
    })),
  );

// The race fieldset's parts inside it and the page no wider than the screen.
const layout = (page) =>
  page.locator(RACE).evaluate((select, edge) => {
    const set = select.closest("fieldset").getBoundingClientRect();
    const parts = [
      select,
      ...select
        .closest("fieldset")
        .querySelectorAll(
          "label, .field-help, .race-racials-title, .race-racial, .race-chip",
        ),
    ]
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => node.getBoundingClientRect());
    const root = document.documentElement;
    return {
      inside: parts.every(
        (box) => box.left >= set.left - edge && box.right <= set.right + edge,
      ),
      noSideScroll: root.scrollWidth <= root.clientWidth,
      chipsFit: [...document.querySelectorAll(".race-chip")].every(
        (chip) => chip.scrollWidth <= chip.clientWidth + edge,
      ),
    };
  }, EDGE);

describe("#321: the Race picker", () => {
  for (const width of WIDTHS) {
    for (const text of TEXT_SIZES) {
      test(`choices, racials, the Stats row and the layout at ${width} wide, ${text} text`, async () => {
        const { context, page, errors } = await open(width, text);
        try {
          assert.equal(
            clean(await page.locator("label[for='cfg-race']").textContent()),
            "Race",
          );
          assert.equal(
            clean(await page.locator("#cfg-race-help").textContent()),
            HELP,
          );
          const listed = await choices(page);
          assert.deepEqual(listed[0], {
            group: null,
            value: "",
            label: "None (no racials)",
          });
          assert.deepEqual(
            listed
              .slice(1)
              .map(({ value }) => value)
              .sort(),
            raceCatalogue.races.map(({ id }) => id).sort(),
          );
          for (const { group, value, label } of listed.slice(1)) {
            const race = raceCatalogue.get(value);
            assert.equal(label, race.name);
            assert.equal(group, race.faction);
          }
          assert.equal(await page.locator(RACE).inputValue(), "");
          assert.equal(await page.locator(RACIALS).isHidden(), true);
          assert.equal(await summary(page), STATS_LINE);

          for (const race of raceCatalogue.races) {
            await page.locator(RACE).selectOption(race.id);
            await page.locator(RACIALS).waitFor({ state: "visible" });
            assert.equal(
              clean(
                await page.locator("#cfg-race-racials-title").textContent(),
              ),
              `${race.name} racials`,
            );
            const shown = await racials(page);
            assert.deepEqual(
              shown.map(({ name }) => name),
              race.racials.map(({ name }) => name),
            );
            for (const { chip, line } of shown) {
              assert.ok(CHIPS.includes(chip), chip);
              assert.ok(line.length > 0);
            }
            const fit = await layout(page);
            assert.deepEqual(
              fit,
              {
                inside: true,
                noSideScroll: true,
                chipsFit: true,
              },
              `${race.id}`,
            );
          }
          await page.locator(RACE).selectOption("night-elf");
          assert.equal(await summary(page), `Night Elf · ${STATS_LINE}`);
          await page.locator(RACE).selectOption("");
          assert.equal(await page.locator(RACIALS).isHidden(), true);
          assert.equal(await summary(page), STATS_LINE);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }
});

const build = (page) =>
  page.evaluate(() => {
    const text =
      document.defaultView.localStorage.getItem("wowf_dps_sim.setup");
    return text;
  });

describe("#321: the race is kept, cleared, and reaches the run", () => {
  test("a share link and a refresh keep the race; Reset to defaults clears it", async () => {
    const d = setupDefaults();
    const link = shareUrl(base, {
      ...d,
      config: { ...d.config, race: "troll" },
    });
    const address = `${link}#character/stats`;
    const { context, page, errors } = await open(
      WIDTHS[1],
      TEXT_SIZES[1],
      address,
    );
    try {
      assert.equal(await page.locator(RACE).inputValue(), "troll");
      assert.equal(await page.locator(ITEMS).count(), 4);
      await page.locator(RACE).selectOption("gnome");
      await page.waitForTimeout(SETTLE);
      assert.notEqual(await build(page), null);
      await page.goto(`${base}#character/stats`);
      await pin(page, TEXT_SIZES[1]);
      assert.equal(await page.locator(RACE).inputValue(), "gnome");
      assert.equal(await summary(page), `Gnome · ${STATS_LINE}`);
      await page.locator("#cfg-reset").click();
      assert.equal(await page.locator(RACE).inputValue(), "");
      assert.equal(await page.locator(RACIALS).isHidden(), true);
      await page.waitForTimeout(SETTLE);
      assert.equal(
        await build(page),
        null,
        "Reset to defaults clears the save",
      );
      await page.reload();
      await pin(page, TEXT_SIZES[1]);
      assert.equal(await page.locator(RACE).inputValue(), "");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  // One batch of a few fights at a fixed seed, by link, for a race.
  async function meanFor(race) {
    const d = setupDefaults();
    const link = shareUrl(base, {
      config: { ...d.config, race },
      run: { ...d.run, mode: "batch", iterations: 20, seed: 424242 },
    });
    const address = `${link}#character/stats`;
    const { context, page, errors } = await open(
      WIDTHS[2],
      TEXT_SIZES[0],
      address,
    );
    try {
      await page.locator("#run-button").click();
      await page.waitForFunction(
        () =>
          / · Done$/.test(
            document.getElementById("run-status-text").textContent,
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      const status = await page.locator("#run-status-text").textContent();
      const mean = /([\d,.]+) DPS mean/.exec(status)[1];
      // A race change after the run puts its results out of date.
      await go(page, "#character/stats", RACE);
      await page.locator(RACE).selectOption(race === "human" ? "" : "human");
      await page.waitForFunction(
        () =>
          /Out of date/.test(
            document.getElementById("run-status-text").textContent,
          ),
        null,
        { timeout: RUN_TIMEOUT },
      );
      assert.deepEqual(errors, []);
      return mean;
    } finally {
      await context.close();
    }
  }

  test("the DPS moves with a simulated racial, and not with racials that do nothing to it", async () => {
    const none = await meanFor(null);
    const human = await meanFor("human");
    const undead = await meanFor("undead");
    assert.notEqual(human, none, "Human's Ruthless is simulated");
    assert.equal(undead, none, "Undead's racials have no DPS effect");
  });
});
