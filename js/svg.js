// Markup without a DOM (Phase 3, #148): the node descriptions the charts
// (js/charts.js) are built from, written out as a string or as DOM nodes.
//
// A node is plain data:
//
//   { tag, attrs, children }  an element: attrs a plain object of attribute
//                             name to string (or finite number), children an
//                             array of nodes
//   { text }                  a text node: any string, written escaped
//
// el() and text() build them and check them as they go. toMarkup(node) writes
// the markup string: text escaped (&, <, >), attribute values escaped (&, <, >,
// ", '), attributes in the order they were given, so the same node is the same
// string on every run. toDom(node, document) builds DOM nodes with
// createElementNS / createElement, setAttribute and createTextNode: no
// innerHTML, so no string is ever parsed as markup.
//
// Only the tags below are allowed: the SVG ones the charts draw and the HTML
// ones of their table alternative. An attribute name is letters, digits, ":"
// and "-", and an "on..." event handler attribute is refused, so a node can
// carry no script.

export const SVG_NS = "http://www.w3.org/2000/svg";

const SVG_TAGS = new Set([
  "svg",
  "g",
  "title",
  "desc",
  "rect",
  "line",
  "path",
  "polyline",
  "polygon",
  "circle",
  "text",
  "tspan",
]);

const HTML_TAGS = new Set([
  "figure",
  "figcaption",
  "table",
  "caption",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "p",
  "span",
  "div",
]);

const ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9:-]*$/;
const EVENT_HANDLER = /^on/i;

function readTag(tag) {
  if (!SVG_TAGS.has(tag) && !HTML_TAGS.has(tag)) {
    throw new RangeError(
      `Not an allowed tag: ${JSON.stringify(tag)}. Allowed: ${[...SVG_TAGS, ...HTML_TAGS].join(", ")}.`,
    );
  }
  return tag;
}

function readAttributeValue(name, value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  throw new TypeError(
    `Attribute ${name} needs a string or a finite number. Got ${typeof value === "number" ? value : typeof value}.`,
  );
}

function readAttributes(attrs) {
  if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) {
    throw new TypeError("An element's attrs is a plain object.");
  }
  const out = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!ATTRIBUTE_NAME.test(name) || EVENT_HANDLER.test(name)) {
      throw new RangeError(
        `Not an allowed attribute name: ${JSON.stringify(name)}.`,
      );
    }
    out[name] = readAttributeValue(name, value);
  }
  return out;
}

function readNode(node) {
  if (node === null || typeof node !== "object") {
    throw new TypeError("A child is a node: el(...) or text(...).");
  }
  if (Object.hasOwn(node, "text")) {
    if (typeof node.text !== "string") {
      throw new TypeError("A text node's text is a string.");
    }
    return node;
  }
  readTag(node.tag);
  readAttributes(node.attrs);
  if (!Array.isArray(node.children)) {
    throw new TypeError("An element's children is an array.");
  }
  return node;
}

// An element node. Strings and numbers among the children become text nodes;
// null, undefined and false are skipped, so a child can be written
// `condition && el(...)`.
export function el(tag, attrs = {}, children = []) {
  const kids = [];
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    kids.push(
      typeof child === "string" || typeof child === "number"
        ? text(child)
        : readNode(child),
    );
  }
  return { tag: readTag(tag), attrs: readAttributes(attrs), children: kids };
}

// A text node.
export function text(value) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`Text needs a finite number. Got ${value}.`);
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(
      `Text needs a string or a number. Got ${typeof value}.`,
    );
  }
  return { text: String(value) };
}

const TEXT_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const ATTRIBUTE_ESCAPES = { ...TEXT_ESCAPES, '"': "&quot;", "'": "&#39;" };

export function escapeText(value) {
  return String(value).replace(/[&<>]/g, (char) => TEXT_ESCAPES[char]);
}

export function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (char) => ATTRIBUTE_ESCAPES[char]);
}

// The markup string of a node. Every element is written with an end tag, so
// the string reads the same as SVG (XML) and as HTML.
export function toMarkup(node) {
  readNode(node);
  if (Object.hasOwn(node, "text")) {
    return escapeText(node.text);
  }
  const attrs = Object.entries(node.attrs)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  const children = node.children.map(toMarkup).join("");
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}

// DOM nodes for a node, made with `doc` (a Document, or anything with the same
// createElementNS, createElement and createTextNode). An SVG tag, and every
// element inside an <svg>, is made in the SVG namespace; the rest are HTML.
// The xmlns attribute is left to the namespace and not set.
export function toDom(node, doc, inSvg = false) {
  readNode(node);
  if (Object.hasOwn(node, "text")) {
    return doc.createTextNode(node.text);
  }
  const svg = inSvg || node.tag === "svg";
  const element = svg
    ? doc.createElementNS(SVG_NS, node.tag)
    : doc.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name !== "xmlns") {
      element.setAttribute(name, value);
    }
  }
  for (const child of node.children) {
    element.appendChild(toDom(child, doc, svg));
  }
  return element;
}
