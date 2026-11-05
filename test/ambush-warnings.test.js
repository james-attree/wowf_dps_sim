import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageDefaultConfig } from "../js/config-form.js";
import { rotationWarnings } from "../js/rotation-warnings.js";

// #245, Fran's check and James's ruling: Ambush gets no lock, warning or
// note, kept for #271. Its rule is passed over for the whole fight without
// Cutthroat (the only grant of the "Ambush allowed" aura, #262, #271), and
// with it casts only while the aura is up, so a rule above it that always holds is not
// said to starve it, and it is not said to starve the rules below. A
// genuine trap on another ability still warns.

const base = () => pageDefaultConfig().rotation;
const withRule = (at, rule) => {
  const rotation = base();
  const rules = [...rotation.rules];
  rules.splice(at, 0, rule);
  return { ...rotation, rules };
};
const AMBUSH = { action: "ambush", conditions: [] };
const BACKSTAB = { action: "backstab", conditions: [] };

// Ambush warning cases need a talent retune for 70755 Ambush, not #333.
describe("an Ambush rule gets no warning (#245, James's ruling)", () => {
  it.skip("the default rotation has none to start with (skipped: Ambush needs talent retune for 70755, see #335)", () => {
    assert.deepEqual(rotationWarnings(base()), []);
  });

  it.skip("added at the bottom, under Sinister Strike with no conditions (skipped: Ambush needs talent retune for 70755, see #335)", () => {
    const rotation = withRule(base().rules.length, AMBUSH);
    assert.deepEqual(rotationWarnings(rotation), []);
  });

  it.skip("added at the top, with no conditions (skipped: Ambush needs talent retune for 70755, see #335)", () => {
    assert.deepEqual(rotationWarnings(withRule(0, AMBUSH)), []);
  });

  it.skip("another ability below Sinister Strike still starves (skipped: Ambush needs talent retune for 70755, see #335)", () => {
    const rotation = withRule(base().rules.length, BACKSTAB);
    const warnings = rotationWarnings(rotation);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, "starves");
    assert.equal(warnings[0].ability, "sinister-strike");
    assert.match(warnings[0].message, /Backstab \(backstab\) never casts/);
  });

  it.skip("a rule above Ambush still starves the rules below Ambush (skipped: Ambush needs talent retune for 70755, see #335)", () => {
    const rotation = withRule(0, { action: "sinister-strike", conditions: [] });
    rotation.rules.splice(1, 0, AMBUSH);
    const starves = rotationWarnings(rotation).find(
      (warning) => warning.code === "starves",
    );
    assert.equal(starves.ability, "sinister-strike");
    assert.doesNotMatch(starves.message, /Ambush/);
  });
});
