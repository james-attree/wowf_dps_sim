// Host for Manual fight mode (#348): applies Saoirse's engine module and
// never invents combat.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createManualRun } from "../js/manual-run.js";
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
  it("names damage events from slot names and does not move the clock on a blocked finisher", () => {
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
    assert.equal(page.get().manual.state.time, 0);
    assert.ok(page.get().manual.state.gcd.remaining > 0);
    const named = page
      .get()
      .manual.events.find(
        (event) => event.kind === "damage" && event.source === "ability",
      );
    assert.ok(named);
    assert.equal(named.name, "Sinister Strike");
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
});
