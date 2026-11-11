// Manual fight B1 (#348). The player chooses each cast. The scripted rotation
// is not asked. Q1 (when the next decision is offered after a cast) and Q2
// (whether a Wait stops early when something becomes castable) are open:
// the seams are the TODO(Q1) and TODO(Q2) comments in js/core/fight.js and
// below. Nothing here changes a scripted run.
import { k } from "../data/constants.js";
import { openCore } from "./core/fight.js";
import { createFight, fightResult } from "./fight.js";
import { createLiveFeed, procName } from "./live-feed.js";
import { raceCatalogue } from "./racials.js";
import { rotationHost } from "./rotation-host.js";
import { snapshot } from "./snapshot.js";
import { remainingTime } from "./views/run-model.js";

const RUN_OPTIONS = ["seed", "duration", "config"];

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
  const left = sim.cooldowns[ability.id] ?? 0;
  if (left > k("sim.tickEpsilon")) {
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
    const taken = events.slice();
    events.length = 0;
    return taken;
  }

  function refused(block) {
    takeEvents();
    return { ok: false, reason: block, advancedBy: 0, events: [] };
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

  // TODO(Q2): a Wait runs to its target. Nothing here returns early when a
  // slot becomes castable on the way. That question is open.
  function runTo(target) {
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
    if (core.time >= core.endTime) {
      finish();
    }
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

  function state() {
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
      over,
      dps: sim.currentTime > 0 ? sim.damageDone / sim.currentTime : 0,
      energy: live.resources.energy,
      comboPoints: live.resources.comboPoints,
      gcd: live.gcd,
      buffs: live.effects.buffs,
      debuffs: live.effects.debuffs,
      slots: Object.freeze(
        slots.map((slot) => {
          const ability = rogue.abilitiesById.get(slot.abilityId);
          const block = over ? overReason() : blockReason(ability, rogue, sim);
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

  function cast(abilityId) {
    if (over) {
      return refused(overReason());
    }
    const ability = rogue.abilitiesById.get(abilityId);
    if (ability === undefined) {
      throw new RangeError(
        `createManualFight has no ability ${JSON.stringify(abilityId)}.`,
      );
    }
    const block = blockReason(ability, rogue, sim);
    if (block !== null) {
      return refused(block);
    }
    const before = core.time;
    queued = abilityId;
    inputs.push(Object.freeze({ type: "cast", abilityId }));
    core.requestDecision();
    // TODO(Q1): run only this decision. Do not step on to the next moment an
    // on-GCD slot is castable, and do not re-ask while the GCD is rolling.
    core.runUntil(before);
    return {
      ok: true,
      reason: null,
      advancedBy: core.time - before,
      events: takeEvents(),
    };
  }

  function wait(request) {
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
        return runTo(core.endTime + 1);
      }
      const before = core.time;
      sim.core.energy.wakeAt(waits.energy);
      // TODO(Q2): do not leave this wake early for a castable slot.
      const outcome = runTo(sim.core.energy.wakeTime ?? reach);
      sim.core.energy.cancelWake();
      if (outcome.advancedBy === 0) {
        outcome.advancedBy = core.time - before;
      }
      return outcome;
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
      // TODO(Q2): do not stop before readyAt when another slot is castable.
      return runTo(soonest.ends);
    }
    if (request?.kind === "time") {
      inputs.push(Object.freeze({ type: "wait", kind: "time" }));
      why = "time";
      waitedFor = waits.time;
      // TODO(Q2): do not stop before the 0.5 s when a slot is castable.
      return runTo(core.time + waits.time);
    }
    throw new RangeError(
      'wait needs { kind: "energy" }, { kind: "cooldown" }, or { kind: "time" }.',
    );
  }

  return {
    slots,
    getState: state,
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
