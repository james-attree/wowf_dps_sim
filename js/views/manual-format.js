// Pure formatters and combat-text rules for the Manual fight board
// (Fran spec §2.6, §2.7, §3.3, §3.4). No engine imports.
import { formatNumber } from "../charts.js";
import { iconUrl, spellIconUrl } from "../icons.js";
import { clock, remainingTime, spokenTenths } from "./run-model.js";
import { logRowReading } from "./visualiser.js";

export const ENERGY_WAIT_TARGET = 40;
export const TIME_WAIT_SECONDS = 0.5;
export const HIT_SAMPLE = 5;
export const LARGE_HIT_RATIO = 1.5;
export const TENTHS = 10;
export const TENTHS_PER_MINUTE = 600;
export const CLOCK_PAD = 2;
export const TENTHS_PAD = 4;
export const FLOAT_LIMIT = 3;
export const KEY_SLOTS = 10;
export const PERCENT = 100;
export const DPS_DECIMALS = 1;
// Off-GCD slots that have been picked but not yet fired (James, 12 Nov 2026).
export const ARMED_LABEL = "Armed";
export const INTEGER_DECIMALS = 0;
export const EMPTY_TRAY_MIN_REM = 0.8125;
export const EMPTY_TRAY_MAX_REM = 0.875;

const LANDED = new Set(["hit", "crit", "glance"]);
const AUTO_OR_ABILITY = new Set(["ability", "white-mh", "white-oh"]);

// Glyphs are keyed by ability id, not display name (lint). Spec §5.1.
export const SLOT_GLYPHS = Object.freeze({
  premeditation: "Pm",
  "sinister-strike": "SS",
  eviscerate: "Ev",
  "adrenaline-rush": "AR",
  "slice-and-dice": "SD",
  "ghostly-strike": "GS",
  backstab: "BS",
  ambush: "Am",
  mutilate: "Mu",
  "blade-flurry": "BF",
  rupture: "Ru",
  garrote: "Ga",
  hemorrhage: "He",
  "cold-blood": "CB",
  "blood-fury": "Fu",
  "elunes-light": "EL",
  berserking: "Be",
  eureka: "Eu",
  shank: "Sk",
  "expose-armor": "EA",
  preparation: "Pr",
  "death-mark": "DM",
});

export function glyphFor(abilityId, name = "") {
  if (Object.hasOwn(SLOT_GLYPHS, abilityId)) {
    return SLOT_GLYPHS[abilityId];
  }
  const parts = String(name)
    .replace(/[^A-Za-z ]/g, " ")
    .trim()
    .split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return String(name).slice(0, 2).toUpperCase() || "?";
}

// Same tenths math as logRowReading (js/views/visualiser.js).
export function elapsedClock(seconds) {
  const tenths = Math.floor(Math.max(seconds, 0) * TENTHS);
  const minutes = Math.floor(tenths / TENTHS_PER_MINUTE);
  const rest = ((tenths % TENTHS_PER_MINUTE) / TENTHS)
    .toFixed(1)
    .padStart(TENTHS_PAD, "0");
  return `${String(minutes).padStart(CLOCK_PAD, "0")}:${rest}`;
}

export function durationClock(seconds) {
  if (seconds === Math.floor(seconds)) {
    return clock(seconds);
  }
  return elapsedClock(seconds);
}

export function headerClock(elapsed, duration) {
  return `${elapsedClock(elapsed)} / ${durationClock(duration)}`;
}

export function remainingClock(left, duration) {
  return `Remaining ${elapsedClock(left)} / ${durationClock(duration)}`;
}

export function headerClockSpoken(elapsed, duration) {
  return `Elapsed ${spokenTenths(elapsed)} of ${spokenTenths(duration)}.`;
}

export function mockHealthFill(elapsed, duration) {
  if (!(duration > 0)) {
    return 1;
  }
  return Math.max(0, 1 - elapsed / duration);
}

export const MOCK_HEALTH_LABEL = "Mock health (not simulated)";
export const MOCK_HEALTH_ALT =
  "Decorative mock health bar, illustrative only. It drains with remaining fight duration; it is not simulated health or damage.";

export function waitLabel(wait, slots, now) {
  if (wait.kind === "energy") {
    return "Wait to 40 energy";
  }
  if (wait.kind === "time") {
    return "Wait 0.5 s";
  }
  if (!wait.available || wait.abilityId == null) {
    return "Wait until a cooldown is ready";
  }
  const slot = slots.find((item) => item.abilityId === wait.abilityId);
  const name = slot?.name ?? "";
  const left = Math.max(0, (wait.readyAt ?? now) - now);
  return `Wait until ${name} ready (${remainingTime(left)})`;
}

export function slotCooldownText(seconds) {
  if (!(seconds > 0)) {
    return "";
  }
  return clock(seconds);
}

export function isAbilityOrAutoHit(event) {
  return (
    event.kind === "damage" &&
    event.amount > 0 &&
    LANDED.has(event.outcome) &&
    AUTO_OR_ABILITY.has(event.source)
  );
}

export function landedHits(events) {
  return events.filter(isAbilityOrAutoHit);
}

export function isLargeHit(event, hitsIncludingThis) {
  if (event.outcome === "crit") {
    return true;
  }
  if (!isAbilityOrAutoHit(event)) {
    return false;
  }
  if (hitsIncludingThis.length < HIT_SAMPLE) {
    return false;
  }
  const total = hitsIncludingThis.reduce(
    (sum, item) => sum + Math.floor(item.amount),
    0,
  );
  const mean = total / hitsIncludingThis.length;
  return Math.floor(event.amount) >= LARGE_HIT_RATIO * mean;
}

export function damageText(amount) {
  return formatNumber(Math.floor(amount), INTEGER_DECIMALS);
}

export function wellCopy(event) {
  if (event.kind === "blocked") {
    return `Blocked · ${event.name} — ${event.reason}.`;
  }
  if (event.kind === "aura" && event.stacks != null) {
    return `${event.name} · ${event.stacks} stacks`;
  }
  if (event.kind === "cp" && event.procName) {
    return `${event.procName} · +1 combo point`;
  }
  if (event.kind === "proc" && event.procName && event.amount == null) {
    return `${event.procName} · +1 combo point`;
  }
  if (isPoisonHit(event)) {
    if (!(event.amount > 0)) {
      return null;
    }
    const crit = event.outcome === "crit" ? "CRIT " : "";
    return `${event.procName ?? event.name} · ${crit}${damageText(event.amount)}`;
  }
  if (event.procName && event.kind === "damage") {
    const crit = event.outcome === "crit" ? "CRIT " : "";
    return `${event.procName} · extra attack ${crit}${damageText(event.amount)}`;
  }
  if (event.kind === "damage") {
    if (event.resisted) {
      return `${event.name} Resist`;
    }
    if (event.outcome === "miss") {
      return `${event.name} miss`;
    }
    if (event.outcome === "dodge") {
      return `${event.name} dodge`;
    }
    if (event.outcome === "parry") {
      return `${event.name} parry`;
    }
    if (event.outcome === "crit") {
      return `CRIT ${damageText(event.amount)} · ${event.name}`;
    }
    if (event.outcome === "hit" || event.outcome === "glance") {
      return `${event.name} hit ${damageText(event.amount)}`;
    }
  }
  return null;
}

export function isPoisonHit(event) {
  return event.source === "poison" || event.poisonProc === true;
}

function damageFloat(event) {
  const amount = Math.floor(event.amount ?? 0);
  if (!(amount > 0)) {
    return null;
  }
  if (event.outcome === "crit") {
    return { text: `${damageText(event.amount)}!`, tone: "crit" };
  }
  return { text: damageText(event.amount), tone: "hit" };
}

// A damaging proc yields a name float and a separate damage float (§3.3).
export function floatCopies(event, hitsIncludingThis) {
  if (event.kind === "proc" && event.procName && event.amount == null) {
    return [{ text: `${event.procName}!`, tone: "proc" }];
  }
  if (event.kind === "damage" && (isPoisonHit(event) || event.procName)) {
    const damage = damageFloat(event);
    if (damage == null) {
      return [];
    }
    const name = event.procName ?? event.name;
    const copies = [];
    if (name) {
      copies.push({ text: `${name}!`, tone: "proc" });
    }
    copies.push(damage);
    return copies;
  }
  if (event.kind !== "damage" || !(event.amount > 0)) {
    return [];
  }
  if (
    event.outcome === "miss" ||
    event.outcome === "dodge" ||
    event.outcome === "parry"
  ) {
    return [];
  }
  if (event.kind === "tick") {
    return [];
  }
  if (event.outcome === "crit") {
    return [{ text: `${damageText(event.amount)}!`, tone: "crit" }];
  }
  if (!isAbilityOrAutoHit(event)) {
    return [];
  }
  const large = isLargeHit(event, hitsIncludingThis);
  return [
    {
      text: damageText(event.amount),
      tone: large ? "large" : "hit",
    },
  ];
}

export function floatCopy(event, hitsIncludingThis) {
  return floatCopies(event, hitsIncludingThis)[0] ?? null;
}

const ICON_NAME = /^[a-z0-9_]+$/;

export function slotIconSrc(slot, resolve = iconUrl) {
  return slot.iconKey ? resolve(slot.iconKey) : null;
}

export function auraIconSrc(
  entry,
  resolve = iconUrl,
  spellResolve = spellIconUrl,
) {
  if (typeof entry.icon === "string" && ICON_NAME.test(entry.icon)) {
    return resolve(entry.icon);
  }
  if (entry.name) {
    return spellResolve(entry.name);
  }
  return null;
}

export function slotAccessibleName(key, name, reason, armed = false) {
  const lead = key ? `${key} ${name}` : name;
  if (armed) {
    return reason
      ? `${lead} ${ARMED_LABEL} ${reason}`
      : `${lead} ${ARMED_LABEL}`;
  }
  return reason ? `${lead} ${reason}` : lead;
}

export function disabledWaitReason(wait) {
  if (wait.available) {
    return null;
  }
  return wait.reason?.text ?? "";
}

export function wellIsCrit(manual) {
  if (manual.phase === "blocked") {
    return false;
  }
  if (manual.lastAction?.ok && manual.lastAction.stopReason) {
    return false;
  }
  return latestWellEvent(manual.events ?? [])?.outcome === "crit";
}

export function reviewBreakdownRows(result) {
  const duration = result.duration ?? 0;
  return Object.entries(result.abilities ?? {})
    .map(([name, row]) => {
      const damage = row.damage ?? 0;
      const dps = duration > 0 ? damage / duration : 0;
      return {
        name,
        damage,
        dps,
        text: `${name} · ${formatNumber(damage, INTEGER_DECIMALS)} · ${formatNumber(dps, DPS_DECIMALS)} DPS`,
      };
    })
    .sort((a, b) => b.damage - a.damage);
}

export function reviewTimingRows(result) {
  const log = [...(result.log ?? [])].reverse();
  return log
    .filter((row) => row?.name)
    .map((row) => ({
      time: row.time,
      name: row.name,
      text: `${elapsedClock(row.time)} ${row.name}`,
    }));
}

export function announceCopy(event) {
  if (event.kind === "blocked") {
    return `Blocked, ${event.name}, ${event.reason}`;
  }
  if (event.kind === "damage" && event.outcome === "crit") {
    return `${event.name}, crit, ${damageText(event.amount)}`;
  }
  if (event.kind === "damage" && event.outcome === "hit") {
    return `${event.name}, hit`;
  }
  if (event.procName) {
    return event.procName;
  }
  return null;
}

export function latestWellEvent(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (wellCopy(events[i])) {
      return events[i];
    }
  }
  return null;
}

export function latestAnnouncement(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const copy = announceCopy(events[i]);
    if (copy) {
      return copy;
    }
  }
  return null;
}

function slotName(manual, abilityId) {
  return (
    (manual.slots ?? []).find((slot) => slot.abilityId === abilityId)?.name ??
    ""
  );
}

export function wellLine(manual) {
  if (manual.phase === "blocked" && manual.lastAction?.reason) {
    return {
      prompt: `Blocked · ${slotName(manual, manual.blockedAbilityId)} — ${manual.lastAction.reason.text}.`,
      event: "",
    };
  }
  if (manual.lastAction?.ok && manual.lastAction.stopReason) {
    return {
      prompt: "Your decision · GCD free",
      event: manual.lastAction.stopReason.text,
    };
  }
  const last = latestWellEvent(manual.events ?? []);
  return {
    prompt: "Your decision · GCD free",
    event: last ? (wellCopy(last) ?? "") : "",
  };
}

export function announceLine(manual) {
  const skipped = (manual.skipped ?? [])
    .map((item) => item.reason)
    .filter(Boolean)
    .join(" ");
  if (manual.lastAction && !manual.lastAction.ok && manual.lastAction.reason) {
    const blocked = `Blocked, ${slotName(manual, manual.blockedAbilityId)}, ${manual.lastAction.reason.text}`;
    return skipped ? `${skipped} ${blocked}` : blocked;
  }
  let line;
  if (manual.lastAction?.ok && manual.lastAction.stopReason) {
    const stop = manual.lastAction.stopReason.text;
    if (manual.phase === "review" && manual.result) {
      line = `${stop} Fight ended. ${manual.result.dps.toFixed(DPS_DECIMALS)} DPS.`;
    } else {
      line = stop;
    }
  } else if (manual.phase === "review" && manual.result) {
    line = `Fight ended. ${manual.result.dps.toFixed(DPS_DECIMALS)} DPS.`;
  } else {
    line = latestAnnouncement(manual.events ?? []) ?? "";
  }
  return skipped ? (line ? `${skipped} ${line}` : skipped) : line;
}

// logRowReading is imported so a typo in the tenths math can be compared in tests.
export { logRowReading };
