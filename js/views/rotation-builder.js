import { attachIconFallback } from "../icons.js";
import { APP_TITLE, formatRoute } from "./router.js";
import { reveal } from "./sections.js";

// The rotation builder's view (U7, #217; Fran's spec and mockup in
// design/u7-rotation-builder/). It draws the store's `rotationBuilder.view`,
// which js/rotation-builder.js fills with every string, id and state, and
// calls that model's actions. It draws the Rotation area (#243, UX5): its
// back link and h1, the #rotation-builder section (the messages, then the
// list or one rule's screen) and, at #rotation/share, the Export or import
// section (#rotation-share, whose controls js/views/config-form.js owns). It
// keeps the model's screen and the route in step: a route to a screen shows
// it, and a screen an action opens (Duplicate, Add rule, a message's link)
// is pushed as the route, so Back goes back to where it was.
//
// The panel is drawn by a small keyed patcher: a node is kept for as long as
// its key (a rule's or condition's uid, or its place) is, and only the
// attributes, text and values that changed are written, so focus, the caret
// and a first click are never lost to a redraw. Announcements go to one
// polite status line; the model names the control to focus after an action.

const DRAG_THRESHOLD_PX = 5;
const DROP_LINE_OFFSET_PX = 5;
const DROP_LINE_END_PX = 3;

const isBlank = (value) =>
  value === null || value === undefined || value === false;

// A virtual node: an element, or { text } for a text node.
export function h(tag, props = {}, ...children) {
  return {
    tag,
    props,
    children: children
      .flat(Infinity)
      .filter((child) => !isBlank(child))
      .map((child) =>
        typeof child === "object" ? child : { text: String(child) },
      ),
  };
}

const SPECIAL = new Set(["key", "on", "value", "icon"]);

function keyOf(vnode, index) {
  if (vnode.tag === undefined) {
    return `#text:${index}`;
  }
  return vnode.props.key ?? vnode.props["data-key"] ?? `${vnode.tag}:${index}`;
}

function create(doc, vnode) {
  if (vnode.tag === undefined) {
    const text = doc.createTextNode(vnode.text);
    text.vtag = "#text";
    return text;
  }
  const node = doc.createElement(vnode.tag);
  node.vtag = vnode.tag;
  node.vattrs = {};
  node.von = {};
  if (vnode.props.icon === true) {
    attachIconFallback(node);
  }
  return node;
}

function update(doc, node, vnode) {
  if (vnode.tag === undefined) {
    if (node.nodeValue !== vnode.text) {
      node.nodeValue = vnode.text;
    }
    return;
  }
  const attrs = {};
  for (const [name, value] of Object.entries(vnode.props)) {
    if (!SPECIAL.has(name) && !isBlank(value)) {
      attrs[name] = value === true ? "" : String(value);
    }
  }
  for (const name of Object.keys(node.vattrs)) {
    if (!Object.hasOwn(attrs, name)) {
      node.removeAttribute(name);
    }
  }
  for (const [name, value] of Object.entries(attrs)) {
    if (node.vattrs[name] !== value) {
      node.setAttribute(name, value);
    }
  }
  node.vattrs = attrs;
  const on = vnode.props.on ?? {};
  for (const type of Object.keys(on)) {
    if (!Object.hasOwn(node.von, type)) {
      node.addEventListener(type, (event) => node.von[type]?.(event));
    }
  }
  node.von = Object.fromEntries(
    Object.keys({ ...node.von, ...on }).map((type) => [type, on[type]]),
  );
  patchChildren(doc, node, vnode.children);
  if (vnode.props.value !== undefined && node.value !== vnode.props.value) {
    node.value = vnode.props.value;
  }
}

export function patchChildren(doc, parent, vnodes) {
  const old = new Map();
  [...parent.childNodes].forEach((node, index) => {
    old.set(node.vkey ?? `#unkeyed:${index}`, node);
  });
  const used = new Set();
  vnodes.forEach((vnode, index) => {
    const key = keyOf(vnode, index);
    let node = old.get(key);
    if (
      node === undefined ||
      used.has(node) ||
      node.vtag !== (vnode.tag ?? "#text")
    ) {
      node = create(doc, vnode);
    }
    node.vkey = key;
    used.add(node);
    update(doc, node, vnode);
    const at = parent.childNodes[index];
    if (at !== node) {
      parent.insertBefore(node, at ?? null);
    }
  });
  for (const node of [...parent.childNodes]) {
    if (!used.has(node)) {
      node.remove();
    }
  }
}

const optionsOf = (groups) =>
  groups.map((group) =>
    h(
      "optgroup",
      { key: `g:${group.label}`, label: group.label },
      group.options.map((option) =>
        h(
          "option",
          { key: `o:${option.value}`, value: option.value },
          option.text,
        ),
      ),
    ),
  );

const flatOptions = (options) =>
  options.map((option) =>
    h("option", { key: `o:${option.value}`, value: option.value }, option.text),
  );

const mark = (text) => h("span", { "aria-hidden": "true" }, text);

const ESCAPE_IGNORED = new Set(["SELECT", "TEXTAREA"]);

// The route a screen is at: "#rotation", "#rotation/rule/2".
const screenHash = (screen) =>
  formatRoute({ area: "rotation", sub: screen.sub, param: screen.param });

const sameScreen = (a, b) =>
  a !== null && b !== null && a.kind === b.kind && a.uid === b.uid;

export function createRotationBuilderView(doc, store, actions) {
  const section = doc.querySelector("#rotation-builder");
  if (section === null) {
    return;
  }
  const area = doc.querySelector("#area-rotation");
  const heading = doc.querySelector("#area-rotation-title");
  const back = doc.querySelector("#rotation-back");
  const share = doc.querySelector("#rotation-share");
  // The rotation select and its summary (#244): on the list only.
  const pick = doc.querySelector("#rotation-pick");
  const body = doc.createElement("div");
  body.className = "rotation-builder-body";
  const live = doc.createElement("p");
  live.className = "builder-live visually-hidden";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  section.replaceChildren(body, live);

  let announced = 0;
  let focused = 0;
  let view = null;

  let route = store.get().route ?? null;
  const button = (props, ...children) =>
    h("button", { type: "button", ...props }, ...children);

  // An aria-disabled control still takes focus and its click, so the model
  // can say why it does nothing.
  const off = (disabled) => (disabled ? "true" : null);

  // The talents are Character's Talents screen (#244, UX6): revealing the
  // tree shows it, and its h1 takes the focus.
  function editTalents() {
    const tree = doc.querySelector("#talent-tree");
    if (tree === null) {
      return;
    }
    reveal(tree);
    doc.querySelector("#area-character-title")?.focus?.();
  }

  function pointerDrag(event, uid) {
    if (event.button !== 0) {
      return;
    }
    const list = section.querySelector(".rule-list");
    if (list === null) {
      return;
    }
    const startY = event.clientY;
    let dragging = false;
    let target = null;
    const line = doc.createElement("div");
    line.className = "drop-line";
    line.setAttribute("aria-hidden", "true");
    const move = (moveEvent) => {
      if (
        !dragging &&
        Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      const cards = [...list.querySelectorAll(":scope > .rule")];
      if (!dragging) {
        dragging = true;
        list.querySelector(`[data-uid="${uid}"]`)?.classList.add("is-lifted");
        list.append(line);
      }
      target = cards.length;
      for (const [index, card] of cards.entries()) {
        const box = card.getBoundingClientRect();
        if (moveEvent.clientY < box.top + box.height / (1 + 1)) {
          target = index;
          break;
        }
      }
      const top = list.getBoundingClientRect().top;
      const ref = cards[target];
      const y =
        ref === undefined
          ? cards[cards.length - 1].getBoundingClientRect().bottom -
            top +
            DROP_LINE_END_PX
          : ref.getBoundingClientRect().top - top - DROP_LINE_OFFSET_PX;
      line.style.top = `${y}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      line.remove();
      list.querySelector(`[data-uid="${uid}"]`)?.classList.remove("is-lifted");
      if (dragging && target !== null) {
        actions.dragTo(uid, target);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const rid = (uid, part) => `rb-${uid}-${part}`;

  // A message's id, from its key ("r3.msg.0" is rb-r3-msg-0): its field
  // points at it, so the warning is said there (#244).
  const msgId = (message) => `rb-${message.key.replaceAll(".", "-")}`;

  function messageNode(message) {
    return h(
      "p",
      {
        key: message.key,
        id: msgId(message),
        "data-key": message.key,
        class: `rule-msg is-${message.kind}`,
        tabindex: "-1",
      },
      h("span", { class: "msg-kind" }, message.kindText),
      " ",
      message.text,
      message.fix === null
        ? null
        : h(
            "span",
            { class: "msg-fix" },
            " ",
            button(
              {
                class: "pill-button fix-button",
                "data-key": `${message.key}.fix`,
                on: { click: () => actions.fix(message.fix.id) },
              },
              message.fix.label,
            ),
          ),
    );
  }

  function fieldNode(rule, condition, field) {
    const id = rid(condition.uid, field.param);
    const errIds = condition.errors.map((_, k) =>
      rid(condition.uid, `err${k}`),
    );
    const common = {
      id,
      "data-key": `${condition.uid}.${field.param}`,
      "aria-invalid": field.invalid ? "true" : null,
      "aria-describedby": field.invalid ? errIds.join(" ") : null,
    };
    const label = h(
      "label",
      { class: "visually-hidden", for: id },
      field.label,
    );
    if (field.kind === "number") {
      return h(
        "div",
        { key: `f:${field.param}`, class: "cond-field cond-num" },
        label,
        h(
          "div",
          { class: "field-control" },
          h("input", {
            ...common,
            class: "cond-value",
            type: "number",
            inputmode: "decimal",
            step: field.step,
            min: "0",
            value: field.value,
            on: {
              input: (event) =>
                actions.setParam(
                  rule.uid,
                  condition.uid,
                  field.param,
                  event.target.value,
                ),
            },
          }),
          field.unit === ""
            ? null
            : h(
                "span",
                { class: "field-suffix", "aria-hidden": "true" },
                field.unit,
              ),
        ),
      );
    }
    return h(
      "div",
      { key: `f:${field.param}`, class: `cond-field cond-${field.param}` },
      label,
      h(
        "select",
        {
          ...common,
          value: field.value,
          on: {
            change: (event) =>
              actions.setParam(
                rule.uid,
                condition.uid,
                field.param,
                event.target.value,
              ),
          },
        },
        flatOptions(field.options),
      ),
    );
  }

  function conditionNode(rule, condition) {
    const typeId = rid(condition.uid, "type");
    const noteId = rid(condition.uid, "note");
    const errIds = condition.errors.map((_, k) =>
      rid(condition.uid, `err${k}`),
    );
    return h(
      "li",
      {
        key: condition.uid,
        class: `cond${condition.errors.length > 0 ? " has-error" : ""}`,
      },
      h(
        "div",
        { class: "cond-row" },
        h("span", { class: "cond-and", "aria-hidden": "true" }, condition.and),
        h(
          "div",
          { class: "cond-fields" },
          h(
            "div",
            { key: "f:type", class: "cond-field cond-type" },
            h(
              "label",
              { class: "visually-hidden", for: typeId },
              condition.typeLabel,
            ),
            h(
              "select",
              {
                id: typeId,
                "data-key": `${condition.uid}.type`,
                "aria-invalid": condition.typeInvalid ? "true" : null,
                "aria-describedby":
                  [
                    condition.note === null ? null : noteId,
                    condition.typeInvalid ? errIds.join(" ") : null,
                    ...(condition.messages ?? []).map(msgId),
                  ]
                    .filter((part) => part !== null && part !== "")
                    .join(" ") || null,
                value: condition.type,
                on: {
                  change: (event) =>
                    actions.setConditionType(
                      rule.uid,
                      condition.uid,
                      event.target.value,
                    ),
                },
              },
              optionsOf(condition.typeGroups),
            ),
          ),
          condition.fields.map((field) => fieldNode(rule, condition, field)),
        ),
        button(
          {
            class: "icon-button is-remove",
            "data-key": `${condition.uid}.rm`,
            "aria-label": condition.removeLabel,
            on: {
              click: () => actions.removeCondition(rule.uid, condition.uid),
            },
          },
          mark("✕"),
        ),
      ),
      condition.note === null
        ? null
        : h(
            "p",
            { key: "note", class: "field-help type-note", id: noteId },
            condition.note,
          ),
      condition.errors.map((text, k) =>
        h(
          "p",
          { key: `err${k}`, class: "field-error", id: errIds[k] },
          mark("✕ "),
          text,
        ),
      ),
      (condition.messages ?? []).map(messageNode),
    );
  }

  function bodyNode(rule) {
    const part = rule.body;
    const actionId = rid(rule.uid, "action");
    return [
      h(
        "div",
        { key: "action", class: "field rule-action" },
        h("label", { for: actionId }, part.actionLabel),
        h(
          "select",
          {
            id: actionId,
            "data-key": `${rule.uid}.action`,
            "aria-invalid": part.actionErrors.length > 0 ? "true" : null,
            value: part.action,
            on: {
              change: (event) =>
                actions.setAction(rule.uid, event.target.value),
            },
          },
          optionsOf(part.actionGroups),
        ),
        part.actionErrors.map((text, k) =>
          h("p", { key: `err${k}`, class: "field-error" }, mark("✕ "), text),
        ),
      ),
      h("p", { key: "hint", class: "rule-hint" }, part.hint),
      h(
        "div",
        { key: "head", class: "cond-head" },
        h("h2", {}, part.conditionsHead),
        part.conditionsCount === null
          ? null
          : h("span", { class: "rule-count" }, part.conditionsCount),
      ),
      part.conditions.length === 0
        ? null
        : h(
            "ol",
            {
              key: "conds",
              class: "cond-list",
              "aria-label": part.conditionsLabel,
            },
            part.conditions.map((condition) => conditionNode(rule, condition)),
          ),
      h(
        "div",
        { key: "add", class: "cond-add" },
        button(
          {
            class: "pill-button",
            "data-key": `${rule.uid}.addcond`,
            "aria-label": part.addCondition.label,
            "aria-disabled": off(part.addCondition.disabled),
            on: { click: () => actions.addCondition(rule.uid) },
          },
          "Add condition",
        ),
        part.addCondition.why === null
          ? null
          : h("span", { class: "field-help" }, part.addCondition.why),
      ),
    ];
  }

  function ruleNode(rule) {
    const classes = [
      "rule",
      rule.lifted ? "is-lifted" : null,
      rule.skipped ? "is-skipped" : null,
      rule.alt ? "is-alt" : null,
      rule.state === null ? null : `has-${rule.state}`,
    ].filter((name) => name !== null);
    return h(
      "li",
      {
        key: rule.uid,
        class: classes.join(" "),
        "data-uid": rule.uid,
        "aria-labelledby": rid(rule.uid, "name"),
        "aria-describedby": rid(rule.uid, "line"),
      },
      h(
        "div",
        { class: "rule-head" },
        button(
          {
            class: "rule-grip",
            "data-key": `${rule.uid}.grip`,
            "aria-label": rule.grip.label,
            "aria-describedby": "rb-grip-help",
            "aria-pressed": rule.grip.pressed ? "true" : "false",
            on: {
              keydown: (event) => {
                if (actions.gripKey(rule.uid, event.key)) {
                  event.preventDefault();
                }
              },
              pointerdown: (event) => pointerDrag(event, rule.uid),
            },
          },
          mark("⠿"),
        ),
        h("span", { class: "rule-num", "aria-hidden": "true" }, String(rule.n)),
        h("img", {
          key: `img:${rule.icon}`,
          icon: true,
          class: "rule-icon",
          src: rule.icon,
          alt: "",
          width: "32",
          height: "32",
        }),
        h(
          "div",
          { class: "rule-title" },
          h(
            "h3",
            { class: "rule-name", id: rid(rule.uid, "name") },
            h("span", { class: "visually-hidden" }, `Rule ${rule.n}: `),
            rule.name,
          ),
          h("p", { class: "rule-line", id: rid(rule.uid, "line") }, rule.line),
          h(
            "p",
            { class: "rule-chips" },
            rule.chips.map((chip) =>
              h(
                "span",
                {
                  key: `chip:${chip.kind}`,
                  class: chip.kind === "hint" ? "chip" : `chip is-${chip.kind}`,
                },
                chip.mark === "" ? null : mark(chip.mark),
                chip.text,
              ),
            ),
          ),
        ),
        h(
          "div",
          { class: "rule-move" },
          button(
            {
              class: "icon-button",
              "data-key": `${rule.uid}.up`,
              "aria-label": rule.up.label,
              "aria-disabled": off(rule.up.disabled),
              on: { click: () => actions.move(rule.uid, -1) },
            },
            mark("↑"),
          ),
          button(
            {
              class: "icon-button",
              "data-key": `${rule.uid}.down`,
              "aria-label": rule.down.label,
              "aria-disabled": off(rule.down.disabled),
              on: { click: () => actions.move(rule.uid, 1) },
            },
            mark("↓"),
          ),
        ),
      ),
      rule.messages.length === 0
        ? null
        : h(
            "div",
            { key: "msgs", class: "rule-msgs" },
            rule.messages.map(messageNode),
          ),
      h(
        "div",
        { key: "foot", class: "rule-foot" },
        h(
          "a",
          {
            class: "pill-button",
            href: rule.edit.href,
            "data-key": `${rule.uid}.edit`,
            "aria-label": rule.edit.label,
          },
          rule.edit.text,
        ),
        ruleButtons(rule),
      ),
    );
  }

  // Duplicate and Delete, on a rule's card and on its screen.
  function ruleButtons(rule) {
    return [
      button(
        {
          class: "pill-button",
          "data-key": `${rule.uid}.dup`,
          "aria-label": rule.duplicate.label,
          "aria-disabled": off(rule.duplicate.disabled),
          on: { click: () => actions.duplicate(rule.uid) },
        },
        rule.duplicate.text,
      ),
      button(
        {
          class: "pill-button is-danger",
          "data-key": `${rule.uid}.del`,
          "aria-label": rule.remove.label,
          on: { click: () => actions.remove(rule.uid) },
        },
        "Delete",
      ),
    ];
  }

  // A rule's own screen (#rotation/rule/<n>): the h1 above is its name; its
  // summary line and chips, its messages, its ability and conditions, and
  // Duplicate and Delete. It is moved on the list.
  function ruleScreen(rule) {
    return h(
      "div",
      { key: `screen:${rule.uid}`, class: "rule-screen", "data-uid": rule.uid },
      h(
        "p",
        { key: "line", class: "rule-line", id: rid(rule.uid, "line") },
        rule.line,
      ),
      rule.chips.length === 0
        ? null
        : h(
            "p",
            { key: "chips", class: "rule-chips" },
            rule.chips.map((chip) =>
              h(
                "span",
                {
                  key: `chip:${chip.kind}`,
                  class: chip.kind === "hint" ? "chip" : `chip is-${chip.kind}`,
                },
                chip.mark === "" ? null : mark(chip.mark),
                chip.text,
              ),
            ),
          ),
      rule.messages.length === 0
        ? null
        : h(
            "div",
            { key: "msgs", class: "rule-msgs" },
            rule.messages.map(messageNode),
          ),
      h(
        "div",
        { key: "body", class: "rule-body", id: rid(rule.uid, "body") },
        bodyNode(rule),
      ),
      h("div", { key: "foot", class: "rule-foot" }, ruleButtons(rule)),
    );
  }

  function jumpList(list) {
    return [
      h(
        "ul",
        { class: "jump-list" },
        list.jumps.map((jump) =>
          h(
            "li",
            { key: jump.id },
            button(
              {
                class: "link-button",
                "data-key": `jump.${jump.id}`,
                on: { click: () => actions.jump(jump.id) },
              },
              jump.label,
            ),
          ),
        ),
      ),
      list.more === null ? null : h("p", { class: "jump-more" }, list.more),
    ];
  }

  function tree(v) {
    const name = v.name;
    const nameDescribed = [
      name.error === null ? null : "rb-name-error",
      name.count === null ? null : "rb-name-count",
    ].filter((part) => part !== null);
    // The messages come first on every screen, right under the h1 (#243;
    // the proposal's P5): what an action did, with its Undo, and the
    // rotation's errors and warnings, so a Duplicate's warning is never off
    // the screen.
    const messages = [
      h(
        "div",
        { key: "messages", class: "builder-messages" },
        v.banner === null
          ? null
          : h(
              "div",
              { key: "banner", class: "rot-banner is-info" },
              h("span", {}, v.banner.text),
              v.banner.undo
                ? button(
                    {
                      class: "link-button",
                      "data-key": "undo",
                      on: { click: () => actions.undo() },
                    },
                    "Undo",
                  )
                : null,
            ),
        v.errors === null
          ? null
          : h(
              "div",
              { key: "errors", class: "rot-banner is-error", id: "rb-errors" },
              h("p", {}, h("strong", {}, v.errors.count), v.errors.text),
              jumpList(v.errors),
            ),
        v.warnings === null
          ? null
          : h(
              "div",
              {
                key: "warnings",
                class: "rot-banner is-warning",
                id: "rb-warnings",
              },
              h("p", {}, h("strong", {}, v.warnings.count), v.warnings.text),
              jumpList(v.warnings),
            ),
      ),
    ];
    if (v.screen.kind === "rule") {
      const rule = v.rules.find((candidate) => candidate.uid === v.screen.uid);
      return [...messages, rule === undefined ? null : ruleScreen(rule)];
    }
    if (v.screen.kind === "share") {
      return messages;
    }
    return [
      ...messages,
      v.origin.edited
        ? h(
            "p",
            { key: "origin-edited", class: "builder-origin is-edited" },
            h("span", { class: "edited-mark" }, v.origin.mark),
            " ",
            v.origin.text,
            button(
              {
                class: "link-button",
                "data-key": "revert",
                on: { click: () => actions.revert() },
              },
              v.origin.revert,
            ),
          )
        : h("p", { key: "origin", class: "builder-origin" }, v.origin.text),
      h(
        "div",
        { key: "name", class: "field builder-name" },
        h("label", { for: "rb-name" }, "Rotation name"),
        h("input", {
          id: "rb-name",
          class: "text-input",
          type: "text",
          autocomplete: "off",
          maxlength: name.max,
          "data-key": "name",
          "aria-invalid": name.error === null ? null : "true",
          "aria-describedby":
            nameDescribed.length > 0 ? nameDescribed.join(" ") : null,
          value: name.value,
          on: { input: (event) => actions.setName(event.target.value) },
        }),
        name.count === null
          ? null
          : h(
              "p",
              { key: "count", class: "field-help", id: "rb-name-count" },
              name.count,
            ),
        name.error === null
          ? null
          : h(
              "p",
              { key: "error", class: "field-error", id: "rb-name-error" },
              mark("✕ "),
              name.error,
            ),
      ),
      h(
        "p",
        { key: "context", class: "builder-context" },
        h("strong", {}, v.context.label),
        v.context.build,
        v.context.text,
        button(
          {
            class: "link-button",
            "data-key": "edit-talents",
            on: { click: editTalents },
          },
          v.context.button,
        ),
      ),
      h("p", { key: "help", class: "builder-help", id: "rb-help" }, v.help),
      h(
        "div",
        { key: "list-head", class: "rule-list-head" },
        h("h2", { id: "rb-rules-heading" }, v.listHead),
        h("span", { class: "rule-count" }, v.ruleCount),
        button(
          {
            class: "pill-button",
            "data-key": "clear",
            "aria-disabled": off(v.clearDisabled),
            on: { click: () => actions.clearAll() },
          },
          "Clear all",
        ),
      ),
      v.empty === null
        ? null
        : h(
            "div",
            { key: "empty", class: "rule-empty" },
            h("p", {}, v.empty),
            v.listMessages.map((message, k) =>
              h(
                "p",
                { key: `m${k}`, class: `rule-msg is-${message.kind}` },
                h("span", { class: "msg-kind" }, message.kindText),
                " ",
                message.text,
              ),
            ),
          ),
      h(
        "ol",
        {
          key: "rules",
          class: "rule-list",
          "aria-labelledby": "rb-rules-heading",
          "aria-describedby": "rb-help",
        },
        v.rules.map(ruleNode),
      ),
      h(
        "div",
        { key: "add", class: "add-rule-row" },
        h(
          "div",
          { class: "field" },
          h("label", { for: "rb-add-action" }, v.add.label),
          h(
            "select",
            {
              id: "rb-add-action",
              "data-key": "add-action",
              value: v.add.value,
              on: {
                change: (event) => actions.setAddAction(event.target.value),
              },
            },
            optionsOf(v.add.groups),
          ),
        ),
        button(
          {
            class: "pill-button add-rule",
            "data-key": "add-rule",
            "aria-disabled": off(v.add.disabled),
            "aria-describedby":
              v.add.why === null ? "rb-add-note" : "rb-add-why",
            on: { click: () => actions.addRule() },
          },
          v.add.button,
        ),
        h(
          "p",
          { key: "note", class: "field-help", id: "rb-add-note" },
          v.add.note,
        ),
        v.add.why === null
          ? null
          : h(
              "p",
              { key: "why", class: "field-error", id: "rb-add-why" },
              v.add.why,
            ),
      ),
      h(
        "p",
        { key: "share", class: "builder-share" },
        h(
          "a",
          {
            class: "pill-button",
            href: "#rotation/share",
            "data-key": "share",
          },
          "Export or import…",
        ),
      ),
      h(
        "p",
        { key: "grip-help", class: "visually-hidden", id: "rb-grip-help" },
        v.gripHelp,
      ),
    ];
  }

  function focusKey(key) {
    if (key === null || key === undefined) {
      return;
    }
    if (key === "heading") {
      // A new screen starts at the top, its back link and h1 in view.
      doc.defaultView?.scrollTo?.(0, 0);
      heading?.focus?.({ preventScroll: true });
      return;
    }
    const node = [...section.querySelectorAll("[data-key]")].find(
      (candidate) => candidate.getAttribute("data-key") === key,
    );
    node?.focus();
  }

  // The h1 and back link: "Rotation" and no back link on the list (#244: it
  // is the area's top), the rule's name (its number aria-hidden, "Rule 2: "
  // hidden text) or "Export or import" and "‹ Rotation" on a screen. The
  // back links are links, not history.back().
  function drawHeading(screen) {
    // A page without child lists (the unit tests' stand-in) gets the text.
    const patchable = (node) =>
      typeof node?.childNodes?.[Symbol.iterator] === "function";
    if (heading !== null && !patchable(heading)) {
      heading.textContent = `${screen.heading.hidden ?? ""}${screen.heading.text}`;
    } else if (heading !== null) {
      const part = screen.heading;
      patchChildren(
        doc,
        heading,
        h(
          "x",
          {},
          part.n === null
            ? null
            : h(
                "span",
                { key: "n", class: "rule-num", "aria-hidden": "true" },
                part.n,
              ),
          part.hidden === null
            ? null
            : h(
                "span",
                { key: "hidden", class: "visually-hidden" },
                part.hidden,
              ),
          h("span", { key: "text" }, part.text),
        ).children,
      );
    }
    if (back !== null) {
      back.hidden = screen.back === null;
    }
    if (pick !== null) {
      pick.hidden = !view.open || screen.kind !== "list";
    }
    if (back !== null && screen.back !== null) {
      back.setAttribute("href", screen.back.href);
      if (screen.back.focus === null) {
        back.removeAttribute("data-return-focus");
      } else {
        back.setAttribute("data-return-focus", screen.back.focus);
      }
      if (!patchable(back)) {
        back.textContent = `‹ ${screen.back.text}`;
      } else {
        patchChildren(
          doc,
          back,
          h(
            "x",
            {},
            h("span", { key: "mark", "aria-hidden": "true" }, "‹ "),
            h("span", { key: "hidden", class: "visually-hidden" }, "Back to "),
            h("span", { key: "text" }, screen.back.text),
          ).children,
        );
      }
    }
    if (share !== null) {
      share.hidden = !view.open || screen.kind !== "share";
    }
  }

  // The page's title names the screen (the proposal's accessibility notes):
  // "Rule 2: Eviscerate · WoW Forever Rogue Simulator".
  function drawTitle() {
    if (route?.area === "rotation" && view !== null && view.open) {
      doc.title = `${view.screen.title} · ${APP_TITLE}`;
    }
  }

  // An action's screen becomes the route: pushed when it is another screen
  // (Duplicate's copy, a new rule, a message's rule), so Back returns; put in
  // the route's place when only its number moved (a rule moved), its rule
  // was deleted, or the route named no screen (#rotation/rule/99).
  function syncHash(before) {
    const win = doc.defaultView;
    if (
      route?.area !== "rotation" ||
      !view.open ||
      typeof win?.location?.replace !== "function"
    ) {
      return;
    }
    const want = screenHash(view.screen);
    if (formatRoute(route) === want || win.location.hash === want) {
      return;
    }
    const routeWas =
      before === null ? null : screenHash(before) === formatRoute(route);
    // A rule deleted on its own screen (Fran's #255 check, P2): the list
    // takes its entry's place, so Back never reopens #rotation/rule/<n> at
    // the rule that moved up into its number.
    const gone =
      before?.kind === "rule" &&
      !(view.rules ?? []).some((rule) => rule.uid === before.uid);
    if (routeWas && !gone && !sameScreen(before, view.screen)) {
      win.location.hash = want;
    } else {
      win.location.replace(want);
    }
  }

  // The route moved within Rotation (a link, Back, the nav): its screen is
  // shown. Back to the list focuses what opened the screen left.
  function onRoute(next) {
    route = next;
    if (next?.area !== "rotation" || view === null) {
      return;
    }
    if (screenHash(view.screen) !== formatRoute(next)) {
      actions.showScreen(next.sub ?? null, next.param ?? null);
      return;
    }
    drawTitle();
  }

  // Escape on a rule's screen or Export or import goes back to the list, as
  // its back link does; not from a select or a text box, whose own Escape it
  // is.
  area?.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      view === null ||
      view.screen.kind === "list" ||
      ESCAPE_IGNORED.has(event.target?.tagName)
    ) {
      return;
    }
    const win = doc.defaultView;
    if (win?.location !== undefined) {
      event.preventDefault?.();
      // From a number box its edit is kept as it goes: said, as the list
      // gives no other sign of it (#244, Fran's #255 check, P6).
      const kept = event.target?.tagName === "INPUT";
      const back = view.screen.back;
      win.location.hash = back.href;
      if (kept) {
        say(`Kept. Back to ${back.text}.`);
      }
    }
  });

  function say(text) {
    live.textContent = "";
    requestAnimationFrame(() => {
      live.textContent = text;
    });
  }

  function draw() {
    const slice = store.get().rotationBuilder;
    if (slice === undefined || slice.view === view) {
      return;
    }
    const before = view === null ? null : view.screen;
    view = slice.view;
    section.hidden = !view.open;
    drawHeading(view.screen);
    if (view.open) {
      patchChildren(
        doc,
        body,
        tree(view).filter((child) => !isBlank(child)),
      );
    }
    const announce = slice.announce;
    if (announce !== undefined && announce.seq !== announced) {
      announced = announce.seq;
      live.textContent = "";
      const text = announce.text;
      requestAnimationFrame(() => {
        live.textContent = text;
      });
    }
    syncHash(before);
    drawTitle();
    const focus = slice.focus;
    if (focus !== undefined && focus.seq !== focused) {
      focused = focus.seq;
      focusKey(focus.key);
    }
  }

  store.subscribe(({ changed, state }) => {
    if (changed.includes("route")) {
      onRoute(state.route);
    }
    if (changed.includes("rotationBuilder")) {
      draw();
    }
  });
  draw();
}
