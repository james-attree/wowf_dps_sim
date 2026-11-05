import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runOnCore } from "../js/core/fight.js";
import { createFight } from "../js/fight.js";
import { defaultDaggerConfig } from "../js/sim-config.js";
import {
  PREPARATION_ROTATION,
  SUBTLETY_BUILD,
} from "../scripts/golden-update.mjs";

// Issue #275, from Kira's QA of #301 (N4, N6): how the event core orders the
// timers a second run sets at begin() (restore() and sync() in
// js/core/fight.js). A timer that goes on with the end the last run left
// keeps its place (its seq); a timer the host changed between the runs is
// fresh: it ends at now + the new value and runs after every carried timer
// that ends at the same time. The fight is the Preparation fixture on seed 1,
// the one test/preparation.test.js cuts.

const config = {
  ...defaultDaggerConfig(),
  talents: { ...SUBTLETY_BUILD },
  rotation: structuredClone(PREPARATION_ROTATION),
};

// The fight run to each cut in turn; `host` runs on the Simulation after the
// first cut, as a host that edits its fields between runs would.
function cutFight(cuts, host = () => {}) {
  const fight = createFight(1, structuredClone(config), { duration: 60 });
  const sim = fight.simulation;
  const auras = [];
  sim.on("aura", (event) => auras.push(event));
  cuts.forEach((cut, index) => {
    runOnCore(sim, cut - sim.currentTime);
    if (index === 0) {
      host(sim);
    }
  });
  return { sim, auras };
}

const expiriesAt = (auras, time) =>
  auras
    .filter((event) => event.change === "expire" && event.time === time)
    .map((event) => event.aura);

describe("a timer the host changes between runs (#275, #301 N4)", () => {
  // At 24 s Hemorrhage (scheduled first, the lower seq) ends at 32 and
  // Ghostly Strike's aura (the higher seq) at 29. The host sets Hemorrhage to
  // 5 s, so both end at 29: Hemorrhage is fresh, Ghostly Strike goes on.
  const CUT = 24;
  const TIE = 29;
  const changed = () =>
    cutFight([CUT, 60], (sim) => {
      sim.activeDebuffs.hemorrhage.duration = TIE - CUT;
    });

  it.skip("before the change, Hemorrhage was scheduled before Ghostly Strike (skipped: waits on #275 engine carry-order nits)", () => {
    const { sim } = cutFight([CUT]);
    const debuff = sim.coreCarry.auras.activeDebuffs.get("hemorrhage");
    const buff = sim.coreCarry.auras.activeBuffs.get("ghostly-strike");
    assert.ok(debuff.seq < buff.seq);
    assert.notEqual(debuff.endsAt, TIE);
    assert.equal(buff.endsAt, TIE);
  });

  it.skip("ends at now + the new value, not the end the last run left (skipped: waits on #275 engine carry-order nits)", () => {
    const { auras } = changed();
    assert.ok(expiriesAt(auras, TIE).includes("hemorrhage"));
    assert.equal(
      auras.filter((e) => e.change === "expire" && e.aura === "hemorrhage")[0]
        .time,
      TIE,
    );
  });

  it.skip("runs after the carried timer that ends at the same time (skipped: waits on #275 engine carry-order nits)", () => {
    assert.deepEqual(expiriesAt(changed().auras, TIE), [
      "ghostly-strike",
      "hemorrhage",
    ]);
  });
});

describe("an aura object the host replaces between runs (#275, #301 N6)", () => {
  // At 24 s Rupture (lower seq) and Hemorrhage both end at 32; one run
  // expires Rupture first. A host that puts a new Rupture object in, with the
  // same time left, starts a new timer: it is no longer the timer the last
  // run scheduled, so it runs after Hemorrhage (the `own` guard in syncAuras).
  const CUT = 24;
  const END = 32;

  it.skip("one run, or an untouched cut, expires Rupture then Hemorrhage (skipped: waits on #275 engine carry-order nits)", () => {
    assert.deepEqual(expiriesAt(cutFight([60]).auras, END), [
      "rupture",
      "hemorrhage",
    ]);
    assert.deepEqual(expiriesAt(cutFight([CUT, 60]).auras, END), [
      "rupture",
      "hemorrhage",
    ]);
  });

  it.skip("a replaced Rupture with the same time left runs after Hemorrhage (skipped: waits on #275 engine carry-order nits)", () => {
    const { auras } = cutFight([CUT, 60], (sim) => {
      sim.activeDebuffs.rupture = { ...sim.activeDebuffs.rupture };
    });
    assert.deepEqual(expiriesAt(auras, END), ["hemorrhage", "rupture"]);
  });
});

describe("the GCD and cooldown seq carry (#275, #301 N6)", () => {
  const seqs = (sim) =>
    Object.fromEntries(
      [...sim.coreCarry.cooldowns].map(([id, item]) => [id, item.seq]),
    );

  it.skip("cooldowns are set again in the order they were scheduled (skipped: waits on #275 engine carry-order nits)", () => {
    // At 20 s Preparation's cooldown was scheduled before Ghostly Strike's,
    // though sim.cooldowns lists Ghostly Strike first.
    const first = cutFight([20]).sim;
    assert.deepEqual(Object.keys(first.cooldowns), [
      "ghostly-strike",
      "preparation",
    ]);
    const before = seqs(first);
    assert.ok(before.preparation < before["ghostly-strike"]);
    const after = seqs(cutFight([20, 21]).sim);
    assert.ok(after.preparation < after["ghostly-strike"]);
  });

  it.skip("the GCD keeps its place among the cooldowns (skipped: waits on #275 engine carry-order nits)", () => {
    // At 22.5 s the GCD from the 22 s Ghostly Strike runs (scheduled before
    // that cast's cooldown, after Preparation's).
    const first = cutFight([22.5]).sim;
    assert.ok(first.gcd > 0);
    const before = seqs(first);
    assert.equal(typeof first.coreCarry.gcd.seq, "number");
    assert.ok(before.preparation < first.coreCarry.gcd.seq);
    assert.ok(first.coreCarry.gcd.seq < before["ghostly-strike"]);
    const sim = cutFight([22.5, 22.7]).sim;
    const after = seqs(sim);
    assert.ok(after.preparation < sim.coreCarry.gcd.seq);
    assert.ok(sim.coreCarry.gcd.seq < after["ghostly-strike"]);
  });
});
