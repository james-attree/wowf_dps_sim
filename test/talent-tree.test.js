import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { referenceBuild } from "../data/reference-build.js";
import {
  createConfigForm,
  nextRunConfig,
  pageDefaultConfig,
} from "../js/config-form.js";
import { createStore } from "../js/store.js";
import { blockedCount, talentErrorCount } from "../js/views/run-model.js";
import {
  createTalentTree,
  parseLevel,
  pointsLine,
  talentInfo,
  talentTreeView,
} from "../js/talent-tree.js";

// Issue #204 (U6): the talent tree's model, from Fran's U6 spec (binding).
// It fills the `talents` slice, writes a legal build to the config, and
// takes every rule from js/talent-build.js (#190).

function setup(config = pageDefaultConfig()) {
  const store = createStore({ config, form: null });
  const tree = createTalentTree(store);
  const talents = () => store.get().talents;
  return { store, tree, talents, config: () => store.get().config };
}

const cell = (view, id) =>
  view.trees.flatMap((tree) => tree.cells).find((entry) => entry.id === id);

describe("talent tree model (#204)", () => {
  it("starts from the page default: No talents at level 60", () => {
    const { talents } = setup();
    const state = talents();
    assert.equal(state.open, false);
    assert.equal(state.level, 60);
    assert.deepEqual(state.ranks, {});
    assert.equal(state.error, null);
    assert.deepEqual(state.levelRange, { min: 10, max: 60 });
    assert.equal(state.view.summary, "No talents");
    assert.equal(state.view.pointsLine, "0 of 51 spent, 51 left");
    assert.equal(state.view.note, null, "no unspent note at 0 points");
    assert.equal(state.view.trees.length, 3);
    assert.deepEqual(
      state.view.trees.map((tree) => tree.cells.length),
      [17, 17, 19],
    );
  });

  it("adds a point, writes config.talents and announces the result", () => {
    const { tree, talents, config } = setup();
    assert.equal(tree.add("combat.improved-sinister-strike"), true);
    assert.deepEqual(config().talents, {
      "combat.improved-sinister-strike": 1,
    });
    assert.equal(config().talentLevel, 60);
    assert.equal(
      talents().announce.text,
      "Improved Sinister Strike 1 of 2. Combat 1 point. 1 of 51 spent, 50 left.",
    );
    assert.equal(talents().view.summary, "Combat 0/1/0 · 1/51");
    assert.equal(
      talents().view.note,
      "50 points unspent. That's fine: partial builds run as they are.",
    );
  });

  it("refuses an add the rules block, with the reason, and changes nothing", () => {
    const { tree, talents, config } = setup();
    const before = config();
    assert.equal(tree.add("assassination.lethality"), false);
    assert.equal(config(), before);
    assert.match(
      talents().announce.text,
      /^Can't add to Lethality: Needs 10 points in Assassination rows 1–2 \(0 spent\)/,
    );
    assert.equal(talents().message, null, "a refused add has no banner");
    const lethality = cell(talents().view, "assassination.lethality");
    assert.equal(lethality.state, "locked");
    assert.match(lethality.label, /^Lethality, 0 of 5, locked: Needs 10/);
  });

  it("refuses a removal that would strand talents, naming every blocker", () => {
    const { tree, talents, config } = setup({
      ...pageDefaultConfig(),
      talents: referenceBuild(),
    });
    const before = config();
    assert.equal(tree.remove("assassination.malice"), false);
    assert.equal(config(), before);
    const { message } = talents();
    assert.equal(message.kind, "refused");
    assert.equal(
      message.text,
      "Can't remove a point from Malice: Ruthlessness (row 2) needs 5 points in row 1, and this would leave 4. Remove points from row 2 or below first. It would also strand Improved Slice and Dice, Lethality.",
    );
    assert.deepEqual(
      message.blockers.map((blocker) => blocker.name),
      ["Ruthlessness", "Improved Slice and Dice", "Lethality"],
    );
    assert.equal(talents().announce.text, message.text);
  });

  it("removes a point and keeps the build legal", () => {
    const { tree, config } = setup();
    tree.add("combat.improved-sinister-strike");
    tree.add("combat.improved-sinister-strike");
    assert.equal(tree.remove("combat.improved-sinister-strike"), true);
    assert.deepEqual(config().talents, {
      "combat.improved-sinister-strike": 1,
    });
    assert.equal(tree.remove("combat.improved-sinister-strike"), true);
    assert.deepEqual(config().talents, {});
    assert.equal(tree.remove("combat.improved-sinister-strike"), false);
  });

  it("caps points by level − 9 and shows the level below 60", () => {
    const { tree, talents, config } = setup();
    assert.equal(tree.setLevel("10"), true);
    assert.equal(config().talentLevel, 10);
    assert.equal(talents().view.cap, 1);
    assert.equal(tree.add("combat.improved-sinister-strike"), true);
    assert.equal(tree.add("combat.improved-sinister-strike"), false);
    assert.match(talents().announce.text, /^Can't add to Improved Sinister/);
    assert.equal(talents().view.summary, "Combat 0/1/0 · level 10 · 1/1");
    assert.equal(talents().view.note, null);
  });

  it("over the cap: keeps every point, sets the error and blocks Run (D6)", () => {
    const { store, tree, talents, config } = setup({
      ...pageDefaultConfig(),
      talents: referenceBuild(),
    });
    const before = config();
    tree.setLevel("40");
    assert.equal(config(), before, "the config keeps the last legal build");
    assert.equal(talents().level, 40);
    assert.equal(talents().error, "51 points spent, but level 40 gives 31.");
    assert.deepEqual(talents().view.errorBanner, {
      strong: "51 points spent, but level 40 gives 31.",
      text: " Remove 20 points or raise the level. Run is off until then; nothing was removed for you.",
    });
    assert.equal(talents().view.pill, "⚠ 20 over");
    assert.equal(
      talents().announce.text,
      "Level 40: 31 talent points. 51 spent, 20 over the 31 that level 40 gives.",
    );
    assert.equal(nextRunConfig(store.get()), null);
    const run = { mode: "live", errors: {} };
    assert.equal(talentErrorCount(store.get()), 1);
    assert.equal(blockedCount({ ...store.get(), run }), 1, "Fix 1 setting");
    assert.equal(tree.add("subtlety.camouflage"), false);
    // Raising the level clears it and the build runs again.
    tree.setLevel("60");
    assert.equal(talents().error, null);
    assert.notEqual(nextRunConfig(store.get()), null);
    assert.equal(talentErrorCount(store.get()), 0);
  });

  it("one point over the cap says 1 point, not 1 points (#204 polish)", () => {
    const { tree, talents } = setup();
    tree.setLevel("11");
    assert.equal(tree.add("combat.improved-sinister-strike"), true);
    assert.equal(tree.add("combat.improved-sinister-strike"), true);
    tree.setLevel("10");
    assert.equal(talents().view.pill, "⚠ 1 over");
    assert.deepEqual(talents().view.errorBanner, {
      strong: "2 points spent, but level 10 gives 1.",
      text: " Remove 1 point or raise the level. Run is off until then; nothing was removed for you.",
    });
  });

  it("an invalid level keeps the last valid one and shows the field error", () => {
    const { tree, talents, config } = setup();
    tree.setLevel("40");
    for (const text of ["", "9", "61", "40.5", "abc"]) {
      assert.equal(tree.setLevel(text), false, text);
      assert.equal(talents().level, 40);
      assert.equal(talents().levelText, text);
      assert.equal(talents().levelError, "Enter a level from 10 to 60.");
      assert.equal(config().talentLevel, 40);
      assert.equal(talents().error, null, "never a Run block");
    }
    assert.deepEqual(parseLevel(" 25 "), { level: 25, error: null });
  });

  it("Reset all removes every point, and Undo brings them back (D14)", () => {
    const { tree, talents, config } = setup({
      ...pageDefaultConfig(),
      talents: referenceBuild(),
    });
    assert.equal(tree.resetAll(), true);
    assert.deepEqual(config().talents, {});
    assert.deepEqual(talents().message, {
      kind: "undo",
      text: "Removed all 51 points.",
    });
    assert.match(talents().announce.text, /^All talents removed\./);
    assert.equal(tree.undo(), true);
    assert.deepEqual(config().talents, referenceBuild());
    assert.match(talents().announce.text, /^Talents restored\./);
    assert.equal(tree.undo(), false, "Undo is spent");
    // Any other change drops the Undo.
    tree.resetAll();
    tree.add("combat.improved-sinister-strike");
    assert.equal(tree.undo(), false);
    assert.equal(tree.resetAll(), true);
    assert.equal(tree.resetAll(), false, "nothing left to remove");
  });

  it("takes a build the config gets from elsewhere (the form's Reset/Undo)", () => {
    const { store, tree, talents } = setup();
    tree.setOpen(true);
    store.set({
      config: {
        ...store.get().config,
        talents: referenceBuild(),
        talentLevel: 60,
      },
    });
    assert.deepEqual(talents().ranks, referenceBuild());
    assert.equal(talents().open, true, "the panel stays open");
    assert.equal(talents().view.summary, "Combat 18/33/0 · 51/51");
  });

  it("selecting, tabs and Show move the detail pane and the narrow tab", () => {
    const { tree, talents } = setup();
    assert.equal(talents().view.detail, null);
    tree.select("subtlety.camouflage");
    assert.equal(talents().view.detail.name, "Camouflage");
    tree.chooseTab("combat");
    assert.equal(talents().view.tab, "combat");
    tree.show("assassination.malice");
    assert.equal(talents().selected, "assassination.malice");
    assert.equal(talents().view.tab, "assassination");
    tree.toggle();
    assert.equal(talents().open, true);
    tree.toggle();
    assert.equal(talents().open, false);
  });

  it("every talent has one coverage state, and the counts match the spec (§6)", () => {
    const info = talentInfo();
    const counts = { simulated: 0, noDps: 0, notSimulated: 0 };
    for (const entry of info.values()) {
      counts[entry.coverage] += 1;
    }
    // §6 counted 17 / 6 / 30 at d84a160. Since #207, Ghostly Strike,
    // Hemorrhage and Premeditation have entries (the talent grants the
    // ability), so they are simulated: 20 / 6 / 27.
    assert.deepEqual(counts, { simulated: 20, noDps: 6, notSimulated: 27 });
  });

  it("counts picked talents the sim does not model yet in the summary", () => {
    const { tree, talents } = setup();
    tree.add("subtlety.camouflage");
    assert.equal(
      talents().view.summary,
      "Subtlety 0/0/1 · 1/51 · 1 not simulated yet",
    );
    assert.match(
      talents().view.effects.coverage.notSimulated,
      /^Not simulated yet: Camouflage \(1\)\. Their points add no DPS\.$/,
    );
  });

  it("the detail pane follows the spec's order of facts (§16.2)", () => {
    const { tree, talents } = setup();
    tree.setLevel("40");
    tree.select("assassination.lethality");
    const detail = talents().view.detail;
    assert.equal(detail.sub, "Assassination, row 3 · rank 0 of 5");
    assert.equal(detail.addLabel, "Add a point to Lethality");
    assert.equal(detail.removeLabel, "Remove a point from Lethality");
    assert.equal(detail.coverageTag, "Simulated");
    assert.equal(detail.now, null);
    assert.equal(detail.next.label, "Next (rank 1)");
    assert.deepEqual(
      detail.requirements.map((entry) => [entry.met, entry.text]),
      [
        [false, "10 points in Assassination rows 1–2 (0 spent)"],
        [false, "Malice at 5 of 5 (0 now)"],
      ],
    );
    assert.equal(detail.canAdd, false);
  });

  it("names a granted ability's rule as cast or skipped (§4)", () => {
    const { tree, talents } = setup();
    tree.add("combat.improved-sinister-strike");
    const lines = talents().view.effects.rotation.lines;
    const byName = new Map(lines.map((line) => [line.name, line]));
    assert.equal(byName.get("Blade Flurry").ok, false);
    assert.match(byName.get("Blade Flurry").text, /skipped: no Blade Flurry/);
    assert.equal(byName.get("Cold Blood").ok, false);
  });

  it("with no talents, skips every talent ability's rule and says so (#199)", () => {
    const { talents } = setup();
    const { lines, note } = talents().view.effects.rotation;
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.equal(line.ok, false, line.name);
      assert.match(line.text, /skipped: no /);
    }
    assert.equal(
      note,
      "With no talents picked, the fight is untalented: the sim skips Blade Flurry, Adrenaline Rush and Cold Blood, whose rules need the talent.",
    );
  });

  it("names one skipped ability alone, and none when nothing is skipped (#199)", () => {
    const note = (rules) =>
      talentTreeView({}, 60, {
        info: talentInfo(),
        config: { rotation: { rules } },
      }).effects.rotation.note;
    assert.equal(
      note([{ action: "cold-blood", conditions: [] }]),
      "With no talents picked, the fight is untalented: the sim skips Cold Blood, whose rule needs the talent.",
    );
    assert.equal(
      note([
        { action: "blade-flurry", conditions: [] },
        { action: "adrenaline-rush", conditions: [] },
      ]),
      "With no talents picked, the fight is untalented: the sim skips Blade Flurry and Adrenaline Rush, whose rules need the talent.",
    );
    assert.equal(
      note([{ action: "sinister-strike", conditions: [] }]),
      "With no talents picked, the fight is untalented.",
    );
  });

  // #232 QA B1: the verb follows the skipped rules, not the names.
  it("says 'rule needs' for one skipped rule, 'rules need' for one ability in two (#232)", () => {
    const note = (rules) =>
      talentTreeView({}, 60, {
        info: talentInfo(),
        config: { rotation: { rules } },
      }).effects.rotation.note;
    // Fran's repro: one guarded Cold Blood rule and a Sinister Strike.
    assert.equal(
      note([
        {
          action: "cold-blood",
          conditions: [{ type: "abilityGranted", ability: "cold-blood" }],
        },
        { action: "sinister-strike", conditions: [] },
      ]),
      "With no talents picked, the fight is untalented: the sim skips Cold Blood, whose rule needs the talent.",
    );
    // One name, two rules: listed once, plural verb.
    assert.equal(
      note([
        { action: "blade-flurry", conditions: [] },
        { action: "sinister-strike", conditions: [] },
        { action: "blade-flurry", conditions: [] },
      ]),
      "With no talents picked, the fight is untalented: the sim skips Blade Flurry, whose rules need the talent.",
    );
  });

  it("pointsLine and talentTreeView never throw on the edges", () => {
    assert.equal(pointsLine(0, 1, 10), "0 of 1 spent, 1 left");
    assert.equal(
      pointsLine(51, 31, 40),
      "51 spent, 20 over the 31 that level 40 gives",
    );
    const view = talentTreeView({}, 10, { info: talentInfo() });
    assert.equal(view.cap, 1);
  });
});

describe("the talent tree and the stats form share the config (#204, #151)", () => {
  it("a field edit keeps the tree's custom build", () => {
    const store = createStore({ config: pageDefaultConfig() });
    const tree = createTalentTree(store);
    const form = createConfigForm(store);
    tree.setLevel("40");
    tree.add("combat.improved-sinister-strike");
    form.input("character.attackPower", "1200");
    form.change("character.attackPower");
    assert.deepEqual(store.get().config.talents, {
      "combat.improved-sinister-strike": 1,
    });
    assert.equal(store.get().config.talentLevel, 40);
    assert.deepEqual(store.get().talents.ranks, {
      "combat.improved-sinister-strike": 1,
    });
  });
});
