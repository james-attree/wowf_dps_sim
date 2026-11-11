// Manual fight board view (#348, B1). Draws the store's `manual` slice and
// calls host actions. No engine imports.
import { attachIconFallback, iconUrl } from "../icons.js";
import {
  ENERGY_WAIT_TARGET,
  FLOAT_LIMIT,
  KEY_SLOTS,
  MOCK_HEALTH_ALT,
  MOCK_HEALTH_LABEL,
  PERCENT,
  TIME_WAIT_SECONDS,
  DPS_DECIMALS,
  announceLine,
  elapsedClock,
  floatCopy,
  glyphFor,
  headerClock,
  headerClockSpoken,
  landedHits,
  mockHealthFill,
  remainingClock,
  slotCooldownText,
  waitLabel,
  wellLine,
} from "./manual-format.js";

const KEYS = "1234567890";

function el(html, name) {
  return html.getElementById(name);
}

function isTyping(target) {
  const tag = target?.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target?.isContentEditable === true
  );
}

function reducedMotion(html) {
  const root = html.documentElement;
  if (root?.classList?.contains("reduce-motion")) {
    return true;
  }
  return html.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
    ?.matches;
}

function setDisabled(button, disabled, reason) {
  if (disabled) {
    button.setAttribute("aria-disabled", "true");
  } else {
    button.removeAttribute("aria-disabled");
  }
  if (reason) {
    button.dataset.reason = reason;
  } else {
    delete button.dataset.reason;
  }
}

function fillBar(node, slots, state, actions, blockedId, html) {
  node.replaceChildren();
  const live = state?.slots ?? [];
  slots.forEach((slot, index) => {
    const row = live.find((item) => item.abilityId === slot.abilityId);
    const button = html.createElement("button");
    button.type = "button";
    button.className = "manual-slot";
    button.dataset.abilityId = slot.abilityId;
    if (index < KEY_SLOTS) {
      button.dataset.key = KEYS[index];
    }
    const blocked = blockedId === slot.abilityId;
    if (blocked) {
      button.classList.add("is-blocked");
    }
    const reason = row?.reason?.text ?? "";
    const castable = row?.castable !== false;
    setDisabled(button, !castable, reason);
    const key = html.createElement("span");
    key.className = "manual-slot-key";
    key.textContent = index < KEY_SLOTS ? KEYS[index] : "";
    const well = html.createElement("span");
    well.className = "manual-slot-icon";
    const glyph = html.createElement("span");
    glyph.className = "manual-slot-glyph";
    glyph.textContent = glyphFor(slot.abilityId, slot.name);
    well.append(glyph);
    if (slot.iconKey) {
      const img = html.createElement("img");
      img.alt = "";
      attachIconFallback(img);
      img.addEventListener("error", () => {
        if (img.hidden) {
          img.hidden = false;
          img.style.display = "none";
        }
      });
      img.src = slot.icon ?? iconUrl(slot.iconKey);
      well.prepend(img);
    } else {
      well.classList.add("is-glyph");
    }
    const name = html.createElement("span");
    name.className = "manual-slot-name";
    name.textContent = slot.name;
    const note = html.createElement("span");
    note.className = "manual-slot-note";
    const cd = row?.cooldownRemaining ?? 0;
    note.textContent = reason || slotCooldownText(cd);
    if (reason) {
      const descId = `manual-slot-reason-${slot.abilityId}`;
      note.id = descId;
      button.setAttribute("aria-describedby", descId);
    }
    button.setAttribute(
      "aria-label",
      reason ? `${slot.name}, ${reason}` : slot.name,
    );
    button.append(key, well, name, note);
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") === "true") {
        actions.cast(slot.abilityId);
        return;
      }
      actions.cast(slot.abilityId);
    });
    node.append(button);
  });
}

function fillWaits(node, state, slots, actions, html) {
  node.replaceChildren();
  for (const wait of state.waits ?? []) {
    const button = html.createElement("button");
    button.type = "button";
    button.className = "manual-wait";
    button.dataset.waitKind = wait.kind;
    const label = waitLabel(wait, slots, state.time);
    const text = html.createElement("span");
    text.className = "manual-wait-label";
    text.textContent = label;
    button.append(text);
    const reason = wait.reason?.text ?? "";
    if (!wait.available) {
      setDisabled(button, true, reason);
      const note = html.createElement("span");
      note.className = "manual-wait-reason";
      note.id = `manual-wait-reason-${wait.kind}`;
      note.textContent = reason;
      button.append(note);
      button.setAttribute("aria-describedby", note.id);
    }
    button.addEventListener("click", () => {
      if (wait.kind === "energy") {
        actions.wait({
          kind: "energy",
          target: wait.target ?? ENERGY_WAIT_TARGET,
        });
      } else if (wait.kind === "cooldown") {
        actions.wait({ kind: "cooldown" });
      } else {
        actions.wait({
          kind: "time",
          seconds: wait.seconds ?? TIME_WAIT_SECONDS,
        });
      }
    });
    node.append(button);
  }
}

function fillTray(node, entries, emptyText) {
  node.replaceChildren();
  if (entries.length === 0) {
    const item = node.ownerDocument.createElement("li");
    item.className = "manual-tray-empty";
    item.textContent = emptyText;
    node.append(item);
    return;
  }
  for (const entry of entries) {
    const item = node.ownerDocument.createElement("li");
    item.className = "manual-chip";
    item.textContent = `${entry.name} ${elapsedClock(entry.remaining)}`;
    if (entry.stacks > 1) {
      item.textContent += ` ×${entry.stacks}`;
    }
    node.append(item);
  }
}

function fillPips(node, value, max, html) {
  node.replaceChildren();
  for (let i = 0; i < max; i += 1) {
    const pip = html.createElement("span");
    pip.className = "manual-pip";
    if (i < value) {
      pip.classList.add("is-filled");
    }
    node.append(pip);
  }
}

export function createManualBoardView(html, store, actions) {
  if (typeof html?.getElementById !== "function") {
    return { update() {} };
  }
  const board = el(html, "manual-board");
  const announce = el(html, "manual-announce");
  const modeScripted = el(html, "fight-mode-scripted");
  const modeManual = el(html, "fight-mode-manual");
  if (board == null) {
    return { update() {} };
  }
  if (board.dataset.manualReady === "true") {
    return { update() {} };
  }
  board.dataset.manualReady = "true";

  board.innerHTML = `
    <header class="manual-board-header">
      <h2 class="manual-board-title">Manual · Step</h2>
      <time class="manual-clock" id="manual-clock"></time>
    </header>
    <div class="manual-frames">
      <article class="manual-unit" aria-labelledby="manual-player-label">
        <h3 id="manual-player-label">You</h3>
        <div class="energy-meter manual-energy" id="manual-energy">
          <div class="energy-fill" id="manual-energy-fill"></div>
        </div>
        <p class="manual-energy-text" id="manual-energy-text"></p>
        <div class="manual-pips" id="manual-pips"></div>
        <p class="manual-combo-text" id="manual-combo-text"></p>
      </article>
      <article class="manual-unit" aria-labelledby="manual-target-label">
        <h3 id="manual-target-label">Target</h3>
        <div class="manual-mock-health" id="manual-mock-health" role="img" aria-label="${MOCK_HEALTH_ALT}">
          <span class="manual-mock-health-label">${MOCK_HEALTH_LABEL}</span>
          <div class="manual-mock-health-track">
            <div class="manual-mock-health-fill" id="manual-mock-health-fill"></div>
          </div>
        </div>
        <p class="manual-remaining" id="manual-remaining"></p>
      </article>
    </div>
    <div class="manual-trays">
      <ul class="manual-tray manual-tray-buffs" aria-label="Buffs" id="manual-buffs"></ul>
      <ul class="manual-tray manual-tray-debuffs" aria-label="Debuffs" id="manual-debuffs"></ul>
    </div>
    <div class="manual-well" id="manual-well" aria-live="off">
      <p class="manual-well-prompt" id="manual-well-prompt"></p>
      <p class="manual-well-event" id="manual-well-event"></p>
      <div class="manual-floats" id="manual-floats" aria-hidden="true"></div>
    </div>
    <div class="manual-bar" role="toolbar" aria-label="Abilities" id="manual-bar"></div>
    <div class="manual-waits" role="group" aria-label="Wait" id="manual-waits"></div>
    <div class="manual-review" id="manual-review" hidden>
      <p class="manual-review-dps" id="manual-review-dps"></p>
      <ol class="manual-review-breakdown" id="manual-review-breakdown"></ol>
      <ol class="manual-review-timing" id="manual-review-timing"></ol>
      <button type="button" class="manual-review-replay" id="manual-review-replay">Replay</button>
      <button type="button" class="manual-review-back" id="manual-review-back">Back to Fight</button>
    </div>
  `;

  el(html, "manual-review-replay")?.addEventListener("click", () =>
    actions.replay(),
  );
  el(html, "manual-review-back")?.addEventListener("click", () =>
    actions.backToFight(),
  );
  modeScripted?.addEventListener("change", () => {
    if (modeScripted.checked) {
      actions.setFightMode("scripted");
    }
  });
  modeManual?.addEventListener("change", () => {
    if (modeManual.checked) {
      actions.setFightMode("manual");
    }
  });

  const runRoot = el(html, "run-controls");
  html.addEventListener("keydown", (event) => {
    const state = store.get();
    if (state.run?.fightMode !== "manual") {
      return;
    }
    if (isTyping(event.target)) {
      return;
    }
    const inside =
      board.contains(event.target) || runRoot?.contains(event.target);
    if (!inside) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      el(html, "manual-well")?.focus();
      return;
    }
    if (event.key === "w" || event.key === "W") {
      event.preventDefault();
      el(html, "manual-waits")?.querySelector("button")?.focus();
      return;
    }
    const index = KEYS.indexOf(event.key);
    if (index >= 0) {
      const slot = board.querySelectorAll(".manual-slot")[index];
      if (slot) {
        event.preventDefault();
        slot.click();
      }
    }
  });

  const wellEl = el(html, "manual-well");
  if (wellEl) {
    wellEl.tabIndex = -1;
  }

  function update() {
    const state = store.get();
    const manual = state.manual;
    const isManual = state.run?.fightMode === "manual";
    if (modeScripted) {
      modeScripted.checked = !isManual;
    }
    if (modeManual) {
      modeManual.checked = isManual;
    }
    board.hidden = !isManual;
    if (announce) {
      announce.hidden = !isManual;
    }
    if (!isManual) {
      return;
    }
    const fight = manual?.state;
    const phase = manual?.phase ?? "ready";
    const review = el(html, "manual-review");
    const frames = board.querySelector(".manual-frames");
    const trays = board.querySelector(".manual-trays");
    const wellBox = el(html, "manual-well");
    const inReview = phase === "review";
    if (review) {
      review.hidden = !inReview;
    }
    for (const part of [
      frames,
      trays,
      wellBox,
      el(html, "manual-bar"),
      el(html, "manual-waits"),
    ]) {
      if (part) {
        part.hidden = inReview || phase === "ready";
      }
    }
    if (phase === "ready") {
      el(html, "manual-clock").textContent = headerClock(
        0,
        state.run?.duration ?? 0,
      );
      el(html, "manual-clock").setAttribute("datetime", "0");
      el(html, "manual-clock").setAttribute(
        "aria-label",
        headerClockSpoken(0, state.run?.duration ?? 0),
      );
      el(html, "manual-waits").hidden = true;
      el(html, "manual-bar").hidden = true;
      return;
    }
    if (fight == null) {
      return;
    }
    const clockEl = el(html, "manual-clock");
    clockEl.textContent = headerClock(fight.time, fight.duration);
    clockEl.setAttribute("datetime", String(fight.time));
    clockEl.setAttribute(
      "aria-label",
      headerClockSpoken(fight.time, fight.duration),
    );
    const fill = mockHealthFill(fight.time, fight.duration);
    el(html, "manual-mock-health-fill").style.width = `${fill * PERCENT}%`;
    el(html, "manual-remaining").textContent = remainingClock(
      fight.remaining,
      fight.duration,
    );
    const energyPct =
      fight.energy.max > 0 ? fight.energy.value / fight.energy.max : 0;
    el(html, "manual-energy-fill").style.width = `${energyPct * PERCENT}%`;
    el(html, "manual-energy-text").textContent =
      `${Math.floor(fight.energy.value)}/${fight.energy.max}`;
    fillPips(
      el(html, "manual-pips"),
      fight.comboPoints.value,
      fight.comboPoints.max,
      html,
    );
    el(html, "manual-combo-text").textContent =
      `${fight.comboPoints.value}/${fight.comboPoints.max}`;
    fillTray(el(html, "manual-buffs"), fight.buffs ?? [], "No buffs");
    fillTray(el(html, "manual-debuffs"), fight.debuffs ?? [], "No debuffs");
    const prompt = el(html, "manual-well-prompt");
    const eventLine = el(html, "manual-well-event");
    const line = wellLine(manual);
    prompt.textContent = line.prompt;
    eventLine.textContent = line.event;
    const quiet = reducedMotion(html);
    const floats = el(html, "manual-floats");
    floats.replaceChildren();
    if (!quiet && (phase === "crit" || phase === "decision")) {
      const events = manual.events ?? [];
      const shown = [];
      events.forEach((event, index) => {
        const hits = landedHits(events.slice(0, index + 1));
        const copy = floatCopy(event, hits);
        if (copy) {
          shown.push(copy);
        }
      });
      const latest = shown.slice(-FLOAT_LIMIT);
      latest.forEach((item, index) => {
        const node = html.createElement("span");
        node.className = `manual-float is-${item.tone}`;
        node.textContent = item.extra
          ? `${item.text} ${item.extra}`
          : item.text;
        node.dataset.stack = String(latest.length - 1 - index);
        floats.append(node);
      });
    }
    if (phase !== "review") {
      const prior = html.activeElement;
      const priorAbility = prior?.dataset?.abilityId;
      const priorWait = prior?.dataset?.waitKind;
      const wasOnBoard = board.contains(prior) || prior === board;
      fillBar(
        el(html, "manual-bar"),
        manual.slots ?? [],
        fight,
        actions,
        manual.blockedAbilityId,
        html,
      );
      fillWaits(
        el(html, "manual-waits"),
        fight,
        manual.slots ?? [],
        actions,
        html,
      );
      if (wasOnBoard) {
        const again = priorAbility
          ? board.querySelector(`[data-ability-id="${priorAbility}"]`)
          : priorWait
            ? board.querySelector(`[data-wait-kind="${priorWait}"]`)
            : null;
        (again ?? el(html, "manual-well"))?.focus();
      }
    }
    if (inReview && manual.result) {
      const result = manual.result;
      el(html, "manual-review-dps").textContent =
        `${result.dps.toFixed(DPS_DECIMALS)} DPS`;
    }
    if (announce) {
      announce.textContent = announceLine(manual) ?? "";
    }
  }

  store.subscribe(update);
  update();
  return { update };
}
