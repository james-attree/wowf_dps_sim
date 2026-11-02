// Start from a preset (#323): the cards at the top of the Character list
// while the panel is open (a first visit), and on #character/start; the
// Starting point row, first in the list, while it is folded; and the line
// after a pick, with Undo. js/start-preset.js is the model (its `start`
// slice) and js/preset-build.js puts the build in (its `presetBuild`
// slice's `applied`). The announcement is the Run bar's (#run-announce),
// as #273's was: the line is not a live region.
//
// The panel's Race select is the Stats screen's (#321) by another id: the
// same options and the same field, so either shows what the other set.

import { fillRaceSelect } from "./config-form.js";

const CURRENT = "true";

export function createStartPresetView(doc, store, actions) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const panel = $("start-panel");
  const lead = $("start-lead");
  const list = $("start-cards");
  const race = $("start-race");
  const applied = $("start-applied");
  const done = $("start-done");
  const raceAsk = $("start-race-ask");
  const undo = $("start-undo");
  const rowItem = $("start-row-item");
  const row = $("start-row");
  const summary = $("start-summary");
  const buttons = new Map();
  let lastFocus = null;
  let lastBuildFocus = null;
  let raceGroups = null;

  const write = (node, text) => {
    if (node !== null && node.textContent !== text) {
      node.textContent = text;
    }
  };

  function card({ id }) {
    const item = doc.createElement("li");
    const button = doc.createElement("button");
    button.type = "button";
    button.id = `start-card-${id}`;
    button.className = "start-card";
    const name = doc.createElement("span");
    name.className = "start-card-name";
    const edited = doc.createElement("span");
    edited.className = "start-card-edited";
    const detail = doc.createElement("span");
    detail.className = "start-card-detail";
    const short = doc.createElement("span");
    short.className = "start-card-short";
    button.replaceChildren(name, edited, detail, short);
    button.addEventListener("click", () => actions.pick(id));
    item.append(button);
    buttons.set(id, { button, name, edited, detail, short });
    return item;
  }

  function drawCards(cards) {
    if (buttons.size === 0) {
      list.replaceChildren(...cards.map(card));
    }
    for (const model of cards) {
      const parts = buttons.get(model.id);
      if (parts === undefined) {
        continue;
      }
      write(parts.name, model.name);
      write(parts.edited, model.edited ? " · Edited" : "");
      write(parts.detail, model.detail);
      write(parts.short, model.short);
      if (model.current) {
        parts.button.setAttribute("aria-current", CURRENT);
      } else {
        parts.button.removeAttribute("aria-current");
      }
    }
  }

  function drawRace(form) {
    if (race === null) {
      return;
    }
    if (form?.raceOptions !== raceGroups) {
      raceGroups = form?.raceOptions ?? null;
      fillRaceSelect(doc, race, raceGroups);
    }
    const value = form?.values?.race ?? "";
    if (race.value !== (value ?? "")) {
      race.value = value ?? "";
    }
  }

  function focusOn(target) {
    if (
      target !== null &&
      target !== undefined &&
      !target.closest?.("[hidden]")
    ) {
      target.focus?.();
    }
  }

  function render(state) {
    const start = state.start;
    if (start === undefined || start === null) {
      return;
    }
    const route = state.route;
    const onCharacter = route?.area === "character";
    const onList = onCharacter && (route?.sub ?? null) === null;
    const onStart = onCharacter && route?.sub === "start";
    const cardsShow = onStart || (onList && start.open);
    panel.hidden = !cardsShow;
    rowItem.hidden = start.open;
    write(lead, start.lead);
    drawCards(start.cards);
    drawRace(state.form);
    write(summary, start.point.text);

    const picked = state.presetBuild?.applied ?? null;
    const shown = picked !== null && picked.pick !== null && onCharacter;
    applied.hidden = !shown || onStart;
    write(done, shown ? picked.text : "");
    raceAsk.hidden = !(shown && start.needsRace);
    if (shown) {
      undo.setAttribute("aria-label", picked.undoName);
    } else {
      undo.removeAttribute("aria-label");
    }

    // After a pick: Undo (js/preset-build.js's focus "undo").
    const buildFocus = state.presetBuild?.focus ?? null;
    if (buildFocus !== null && buildFocus.seq !== lastBuildFocus) {
      lastBuildFocus = buildFocus.seq;
      if (buildFocus.target === "undo" && shown) {
        focusOn(undo);
      }
    }
    // After Undo, or a pick that changed nothing: the model's.
    const focus = start.focus ?? null;
    if (focus !== null && focus.seq !== lastFocus) {
      lastFocus = focus.seq;
      const target =
        focus.target === "card"
          ? buttons.get(focus.id)?.button
          : focus.target === "gear"
            ? $("character-row-gear")
            : row;
      focusOn(target);
    }
  }

  race?.addEventListener("change", () => actions.change("race", race.value));
  undo.addEventListener("click", () => actions.undo());

  render(store.get());
  return store.subscribe(({ state, changed }) => {
    if (
      ["start", "presetBuild", "route", "form"].some((name) =>
        changed.includes(name),
      )
    ) {
      render(state);
    }
  });
}
