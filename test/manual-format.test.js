import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  elapsedClock,
  durationClock,
  headerClock,
  headerClockSpoken,
  mockHealthFill,
  waitLabel,
  glyphFor,
  isAbilityOrAutoHit,
  landedHits,
  isLargeHit,
  latestWellEvent,
  wellCopy,
  floatCopy,
  tenthsLabel,
  ENERGY_WAIT_TARGET,
  TIME_WAIT_SECONDS,
  HIT_SAMPLE,
  LARGE_HIT_RATIO,
} from "../js/views/manual-format.js";

describe("Manual board formatters (#348)", () => {
  it("formats the header clock like logRowReading tenths and clock()", () => {
    assert.equal(elapsedClock(0), "00:00.0");
    assert.equal(elapsedClock(42.19), "00:42.1");
    assert.equal(elapsedClock(72.4), "01:12.4");
    assert.equal(durationClock(300), "05:00");
    assert.equal(durationClock(300.5), "05:00.5");
    assert.equal(headerClock(42.1, 300), "00:42.1 / 05:00");
    assert.equal(
      headerClockSpoken(42.1, 300),
      "Elapsed 42.1 seconds of 5 minutes.",
    );
  });

  it("fills mock health from elapsed / duration, with no damage input", () => {
    assert.equal(mockHealthFill(0, 300), 1);
    assert.equal(mockHealthFill(150, 300), 0.5);
    assert.equal(mockHealthFill(300, 300), 0);
    assert.equal(mockHealthFill(400, 300), 0);
  });

  it("builds Wait button copy from getState waits and remaining cooldown", () => {
    const slots = [{ abilityId: "adrenaline-rush", name: "Adrenaline Rush" }];
    assert.equal(
      waitLabel(
        { kind: "energy", available: true, target: ENERGY_WAIT_TARGET },
        slots,
        0,
      ),
      "Wait to 40 energy",
    );
    assert.equal(
      waitLabel(
        { kind: "time", available: true, seconds: TIME_WAIT_SECONDS },
        slots,
        0,
      ),
      "Wait 0.5 s",
    );
    assert.equal(
      waitLabel(
        {
          kind: "cooldown",
          available: false,
          abilityId: null,
          reason: { text: "Nothing on cooldown" },
        },
        slots,
        10,
      ),
      "Wait until a cooldown is ready",
    );
    assert.equal(
      waitLabel(
        {
          kind: "cooldown",
          available: true,
          abilityId: "adrenaline-rush",
          readyAt: 22.5,
        },
        slots,
        10,
      ),
      "Wait until Adrenaline Rush ready (12.5 s)",
    );
    assert.equal(tenthsLabel(12.49), "12.4");
    assert.equal(
      waitLabel(
        {
          kind: "cooldown",
          available: true,
          abilityId: "adrenaline-rush",
          readyAt: 112.3,
        },
        slots,
        10,
      ),
      "Wait until Adrenaline Rush ready (01:42.3)",
    );
  });

  it("uses Fu for Blood Fury, not BF", () => {
    assert.equal(glyphFor("blood-fury", "Blood Fury"), "Fu");
    assert.equal(glyphFor("blade-flurry", "Blade Flurry"), "BF");
    assert.equal(glyphFor("shank", "Shank"), "Sk");
  });

  it("computes a large hit from 1.5× the mean after five landed ability or auto hits", () => {
    const hits = [100, 100, 100, 100, 200].map((amount, i) => ({
      kind: "damage",
      source: "ability",
      outcome: "hit",
      amount,
      t: i,
      abilityId: "sinister-strike",
      name: "Sinister Strike",
    }));
    assert.equal(landedHits(hits).length, HIT_SAMPLE);
    const mean = 600 / HIT_SAMPLE;
    assert.ok(200 >= LARGE_HIT_RATIO * mean);
    assert.equal(isLargeHit(hits[4], hits), true);
    assert.equal(isLargeHit(hits[0], hits.slice(0, 1)), false);
    const crit = { ...hits[0], outcome: "crit", amount: 10 };
    assert.equal(isLargeHit(crit, [crit]), true);
    const tick = {
      kind: "tick",
      source: "ability",
      outcome: "hit",
      amount: 400,
    };
    assert.equal(isAbilityOrAutoHit(tick), false);
    const poison = {
      kind: "damage",
      source: "poison",
      outcome: "hit",
      amount: 400,
    };
    assert.equal(isAbilityOrAutoHit(poison), false);
    const miss = {
      kind: "damage",
      source: "ability",
      outcome: "miss",
      amount: 0,
    };
    assert.equal(isAbilityOrAutoHit(miss), false);
  });

  it("builds well and float copy from event fields, including procName", () => {
    const hit = {
      kind: "damage",
      source: "ability",
      outcome: "hit",
      amount: 184,
      name: "Sinister Strike",
    };
    assert.equal(wellCopy(hit), "Sinister Strike hit 184");
    assert.deepEqual(floatCopy(hit, [hit]), { text: "184", tone: "hit" });
    const crit = { ...hit, outcome: "crit", amount: 1234 };
    assert.equal(wellCopy(crit), "CRIT 1,234 · Sinister Strike");
    assert.deepEqual(floatCopy(crit, [crit]), { text: "1,234!", tone: "crit" });
    const hs = {
      kind: "damage",
      source: "white-mh",
      outcome: "hit",
      amount: 184,
      name: "Main-hand",
      procName: "Hack and Slash",
    };
    assert.equal(wellCopy(hs), "Hack and Slash · extra attack 184");
    assert.equal(floatCopy(hs, [hs]).text, "Hack and Slash!");
    const pw = { kind: "proc", procName: "Puncturing Wounds" };
    assert.equal(wellCopy(pw), "Puncturing Wounds · +1 combo point");
    const blocked = {
      kind: "blocked",
      name: "Eviscerate",
      reason: "Needs combo points",
    };
    assert.equal(
      wellCopy(blocked),
      "Blocked · Eviscerate — Needs combo points.",
    );
    const miss = {
      kind: "damage",
      source: "ability",
      outcome: "miss",
      amount: 0,
      name: "Sinister Strike",
    };
    assert.equal(wellCopy(miss), "Sinister Strike miss");
    assert.equal(floatCopy(miss, []), null);
    const resist = { ...miss, resisted: true };
    assert.equal(wellCopy(resist), "Sinister Strike Resist");
  });

  it("picks the last well-visible event, skipping trailing resource bookkeeping", () => {
    const hit = {
      kind: "damage",
      source: "ability",
      outcome: "hit",
      amount: 184,
      name: "Sinister Strike",
    };
    const apply = {
      kind: "damage",
      source: "poison",
      outcome: "hit",
      amount: 0,
      name: "Instant Poison",
    };
    const events = [
      { kind: "cast", abilityId: "sinister-strike", name: "Sinister Strike" },
      { kind: "energy", amount: -45 },
      hit,
      { kind: "cp", amount: 1 },
      apply,
    ];
    assert.equal(latestWellEvent(events), hit);
    assert.equal(wellCopy(apply), null);
  });
});
