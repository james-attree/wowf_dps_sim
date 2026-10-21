import { Rogue } from "./rogue.js";
import { Simulation } from "./simulation.js";

const rogue = new Rogue();
const simulation = new Simulation(rogue);
const comboValue = document.querySelector("#combo-value");
const comboMeter = document.querySelector("#combo-meter");
const comboPoints = document.querySelectorAll(".combo-point");
const energyValue = document.querySelector("#energy-value");
const energyMeter = document.querySelector("#energy-meter");
const energyFill = document.querySelector("#energy-fill");
const gcdValue = document.querySelector("#gcd-value");
const gcdMeter = document.querySelector("#gcd-meter");
const gcdFill = document.querySelector("#gcd-fill");
const gcdStatus = document.querySelector("#gcd-status");
const timeValue = document.querySelector("#time-value");
const damageValue = document.querySelector("#damage-value");
const dpsValue = document.querySelector("#dps-value");
const combatLog = document.querySelector("#combat-log");
const combatLogScroll = document.querySelector(".combat-log-scroll");
const combatLogEmpty = document.querySelector("#combat-log-empty");
const pauseButton = document.querySelector("#pause-button");
const pauseIcon = document.querySelector("#pause-icon");
const pauseLabel = document.querySelector("#pause-label");
const simulationStatus = document.querySelector("#simulation-status");
const simulationStatusLabel = document.querySelector("#simulation-status-label");
let lastRenderedCombatEventId = -1;
let isPaused = false;
let animationFrameId;

function redrawScene(rogue) {
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
  gcdMeter.setAttribute("aria-valuenow", simulation.gcd.toFixed(1));
  gcdFill.style.width = `${gcdPercent}%`;
  const elapsedSeconds = Math.floor(simulation.currentTime);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  timeValue.value = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  timeValue.textContent = timeValue.value;
  damageValue.value = String(Math.floor(simulation.damageDone));
  damageValue.textContent = damageValue.value;
  const dps = simulation.currentTime > 0 ? simulation.damageDone / simulation.currentTime : 0;
  dpsValue.value = dps.toFixed(0);
  dpsValue.textContent = dpsValue.value;
  renderCombatLog();
}

function renderCombatLog() {
  const newEvents = simulation.combatLog.filter((event) => event.id > lastRenderedCombatEventId);
  if (newEvents.length === 0) {
    return;
  }

  const previousScrollHeight = combatLogScroll.scrollHeight;
  const isAtLatestEvents = combatLogScroll.scrollTop <= 1;
  if (combatLogEmpty.isConnected) {
    combatLogEmpty.remove();
  }
  newEvents.slice().reverse().forEach((event) => {
    const row = document.createElement("li");
    row.className = "combat-log-entry";

    const time = document.createElement("time");
    const totalSeconds = Math.floor(event.time);
    time.className = "combat-log-time";
    time.textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;

    const icon = document.createElement("span");
    icon.className = `combat-log-icon ${event.type === "skill" ? "skill-icon" : "weapon-icon"}`;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = event.type === "skill" ? "✦" : "⚔";

    const name = document.createElement("span");
    name.className = "combat-log-name";
    name.textContent = event.name;

    const damage = document.createElement("span");
    damage.className = "combat-log-damage";
    damage.textContent = String(Math.floor(event.damage));

    const status = document.createElement("span");
    status.className = `combat-log-status outcome-${event.outcome}`;
    status.textContent = event.status;

    row.append(time, icon, name, damage, status);
    combatLog.insertBefore(row, combatLog.firstChild);
    if (combatLog.children.length > 100) {
      combatLog.lastElementChild.remove();
    }
  });

  if (!isAtLatestEvents) {
    combatLogScroll.scrollTop += combatLogScroll.scrollHeight - previousScrollHeight;
  }
  lastRenderedCombatEventId = Math.max(...newEvents.map((event) => event.id));
}

function update(time) {
  if (isPaused) {
    return;
  }

  simulation.update(time);

  redrawScene(rogue);

  animationFrameId = requestAnimationFrame(update);
}

pauseButton.addEventListener("click", () => {
  isPaused = !isPaused;
  pauseButton.setAttribute("aria-pressed", String(isPaused));
  pauseIcon.textContent = isPaused ? "▶" : "Ⅱ";
  pauseLabel.textContent = isPaused ? "Resume" : "Pause";
  simulationStatusLabel.textContent = isPaused ? "Paused" : "Live";
  simulationStatus.classList.toggle("is-paused", isPaused);

  if (isPaused) {
    cancelAnimationFrame(animationFrameId);
    return;
  }

  simulation.lastFrameTime = performance.now();
  animationFrameId = requestAnimationFrame(update);
});

animationFrameId = requestAnimationFrame(update);
