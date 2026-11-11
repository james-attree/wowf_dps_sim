// Host for a Manual fight (#348): talks to createManualFight and writes
// a plain `manual` slice on the store so the board view never imports
// the engine. Q1 and Q2 are left to the engine; this host only applies
// the returned state, events and reason fields.
import { createManualFight } from "./manual-fight.js";

function eventName(event, slots) {
  if (event.name) {
    return event.name;
  }
  const slot = slots.find((item) => item.abilityId === event.abilityId);
  if (slot?.name) {
    return slot.name;
  }
  return event.procName ?? event.abilityId ?? event.aura ?? "";
}

function namedEvents(events, slots) {
  return events.map((event) =>
    event.name ? event : { ...event, name: eventName(event, slots) },
  );
}

function fightSnapshot({ seed, duration, config }) {
  return Object.freeze({
    seed,
    duration,
    config: globalThis.structuredClone(config),
  });
}

function publish(store, fight, extra = {}) {
  const state = fight.getState();
  const over = fight.isOver();
  store.update((current) => ({
    results: { time: state.time, damage: state.dps * state.time },
    run: {
      ...current.run,
      state: over ? "finished" : "running",
    },
    manual: {
      ...current.manual,
      active: true,
      phase: extra.phase ?? (over ? "review" : "decision"),
      slots: fight.slots,
      state,
      result: over ? fight.result() : null,
      ...extra,
    },
  }));
}

const emptyManual = () => ({
  active: false,
  phase: "ready",
  slots: [],
  state: null,
  events: [],
  lastAction: null,
  blockedAbilityId: null,
  result: null,
  snapshot: null,
});

export function createManualRun(store) {
  let fight = null;
  let snapshot = null;

  function start({ seed, duration, config }) {
    fight?.dispose();
    snapshot = fightSnapshot({ seed, duration, config });
    fight = createManualFight({
      seed: snapshot.seed,
      duration: snapshot.duration,
      config: snapshot.config,
    });
    store.update((current) => ({
      run: { ...current.run, state: "running", shown: true, stoppedAt: null },
      results: { time: 0, damage: 0 },
      manual: {
        ...emptyManual(),
        active: true,
        phase: "decision",
        slots: fight.slots,
        state: fight.getState(),
        events: [],
        snapshot,
      },
    }));
  }

  function apply(action, abilityId) {
    if (fight == null) {
      return action;
    }
    const prior = store.get().manual?.events ?? [];
    const named = namedEvents(action.events ?? [], fight.slots);
    const events = action.ok ? [...prior, ...named] : prior;
    let phase = "decision";
    let blockedAbilityId = null;
    if (!action.ok) {
      phase = "blocked";
      blockedAbilityId = abilityId ?? null;
    } else if (fight.isOver()) {
      phase = "review";
    } else if (
      named.some((event) => event.outcome === "crit" || event.procName)
    ) {
      phase = "crit";
    }
    publish(store, fight, {
      phase,
      events,
      lastAction: action,
      blockedAbilityId,
    });
    return action;
  }

  return {
    start,
    cast(abilityId) {
      if (fight == null || fight.isOver()) {
        return null;
      }
      return apply(fight.cast(abilityId), abilityId);
    },
    wait(options) {
      if (fight == null || fight.isOver()) {
        return null;
      }
      return apply(fight.wait(options));
    },
    // Strict Replay (Scout): the start snapshot only, never the current form.
    replay() {
      if (snapshot == null) {
        return;
      }
      start({
        seed: snapshot.seed,
        duration: snapshot.duration,
        config: snapshot.config,
      });
    },
    backToFight() {
      fight?.dispose();
      fight = null;
      snapshot = null;
      store.update((current) => ({
        run: { ...current.run, state: "idle", shown: false, stoppedAt: null },
        manual: emptyManual(),
      }));
    },
    stop() {
      const time = fight?.getState().time ?? 0;
      fight?.dispose();
      fight = null;
      snapshot = null;
      store.update((current) => ({
        run: {
          ...current.run,
          state: "idle",
          stoppedAt: time,
          snapshot: null,
        },
        manual: emptyManual(),
      }));
    },
    reset() {
      fight?.dispose();
      fight = null;
      snapshot = null;
      store.update((current) => ({
        run: {
          ...current.run,
          state: "idle",
          shown: false,
          stoppedAt: null,
          snapshot: null,
        },
        manual: emptyManual(),
      }));
    },
    get active() {
      return fight != null && !fight.isOver();
    },
    emptyManual,
  };
}
