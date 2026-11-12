// Host for Manual fight mode (#348): applies Saoirse's engine module and
// never invents combat.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createManualRun } from "../js/manual-run.js";
import { loadPreset, referenceBuild } from "../js/rotation-presets.js";
import {
  mockHealthFill,
  wellLine,
  announceLine,
} from "../js/views/manual-format.js";

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

function store() {
  let state = {
    run: { state: "idle", shown: false, stoppedAt: null },
    manual: null,
  };
  return {
    get: () => state,
    update(patcher) {
      state = { ...state, ...patcher(state) };
    },
  };
}

describe("manual fight host (#348)", () => {
  it("uses engine event names and does not move the clock on a blocked finisher", () => {
    const page = store();
    const host = createManualRun(page);
    host.start({
      seed: 1,
      duration: 30,
      config: presetConfig("combat-swords-temp"),
    });
    const blocked = host.cast("eviscerate");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason.code, "combo-points");
    assert.equal(page.get().manual.phase, "blocked");
    assert.equal(page.get().manual.state.time, 0);
    const hit = host.cast("sinister-strike");
    assert.equal(hit.ok, true);
    const named = page
      .get()
      .manual.events.find(
        (event) => event.kind === "damage" && event.source === "ability",
      );
    assert.ok(named);
    assert.equal(named.name, "Sinister Strike");
    host.reset();
  });

  it("presents the GCD end after an on-GCD cast, and the board follows", () => {
    const page = store();
    const host = createManualRun(page);
    host.start({
      seed: 1,
      duration: 30,
      config: presetConfig("combat-swords-temp"),
    });
    const before = page.get().manual.state.time;
    const fillBefore = mockHealthFill(before, 30);
    const hit = host.cast("sinister-strike");
    assert.equal(hit.ok, true);
    assert.equal(hit.advancedBy, 0);
    const state = page.get().manual.state;
    assert.ok(state.time > before);
    assert.equal(state.gcd.remaining, 0);
    assert.ok(mockHealthFill(state.time, state.duration) < fillBefore);
    const ss = state.slots.find((slot) => slot.abilityId === "sinister-strike");
    assert.equal(ss.castable, true);
    assert.equal(ss.reason, null);
    host.reset();
  });

  it("renders the engine's Already at 40+ energy text and leaves a refused wait's clock alone", () => {
    const page = store();
    const host = createManualRun(page);
    host.start({
      seed: 1,
      duration: 30,
      config: presetConfig("combat-swords-temp"),
    });
    const refused = host.wait({ kind: "energy" });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason.code, "energy-full");
    assert.equal(refused.reason.text, "Already at 40+ energy");
    assert.equal(refused.stopReason, null);
    assert.equal(page.get().manual.state.time, 0);
    const energy = page
      .get()
      .manual.state.waits.find((wait) => wait.kind === "energy");
    assert.equal(energy.reason.text, "Already at 40+ energy");
    host.reset();
  });

  it("publishes an early wait stop and a fight-end stop for the well and live region", () => {
    const page = store();
    const host = createManualRun(page);
    host.start({
      seed: 1,
      duration: 30,
      config: presetConfig("combat-swords-temp"),
    });
    let blocked = null;
    while (blocked === null) {
      const attempt = host.cast("sinister-strike");
      if (!attempt.ok) {
        blocked = attempt;
      }
    }
    const early = host.wait({ kind: "energy" });
    assert.equal(early.ok, true);
    assert.equal(early.reason, null);
    assert.equal(early.stopReason.code, "early");
    assert.match(early.stopReason.text, /^Stopped early: .+ is ready$/);
    assert.equal(page.get().manual.lastAction.stopReason, early.stopReason);
    assert.equal(wellLine(page.get().manual).event, early.stopReason.text);
    assert.equal(announceLine(page.get().manual), early.stopReason.text);
    host.reset();

    host.start({
      seed: 7,
      duration: 1,
      config: presetConfig("combat-swords-temp"),
    });
    assert.equal(host.wait({ kind: "time" }).ok, true);
    const ended = host.wait({ kind: "time" });
    assert.equal(ended.ok, true);
    assert.equal(ended.reason, null);
    assert.equal(ended.stopReason.code, "fight-end");
    assert.equal(ended.stopReason.text, "Fight ended before the wait finished");
    assert.equal(page.get().manual.phase, "review");
    assert.equal(
      wellLine(page.get().manual).event,
      "Fight ended before the wait finished",
    );
    assert.match(
      announceLine(page.get().manual),
      /Fight ended before the wait finished/,
    );
    host.reset();
  });

  it("replays the same seed from t = 0 and a 0.5 s wait can end a 1 s fight", () => {
    const page = store();
    const host = createManualRun(page);
    const config = presetConfig("combat-swords-temp");
    host.start({ seed: 7, duration: 1, config });
    assert.equal(host.wait({ kind: "time" }).ok, true);
    assert.equal(page.get().manual.state.time, 0.5);
    assert.equal(page.get().manual.phase !== "review", true);
    const ended = host.wait({ kind: "time" });
    assert.equal(ended.ok, true);
    assert.equal(page.get().manual.phase, "review");
    assert.ok(page.get().manual.result);
    host.replay();
    assert.equal(page.get().manual.phase, "decision");
    assert.equal(page.get().manual.state.seed, 7);
    assert.equal(page.get().manual.state.time, 0);
    assert.equal(page.get().manual.events.length, 0);
    host.reset();
  });

  it("replays the start snapshot after the form's duration and character change", () => {
    const page = store();
    const host = createManualRun(page);
    const swords = presetConfig("combat-swords-temp");
    const daggers = presetConfig("assassination-daggers");
    host.start({ seed: 7, duration: 1, config: swords });
    const slots = page.get().manual.slots.map((slot) => slot.abilityId);
    assert.equal(host.wait({ kind: "time" }).ok, true);
    assert.equal(host.wait({ kind: "time" }).ok, true);
    assert.equal(page.get().manual.phase, "review");
    const finished = page.get().manual.result;
    assert.ok(finished);
    page.update((current) => ({
      run: { ...current.run, duration: 30, seed: 99 },
      config: daggers,
    }));
    host.replay();
    const again = page.get().manual;
    assert.equal(again.phase, "decision");
    assert.equal(again.state.seed, 7);
    assert.equal(again.state.duration, 1);
    assert.equal(again.snapshot.seed, 7);
    assert.equal(again.snapshot.duration, 1);
    assert.deepEqual(
      again.slots.map((slot) => slot.abilityId),
      slots,
    );
    assert.deepEqual(again.snapshot.config.weapons, swords.weapons);
    assert.deepEqual(again.snapshot.config.talents, swords.talents);
    assert.notDeepEqual(again.snapshot.config.weapons, daggers.weapons);
    assert.equal(host.wait({ kind: "time" }).ok, true);
    assert.equal(host.wait({ kind: "time" }).ok, true);
    assert.equal(page.get().manual.phase, "review");
    assert.deepEqual(page.get().manual.result, finished);
    host.reset();
  });

  it("tags Instant Poison hits that arrive without source poison", () => {
    const page = store();
    const host = createManualRun(page);
    host.start({
      seed: 1,
      duration: 30,
      config: presetConfig("combat-swords-temp"),
    });
    assert.equal(host.cast("sinister-strike").ok, true);
    const tagged = page
      .get()
      .manual.events.filter((event) => event.poisonProc === true);
    for (const event of tagged) {
      assert.notEqual(event.source, "poison");
      const label = event.procName ?? event.name;
      assert.match(label, /Poison/);
    }
    const named = page
      .get()
      .manual.events.filter(
        (event) =>
          event.procName === "Instant Poison" && event.source !== "poison",
      );
    for (const event of named) {
      assert.equal(event.poisonProc, true);
    }
    host.reset();
  });
});
