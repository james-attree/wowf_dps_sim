import { DOT_REFRESH, DOT_TICK_KIND, DotTicks } from "../js/core/dots.js";
import { ORDER, Scheduler } from "../js/core/scheduler.js";
import { SWING_KIND, SwingTimer } from "../js/core/swing.js";
import { TIMER_KINDS, TimerSet } from "../js/core/timers.js";

// A helper, not a test file.
//
// A test-only host for the Phase 3.5 core (#196): a legacy Simulation driven
// by scheduler events, not by step(). The production host is #197/#198; this
// one is only what E5's tests need to show that the DoT ticks, procs and
// poisons keep their legacy rules on events.
//
//   swing         both hands' SwingTimers (js/core/swing.js). The handler
//                 resolves the white swing as Rogue.rotation does, then
//                 calls swung().
//   dot-tick      DotTicks (js/core/dots.js). A DoT starts where legacy puts
//                 one in activeDots: Simulation.resolveDotAttack restarts it,
//                 Simulation.resolveProcDot keeps its clock. The handler calls
//                 ticked(), then Simulation.resolveDotTick and
//                 procs.onDotTick, as step() does.
//   aura-expire   a TimerSet for the auras: Simulation.applyAura sets the end
//                 (the legacy refresh rule works on the time left), and the
//                 handler removes the aura and runs its onExpire, as step()
//                 does. An aura stays at its applied duration until then, so
//                 hasAura and auraEffects read it as up.
//   decision      host.at(time, fn): fn(host) at that time, after the other
//                 classes, for a test's casts and checks.
//
// sim.currentTime is the scheduler's now for every event, so the procs' ICDs
// (readyAt) read event time. Nothing regenerates energy.
export function coreHost(sim, { endTime, swings = true } = {}) {
  const { rogue } = sim;
  const log = [];
  const host = { sim, rogue, log };

  const scheduler = new Scheduler({
    endTime,
    handle(event) {
      sim.currentTime = scheduler.now;
      log.push([
        event.kind,
        event.time,
        event.payload?.id ?? event.payload?.hand,
      ]);
      if (event.kind === SWING_KIND) {
        const weapon =
          event.payload.hand === "main"
            ? rogue.weapons.mainHand
            : rogue.weapons.offHand;
        sim.resolveAttack(weapon.attack, "weapon", weapon.rollDamage());
        host.swings[event.payload.hand].swung();
      } else if (event.kind === DOT_TICK_KIND) {
        const { id } = dots.ticked(event);
        const dot = sim.activeDots[id];
        const context = sim.abilityContext(id, dot);
        sim.resolveDotTick(id, dot, context);
        sim.procs.onDotTick(context);
        if (!dots.running(id) && dots.nextTickAt(id) === null) {
          delete sim.activeDots[id];
        }
      } else if (event.kind === TIMER_KINDS.aura) {
        expire(event.payload.id);
      } else {
        event.payload.fn(host);
      }
    },
  });
  const dots = new DotTicks({ scheduler });
  const auras = new TimerSet({ scheduler, kind: TIMER_KINDS.aura });

  function expire(id) {
    for (const map of ["activeBuffs", "activeDebuffs"]) {
      const aura = Object.hasOwn(sim[map], id) ? sim[map][id] : undefined;
      if (aura === undefined) {
        continue;
      }
      delete sim[map][id];
      aura.duration = 0;
      const definition = sim.auraDefinitions.get(id);
      sim.emitAura(definition, aura, "expire", { reason: "time" });
      definition.onExpire?.(sim, aura);
    }
  }

  // DoT starts, where legacy writes activeDots.
  const castDot = sim.resolveDotAttack.bind(sim);
  sim.resolveDotAttack = (source, ...rest) => {
    const before = sim.activeDots[source.id];
    const result = castDot(source, ...rest);
    const entry = sim.activeDots[source.id];
    if (entry !== undefined && entry !== before) {
      dots.apply(source.id, {
        interval: entry.tickInterval,
        duration: entry.duration,
        refresh: DOT_REFRESH.restart,
      });
    }
    return result;
  };
  const procDot = sim.resolveProcDot.bind(sim);
  sim.resolveProcDot = (options) => {
    const before = sim.activeDots[options.id];
    const result = procDot(options);
    const entry = sim.activeDots[options.id];
    if (entry !== undefined && entry !== before) {
      dots.apply(options.id, {
        interval: entry.tickInterval,
        duration: entry.duration,
        refresh: DOT_REFRESH.keepClock,
      });
    }
    return result;
  };

  // Aura ends on the TimerSet. The legacy refresh rules (extend,
  // replace-if-longer) read the aura's duration as the time left.
  const applyAura = sim.applyAura.bind(sim);
  sim.applyAura = (definition, options) => {
    const map =
      definition.target === "target" ? sim.activeDebuffs : sim.activeBuffs;
    if (Object.hasOwn(map, definition.id)) {
      map[definition.id].duration = auras.remaining(definition.id);
    }
    const aura = applyAura(definition, options);
    auras.setEndsAt(definition.id, scheduler.now + aura.duration);
    return aura;
  };

  // An aura its last charge ends (Cold Blood) has no expiry left.
  const consumeCharge = sim.consumeCharge.bind(sim);
  sim.consumeCharge = (id, count) => {
    const left = consumeCharge(id, count);
    if (left === 0) {
      auras.clear(id);
    }
    return left;
  };

  host.scheduler = scheduler;
  host.dots = dots;
  host.auras = auras;
  host.swings = {
    main: new SwingTimer({
      weapon: rogue.weapons.mainHand,
      modifiers: sim.modifiers,
      scheduler,
    }),
    off: new SwingTimer({
      weapon: rogue.weapons.offHand,
      modifiers: sim.modifiers,
      scheduler,
    }),
  };
  // Run fn(host) at `time`, in the decision class.
  host.at = (time, fn) =>
    scheduler.schedule({
      time,
      order: ORDER.decision,
      kind: "decision",
      payload: Object.freeze({ fn }),
    });
  // Swing from `start` (main hand) and `start + offStart` (off hand), as
  // legacy's first step does, then run to the end and close the fight.
  host.run = ({
    start = 0,
    offStart = rogue.weapons.offHand.swingTimer,
  } = {}) => {
    if (swings) {
      host.swings.main.start(start);
      host.swings.off.start(start + offStart);
    }
    scheduler.runToEnd();
    sim.currentTime = endTime;
    sim.end();
    return host;
  };
  // The times of the DoT `id`'s ticks so far (the fight log's dot events).
  host.tickTimes = (id) =>
    log
      .filter(([kind, , what]) => kind === DOT_TICK_KIND && what === id)
      .map(([, time]) => time);
  return host;
}
