import { attachIconFallback } from "../icons.js";
import { reveal } from "./sections.js";

// The rotation builder's view (U7, #217; Fran's spec and mockup in
// design/u7-rotation-builder/). It draws the store's `rotationBuilder.view`,
// which js/rotation-builder.js fills with every string, id and state, and
// calls that model's actions. It owns the "Edit rotation…" button in Fight
// setup (#cfg-rotation-edit) and the #rotation-builder section under the
// form.
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

export function createRotationBuilderView(doc, store, actions) {
  const toggle = doc.querySelector("#cfg-rotation-edit");
  const section = doc.querySelector("#rotation-builder");
  if (section === null) {
    return;
  }
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

  toggle?.addEventListener("click", () => actions.toggle());

  const button = (props, ...children) =>
    h("button", { type: "button", ...props }, ...children);

  // An aria-disabled control still takes focus and its click, so the model
  // can say why it does nothing.
  const off = (disabled) => (disabled ? "true" : null);

  function editTalents() {
    const edit = doc.querySelector("#talents-edit");
    if (edit === null) {
      return;
    }
    // The talents are in the Character area (#239): it is shown first.
    reveal(edit);
    if (edit.getAttribute("aria-expanded") !== "true") {
      edit.click();
    }
    doc.querySelector("#talent-tree")?.scrollIntoView?.({ block: "nearest" });
    edit.focus();
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

  function messageNode(message) {
    return h(
      "p",
      {
        key: message.key,
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
        h("h5", {}, part.conditionsHead),
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
      rule.selected ? "is-selected" : null,
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
            "h4",
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
        button(
          {
            class: "pill-button",
            "data-key": `${rule.uid}.edit`,
            "aria-expanded": String(rule.open),
            "aria-controls": rid(rule.uid, "body"),
            "aria-label": rule.edit.label,
            on: { click: () => actions.toggleRule(rule.uid) },
          },
          rule.edit.text,
        ),
        button(
          {
            class: "pill-button",
            "data-key": `${rule.uid}.dup`,
            "aria-label": rule.duplicate.label,
            "aria-disabled": off(rule.duplicate.disabled),
            on: { click: () => actions.duplicate(rule.uid) },
          },
          "Duplicate as alternative",
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
      ),
      h(
        "div",
        {
          key: "body",
          class: rule.body === null ? null : "rule-body",
          id: rid(rule.uid, "body"),
          hidden: rule.body === null,
        },
        rule.body === null ? null : bodyNode(rule),
      ),
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
    return [
      h(
        "div",
        { key: "head", class: "section-heading builder-head" },
        h(
          "div",
          {},
          h("p", { class: "eyebrow" }, "BUILD"),
          h("h2", { id: "rotation-builder-title" }, "Rotation builder"),
        ),
        h(
          "div",
          { class: "builder-actions" },
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
      ),
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
      h(
        "div",
        { key: "list-head", class: "rule-list-head" },
        h("h3", { id: "rb-rules-heading" }, v.listHead),
        h("span", { class: "rule-count" }, v.ruleCount),
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
        { key: "grip-help", class: "visually-hidden", id: "rb-grip-help" },
        v.gripHelp,
      ),
    ];
  }

  function focusKey(key) {
    if (key === null || key === undefined) {
      return;
    }
    if (key === "toggle") {
      toggle?.focus();
      return;
    }
    const node = [...section.querySelectorAll("[data-key]")].find(
      (candidate) => candidate.getAttribute("data-key") === key,
    );
    node?.focus();
  }

  // Fran's #228 QA (nit 1; #234): a warnings banner that an action (a
  // Duplicate, say) brings up above the screen is scrolled into view, below
  // the chrome over the top of the screen (the banner's scroll-margin-top),
  // but only when the focus the action moved stays on screen too: the focus
  // wins (WCAG 2.4.11). When the two cannot both be on screen, the focused
  // rule's own warning is brought into view instead, on the same terms.
  //
  // Below the wide breakpoint (#240, UX2; Fran's #251 check) the messages
  // are pinned to the top of the screen (styles.css), so the banner is in
  // view as soon as it is drawn; what can be hidden then is the focused
  // rule, under the pinned messages, and it is scrolled clear of them.
  // --chrome-top and --chrome-bottom (styles.css) are what covers the
  // screen's top and foot: the sticky run bar, or the phone dock and nav.
  function revealWarnings() {
    const banner = section.querySelector("#rb-warnings");
    const win = doc.defaultView;
    if (typeof banner?.getBoundingClientRect !== "function" || !win) {
      return;
    }
    const chrome = (name) =>
      Number.parseFloat(
        win.getComputedStyle(doc.documentElement).getPropertyValue(name),
      ) || 0;
    const chromeTop = chrome("--chrome-top");
    const bottom = win.innerHeight - chrome("--chrome-bottom");
    const inset =
      Number.parseFloat(win.getComputedStyle(banner).scrollMarginTop) || 0;
    const messages = banner.closest?.(".builder-messages") ?? null;
    const pinned =
      messages !== null && win.getComputedStyle(messages).position === "sticky";
    const active = doc.activeElement;
    const focused =
      active === null || active === doc.body
        ? null
        : active.getBoundingClientRect();
    if (pinned) {
      const covered = messages.getBoundingClientRect().bottom;
      if (focused !== null && focused.top < covered) {
        win.scrollBy(0, focused.top - covered - inset + chromeTop);
      }
      return;
    }
    const card = active?.closest?.("li.rule") ?? null;
    const targets = [banner, card?.querySelector(".rule-msgs") ?? null];
    for (const target of targets) {
      if (target === null) {
        continue;
      }
      const top = target.getBoundingClientRect().top;
      if (top >= chromeTop) {
        return;
      }
      const shift = inset - top;
      if (focused === null || focused.bottom + shift <= bottom) {
        win.scrollBy(0, -shift);
        return;
      }
    }
  }

  // The pinned messages' height (#240), as --builder-pinned-height on the
  // page: styles.css adds it to the page's scroll-padding-top, so a control
  // focused or scrolled to lands below them. Measured as they wrap.
  let pinnedNode = null;
  const pinObserver =
    typeof doc.defaultView?.ResizeObserver === "function"
      ? new doc.defaultView.ResizeObserver(() => pinHeight())
      : null;
  function pinHeight() {
    const win = doc.defaultView;
    const messages = section.querySelector?.(".builder-messages") ?? null;
    if (messages !== pinnedNode && pinObserver !== null) {
      if (pinnedNode !== null) {
        pinObserver.unobserve(pinnedNode);
      }
      if (messages !== null) {
        pinObserver.observe(messages);
      }
    }
    pinnedNode = messages;
    const style = doc.documentElement?.style;
    if (typeof win?.getComputedStyle !== "function" || !style) {
      return;
    }
    const sticky =
      messages !== null && win.getComputedStyle(messages).position === "sticky";
    style.setProperty(
      "--builder-pinned-height",
      `${sticky ? messages.offsetHeight : 0}px`,
    );
  }

  function draw() {
    const slice = store.get().rotationBuilder;
    if (slice === undefined || slice.view === view) {
      return;
    }
    const hadWarnings = view !== null && view.warnings !== null;
    view = slice.view;
    if (toggle !== null) {
      if (toggle.textContent !== view.toggle) {
        toggle.textContent = view.toggle;
      }
      toggle.setAttribute("aria-expanded", String(view.open));
    }
    section.hidden = !view.open;
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
    pinHeight();
    const focus = slice.focus;
    if (focus !== undefined && focus.seq !== focused) {
      focused = focus.seq;
      focusKey(focus.key);
      if (view.open && !hadWarnings && view.warnings !== null) {
        revealWarnings();
      }
    }
  }

  store.subscribe(({ changed }) => {
    if (changed.includes("rotationBuilder")) {
      draw();
    }
  });
  draw();
}
