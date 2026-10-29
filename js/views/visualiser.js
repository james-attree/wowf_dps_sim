import { k } from "../../data/constants.js";
import { applyGcdMeterAria } from "../gcd-meter.js";
import { attachIconFallback } from "../icons.js";

// The visualiser (#149): combo points, energy, the GCD meter, the active buffs
// and debuffs, the skill cooldowns and the combat log. This view owns those
// elements and no others. It draws the live fight (the fight slice: the
// engine's rogue and simulation) each time the frame slice moves, the way the
// page has drawn it every animation frame since before the split. It holds no
// combat or timing rules.
export function createVisualiserView(doc, store) {
  const { rogue, simulation } = store.get().fight;
  const skillsById = new Map(
    Object.values(rogue.abilities).map((skill) => [skill.id, skill]),
  );
  const comboValue = doc.querySelector("#combo-value");
  const comboMeter = doc.querySelector("#combo-meter");
  const comboPoints = doc.querySelectorAll(".combo-point");
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
    comboValue.value = `${rogue.comboPoints} / ${rogue.maxComboPoints}`;
    comboValue.textContent = comboValue.value;
    comboMeter.setAttribute("aria-valuenow", String(rogue.comboPoints));
    comboPoints.forEach((point, index) => {
      point.classList.toggle("is-filled", index < rogue.comboPoints);
    });
    const energyPercent = (rogue.energy / rogue.maxEnergy) * 100;
    const gcdPercent = (simulation.gcd / simulation.gcdDuration) * 100;
    energyValue.value = `${Math.floor(rogue.energy)} / ${rogue.maxEnergy}`;
    energyValue.textContent = energyValue.value;
    energyMeter.setAttribute("aria-valuenow", String(Math.floor(rogue.energy)));
    energyFill.style.width = `${energyPercent}%`;
    gcdValue.value = `${simulation.gcd.toFixed(1)}s`;
    gcdValue.textContent = gcdValue.value;
    const gcdActive = simulation.gcd > 0;
    gcdStatus.textContent = gcdActive ? "On cooldown" : "Ready";
    gcdStatus.classList.toggle("is-active", gcdActive);
    applyGcdMeterAria(gcdMeter, simulation);
    gcdFill.style.width = `${gcdPercent}%`;
    renderTimedEffects(
      simulation.activeBuffs,
      activeBuffs,
      buffItems,
      activeBuffsEmpty,
    );
    renderTimedEffects(
      simulation.activeDebuffs,
      activeDebuffs,
      debuffItems,
      activeDebuffsEmpty,
    );
    renderTimedEffects(
      simulation.cooldowns,
      skillCooldowns,
      cooldownItems,
      skillCooldownsEmpty,
    );
    renderCombatLog();
  }

  function renderTimedEffects(effects, container, items, emptyState) {
    const activeEffects = Object.entries(effects)
      .map(([id, effect]) => {
        // An aura is a record with its own name and icon. A cooldown is the
        // seconds left, and the skill with that id has the name and icon.
        const isAura = typeof effect === "object";
        const skill = skillsById.get(id);
        return {
          id,
          name: isAura ? effect.name : skill?.name,
          icon: isAura ? effect.icon : skill?.icon,
          remaining: isAura ? effect.duration : effect,
        };
      })
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

  function renderCombatLog() {
    const newEvents = simulation.combatLog.filter(
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

  applyGcdMeterAria(gcdMeter, simulation);
  return store.subscribe(({ changed }) => {
    if (changed.includes("frame")) {
      redrawScene();
    }
  });
}
