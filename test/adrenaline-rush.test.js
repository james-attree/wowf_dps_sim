import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { COMBAT_GRANTS } from "./combat-grants.js";
import { setRoll, testRng } from "./rolls.js";
import { runOnCore } from "../js/core/fight.js";
import { quiet } from "./quiet.js";

// Issue #19. 30 fps and 144 fps are the two rates the swing-timer fight uses.
const FRAME_RATES = [30, 144];
// Long enough that a 180s cooldown would fire again, and a 300s cooldown fires once more.
const LONG_FIGHT_SECONDS = 360;

function near(actual, expected) {
  assert.ok(
    Number.isFinite(actual) &&
      Math.abs(actual - expected) <= k("sim.tickEpsilon"),
    `${actual} is not within tick epsilon of ${expected}`,
  );
}

function harness() {
  const rogue = new Rogue();
  quiet(rogue);
  const sim = new Simulation(rogue, { rng: testRng });
  assert.equal(sim.currentTime, 0);
  return { rogue, sim };
}

function watchCasts(sim) {
  const casts = [];
  const addCombatEvent = sim.addCombatEvent.bind(sim);
  sim.addCombatEvent = (name, type, damage, status, ...rest) => {
    if (name === "Adrenaline Rush" && status === "Cast") {
      casts.push(sim.currentTime);
    }
    return addCombatEvent(name, type, damage, status, ...rest);
  };
  return casts;
}

// The rotation's look at the fight `fps` times a second: the event core's
// decisions, and a poll every 1 / fps on top (runOnCore's pollEvery). The
// fixed-step engine asked once a frame; #234 removed it.
function runFrames(sim, fps, seconds) {
  runOnCore(sim, seconds, { pollEvery: 1 / fps });
}

const NONE = { casts: [], outcome: "none" };

// Issue #59. The recast is the first frame these are all true, not a gap of
// the cooldown plus two GCDs. Cooldown and the GCD are the spell checks.
// Energy has to cover the cost. The placeholder Combat rotation tries
// Adrenaline Rush whenever it is off cooldown, after Blade Flurry.
function adrenalineRushRecastReady(rogue, sim) {
  const skill = rogue.abilities.adrenalineRush;
  const flurry = rogue.abilities.bladeFlurry;
  const gcdClear = sim.gcd <= k("sim.tickEpsilon") || !skill.triggersGcd;
  const flurryTakesTheGcd =
    (sim.gcd <= k("sim.tickEpsilon") || !flurry.triggersGcd) &&
    !flurry.onCooldown(rogue, sim) &&
    rogue.energy >= flurry.cost;
  const cooldownReady = !skill.onCooldown(rogue, sim);
  const enoughEnergy = rogue.energy >= skill.cost;
  return cooldownReady && gcdClear && enoughEnergy && !flurryTakesTheGcd;
}

describe("Adrenaline Rush export", () => {
  it("uses the 5 min cooldown from rogue.json spell_desc", async () => {
    const snapshot = JSON.parse(
      await readFile(
        new URL("../data/talentsforever/rogue.json", import.meta.url),
      ),
    );
    const spell = snapshot.spell_desc["Rogue|Adrenaline Rush|"];
    const minutes = Number(
      spell.l
        .flat()
        .join(" ")
        .match(/(\d+) min cooldown/)[1],
    );
    const bonusPercent = Number(spell.d.match(/by (\d+)%/)[1]);
    const duration = Number(spell.d.match(/for (\d+) sec/)[1]);
    const cooldown = minutes * 60;

    assert.equal(cooldown, 300);
    assert.equal(k("adrenalineRush").cooldown, cooldown);
    assert.equal(k("adrenalineRush").regenMultiplier, 1 + bonusPercent / 100);
    assert.equal(k("adrenalineRush").duration, duration);
    assert.equal(k("adrenalineRush").energy, 0);
    assert.equal(CONSTANTS.adrenalineRush.source, "wowf-export");
    assert.match(
      CONSTANTS.adrenalineRush.ref,
      /rogue\.json → spell_desc\[Rogue\|Adrenaline Rush\|\]/,
    );
    assert.equal(
      Object.hasOwn(CONSTANTS, "adrenalineRush.engineCooldown"),
      false,
    );
    assert.equal(new Rogue().abilities.adrenalineRush.cooldown, cooldown);
  });
});

describe("Adrenaline Rush cooldown", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("is not castable again until 300s after use, at 30 and 144 fps", () => {
    const cooldown = k("adrenalineRush").cooldown;
    assert.equal(cooldown, 300);
    const gaps = {};

    for (const fps of FRAME_RATES) {
      const { rogue, sim } = harness();
      const skill = rogue.abilities.adrenalineRush;
      const casts = watchCasts(sim);
      let blockedAt = null;
      rogue.castRotation = () => {
        const remaining = sim.cooldowns[skill.id] ?? 0;
        const events = sim.combatLog.length;
        skill.cast(rogue, sim);
        // Only the wait between the first cast and the recast.
        if (casts.length !== 1) {
          return NONE;
        }
        if (remaining > 0) {
          assert.equal(sim.cooldowns[skill.id], remaining, `${fps} fps`);
          assert.equal(sim.combatLog.length, events, `${fps} fps`);
          assert.equal(skill.onCooldown(rogue, sim), true, `${fps} fps`);
          blockedAt = sim.currentTime;
        }
        return NONE;
      };

      const dt = 1 / fps;
      runFrames(sim, fps, cooldown + 1);

      assert.equal(casts.length, 2, `${fps} fps`);
      assert.ok(
        blockedAt < casts[1],
        `${fps} fps was refused before the recast`,
      );
      near(casts[1] - blockedAt, dt);
      near(casts[1] - casts[0], cooldown);
      near(sim.cooldowns[skill.id], cooldown - (cooldown + 1 - casts[1]));
      gaps[fps] = casts[1] - casts[0];
    }

    near(gaps[30], gaps[144]);
  });

  it("fires again at 300s in a long fight, at 30 and 144 fps", () => {
    const cooldown = k("adrenalineRush").cooldown;
    assert.equal(cooldown, 300);
    const gaps = {};

    for (const fps of FRAME_RATES) {
      const { rogue, sim } = harness();
      const skill = rogue.abilities.adrenalineRush;
      const casts = watchCasts(sim);
      rogue.castRotation = () => {
        skill.cast(rogue, sim);
        return NONE;
      };
      runFrames(sim, fps, LONG_FIGHT_SECONDS);

      assert.equal(casts.length, 2, `${fps} fps`);
      near(casts[1] - casts[0], cooldown);
      assert.ok(casts[1] < LONG_FIGHT_SECONDS, `${fps} fps`);
      assert.ok(
        casts[0] + cooldown * 2 > LONG_FIGHT_SECONDS,
        `${fps} fps does not fire a third time`,
      );
      gaps[fps] = casts[1] - casts[0];
    }

    near(gaps[30], gaps[144]);
  });

  it("does not recast in a sample fight before 300s, at 30 and 144 fps", () => {
    setRoll(0.5);
    const cooldown = k("adrenalineRush").cooldown;
    const fights = {};

    for (const fps of FRAME_RATES) {
      // Granted: with no talents the default rotation does not cast it (#199).
      const rogue = new Rogue(undefined, COMBAT_GRANTS);
      const sim = new Simulation(rogue, { rng: testRng });
      assert.equal(sim.currentTime, 0);
      const casts = watchCasts(sim);
      const play = rogue.castRotation.bind(rogue);
      let firstReady = null;
      rogue.castRotation = (simulation) => {
        if (
          casts.length === 1 &&
          firstReady === null &&
          adrenalineRushRecastReady(rogue, simulation)
        ) {
          firstReady = simulation.currentTime;
        }
        return play(simulation);
      };
      runFrames(sim, fps, LONG_FIGHT_SECONDS);

      assert.equal(casts.length, 2, `${fps} fps`);
      const gap = casts[1] - casts[0];
      assert.ok(
        gap + k("sim.tickEpsilon") >= cooldown,
        `${fps} fps recast ${gap}s after use`,
      );
      assert.ok(
        Number.isFinite(firstReady) &&
          Math.abs(casts[1] - firstReady) <= k("sim.tickEpsilon"),
        `${fps} fps recast at ${casts[1]}s, first ready frame was ${firstReady}s`,
      );
      fights[fps] = { casts, damage: sim.damageDone, gap };
    }

    // A 360s fight can differ by a swing: Slice and Dice uptime is measured
    // on frame boundaries, so 144 fps can land one more off-hand hit.
    assert.ok(fights[30].damage > 0);
    assert.ok(fights[144].damage > 0);
    near(fights[30].gap, fights[144].gap);
  });
});
