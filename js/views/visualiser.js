import { k } from "../../data/constants.js";
import { applyGcdMeterAria } from "../gcd-meter.js";
import { attachIconFallback } from "../icons.js";

// The visualiser (#149, #150): combo points, energy, the GCD meter, the active
// buffs and debuffs, the skill cooldowns and the combat log. This view owns
// those elements and no others. It draws the plain slices the live feed puts
// in the store (js/live-feed.js: resources, gcd, effects, log) each time the
// frame slice moves, the way the page has drawn every animation frame since
// before the split. It reads no engine object and holds no combat or timing
// rules.
export function createVisualiserView(doc, store) {
  const comboValue = doc.querySelector("#combo-value");
  const comboMeter = doc.querySelector("#combo-meter");
  const comboPointElements = doc.querySelectorAll(".combo-point");
  const energyValue = doc.querySelector("#energy-value");
  const energyMeter = doc.querySelector("#energy-meter");
  const energyFill = doc.querySelector("#energy-fill");
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

  function redrawScene() {
    const { resources, gcd, effects, log } = store.get();
    const { comboPoints, energy } = resources;
    comboValue.value = `${comboPoints.value} / ${comboPoints.max}`;
    comboValue.textContent = comboValue.value;
    comboMeter.setAttribute("aria-valuenow", String(comboPoints.value));
    comboPointElements.forEach((point, index) => {
      point.classList.toggle("is-filled", index < comboPoints.value);
    });
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
    renderTimedEffects(effects.buffs, activeBuffs, buffItems, activeBuffsEmpty);
    renderTimedEffects(
      effects.debuffs,
      activeDebuffs,
      debuffItems,
      activeDebuffsEmpty,
    );
    renderTimedEffects(
      effects.cooldowns,
      skillCooldowns,
      cooldownItems,
      skillCooldownsEmpty,
    );
    renderCombatLog(log);
  }

  function renderTimedEffects(effects, container, items, emptyState) {
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

    activeEffects.forEach(({ id, name, icon: iconSource, remaining }) => {
      let item = items.get(id);
      if (!item) {
        const element = doc.createElement("div");
        element.className = "timed-effect";
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

        const time = doc.createElement("output");
        time.className = "timed-effect-time";
        element.append(time);
        item = { element, time };
        items.set(id, item);
      }

      item.time.value = `${remaining.toFixed(0)}s`;
      item.time.textContent = item.time.value;
      item.element.title = `${name}: ${item.time.value}`;
      container.append(item.element);
    });

    emptyState.hidden = activeEffects.length > 0;
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
        name.textContent = event.name;

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

  applyGcdMeterAria(gcdMeter, gcdMeterReading(store.get().gcd));
  return store.subscribe(({ changed }) => {
    if (changed.includes("frame")) {
      redrawScene();
    }
  });
}

// applyGcdMeterAria (js/gcd-meter.js) takes the simulation's names for the GCD.
function gcdMeterReading({ remaining, duration }) {
  return { gcd: remaining, gcdDuration: duration };
}
