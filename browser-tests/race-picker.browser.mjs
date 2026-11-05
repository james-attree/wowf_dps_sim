// #321 (Phase 5): the Race picker on Character › Stats, at 320, 360, 1024
// and 1440 wide and 100% and 150% text, with DejaVu pinned as CI has it.
// The select lists None and every race by faction, a race shows the racials
// that change the damage with a chip and a plain line, simulated first, and
// folds the rest under one "No DPS effect: …" summary (#322 P2), the Stats
// row leads with it, and nothing runs off the screen. Then, at one size: a
// share link and a refresh keep the race, Reset to defaults clears it, a
// race change puts the results out of date, and the DPS moves as the engine says (Human's Ruthless is
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
const MORE = "#cfg-race-racials-more";
const MORE_ITEMS = "#cfg-race-racials-more-list > li";
const SHOWN_CHIPS = ["Simulated", "Not simulated yet"];
// The folded summary's least height: a 44 px touch target.
const TARGET = 44;
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

// The folded racials (#322 P2): the summary, whether it is open, its height,
// and each one's name, line and whether it has a chip.
const folded = (page) =>
  page.locator(MORE).evaluate(
    (more, items) => ({
      hidden: more.hidden,
      open: more.open,
      summary: more.querySelector("summary").textContent,
      height: more.querySelector("summary").getBoundingClientRect().height,
      items: [...more.querySelectorAll(items)].map((item) => ({
        name: item.querySelector(".race-racial-name").textContent,
        chip: item.querySelector(".race-chip") !== null,
        line: item.querySelector(".race-racial-line").textContent,
        visible: item.checkVisibility({ contentVisibilityAuto: true }),
      })),
    }),
    MORE_ITEMS,
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
          "label, .field-help, .race-racials-title, .race-racial, .race-chip, .race-racials-more > summary",
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
            const more = await folded(page);
            // Every racial once: the ones that change the damage listed,
            // simulated first, and the rest folded under one summary.
            assert.deepEqual(
              [...shown, ...more.items].map(({ name }) => name).sort(),
              race.racials.map(({ name }) => name).sort(),
            );
            const kinds = shown.map(({ chip }) => SHOWN_CHIPS.indexOf(chip));
            assert.ok(!kinds.includes(-1), race.id);
            assert.deepEqual(kinds, [...kinds].sort(), race.id);
            for (const { chip, line } of shown) {
              assert.ok(CHIPS.includes(chip), chip);
              assert.ok(line.length > 0);
            }
            assert.equal(more.hidden, false, race.id);
            assert.equal(more.open, false, race.id);
            assert.equal(
              clean(more.summary),
              `No DPS effect: ${more.items.map(({ name }) => name).join(", ")}`,
            );
            assert.ok(more.height >= TARGET - EDGE, `${more.height}`);
            for (const item of more.items) {
              assert.equal(item.chip, false, item.name);
              assert.equal(item.visible, false, item.name);
              assert.ok(item.line.length > 0, item.name);
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
          // Opened, the folded ones show their lines inside the fieldset.
          await page.locator(RACE).selectOption("orc");
          await page.locator(`${MORE} > summary`).click();
          let more = await folded(page);
          assert.equal(more.open, true);
          assert.ok(more.items.every(({ visible }) => visible));
          assert.deepEqual(await layout(page), {
            inside: true,
            noSideScroll: true,
            chipsFit: true,
          });
          await page.locator(`${MORE} > summary`).press("Enter");
          more = await folded(page);
          assert.equal(more.open, false);
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
      assert.equal(await page.locator(`${ITEMS}, ${MORE_ITEMS}`).count(), 4);
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

// #322 rulings and #280: the builder offers an on-use racial only for the
// race that grants it, its guard reads "Race or talent granted", a
// racial the race lacks is "Not your race (Orc only)", and the Stats line
// says whether the rotation casts it.
const ADD = "#rb-add-action";
const PICK = "#cfg-rotation";
const FURY = "Blood Fury (racial)";

const addOptions = (page) =>
  page
    .locator(`${ADD} option`)
    .evaluateAll((options) => options.map((option) => option.textContent));

// Each rule on the list: its name and its chips.
const ruleChips = (page) =>
  page.locator(".rule-title").evaluateAll((titles) =>
    titles.map((title) => ({
      name: title.querySelector(".rule-name").lastChild.textContent,
      chips: [...title.querySelectorAll(".rule-chips > *")].map((chip) =>
        chip.textContent.replace(/^[⊘◆✕⚠]\s*/, "").trim(),
      ),
    })),
  );

const furyLine = (page) =>
  page
    .locator(ITEMS)
    .filter({ hasText: "Blood Fury" })
    .locator(".race-racial-line")
    .textContent();

const sideScroll = (page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

// TR-02 / #332: empty presets until #333
describe("#280: the rotation builder and the race", () => {
  for (const width of WIDTHS) {
    for (const text of TEXT_SIZES) {
      test(`${width} wide at ${text}: racials offered by race, with race copy`, async () => {
        const { context, page, errors } = await open(width, text);
        try {
          // Page defaults are combat-swords-temp (#333), which casts racials.
          await page.locator(RACE).selectOption("orc");
          await page.locator(RACIALS).waitFor({ state: "visible" });
          assert.match(
            clean(await furyLine(page)),
            /The preset rotations use it on cooldown\. Your rotation casts it\.$/,
          );
          await go(page, "#rotation", ADD);
          assert.ok((await addOptions(page)).includes(FURY));
          await page.selectOption(PICK, "combat-swords-temp");
          await page.waitForFunction(() =>
            /not your race/.test(document.body.textContent),
          );
          const rules = await ruleChips(page);
          assert.deepEqual(
            rules.slice(0, 4).map(({ name }) => name),
            ["Blood Fury", "Elune's Light", "Berserking", "Eureka!"],
          );
          assert.ok(rules[0].chips.includes("Orc racial"), rules[0].chips);
          assert.ok(
            rules[1].chips.includes("Not your race (Night Elf only)"),
            rules[1].chips,
          );
          assert.ok(rules[2].chips.includes("Not your race (Troll only)"));
          assert.ok(rules[3].chips.includes("Not your race (Gnome only)"));
          assert.match(
            clean(await page.locator(".builder-context").textContent()),
            /3 rules are skipped: not your race \(rules 2, 3 and 4\)\./,
          );
          assert.equal(await sideScroll(page), false);

          // Rule 1's guard, by its type's label.
          await page.evaluate(() => {
            document.location.hash = "#rotation/rule/1";
          });
          const type = page.getByRole("combobox", {
            name: "Rule 1, condition 1, type",
          });
          await type.waitFor({ state: "visible" });
          assert.equal(
            clean(
              await type.evaluate(
                (select) => select.selectedOptions[0].textContent,
              ),
            ),
            "Race or talent granted",
          );
          assert.equal(await sideScroll(page), false);

          await go(page, "#character/stats", RACE);
          assert.match(
            clean(await furyLine(page)),
            /The preset rotations use it on cooldown\. Your rotation casts it\.$/,
          );
          // No race: not offered, and the preset's rule says whose it is.
          await page.locator(RACE).selectOption("");
          await go(page, "#rotation", ADD);
          assert.ok(!(await addOptions(page)).includes(FURY));
          const none = await ruleChips(page);
          assert.ok(
            none[0].chips.includes("Not your race (Orc only)"),
            none[0].chips,
          );
          assert.match(
            clean(await page.locator(".builder-context").textContent()),
            /4 rules are skipped: not your race \(rules 1, 2, 3 and 4\)\./,
          );
          assert.doesNotMatch(
            clean(await page.locator(".builder-context").textContent()),
            /baseline/,
          );
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }
});
