// #321: the Race picker in Character › Stats. The form's race field
// (config.race) and its choices from js/racials.js, the racials it shows and
// their plain lines, the Stats row, the share link and the saved setup (with
// old links and saves that have no race), and Reset to defaults.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { RACIAL_EFFECTS } from "../data/racial-effects.js";
import {
  decodeSetup,
  encodeSetup,
  resolveInitialSetup,
  setupDefaults,
  setupFromState,
  SETUP_ERA,
} from "../js/build-codec.js";
import {
  configFromForm,
  createConfigForm,
  formFromConfig,
  pageDefaultConfig,
  raceInfo,
  raceOptions,
  validateValues,
} from "../js/config-form.js";
import { raceCatalogue } from "../js/racials.js";
import { SAVED_SETUP_KEY, mountSavedSetup } from "../js/saved-setup.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { characterRows } from "../js/views/character-screens.js";
import { changedNames, namesText, staleBanner } from "../js/views/stale.js";
import {
  NO_RACE_LABEL,
  ON_USE_CAST,
  ON_USE_NOTE,
  RACIAL_CHIPS,
  racialChip,
  racialLineText,
  racialGroups,
  noDpsSummary,
  ROGUE_LINES,
  NOT_SIMULATED_REASONS,
} from "../js/views/config-form.js";

const DELAY = k("ui.saveSetupMs");
const config = () => normalizeConfig(pageDefaultConfig());
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const RACE_IDS = raceCatalogue.races.map(({ id }) => id);

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

function fakeTimers() {
  let now = 0;
  let next = 1;
  const due = new Map();
  return {
    setTimeout(fn, ms) {
      const id = next++;
      due.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => due.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, { fn, at }] of [...due]) {
        if (at <= now) {
          due.delete(id);
          fn();
        }
      }
    },
  };
}

function pageStore(setup = setupDefaults()) {
  const { mode, duration, iterations } = setup.run;
  const seed = setup.run.seed ?? 7;
  return createStore({
    config: setup.config,
    run: {
      mode,
      state: "idle",
      seed,
      duration,
      iterations,
      fields: {
        duration: String(duration),
        iterations: String(iterations),
        seed: String(seed),
      },
      errors: {},
    },
    frame: 0,
    results: { time: 0, damage: 0 },
  });
}

describe("#321: the race choices", () => {
  it("list every race in js/racials.js once, by faction, with its name", () => {
    const groups = raceOptions();
    assert.deepEqual(
      groups.map(({ faction }) => faction).sort(),
      [...new Set(raceCatalogue.races.map(({ faction }) => faction))].sort(),
    );
    const listed = groups.flatMap(({ races }) => races);
    assert.deepEqual(listed.map(({ id }) => id).sort(), [...RACE_IDS].sort());
    for (const { id, label } of listed) {
      assert.equal(label, raceCatalogue.get(id).name);
    }
    assert.equal(NO_RACE_LABEL, "None (no racials)");
  });

  it("raceInfo gives each race's racials with what the effects data says", () => {
    assert.equal(raceInfo(null), null);
    for (const race of raceCatalogue.races) {
      const info = raceInfo(race.id);
      assert.equal(info.name, race.name);
      assert.deepEqual(
        info.racials.map(({ id }) => id),
        race.racials.map(({ id }) => id),
      );
      for (const racial of info.racials) {
        const effect = RACIAL_EFFECTS[racial.id];
        assert.ok(
          ["simulated", "inert", "noDpsEffect", "notSimulated"].includes(
            racial.status,
          ),
          racial.id,
        );
        assert.equal(racial.onUse, effect?.ability !== undefined, racial.id);
        if (racial.status === "noDpsEffect") {
          assert.equal(racial.reason, effect.noDpsEffect);
        }
      }
    }
  });
});

describe("#321: the form's race field", () => {
  it("starts with no race and writes config.race; None writes null", () => {
    const store = createStore({ config: config() });
    const form = createConfigForm(store);
    assert.equal(store.get().form.values.race, null);
    assert.equal(store.get().form.race, null);
    form.change("race", "orc");
    assert.equal(store.get().config.race, "orc");
    assert.equal(store.get().form.race.name, "Orc");
    form.change("race", "");
    assert.equal(store.get().config.race, null);
    assert.equal(store.get().form.race, null);
  });

  it("each race reaches the config, and only the race changes", () => {
    const store = createStore({ config: config() });
    const form = createConfigForm(store);
    const before = store.get().config;
    for (const id of RACE_IDS) {
      form.change("race", id);
      const after = store.get().config;
      assert.equal(after.race, id);
      assert.deepEqual({ ...after, race: null }, { ...before, race: null });
      assert.deepEqual(
        after.rotation,
        before.rotation,
        "the rotation is left alone",
      );
    }
  });

  it("a race that isn't in the catalogue is a message, not a config", () => {
    const values = { ...formFromConfig(config()).values, race: "murloc" };
    assert.deepEqual(Object.keys(validateValues(values)), ["race"]);
  });

  it("round-trips through the form", () => {
    const withRace = { ...config(), race: "night-elf" };
    assert.deepEqual(
      configFromForm(formFromConfig(withRace), withRace),
      withRace,
    );
  });

  it("Reset to defaults clears it, and Undo puts it back", () => {
    const store = createStore({ config: config() });
    const form = createConfigForm(store);
    form.change("race", "undead");
    form.reset();
    assert.equal(store.get().config.race, null);
    assert.equal(store.get().form.values.race, null);
    assert.equal(store.get().form.race, null);
    form.undo();
    assert.equal(store.get().config.race, "undead");
    assert.equal(store.get().form.race.name, "Undead");
  });
});

describe("#321: the Stats row", () => {
  it("leads with the race when one is set, and leaves it out with none", () => {
    assert.equal(
      characterRows(formFromConfig(config())).stats.summary,
      "767 attack power · 22.45% crit · 7% hit",
    );
    assert.equal(
      characterRows(formFromConfig({ ...config(), race: "night-elf" })).stats
        .summary,
      "Night Elf · 767 attack power · 22.45% crit · 7% hit",
    );
  });

  it("counts a race to fix on Stats", () => {
    const form = formFromConfig(config());
    const values = { ...form.values, race: "murloc" };
    const rows = characterRows({
      ...form,
      values,
      errors: validateValues(values),
    });
    assert.equal(rows.stats.fix, 1);
    assert.equal(rows.gear.fix, 0);
  });
});

describe("#321: each racial's plain line", () => {
  const all = raceCatalogue.races.flatMap((race) => raceInfo(race.id).racials);

  it("every racial has a chip in the poisons' words and a line", () => {
    for (const racial of all) {
      const chip = racialChip(racial);
      assert.ok(Object.values(RACIAL_CHIPS).includes(chip.text), racial.id);
      const line = racialLineText(racial);
      assert.equal(typeof line, "string");
      assert.ok(line.length > 0, racial.id);
    }
  });

  it("simulated, on use, no DPS effect, a mob type, and not simulated yet", () => {
    const by = (id) => all.find((racial) => racial.id === id);
    const fury = by("orc.blood-fury");
    assert.equal(racialChip(fury).text, "Simulated");
    // Not known: the line says the presets cast it and yours needs a rule.
    assert.equal(
      racialLineText(fury),
      `${ROGUE_LINES["blood-fury"]} ${ON_USE_NOTE} ${ON_USE_CAST.unknown}`,
    );
    for (const racial of all.filter(({ status }) => status === "noDpsEffect")) {
      assert.equal(racialChip(racial).text, "No DPS effect");
      assert.equal(racialLineText(racial), racial.reason);
    }
    for (const racial of all.filter(({ status }) => status === "inert")) {
      assert.equal(racialChip(racial).text, "No DPS effect");
      assert.match(racialLineText(racial), /Only against [A-Z]\w+s/);
    }
    for (const racial of all.filter(
      ({ status }) => status === "notSimulated",
    )) {
      assert.equal(racialChip(racial).text, "Not simulated yet");
      assert.match(
        racialLineText(racial),
        /which the simulator doesn't model\.$/,
      );
      assert.doesNotMatch(racialLineText(racial), /Not simulated yet/);
    }
  });

  it("the page has the select, its label and its help", async () => {
    const html = await readFile(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    assert.match(html, /<label for="cfg-race">Race<\/label>/);
    assert.match(html, /<select\s+id="cfg-race"\s+name="race"/);
    assert.match(
      html,
      /Enter your stats without racials; the race adds them\./,
    );
  });
});

describe("#321: the race in the share link", () => {
  it("every race round-trips, strict and lenient", () => {
    const d = setupDefaults();
    for (const id of RACE_IDS) {
      const text = encodeSetup({ ...d, config: { ...d.config, race: id } });
      assert.equal(decodeSetup(text).setup.config.race, id);
      assert.equal(decodeSetup(text, { strict: false }).setup.config.race, id);
    }
  });

  it("no race stays out of the link", () => {
    const d = setupDefaults();
    assert.equal(d.config.race, null);
    assert.equal(encodeSetup(d), encodeSetup(setupDefaults()));
    // A link with another change still says nothing of the race.
    const text = encodeSetup({ ...d, run: { ...d.run, seed: 5 } });
    const payload = JSON.parse(
      Buffer.from(text.slice(2), "base64url").toString("utf8"),
    );
    assert.equal(payload.config, undefined);
  });

  it("a pre-era link with no race is invalid under SETUP_ERA (#332)", () => {
    // Made before the picker and before SETUP_ERA: attack power and poisons, no race.
    const old = `1.${b64({ config: { character: { attackPower: 900 }, poisons: { mainHand: "deadly", offHand: "instant" } } })}`;
    assert.equal(decodeSetup(old).status, "invalid");
  });

  it("a current-era link with no race keeps race null", () => {
    const text = `1.${b64({ era: SETUP_ERA, config: { character: { attackPower: 900 }, poisons: { mainHand: "deadly", offHand: "instant" } } })}`;
    const read = decodeSetup(text);
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.race, null);
    assert.equal(read.setup.config.character.attackPower, 900);
  });

  it("a race the page doesn't know is silent-invalid for a link, and none for a save (#332)", () => {
    const text = `1.${b64({ era: SETUP_ERA, config: { race: "murloc", character: { attackPower: 900 } } })}`;
    assert.equal(decodeSetup(text).status, "invalid");
    const lenient = decodeSetup(text, { strict: false }).setup.config;
    assert.equal(lenient.race, null);
    // Lenient era-matched save: unknown race resets; attack power kept.
    assert.equal(lenient.character.attackPower, 900);
  });
});

describe("#321: the race in the saved setup", () => {
  it("is saved on change and reads back", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const form = createConfigForm(store);
    const saved = mountSavedSetup(null, store, {
      initial: { source: "defaults" },
      storage,
      timers,
      form,
    });
    form.change("race", "troll");
    timers.advance(DELAY);
    const text = storage.items.get(SAVED_SETUP_KEY);
    assert.equal(text, encodeSetup(setupFromState(store.get())));
    assert.equal(
      resolveInitialSetup({ search: "", saved: text }).setup.config.race,
      "troll",
    );
    saved.stop();
  });

  it("an era-matched save with no race loads, with no race", () => {
    const old = `1.${b64({ era: SETUP_ERA, config: { character: { haste: 0.05 } }, run: { seed: 9 } })}`;
    const initial = resolveInitialSetup({ search: "", saved: old });
    assert.equal(initial.setup.config.race, null);
    assert.equal(initial.setup.config.character.haste, 0.05);
    assert.equal(initial.setup.run.seed, 9);
  });

  it("a share link's race wins over the saved one", () => {
    const d = setupDefaults();
    const saved = encodeSetup({ ...d, config: { ...d.config, race: "gnome" } });
    const link = encodeSetup({ ...d, config: { ...d.config, race: "dwarf" } });
    const initial = resolveInitialSetup({ search: `?s=${link}`, saved });
    assert.equal(initial.setup.config.race, "dwarf");
  });

  it("Reset to defaults clears the race and the save", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const form = createConfigForm(store);
    const saved = mountSavedSetup(null, store, {
      initial: { source: "defaults" },
      storage,
      timers,
      form,
    });
    form.change("race", "human");
    timers.advance(DELAY);
    assert.ok(storage.items.has(SAVED_SETUP_KEY));
    form.reset();
    timers.advance(DELAY);
    assert.equal(store.get().config.race, null);
    assert.equal(storage.items.has(SAVED_SETUP_KEY), false);
    saved.stop();
  });
});

// Fran's #322 P4: a race change names "the race" in the stale banner, as the
// other build edits name theirs, rather than "the settings".
describe("the stale banner names the race (#322 P4)", () => {
  const config = normalizeConfig({});
  const ranWith = (now) => ({
    config: now,
    ran: { batch: { config, at: null } },
    batch: { result: { completed: 1 } },
  });
  it("a race change alone is the race", () => {
    const now = { ...config, race: "orc" };
    assert.deepEqual(changedNames(config, now), ["the race"]);
    assert.equal(
      staleBanner(ranWith(now), "batch").detail,
      "You changed the race after this ran, so these numbers are for the old settings.",
    );
    assert.equal(
      staleBanner(ranWith(now), "batch").short,
      "The race changed after this ran.",
    );
  });
  it("with a stat edit too, both are named", () => {
    const now = {
      ...config,
      race: "orc",
      character: { ...config.character, attackPower: 800 },
    };
    assert.equal(
      staleBanner(ranWith(now), "batch").detail,
      `You changed ${namesText(changedNames(config, now))} after this ran, so these numbers are for the old settings.`,
    );
    assert.deepEqual(
      new Set(changedNames(config, now)),
      new Set(["Attack power", "the race"]),
    );
  });
});

describe("#322 P3: the rogue's plain lines", () => {
  const all = raceCatalogue.races.flatMap((race) => raceInfo(race.id).racials);
  const slug = (id) => id.replace(/^[^.]*\./, "");
  const numbers = (text) => text.match(/\d+(?:\.\d+)?/g) ?? [];

  it("every racial that changes the damage has a rogue line", () => {
    for (const racial of all.filter(({ status }) =>
      ["simulated", "notSimulated"].includes(status),
    )) {
      assert.ok(ROGUE_LINES[slug(racial.id)], racial.id);
    }
  });

  it("no line has a number its tooltip or the data doesn't state", () => {
    for (const racial of all) {
      const line = ROGUE_LINES[slug(racial.id)];
      if (line === undefined) continue;
      const source = `${racial.text} ${racial.reason ?? ""}`;
      for (const n of numbers(line)) {
        assert.ok(numbers(source).includes(n), `${racial.id}: ${n}`);
      }
    }
    for (const [key, reason] of Object.entries(NOT_SIMULATED_REASONS)) {
      assert.deepEqual(numbers(reason), [], key);
    }
  });

  it("the lines are the rogue's: no other class, no Mana or Rage", () => {
    for (const line of Object.values(ROGUE_LINES)) {
      assert.doesNotMatch(
        line,
        /\b(Priests?|Mages?|Paladins?|Warriors?|casters?|Mana|Rage|spells?|spellcasting)\b/i,
      );
    }
    const eureka = all.find(({ id }) => id === "gnome.eureka");
    assert.match(eureka.text, /Priest/);
    assert.match(
      racialLineText(eureka),
      /^Instant, 2 min cooldown\. For 8 sec/,
    );
    assert.doesNotMatch(racialLineText(eureka), /Priest|Mage/);
  });

  it("Touch of the Grave says what it does and why it isn't simulated", () => {
    const tog = all.find(({ id }) => id === "undead.touch-of-the-grave");
    assert.equal(tog.status, "notSimulated");
    assert.match(tog.reason, /does not model/);
    assert.equal(
      racialLineText(tog),
      "Your damaging attacks have a 20% chance to drain health from the target, up to 5% of your maximum health. 15 sec internal cooldown. The drain's damage depends on your maximum health, which the simulator doesn't model.",
    );
  });
});

describe("#322 P2: simulated racials first, no DPS effect folded", () => {
  it("each race: simulated, then not yet, then the folded ones", () => {
    for (const race of raceCatalogue.races) {
      const { racials } = raceInfo(race.id);
      const { shown, folded } = racialGroups(racials);
      assert.equal(shown.length + folded.length, racials.length, race.id);
      const kinds = shown.map((racial) => racialChip(racial).kind);
      assert.deepEqual(
        kinds,
        [...kinds].sort((a, b) => (a === b ? 0 : a === "simulated" ? -1 : 1)),
        race.id,
      );
      for (const racial of folded) {
        assert.equal(racialChip(racial).kind, "off", racial.id);
      }
    }
  });

  it("the summary names them in Fran's words", () => {
    const folded = [
      { name: "Hardiness" },
      { name: "Command" },
      { name: "Shatter Curse" },
    ];
    assert.equal(
      noDpsSummary(folded),
      "No DPS effect: Hardiness, Command, Shatter Curse",
    );
  });

  it("the page folds them in a details whose summary is the label", async () => {
    const html = await readFile(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    assert.match(
      html,
      /<details[^>]*id="cfg-race-racials-more"[\s\S]*?<summary id="cfg-race-racials-more-summary"><\/summary>[\s\S]*?id="cfg-race-racials-more-list"/,
    );
  });
});
