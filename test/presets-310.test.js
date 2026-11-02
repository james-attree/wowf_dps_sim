// #310: the three presets and their reference builds are James's builds, as
// his share links carry them (2 Nov 2026). The links' setups are kept as their
// decoded payloads in test/fixtures/presets-310/; each is read back through
// the build codec as a link and compared with the preset and its reference
// build: talents, weapons, poisons and rotation. The documented exceptions
// are the Combat link's first Slice and Dice rule (folded into the second)
// and the Subtlety link's off hand (James's later ruling: 59-111 at 1.6).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETUP_VERSION, decodeSetup } from "../js/build-codec.js";
import { loadPreset, referenceBuild } from "../js/rotation-presets.js";
import { checkReferenceBuild } from "../js/preset-reference-builds.js";
import { normalizeConfig } from "../js/sim-config.js";
import { runFight } from "../js/fight.js";
import { k } from "../data/constants.js";

const ASSASSINATION = "assassination-daggers";
const COMBAT = "combat-swords";
const SUBTLETY = "subtlety-daggers";
const PRESETS = [ASSASSINATION, COMBAT, SUBTLETY];
// James's ruling (2 Nov 2026, #310): the daggers' off hand.
const RULED_OFF_HAND = { min: 59, max: 111, speed: 1.6, type: "dagger" };
// The Subtlety link's off hand, before that ruling.
const LINK_OFF_HAND = { min: 57, max: 107, speed: 1.6, type: "dagger" };

const payloadOf = (id) =>
  JSON.parse(
    readFileSync(new URL(`fixtures/presets-310/${id}.json`, import.meta.url)),
  );
const linkOf = (payload) =>
  `${SETUP_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

function linkSetup(id) {
  const read = decodeSetup(linkOf(payloadOf(id)));
  assert.equal(read.status, "ok", id);
  return read.setup.config;
}

// The preset as the page loads it, with its whole reference build.
function presetSetup(id) {
  const build = referenceBuild(id);
  return normalizeConfig(
    loadPreset(id, {
      talents: { ...build.talents },
      talentLevel: build.talentLevel,
      weapons: structuredClone(build.weapons),
      poisons: { ...build.poisons },
    }),
  );
}

describe("#310: each preset is its share link's setup", () => {
  for (const id of PRESETS) {
    it(`${id}: the reference build's talents are the link's`, () => {
      assert.deepEqual(referenceBuild(id).talents, linkSetup(id).talents);
      assert.equal(referenceBuild(id).talentLevel, linkSetup(id).talentLevel);
    });

    it(`${id}: the reference build's poisons are the link's`, () => {
      assert.deepEqual(referenceBuild(id).poisons, linkSetup(id).poisons);
      assert.deepEqual(checkReferenceBuild(id, referenceBuild(id)), []);
    });
  }

  it("the weapons are the links', with the daggers' off hand at James's ruling", () => {
    assert.deepEqual(referenceBuild(COMBAT).weapons, linkSetup(COMBAT).weapons);
    assert.deepEqual(
      referenceBuild(ASSASSINATION).weapons,
      linkSetup(ASSASSINATION).weapons,
    );
    assert.deepEqual(linkSetup(ASSASSINATION).weapons.offHand, RULED_OFF_HAND);
    // The Subtlety link predates the ruling: only its off hand differs.
    const link = linkSetup(SUBTLETY).weapons;
    assert.deepEqual(link.offHand, LINK_OFF_HAND);
    assert.deepEqual(referenceBuild(SUBTLETY).weapons, {
      mainHand: link.mainHand,
      offHand: RULED_OFF_HAND,
    });
    assert.deepEqual(k("presetReferenceBuild.daggerOffHand"), RULED_OFF_HAND);
  });

  it("Combat is Deadly on the main hand and Instant on the off hand; the daggers the reverse", () => {
    assert.deepEqual(referenceBuild(COMBAT).poisons, {
      mainHand: "deadly",
      offHand: "instant",
    });
    for (const id of [ASSASSINATION, SUBTLETY]) {
      assert.deepEqual(referenceBuild(id).poisons, {
        mainHand: "instant",
        offHand: "deadly",
      });
    }
  });

  for (const id of [ASSASSINATION, SUBTLETY]) {
    it(`${id}: the rotation's rules are the link's, in order`, () => {
      assert.deepEqual(
        presetSetup(id).rotation.rules,
        linkSetup(id).rotation.rules,
      );
    });
  }

  it("combat-swords: the rules are the link's, its first Slice and Dice rule folded into the second", () => {
    const link = linkSetup(COMBAT).rotation.rules;
    const [first, second] = link;
    assert.equal(first.action, "slice-and-dice");
    assert.equal(second.action, "slice-and-dice");
    // The first (5 points, Slice and Dice under 1 s) is the second's case
    // with more points (3 or more, the same timer), so it never decides.
    const timer = (rule) =>
      rule.conditions.find((c) => c.type === "auraRemaining");
    const points = (rule) =>
      rule.conditions.find((c) => c.type === "comboPoints");
    assert.equal(first.conditions.length, 2);
    assert.equal(second.conditions.length, 2);
    assert.deepEqual(timer(first), timer(second));
    assert.equal(points(first).op, ">=");
    assert.equal(points(second).op, ">=");
    assert.ok(points(first).value >= points(second).value);
    assert.deepEqual(presetSetup(COMBAT).rotation.rules, link.slice(1));
  });

  it("combat-swords: the folded rule changes no fight (identical results over many seeds)", () => {
    const folded = presetSetup(COMBAT);
    const unfolded = {
      ...folded,
      rotation: { ...folded.rotation, rules: linkSetup(COMBAT).rotation.rules },
    };
    const SEEDS = 40;
    for (const duration of [60, 300]) {
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const a = runFight({ seed, duration, config: folded });
        const b = runFight({ seed, duration, config: unfolded });
        assert.equal(a.totalDamage, b.totalDamage, `${seed} ${duration}`);
        assert.deepEqual(a.abilities, b.abilities, `${seed} ${duration}`);
      }
    }
  });

  it("the daggers' off-hand ruling leaves the dagger alternate (Core Hound Tooth) as it is", () => {
    assert.deepEqual(k("weapon.dagger.offHand"), LINK_OFF_HAND);
  });
});
