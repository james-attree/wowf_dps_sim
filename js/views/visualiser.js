import { k } from "../../data/constants.js";
import { applyGcdMeterAria } from "../gcd-meter.js";
import { attachIconFallback } from "../icons.js";

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
    comboValue.value = `${comboPoints.value} / ${comboPoints.max}`;
    comboValue.textContent = comboValue.value;
    comboMeter.setAttribute("aria-valuenow", String(comboPoints.value));
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
    if (comboSpend.textContent !== spendText) {
      comboSpend.textContent = spendText;
    }
    const capped = energy.value >= energy.max;
    energyFill.classList.toggle("is-capped", capped);
    energyCap.hidden = !capped;
    const energyPercent = (energy.value / energy.max) * 100;
    const gcdPercent = (gcd.remaining / gcd.duration) * 100;
    energyValue.value = `${Math.floor(energy.value)} / ${energy.max}`;
    energyValue.textContent = energyValue.value;
    energyMeter.setAttribute("aria-valuenow", String(Math.floor(energy.value)));
    energyFill.style.width = `${energyPercent}%`;
    gcdValue.value = `${gcd.remaining.toFixed(1)}s`;
    gcdValue.textContent = gcdValue.value;
    const gcdActive = gcd.remaining > 0;
    gcdStatus.textContent = gcdActive ? "On cooldown" : "Ready";
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
        element.append(stacks, bar, time);
        item = { element, time, stacks, fill };
        items.set(id, item);
      }

      const reading = timedEffectReading(effect, isAura);
      item.time.value = reading.time;
      item.time.textContent = item.time.value;
      item.element.title = `${name}: ${item.time.value}`;
      item.element.setAttribute("aria-label", reading.label);
      item.element.classList.toggle("is-low", reading.low);
      item.stacks.textContent = reading.stacks;
      item.stacks.hidden = reading.stacks === "";
      item.fill.style.width = `${reading.percent}%`;
      container.append(item.element);
    });

    emptyState.hidden = activeEffects.length > 0;
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

  // Paused, Left and Right step through the log rows (Left is earlier) and the
  // readout under the log says which; focus stays where it is.
  function step(key) {
    const { run, log } = store.get();
    const delta = { ArrowLeft: 1, ArrowRight: -1 }[key];
    if (run.state !== "paused" || delta === undefined || log.length === 0) {
      return false;
    }
    const next =
      selectedRow < 0
        ? 0
        : Math.min(Math.max(selectedRow + delta, 0), log.length - 1);
    selectRow(next);
    logReadout.textContent = logRowReading(log[next]);
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
    const { run, results } = store.get();
    if (run.state === "paused") {
      logReadout.textContent =
        "Paused. Left and Right arrow keys step through the log.";
      announcer.say(pausedReading(results));
    } else {
      selectRow(-1);
      logReadout.textContent = "";
    }
  }

  function renderCombatLog(log) {
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

        const damage = doc.createElement("span");
        damage.className = "combat-log-damage";
        damage.textContent = String(Math.floor(event.damage));

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

// "00:41.2 · Sinister Strike · Crit · 412" for one log row.
export function logRowReading({ time, name, status, damage }) {
  const tenths = Math.floor(time * 10);
  const minutes = Math.floor(tenths / 600);
  const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${seconds} · ${name} · ${status} · ${Math.floor(damage)}`;
}

// "Paused at 01:23, 18,450 damage, 222 DPS", with the results view's sums.
export function pausedReading({ time, damage }) {
  const totalSeconds = Math.floor(time);
  const clock = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  const dps = time > 0 ? Math.floor(damage / time) : 0;
  const total = Math.floor(damage).toLocaleString("en-GB");
  return `Paused at ${clock}, ${total} damage, ${dps.toLocaleString("en-GB")} DPS`;
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
