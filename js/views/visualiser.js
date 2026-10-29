import { k } from "../../data/constants.js";
import { formatNumber } from "../charts.js";
import {
  applyGcdMeterAria,
  gcdReading,
  gcdReady,
  writeAria,
} from "../gcd-meter.js";
import { attachIconFallback } from "../icons.js";
import { spokenTenths } from "./run-model.js";

// The visualiser (#149, #150): combo points, energy, the GCD meter, the active
// buffs and debuffs, the skill cooldowns, the procs and the combat log. This
// view owns those elements and no others. It draws the plain slices the live
// feed puts in the store (js/live-feed.js: resources, gcd, effects, procs,
// spend, moment, log) each time the frame slice moves, the way the page has
// drawn every animation frame since before the split. It reads no engine
// object and holds no combat or timing rules.
//
// Phase 3 (#150, Fran's UX notes): an "AT CAP" tag and amber fill when the
// energy is full; the spent combo points outlined for k("ui.spendFlashSeconds")
// after a finisher, with "<finisher> · <spent>" under the meter; a duration bar
// under each timed effect, amber with one decimal under k("ui.auraLowSeconds")
// on an aura, a "×N" stacks badge and an aria-label; proc chips above the log
// and "↳" on a row a proc made; reduced motion from matchMedia; Left and Right
// step through the log while paused, with a text readout; and a role=status
// region that announces a buff coming up or going and the pause, at most one
// message every k("ui.announceIntervalSeconds"), only when "Announce key
// events" is ticked (off by default). `clock` (seconds) is for tests.
//
// #45 (Fran, Scout): every readout here is aria-live="off" and written only
// when its text changes; the meters' aria-valuenow and aria-valuetext too.
// The pause is said once, by #run-announce (js/views/controls.js): the key
// events queue clears on Pause, Finish and Stop. The log's hint is #log-hint,
// a description of the log and not live; #log-readout says only the
// arrow-step readings, in spoken words, while #log-step shows them.
export function createVisualiserView(doc, store, { clock } = {}) {
  const comboValue = doc.querySelector("#combo-value");
  const comboMeter = doc.querySelector("#combo-meter");
  const comboPointElements = doc.querySelectorAll(".combo-point");
  const energyValue = doc.querySelector("#energy-value");
  const energyMeter = doc.querySelector("#energy-meter");
  const energyFill = doc.querySelector("#energy-fill");
  const energyCap = doc.querySelector("#energy-cap");
  const comboSpend = doc.querySelector("#combo-spend");
  const procChips = doc.querySelector("#proc-chips");
  const procsEmpty = doc.querySelector("#procs-empty");
  const procItems = new Map();
  const logReadout = doc.querySelector("#log-readout");
  const logStep = doc.querySelector("#log-step");
  const logHint = doc.querySelector("#log-hint");
  const announceToggle = doc.querySelector("#announce-toggle");
  const liveAnnouncer = doc.querySelector("#live-announcer");
  const gcdValue = doc.querySelector("#gcd-value");
  const gcdMeter = doc.querySelector("#gcd-meter");
  const gcdFill = doc.querySelector("#gcd-fill");
  const gcdStatus = doc.querySelector("#gcd-status");
  const activeBuffs = doc.querySelector("#active-buffs");
  const activeBuffsEmpty = doc.querySelector("#active-buffs-empty");
  const activeDebuffs = doc.querySelector("#active-debuffs");
  const activeDebuffsEmpty = doc.querySelector("#active-debuffs-empty");
  const skillCooldowns = doc.querySelector("#skill-cooldowns");
  const skillCooldownsEmpty = doc.querySelector("#skill-cooldowns-empty");
  const cooldownItems = new Map();
  const buffItems = new Map();
  const debuffItems = new Map();
  const combatLog = doc.querySelector("#combat-log");
  const fightFrames = [...doc.querySelectorAll("[data-fight-frame]")];
  const combatLogScroll = doc.querySelector(".combat-log-scroll");
  const combatLogEmpty = doc.querySelector("#combat-log-empty");
  let lastRenderedCombatEventId = -1;
  let selectedRow = -1;
  const view = doc.defaultView;
  const now = clock ?? (() => (view?.performance ?? Date).now() / 1000);
  const announcer = createAnnouncer({
    now,
    enabled: () => announceToggle.checked === true,
    speak: (text) => {
      liveAnnouncer.textContent = text;
    },
    later: (wait, run) => view?.setTimeout?.(run, wait * 1000),
  });
  let lastMomentSeq = store.get().moment?.seq ?? 0;

  function redrawScene() {
    const { resources, gcd, effects, procs, spend, results, log } = store.get();
    const { comboPoints, energy } = resources;
    write(comboValue, `${comboPoints.value} / ${comboPoints.max}`);
    writeAria(comboMeter, {
      "aria-valuemax": comboPoints.max,
      "aria-valuenow": comboPoints.value,
      "aria-valuetext": `${comboPoints.value} of ${comboPoints.max}`,
    });
    const elapsed = spend === null ? Infinity : results.time - spend.time;
    const flashing = elapsed >= 0 && elapsed < k("ui.spendFlashSeconds");
    comboPointElements.forEach((point, index) => {
      point.classList.toggle("is-filled", index < comboPoints.value);
      point.classList.toggle(
        "is-spent",
        flashing && index >= spend.after && index < spend.before,
      );
    });
    const spendText = flashing
      ? `${spend.name} · ${spend.before - spend.after}`
      : "";
    write(comboSpend, spendText);
    const capped = energy.value >= energy.max;
    energyFill.classList.toggle("is-capped", capped);
    energyCap.hidden = !capped;
    const energyPercent = (energy.value / energy.max) * 100;
    const gcdPercent = (gcd.remaining / gcd.duration) * 100;
    const energyNow = Math.floor(energy.value);
    write(energyValue, `${energyNow} / ${energy.max}`);
    // The max moves only with talents: written when it changes.
    writeAria(energyMeter, {
      "aria-valuemax": energy.max,
      "aria-valuenow": energyNow,
      "aria-valuetext": `${energyNow} of ${energy.max}`,
    });
    energyFill.style.width = `${energyPercent}%`;
    write(gcdValue, `${gcdReading(gcd.remaining)}s`);
    // The meter's own ready test (#45), so "Ready" here and there agree.
    const gcdActive = !gcdReady(gcd.remaining);
    write(gcdStatus, gcdActive ? "On cooldown" : "Ready");
    gcdStatus.classList.toggle("is-active", gcdActive);
    applyGcdMeterAria(gcdMeter, gcdMeterReading(gcd));
    gcdFill.style.width = `${gcdPercent}%`;
    renderTimedEffects(
      effects.buffs,
      activeBuffs,
      buffItems,
      activeBuffsEmpty,
      true,
    );
    renderTimedEffects(
      effects.debuffs,
      activeDebuffs,
      debuffItems,
      activeDebuffsEmpty,
      true,
    );
    renderTimedEffects(
      effects.cooldowns,
      skillCooldowns,
      cooldownItems,
      skillCooldownsEmpty,
      false,
    );
    renderProcs(procs);
    renderCombatLog(log);
    announceMoment();
  }

  // Each list's order as last drawn, by its ids (U9 polish): the items are
  // put in place only when it changes.
  const drawnOrder = new Map();

  // #active-buffs, #active-debuffs and #skill-cooldowns are rewritten only
  // when their content changes (U9 polish, Fran's #220 check): an identical
  // frame writes nothing.
  function renderTimedEffects(effects, container, items, emptyState, isAura) {
    const activeEffects = effects
      .filter(({ remaining }) => remaining > 0)
      .sort((a, b) => b.remaining - a.remaining);
    const activeIds = new Set(activeEffects.map(({ id }) => id));

    items.forEach((item, id) => {
      if (!activeIds.has(id)) {
        item.element.remove();
        items.delete(id);
      }
    });

    activeEffects.forEach((effect) => {
      const { id, name, icon: iconSource } = effect;
      let item = items.get(id);
      if (!item) {
        const element = doc.createElement("div");
        element.className = "timed-effect";
        element.setAttribute("role", "listitem");
        element.title = name;

        if (iconSource) {
          const icon = doc.createElement("img");
          attachIconFallback(icon);
          icon.src = iconSource;
          icon.width = 32;
          icon.height = 32;
          icon.alt = name;
          element.append(icon);
        }

        const stacks = doc.createElement("span");
        stacks.className = "timed-effect-stacks";
        stacks.setAttribute("aria-hidden", "true");
        const bar = doc.createElement("span");
        bar.className = "timed-effect-bar";
        bar.setAttribute("aria-hidden", "true");
        const fill = doc.createElement("span");
        fill.className = "timed-effect-bar-fill";
        bar.append(fill);
        const time = doc.createElement("output");
        time.className = "timed-effect-time";
        time.setAttribute("aria-live", "off");
        element.append(stacks, bar, time);
        item = { element, time, stacks, fill };
        items.set(id, item);
      }

      const reading = timedEffectReading(effect, isAura);
      write(item.time, reading.time);
      const title = `${name}: ${reading.time}`;
      if (item.element.title !== title) {
        item.element.title = title;
      }
      writeAria(item.element, { "aria-label": reading.label });
      item.element.classList.toggle("is-low", reading.low);
      write(item.stacks, reading.stacks);
      setHidden(item.stacks, reading.stacks === "");
      const width = `${reading.percent}%`;
      if (item.width !== width) {
        item.width = width;
        item.fill.style.width = width;
      }
    });

    const order = activeEffects.map(({ id }) => id).join("\n");
    if (drawnOrder.get(container) !== order) {
      drawnOrder.set(container, order);
      container.append(...activeEffects.map(({ id }) => items.get(id).element));
    }
    setHidden(emptyState, activeEffects.length > 0);
  }

  // One chip per proc, in the order each first fired; a chip never moves.
  function renderProcs(procs) {
    procs.forEach(({ id, name, count }) => {
      let item = procItems.get(id);
      if (!item) {
        const element = doc.createElement("li");
        element.className = "proc-chip";
        procChips.append(element);
        item = { element, count: 0 };
        procItems.set(id, item);
      }
      if (item.count !== count) {
        item.count = count;
        item.element.textContent = `${name} ×${count}`;
      }
    });
    procsEmpty.hidden = procs.length > 0;
  }

  function announceMoment() {
    const { moment } = store.get();
    if (moment === null || moment.seq === lastMomentSeq) {
      announcer.flush();
      return;
    }
    lastMomentSeq = moment.seq;
    announcer.say(
      moment.change === "apply"
        ? `${moment.name} up`
        : `${moment.name} expired`,
    );
  }

  // #log-readout, the step announcer: emptied, then written on the next
  // frame, so the same words twice ("Start of log" at the start) are said
  // twice (U9 polish, as #run-announce does). One message per key press.
  let stepFrame = null;
  function sayStep(text) {
    if (stepFrame !== null) {
      view.cancelAnimationFrame?.(stepFrame);
      stepFrame = null;
    }
    logReadout.textContent = "";
    if (text === "") {
      return;
    }
    if (typeof view?.requestAnimationFrame !== "function") {
      logReadout.textContent = text;
      return;
    }
    stepFrame = view.requestAnimationFrame(() => {
      stepFrame = null;
      logReadout.textContent = text;
    });
  }

  // Paused, Left and Right step through the log rows (Left is earlier) and the
  // readout under the log says which; focus stays where it is. Home goes to
  // the earliest row and End to the latest (U9 polish, Fran's #220 check):
  // they say "Start of log. <the row>" or "End of log. <the row>" (Scout,
  // #221), and an arrow past either end says "Start of log" or "End of log"
  // alone, staying on the row. The log is newest first, so row 0 is the end.
  // Fran's #221 check: the row is scrolled into view, and once the log has
  // dropped rows the start is "Start of kept log (last N events)." with N
  // from k("log.maxEvents"). The log has dropped rows when its oldest kept
  // row is not the fight's first: row ids count up from FIRST_LOG_ROW_ID per
  // fight (Fran's #222 check, #200), so this holds from the first frame on.
  function step(key) {
    const { run, log } = store.get();
    const delta = { ArrowLeft: 1, ArrowRight: -1 }[key];
    const jump = { Home: "start", End: "end" }[key];
    if (
      run.state !== "paused" ||
      (delta === undefined && jump === undefined) ||
      log.length === 0
    ) {
      return false;
    }
    const first = log.length - 1;
    let next;
    let edge = null;
    if (jump !== undefined) {
      next = jump === "start" ? first : 0;
      edge = jump;
    } else if (selectedRow < 0) {
      next = 0;
    } else {
      next = selectedRow + delta;
      if (next > first || next < 0) {
        edge = next > first ? "start" : "end";
        next = Math.min(Math.max(next, 0), first);
      }
    }
    selectRow(next);
    combatLog.children[next]?.scrollIntoView?.({ block: "nearest" });
    // The hint stays the log's description, out of sight once a row shows.
    logHint.classList.toggle("visually-hidden", true);
    write(logStep, logRowReading(log[next]));
    // Home and End say the end and the row as one message (Scout, #221); an
    // arrow past an end says only the end.
    const spoken = logRowSpoken(log[next]);
    const label =
      edge === "start" && log[first].id > FIRST_LOG_ROW_ID
        ? `Start of kept log (last ${formatNumber(k("log.maxEvents"), 0)} events).`
        : LOG_EDGE[edge];
    if (edge === null) {
      sayStep(spoken);
    } else if (jump !== undefined) {
      sayStep(`${label}${label.endsWith(".") ? "" : "."} ${spoken}`);
    } else {
      sayStep(label);
    }
    return true;
  }

  function selectRow(index) {
    const rows = combatLog.children;
    if (selectedRow >= 0 && rows[selectedRow]) {
      rows[selectedRow].classList.toggle("is-selected", false);
      rows[selectedRow].removeAttribute?.("aria-current");
    }
    selectedRow = index;
    if (index >= 0 && rows[index]) {
      rows[index].classList.toggle("is-selected", true);
      rows[index].setAttribute("aria-current", "true");
    }
  }

  function onRunChange() {
    const { run } = store.get();
    // A stopped fight is discarded (#153): its last frame stays, dimmed,
    // until Run or Reset.
    const discarded = run.state === "idle" && (run.stoppedAt ?? null) !== null;
    for (const frame of fightFrames) {
      frame.classList.toggle("is-discarded", discarded);
    }
    // #run-announce says the pause, the finish and the stop: a key event
    // waiting in the queue is dropped, not said after them.
    if (run.state === "paused" || run.state === "finished" || discarded) {
      announcer.clear();
    }
    if (run.state === "paused") {
      write(logHint, LOG_HINT);
    } else {
      selectRow(-1);
      write(logHint, "");
    }
    logHint.classList.toggle("visually-hidden", false);
    write(logStep, "");
    sayStep("");
  }

  function renderCombatLog(log) {
    // A new fight (Run again, or Reset's empty fight, #153) starts its event
    // ids again: the old fight's rows go.
    const newest = log.length > 0 ? log[0].id : -1;
    if (newest < lastRenderedCombatEventId) {
      selectRow(-1);
      combatLog.replaceChildren(combatLogEmpty);
      lastRenderedCombatEventId = -1;
    }
    const newEvents = log.filter(
      (event) => event.id > lastRenderedCombatEventId,
    );
    if (newEvents.length === 0) {
      return;
    }

    const previousScrollHeight = combatLogScroll.scrollHeight;
    const isAtLatestEvents = combatLogScroll.scrollTop <= 1;
    if (combatLogEmpty.isConnected) {
      combatLogEmpty.remove();
    }
    newEvents
      .slice()
      .reverse()
      .forEach((event) => {
        const row = doc.createElement("li");
        row.className = "combat-log-entry";

        const time = doc.createElement("time");
        const totalSeconds = Math.floor(event.time);
        time.className = "combat-log-time";
        time.textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;

        const icon = doc.createElement("span");
        icon.className = `combat-log-icon ${event.type === "skill" ? "skill-icon" : "weapon-icon"}`;
        icon.setAttribute("aria-hidden", "true");
        if (event.type === "skill" && event.icon) {
          const image = doc.createElement("img");
          attachIconFallback(image);
          image.src = event.icon;
          image.width = 16;
          image.height = 16;
          image.alt = "";
          icon.append(image);
        } else {
          icon.textContent = event.type === "skill" ? "✦" : "⚔";
        }

        const name = doc.createElement("span");
        name.className = "combat-log-name";
        name.textContent = event.fromProc ? `↳ ${event.name}` : event.name;
        // The full name on hover, for a name a wide damage cuts short on a
        // phone (Fran's #222 check, #200).
        name.title = event.name;

        const damage = doc.createElement("span");
        damage.className = "combat-log-damage";
        // With commas, as the step line says it (Fran's #221 check).
        damage.textContent = formatNumber(Math.floor(event.damage), 0);

        const status = doc.createElement("span");
        status.className = `combat-log-status outcome-${event.outcome}`;
        status.textContent = event.status;

        row.append(time, icon, name, damage, status);
        combatLog.insertBefore(row, combatLog.firstChild);
        if (combatLog.children.length > k("log.maxEvents")) {
          combatLog.lastElementChild.remove();
        }
      });

    if (!isAtLatestEvents) {
      combatLogScroll.scrollTop +=
        combatLogScroll.scrollHeight - previousScrollHeight;
    }
    lastRenderedCombatEventId = Math.max(...newEvents.map((event) => event.id));
  }

  // Reduced motion: no spend flash or chip pop animation, read once and on
  // change. The global prefers-reduced-motion CSS block is the fallback.
  const motion = view?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const applyMotion = () => {
    doc.documentElement?.classList.toggle("reduce-motion", motion.matches);
  };
  if (motion) {
    applyMotion();
    motion.addEventListener?.("change", applyMotion);
  }

  combatLogScroll.addEventListener("keydown", (event) => {
    if (step(event.key)) {
      event.preventDefault();
    }
  });
  announceToggle.addEventListener("change", () => {
    if (!announceToggle.checked) {
      announcer.clear();
      liveAnnouncer.textContent = "";
    }
  });

  applyGcdMeterAria(gcdMeter, gcdMeterReading(store.get().gcd));
  return store.subscribe(({ changed }) => {
    if (changed.includes("frame")) {
      redrawScene();
    }
    if (changed.includes("run")) {
      onRunChange();
    }
  });
}

// What one timed effect shows: its time (one decimal when an aura runs low),
// the bar's width, the stacks badge and the label a screen reader reads.
export function timedEffectReading(
  { name, remaining, duration, stacks },
  isAura,
) {
  const low = isAura && remaining < k("ui.auraLowSeconds");
  const seconds = remaining.toFixed(low ? 1 : 0);
  const percent =
    duration > 0 ? Math.min(Math.max(remaining / duration, 0), 1) * 100 : 0;
  const stackText = `${stacks} ${stacks === 1 ? "stack" : "stacks"}`;
  const label = `${name}, ${seconds} ${seconds === "1" ? "second" : "seconds"} left`;
  return {
    time: `${seconds}s`,
    low,
    percent,
    stacks: stacks > 1 ? `×${stacks}` : "",
    label: isAura ? `${label}, ${stackText}` : label,
  };
}

// The log's description while paused (#150; Home and End, Fran's #221 check).
// A combat log row's id counts up from 0 in each fight (docs/events.md, the
// "hit" event's id), so a kept log whose oldest id is above this has dropped
// rows.
const FIRST_LOG_ROW_ID = 0;

export const LOG_HINT =
  "Paused. Left and Right arrow keys step through the log. Home and End jump to its start and end. Newest events are at the top.";

// What the step announcer says at the ends of the log (U9 polish).
const LOG_EDGE = { start: "Start of log", end: "End of log" };

// "00:41.2 · Sinister Strike · Crit · 1,412" for one log row: the damage
// with commas, as #log-readout says it (U9 polish, Fran's #220 check).
export function logRowReading({ time, name, status, damage }) {
  const tenths = Math.floor(time * 10);
  const minutes = Math.floor(tenths / 600);
  const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${seconds} · ${name} · ${status} · ${formatNumber(Math.floor(damage), 0)}`;
}

// "41.2 seconds, Sinister Strike, crit, 412 damage" (#45, Fran and Scout):
// what #log-readout says for the row #log-step shows.
export function logRowSpoken({ time, name, status, damage }) {
  return `${spokenTenths(time)}, ${name}, ${status.toLowerCase()}, ${formatNumber(Math.floor(damage), 0)} damage`;
}

// Writes `text` into `node` only when it differs from what this view last
// wrote there (#45). The first write always lands, as each frame's did
// before (the page's "0 / 5" markup is replaced by the first frame's).
const written = new WeakMap();

// Sets `hidden` only when it changes: setting it again is still a DOM write.
function setHidden(node, hidden) {
  if (node.hidden !== hidden) {
    node.hidden = hidden;
  }
}
function write(node, text) {
  if (written.get(node) !== text) {
    written.set(node, text);
    node.textContent = text;
  }
}

// At most one message every k("ui.announceIntervalSeconds") of now(); a
// message that comes sooner waits, and a newer one replaces it. Nothing is
// said, or kept, while enabled() is false.
export function createAnnouncer({ now, enabled, speak, later }) {
  let lastSpoken = -Infinity;
  let pending = null;
  let timer = null;

  function flush() {
    if (pending === null || !enabled()) {
      pending = null;
      return;
    }
    const wait = lastSpoken + k("ui.announceIntervalSeconds") - now();
    if (wait > 0) {
      timer ??=
        later?.(wait, () => {
          timer = null;
          flush();
        }) ?? null;
      return;
    }
    speak(pending);
    lastSpoken = now();
    pending = null;
  }

  return {
    say(text) {
      pending = text;
      flush();
    },
    flush,
    clear() {
      pending = null;
    },
  };
}

// applyGcdMeterAria (js/gcd-meter.js) takes the simulation's names for the GCD.
function gcdMeterReading({ remaining, duration }) {
  return { gcd: remaining, gcdDuration: duration };
}
