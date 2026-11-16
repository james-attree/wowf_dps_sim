// The gear screen: paper doll, search, read-only stats, saved builds, and
// the read-only legacy-sheet banner.

import { attachIconFallback, iconUrl } from "../icons.js";
import { NOT_WIDE_QUERY, WIDE_QUERY } from "./breakpoints.js";

const NONE = -1;
const FIRST = 0;
const STEP = 1;
const EMPTY_VALUE = "";
const LEAVE_EMPTY_ID = "gear-opt-empty";
const MINUS_GLYPH = "—";
const KEY = Object.freeze({
  down: "ArrowDown",
  up: "ArrowUp",
  enter: "Enter",
  escape: "Escape",
  home: "Home",
  end: "End",
  tab: "Tab",
});

function write(node, text) {
  if (node !== null && node.textContent !== text) {
    node.textContent = text;
  }
}

function show(node, on) {
  if (node !== null) {
    node.hidden = !on;
  }
}

export function createGearScreenView(doc, store, actions) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const lead = $("gear-lead");
  const mhBlock = $("gear-mh-block");
  const levelBlock = $("gear-level-block");
  const buildUi = $("gear-build-ui");
  const picker = $("gear-picker");
  const pickerTitle = $("gear-picker-title");
  const pickerClose = $("gear-picker-close");
  const search = $("gear-search");
  const searchLabel = $("gear-search-label");
  const searchClear = $("gear-search-clear");
  const list = $("gear-list");
  const status = $("gear-search-status");
  const tooltip = $("gear-item-tooltip");
  const mods = $("gear-mods");
  const enchantSelect = $("gear-enchant");
  const suffixSelect = $("gear-suffix");
  const statsNote = $("gear-stats-note");
  const statsList = $("gear-stats-list");
  const notModelled = $("gear-not-modelled");
  const notChip = $("gear-not-modelled-chip");
  const notBody = $("gear-not-modelled-body");
  const notHelp = $("gear-not-modelled-help");
  const notList = $("gear-not-modelled-list");
  const credit = $("gear-credit");
  const legacy = $("gear-legacy");
  const legacyBanner = $("gear-legacy-banner");
  const startP1 = $("gear-start-p1");
  const startEmpty = $("gear-start-empty");
  const buildsList = $("gear-builds-list");
  const buildsLive = $("gear-builds-live");
  const saveName = $("gear-save-name");
  const saveButton = $("gear-save-build");
  const slotButtons = [
    ...(doc.querySelectorAll("#gear-doll [data-slot]") ?? []),
  ];
  const win = doc.defaultView;
  let openSlot = null;
  let query = EMPTY_VALUE;
  let options = [];
  let active = NONE;
  let lastStatus = EMPTY_VALUE;
  let creditReady = false;

  const modelOf = () => actions.model();
  const currentSlots = () => actions.currentSlots();
  const copy = actions.copy;

  function phonePicker() {
    return win?.matchMedia?.(NOT_WIDE_QUERY).matches === true;
  }

  function pickerFocusables() {
    if (picker == null) {
      return [];
    }
    return [
      ...picker.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((node) => !node.hidden && node.getClientRects().length > 0);
  }

  function setPickerChrome(on) {
    if (picker == null) {
      return;
    }
    if (on && phonePicker()) {
      picker.setAttribute("role", "dialog");
      picker.setAttribute("aria-modal", "true");
      picker.setAttribute("aria-labelledby", "gear-picker-title");
    } else {
      picker.removeAttribute("role");
      picker.removeAttribute("aria-modal");
      picker.removeAttribute("aria-labelledby");
    }
  }

  function closePicker() {
    const was = openSlot;
    openSlot = null;
    query = EMPTY_VALUE;
    options = [];
    active = NONE;
    lastStatus = EMPTY_VALUE;
    show(picker, false);
    setPickerChrome(false);
    if (search !== null) {
      search.value = EMPTY_VALUE;
      search.setAttribute("aria-expanded", "false");
      search.removeAttribute("aria-activedescendant");
    }
    $(`gear-slot-${was}`)?.focus();
  }

  function fillSelect(select, rows, noneLabel, current, disabled) {
    if (select === null) {
      return;
    }
    select.replaceChildren();
    const none = doc.createElement("option");
    none.value = EMPTY_VALUE;
    none.textContent = noneLabel;
    select.append(none);
    for (const row of rows) {
      const option = doc.createElement("option");
      option.value = String(row.id ?? row.effectId);
      option.textContent = row.name;
      select.append(option);
    }
    select.value = current == null ? EMPTY_VALUE : String(current);
    select.disabled = disabled;
  }

  function drawMods(row) {
    const hasItem = Boolean(row && !row.empty && row.item);
    show(mods, hasItem);
    if (!hasItem) {
      return;
    }
    const entry = row.entry;
    fillSelect(
      enchantSelect,
      actions.enchantsForSlot(row.slot),
      copy.NO_ENCHANT,
      entry?.enchant ?? null,
      false,
    );
    const suffixRows = actions.suffixesForItem(row.item);
    fillSelect(
      suffixSelect,
      suffixRows,
      copy.NO_SUFFIX,
      entry?.suffix ?? null,
      suffixRows.length === FIRST,
    );
  }

  function optionId(option) {
    return option.leaveEmpty ? LEAVE_EMPTY_ID : `gear-opt-${option.item.id}`;
  }

  function drawTooltip(option) {
    if (tooltip === null) {
      return;
    }
    if (!option || option.leaveEmpty || !option.item) {
      tooltip.hidden = true;
      tooltip.replaceChildren();
      return;
    }
    const item = option.item;
    const quality = actions.qualityName(item.quality) ?? EMPTY_VALUE;
    tooltip.hidden = false;
    tooltip.dataset.quality = quality.toLowerCase();
    const name = doc.createElement("p");
    name.className = `wow-tooltip-name ${actions.qualityClass(item.quality)}`;
    name.textContent = item.name;
    const word = doc.createElement("p");
    word.className = "wow-tooltip-quality";
    word.textContent = quality;
    const meta = doc.createElement("p");
    meta.className = "wow-tooltip-stats";
    meta.textContent = actions.resultMeta(item);
    tooltip.replaceChildren(name, word, meta);
  }

  function paintOptions() {
    if (list === null) {
      return;
    }
    list.replaceChildren();
    options.forEach((option, index) => {
      const item = doc.createElement("li");
      item.setAttribute("role", "presentation");
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.id = optionId(option);
      button.setAttribute("aria-selected", index === active ? "true" : "false");
      const face = doc.createElement("span");
      face.className = "gear-slot-face";
      face.setAttribute("aria-hidden", "true");
      const glyph = doc.createElement("span");
      glyph.className = "gear-slot-glyph";
      const textCol = doc.createElement("span");
      const name = doc.createElement("span");
      const meta = doc.createElement("span");
      meta.className = "gear-option-meta";
      if (option.leaveEmpty) {
        glyph.textContent = MINUS_GLYPH;
        name.textContent = copy.LEAVE_EMPTY;
        meta.textContent = copy.LEAVE_EMPTY_META;
      } else {
        const qName = actions.qualityName(option.item.quality) ?? EMPTY_VALUE;
        if (qName) {
          const token = `var(--q-${qName.toLowerCase()})`;
          face.style.borderColor = token;
          face.style.color = token;
        }
        glyph.textContent = actions.itemInitials(option.item.name);
        textCol.className = actions.qualityClass(option.item.quality);
        name.textContent = option.item.name;
        meta.textContent = actions.resultMeta(option.item);
        if (option.item.icon) {
          const image = doc.createElement("img");
          image.alt = EMPTY_VALUE;
          attachIconFallback(image);
          image.src = iconUrl(option.item.icon);
          face.prepend(image);
        }
      }
      face.append(glyph);
      textCol.append(name, " ", meta);
      button.append(face, textCol);
      button.addEventListener("click", () => selectIndex(index));
      item.append(button);
      list.append(item);
    });
    const current = options[active];
    if (search !== null) {
      if (current) {
        search.setAttribute("aria-activedescendant", optionId(current));
      } else {
        search.removeAttribute("aria-activedescendant");
      }
    }
    drawTooltip(current);
  }

  function refreshSearch() {
    if (openSlot === null) {
      return;
    }
    const found = actions.search(query, openSlot);
    options = [
      { leaveEmpty: true },
      ...found.items.map((item) => ({ leaveEmpty: false, item })),
    ];
    if (active >= options.length) {
      active = options.length - STEP;
    }
    if (active < FIRST) {
      active = FIRST;
    }
    paintOptions();
    if (status !== null && found.status !== lastStatus) {
      write(status, found.status);
      lastStatus = found.status;
    }
    search?.setAttribute("aria-expanded", "true");
  }

  function moveActive(delta) {
    if (options.length === FIRST) {
      return;
    }
    const last = options.length - STEP;
    let next = active + delta;
    if (next < FIRST) {
      next = last;
    } else if (next > last) {
      next = FIRST;
    }
    active = next;
    paintOptions();
    list
      ?.querySelector(`#${optionId(options[active])}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function selectIndex(index) {
    const option = options[index];
    if (!option || openSlot === null) {
      return;
    }
    const slot = openSlot;
    if (option.leaveEmpty) {
      actions.applySlots(actions.setSlot(currentSlots(), slot, null));
      closePicker();
      return;
    }
    actions.applySlots(
      actions.setSlot(currentSlots(), slot, { item: option.item.id }),
    );
    query = EMPTY_VALUE;
    if (search !== null) {
      search.value = EMPTY_VALUE;
    }
    openPicker(slot, true);
  }

  function applyMod() {
    if (openSlot === null) {
      return;
    }
    const row = modelOf().rows[openSlot];
    if (!row?.item) {
      return;
    }
    actions.applySlots(
      actions.setSlot(currentSlots(), openSlot, {
        item: row.item.id,
        enchant:
          enchantSelect?.value === EMPTY_VALUE
            ? null
            : Number(enchantSelect.value),
        suffix:
          suffixSelect?.value === EMPTY_VALUE
            ? null
            : Number(suffixSelect.value),
      }),
    );
  }

  function openPicker(slot, keepFocus = false) {
    openSlot = slot;
    query = EMPTY_VALUE;
    lastStatus = EMPTY_VALUE;
    show(picker, true);
    setPickerChrome(true);
    write(pickerTitle, actions.slotLabel(slot));
    write(searchLabel, `Search ${actions.slotLabel(slot).toLowerCase()} items`);
    if (search !== null) {
      search.value = EMPTY_VALUE;
      search.setAttribute("aria-expanded", "true");
    }
    write(status, copy.SEARCH_HINT);
    drawMods(modelOf().rows[slot]);
    refreshSearch();
    if (!keepFocus) {
      search?.focus();
    }
  }

  function paintSlot(button, row) {
    const face = button.querySelector(".gear-slot-face");
    const glyph = button.querySelector(".gear-slot-glyph");
    const copyEl = button.querySelector(".gear-slot-copy");
    const name = button.querySelector(".gear-slot-name");
    const hint = button.querySelector(".gear-slot-hint");
    let image = face?.querySelector("img");
    write(glyph, row.glyph);
    write(name, row.name);
    write(hint, row.hint);
    if (name && hint && name.nextSibling === hint) {
      name.after(" ");
    }
    if (row.qualityName) {
      button.dataset.quality = row.qualityName.toLowerCase();
      name.className = "gear-slot-name";
      if (copyEl) {
        copyEl.className = `gear-slot-copy ${row.qualityClass}`;
      }
    } else {
      delete button.dataset.quality;
      name.className = "gear-slot-name";
      if (copyEl) {
        copyEl.className = "gear-slot-copy";
      }
    }
    button.classList.toggle("is-conflict", row.conflict);
    if (row.icon) {
      if (!image) {
        image = doc.createElement("img");
        image.alt = EMPTY_VALUE;
        attachIconFallback(image);
        face?.prepend(image);
      }
      image.hidden = false;
      if (image.getAttribute("data-icon") !== row.icon) {
        image.setAttribute("data-icon", row.icon);
        attachIconFallback(image);
        image.src = iconUrl(row.icon);
      }
    } else if (image) {
      image.hidden = true;
      image.removeAttribute("data-icon");
    }
  }

  function paintStats(view) {
    if (statsList === null) {
      return;
    }
    write(
      statsNote,
      view.legacy
        ? copy.LEGACY_BANNER
        : view.race
          ? `Read-only. Level ${view.level} ${view.race} + this gear. ${copy.TALENT_NOTE}`
          : `Read-only. Level ${view.level} + this gear. ${copy.TALENT_NOTE}`,
    );
    statsList.replaceChildren();
    for (const row of view.stats) {
      const wrap = doc.createElement("div");
      wrap.className = "gear-stat";
      const dt = doc.createElement("dt");
      dt.textContent = row.label;
      const dd = doc.createElement("dd");
      const value = doc.createTextNode(row.value);
      dd.append(value);
      if (row.source) {
        const src = doc.createElement("span");
        src.className = "gear-stat-source";
        src.textContent = row.source;
        dd.append(src);
      }
      wrap.append(dt, dd);
      statsList.append(wrap);
    }
    const has = view.notModelledCount > FIRST;
    show(notModelled, has);
    if (!has) {
      return;
    }
    write(notChip, view.notModelledLabel);
    write(notHelp, copy.NOT_MODELLED_HELP);
    notList?.replaceChildren();
    for (const entry of view.notModelled) {
      const item = doc.createElement("li");
      const where = entry.slot
        ? `${actions.slotLabel(entry.slot)} — `
        : EMPTY_VALUE;
      item.textContent = `${where}${entry.name}`;
      notList?.append(item);
    }
  }

  function drawCredit() {
    if (credit === null || creditReady) {
      return;
    }
    const link = doc.createElement("a");
    link.href = copy.CREDIT_HREF;
    link.id = "gear-credit-link";
    link.textContent = copy.CREDIT_LABEL;
    credit.replaceChildren(
      doc.createTextNode(copy.CREDIT_BEFORE),
      link,
      doc.createTextNode(copy.CREDIT_AFTER),
    );
    creditReady = true;
  }

  function drawLegacy(view) {
    show(legacy, view.legacy);
    write(legacyBanner, view.legacyBanner);
    if (startP1 !== null) {
      write(startP1, copy.START_P1);
    }
    if (startEmpty !== null) {
      write(startEmpty, copy.START_EMPTY);
    }
  }

  function drawBuilds() {
    if (buildsList === null) {
      return;
    }
    write(buildsLive, actions.gearMessage());
    const rows = actions.listedBuilds();
    buildsList.replaceChildren();
    for (const build of rows) {
      const item = doc.createElement("li");
      item.className = "gear-build-row";
      item.setAttribute("data-build-id", build.id);
      const name = doc.createElement("div");
      name.className = "gear-build-name";
      const label = doc.createElement("span");
      label.textContent = build.name;
      name.append(label);
      if (build.currentLabel) {
        const mark = doc.createElement("span");
        mark.className = "gear-build-current";
        mark.textContent = build.currentLabel;
        name.append(mark);
      }
      const actionsRow = doc.createElement("div");
      actionsRow.className = "gear-build-actions";
      const load = doc.createElement("button");
      load.type = "button";
      load.className = "gear-build-btn";
      load.setAttribute("data-act", "load");
      load.textContent = "Load";
      actionsRow.append(load);
      if (!build.builtin) {
        const rename = doc.createElement("button");
        rename.type = "button";
        rename.className = "gear-build-btn";
        rename.setAttribute("data-act", "rename");
        rename.textContent = "Rename";
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "gear-build-btn";
        remove.setAttribute("data-act", "remove");
        remove.textContent = "Delete";
        actionsRow.append(rename, remove);
      }
      item.append(name, actionsRow);
      buildsList.append(item);
    }
  }

  function draw() {
    const route = store.get().route;
    const onGear = route?.area === "character" && route?.sub === "gear";
    if (!onGear && openSlot !== null) {
      closePicker();
    }
    if (lead === null) {
      return;
    }
    const view = modelOf();
    write(lead, view.lead);
    write(mhBlock, view.emptyMainHandText);
    show(mhBlock, view.emptyMainHand);
    write(levelBlock, view.levelBlockText);
    show(levelBlock, view.levelBlocked);
    show(buildUi, true);
    for (const button of slotButtons) {
      button.hidden = !view.showDoll;
      const row = view.rows[button.getAttribute("data-slot")];
      if (row && view.showDoll) {
        paintSlot(button, row);
      }
    }
    paintStats(view);
    if (view.showDoll && openSlot !== null) {
      drawMods(view.rows[openSlot]);
    }
    drawLegacy(view);
    drawBuilds();
    drawCredit();
  }

  for (const button of slotButtons) {
    button.addEventListener("click", () => {
      if (modelOf().showDoll) {
        openPicker(button.getAttribute("data-slot"));
      }
    });
  }
  pickerClose?.addEventListener("click", () => closePicker());
  searchClear?.addEventListener("click", () => {
    query = EMPTY_VALUE;
    if (search !== null) {
      search.value = EMPTY_VALUE;
    }
    refreshSearch();
    search?.focus();
  });
  search?.addEventListener("input", () => {
    query = search.value;
    refreshSearch();
  });
  search?.addEventListener("keydown", (event) => {
    if (event.key === KEY.down) {
      event.preventDefault();
      moveActive(STEP);
    } else if (event.key === KEY.up) {
      event.preventDefault();
      moveActive(-STEP);
    } else if (event.key === KEY.home) {
      event.preventDefault();
      active = FIRST;
      paintOptions();
    } else if (event.key === KEY.end) {
      event.preventDefault();
      active = options.length - STEP;
      paintOptions();
    } else if (event.key === KEY.enter) {
      event.preventDefault();
      selectIndex(active);
    } else if (event.key === KEY.escape) {
      event.preventDefault();
      closePicker();
    }
  });
  picker?.addEventListener("keydown", (event) => {
    if (event.key === KEY.escape && event.target !== search) {
      event.preventDefault();
      closePicker();
      return;
    }
    if (event.key !== KEY.tab || picker.hidden || !phonePicker()) {
      return;
    }
    const items = pickerFocusables();
    if (items.length === 0) {
      return;
    }
    const first = items[FIRST];
    const last = items[items.length - STEP];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  enchantSelect?.addEventListener("change", () => applyMod());
  suffixSelect?.addEventListener("change", () => applyMod());
  notChip?.addEventListener("click", () => {
    const open = notBody?.hidden === true;
    show(notBody, open);
    notChip?.setAttribute("aria-expanded", open ? "true" : "false");
  });
  win?.addEventListener("keydown", (event) => {
    if (
      event.key === KEY.escape &&
      openSlot !== null &&
      picker &&
      !picker.hidden
    ) {
      const path = event.composedPath?.() ?? [];
      if (!path.includes(picker)) {
        event.preventDefault();
        closePicker();
      }
    }
  });

  // The wide query is read so a later layout can tell desktop from phone
  // without a second copy of 64em. The picker is styled in CSS.
  win?.matchMedia?.(WIDE_QUERY);

  startP1?.addEventListener("click", () => actions.startP1());
  startEmpty?.addEventListener("click", () => actions.startEmpty());
  saveButton?.addEventListener("click", () => {
    actions.saveBuild(saveName?.value ?? EMPTY_VALUE);
    if (saveName && actions.gearMessage() === "Gear build saved.") {
      saveName.value = EMPTY_VALUE;
    }
    drawBuilds();
  });
  buildsList?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    const row = event.target.closest("[data-build-id]");
    if (!button || !row) {
      return;
    }
    const id = row.getAttribute("data-build-id");
    const act = button.getAttribute("data-act");
    if (act === "load") {
      actions.loadBuild(id);
      return;
    }
    if (act === "remove") {
      actions.removeBuild(id);
      drawBuilds();
      return;
    }
    if (act === "rename") {
      beginRename(row, id);
    }
  });

  function beginRename(row, id) {
    const actionsRow = row.querySelector(".gear-build-actions");
    const field = doc.createElement("input");
    field.type = "text";
    field.className = "gear-save-name";
    field.value =
      row.querySelector(".gear-build-name span")?.textContent ?? EMPTY_VALUE;
    field.setAttribute("aria-label", "New name");
    const confirm = doc.createElement("button");
    confirm.type = "button";
    confirm.className = "gear-build-btn";
    confirm.textContent = "Save name";
    const finish = (ok) => {
      if (ok) {
        actions.renameBuild(id, field.value);
      }
      drawBuilds();
    };
    confirm.addEventListener("click", () => finish(true));
    field.addEventListener("keydown", (event) => {
      if (event.key === KEY.escape) {
        event.preventDefault();
        finish(false);
      } else if (event.key === KEY.enter) {
        event.preventDefault();
        finish(true);
      }
    });
    actionsRow?.replaceChildren(field, confirm);
    field.focus();
    field.select();
  }

  draw();
  store.subscribe(({ changed }) => {
    if (
      changed.includes("route") ||
      changed.includes("config") ||
      changed.includes("form") ||
      changed.includes("gearMessage")
    ) {
      draw();
    }
  });
}
