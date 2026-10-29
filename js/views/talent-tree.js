import { attachIconFallback } from "../icons.js";
import { el, toDom } from "../svg.js";
import { NARROW_QUERY } from "./breakpoints.js";

// The talent tree picker's view (U6, #204; Fran's spec and mockup in
// design/u6-talent-tree/). It draws the store's `talents` slice, which
// js/talent-tree.js fills (the view never reads the talent catalogue), and
// calls that model's actions. It owns the summary row in Fight setup
// (#talents-summary, #talents-edit) and the #talent-tree section under the
// form.
//
// The tiles are made once and updated in place, so focus stays on the tile
// you act on. Each tree is one roving tab stop: the arrow keys move between
// its talents, Enter, Space or + adds a point, and −, Backspace or Delete
// removes one (Shift+click and right-click remove too, but never only them).
// Below NARROW_QUERY the trees are tabs. Announcements go to one status line.

const LOCK = el(
  "svg",
  {
    viewBox: "0 0 16 16",
    width: "12",
    height: "12",
    "aria-hidden": "true",
    focusable: "false",
  },
  [
    el("path", {
      fill: "currentColor",
      d: "M4.5 7V5a3.5 3.5 0 0 1 7 0v2H12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h.5Zm1.5 0h4V5a2 2 0 0 0-4 0v2Z",
    }),
  ],
);

const NOT_SIMULATED_NOTE =
  "Not simulated yet: the sim doesn't model this talent, so its points add no DPS.";

const ADD_KEYS = new Set(["Enter", " ", "+", "="]);
const REMOVE_KEYS = new Set(["-", "Backspace", "Delete"]);

// The talent the arrow key `key` moves to from `from` among one tree's
// `cells` ({ id, row, col }), or null (an edge, or not a move key). Right and
// Left walk the reading order; Down and Up go to the nearest row below or
// above, keeping the column where they can.
export function nextTalent(cells, from, key) {
  const order = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const index = order.findIndex(({ id }) => id === from);
  if (index === -1) {
    return null;
  }
  const here = order[index];
  const nearest = (list) =>
    [...list].sort(
      (a, b) =>
        Math.abs(a.row - here.row) - Math.abs(b.row - here.row) ||
        Math.abs(a.col - here.col) - Math.abs(b.col - here.col) ||
        a.col - b.col,
    )[0] ?? null;
  switch (key) {
    case "ArrowRight":
      return order[index + 1]?.id ?? null;
    case "ArrowLeft":
      return order[index - 1]?.id ?? null;
    case "ArrowDown":
      return nearest(order.filter(({ row }) => row > here.row))?.id ?? null;
    case "ArrowUp":
      return nearest(order.filter(({ row }) => row < here.row))?.id ?? null;
    case "Home":
      return order[0].id;
    case "End":
      return order[order.length - 1].id;
    default:
      return null;
  }
}

// "add", "remove" or null for a key on a tile.
export function tileKeyAction(event) {
  if (event.key === "Enter" && event.shiftKey) {
    return "remove";
  }
  if (ADD_KEYS.has(event.key)) {
    return "add";
  }
  if (REMOVE_KEYS.has(event.key)) {
    return "remove";
  }
  return null;
}

export function createTalentTreeView(
  doc,
  store,
  actions,
  { matchMedia = globalThis.matchMedia?.bind(globalThis) } = {},
) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const summary = $("talents-summary");
  const edit = $("talents-edit");
  const panel = $("talent-tree");
  const reset = $("talents-reset");
  const close = $("talents-close");
  const level = $("talents-level");
  const levelError = $("talents-level-error");
  const points = $("talents-points");
  const message = $("talents-message");
  const tabs = $("talents-tabs");
  const treesWrap = $("talents-trees");
  const legend = $("talents-legend");
  const detail = $("talents-detail");
  const effects = $("talents-effects");
  const live = $("talents-live");

  const media = matchMedia?.(NARROW_QUERY) ?? null;
  const narrow = () => media?.matches === true;

  const make = (tag, attrs = {}, children = []) => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== null && value !== undefined && value !== false) {
        node.setAttribute(name, value === true ? "" : String(value));
      }
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) {
        continue;
      }
      node.append(
        typeof child === "string" ? doc.createTextNode(child) : child,
      );
    }
    return node;
  };
  const icon = (url, size) => {
    const image = make("img", { alt: "", width: size, height: size });
    attachIconFallback(image);
    image.setAttribute("loading", "lazy");
    image.src = url;
    return image;
  };
  const write = (node, text) => {
    if (node.textContent !== text) {
      node.textContent = text;
    }
  };

  // Built once from the first state: each tree's section, grid and tiles.
  const tiles = new Map();
  const sections = new Map();
  const tabButtons = new Map();
  const treeHeads = new Map();
  const roving = new Map();
  let treeCells = new Map();

  function buildTrees(view) {
    treeCells = new Map(view.trees.map((tree) => [tree.id, tree.cells]));
    for (const tree of view.trees) {
      const count = make("span", { class: "talent-tree-points" });
      const head = make(
        "h3",
        { class: "talent-tree-head", id: `talents-tree-h-${tree.id}` },
        [icon(tree.iconUrl, 24), make("span", {}, [tree.name]), count],
      );
      const grid = make("div", { class: "talent-grid", role: "group" });
      const section = make(
        "section",
        {
          class: "talent-tree",
          id: `talents-tree-${tree.id}`,
          "aria-labelledby": `talents-tree-h-${tree.id}`,
        },
        [head, grid],
      );
      for (const gutter of tree.gutters) {
        grid.append(
          make(
            "span",
            {
              class: "talent-gutter",
              style: `grid-row:${gutter.row};grid-column:1`,
              "aria-hidden": "true",
            },
            [String(gutter.need)],
          ),
        );
      }
      for (const arrow of tree.arrows) {
        grid.append(
          make("span", {
            class: "talent-arrow",
            "aria-hidden": "true",
            style: `grid-column:${arrow.col + 1};grid-row:${arrow.fromRow} / ${arrow.toRow + 1}`,
          }),
        );
      }
      for (const cell of tree.cells) {
        const tile = make("button", {
          type: "button",
          class: "talent",
          "data-id": cell.id,
          style: `grid-row:${cell.row};grid-column:${cell.col + 1}`,
          tabindex: "-1",
          "aria-describedby": "talents-keys",
        });
        const image = icon(cell.iconUrl, 40);
        tile.append(image);
        tiles.set(cell.id, { tile, image, tree: tree.id });
        tile.addEventListener("click", (event) =>
          act(event?.shiftKey ? "remove" : "add", cell.id),
        );
        tile.addEventListener("contextmenu", (event) => {
          event?.preventDefault?.();
          act("remove", cell.id);
        });
        tile.addEventListener("focus", () => {
          roving.set(tree.id, cell.id);
          actions.select(cell.id);
        });
        tile.addEventListener("keydown", (event) => onTileKey(event, cell.id));
        grid.append(tile);
      }
      roving.set(tree.id, tree.cells[0].id);
      sections.set(tree.id, { section, grid, count });
      treeHeads.set(tree.id, head);
      treesWrap.append(section);

      const tab = make(
        "button",
        {
          type: "button",
          role: "tab",
          class: "talents-tab",
          id: `talents-tab-${tree.id}`,
          "aria-controls": `talents-tree-${tree.id}`,
        },
        [icon(tree.iconUrl, 20), make("span", {}, [tree.name])],
      );
      const tabCount = make("span", { class: "talents-tab-points" });
      tab.append(tabCount);
      tab.addEventListener("click", () => actions.chooseTab(tree.id));
      tab.addEventListener("keydown", (event) => onTabKey(event, tree.id));
      tabButtons.set(tree.id, { tab, count: tabCount });
      tabs.append(tab);
    }
  }

  function focusTile(id) {
    const found = tiles.get(id);
    if (found === undefined) {
      return;
    }
    roving.set(found.tree, id);
    render(store.get().talents);
    found.tile.focus?.();
  }

  function act(kind, id) {
    if (kind === "add") {
      actions.add(id);
    } else {
      actions.remove(id);
    }
  }

  function onTileKey(event, id) {
    const action = tileKeyAction(event);
    if (action !== null) {
      event.preventDefault?.();
      act(action, id);
      return;
    }
    const { tree } = tiles.get(id);
    const next = nextTalent(treeCells.get(tree), id, event.key);
    if (next !== null) {
      event.preventDefault?.();
      focusTile(next);
    }
  }

  function onTabKey(event, treeId) {
    const ids = [...tabButtons.keys()];
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault?.();
    const next = ids[(ids.indexOf(treeId) + step + ids.length) % ids.length];
    actions.chooseTab(next);
    tabButtons.get(next).tab.focus?.();
  }

  function buildLegend() {
    const lock = make("span", { class: "lg lg-lock", "aria-hidden": "true" });
    lock.append(toDom(LOCK, doc));
    const item = (mark, text) => make("li", {}, [mark, ` ${text}`]);
    legend.replaceChildren(
      item(
        make("span", { class: "lg lg-rank", "aria-hidden": "true" }, ["2/3"]),
        "points / ranks",
      ),
      item(lock, "locked (row or prerequisite)"),
      item(
        make("span", { class: "lg lg-cov is-notsim", "aria-hidden": "true" }, [
          "ⓘ",
        ]),
        "not simulated yet",
      ),
      item(
        make("span", { class: "lg lg-cov", "aria-hidden": "true" }, ["–"]),
        "no DPS effect",
      ),
      item(
        make("span", { class: "lg lg-active", "aria-hidden": "true" }),
        "ability (an active talent)",
      ),
    );
  }

  function drawTile(cell, tabbable) {
    const { tile } = tiles.get(cell.id);
    const classes = [
      "talent",
      `is-${cell.state}`,
      `cov-${cell.coverage}`,
      cell.selected ? "is-selected" : "",
    ].filter((part) => part !== "");
    tile.setAttribute("class", classes.join(" "));
    tile.setAttribute("aria-label", cell.label);
    tile.setAttribute("tabindex", tabbable ? "0" : "-1");
    const { image } = tiles.get(cell.id);
    const badges = [
      make("span", { class: "talent-rank", "aria-hidden": "true" }, [
        cell.rankText,
      ]),
    ];
    if (cell.state === "locked") {
      const lock = make("span", {
        class: "talent-lock",
        "aria-hidden": "true",
      });
      lock.append(toDom(LOCK, doc));
      badges.push(lock);
    }
    if (cell.coverage === "notSimulated") {
      badges.push(
        make("span", { class: "talent-cov is-notsim", "aria-hidden": "true" }, [
          "ⓘ",
        ]),
      );
    }
    if (cell.coverage === "noDps") {
      badges.push(
        make("span", { class: "talent-cov", "aria-hidden": "true" }, ["–"]),
      );
    }
    if (cell.active) {
      badges.push(
        make("span", { class: "talent-active", "aria-hidden": "true" }),
      );
    }
    tile.replaceChildren(image, ...badges);
  }

  function drawTrees(view) {
    const isNarrow = narrow();
    tabs.hidden = !isNarrow;
    for (const tree of view.trees) {
      const { section, grid, count } = sections.get(tree.id);
      write(count, tree.pointsText);
      grid.setAttribute("aria-label", tree.label);
      const current = tree.id === view.tab;
      if (isNarrow) {
        section.setAttribute("role", "tabpanel");
        section.setAttribute("aria-labelledby", `talents-tab-${tree.id}`);
        section.hidden = !current;
      } else {
        section.removeAttribute("role");
        section.setAttribute("aria-labelledby", `talents-tree-h-${tree.id}`);
        section.hidden = false;
      }
      const { tab, count: tabCount } = tabButtons.get(tree.id);
      tab.setAttribute("aria-selected", String(current));
      tab.setAttribute("tabindex", current ? "0" : "-1");
      write(tabCount, String(tree.points));
      const gutters = [...grid.children].filter((node) =>
        node.getAttribute?.("class")?.startsWith("talent-gutter"),
      );
      tree.gutters.forEach((gutter, index) => {
        gutters[index]?.setAttribute(
          "class",
          gutter.met ? "talent-gutter is-met" : "talent-gutter",
        );
      });
      const arrows = [...grid.children].filter((node) =>
        node.getAttribute?.("class")?.startsWith("talent-arrow"),
      );
      tree.arrows.forEach((arrow, index) => {
        arrows[index]?.setAttribute(
          "class",
          arrow.lit ? "talent-arrow is-lit" : "talent-arrow",
        );
      });
      const stop = roving.get(tree.id);
      for (const cell of tree.cells) {
        drawTile(cell, cell.id === stop);
      }
    }
  }

  function drawPoints(view) {
    points.setAttribute(
      "class",
      view.over ? "talents-points is-over" : "talents-points",
    );
    points.replaceChildren(
      make("span", { class: "talents-points-main" }, [
        make("strong", {}, [String(view.total)]),
        ` of ${view.cap} points spent`,
      ]),
      make("span", { class: "talents-points-left" }, [
        view.over ? view.pill.replace(/^⚠ /, "") : view.pill,
      ]),
    );
  }

  function drawMessage(state, view) {
    const parts = [];
    if (view.errorBanner !== null) {
      parts.push(
        make("div", { class: "talents-banner is-error", id: "talents-over" }, [
          make("strong", {}, [view.errorBanner.strong]),
          view.errorBanner.text,
        ]),
      );
    }
    const note = state.message;
    if (note !== null && note !== undefined) {
      const banner = make(
        "div",
        {
          class: `talents-banner ${note.kind === "undo" ? "is-info" : "is-refused"}`,
        },
        [make("span", {}, [note.text])],
      );
      for (const blocker of note.blockers ?? []) {
        const show = make("button", { type: "button", class: "link-button" }, [
          `Show ${blocker.name}`,
        ]);
        show.addEventListener("click", () => {
          actions.show(blocker.id);
          focusTile(blocker.id);
        });
        banner.append(" ", show);
      }
      if (note.kind === "undo") {
        const undo = make("button", { type: "button", class: "pill-button" }, [
          "Undo",
        ]);
        undo.addEventListener("click", () => {
          actions.undo();
          reset.focus?.();
        });
        banner.append(" ", undo);
      }
      parts.push(banner);
    } else if (view.note !== null) {
      parts.push(make("p", { class: "talents-note" }, [view.note]));
    }
    message.replaceChildren(...parts);
  }

  function drawDetail(view) {
    const data = view.detail;
    const focused = doc.activeElement?.getAttribute?.("data-step") ?? null;
    if (data === null) {
      detail.replaceChildren(
        make("h3", { id: "talents-detail-heading", class: "visually-hidden" }, [
          "Talent details",
        ]),
        make("p", { class: "talent-detail-empty" }, [
          "Pick a talent to see what each rank does and how the sim treats it.",
        ]),
      );
      return;
    }
    const noted =
      data.coverage === "notSimulated" ? "talents-detail-note" : null;
    const step = (kind, label, text, enabled) => {
      const button = make(
        "button",
        {
          type: "button",
          class: "step-button",
          "data-step": kind,
          "aria-label": label,
          "aria-describedby": noted,
          "aria-disabled": enabled ? null : "true",
        },
        [text],
      );
      button.addEventListener("click", () => act(kind, data.id));
      return button;
    };
    const remove = step("remove", data.removeLabel, "−", data.canRemove);
    const add = step("add", data.addLabel, "+", data.canAdd);
    const nodes = [
      make("div", { class: "talent-detail-head" }, [
        icon(data.iconUrl, 40),
        make("div", {}, [
          make("h3", { id: "talents-detail-heading" }, [data.name]),
          make("p", { class: "talent-detail-sub" }, [data.sub]),
        ]),
        make("div", { class: "talent-stepper" }, [
          remove,
          make(
            "span",
            { class: "talent-stepper-rank", "aria-hidden": "true" },
            [data.rankText],
          ),
          add,
        ]),
      ]),
    ];
    const tags = make("p", { class: "talent-tags" }, [
      data.coverageTag === null
        ? null
        : make("span", { class: `tag tag-${data.coverage}` }, [
            data.coverageTag,
          ]),
      data.classicTag === null
        ? null
        : make("span", { class: "tag tag-classic" }, [data.classicTag]),
    ]);
    nodes.push(tags);
    if (data.coverage === "noDps" && data.noDpsReason) {
      nodes.push(
        make("p", { class: "talent-why" }, [`Why: ${data.noDpsReason}.`]),
      );
    }
    if (data.coverage === "notSimulated") {
      // The same markup as the poison selects' note (#152).
      nodes.push(
        make("p", { id: "talents-detail-note", class: "poison-note" }, [
          make("span", { "aria-hidden": "true" }, ["ⓘ "]),
          make("span", {}, [NOT_SIMULATED_NOTE]),
        ]),
      );
    }
    const ranks = make("dl", { class: "talent-ranks" });
    for (const row of [data.now, data.next]) {
      if (row !== null) {
        ranks.append(make("dt", {}, [row.label]), make("dd", {}, [row.text]));
      }
    }
    nodes.push(ranks);
    if (data.requirements.length > 0) {
      const list = make("ul", {
        class: "talent-reqs",
        "aria-label": "Requirements",
      });
      for (const requirement of data.requirements) {
        const mark =
          requirement.met === null ? "↓" : requirement.met ? "✓" : "✗";
        const cls =
          requirement.met === null
            ? "is-info"
            : requirement.met
              ? "is-ok"
              : "is-no";
        list.append(
          make("li", { class: cls }, [
            make("span", { class: "req-mark", "aria-hidden": "true" }, [mark]),
            requirement.text,
            requirement.met === null
              ? null
              : make("span", { class: "visually-hidden" }, [
                  requirement.met ? ", met" : ", not met",
                ]),
          ]),
        );
      }
      nodes.push(list);
    }
    for (const note of data.notes) {
      nodes.push(
        make("p", { class: "talent-ability" }, [
          note.strong === "" ? null : make("strong", {}, [`${note.strong} `]),
          note.text,
        ]),
      );
    }
    if (data.classicText !== null) {
      nodes.push(
        make("details", { class: "talent-classic" }, [
          make("summary", {}, ["Classic 1.12 version"]),
          make("p", {}, [data.classicText]),
        ]),
      );
    }
    if (data.block !== null) {
      nodes.push(make("p", { class: "talent-why is-block" }, [data.block]));
    }
    detail.replaceChildren(...nodes);
    if (focused === "add") {
      add.focus?.();
    } else if (focused === "remove") {
      remove.focus?.();
    }
  }

  function drawEffects(view) {
    const { stats, rotation, coverage } = view.effects;
    const lines = make("ul", { class: "effects-abilities" });
    for (const line of rotation.lines) {
      lines.append(
        make("li", { class: line.ok ? "is-ok" : "is-no" }, [
          make("span", { class: "req-mark", "aria-hidden": "true" }, [
            line.ok ? "✓" : "✗",
          ]),
          make("strong", {}, [line.name]),
          line.text,
        ]),
      );
    }
    const cover = [make("h3", {}, ["What the sim covers"])];
    if (coverage.plain !== null) {
      cover.push(make("p", {}, [coverage.plain]));
    }
    if (coverage.notSimulated !== null) {
      cover.push(
        make("p", { class: "poison-note" }, [
          make("span", { "aria-hidden": "true" }, ["ⓘ "]),
          make("span", {}, [coverage.notSimulated]),
        ]),
      );
    }
    if (coverage.noDps !== null) {
      cover.push(
        make("p", {}, [
          make("strong", {}, [coverage.noDps.strong]),
          coverage.noDps.text,
        ]),
      );
    }
    effects.replaceChildren(
      make("div", { class: "effects-block" }, [
        make("h3", {}, ["Character stats"]),
        make("p", {}, [stats.text]),
        make("p", { class: "effects-sheet" }, [stats.sheet]),
      ]),
      make("div", { class: "effects-block" }, [
        make("h3", {}, [rotation.title]),
        lines,
        rotation.note === null
          ? null
          : make("p", { class: "effects-sub" }, [rotation.note]),
      ]),
      make("div", { class: "effects-block" }, cover),
    );
  }

  let lastAnnounce = null;
  function announce(state) {
    const { text, count } = state.announce ?? { text: "", count: 0 };
    if (lastAnnounce === null) {
      lastAnnounce = count;
      return;
    }
    if (count === lastAnnounce) {
      return;
    }
    lastAnnounce = count;
    // A repeat of the same words still changes the text, so it is read again.
    const repeat = live.textContent.replace(/\u00a0$/, "") === text;
    live.textContent =
      repeat && !live.textContent.endsWith("\u00a0") ? `${text}\u00a0` : text;
  }

  let drawn = null;
  function render(state) {
    const view = state.view;
    if (tiles.size === 0) {
      buildTrees(view);
      buildLegend();
    }
    write(summary, view.summary);
    edit.setAttribute("aria-expanded", String(state.open));
    write(edit, state.open ? "Close talents" : "Edit talents");
    panel.hidden = !state.open;
    if (doc.activeElement !== level) {
      level.value = state.levelText;
    }
    const { min, max } = state.levelRange ?? {};
    if (min !== undefined) {
      level.setAttribute("min", String(min));
      level.setAttribute("max", String(max));
    }
    if (state.levelError === null) {
      level.removeAttribute("aria-invalid");
      levelError.hidden = true;
      levelError.replaceChildren();
    } else {
      level.setAttribute("aria-invalid", "true");
      levelError.hidden = false;
      levelError.replaceChildren(
        make("span", { "aria-hidden": "true" }, ["⚠ "]),
        state.levelError,
      );
    }
    const describedBy = [
      "talents-level-help",
      state.levelError === null ? "" : "talents-level-error",
      view.errorBanner === null ? "" : "talents-over",
    ].filter((part) => part !== "");
    level.setAttribute("aria-describedby", describedBy.join(" "));
    edit.setAttribute(
      "aria-describedby",
      view.errorBanner === null
        ? "talents-summary-label talents-summary"
        : "talents-summary-label talents-summary talents-over",
    );
    drawPoints(view);
    drawMessage(state, view);
    drawTrees(view);
    if (drawn === null || drawn.detail !== view.detail) {
      drawDetail(view);
    }
    if (drawn === null || drawn.effects !== view.effects) {
      drawEffects(view);
    }
    drawn = view;
    announce(state);
  }

  edit.addEventListener("click", () => actions.toggle());
  close.addEventListener("click", () => {
    actions.setOpen(false);
    edit.focus?.();
  });
  reset.addEventListener("click", () => actions.resetAll());
  level.addEventListener("change", () => actions.setLevel(level.value));
  level.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault?.();
      actions.setLevel(level.value);
    }
  });
  media?.addEventListener?.("change", () => render(store.get().talents));

  render(store.get().talents);
  return store.subscribe(({ state, changed }) => {
    if (changed.includes("talents")) {
      render(state.talents);
    }
  });
}
