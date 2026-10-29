import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SVG_NS,
  el,
  escapeAttribute,
  escapeText,
  text,
  toDom,
  toMarkup,
} from "../js/svg.js";

// Issue #148 (S5): the node descriptions the charts are built from, and their
// two outputs, a markup string and DOM nodes. toDom is tested on a fake
// document that records every call, so the test needs no browser.

// A document that builds plain objects and records how. It has no innerHTML:
// toDom must not need one.
function fakeDocument() {
  const calls = [];
  const node = (fields) => ({
    ...fields,
    attributes: [],
    childNodes: [],
    setAttribute(name, value) {
      calls.push(["setAttribute", name, value]);
      this.attributes.push([name, value]);
    },
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
  });
  return {
    calls,
    createElementNS(ns, tag) {
      calls.push(["createElementNS", ns, tag]);
      return node({ ns, tag });
    },
    createElement(tag) {
      calls.push(["createElement", tag]);
      return node({ ns: null, tag });
    },
    createTextNode(data) {
      calls.push(["createTextNode", data]);
      return { data };
    },
  };
}

const HOSTILE = `</title><script>alert("x")</script> & 'quoted' "double"`;

describe("escaping", () => {
  it("escapes &, < and > in text, and quotes too in attributes", () => {
    assert.equal(
      escapeText(`a & b < c > d "e" 'f'`),
      `a &amp; b &lt; c &gt; d "e" 'f'`,
    );
    assert.equal(
      escapeAttribute(`a & b < c > d "e" 'f'`),
      "a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;",
    );
    assert.equal(escapeText("&amp;"), "&amp;amp;");
    assert.equal(escapeText(12.5), "12.5");
  });

  it("writes hostile text and attribute values as data, never as markup", () => {
    const markup = toMarkup(
      el("g", { "aria-label": HOSTILE }, [el("title", {}, [HOSTILE]), HOSTILE]),
    );
    assert.equal(
      markup,
      '<g aria-label="&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39; &quot;double&quot;">' +
        '<title>&lt;/title&gt;&lt;script&gt;alert("x")&lt;/script&gt; &amp; \'quoted\' "double"</title>' +
        '&lt;/title&gt;&lt;script&gt;alert("x")&lt;/script&gt; &amp; \'quoted\' "double"</g>',
    );
    assert.doesNotMatch(markup, /<script|<\/title><script/);
  });
});

describe("el and text", () => {
  it("builds plain data, skipping null, undefined and false children", () => {
    const node = el("g", { class: "a", x: 1.5 }, [
      "label",
      3,
      null,
      undefined,
      false,
      el("rect"),
    ]);
    assert.deepEqual(node, {
      tag: "g",
      attrs: { class: "a", x: "1.5" },
      children: [
        { text: "label" },
        { text: "3" },
        { tag: "rect", attrs: {}, children: [] },
      ],
    });
    assert.deepEqual(text("x"), { text: "x" });
  });

  it("allows only the chart, table and results panel tags", () => {
    for (const tag of [
      "script",
      "foreignObject",
      "iframe",
      "style",
      "a",
      "image",
      "use",
      "SVG",
      "",
      "form",
      "textarea",
      "select",
      "img",
    ]) {
      assert.throws(() => el(tag), RangeError, tag);
    }
    // The results panel (#154) builds its body from these.
    for (const tag of ["h3", "details", "summary", "progress", "dl", "tfoot"]) {
      assert.equal(el(tag).tag, tag);
    }
    assert.throws(
      () => toMarkup({ tag: "script", attrs: {}, children: [] }),
      RangeError,
    );
  });

  it("refuses event handlers and odd attribute names", () => {
    for (const name of [
      "onclick",
      "ONLOAD",
      "onmouseover",
      "x y",
      'a"b',
      "1x",
      "",
      "a>b",
    ]) {
      assert.throws(() => el("g", { [name]: "1" }), RangeError, name);
    }
    assert.throws(() => el("g", null), TypeError);
    assert.throws(() => el("g", ["x"]), TypeError);
  });

  it("takes only strings and finite numbers as values and text", () => {
    for (const value of [NaN, Infinity, null, undefined, {}, true]) {
      assert.throws(() => el("g", { x: value }), TypeError, String(value));
    }
    for (const value of [NaN, -Infinity, null, {}, true]) {
      assert.throws(() => text(value), TypeError, String(value));
    }
    assert.throws(() => el("g", {}, [{ not: "a node" }]), RangeError);
    assert.throws(() => el("g", {}, [{ text: 5 }]), TypeError);
    assert.throws(() => el("g", {}, [7n]), TypeError);
    assert.throws(() => toMarkup({ tag: "g", attrs: {} }), TypeError);
    assert.throws(() => toMarkup(null), TypeError);
  });
});

describe("toMarkup", () => {
  it("writes attributes in the order given and an end tag for every element", () => {
    const node = el(
      "svg",
      { xmlns: SVG_NS, viewBox: "0 0 10 10", role: "img" },
      [el("rect", { y: 2, x: 1 }), el("text", {}, ["a < b"])],
    );
    assert.equal(
      toMarkup(node),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img">' +
        '<rect y="2" x="1"></rect><text>a &lt; b</text></svg>',
    );
    assert.equal(toMarkup(node), toMarkup(structuredClone(node)));
  });
});

describe("toDom", () => {
  it("builds SVG in the SVG namespace and HTML without one, with no innerHTML", () => {
    const doc = fakeDocument();
    const svg = toDom(
      el("svg", { xmlns: SVG_NS, role: "img" }, [
        el("title", { id: "t" }, [HOSTILE]),
        el("rect", { x: 1 }),
      ]),
      doc,
    );
    assert.deepEqual(doc.calls, [
      ["createElementNS", SVG_NS, "svg"],
      ["setAttribute", "role", "img"],
      ["createElementNS", SVG_NS, "title"],
      ["setAttribute", "id", "t"],
      ["createTextNode", HOSTILE],
      ["createElementNS", SVG_NS, "rect"],
      ["setAttribute", "x", "1"],
    ]);
    assert.equal(svg.childNodes[0].childNodes[0].data, HOSTILE);
    const table = fakeDocument();
    toDom(el("table", { class: "t" }, [el("caption", {}, ["c"])]), table);
    assert.deepEqual(table.calls, [
      ["createElement", "table"],
      ["setAttribute", "class", "t"],
      ["createElement", "caption"],
      ["createTextNode", "c"],
    ]);
  });

  it("makes a text node of a text node", () => {
    const doc = fakeDocument();
    assert.deepEqual(toDom(text("<b>"), doc), { data: "<b>" });
  });

  it("checks the node as toMarkup does", () => {
    assert.throws(
      () => toDom({ tag: "script", attrs: {}, children: [] }, fakeDocument()),
      RangeError,
    );
    assert.throws(
      () =>
        toDom(
          { tag: "g", attrs: { onload: "x" }, children: [] },
          fakeDocument(),
        ),
      RangeError,
    );
  });
});
