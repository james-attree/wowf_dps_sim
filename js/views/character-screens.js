// Character's screens (#244, Phase 4.5 UX6; Fran's approved UX proposal §3
// and §7). #character is a list of three rows, each with what its screen
// holds and a chip for what it needs fixed; #character/gear,
// #character/stats and #character/talents are the screens. The parts of the
// area marked data-screen show on the screens they name ("list" is the
// list), so every field keeps its id and its view (js/views/config-form.js,
// js/views/talent-tree.js) works unchanged. This view names the h1 and the
// back link, which goes back to the row that opened the screen; the router
// (js/views/router.js) moves the focus and names the page.
//
// The talent tree is the Talents screen: it is opened there and closed off
// it, and anything that opens it elsewhere (none does now) shows the screen.
//
import { formatPercent } from "./config-form.js";

export const SCREENS = Object.freeze({
  list: Object.freeze({ title: "Character", row: null }),
  gear: Object.freeze({ title: "Gear and weapons", row: "character-row-gear" }),
  stats: Object.freeze({ title: "Stats", row: "character-row-stats" }),
  talents: Object.freeze({ title: "Talents", row: "talents-edit" }),
});

const ONE = 1;
const DASH = "—";
const HANDS = Object.freeze([
  Object.freeze({ key: "mainHand", name: "Main hand" }),
  Object.freeze({ key: "offHand", name: "Off hand" }),
]);

const screenOfPath = (path) =>
  path.startsWith("character.")
    ? "stats"
    : path.startsWith("weapons.") || path.startsWith("poisons.")
      ? "gear"
      : null;
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const numberText = (value) => (isNumber(value) ? String(value) : DASH);
const percentText = (value) =>
  isNumber(value) ? `${formatPercent(value)}%` : DASH;
const capital = (text) =>
  typeof text === "string" && text !== ""
    ? `${text.charAt(0).toUpperCase()}${text.slice(1)}`
    : DASH;

// Character's rows from the form slice: what the fields show, and how many
// of each screen's fields have a message. { gear, stats }: { summary, fix }.
// "Main hand Sword 100–187 · Instant Poison / Off hand Sword 90–168 · Deadly
// Poison" and "767 attack power · 22.45% crit · 7% hit"; a value that is not
// a number yet is a dash.
export function characterRows(form) {
  const values = form?.values ?? {};
  const fix = { gear: 0, stats: 0 };
  for (const [path, message] of Object.entries(form?.errors ?? {})) {
    const screen = screenOfPath(path);
    if (screen !== null && message !== null) {
      fix[screen] += ONE;
    }
  }
  const options = [
    ...(form?.poisonOptions?.simulated ?? []),
    ...(form?.poisonOptions?.notSimulated ?? []),
  ];
  const poisonText = (id) =>
    id === null || id === undefined
      ? "No poison"
      : (options.find((option) => option.id === id)?.label ?? capital(id));
  const hand = ({ key, name }) => {
    const at = (part) => values[`weapons.${key}.${part}`];
    return `${name} ${capital(at("type"))} ${numberText(at("min"))}–${numberText(at("max"))} · ${poisonText(values[`poisons.${key}`])}`;
  };
  return {
    gear: { summary: HANDS.map(hand).join(" / "), fix: fix.gear },
    stats: {
      summary: [
        `${numberText(values["character.attackPower"])} attack power`,
        `${percentText(values["character.critChance"])} crit`,
        `${percentText(values["character.bonusHitChance"])} hit`,
      ].join(" · "),
      fix: fix.stats,
    },
  };
}

// "1 to fix", "3 to fix"; "" for none.
export const fixText = (count) => (count < ONE ? "" : `${count} to fix`);

// A row's accessible name: its label and its chip, "Gear and weapons, 2 to
// fix" or "Stats"; its summary is its description (#244, Fran's qa-256 P-a).
export const rowName = (title, chip) =>
  chip === "" ? title : `${title}, ${chip}`;

// The screen a route is on, or null off Character.
export function screenOf(route) {
  if (route?.area !== "character") {
    return null;
  }
  return Object.hasOwn(SCREENS, route.sub ?? "") ? route.sub : "list";
}

export function createCharacterScreensView(doc, store, { setOpen }) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const area = $("area-character");
  const heading = $("area-character-title");
  const back = $("character-back");
  // A stand-in page (the tests') may have no area to search.
  const parts =
    typeof area?.querySelectorAll === "function"
      ? [...area.querySelectorAll("[data-screen]")]
      : [];
  const chips = {
    gear: $("character-gear-status"),
    stats: $("character-stats-status"),
    talents: $("character-talents-status"),
  };
  const rows = {
    gear: $(SCREENS.gear.row),
    stats: $(SCREENS.stats.row),
    talents: $(SCREENS.talents.row),
  };
  const summaries = {
    gear: $("character-gear-summary"),
    stats: $("character-stats-summary"),
  };
  let shown = null;
  let wasOpen = store.get().talents?.open === true;

  const write = (node, text) => {
    if (node !== null && node.textContent !== text) {
      node.textContent = text;
    }
  };
  const chip = (screen, text) => {
    const node = chips[screen];
    if (node !== null) {
      write(node, text);
      node.hidden = text === "";
    }
    const row = rows[screen];
    const name = rowName(SCREENS[screen].title, text);
    if (row !== null && row.getAttribute("aria-label") !== name) {
      row.setAttribute("aria-label", name);
    }
  };

  function drawScreen(screen) {
    for (const part of parts) {
      const on = part.getAttribute("data-screen").split(" ");
      // The talent tree's own view shows it while it is open.
      if (part.id !== "talent-tree") {
        part.hidden = !on.includes(screen);
      }
    }
    write(heading, SCREENS[screen].title);
    if (back !== null) {
      back.hidden = screen === "list";
      if (SCREENS[screen].row === null) {
        back.removeAttribute("data-return-focus");
      } else {
        back.setAttribute("data-return-focus", SCREENS[screen].row);
      }
    }
  }

  function drawRows(state) {
    const { gear, stats } = characterRows(state.form);
    write(summaries.gear, gear.summary);
    write(summaries.stats, stats.summary);
    chip("gear", fixText(gear.fix));
    chip("stats", fixText(stats.fix));
    const view = state.talents?.view;
    chip(
      "talents",
      view?.over === true ? `${view.total - view.cap} over the cap` : "",
    );
  }

  function draw(state) {
    const screen = screenOf(state.route);
    const open = state.talents?.open === true;
    if (screen !== null && screen !== shown) {
      drawScreen(screen);
    }
    const left = shown === "talents" && screen !== "talents";
    const opened = open && !wasOpen;
    shown = screen;
    wasOpen = open;
    drawRows(state);
    if (screen === "talents" && !open) {
      setOpen(true);
    } else if (open && screen !== "talents") {
      if (opened && !left) {
        const win = doc.defaultView;
        if (win?.location !== undefined) {
          win.location.hash = "#character/talents";
        }
      } else {
        setOpen(false);
      }
    }
  }

  draw(store.get());
  store.subscribe(({ state, changed }) => {
    if (
      changed.includes("route") ||
      changed.includes("form") ||
      changed.includes("talents")
    ) {
      draw(state);
    }
  });
}
