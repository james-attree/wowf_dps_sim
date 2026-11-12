// Host for a Manual fight (#348): talks to createManualFight and writes
// a plain `manual` slice on the store so the board view never imports
// the engine. This host applies the returned state, events, reason and
// stopReason fields; it does not invent names or reason text.
import { createManualFight } from "./manual-fight.js";
import { poisonCatalogue } from "./poisons.js";
import {
  continueWaitReason,
  gcdHeldReason,
  gcdHeldSeconds,
} from "./views/manual-format.js";

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
  const { duration, ...rest } = extra;
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
      phase: rest.phase ?? (over ? "review" : "decision"),
      slots: fight.slots,
      state,
      result: over ? fight.result() : null,
      ...rest,
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
  sameInstant: false,
});

export function createManualRun(store) {
  let fight = null;
  let snapshot = null;
  // After an on-GCD cast, getState() would run the GCD out. Keep the last
  // presented state and offer same-instant off-GCD casts until Continue
  // (James, 11 Nov 2026).
  let heldBase = null;
  let usedOffGcd = new Set();

  function slotMeta(abilityId) {
    return (fight?.slots ?? []).find((slot) => slot.abilityId === abilityId);
  }

  function isOnGcd(abilityId) {
    return slotMeta(abilityId)?.onGcd !== false;
  }

  function offGcdCastable(state) {
    return (state?.slots ?? []).filter((row) => {
      const meta = slotMeta(row.abilityId);
      return meta?.onGcd === false && row.castable;
    });
  }

  function heldState(base, used) {
    const reason = gcdHeldReason(gcdHeldSeconds(base));
    const waitReason = continueWaitReason();
    return {
      ...base,
      slots: (base.slots ?? []).map((row) => {
        const meta = slotMeta(row.abilityId);
        if (meta?.onGcd !== false) {
          return { ...row, castable: false, reason };
        }
        if (used.has(row.abilityId)) {
          return { ...row, castable: false };
        }
        return row;
      }),
      waits: (base.waits ?? []).map((wait) => ({
        ...wait,
        available: false,
        reason: waitReason,
      })),
    };
  }

  function closeHeld() {
    heldBase = null;
    usedOffGcd = new Set();
  }

  function start({ seed, duration, config }) {
    fight?.dispose();
    closeHeld();
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
    closeHeld();
    const prior = store.get().manual?.events ?? [];
    const incoming = tagIncoming(action.events ?? []);
    const events = action.ok ? [...prior, ...incoming] : prior;
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
      sameInstant: false,
      duration: snapshot.duration,
    });
    return action;
  }

  function applyHeld(action, abilityId) {
    const prior = store.get().manual?.events ?? [];
    const incoming = tagIncoming(action.events ?? []);
    const events = action.ok ? [...prior, ...incoming] : prior;
    if (action.ok && abilityId) {
      usedOffGcd.add(abilityId);
    }
    let phase = "decision";
    let blockedAbilityId = null;
    if (!action.ok) {
      phase = "blocked";
      blockedAbilityId = abilityId ?? null;
    } else if (
      incoming.some((event) => event.outcome === "crit" || event.procName)
    ) {
      phase = "crit";
    }
    store.update((current) => ({
      results: current.results,
      run: { ...current.run, state: "running" },
      manual: {
        ...current.manual,
        active: true,
        phase,
        slots: fight.slots,
        state: heldState(heldBase, usedOffGcd),
        events,
        lastAction: action,
        blockedAbilityId,
        sameInstant: true,
        result: null,
      },
    }));
    return action;
  }

  function continueGcd() {
    if (fight == null || heldBase == null) {
      return null;
    }
    const events = store.get().manual?.events ?? [];
    const lastAction = store.get().manual?.lastAction ?? null;
    closeHeld();
    publish(store, fight, {
      events,
      lastAction,
      blockedAbilityId: null,
      sameInstant: false,
      duration: snapshot.duration,
    });
    return true;
  }

  return {
    start,
    cast(abilityId) {
      if (fight == null || fight.isOver()) {
        return null;
      }
      if (heldBase != null) {
        if (isOnGcd(abilityId)) {
          const reason = gcdHeldReason(gcdHeldSeconds(heldBase));
          return applyHeld(
            {
              ok: false,
              reason,
              stopReason: null,
              advancedBy: 0,
              events: [],
            },
            abilityId,
          );
        }
        return applyHeld(fight.cast(abilityId), abilityId);
      }
      const before = store.get().manual?.state;
      const action = fight.cast(abilityId);
      if (
        action.ok &&
        isOnGcd(abilityId) &&
        !fight.isOver() &&
        offGcdCastable(before).length > 0
      ) {
        heldBase = before;
        usedOffGcd = new Set();
        return applyHeld(action, null);
      }
      return apply(action, abilityId);
    },
    wait(options) {
      if (fight == null || fight.isOver()) {
        return null;
      }
      if (heldBase != null) {
        return null;
      }
      return apply(fight.wait(options));
    },
    // Runs the held GCD out via getState() (James, 11 Nov 2026).
    continueGcd,
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
      closeHeld();
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
      closeHeld();
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
      closeHeld();
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
