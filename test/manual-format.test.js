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
  floatCopies,
  wellLine,
  announceLine,
  gcdHeldReason,
  gcdHeldSeconds,
  CONTINUE_KEY,
  CONTINUE_LABEL,
  CONTINUE_WAIT_REASON,
  USED_THIS_INSTANT_REASON,
  wellIsCrit,
  slotAccessibleName,
  slotIconSrc,
  auraIconSrc,
  disabledWaitReason,
  reviewBreakdownRows,
  reviewTimingRows,
  ENERGY_WAIT_TARGET,
  TIME_WAIT_SECONDS,
  HIT_SAMPLE,
  LARGE_HIT_RATIO,
  FLOAT_LIMIT,
  EMPTY_TRAY_MIN_REM,
  EMPTY_TRAY_MAX_REM,
} from "../js/views/manual-format.js";
import { iconUrl, spellIconUrl } from "../js/icons.js";

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
    assert.equal(
      waitLabel(
        {
          kind: "cooldown",
          available: true,
          abilityId: "adrenaline-rush",
          readyAt: 22.49,
        },
        slots,
        10,
      ),
      "Wait until Adrenaline Rush ready (12.4 s)",
    );
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
    assert.deepEqual(floatCopies(hs, [hs]), [
      { text: "Hack and Slash!", tone: "proc" },
      { text: "184", tone: "hit" },
    ]);
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

  it("shows the engine stopReason in the well and the live region", () => {
    const early = {
      phase: "decision",
      lastAction: {
        ok: true,
        reason: null,
        stopReason: {
          code: "early",
          text: "Stopped early: Shank is ready",
          abilityId: "shank",
        },
      },
      events: [],
    };
    assert.equal(wellLine(early).event, "Stopped early: Shank is ready");
    assert.equal(announceLine(early), "Stopped early: Shank is ready");
    const ended = {
      phase: "review",
      lastAction: {
        ok: true,
        reason: null,
        stopReason: {
          code: "fight-end",
          text: "Fight ended before the wait finished",
        },
      },
      result: { dps: 12.3 },
      events: [],
    };
    assert.equal(wellLine(ended).event, "Fight ended before the wait finished");
    assert.match(announceLine(ended), /Fight ended before the wait finished/);
    const refused = {
      phase: "blocked",
      blockedAbilityId: "eviscerate",
      slots: [{ abilityId: "eviscerate", name: "Eviscerate" }],
      lastAction: {
        ok: false,
        reason: { code: "energy-full", text: "Already at 40+ energy" },
        stopReason: null,
      },
    };
    assert.equal(
      wellLine({
        phase: "decision",
        lastAction: {
          ok: false,
          reason: { code: "energy-full", text: "Already at 40+ energy" },
          stopReason: null,
        },
        events: [],
      }).event,
      "",
    );
    assert.equal(
      wellLine({
        ...refused,
        lastAction: {
          ok: false,
          reason: { code: "combo-points", text: "Needs combo points" },
          stopReason: null,
        },
      }).prompt,
      "Blocked · Eviscerate — Needs combo points.",
    );
  });

  it("fills Review breakdown from abilities and timing from the log", () => {
    const result = {
      duration: 5,
      dps: 100,
      abilities: {
        "Sinister Strike": { damage: 400, casts: 2 },
        "Main-hand": { damage: 100, casts: 1 },
      },
      log: [
        { time: 1, name: "Sinister Strike" },
        { time: 0, name: "Main-hand" },
      ],
    };
    const breakdown = reviewBreakdownRows(result);
    assert.equal(breakdown[0].name, "Sinister Strike");
    assert.equal(breakdown[0].text, "Sinister Strike · 400 · 80.0 DPS");
    assert.equal(breakdown[1].name, "Main-hand");
    const timing = reviewTimingRows(result);
    assert.deepEqual(
      timing.map((row) => row.text),
      ["00:00.0 Main-hand", "00:01.0 Sinister Strike"],
    );
  });

  it("announces a disabled Wait reason without entering Blocked", () => {
    const wait = {
      kind: "energy",
      available: false,
      reason: { code: "energy-full", text: "Already at 40+ energy" },
    };
    assert.equal(disabledWaitReason(wait), "Already at 40+ energy");
    assert.equal(disabledWaitReason({ kind: "time", available: true }), null);
    assert.equal(
      wellLine({
        phase: "decision",
        lastAction: null,
        events: [],
      }).prompt,
      "Your decision · GCD free",
    );
    assert.doesNotMatch(
      wellLine({
        phase: "decision",
        lastAction: null,
        events: [],
      }).prompt,
      /Blocked/,
    );
  });

  it("includes the visible keybind in the slot accessible name", () => {
    assert.equal(
      slotAccessibleName("1", "Sinister Strike"),
      "1 Sinister Strike",
    );
    assert.equal(
      slotAccessibleName("5", "Eviscerate", "Needs combo points"),
      "5 Eviscerate Needs combo points",
    );
  });

  it("marks the well as a crit only for a crit event line", () => {
    const crit = {
      kind: "damage",
      source: "ability",
      outcome: "crit",
      amount: 521,
      name: "Sinister Strike",
    };
    const hit = { ...crit, outcome: "hit", amount: 184 };
    assert.equal(wellIsCrit({ phase: "crit", events: [crit] }), true);
    assert.equal(wellIsCrit({ phase: "decision", events: [hit] }), false);
    assert.equal(
      wellIsCrit({
        phase: "blocked",
        lastAction: { reason: { text: "Needs combo points" } },
        events: [crit],
      }),
      false,
    );
  });

  it("resolves slot and aura icons through iconUrl, not a local path", () => {
    const key = "ability_rogue_sinsterstrike";
    const slot = {
      iconKey: key,
      icon: "img/sinister-strike.jpg",
    };
    assert.equal(slotIconSrc(slot), iconUrl(key));
    assert.notEqual(slotIconSrc(slot), slot.icon);
    const local = {
      name: "Blade Flurry",
      icon: "img/blade-flurry.jpg",
    };
    assert.equal(auraIconSrc(local), spellIconUrl("Blade Flurry"));
    assert.notEqual(auraIconSrc(local), local.icon);
    const raw = { icon: "ability_warrior_punishingblow", name: "Blade Flurry" };
    assert.equal(auraIconSrc(raw), iconUrl("ability_warrior_punishingblow"));
  });

  it("uses the poison well template for a tagged Instant Poison hit", () => {
    const poison = {
      kind: "damage",
      source: "white-oh",
      outcome: "crit",
      amount: 247,
      name: "Off-hand",
      procName: "Instant Poison",
      poisonProc: true,
    };
    assert.equal(wellCopy(poison), "Instant Poison · CRIT 247");
    assert.deepEqual(floatCopies(poison, [poison]), [
      { text: "Instant Poison!", tone: "proc" },
      { text: "247!", tone: "crit" },
    ]);
    const zero = { ...poison, amount: 0, outcome: "hit" };
    assert.equal(wellCopy(zero), null);
    assert.deepEqual(floatCopies(zero, [zero]), []);
  });

  it("caps stacked float copies at three and keeps a name and damage pair", () => {
    const a = {
      kind: "damage",
      source: "ability",
      outcome: "hit",
      amount: 10,
      name: "Sinister Strike",
    };
    const proc = {
      kind: "damage",
      source: "white-mh",
      outcome: "hit",
      amount: 80,
      name: "Main-hand",
      procName: "Hack and Slash",
    };
    const shown = [...floatCopies(a, [a]), ...floatCopies(proc, [a, proc])];
    assert.equal(shown.length, 3);
    assert.equal(shown.slice(-FLOAT_LIMIT).length, FLOAT_LIMIT);
    assert.ok(EMPTY_TRAY_MIN_REM <= EMPTY_TRAY_MAX_REM);
    assert.ok(EMPTY_TRAY_MIN_REM >= 0.8125);
    assert.ok(EMPTY_TRAY_MAX_REM <= 0.875);
  });

  it("names Continue as Space and uses the engine GCD wording (James, 11 Nov 2026)", () => {
    assert.equal(CONTINUE_KEY, "Space");
    assert.equal(CONTINUE_LABEL, "Continue");
    assert.equal(CONTINUE_WAIT_REASON, "Continue first");
    assert.equal(USED_THIS_INSTANT_REASON, "Already used this instant");
    assert.deepEqual(gcdHeldReason(1), {
      code: "gcd",
      text: "GCD, 1.0 s left",
      seconds: 1,
    });
    assert.equal(gcdHeldSeconds({ gcd: { remaining: 0, duration: 1 } }), 1);
    assert.equal(
      wellLine({
        sameInstant: true,
        phase: "decision",
        lastAction: { ok: true },
        events: [],
      }).prompt,
      "Your decision · GCD held",
    );
  });
});
