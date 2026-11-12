// Manual fight B1 (#348). The scripted path is not involved.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { openCore } from "../js/core/fight.js";
import { createFight, fightResult, runFight } from "../js/fight.js";
import {
  blockedText,
  createManualFight,
  waitStopCode,
} from "../js/manual-fight.js";
import { remainingTime } from "../js/views/run-model.js";
import { loadPreset, referenceBuild } from "../js/rotation-presets.js";

function presetConfig(id, extra = {}) {
  const build = referenceBuild(id);
  return loadPreset(id, {
    talents: build.talents,
    talentLevel: build.talentLevel,
    weapons: build.weapons,
    poisons: build.poisons,
    character: build.character,
    ...extra,
  });
}

function fight(id, extra) {
  return createManualFight({
    seed: 1,
    duration: 30,
    config: presetConfig(id, extra),
  });
}

function ids(manual) {
  return manual.slots.map((slot) => slot.abilityId);
}

describe("manual fight slots (#348)", () => {
  it("lists Combat swords builders, finishers and cooldowns, with a racial when the race is set", () => {
    const swords = fight("combat-swords-temp");
    assert.deepEqual(ids(swords), [
      "sinister-strike",
      "shank",
      "slice-and-dice",
      "rupture",
      "eviscerate",
      "expose-armor",
      "blade-flurry",
      "adrenaline-rush",
    ]);
    const orc = fight("combat-swords-temp", { race: "orc" });
    assert.equal(ids(orc).at(-1), "blood-fury");
    swords.dispose();
    orc.dispose();
  });

  it("swaps Sinister Strike for Backstab on Combat daggers", () => {
    const daggers = fight("combat-daggers");
    assert.deepEqual(ids(daggers), [
      "sinister-strike",
      "backstab",
      "shank",
      "slice-and-dice",
      "rupture",
      "eviscerate",
      "expose-armor",
      "blade-flurry",
      "adrenaline-rush",
    ]);
    daggers.dispose();
  });

  it("lists Mutilate, the finishers, Cold Blood and Shank for Assassination", () => {
    const rogue = fight("assassination-daggers");
    assert.deepEqual(ids(rogue), [
      "sinister-strike",
      "backstab",
      "mutilate",
      "shank",
      "slice-and-dice",
      "rupture",
      "eviscerate",
      "expose-armor",
      "cold-blood",
    ]);
    const finisher = rogue.slots.find(
      (slot) => slot.abilityId === "eviscerate",
    );
    const strike = rogue.slots.find((slot) => slot.abilityId === "mutilate");
    const cold = rogue.slots.find((slot) => slot.abilityId === "cold-blood");
    assert.equal(finisher.isFinisher, true);
    assert.equal(strike.isFinisher, false);
    assert.equal(strike.onGcd, true);
    assert.equal(cold.onGcd, false);
    assert.equal(typeof strike.icon, "string");
    rogue.dispose();
  });

  it("shows Garrote and Ambush only when Ghostly Strike can open the window", () => {
    const without = fight("combat-swords-temp");
    assert.equal(ids(without).includes("garrote"), false);
    assert.equal(ids(without).includes("ambush"), false);
    without.dispose();
    const withStrike = fight("subtlety-daggers");
    assert.equal(ids(withStrike).includes("garrote"), true);
    assert.equal(ids(withStrike).includes("ambush"), true);
    withStrike.dispose();
  });
});

describe("manual fight block reasons (#348)", () => {
  it("uses Scout's strings and does not move the clock", () => {
    const manual = fight("combat-swords-temp");
    const before = manual.getState();
    const evis = manual.cast("eviscerate");
    assert.equal(evis.ok, false);
    assert.equal(evis.reason.text, "Needs combo points");
    assert.equal(blockedText(evis.reason), "Needs combo points");
    assert.equal(evis.advancedBy, 0);
    assert.deepEqual(evis.events, []);
    assert.deepEqual(manual.getState(), before);
    manual.dispose();
  });

  it("refuses each gate with its string and leaves the state", () => {
    const manual = fight("combat-swords-temp");
    const cases = [];
    const first = manual.cast("eviscerate");
    cases.push(["combo", first, "Needs combo points"]);
    const low = fight("combat-swords-temp");
    let hungry = null;
    for (let i = 0; i < 6 && hungry === null; i += 1) {
      const attempt = low.cast("sinister-strike");
      if (!attempt.ok && attempt.reason.code === "energy") {
        hungry = attempt;
      } else if (attempt.ok) {
        low.advanceTo(low.getState().time + low.getState().gcd.remaining);
      }
    }
    assert.ok(hungry);
    cases.push(["energy", hungry, "Not enough energy"]);
    const gcdFight = fight("combat-swords-temp");
    const opened = gcdFight.cast("sinister-strike");
    assert.equal(opened.ok, true);
    assert.equal(gcdFight.getState().gcd.remaining, 0);
    gcdFight.dispose();
    const rush = fight("combat-swords-temp");
    rush.cast("adrenaline-rush");
    rush.advanceTo(rush.getState().time + rush.getState().gcd.remaining);
    const again = rush.cast("adrenaline-rush");
    cases.push(["cooldown", again, null]);
    assert.equal(
      again.reason.text,
      `On cooldown, ${remainingTime(again.reason.seconds)} left`,
    );
    assert.match(again.reason.text, /^On cooldown, \d\d:\d\d\.\d left$/);
    const sword = fight("combat-swords-temp");
    const backstab = sword.cast("backstab");
    cases.push(["main", backstab, "Needs a dagger in the main hand"]);
    const off = createManualFight({
      seed: 1,
      duration: 30,
      config: presetConfig("assassination-daggers", {
        weapons: {
          ...referenceBuild("assassination-daggers").weapons,
          offHand: referenceBuild("combat-swords-temp").weapons.offHand,
        },
      }),
    });
    const mutilate = off.cast("mutilate");
    cases.push(["off", mutilate, "Needs daggers in both hands"]);
    const window = fight("subtlety-daggers");
    const ambush = window.cast("ambush");
    cases.push(["aura", ambush, "Needs Ambush window"]);
    const locked = fight("combat-swords-temp");
    const cold = locked.cast("cold-blood");
    cases.push(["build", cold, "Not granted by this build"]);
    const level = createManualFight({
      seed: 1,
      duration: 10,
      config: {
        ...presetConfig("combat-swords-temp"),
        talents: {},
        talentLevel: 10,
      },
    });
    const tooSoon = level.cast("adrenaline-rush");
    cases.push(["level", tooSoon, "Not available at this level"]);
    for (const [, outcome, text] of cases) {
      assert.equal(outcome.ok, false);
      assert.equal(outcome.advancedBy, 0);
      assert.deepEqual(outcome.events, []);
      if (text !== null) {
        assert.equal(outcome.reason.text, text);
      }
    }
    for (const item of [manual, low, rush, sword, off, window, locked, level]) {
      item.dispose();
    }
  });
});

describe("manual fight cast and wait (#348)", () => {
  it("advances an on-GCD cast to the end of the GCD (Q1)", () => {
    const manual = fight("combat-swords-temp");
    const cast = manual.cast("sinister-strike");
    assert.equal(cast.ok, true);
    assert.equal(cast.reason, null);
    assert.equal(cast.advancedBy, 0);
    const presented = manual.getState();
    assert.ok(presented.time > 0);
    assert.equal(presented.gcd.remaining, 0);
    assert.equal(presented.comboPoints.value, 1);
    assert.equal(
      cast.events.some(
        (event) => event.kind === "damage" || event.kind === "cast",
      ),
      true,
    );
    manual.dispose();
  });

  it("does not advance an off-GCD cast (Q1)", () => {
    const manual = fight("assassination-daggers");
    const before = manual.getState().time;
    const cold = manual.cast("cold-blood");
    assert.equal(cold.ok, true);
    assert.equal(cold.advancedBy, 0);
    assert.equal(manual.getState().time, before);
    assert.equal(manual.getState().gcd.remaining, 0);
    manual.dispose();
  });

  it("lands Cold Blood then Eviscerate as a crit once the GCD is clear", () => {
    const manual = fight("assassination-daggers");
    manual.cast("mutilate");
    const cold = manual.cast("cold-blood");
    assert.equal(cold.ok, true);
    const finisher = manual.cast("eviscerate");
    assert.equal(
      finisher.events.some(
        (event) => event.kind === "damage" && event.outcome === "crit",
      ),
      true,
    );
    const state = manual.getState();
    assert.equal(
      state.buffs.some((buff) => buff.id === "cold-blood"),
      false,
    );
    manual.dispose();
  });

  it("waits for 40 energy, the soonest cooldown, and 0.5 s", () => {
    const manual = fight("combat-swords-temp");
    const full = manual.wait({ kind: "energy" });
    assert.equal(full.ok, false);
    assert.equal(full.reason.text, "Already at 40+ energy");
    assert.equal(full.stopReason, null);
    assert.equal(full.advancedBy, 0);
    assert.equal(manual.getState().time, 0);
    const none = manual.wait({ kind: "cooldown" });
    assert.equal(none.reason.text, "Nothing on cooldown");
    assert.equal(none.stopReason, null);
    manual.cast("sinister-strike");
    manual.cast("sinister-strike");
    let hops = 0;
    while (hops < 40) {
      const value = manual.getState().energy.value;
      if (value >= 36 && value < 40) {
        break;
      }
      if (value >= 40) {
        if (!manual.cast("sinister-strike").ok) {
          break;
        }
      } else {
        manual.advanceTo(manual.getState().time + 0.2);
      }
      hops += 1;
    }
    const energy = manual.wait({ kind: "energy" });
    assert.equal(energy.ok, true);
    assert.equal(energy.reason, null);
    assert.equal(energy.stopReason.code, "target");
    assert.equal(energy.stopReason.text, "Reached the wait");
    assert.ok(Math.abs(manual.getState().energy.value - 40) < 1e-9);
    const before = manual.getState().time;
    const step = manual.wait({ kind: "time" });
    assert.equal(step.ok, true);
    assert.equal(step.reason, null);
    assert.equal(step.stopReason.code, "target");
    assert.equal(step.advancedBy, k("manualFight.waits").time);
    assert.equal(manual.getState().time - before, 0.5);
    manual.dispose();
    const cooledFight = createManualFight({
      seed: 1,
      duration: 400,
      config: presetConfig("combat-swords-temp"),
    });
    cooledFight.cast("adrenaline-rush");
    cooledFight.advanceTo(
      cooledFight.getState().time + cooledFight.getState().gcd.remaining,
    );
    const target = cooledFight.getState().waitCooldownTarget;
    assert.equal(target, "adrenaline-rush");
    assert.equal(cooledFight.getState().waits[1].abilityId, target);
    const ready = cooledFight.getState().waits[1].readyAt;
    const cooled = cooledFight.wait({ kind: "cooldown" });
    assert.equal(cooled.ok, true);
    assert.equal(cooled.reason, null);
    assert.equal(cooled.stopReason.code, "target");
    assert.ok(Math.abs(cooledFight.getState().time - ready) < 1e-9);
    cooledFight.dispose();
  });

  it("runs a wait that would pass the end, and then refuses further actions", () => {
    const manual = createManualFight({
      seed: 1,
      duration: 1,
      config: presetConfig("combat-swords-temp"),
    });
    manual.advanceTo(0.8);
    const wait = manual.wait({ kind: "time" });
    assert.equal(wait.ok, true);
    assert.equal(wait.reason, null);
    assert.equal(wait.stopReason.code, "fight-end");
    assert.equal(wait.stopReason.text, "Fight ended before the wait finished");
    assert.equal(manual.isOver(), true);
    assert.ok(Math.abs(manual.getState().time - 1) < 1e-9);
    const late = manual.cast("sinister-strike");
    assert.equal(late.reason.text, "The fight is over");
    const later = manual.wait({ kind: "time" });
    assert.equal(later.reason.text, "The fight is over");
    manual.dispose();
  });
});

describe("manual fight replay and the scripted hook (#348)", () => {
  it("repeats a fight from the same inputs and the same seed", () => {
    const play = (seed) => {
      const manual = createManualFight({
        seed,
        duration: 8,
        config: presetConfig("combat-swords-temp"),
      });
      manual.cast("sinister-strike");
      manual.cast("sinister-strike");
      manual.advanceTo(8);
      const result = manual.result();
      manual.dispose();
      return result;
    };
    const first = play(7);
    const second = play(7);
    assert.deepEqual(second, first);
    const replay = createManualFight({
      seed: 7,
      duration: 8,
      config: presetConfig("combat-swords-temp"),
    });
    const again = replay.replay();
    again.cast("sinister-strike");
    again.cast("sinister-strike");
    again.advanceTo(8);
    assert.deepEqual(again.result(), first);
    assert.notDeepEqual(play(8).totalDamage, first.totalDamage);
    replay.dispose();
    again.dispose();
  });

  it("does not let a poll cast, and a scripted run still casts", () => {
    const quiet = createFight(1, presetConfig("combat-swords-temp"), {
      duration: 5,
    });
    const core = openCore(quiet.simulation, 5, {
      pollEvery: 1,
      decide() {
        return { casts: [] };
      },
    });
    core.runUntil(4);
    assert.equal(quiet.simulation.abilityStats["sinister-strike"], undefined);
    core.close();
    const scripted = runFight({
      seed: 1,
      duration: 5,
      config: presetConfig("combat-swords-temp"),
    });
    assert.ok(scripted.totalDamage > 0);
  });
});

describe("manual fight event names and reason times (#348)", () => {
  it("keeps the hit's display name, including a white swing and a poison", () => {
    const manual = fight("combat-swords-temp");
    const strike = manual.cast("sinister-strike");
    const yellow = strike.events.find(
      (event) => event.kind === "damage" && event.source === "ability",
    );
    assert.equal(yellow.name, "Sinister Strike");
    const second = manual.cast("sinister-strike");
    assert.equal(second.ok, true);
    const finisher = manual.cast("slice-and-dice");
    assert.equal(finisher.ok, true);
    const sndCast = finisher.events.find((event) => event.kind === "cast");
    const sndAura = finisher.events.find(
      (event) => event.kind === "aura" && event.aura === "slice-and-dice",
    );
    assert.equal(sndCast.name, "Slice and Dice");
    assert.equal(sndAura.name, "Slice and Dice");
    const speed = referenceBuild("combat-swords-temp").weapons.mainHand.speed;
    let white = null;
    let poison = null;
    let stacks = null;
    for (
      let swing = 1;
      swing <= 40 && (white === null || poison === null || stacks === null);
      swing += 1
    ) {
      const step = manual.advanceTo(manual.getState().time + speed);
      white ??=
        step.events.find((event) => event.source === "white-mh") ?? null;
      poison ??= step.events.find((event) => event.source === "poison") ?? null;
      stacks ??=
        step.events.find(
          (event) =>
            event.kind === "aura" &&
            event.aura === "deadly-poison" &&
            (event.change === "stack" || event.change === "apply"),
        ) ?? null;
    }
    assert.equal(white.name, "Main-hand");
    assert.equal(poison.name.length > 0, true);
    assert.equal(
      manual.slots.some((slot) => slot.abilityId === poison.abilityId),
      false,
    );
    assert.equal(stacks.name, "Deadly Poison");
    for (const event of [sndCast, sndAura, stacks]) {
      assert.equal(typeof event.name, "string");
      assert.ok(event.name.length > 0);
    }
    manual.dispose();
  });

  it("floors a remaining time to tenths, and uses the clock from 60 s", () => {
    assert.equal(remainingTime(12.49), "12.4 s");
    assert.equal(remainingTime(12.4), "12.4 s");
    assert.equal(remainingTime(59.99), "59.9 s");
    assert.equal(remainingTime(60), "01:00.0");
    assert.equal(remainingTime(72.46), "01:12.4");
    assert.equal(remainingTime(0.09), "0.0 s");
  });

  it("breaks an equal cooldown by action-bar order", () => {
    const manual = fight("combat-swords-temp", { race: "gnome" });
    const idsOnBar = ids(manual);
    assert.ok(idsOnBar.indexOf("blade-flurry") < idsOnBar.indexOf("eureka"));
    manual.cast("eureka");
    manual.cast("blade-flurry");
    assert.equal(manual.getState().waitCooldownTarget, "blade-flurry");
    manual.dispose();
  });

  it("stops each wait early, and not for an ability that was already castable", () => {
    const energyFight = fight("combat-swords-temp");
    let blocked = null;
    while (blocked === null) {
      const attempt = energyFight.cast("sinister-strike");
      if (!attempt.ok) {
        blocked = attempt;
      }
    }
    const spent = energyFight.wait({ kind: "energy" });
    assert.equal(spent.reason, null);
    assert.equal(spent.stopReason.code, "early");
    assert.match(spent.stopReason.text, /^Stopped early: .+ is ready$/);
    energyFight.dispose();

    const cooled = fight("combat-swords-temp");
    while (cooled.cast("sinister-strike").ok) {
      // spend until Sinister Strike is short of energy
    }
    cooled.cast("adrenaline-rush");
    const rush = cooled.wait({ kind: "cooldown" });
    assert.equal(rush.reason, null);
    assert.equal(rush.stopReason.code, "early");
    assert.notEqual(rush.stopReason.abilityId, "adrenaline-rush");
    cooled.dispose();

    const timed = fight("combat-swords-temp");
    timed.cast("shank");
    const left = timed
      .getState()
      .slots.find((slot) => slot.abilityId === "shank").cooldownRemaining;
    timed.advanceTo(timed.getState().time + left - 0.2);
    const step = timed.wait({ kind: "time" });
    assert.equal(step.stopReason.code, "early");
    assert.equal(step.stopReason.abilityId, "shank");
    assert.equal(step.stopReason.text, "Stopped early: Shank is ready");
    timed.dispose();

    const quiet = fight("combat-swords-temp");
    const stepOnly = quiet.wait({ kind: "time" });
    assert.equal(stepOnly.stopReason.code, "target");
    assert.equal(stepOnly.advancedBy, 0.5);
    quiet.dispose();
  });

  it("reports the Wait's own target when the early stop is not strictly sooner", () => {
    assert.equal(waitStopCode(1, 1), "target");
    assert.equal(waitStopCode(1, 2), "early");
    assert.equal(k("manualFight.tie"), "target");

    const cooled = fight("combat-swords-temp");
    cooled.cast("shank");
    const ownTarget = cooled.wait({ kind: "cooldown" });
    assert.equal(ownTarget.stopReason.code, "target");
    assert.equal(cooled.getState().waitCooldownTarget, null);
    cooled.dispose();

    const timed = fight("combat-swords-temp");
    timed.cast("shank");
    const remaining = timed
      .getState()
      .slots.find((slot) => slot.abilityId === "shank").cooldownRemaining;
    timed.advanceTo(
      timed.getState().time + remaining - k("manualFight.waits").time,
    );
    const half = timed.wait({ kind: "time" });
    assert.equal(half.stopReason.code, "target");
    assert.equal(half.advancedBy, k("manualFight.waits").time);
    timed.dispose();

    const subtlety = fight("subtlety-daggers");
    let spins = 0;
    while (spins < 40) {
      const now = subtlety.getState().energy.value;
      if (now >= 35 && now < 40) {
        break;
      }
      if (now >= 40) {
        const strike = subtlety.cast("hemorrhage");
        if (!strike.ok) {
          subtlety.cast("backstab");
        }
      } else {
        subtlety.advanceTo(subtlety.getState().time + 0.5);
      }
      spins += 1;
    }
    const cost = subtlety
      .getState()
      .slots.find((slot) => slot.abilityId === "ghostly-strike").cost;
    assert.equal(cost, 40);
    assert.ok(subtlety.getState().energy.value >= 35);
    assert.ok(subtlety.getState().energy.value < 40);
    const energy = subtlety.wait({ kind: "energy" });
    assert.equal(energy.stopReason.code, "target");
    assert.ok(Math.abs(subtlety.getState().energy.value - 40) < 1e-6);
    subtlety.dispose();
  });
});

describe("manual fight off-GCD window (#348)", () => {
  it("allows an off-GCD cast at the same instant as the on-GCD cast", () => {
    const manual = fight("subtlety-daggers");
    const preparation = manual.cast("preparation");
    assert.equal(preparation.ok, true);
    assert.equal(preparation.advancedBy, 0);
    const premeditation = manual.cast("premeditation");
    assert.equal(premeditation.ok, true);
    assert.equal(premeditation.reason, null);
    assert.equal(premeditation.advancedBy, 0);
    assert.equal(manual.getState().time > 0, true);
    assert.ok(manual.getState().comboPoints.value >= 2);
    manual.dispose();
  });

  it("refuses an off-GCD cast later inside that GCD", () => {
    const open = () => {
      const manual = fight("subtlety-daggers");
      assert.equal(manual.cast("preparation").ok, true);
      manual.advanceTo(0.2);
      return manual;
    };
    const late = open();
    const clean = open();
    const refused = late.cast("premeditation");
    assert.equal(refused.ok, false);
    assert.equal(refused.reason.code, "gcd");
    assert.equal(
      refused.reason.text,
      `GCD, ${remainingTime(refused.reason.seconds)} left`,
    );
    assert.ok(refused.reason.seconds > 0.5);
    assert.ok(refused.reason.seconds < 1);
    assert.equal(refused.advancedBy, 0);
    assert.deepEqual(refused.events, []);
    assert.deepEqual(late.getState(), clean.getState());
    late.advanceTo(31);
    const inputs = late.result().manual.inputs;
    assert.deepEqual(
      inputs.filter((input) => input.abilityId === "premeditation"),
      [],
    );
    clean.getState();
    assert.equal(clean.cast("premeditation").ok, true);
    late.dispose();
    const again = open();
    again.getState();
    assert.equal(again.cast("premeditation").ok, true);
    again.advanceTo(31);
    clean.advanceTo(31);
    assert.equal(again.result().totalDamage, clean.result().totalDamage);
    assert.deepEqual(again.result().abilities, clean.result().abilities);
    clean.dispose();
    again.dispose();
  });

  it("allows an off-GCD cast once that GCD has ended", () => {
    const manual = fight("subtlety-daggers");
    assert.equal(manual.cast("preparation").ok, true);
    const moved = manual.advanceTo(k("gcd.duration"));
    assert.equal(moved.ok, true);
    const premeditation = manual.cast("premeditation");
    assert.equal(premeditation.ok, true);
    assert.equal(premeditation.reason, null);
    manual.dispose();
  });
});

describe("manual fight peekState (#370)", () => {
  it("reads the post-cast instant without running out the GCD", () => {
    const manual = fight("combat-swords-temp");
    const before = manual.peekState();
    const cast = manual.cast("sinister-strike");
    assert.equal(cast.ok, true);
    const peek = manual.peekState();
    assert.equal(peek.time, before.time);
    assert.ok(peek.energy.value < before.energy.value);
    assert.equal(peek.comboPoints.value, before.comboPoints.value + 1);
    assert.equal(peek.gcd.remaining > 0, true);
    const struck = manual.getState();
    assert.ok(struck.time > peek.time);
    manual.cast("slice-and-dice");
    const finisher = manual.peekState();
    assert.equal(finisher.time, struck.time);
    assert.equal(
      finisher.buffs.some((buff) => buff.id === "slice-and-dice"),
      true,
    );
    assert.ok(finisher.energy.value < struck.energy.value);
    assert.equal(finisher.comboPoints.value, struck.comboPoints.value);
    manual.dispose();
  });

  it("casts Premeditation, Preparation and Premeditation at t=0", () => {
    const play = () => {
      const manual = fight("subtlety-daggers");
      assert.equal(manual.cast("premeditation").ok, true);
      assert.equal(manual.cast("preparation").ok, true);
      assert.equal(manual.cast("premeditation").ok, true);
      assert.equal(manual.peekState().time, 0);
      manual.advanceTo(30);
      return manual.result();
    };
    const first = play();
    const again = fight("subtlety-daggers");
    again.cast("premeditation");
    again.cast("preparation");
    again.cast("premeditation");
    const replay = again.replay();
    replay.cast("premeditation");
    replay.cast("preparation");
    replay.cast("premeditation");
    replay.advanceTo(30);
    again.advanceTo(30);
    assert.deepEqual(replay.result(), again.result());
    assert.equal(again.result().totalDamage, first.totalDamage);
    again.dispose();
    replay.dispose();
  });

  it("does not move the clock, the result or the scripted fight", () => {
    const config = presetConfig("combat-swords-temp");
    const scripted = runFight({ seed: 1, duration: 20, config });
    const withPeeks = fight("assassination-daggers");
    const plain = fight("assassination-daggers");
    const firstPeek = withPeeks.peekState();
    assert.deepEqual(withPeeks.peekState(), firstPeek);
    assert.equal(withPeeks.cast("mutilate").ok, true);
    const held = withPeeks.peekState();
    assert.deepEqual(withPeeks.peekState(), held);
    assert.equal(plain.cast("mutilate").ok, true);
    withPeeks.getState();
    plain.getState();
    assert.equal(withPeeks.cast("cold-blood").ok, true);
    assert.equal(plain.cast("cold-blood").ok, true);
    withPeeks.advanceTo(30);
    plain.advanceTo(30);
    assert.equal(withPeeks.result().totalDamage, plain.result().totalDamage);
    assert.deepEqual(withPeeks.result().abilities, plain.result().abilities);
    withPeeks.dispose();
    plain.dispose();
    const again = runFight({ seed: 1, duration: 20, config });
    assert.equal(again.totalDamage, scripted.totalDamage);
    assert.equal(again.seed, scripted.seed);
    assert.deepEqual(again.abilities, scripted.abilities);
  });

  it("marks off-GCD castable at the cast instant and refused later in the GCD", () => {
    const manual = fight("assassination-daggers");
    assert.equal(manual.cast("mutilate").ok, true);
    const instant = manual.peekState();
    const cold = instant.slots.find((slot) => slot.abilityId === "cold-blood");
    const mutilate = instant.slots.find(
      (slot) => slot.abilityId === "mutilate",
    );
    assert.equal(cold.castable, true);
    assert.equal(cold.reason, null);
    assert.equal(mutilate.castable, false);
    assert.equal(mutilate.reason.code, "gcd");
    manual.advanceTo(0.2);
    const later = manual.peekState();
    assert.equal(later.time, 0.2);
    const coldLater = later.slots.find(
      (slot) => slot.abilityId === "cold-blood",
    );
    assert.equal(coldLater.castable, false);
    assert.equal(coldLater.reason.code, "gcd");
    assert.equal(
      coldLater.reason.text,
      `GCD, ${remainingTime(coldLater.reason.seconds)} left`,
    );
    manual.dispose();
  });
});

describe("manual fight parity with runFight (#348)", () => {
  const presets = [
    "combat-swords-temp",
    "combat-daggers",
    "assassination-daggers",
    "subtlety-daggers",
  ];
  const seeds = [1, 2, 7, 42];
  const durations = [20, 45, 90];

  for (const id of presets) {
    for (const seed of seeds) {
      for (const duration of durations) {
        it(`replays ${id} seed ${seed} for ${duration}s`, () => {
          const config = presetConfig(id);
          const casts = [];
          const scriptedFight = createFight(seed, config, { duration });
          scriptedFight.simulation.on("*", (event) => {
            if (event.type === "cast") {
              casts.push({ time: event.time, ability: event.ability });
            }
          });
          scriptedFight.simulation.run(duration);
          const scripted = fightResult(scriptedFight);
          const manual = createManualFight({ seed, duration, config });
          let time = 0;
          for (const cast of casts) {
            if (cast.time > time) {
              const moved = manual.advanceTo(cast.time);
              assert.equal(moved.ok, true, `${cast.ability} advance`);
              time += moved.advancedBy;
            }
            const acted = manual.cast(cast.ability);
            assert.equal(
              acted.ok,
              true,
              `${cast.ability} at ${cast.time}s (${time}s): ${acted.reason?.text ?? ""}`,
            );
            time += acted.advancedBy;
          }
          if (!manual.isOver()) {
            manual.advanceTo(duration);
          }
          const replayed = manual.result();
          assert.equal(replayed.totalDamage, scripted.totalDamage);
          assert.deepEqual(replayed.abilities, scripted.abilities);
        });
      }
    }
  }
});
