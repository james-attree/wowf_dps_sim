// Manual fight B1 (#348). The scripted path is not involved.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { openCore } from "../js/core/fight.js";
import { createFight, runFight } from "../js/fight.js";
import { blockedText, createManualFight } from "../js/manual-fight.js";
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
    const gcd = fight("combat-swords-temp");
    gcd.cast("sinister-strike");
    const during = gcd.cast("sinister-strike");
    cases.push(["gcd", during, null]);
    assert.equal(
      during.reason.text,
      `GCD, ${remainingTime(during.reason.seconds)} left`,
    );
    assert.ok(during.reason.seconds > 0);
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
    for (const item of [
      manual,
      low,
      gcd,
      rush,
      sword,
      off,
      window,
      locked,
      level,
    ]) {
      item.dispose();
    }
  });
});

describe("manual fight cast and wait (#348)", () => {
  it("casts Sinister Strike at the current time and does not step past it (Q1 open)", () => {
    const manual = fight("combat-swords-temp");
    const cast = manual.cast("sinister-strike");
    assert.equal(cast.ok, true);
    assert.equal(cast.reason, null);
    assert.equal(cast.advancedBy, 0);
    assert.equal(manual.getState().time, 0);
    assert.ok(manual.getState().gcd.remaining > 0);
    assert.equal(manual.getState().comboPoints.value, 1);
    assert.equal(
      cast.events.some(
        (event) => event.kind === "damage" || event.kind === "cast",
      ),
      true,
    );
    manual.dispose();
  });

  it("lands Cold Blood then Eviscerate as a crit once the GCD is clear", () => {
    const manual = fight("assassination-daggers");
    manual.cast("mutilate");
    manual.advanceTo(manual.getState().gcd.remaining);
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
    manual.advanceTo(manual.getState().gcd.remaining);
    manual.cast("sinister-strike");
    manual.advanceTo(manual.getState().gcd.remaining);
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
      manual.advanceTo(
        manual.getState().gcd.remaining + manual.getState().time,
      );
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
    again.advanceTo(again.getState().gcd.remaining + again.getState().time);
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

  it("matches a scripted fight when the same casts are made at the same times", () => {
    const config = presetConfig("combat-swords-temp");
    const casts = [];
    const watched = createFight(142, config, { duration: 60 });
    watched.simulation.on("cast", (event) => {
      casts.push({ time: event.time, ability: event.ability });
    });
    watched.simulation.run(60);
    const manual = createManualFight({ seed: 142, duration: 60, config });
    let time = 0;
    for (const cast of casts) {
      if (cast.time > time) {
        manual.advanceTo(cast.time);
        time = cast.time;
      }
      const outcome = manual.cast(cast.ability);
      assert.equal(outcome.ok, true, `${cast.ability} at ${cast.time}`);
    }
    manual.advanceTo(60);
    const scripted = runFight({ seed: 142, duration: 60, config });
    const { manual: played, ...rest } = manual.result();
    assert.ok(played.inputs.length > 0);
    assert.deepEqual(rest, scripted);
    manual.dispose();
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
    const speed = referenceBuild("combat-swords-temp").weapons.mainHand.speed;
    let white = null;
    let poison = null;
    for (
      let swing = 1;
      swing <= 30 && (white === null || poison === null);
      swing += 1
    ) {
      const step = manual.advanceTo(speed * swing);
      white ??=
        step.events.find((event) => event.source === "white-mh") ?? null;
      poison ??= step.events.find((event) => event.source === "poison") ?? null;
    }
    assert.equal(white.name, "Main-hand");
    assert.equal(typeof poison.name, "string");
    assert.equal(poison.name.length > 0, true);
    assert.equal(
      manual.slots.some((slot) => slot.abilityId === poison.abilityId),
      false,
    );
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

  it("stops a wait early when another ability becomes castable", () => {
    const manual = fight("combat-swords-temp");
    manual.cast("adrenaline-rush");
    const gcd = manual.getState().gcd.remaining;
    const wait = manual.wait({ kind: "cooldown" });
    assert.equal(wait.ok, true);
    assert.equal(wait.reason, null);
    assert.equal(wait.stopReason.code, "early");
    assert.equal(wait.stopReason.abilityId, "sinister-strike");
    assert.equal(
      wait.stopReason.text,
      "Stopped early: Sinister Strike is ready",
    );
    assert.ok(Math.abs(manual.getState().time - gcd) < 1e-9);
    assert.equal(manual.isOver(), false);
    manual.dispose();
  });
});
