// Host for a Manual fight (#348): talks to createManualFight and writes
// a plain `manual` slice on the store so the board view never imports
// the engine. This host applies the returned state, events, reason and
// stopReason fields; it does not invent names or reason text.
import { createManualFight } from "./manual-fight.js";
import { poisonCatalogue } from "./poisons.js";

const POISON_NAMES = new Set(
  poisonCatalogue.poisons.map((poison) => poison.name),
);

function tagIncoming(events) {
  return events.map((event) => {
    if (event.source === "poison") {
      return event;
    }
    const label = event.procName ?? event.name;
    if (typeof label === "string" && POISON_NAMES.has(label)) {
      return { ...event, poisonProc: true };
    }
    return event;
  });
}

function fightSnapshot({ seed, duration, config }) {
  return Object.freeze({
    seed,
    duration,
    config: globalThis.structuredClone(config),
  });
}

function publish(store, fight, extra = {}) {
  const { duration, phase: requested, ...rest } = extra;
  const state = fight.getState();
  // getState() can land on the end instant without setting over;
  // result() is the public way to finish that case.
  if (!fight.isOver() && duration != null && state.time >= duration) {
    fight.result();
  }
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
      slots: fight.slots,
      state,
      result: over ? fight.result() : null,
      ...rest,
      // getState() may finish the fight after apply() chose a phase.
      phase: over ? "review" : (requested ?? "decision"),
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
  armed: [],
  skipped: [],
});

export function createManualRun(store) {
  let fight = null;
  let snapshot = null;
  // Armed off-GCD ids, in the order they were picked (James, 12 Nov 2026).
  let armed = [];

  function slotMeta(abilityId) {
    return (fight?.slots ?? []).find((slot) => slot.abilityId === abilityId);
  }

  function isOnGcd(abilityId) {
    return slotMeta(abilityId)?.onGcd !== false;
  }

  function clearArmed() {
    armed = [];
  }

  function peek() {
    return fight.peekState();
  }

  function slotRow(abilityId, state = peek()) {
    return (state.slots ?? []).find((row) => row.abilityId === abilityId);
  }

  // Drop any armed id that peekState says is no longer ready, e.g. after
  // another armed press made it uncastable before it fired.
  function pruneArmed(state) {
    armed = armed.filter((id) => slotRow(id, state)?.castable === true);
  }

  function publishArmed() {
    const state = peek();
    pruneArmed(state);
    store.update((current) => ({
      manual: {
        ...current.manual,
        state,
        armed: armed.slice(),
        phase: "decision",
        blockedAbilityId: null,
        skipped: [],
      },
    }));
  }

  function toggleArm(abilityId) {
    if (armed.includes(abilityId)) {
      armed = armed.filter((id) => id !== abilityId);
      publishArmed();
      return { ok: true, armed: false, abilityId };
    }
    if (slotRow(abilityId)?.castable !== true) {
      return null;
    }
    armed = [...armed, abilityId];
    publishArmed();
    return { ok: true, armed: true, abilityId };
  }

  function fireArmed() {
    const incoming = [];
    const skipped = [];
    for (const id of armed) {
      const row = slotRow(id);
      if (row?.castable !== true) {
        skipped.push({
          abilityId: id,
          reason: row?.reason?.text ?? "",
        });
        continue;
      }
      const action = fight.cast(id);
      if (!action.ok) {
        skipped.push({
          abilityId: id,
          reason: action.reason?.text ?? "",
        });
        continue;
      }
      incoming.push(...tagIncoming(action.events ?? []));
    }
    clearArmed();
    return { incoming, skipped };
  }

  function start({ seed, duration, config }) {
    fight?.dispose();
    clearArmed();
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
        armed: [],
      },
    }));
  }

  function apply(action, abilityId, extras = {}) {
    if (fight == null) {
      return action;
    }
    clearArmed();
    const prior = store.get().manual?.events ?? [];
    const fromArmed = extras.incoming ?? [];
    const incoming = action.ok
      ? [...fromArmed, ...tagIncoming(action.events ?? [])]
      : [...fromArmed];
    const events = [...prior, ...incoming];
    let phase = "decision";
    let blockedAbilityId = null;
    if (!action.ok) {
      phase = "blocked";
      blockedAbilityId = abilityId ?? null;
    } else if (fight.isOver()) {
      phase = "review";
    } else if (
      incoming.some((event) => event.outcome === "crit" || event.procName)
    ) {
      phase = "crit";
    }
    publish(store, fight, {
      phase,
      events,
      lastAction: action,
      blockedAbilityId,
      armed: [],
      skipped: extras.skipped ?? [],
      duration: snapshot.duration,
    });
    return action;
  }

  return {
    start,
    cast(abilityId) {
      if (fight == null || fight.isOver()) {
        return null;
      }
      if (!isOnGcd(abilityId)) {
        if (armed.includes(abilityId) || slotRow(abilityId)?.castable) {
          return toggleArm(abilityId);
        }
        // Direct API: an unready off-GCD records Blocked (Kira, #369 N1).
        return apply(fight.cast(abilityId), abilityId);
      }
      const extras = fireArmed();
      return apply(fight.cast(abilityId), abilityId, extras);
    },
    wait(options) {
      if (fight == null || fight.isOver()) {
        return null;
      }
      const extras = fireArmed();
      return apply(fight.wait(options), null, extras);
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
      clearArmed();
      store.update((current) => ({
        run: { ...current.run, state: "idle", shown: false, stoppedAt: null },
        manual: emptyManual(),
      }));
    },
    stop() {
      const time = fight?.peekState().time ?? 0;
      fight?.dispose();
      fight = null;
      snapshot = null;
      clearArmed();
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
      clearArmed();
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
