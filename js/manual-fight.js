// Manual fight B1 (#348). The player chooses each cast. The scripted rotation
// is not asked. After an on-GCD cast the clock runs to the end of the GCD
// (James, 11 Nov 2026, Q1). A Wait stops at the first strictly earlier moment
// an ability that was not castable becomes castable (James, 11 Nov 2026, Q2);
// the same instant is the Wait's own target (Scout, 11 Nov 2026). Nothing
// here changes a scripted run.
import { k } from "../data/constants.js";
import { abilityCatalogue } from "./abilities.js";
import { AURAS } from "./auras.js";
import { openCore } from "./core/fight.js";
import { createFight, fightResult } from "./fight.js";
import { createLiveFeed, procName } from "./live-feed.js";
import { raceCatalogue } from "./racials.js";
import { rotationHost } from "./rotation-host.js";
import { snapshot } from "./snapshot.js";
import { remainingTime } from "./views/run-model.js";

const RUN_OPTIONS = ["seed", "duration", "config"];

const AURA_NAMES = new Map(
  Object.values(AURAS).map((aura) => [aura.id, aura.name]),
);

// The stream's own name when it has one, otherwise the catalogue name for
// that id. Nothing is filled in when neither has one.
function recordedName(streamName, id, fromDefinition) {
  if (typeof streamName === "string" && streamName.length > 0) {
    return streamName;
  }
  const name = fromDefinition(id);
  return typeof name === "string" && name.length > 0 ? name : null;
}

// Spec §2.3. Anything usable that is not listed is appended, in ability order.
const SLOT_GROUPS = [
  [
    "sinister-strike",
    "backstab",
    "mutilate",
    "hemorrhage",
    "garrote",
    "ambush",
    "shank",
  ],
  ["slice-and-dice", "rupture", "eviscerate", "death-mark", "expose-armor"],
  [
    "blade-flurry",
    "adrenaline-rush",
    "cold-blood",
    "ghostly-strike",
    "premeditation",
    "preparation",
  ],
  ["blood-fury", "elunes-light", "berserking", "eureka"],
];

const SLOT_INDEX = new Map(SLOT_GROUPS.flat().map((id, index) => [id, index]));

const racialIcons = new Map();
for (const race of raceCatalogue.races) {
  for (const racial of race.racials) {
    racialIcons.set(racial.name, racial.icon);
  }
}

function isOrdinaryObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// The UI renders `text` and never builds it. `seconds` is set when the text
// has a "{time}" in the spec.
export function blockedText(reason) {
  return reason.text;
}

// Scout (coordinator), 11 Nov 2026, #348. The Wait's own target wins when an
// early stop is not strictly sooner. `manualFight.tie` is that code.
export function waitStopCode(earlyAt, targetAt) {
  if (earlyAt !== null && earlyAt < targetAt) {
    return "early";
  }
  return k("manualFight.tie");
}

function reason(code, text, seconds) {
  const value = { code, text };
  if (seconds !== undefined) {
    value.seconds = seconds;
  }
  return Object.freeze(value);
}

const TEXT = {
  over: "The fight is over",
  level: "Not available at this level",
  build: "Not granted by this build",
  mainHand: "Needs a dagger in the main hand",
  offHand: "Needs daggers in both hands",
  aura: "Needs Ambush window",
  energyFull: "Already at 40+ energy",
  noCooldown: "Nothing on cooldown",
  ended: "Fight ended before the wait finished",
  combo: "Needs combo points",
  energy: "Not enough energy",
};

function blockReason(ability, rogue, sim) {
  if (rogue.lockedByLevel(ability)) {
    return reason("level", TEXT.level);
  }
  if (rogue.lockedByBuild(ability)) {
    return reason("build", TEXT.build);
  }
  if (!ability.mainHandAllowed(rogue)) {
    return reason("main-hand", TEXT.mainHand);
  }
  if (!ability.offHandAllowed(rogue)) {
    return reason("off-hand", TEXT.offHand);
  }
  if (!ability.auraMet(sim)) {
    return reason("aura", TEXT.aura);
  }
  if (ability.triggersGcd && sim.gcd > k("sim.tickEpsilon")) {
    return reason("gcd", `GCD, ${remainingTime(sim.gcd)} left`, sim.gcd);
  }
  if (ability.onCooldown(rogue, sim)) {
    const left = sim.cooldowns[ability.id] ?? 0;
    return reason("cooldown", `On cooldown, ${remainingTime(left)} left`, left);
  }
  if (ability.spender && ability.pool(ability.spendResource).value < 1) {
    return reason("combo-points", TEXT.combo);
  }
  if (
    ability.costResource !== null &&
    !ability.pool(ability.costResource).has(ability.costNow(sim))
  ) {
    return reason("energy", TEXT.energy);
  }
  return null;
}

function energyReach(energy, amount, now) {
  if (energy.value >= amount) {
    return now;
  }
  const { rate, cap, value0, t0 } = energy.line;
  if (rate === 0 || amount > cap) {
    return null;
  }
  const time = Math.max(now, t0 + (amount - value0) / rate);
  return Number.isFinite(time) ? time : null;
}

function mapStreamEvent(type, event, proc) {
  if (type === "proc") {
    proc.name = procName(event.proc);
    return {
      t: event.time,
      kind: "proc",
      abilityId: event.ability ?? null,
      source: "proc",
      amount: null,
      outcome: null,
      procName: proc.name,
    };
  }
  if (type === "cast") {
    proc.name = null;
    return {
      t: event.time,
      kind: "cast",
      abilityId: event.ability,
      source: "ability",
      amount: event.cost,
      outcome: "cast",
      name: recordedName(
        event.name,
        event.ability,
        (id) => abilityCatalogue.get(id)?.name,
      ),
    };
  }
  if (type === "hit") {
    let source = "ability";
    if (event.origin === "white") {
      source = event.ability === "off-hand" ? "white-oh" : "white-mh";
    } else if (event.origin === "poison") {
      source = "poison";
    }
    const mapped = {
      t: event.time,
      kind: event.origin === "dot" ? "tick" : "damage",
      abilityId: event.ability,
      source,
      amount: event.damage,
      outcome: event.outcome === "glancing" ? "glance" : event.outcome,
      name: event.name,
    };
    if (proc.name !== null) {
      mapped.procName = proc.name;
    }
    if (event.status === "Resist") {
      mapped.resisted = true;
    }
    return mapped;
  }
  if (type === "resource") {
    return {
      t: event.time,
      kind: event.resource === "energy" ? "energy" : "cp",
      abilityId: event.source,
      source: "ability",
      amount: event.after - event.before,
      outcome: event.change,
    };
  }
  if (type === "aura") {
    return {
      t: event.time,
      kind: "aura",
      abilityId: event.source,
      source: "ability",
      amount: event.stacks,
      outcome: event.change,
      change: event.change,
      stacks: event.stacks,
      duration: event.duration,
      reason: event.reason,
      aura: event.aura,
      name: recordedName(event.name, event.aura, (id) => AURA_NAMES.get(id)),
    };
  }
  if (type === "end") {
    return {
      t: event.time,
      kind: "end",
      abilityId: null,
      source: null,
      amount: event.totalDamage,
      outcome: null,
    };
  }
  return null;
}

export function createManualFight(options) {
  if (!isOrdinaryObject(options)) {
    throw new RangeError(
      `createManualFight needs { seed, duration, config }. Got ${options}.`,
    );
  }
  for (const key of Object.keys(options)) {
    if (!RUN_OPTIONS.includes(key)) {
      throw new RangeError(
        `createManualFight has no option ${JSON.stringify(key)}. Options: ${RUN_OPTIONS.join(", ")}.`,
      );
    }
  }
  const seed = options.seed;
  const duration = options.duration;
  const config = options.config;
  const valid = Number.isFinite(duration) && duration >= 0;
  const fight = createFight(seed, config, {
    duration: valid ? duration : undefined,
  });
  if (!valid) {
    throw new RangeError(
      `createManualFight needs a finite duration in seconds, 0 or more. Got ${duration}.`,
    );
  }
  const { rogue, simulation: sim } = fight;
  const host = rotationHost(rogue, sim, { duration });
  const usable = [...rogue.abilitiesById.keys()].filter((id) =>
    host.usable(id),
  );
  usable.sort((a, b) => {
    const ia = SLOT_INDEX.get(a) ?? SLOT_INDEX.size;
    const ib = SLOT_INDEX.get(b) ?? SLOT_INDEX.size;
    return ia - ib;
  });
  const slots = Object.freeze(
    usable.map((id) => {
      const ability = rogue.abilitiesById.get(id);
      const iconKey =
        snapshot.spellbook?.icons?.[ability.name] ??
        racialIcons.get(ability.name) ??
        null;
      return Object.freeze({
        abilityId: id,
        name: ability.name,
        iconKey,
        icon: ability.icon,
        cost: ability.costNow(sim),
        costResource: ability.costResource,
        isFinisher:
          ability.spender === true && ability.spendResource === "comboPoints",
        onGcd: ability.triggersGcd,
      });
    }),
  );

  const events = [];
  let spill = [];
  // An on-GCD cast stays at its instant so an off-GCD cast can follow there,
  // the way the scripted rotation is asked again at that same time. The next
  // getState, wait, or on-GCD cast runs the clock to the end of that GCD.
  let held = false;
  // The instant the held GCD was opened. An off-GCD cast is allowed there,
  // and for a remainder within the tick epsilon, and nowhere later in it
  // (James, 11 Nov 2026 ruling, option A).
  let gcdOpenedAt = null;
  const proc = { name: null };
  const unsubscribe = sim.on("*", (event, type) => {
    const mapped = mapStreamEvent(type, event, proc);
    if (mapped !== null) {
      events.push(Object.freeze(mapped));
    }
  });
  const feed = createLiveFeed(fight);

  let queued = null;
  let over = false;
  let why = "pull";
  let waitedFor = null;
  const inputs = [];
  const waits = k("manualFight.waits");

  const core = openCore(sim, duration, {
    decide() {
      const id = queued;
      queued = null;
      if (id === null) {
        return { casts: [] };
      }
      const ability = rogue.abilitiesById.get(id);
      const cast = ability.cast(rogue, sim);
      return cast === null ? { casts: [] } : { casts: [id] };
    },
  });

  function takeEvents() {
    const taken = spill.concat(events);
    spill = [];
    events.length = 0;
    return taken;
  }

  // Run a held on-GCD cast out to the GCD end. Events land on the next call
  // that returns some, so a getState in between does not drop them.
  function presentDecision() {
    if (!held || over) {
      return;
    }
    held = false;
    gcdOpenedAt = null;
    const gcdEnd = sim.core?.gcd?.endsAt ?? null;
    // A remainder inside the tick epsilon is already clear (the same rule as
    // a cast). Running out to that end would move the clock by a rounding
    // ulp and start the next cooldown late.
    if (gcdEnd === null || sim.gcd <= k("sim.tickEpsilon")) {
      return;
    }
    if (gcdEnd > core.endTime) {
      core.runUntil(core.endTime);
      finish();
    } else {
      core.runUntil(gcdEnd);
    }
    if (events.length > 0) {
      spill.push(...events);
      events.length = 0;
    }
  }

  function refused(block) {
    events.length = 0;
    return {
      ok: false,
      reason: block,
      stopReason: null,
      advancedBy: 0,
      events: [],
    };
  }

  function overReason() {
    return reason("fight-over", TEXT.over);
  }

  function finish() {
    if (over) {
      return;
    }
    if (core.time < core.endTime) {
      core.runUntil(core.endTime);
    }
    core.close();
    sim.end();
    over = true;
    why = "end";
  }

  // A wait stops on the scheduler: the energy threshold, a cooldown, the GCD,
  // an aura, or combo points, whichever event comes first. Not a time grid.
  function stopReason(code, text, abilityId) {
    const value = { code, text };
    if (abilityId !== undefined) {
      value.abilityId = abilityId;
    }
    return Object.freeze(value);
  }

  function earlyText(name) {
    return k("manualFight.earlyStop").replace("{ability}", name);
  }

  function isCastable(ability) {
    return blockReason(ability, rogue, sim) === null;
  }

  function heldBack(ability) {
    return (
      rogue.lockedByLevel(ability) ||
      rogue.lockedByBuild(ability) ||
      !ability.mainHandAllowed(rogue) ||
      !ability.offHandAllowed(rogue) ||
      !ability.auraMet(sim) ||
      (ability.spender && ability.pool(ability.spendResource).value < 1)
    );
  }

  function firstNewCastable(wasCastable) {
    for (const slot of slots) {
      if (wasCastable.has(slot.abilityId)) {
        continue;
      }
      const ability = rogue.abilitiesById.get(slot.abilityId);
      if (isCastable(ability)) {
        return ability;
      }
    }
    return null;
  }

  function armThreshold(limit, energyAmount) {
    let amount = null;
    let soonest = Infinity;
    if (energyAmount !== null) {
      const reach = energyReach(sim.core.energy, energyAmount, core.time);
      if (reach !== null && reach <= limit) {
        amount = energyAmount;
        soonest = reach;
      }
    }
    for (const slot of slots) {
      const ability = rogue.abilitiesById.get(slot.abilityId);
      if (isCastable(ability) || heldBack(ability)) {
        continue;
      }
      if (ability.costResource !== "energy") {
        continue;
      }
      const cost = ability.costNow(sim);
      if (ability.pool(ability.costResource).has(cost)) {
        continue;
      }
      const reach = energyReach(sim.core.energy, cost, core.time);
      if (reach === null || !(reach < limit)) {
        continue;
      }
      if (reach < soonest) {
        soonest = reach;
        amount = cost;
      }
    }
    if (amount === null) {
      sim.core.energy.cancelWake();
      return;
    }
    sim.core.energy.wakeAt(amount);
  }

  function runWait(target, energyAmount = null) {
    const wasCastable = new Set();
    for (const slot of slots) {
      const ability = rogue.abilitiesById.get(slot.abilityId);
      if (isCastable(ability)) {
        wasCastable.add(slot.abilityId);
      }
    }
    const before = core.time;
    const limit = Math.min(target, core.endTime);
    while (!over && core.time < limit - k("sim.tickEpsilon")) {
      armThreshold(limit, target > core.endTime ? null : energyAmount);
      const next = core.nextTime;
      if (next === null || !(next < limit)) {
        break;
      }
      const stamp = core.time;
      core.runUntil(next);
      if (core.time === stamp && !(core.nextTime < limit)) {
        break;
      }
      if (!(core.time < limit)) {
        break;
      }
      const ready = firstNewCastable(wasCastable);
      if (ready !== null && waitStopCode(core.time, target) === "early") {
        sim.core.energy.cancelWake();
        return {
          ok: true,
          reason: null,
          stopReason: stopReason("early", earlyText(ready.name), ready.id),
          advancedBy: core.time - before,
          events: takeEvents(),
        };
      }
    }
    if (target > core.endTime) {
      sim.core.energy.cancelWake();
      core.runUntil(core.endTime);
      finish();
    } else {
      core.runUntil(limit);
      sim.core.energy.cancelWake();
      if (core.time >= core.endTime) {
        finish();
      }
    }
    return {
      ok: true,
      reason: null,
      stopReason: over
        ? stopReason("fight-end", TEXT.ended)
        : stopReason(k("manualFight.tie"), "Reached the wait"),
      advancedBy: core.time - before,
      events: takeEvents(),
    };
  }

  function runTo(target) {
    if (held) {
      const gcdEnd = sim.core?.gcd?.endsAt ?? null;
      if (gcdEnd === null || target >= gcdEnd || target >= core.endTime) {
        held = false;
        gcdOpenedAt = null;
      }
    }
    const before = core.time;
    if (target > core.endTime) {
      core.runUntil(core.endTime);
      const advancedBy = core.time - before;
      finish();
      return {
        ok: true,
        reason: reason("fight-ended", TEXT.ended),
        advancedBy,
        events: takeEvents(),
      };
    }
    core.runUntil(target);
    const advancedBy = core.time - before;
    return { ok: true, reason: null, advancedBy, events: takeEvents() };
  }

  function cooldownTarget() {
    if (over) {
      return null;
    }
    let best = null;
    slots.forEach((slot, index) => {
      const ends = sim.core.cooldowns.endsAt(slot.abilityId);
      const left = sim.cooldowns[slot.abilityId] ?? 0;
      if (ends === null || left <= k("sim.tickEpsilon")) {
        return;
      }
      if (
        best === null ||
        ends < best.ends ||
        (ends === best.ends && index < best.index)
      ) {
        best = { abilityId: slot.abilityId, ends, index };
      }
    });
    return best;
  }

  function laterInHeldGcd() {
    return (
      held &&
      gcdOpenedAt !== null &&
      core.time > gcdOpenedAt + k("sim.tickEpsilon")
    );
  }

  function gcdReason() {
    const endsAt = sim.core?.gcd?.endsAt ?? null;
    const left =
      sim.gcd > 0
        ? sim.gcd
        : endsAt === null
          ? 0
          : Math.max(0, endsAt - core.time);
    return reason("gcd", `GCD, ${remainingTime(left)} left`, left);
  }

  // James, 11 Nov 2026 ruling (option A). On-GCD stays uncastable for the
  // whole held GCD. Off-GCD is castable at the opening instant and refused
  // once time has moved past it.
  function slotBlock(ability) {
    if (over) {
      return overReason();
    }
    if (laterInHeldGcd() || (ability.triggersGcd && held)) {
      return gcdReason();
    }
    return blockReason(ability, rogue, sim);
  }

  function readState() {
    const live = feed.read();
    const soonest = cooldownTarget();
    const energyNow = live.resources.energy.value;
    const energyBlocked =
      over || energyNow + k("sim.tickEpsilon") >= waits.energy;
    const reachAt = over
      ? null
      : energyReach(sim.core.energy, waits.energy, core.time);
    const waitRows = [
      {
        kind: "energy",
        available: !energyBlocked && reachAt !== null,
        reason: over
          ? overReason()
          : energyBlocked
            ? reason("energy-full", TEXT.energyFull)
            : reachAt === null
              ? reason("fight-ended", TEXT.ended)
              : null,
        target: waits.energy,
        reachAt: reachAt !== null && reachAt <= core.endTime ? reachAt : null,
      },
      {
        kind: "cooldown",
        available: !over && soonest !== null,
        reason: over
          ? overReason()
          : soonest === null
            ? reason("no-cooldown", TEXT.noCooldown)
            : null,
        abilityId: soonest?.abilityId ?? null,
        readyAt: soonest?.ends ?? null,
      },
      {
        kind: "time",
        available: !over,
        reason: over ? overReason() : null,
        seconds: waits.time,
      },
    ];
    return Object.freeze({
      seed: fight.seed,
      duration,
      time: sim.currentTime,
      remaining: Math.max(0, duration - sim.currentTime),
      over: over || sim.currentTime >= duration,
      dps: sim.currentTime > 0 ? sim.damageDone / sim.currentTime : 0,
      energy: live.resources.energy,
      comboPoints: live.resources.comboPoints,
      gcd: live.gcd,
      buffs: live.effects.buffs,
      debuffs: live.effects.debuffs,
      slots: Object.freeze(
        slots.map((slot) => {
          const ability = rogue.abilitiesById.get(slot.abilityId);
          const block = slotBlock(ability);
          return Object.freeze({
            abilityId: slot.abilityId,
            castable: block === null,
            reason: block,
            cost: ability.costNow(sim),
            cooldownRemaining: sim.cooldowns[slot.abilityId] ?? 0,
          });
        }),
      ),
      waits: Object.freeze(waitRows.map((row) => Object.freeze(row))),
      waitCooldownTarget: soonest?.abilityId ?? null,
      decision: Object.freeze({
        why,
        ...(waitedFor === null ? {} : { waitedFor }),
      }),
    });
  }

  function state() {
    presentDecision();
    return readState();
  }

  function cast(abilityId) {
    if (abilityId !== undefined) {
      const next = rogue.abilitiesById.get(abilityId);
      if (next?.triggersGcd) {
        presentDecision();
      }
    }
    if (over) {
      return refused(overReason());
    }
    const ability = rogue.abilitiesById.get(abilityId);
    if (ability === undefined) {
      throw new RangeError(
        `createManualFight has no ability ${JSON.stringify(abilityId)}.`,
      );
    }
    if (!ability.triggersGcd && laterInHeldGcd()) {
      return refused(gcdReason());
    }
    const block = blockReason(ability, rogue, sim);
    if (block !== null) {
      return refused(block);
    }
    const before = core.time;
    queued = abilityId;
    inputs.push(Object.freeze({ type: "cast", abilityId }));
    const mark = events.length;
    core.requestDecision();
    core.runUntil(before);
    const happened = events
      .slice(mark)
      .some((event) => event.kind === "cast" && event.abilityId === abilityId);
    if (!happened) {
      return refused(
        blockReason(ability, rogue, sim) ??
          reason(
            "cooldown",
            `On cooldown, ${remainingTime(sim.cooldowns[ability.id] ?? 0)} left`,
            sim.cooldowns[ability.id] ?? 0,
          ),
      );
    }
    if (ability.triggersGcd && !over) {
      held = true;
      gcdOpenedAt = core.time;
    }
    return {
      ok: true,
      reason: null,
      advancedBy: core.time - before,
      events: takeEvents(),
    };
  }

  function wait(request) {
    presentDecision();
    if (over) {
      return refused(overReason());
    }
    if (request?.kind === "energy") {
      if (rogue.energy + k("sim.tickEpsilon") >= waits.energy) {
        return refused(reason("energy-full", TEXT.energyFull));
      }
      const reach = energyReach(sim.core.energy, waits.energy, core.time);
      inputs.push(Object.freeze({ type: "wait", kind: "energy" }));
      why = "energy";
      waitedFor = waits.energy;
      if (reach === null || reach > core.endTime) {
        return runWait(core.endTime + 1);
      }
      sim.core.energy.wakeAt(waits.energy);
      const when = sim.core.energy.wakeTime ?? reach;
      return runWait(when, waits.energy);
    }
    if (request?.kind === "cooldown") {
      const soonest = cooldownTarget();
      if (soonest === null) {
        return refused(reason("no-cooldown", TEXT.noCooldown));
      }
      inputs.push(
        Object.freeze({
          type: "wait",
          kind: "cooldown",
          abilityId: soonest.abilityId,
        }),
      );
      why = "cooldown";
      waitedFor = soonest.abilityId;
      return runWait(soonest.ends);
    }
    if (request?.kind === "time") {
      inputs.push(Object.freeze({ type: "wait", kind: "time" }));
      why = "time";
      waitedFor = waits.time;
      return runWait(core.time + waits.time);
    }
    throw new RangeError(
      'wait needs { kind: "energy" }, { kind: "cooldown" }, or { kind: "time" }.',
    );
  }

  return {
    slots,
    getState: state,
    peekState: readState,
    cast,
    wait,
    // Test helper (#348 parity). Not part of the UI interface. Runs passive
    // events up to `t` and does not cast. At the fight end it finishes.
    advanceTo(t) {
      if (over) {
        return refused(overReason());
      }
      return runTo(t);
    },
    isOver: () => over,
    result() {
      if (!over && core.time >= core.endTime) {
        finish();
      }
      if (!over) {
        throw new Error("The fight is not over.");
      }
      return { ...fightResult(fight), manual: { inputs: inputs.slice() } };
    },
    replay() {
      return createManualFight({ seed, duration, config });
    },
    dispose() {
      unsubscribe();
      feed.stop();
      if (!over) {
        core.close();
        over = true;
      }
    },
  };
}
