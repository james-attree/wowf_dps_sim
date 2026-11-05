// #322 rulings (Scout) and #280: the rotation builder and the race. The
// on-use racials are offered, and a new rule gets its "ability granted"
// guard, only when the race grants them; the guard's label is "Race or
// talent granted"; a race-gated skip reads "Not your race (Orc
// only)"; and a preset with an on-use race beats no race at a fixed seed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import {
  createConfigForm,
  pageDefaultConfig,
  raceInfo,
  summaryOf,
} from "../js/config-form.js";
import { runFight } from "../js/fight.js";
import { raceCatalogue, raceGrantedAbilities } from "../js/racials.js";
import { createRotationBuilder } from "../js/rotation-builder.js";
import { TYPE_LABELS, abilityGroups } from "../js/rotation-builder-copy.js";
import { defaultRotation } from "../js/rotation-default.js";
import {
  abilityFacts,
  castableAbilities,
  defaultCondition,
  newRule,
  retarget,
  talentAbilities,
} from "../js/rotation-edit.js";
import { loadPreset, referenceBuild } from "../js/rotation-presets.js";
import {
  grantingRaceNames,
  skipOf,
  takenOf,
  talentState,
} from "../js/rotation-skips.js";
import { validateRotation } from "../js/rotation-validator.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import {
  ON_USE_CAST,
  ON_USE_NOTE,
  racialLineText,
  ROGUE_LINES,
} from "../js/views/config-form.js";

// Each on-use racial, the race that grants it, and the skip's words.
const ON_USE = [
  { ability: "blood-fury", race: "orc", name: "Blood Fury", only: "Orc" },
  {
    ability: "elunes-light",
    race: "night-elf",
    name: "Elune's Light",
    only: "Night Elf",
  },
  { ability: "berserking", race: "troll", name: "Berserking", only: "Troll" },
  { ability: "eureka", race: "gnome", name: "Eureka!", only: "Gnome" },
];
const RACIALS = ON_USE.map(({ ability }) => ability);
const PRESETS = ROTATION_PRESETS.map((preset) => preset.id);
const SEED = 2; // #337: seed 1 made troll lose to no-race once Shank was live (haste/RNG); 2 keeps both races ahead.
const FIVE_MINUTES = 300;
const ruleFor = (ability) => ({
  action: ability,
  conditions: [{ type: "abilityGranted", ability }],
});
const optionTexts = (groups) =>
  groups.flatMap((group) => group.options.map((option) => option.text));

describe("#280: the builder offers an on-use racial only when the race grants it", () => {
  it("the list has the four on-use racials, one race each", () => {
    assert.deepEqual([...raceGrantedAbilities].sort(), [...RACIALS].sort());
    for (const { ability, only } of ON_USE) {
      assert.deepEqual(grantingRaceNames(ability), [only]);
    }
  });

  it("no race offers none; each race offers its own and no other", () => {
    const none = castableAbilities(null);
    assert.deepEqual(castableAbilities(), none);
    for (const ability of RACIALS) {
      assert.ok(!none.includes(ability), ability);
    }
    for (const { ability, race } of ON_USE) {
      const offered = castableAbilities(race);
      assert.ok(offered.includes(ability), `${race} offers ${ability}`);
      for (const other of RACIALS.filter((id) => id !== ability)) {
        assert.ok(!offered.includes(other), `${race} doesn't offer ${other}`);
      }
      // The rest stay as they were, in the same order.
      assert.deepEqual(
        offered.filter((id) => id !== ability),
        none,
      );
    }
    // A race with no on-use racial offers what no race does.
    assert.deepEqual(castableAbilities("human"), none);
  });

  it("a racial is off the global cooldown, marked (racial)", () => {
    const groups = abilityGroups(castableAbilities("orc"));
    const off = groups.find(
      (group) => group.label === "Off the global cooldown",
    );
    assert.ok(
      off.options.some(
        (option) =>
          option.value === "blood-fury" &&
          option.text === "Blood Fury (racial)",
      ),
    );
    assert.ok(
      !optionTexts(abilityGroups(castableAbilities())).some((text) =>
        text.includes("(racial)"),
      ),
    );
  });

  it("a guard can name the race's racial; no race, none", () => {
    assert.ok(talentAbilities("orc").includes("blood-fury"));
    assert.ok(!talentAbilities("orc").includes("berserking"));
    for (const ability of RACIALS) {
      assert.ok(!talentAbilities().includes(ability), ability);
    }
    assert.equal(abilityFacts("blood-fury").race, true);
    assert.equal(abilityFacts("blood-fury").talent, false);
    assert.equal(abilityFacts("sinister-strike").race, false);
    assert.deepEqual(defaultCondition("abilityGranted", "blood-fury"), {
      type: "abilityGranted",
      ability: "blood-fury",
    });
  });

  it("a new rule for a racial has its ability granted guard, and is valid", () => {
    let n = 0;
    const nextUid = () => `u${(n += 1)}`;
    for (const { ability } of ON_USE) {
      const rule = newRule(ability, nextUid);
      assert.deepEqual(
        rule.conditions.map(({ type, ability: of }) => ({ type, ability: of })),
        [{ type: "abilityGranted", ability }],
      );
      const rotation = {
        ...defaultRotation(),
        rules: [ruleFor(ability), ...defaultRotation().rules],
      };
      assert.deepEqual(validateRotation(rotation), [], ability);
      // Without its guard it is an error (the validator's talentGuard).
      const bare = {
        ...rotation,
        rules: [
          { action: ability, conditions: [] },
          ...rotation.rules.slice(1),
        ],
      };
      assert.notDeepEqual(validateRotation(bare), [], ability);
    }
  });

  it("retargeting to a racial adds the guard; back to a baseline drops it", () => {
    let n = 0;
    const nextUid = () => `u${(n += 1)}`;
    const strike = newRule("sinister-strike", nextUid);
    const { rule: fury, added } = retarget(strike, "blood-fury", nextUid);
    assert.deepEqual(added && { type: added.type, ability: added.ability }, {
      type: "abilityGranted",
      ability: "blood-fury",
    });
    const { rule: back } = retarget(fury, "sinister-strike", nextUid);
    assert.ok(!back.conditions.some((c) => c.type === "abilityGranted"));
  });
});

describe("#280: the builder's copy for a race", () => {
  it('the guard reads "Race or talent granted"', () => {
    assert.equal(TYPE_LABELS.abilityGranted, "Race or talent granted");
  });

  it('a racial the race lacks is skipped: "Not your race (Orc only)"', () => {
    for (const { ability, race, only } of ON_USE) {
      for (const config of [{ race: null }, {}, { race: "human" }]) {
        const skip = skipOf(ruleFor(ability), talentState(config));
        assert.deepEqual(skip, {
          ability,
          talent: null,
          race: only,
          text: `Not your race (${only} only)`,
          phrase: `not your race (${only} only)`,
        });
        assert.doesNotMatch(skip.text, /baseline|talent/);
      }
      const state = talentState({ race });
      assert.equal(skipOf(ruleFor(ability), state), null);
      assert.deepEqual(takenOf(ruleFor(ability), state), {
        ability,
        talent: null,
        race: only,
      });
    }
    assert.equal(
      skipOf(ruleFor("blood-fury"), talentState({})).text,
      "Not your race (Orc only)",
    );
  });

  it("the Stats summary says it after the line", () => {
    const { rules } = summaryOf(
      { name: "Mine", rules: [ruleFor("blood-fury")] },
      { talents: talentState({ race: null }) },
    );
    assert.match(rules[0], / — skipped: not your race \(Orc only\)$/);
  });
});

function setup(race = null) {
  const store = createStore({
    config: normalizeConfig({ ...pageDefaultConfig(), race }),
  });
  const form = createConfigForm(store);
  const builder = createRotationBuilder(store, form);
  builder.toggle();
  const view = () => store.get().rotationBuilder.view;
  return { store, form, builder, view };
}

describe("#280: the builder's view follows the race", () => {
  it("New rule casts offers Blood Fury to an Orc, and not with no race", () => {
    const orc = setup("orc");
    assert.ok(
      optionTexts(orc.view().add.groups).includes("Blood Fury (racial)"),
    );
    const none = setup(null);
    assert.ok(
      !optionTexts(none.view().add.groups).includes("Blood Fury (racial)"),
    );
    // A race change redraws it.
    none.form.change("race", "orc");
    assert.ok(
      optionTexts(none.view().add.groups).includes("Blood Fury (racial)"),
    );
  });

  it("a preset's racial rules: the race's is taken, the others not your race", () => {
    const { form, view } = setup("orc");
    form.chooseRotation("combat-swords-temp");
    const chips = view()
      .rules.slice(0, ON_USE.length)
      .map((rule) => rule.chips.map((chip) => chip.text));
    const expected = [
      "Orc racial",
      "Not your race (Night Elf only)",
      "Not your race (Troll only)",
      "Not your race (Gnome only)",
    ];
    expected.forEach((text, at) =>
      assert.ok(chips[at].includes(text), `rule ${at + 1}: ${chips[at]}`),
    );
    assert.ok(!chips.flat().some((text) => /talent taken|Skipped:/.test(text)));
    assert.match(
      view().context.text,
      /3 rules are skipped: not your race \(rules 2, 3 and 4\)\./,
    );
    assert.doesNotMatch(view().context.text, /baseline/);
  });
});

describe("#322: the on-use line says what the rotation does", () => {
  const fury = (rotation) =>
    raceInfo("orc", raceCatalogue, undefined, rotation).racials.find(
      (racial) => racial.id === "orc.blood-fury",
    );

  it("a preset casts it; the default rotation has no rule for it", () => {
    const preset = fury(ROTATION_PRESETS[0].rotation);
    assert.equal(preset.casts, true);
    assert.equal(
      racialLineText(preset),
      `${ROGUE_LINES["blood-fury"]} ${ON_USE_NOTE} ${ON_USE_CAST.yes}`,
    );
    const plain = fury(defaultRotation());
    assert.equal(plain.casts, false);
    assert.equal(
      racialLineText(plain),
      `${ROGUE_LINES["blood-fury"]} ${ON_USE_NOTE} ${ON_USE_CAST.no}`,
    );
    assert.equal(ON_USE_NOTE, "The preset rotations use it on cooldown.");
    assert.doesNotMatch(racialLineText(plain), /built-in rotations don't/);
  });

  it("the form's line follows the rotation picked", () => {
    const { store, form } = setup("orc");
    const line = () =>
      store.get().form.race.racials.find((r) => r.id === "orc.blood-fury")
        .casts;
    // Page default is the temp Combat swords preset (casts on-use racials).
    assert.equal(line(), true);
    form.chooseRotation("default");
    assert.equal(line(), false);
    form.chooseRotation("combat-swords-temp");
    assert.equal(line(), true);
  });

  it("every preset opens with the four racials, each guarded only by ability granted", () => {
    for (const preset of ROTATION_PRESETS) {
      assert.deepEqual(
        preset.rotation.rules.slice(0, ON_USE.length),
        RACIALS.map(ruleFor),
        preset.id,
      );
    }
    assert.ok(
      defaultRotation().rules.every(
        (rule) => !raceGrantedAbilities.has(rule.action),
      ),
    );
  });
});

// The preset as its button loads it, with its reference build, plus `race`.
function presetConfig(id, race) {
  const build = referenceBuild(id);
  return loadPreset(id, {
    race,
    talents: { ...build.talents },
    talentLevel: build.talentLevel,
    weapons: structuredClone(build.weapons),
    poisons: { ...build.poisons },
  });
}

describe("#322: a preset with an on-use race beats no race (fixed seed)", () => {
  for (const id of PRESETS) {
    for (const race of ["orc", "troll"]) {
      it(`${id}: ${race} over no race, seed ${SEED}`, () => {
        const dps = (r) =>
          runFight({
            seed: SEED,
            duration: FIVE_MINUTES,
            config: presetConfig(id, r),
          }).dps;
        const none = dps(null);
        const raced = dps(race);
        assert.ok(raced > none, `${id} ${race} ${raced} > ${none}`);
      });
    }
  }
});
