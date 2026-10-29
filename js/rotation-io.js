import { k } from "../data/constants.js";
import { validateRotation } from "./rotation-validator.js";

// Rotation import and export (roadmap R6, issue #143). A rotation is data
// (docs/rotation.md); this module writes it as text and reads it back, so a
// rotation can be saved, shared and loaded. It is pure: text in, text or a
// result out. It reads no file, the clipboard or the DOM; a page or a tool
// does that and hands the text here.
//
//   exportRotation(rotation)  the canonical JSON text of a valid rotation.
//                             The same rotation always gives the same text,
//                             whatever order its keys were made in: keys sorted
//                             at every level, two-space indent, one trailing
//                             newline. An invalid rotation is a RangeError
//                             (the validator's), so a bad file is never written.
//   importRotation(text)      { ok, rotation, errors }. `ok` is true and
//                             `errors` is [] when the text is a valid
//                             rotation; otherwise `ok` is false, `rotation` is
//                             null and `errors` is the list of { path, message }
//                             the validator gives (js/rotation-validator.js),
//                             (each path and message cut to
//                             k("rotation.maxErrorChars"), since a message
//                             echoes the bad value), with "" as the path of a problem with the text as
//                             a whole (too long, not JSON).
//
// Export, import, export gives the same text, byte for byte, and importing an
// exported rotation gives back a rotation that runs identically.
//
// Import trusts nothing. The text is read as data and never run: JSON.parse
// only, no eval, no Function. Its size is checked first, in characters (the
// length of a JavaScript string) against k("rotation.maxImportChars"), before
// anything is parsed. Then the validator rejects what the shape and vocabulary
// do not allow, and that includes every unknown field, so a "__proto__" or "constructor" key is an
// error like any other unknown key and never reaches an object (the result is
// the parsed value itself, so nothing is merged into another object). A JSON
// parse error, including one a deeply nested value causes, is a clean error.
// Nothing here knows a step or a frame.

// What the text is written with: two spaces per level and a final newline.
const INDENT = "  ";
const NEWLINE = "\n";

// A byte-order mark some editors put at the start of a UTF-8 file. JSON
// does not allow it, so one at the very start is dropped.
const BYTE_ORDER_MARK = "\uFEFF";

// A copy of a JSON value with the keys of every object in sorted order
// (UTF-16 code unit order, which does not depend on the locale). Arrays keep
// their order: the order of the rules is the priority. Object.fromEntries
// defines each key as an own property, so even a key named "__proto__" would
// not set a prototype (the validator refuses it first).
function sortedCopy(value) {
  if (Array.isArray(value)) {
    return value.map(sortedCopy);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedCopy(value[key])]),
    );
  }
  return value;
}

export function exportRotation(rotation) {
  const errors = validateRotation(rotation);
  if (errors.length > 0) {
    throw new RangeError(
      `Bad rotation:\n${errors.map((error) => error.message).join("\n")}`,
    );
  }
  return JSON.stringify(sortedCopy(rotation), null, INDENT) + NEWLINE;
}

// A path or message cut to k("rotation.maxErrorChars"). The validator's
// messages echo the value that was wrong, and an imported file can make that
// value as long as the file may be.
const ELLIPSIS = "\u2026";
function clip(text) {
  const limit = k("rotation.maxErrorChars");
  return text.length > limit ? text.slice(0, limit - 1) + ELLIPSIS : text;
}

const failure = (path, message) => ({
  ok: false,
  rotation: null,
  errors: [{ path, message }],
});

export function importRotation(text) {
  if (typeof text !== "string") {
    return failure("", `A rotation file is text; got ${typeof text} instead.`);
  }
  const limit = k("rotation.maxImportChars");
  if (text.length > limit) {
    return failure(
      "",
      `The rotation file is too large: ${text.length} characters; the most allowed is ${limit}.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(
      text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text,
    );
  } catch (error) {
    return failure(
      "",
      `The rotation file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const errors = validateRotation(parsed);
  if (errors.length > 0) {
    return {
      ok: false,
      rotation: null,
      errors: errors.map(({ path, message }) => ({
        path: clip(path),
        message: clip(message),
      })),
    };
  }
  return { ok: true, rotation: parsed, errors: [] };
}
