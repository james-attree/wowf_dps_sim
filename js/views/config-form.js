import { k } from "../../data/constants.js";
import { NARROW_QUERY } from "./breakpoints.js";
import { NO_BREAK_SPACE, fieldErrors, formErrorCount } from "./run-model.js";
import { reveal } from "./sections.js";
import { anyStale } from "./stale.js";

// The "Fight setup" form (#151, U2). This view owns the form#config-form and
// everything in it, and no other element but the fields that live outside it
// (#244, UX6): the rotation select and its summary on Rotation's list. It
// draws the store's `form` slice
// and calls the model's actions (js/config-form.js, which js/main.js hands
// in); it never writes the store itself and imports nothing from the engine
// (#150). Edits apply to the next run: the form writes `config`, and the fight
// on the page keeps the config it started with.
//
// Fields are found from the slice: each key of form.values names one control,
// id "cfg-" plus the path with dots as dashes. A control with data-percent
// shows a chance (0 to 1 in the store) as a percentage: the view writes
// value / 100 and shows formatPercent(value), and converts nowhere else.
//
// Run, Pause, Stop and Reset of the fight are #153's control bar, never this
// form; while the form has errors the footer lists them and says Run is off.
// The footer counts the run bar's field errors too (#155, Fran's Phase 3 QA
// 1), so it never says "Changes apply to the next run" while Run is blocked;
// their links go to the bar's own "Fix" link.

// True when the form's config differs from the one the fight or batch on the
// page started with (run.snapshot, #153): the footer then shows "Edited —
// applies to the next run". Both are in normalizeConfig's full form.
export function editedSinceRun(state) {
  const snapshot = state.run?.snapshot ?? null;
  return (
    snapshot !== null &&
    JSON.stringify(state.config) !== JSON.stringify(snapshot)
  );
}

export const fieldId = (path) => `cfg-${path.replaceAll(".", "-")}`;

// 0.07 * 100 is 7.000000000000001 in JS, so round before showing it.
export function formatPercent(value) {
  return String(+(value * 100).toFixed(4));
}

// The text of a number input as the store value: NaN when it is empty or not
// a number.
export function parseField(text, percent) {
  const trimmed = String(text).trim();
  const value = trimmed === "" ? Number.NaN : Number(trimmed);
  return percent ? value / 100 : value;
}

export function formatField(value, percent) {
  if (typeof value !== "number") {
    return value ?? "";
  }
  if (Number.isNaN(value)) {
    return "";
  }
  return percent ? formatPercent(value) : String(value);
}

// A typed value does not follow the level (Scout's ruling on #319).
export const TYPED_STAYS = "Typed values stay fixed when you change level.";
// One weapon skill for both hands (Fran's qa-319 N1; js/attack-resolver.js
// weaponSkillFor).
export const BOTH_HANDS = "Applies to both hands.";
// What the target's level does (Fran's qa-319 P2).
export const TARGET_LEVEL_EFFECT =
  "Higher levels mean more misses and glancing blows.";
// The formula's operator keeps its words on one line (Fran's qa-319 N2).
const formula = (left, operator, right) =>
  `${left}${NO_BREAK_SPACE}${operator}${NO_BREAK_SPACE}${right}`;
// The help under Weapon skill and Target level (#318), from the form's
// levels (js/config-form.js levelsInfo).
export function weaponSkillHelpText({ level, weaponSkill }) {
  return `Leave blank for ${weaponSkill.blank} (${formula("your level", "×", weaponSkill.perLevel)}). At most ${weaponSkill.max} at level ${level}. ${BOTH_HANDS} ${TYPED_STAYS}`;
}
// ", a raid boss" only when blank gives the boss's level (qa-319 D-P1): at
// level 40 blank is 43, which is no raid boss.
export const RAID_BOSS = ", a raid boss";
export function targetLevelHelpText({ targetLevel }) {
  const boss = targetLevel.blank === targetLevel.boss ? RAID_BOSS : "";
  return `Leave blank for ${targetLevel.blank} (${formula("your level", "+", targetLevel.above)}${boss}). From ${targetLevel.min} to ${targetLevel.max}. ${TARGET_LEVEL_EFFECT} ${TYPED_STAYS}`;
}

const plural = (count, one, many) => (count === 1 ? one : many);

// What the footer says while `count` fields need fixing.
export function runGateText(count) {
  return `${count} ${plural(count, "field needs", "fields need")} fixing. Run is disabled.`;
}

export function fixHeadingText(count) {
  return `Fix ${count} ${plural(count, "field", "fields")} to run:`;
}

// The run fields, as the footer names them: they are Fight's since #245,
// so the area's name and the field's label (Fran's #260 check).
const BAR_FIELD_NAMES = {
  duration: "Fight, Fight length",
  iterations: "Fight, Fights",
  seed: "Fight, Seed",
};

const HANDS = ["mainHand", "offHand"];
const poisonPath = (hand) => `poisons.${hand}`;
const isPoison = (path) => path.startsWith("poisons.");
const capitalised = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// The lines under a poison select (#152, Fran's notes section 2), from the
// model's poisonInfo(): the numbers of the rank the engine simulates.
export function poisonRankText({ rank, highest }) {
  return `Rank ${rank}${highest ? " (highest)" : ""}`;
}

export function poisonEffectText({ chance, effect }) {
  const onHit = `${formatPercent(chance)}% on hit`;
  const school = capitalised(effect.school ?? "");
  const stacks = effect.maxStacks > 1 ? `, stacks ×${effect.maxStacks}` : "";
  switch (effect.kind) {
    case "damage":
      return `${onHit} · ${effect.min}–${effect.max} ${school}`;
    case "dot":
      return `${onHit} · ${effect.damage} ${school} over ${effect.duration} s${stacks}`;
    case "slow":
      return `${onHit} · movement ${formatPercent(effect.fraction)}% slower for ${effect.duration} s`;
    case "castSlow":
      return `${onHit} · casting ${formatPercent(effect.fraction)}% slower for ${effect.duration} s`;
    case "healingReduction":
      return `${onHit} · healing taken −${effect.amount} for ${effect.duration} s${stacks}`;
    default:
      return onHit;
  }
}

// "Not simulated yet: it slows …": the reason from its colon on. Only a
// poison the sim does not simulate has a reason.
export function poisonNoteText({ noDpsReason }) {
  if (noDpsReason === null) {
    return "";
  }
  const colon = noDpsReason.indexOf(":");
  const reason = (colon < 0 ? noDpsReason : noDpsReason.slice(colon + 1))
    .trim()
    .replace(/\.?$/, ".");
  return `Not simulated yet: ${reason}`;
}

// The Race select's first choice (#321): config.race null.
export const NO_RACE_LABEL = "None (no racials)";
// A racial's chip (#321), in the poisons' and #280's words.
export const RACIAL_CHIPS = Object.freeze({
  simulated: "Simulated",
  off: "No DPS effect",
  later: "Not simulated yet",
});
// An on-use racial needs a rule that casts it (#278). Each preset rotation
// opens with one per on-use racial, guarded by "ability granted" (#315,
// data/rotation-presets.js onUseRacialRules); the default rotation has none.
// The second sentence says whether the rotation the run uses casts it.
export const ON_USE_NOTE = "The preset rotations use it on cooldown.";
export const ON_USE_CAST = {
  yes: "Your rotation casts it.",
  no: "Your rotation has no rule for it, so it isn't used.",
  unknown: "Your own rotation needs a rule to cast it.",
};

const pluralType = (type) => `${capitalised(type)}s`;

// A racial's own text is the game's tooltip, written for every class (Fran's
// #322 P3). These are the rogue's lines, by the racial's slug (the id after
// "race."), each from that tooltip with the other classes' clauses left out
// and no number it does not state (test/race-picker.test.js checks). A
// racial not here shows its own text.
export const ROGUE_LINES = Object.freeze({
  "blood-fury":
    "Instant, 2 min cooldown. Increases your Attack Power by 10% for 15 sec.",
  berserking:
    "Instant, 3 min cooldown. Increases your attack speed by 10% for 15 sec.",
  "elunes-light":
    "Instant, 3 min cooldown. Increases your critical strike chance with attacks by 10% for 15 sec.",
  eureka:
    "Instant, 2 min cooldown. For 8 sec, your non-periodic damaging abilities cost 10% less Energy and deal 10% more damage.",
  "expansive-mind": "Maximum Energy increased by 5%.",
  ruthless: "Increases your critical strike chance with attacks by 1%.",
  "artisans-precision": "Increases your hit chance with attacks by 1%.",
  "wind-blessed": "Increases your melee and ranged haste by 2%.",
  "touch-of-the-grave":
    "Your damaging attacks have a 20% chance to drain health from the target, up to 5% of your maximum health. 15 sec internal cooldown.",
});
// Why a racial that would change the damage isn't in the fight yet, in
// plain words from the effects data's reason (data/racial-effects.js
// notSimulated: "… which the simulator does not model").
export const NOT_SIMULATED_REASONS = Object.freeze({
  "touch-of-the-grave":
    "Not simulated yet: the simulator doesn't model the rogue's health.",
});
const slugOf = (id) => String(id ?? "").replace(/^[^.]*\./, "");

// The chip of a racial from the model's raceInfo(): which of RACIAL_CHIPS,
// as { kind, text }. A mob-type racial against the page's target does
// nothing, as one with no DPS effect.
export function racialChip({ status }) {
  const kind =
    status === "simulated"
      ? "simulated"
      : status === "notSimulated"
        ? "later"
        : "off";
  return { kind, text: RACIAL_CHIPS[kind] };
}

// The plain line under a racial's name: what it does. One with no DPS
// effect gives the effects data's reason; the rest give the rogue's line
// (ROGUE_LINES, else the racial's own text), one not simulated yet adds why,
// an on-use racial adds ON_USE_NOTE and whether the rotation casts it
// (casts: true, false, or null for not known), and a mob-type racial the
// targets it is for.
export function racialLineText({
  id = null,
  status,
  text: tooltip,
  reason,
  onUse,
  casts = null,
  mobTypes,
}) {
  if (status === "noDpsEffect") {
    return reason ?? tooltip;
  }
  const slug = slugOf(id);
  const text = ROGUE_LINES[slug] ?? tooltip;
  if (status === "notSimulated" && NOT_SIMULATED_REASONS[slug] !== undefined) {
    return `${text} ${NOT_SIMULATED_REASONS[slug]}`;
  }
  if (status === "inert") {
    const types = (mobTypes ?? []).map(pluralType).join(" or ");
    return `${text} Only against ${types}, and the target isn't one.`;
  }
  if (status === "simulated" && onUse) {
    const cast =
      casts === null
        ? ON_USE_CAST.unknown
        : casts
          ? ON_USE_CAST.yes
          : ON_USE_CAST.no;
    return `${text} ${ON_USE_NOTE} ${cast}`;
  }
  return text;
}

// The racials in the order Stats shows them (Fran's #322 P2): the ones that
// change the damage, simulated first and then the ones not simulated yet,
// each with its line; the ones with no DPS effect are folded into one
// <details> whose summary names them, "No DPS effect: Hardiness, Command,
// Shatter Curse". Data order within each.
const SHOWN_ORDER = Object.freeze(["simulated", "later"]);
export function racialGroups(racials) {
  const kindOf = (racial) => racialChip(racial).kind;
  const shown = SHOWN_ORDER.flatMap((kind) =>
    racials.filter((racial) => kindOf(racial) === kind),
  );
  const folded = racials.filter(
    (racial) => !SHOWN_ORDER.includes(kindOf(racial)),
  );
  return { shown, folded };
}
export const noDpsSummary = (folded) =>
  `${RACIAL_CHIPS.off}: ${folded.map((racial) => racial.name).join(", ")}`;

export function createConfigFormView(doc, store, actions) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const form = $("config-form");
  const rotation = $("cfg-rotation");
  const summaryDetails = $("cfg-summary");
  const summaryName = $("cfg-summary-name");
  const summaryStale = $("cfg-summary-stale");
  const summaryRules = $("cfg-summary-rules");
  const importFile = $("cfg-import-file");
  const importText = $("cfg-import-text");
  const exportButton = $("cfg-export");
  const exportWhy = $("cfg-export-why");
  const importStatus = $("cfg-import-status");
  const importDetail = $("cfg-import-detail");
  const importDetailText = $("cfg-import-detail-text");
  const statusOk = $("cfg-status-ok");
  const fix = $("cfg-fix");
  const fixHeading = $("cfg-fix-heading");
  const fixList = $("cfg-fix-list");
  // The fields the fix list links to now, as "path path".
  let shownFixKey = "";
  const formError = $("cfg-form-error");
  const runGate = $("cfg-run-gate");
  // The run bar's fields with an error that blocks Run, in the bar's order.
  // A page without a run bar (the form's own tests) has none.
  const barErrorsOf = (state) =>
    state.run === undefined ? [] : fieldErrors(state.run);
  let barErrors = barErrorsOf(store.get());
  const toast = $("cfg-toast");
  const toastText = $("cfg-toast-text");
  const undo = $("cfg-undo");
  const win = doc.defaultView ?? globalThis;

  const paths = Object.keys(store.get().form.values);
  const controls = new Map(paths.map((path) => [path, $(fieldId(path))]));
  const isPercent = (control) => control.getAttribute("data-percent") !== null;
  // A data-optional field left blank is null: it follows the level (#318).
  // Text a number input can't read is not blank (its value is "" too).
  const isBlank = (control) =>
    control.getAttribute("data-optional") !== null &&
    String(control.value).trim() === "" &&
    control.validity?.badInput !== true;
  const readControl = (path) => {
    const control = controls.get(path);
    if (control.tagName === "SELECT") {
      return control.value;
    }
    return isBlank(control)
      ? null
      : parseField(control.value, isPercent(control));
  };

  // The summary is closed on a narrow screen (Fran's notes, section 5), the
  // same breakpoint as the run bar (js/views/breakpoints.js).
  if (win.matchMedia?.(NARROW_QUERY).matches) {
    summaryDetails.open = false;
  }

  function options(select, list, selected) {
    select.replaceChildren(
      ...list.map(({ id, label }) => {
        const option = doc.createElement("option");
        option.value = id;
        option.textContent = label;
        return option;
      }),
    );
    select.value = selected;
  }

  // The poison selects' options, once: None, then an optgroup each for the
  // simulated poisons and the rest. A value is the config id ("instant").
  function poisonSelects({ simulated, notSimulated }) {
    const option = ({ id, label }) => {
      const element = doc.createElement("option");
      element.value = id;
      element.textContent = label;
      return element;
    };
    const group = (label, list) => {
      const element = doc.createElement("optgroup");
      element.setAttribute("label", label);
      element.replaceChildren(...list.map(option));
      return element;
    };
    for (const hand of HANDS) {
      controls
        .get(poisonPath(hand))
        ?.replaceChildren(
          option({ id: "", label: "None" }),
          group("Simulated", simulated),
          group("Not simulated yet", notSimulated),
        );
    }
  }

  // The Race select's options, once (#321): None, then an optgroup per
  // faction. A value is the race id ("night-elf").
  function raceSelect(groups) {
    const select = controls.get("race");
    if (select === undefined || select === null) {
      return;
    }
    const option = (id, label) => {
      const element = doc.createElement("option");
      element.value = id;
      element.textContent = label;
      return element;
    };
    select.replaceChildren(
      option("", NO_RACE_LABEL),
      ...(groups ?? []).map(({ faction, races }) => {
        const group = doc.createElement("optgroup");
        group.setAttribute("label", faction);
        group.replaceChildren(
          ...races.map(({ id, label }) => option(id, label)),
        );
        return group;
      }),
    );
  }

  // The race's racials under the select (#321): each one's name, its chip
  // and what it does. Hidden with no race.
  function drawRace(race) {
    const box = $("cfg-race-racials");
    if (box === null || box === undefined) {
      return;
    }
    const on = race !== null && race !== undefined;
    box.hidden = !on;
    $("cfg-race-racials-name").textContent = on ? race.name : "";
    const { shown, folded } = racialGroups(on ? race.racials : []);
    const itemOf = (racial, withChip) => {
      const item = doc.createElement("li");
      item.className = "race-racial";
      const name = doc.createElement("span");
      name.className = "race-racial-name";
      name.textContent = racial.name;
      item.append(name);
      if (withChip) {
        const { kind, text } = racialChip(racial);
        const chip = doc.createElement("span");
        chip.className = `race-chip is-${kind}`;
        chip.textContent = text;
        item.append(" ", chip);
      }
      const line = doc.createElement("p");
      line.className = "field-help race-racial-line";
      line.textContent = racialLineText(racial);
      item.append(line);
      return item;
    };
    $("cfg-race-racials-list").replaceChildren(
      ...shown.map((racial) => itemOf(racial, true)),
    );
    const more = $("cfg-race-racials-more");
    if (more !== null && more !== undefined) {
      more.hidden = !folded.some(Boolean);
      $("cfg-race-racials-more-summary").textContent = noDpsSummary(folded);
      $("cfg-race-racials-more-list").replaceChildren(
        ...folded.map((racial) => itemOf(racial, false)),
      );
    }
  }

  // A poison select's description ids: rank and effect while a poison is on,
  // charges for a simulated one, the note while it shows.
  function poisonDescription(path, info) {
    if (info === null) {
      return "";
    }
    const id = fieldId(path);
    return [
      `${id}-rank`,
      `${id}-effect`,
      info.simulated ? `${id}-charges` : "",
      poisonNoteText(info) === "" ? "" : `${id}-note`,
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  function drawPoisons(poisons) {
    for (const hand of HANDS) {
      const path = poisonPath(hand);
      if (!controls.has(path)) {
        continue;
      }
      const id = fieldId(path);
      const info = poisons?.[hand] ?? null;
      const on = info !== null;
      const note = on ? poisonNoteText(info) : "";
      $(`${id}-rank`).textContent = on ? poisonRankText(info) : "";
      $(`${id}-rank`).hidden = !on;
      $(`${id}-effect`).textContent = on ? poisonEffectText(info) : "";
      $(`${id}-line`).hidden = !on;
      $(`${id}-charges`).hidden = !on || !info.simulated;
      $(`${id}-note-text`).textContent = note;
      $(`${id}-note`).hidden = note === "";
      $(`${id}-tooltip-text`).textContent = on ? info.text : "";
      $(`${id}-tooltip`).hidden = !on;
    }
  }

  // What a blank weapon skill and target level are, and their bounds (#318):
  // the placeholder shows the value a blank gives, the help says so.
  const LEVEL_FIELDS = Object.freeze({
    "character.weaponSkill": (levels) => ({
      ...levels.weaponSkill,
      help: weaponSkillHelpText(levels),
    }),
    "target.level": (levels) => ({
      ...levels.targetLevel,
      help: targetLevelHelpText(levels),
    }),
  });
  function drawLevels(levels) {
    if (levels === undefined) {
      return;
    }
    for (const [path, of] of Object.entries(LEVEL_FIELDS)) {
      const control = controls.get(path);
      if (control === undefined || control === null) {
        continue;
      }
      const { blank, min, max, help } = of(levels);
      control.placeholder = String(blank);
      control.min = String(min);
      control.max = String(max);
      const helpId = control.getAttribute("data-help");
      const node = typeof helpId === "string" ? $(helpId) : null;
      if (node !== null && node !== undefined && node.textContent !== help) {
        node.textContent = help;
      }
    }
  }

  function fillValues(values) {
    for (const [path, control] of controls) {
      control.value = formatField(values[path], isPercent(control));
    }
  }

  function drawErrors(errors) {
    for (const [path, control] of controls) {
      const id = fieldId(path);
      const help = isPoison(path)
        ? poisonDescription(
            path,
            drawn?.poisons?.[path.slice("poisons.".length)] ?? null,
          )
        : (control.getAttribute("data-help") ?? "");
      const message = errors[path];
      const error = $(`${id}-error`);
      if (path in errors) {
        control.setAttribute("aria-invalid", "true");
      } else {
        control.removeAttribute("aria-invalid");
      }
      if (typeof message === "string") {
        const mark = doc.createElement("span");
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "⚠ ";
        error.replaceChildren(mark, message);
        error.hidden = false;
      } else {
        error.replaceChildren();
        error.hidden = true;
      }
      const describedBy = [
        help,
        typeof message === "string" ? `${id}-error` : "",
      ]
        .filter((part) => part !== "")
        .join(" ");
      if (describedBy === "") {
        control.removeAttribute("aria-describedby");
      } else {
        control.setAttribute("aria-describedby", describedBy);
      }
    }

    const fields = Object.entries(errors).filter(
      ([path, message]) => controls.has(path) && message !== null,
    );
    const backstop = Object.entries(errors).find(
      ([path]) => !controls.has(path),
    );
    // The same count as Run's (#237): js/views/run-model.js formErrorCount.
    const count = formErrorCount({ errors }) + barErrors.length;
    const listed = fields.length + barErrors.length;
    statusOk.hidden = count > 0;
    fix.hidden = listed === 0;
    fixHeading.textContent = listed > 0 ? fixHeadingText(count) : "";
    // Rebuilt only when the list of fields changes: a blur that commits a
    // field must not swap out the link the pointer is pressing.
    const fixKey = [...fields.map(([path]) => path), ...barErrors].join(" ");
    if (fixKey !== shownFixKey) {
      shownFixKey = fixKey;
      fixList.replaceChildren(...fixLinks(fields), ...barLinks(barErrors));
    }
    formError.hidden = backstop === undefined;
    formError.textContent = backstop === undefined ? "" : backstop[1];
    const gate = count > 0 ? runGateText(count) : "";
    if (runGate.textContent !== gate) {
      runGate.textContent = gate;
    }
  }

  // One link per field to fix; following it focuses the field.
  function fixLinks(fields) {
    return fields.map(([path]) => {
      const item = doc.createElement("li");
      const link = doc.createElement("a");
      const control = controls.get(path);
      link.href = `#${fieldId(path)}`;
      link.textContent = fieldName(path);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        // A field on another of Character's screens has it shown first
        // (#244).
        reveal(control);
        control.focus();
      });
      item.append(link);
      return item;
    });
  }

  // One link per run field to fix. The fields are not this view's (#150),
  // but they are in Fight since #245: the link shows Fight and focuses the
  // field itself, one step (Fran's #260 check; it went to the run bar's
  // "Fix" link before).
  function barLinks(names) {
    return names.map((name) => {
      const item = doc.createElement("li");
      const link = doc.createElement("a");
      link.href = `#run-${name}`;
      link.textContent = BAR_FIELD_NAMES[name];
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const field = doc.querySelector(`#run-${name}`);
        reveal(field);
        field?.focus?.();
      });
      item.append(link);
      return item;
    });
  }

  // "Main hand, Max damage": the field's legend and label, as a link's text.
  function fieldName(path) {
    const label = doc.querySelector(`label[for="${fieldId(path)}"]`);
    const own = label?.firstChild?.textContent ?? path;
    const hand = path.startsWith("weapons.mainHand")
      ? "Main hand, "
      : path.startsWith("weapons.offHand")
        ? "Off hand, "
        : "";
    return `${hand}${String(own).trim()}`;
  }

  // D19 (U7): while the rotation draft has errors the summary is of its last
  // valid version, the one a run would use, and the note above it says so.
  function drawStale(stale) {
    if (summaryStale === null) {
      return;
    }
    summaryStale.hidden = stale === null || stale === undefined;
    if (summaryStale.hidden) {
      summaryStale.replaceChildren();
      return;
    }
    const lead = doc.createElement("strong");
    lead.textContent = "Last valid version. ";
    summaryStale.replaceChildren(lead, stale);
  }

  function drawSummary({ name, rules, stale }) {
    drawStale(stale);
    summaryName.textContent = name;
    summaryRules.replaceChildren(
      ...rules.map((rule) => {
        const item = doc.createElement("li");
        item.textContent = rule;
        return item;
      }),
    );
  }

  function drawExport(why) {
    const off = why !== null && why !== undefined;
    if (off) {
      exportButton.setAttribute("aria-disabled", "true");
      exportButton.setAttribute("aria-describedby", "cfg-export-why");
    } else {
      exportButton.removeAttribute("aria-disabled");
      exportButton.removeAttribute("aria-describedby");
    }
    if (exportWhy !== null) {
      exportWhy.hidden = !off;
      exportWhy.textContent = off ? why : "";
    }
  }

  function drawImport(status) {
    importStatus.textContent = status?.message ?? "";
    importStatus.classList.toggle("is-error", status?.ok === false);
    const failed = status?.ok === false && status.detail !== "";
    importDetail.hidden = !failed;
    importDetailText.textContent = failed ? status.detail : "";
    // Warnings (issue #189) never block: the rotation was imported. They
    // are the Rotation messages' "What to check", under the h1 (#243, UX5),
    // with the builder's own; the status says so.
    const warned = status?.ok === true && (status.warnings ?? "") !== "";
    importStatus.classList.toggle("is-warning", warned);
  }

  // A new import status is brought on screen once the banner above it is
  // drawn: at 1024x576 it sat just under the fold (#244, Fran's #255
  // check, P3). html's scroll-padding keeps it clear of the phone dock.
  function showImportStatus() {
    win.requestAnimationFrame?.(() => {
      if (importStatus.checkVisibility?.() !== false) {
        importStatus.scrollIntoView?.({ block: "nearest" });
      }
    });
  }

  let toastTimer = null;
  function hideToast() {
    win.clearTimeout?.(toastTimer);
    toastTimer = null;
    toastText.textContent = "";
    undo.hidden = true;
    toast.classList.toggle("is-shown", false);
  }
  function showToast() {
    hideToast();
    toastText.textContent = "Defaults restored";
    undo.hidden = false;
    toast.classList.toggle("is-shown", true);
    toastTimer = win.setTimeout?.(hideToast, k("ui.undoToastSeconds") * 1000);
  }

  let drawn = null;
  function render(state) {
    const previous = drawn;
    drawn = state;
    if (previous === null) {
      poisonSelects(state.poisonOptions);
      raceSelect(state.raceOptions);
    }
    if (previous === null || state.revision !== previous.revision) {
      fillValues(state.values);
    }
    if (previous === null || state.poisons !== previous.poisons) {
      drawPoisons(state.poisons);
    }
    if (previous === null || state.race !== previous.race) {
      drawRace(state.race);
    }
    if (previous === null || state.levels !== previous.levels) {
      drawLevels(state.levels);
    }
    // A new revision redraws it too: pageshow after back/forward (#296) can
    // find the browser's remembered choice in it.
    if (
      previous === null ||
      state.revision !== previous.revision ||
      state.rotationOptions !== previous.rotationOptions ||
      state.rotationChoice !== previous.rotationChoice
    ) {
      options(rotation, state.rotationOptions, state.rotationChoice);
    }
    if (previous === null || state.summary !== previous.summary) {
      drawSummary(state.summary);
    }
    // A commit always gives new errors, so a new poison redraws the
    // descriptions here too.
    if (previous === null || state.errors !== previous.errors) {
      drawErrors(state.errors);
    }
    if (previous === null || state.exportOff !== previous.exportOff) {
      drawExport(state.exportOff);
    }
    if (previous === null || state.importStatus !== previous.importStatus) {
      drawImport(state.importStatus);
      if (previous !== null && state.importStatus?.message) {
        showImportStatus();
      }
    }
    if (state.canUndo && !previous?.canUndo) {
      showToast();
    } else if (!state.canUndo && previous?.canUndo) {
      hideToast();
    }
  }

  for (const [path, control] of controls) {
    if (control.tagName !== "SELECT") {
      control.addEventListener("input", () =>
        actions.input(path, readControl(path)),
      );
    }
    control.addEventListener("change", () =>
      actions.change(path, readControl(path)),
    );
    // A field typed in is checked when it loses focus even if no change
    // fires (#247: Backspace then the same digit gives back the value it had
    // on focus). After a change there is nothing left to check.
    control.addEventListener("blur", () => actions.commitEdits?.());
  }

  // No submit: Run is #153's. Enter commits the field it was pressed in.
  form.addEventListener("submit", (event) => event.preventDefault());
  const onEnter = (event) => {
    if (event.key !== "Enter" || event.target?.tagName !== "INPUT") {
      return;
    }
    event.preventDefault();
    const path = event.target.getAttribute("data-field");
    if (controls.has(path)) {
      actions.change(path, readControl(path));
    }
  };
  form.addEventListener("keydown", onEnter);
  // A field outside the form (Target level, in Fight: #318) listens itself.
  for (const control of controls.values()) {
    if (
      typeof control.closest === "function" &&
      control.closest("#config-form") === null
    ) {
      control.addEventListener("keydown", onEnter);
    }
  }

  rotation.addEventListener("change", () =>
    actions.chooseRotation(rotation.value),
  );

  // Off while the rotation has errors (D17): aria-disabled, so it keeps
  // focus and says why, and a press writes nothing.
  exportButton.addEventListener("click", () => {
    const file = actions.exportRotation();
    if (file === null) {
      return;
    }
    const { fileName, text } = file;
    const url = win.URL.createObjectURL(
      new win.Blob([text], { type: "application/json" }),
    );
    const link = doc.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 0);
  });

  importFile.addEventListener("change", async () => {
    const [file] = importFile.files ?? [];
    if (file === undefined) {
      return;
    }
    const text = await file.text();
    importFile.value = "";
    actions.importText(text);
  });
  $("cfg-import-paste").addEventListener("click", () => {
    if (actions.importText(importText.value)) {
      importText.value = "";
    }
  });

  $("cfg-reset").addEventListener("click", () => actions.reset());
  undo.addEventListener("click", () => {
    actions.undo();
    hideToast();
  });

  render(store.get().form);
  const edited = $("cfg-edited");
  // Also while a kept result is out of date (#242): the results say so
  // until the next run.
  const drawEdited = (state) => {
    edited.hidden = !editedSinceRun(state) && !anyStale(state);
  };
  drawEdited(store.get());
  return store.subscribe(({ state, changed }) => {
    if (changed.includes("form")) {
      render(state.form);
    }
    if (["config", "run", "ran", "batch"].some((s) => changed.includes(s))) {
      drawEdited(state);
    }
    const nowBar = barErrorsOf(state);
    if (nowBar.join(" ") !== barErrors.join(" ")) {
      barErrors = nowBar;
      drawErrors(state.form.errors);
    }
  });
}
