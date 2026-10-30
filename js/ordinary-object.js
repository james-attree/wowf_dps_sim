// Options and contexts are read only from an ordinary object: one whose fields
// are its properties, made by a literal, Object.create or a class. Arrays,
// Sets, Maps, WeakMaps, RegExps, typed arrays and the other built-ins with a
// tag of their own are not: their contents are not fields, so read as options
// they would quietly be the defaults, or their own seed a fight (#248 QA;
// runFight, SimRunner and live.run since Kira's #250 QA, polish 4).
export function isOrdinaryObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

// A built-in object's kind, from its tag: "Map", "WeakMap", "Uint8Array".
export function builtinTag(value) {
  return Object.prototype.toString
    .call(value)
    .replace(/^\[object (.*)\]$/, "$1");
}

// "a" or "an" as the name is read: "an Array", "a Map", and "a Uint8Array",
// whose U reads "you" (#250 QA, polish 3).
export function withArticle(name) {
  return `${/^(?:[AEIO]|U(?!int))/i.test(name) ? "an" : "a"} ${name}`;
}

// What a bad options value was, for the RangeError (#238 QA): null, an array,
// a built-in's kind ("a Map", "a Uint8Array"), or the type.
export function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return withArticle(builtinTag(value));
  return typeof value;
}
