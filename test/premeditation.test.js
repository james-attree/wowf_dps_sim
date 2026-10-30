import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";
import { runOnCore } from "../js/core/fight.js";
import { quiet } from "./quiet.js";

const FRAME_RATES = [30, 144];

function near(actual, expected) {
  assert.ok(
    Number.isFinite(actual) &&
      Math.abs(actual - expected) <= k("sim.tickEpsilon"),
    `${actual} is not within tick epsilon of ${expected}`,
  );
}

// `actual` is the end of the frame that holds `expected`: no earlier than it
// and less than a frame (`dt`) after it.
function within(actual, expected, dt) {
  assert.ok(
    Number.isFinite(actual) &&
      actual >= expected - k("sim.tickEpsilon") &&
      actual < expected + dt + k("sim.tickEpsilon"),
    `${actual} is not in the frame that holds ${expected}`,
  );
}

function harness({ hit = true } = {}) {
  const rogue = new Rogue();
  rogue.bonusHitChance = hit ? 1 : 0;
  rogue.critChance = 0;
  quiet(rogue);
  const sim = new Simulation(rogue, { rng: testRng });
  assert.equal(sim.currentTime, 0);
  return { rogue, sim };
}

// Whole frames at this fps, as one step in seconds.
function timeAt(fps, seconds) {
  return Math.round(seconds * fps) / fps;
}

describe("Premeditation export", () => {
  it("uses the rogue.json spell_desc values and does not require Stealth", async () => {
    const snapshot = JSON.parse(
      await readFile(
        new URL("../data/talentsforever/rogue.json", import.meta.url),
      ),
    );
    const spell = snapshot.spell_desc["Rogue|Premeditation|"];
    const added = Number(spell.d.match(/Adds (\d+) Combo Points/)[1]);
    const expiry = Number(spell.d.match(/within (\d+) sec/)[1]);
    const minutes = Number(
      spell.l
        .flat()
        .join(" ")
        .match(/(\d+) min cooldown/)[1],
    );
    const classicExpiry = Number(spell.cd.match(/within (\d+) sec/)[1]);

    assert.equal(k("premeditation").comboPoints, added);
    assert.equal(k("premeditation.cpExpiry"), expiry);
    assert.equal(k("premeditation").cooldown, minutes * 60);
    assert.equal(k("premeditation").energy, 0);
    assert.equal(/energy/i.test(spell.l.flat().join(" ")), false);
    assert.notEqual(classicExpiry, expiry);
    assert.match(spell.cx, /No longer requires Stealth/);
    assert.match(
      CONSTANTS["premeditation.cpExpiry"].ref,
      /rogue\.json → spell_desc\[Rogue\|Premeditation\|\]/,
    );
    assert.match(CONSTANTS.premeditation.ref, /Rogue\|Premeditation\|/);

    const { rogue, sim } = harness();
    assert.equal(sim.activeBuffs.stealth, undefined);
    rogue.abilities.premeditation.cast(rogue, sim);

    assert.equal(rogue.comboPoints, added);
    assert.equal(rogue.premeditationCp, added);
    near(rogue.premeditationCpRemaining, expiry);
    assert.equal(sim.gcd, 0);
    assert.equal(rogue.energy, k("start.state").energy);
    assert.equal(sim.cooldowns.premeditation, k("premeditation").cooldown);
    assert.equal(sim.combatLog[0].name, "Premeditation");
    assert.equal(sim.combatLog[0].status, "Cast");
    assert.equal(sim.activeBuffs.stealth, undefined);
  });
});

describe("fight start", () => {
  it("starts at 0 combo points", () => {
    const rogue = new Rogue();
    assert.equal(k("character.startingComboPoints"), 0);
    assert.equal(k("start.state").comboPoints, 0);
    assert.equal(rogue.comboPoints, k("start.state").comboPoints);
    assert.equal(rogue.premeditationCp, 0);
    assert.equal(rogue.premeditationCpRemaining, 0);
  });
});

describe("Premeditation combo point expiry", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("removes the points at 20s on a clock pinned at 0, at 30 and 144 fps", () => {
    const expiry = k("premeditation.cpExpiry");
    const granted = k("premeditation").comboPoints;
    const expiredAt = {};

    for (const fps of FRAME_RATES) {
      const { rogue, sim } = harness();
      rogue.abilities.premeditation.cast(rogue, sim);
      const dt = 1 / fps;
      const frames = Math.round((expiry + 1) * fps);
      let goneAt = null;
      let stillThereAt = null;
      for (let frame = 1; frame <= frames; frame += 1) {
        runOnCore(sim, dt);
        if (rogue.comboPoints === granted) {
          stillThereAt = sim.currentTime;
        } else if (goneAt === null) {
          goneAt = sim.currentTime;
          break;
        }
      }

      assert.equal(rogue.comboPoints, 0, `${fps} fps`);
      assert.equal(rogue.premeditationCp, 0, `${fps} fps`);
      assert.equal(rogue.premeditationCpRemaining, 0, `${fps} fps`);
      // The core takes them at 20 s exactly; a frame sees it at its end.
      within(goneAt, expiry, dt);
      assert.ok(stillThereAt < expiry, `${fps} fps still had the points`);
      assert.ok(stillThereAt > 0, `${fps} fps`);
      expiredAt[fps] = goneAt;
    }

    // Both frame rates saw them go in the frame that holds 20 s.
    assert.ok(Math.abs(expiredAt[30] - expiredAt[144]) <= 1 / 30);
  });

  it("counts the 20s from the cast, at its own time", () => {
    for (const fps of FRAME_RATES) {
      const { rogue, sim } = harness();
      let castTime = null;
      rogue.castRotation = () => {
        if (castTime === null) {
          rogue.abilities.premeditation.cast(rogue, sim);
          castTime = sim.currentTime;
        }
        return { casts: [], outcome: "none" };
      };
      const dt = 1 / fps;
      runOnCore(sim, dt);

      // Cast at the decision at 0; the frame after it counts against the 20 s.
      assert.equal(castTime, 0);
      assert.equal(rogue.comboPoints, k("premeditation").comboPoints);
      near(rogue.premeditationCpRemaining, k("premeditation.cpExpiry") - dt);
      assert.equal(sim.gcd, 0);

      quiet(rogue);
      const frames = Math.round((k("premeditation.cpExpiry") + 1) * fps);
      let goneAt = null;
      for (let frame = 2; frame <= frames; frame += 1) {
        runOnCore(sim, dt);
        if (rogue.comboPoints !== k("premeditation").comboPoints) {
          goneAt = sim.currentTime;
          break;
        }
      }
      within(goneAt - castTime, k("premeditation.cpExpiry"), dt);
      assert.equal(rogue.comboPoints, 0);
    }
  });

  it("keeps the points when a later cast adds a combo point", () => {
    setRoll(0.99);
    for (const fps of FRAME_RATES) {
      const { rogue, sim } = harness();
      rogue.abilities.premeditation.cast(rogue, sim);
      const added = rogue.abilities.hemorrhage.cast(rogue, sim);

      const kept = k("premeditation").comboPoints + k("hemorrhage").comboPoints;
      assert.equal(added.landed, true);
      assert.equal(rogue.comboPoints, kept);
      assert.equal(rogue.premeditationCp, 0);

      runOnCore(sim, timeAt(fps, k("premeditation.cpExpiry") + 1));
      assert.equal(rogue.comboPoints, kept, `${fps} fps`);
    }
  });

  it("keeps later combo points when a finisher spends the Premeditation points", () => {
    setRoll(0.99);
    for (const fps of FRAME_RATES) {
      const { rogue, sim } = harness();
      rogue.abilities.premeditation.cast(rogue, sim);
      const spent = rogue.abilities.eviscerate.cast(rogue, sim);

      assert.equal(spent.landed, true);
      assert.equal(rogue.comboPoints, 0);
      assert.equal(rogue.premeditationCp, 0);
      rogue.comboPoints = 1;

      runOnCore(sim, timeAt(fps, k("premeditation.cpExpiry") + 1));
      assert.equal(rogue.comboPoints, 1, `${fps} fps`);
    }
  });

  it("still expires the points when the following cast misses", () => {
    setRoll(0);
    for (const fps of FRAME_RATES) {
      const { rogue, sim } = harness({ hit: false });
      const granted = k("premeditation").comboPoints;
      rogue.abilities.premeditation.cast(rogue, sim);
      const builder = rogue.abilities.sinisterStrike.cast(rogue, sim);
      sim.gcd = 0;
      const finisher = rogue.abilities.eviscerate.cast(rogue, sim);

      assert.equal(builder.landed, false);
      assert.equal(finisher.landed, false);
      assert.equal(rogue.comboPoints, granted);
      assert.equal(rogue.premeditationCp, k("premeditation.cpRemovedOnExpiry"));

      runOnCore(sim, timeAt(fps, k("premeditation.cpExpiry")));
      assert.equal(rogue.comboPoints, 0, `${fps} fps`);
    }
  });

  it("removes 2 combo points when 4 becomes 5 on the cast", () => {
    const { rogue, sim } = harness();
    rogue.comboPoints = k("combo.max") - 1;
    rogue.abilities.premeditation.cast(rogue, sim);

    assert.equal(rogue.comboPoints, k("combo.max"));
    assert.equal(rogue.premeditationCp, k("premeditation.cpRemovedOnExpiry"));

    runOnCore(sim, timeAt(30, k("premeditation.cpExpiry")));
    assert.equal(
      rogue.comboPoints,
      k("combo.max") - k("premeditation.cpRemovedOnExpiry"),
    );
    assert.equal(rogue.comboPoints, 3);
  });

  it("removes 2 combo points when the cast itself added none", () => {
    const { rogue, sim } = harness();
    rogue.comboPoints = k("combo.max");
    rogue.abilities.premeditation.cast(rogue, sim);

    assert.equal(rogue.comboPoints, k("combo.max"));
    assert.equal(rogue.premeditationCp, k("premeditation.cpRemovedOnExpiry"));

    runOnCore(sim, timeAt(30, k("premeditation.cpExpiry")));
    assert.equal(
      rogue.comboPoints,
      k("combo.max") - k("premeditation.cpRemovedOnExpiry"),
    );
  });

  it("clamps expiry at 0 combo points", () => {
    for (const fps of FRAME_RATES) {
      for (const comboPoints of [0, 1]) {
        const { rogue, sim } = harness();
        rogue.abilities.premeditation.cast(rogue, sim);
        rogue.comboPoints = comboPoints;
        assert.equal(
          rogue.premeditationCp,
          k("premeditation.cpRemovedOnExpiry"),
        );

        runOnCore(sim, timeAt(fps, k("premeditation.cpExpiry")));
        assert.equal(rogue.comboPoints, 0, `${fps} fps from ${comboPoints}`);
        assert.equal(rogue.premeditationCp, 0);
      }
    }
  });

  it("does not treat a capped generator as adding to the Premeditation points", () => {
    setRoll(0.99);
    const { rogue, sim } = harness();
    rogue.comboPoints = k("combo.max") - 1;
    rogue.abilities.premeditation.cast(rogue, sim);
    const capped = rogue.abilities.hemorrhage.cast(rogue, sim);

    assert.equal(capped.landed, true);
    assert.equal(rogue.comboPoints, k("combo.max"));
    assert.equal(rogue.premeditationCp, k("premeditation.cpRemovedOnExpiry"));

    runOnCore(sim, timeAt(144, k("premeditation.cpExpiry")));
    assert.equal(
      rogue.comboPoints,
      k("combo.max") - k("premeditation.cpRemovedOnExpiry"),
    );
  });
});
