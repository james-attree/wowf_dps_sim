import snapshot from "../data/talentsforever/rogue.json" with { type: "json" };

// The one place the vendored talentsforever rogue export is imported. The
// talent catalogue (js/talents.js) and the ability catalogue (js/abilities.js)
// both read it from here, so the JSON module is loaded once and a refreshed
// snapshot (npm run data:refresh) reaches both with no code change.
//
// Import attributes (`with { type: "json" }`) need Node 20.19+ and current
// browsers; nothing is fetched or read from disk by hand.
export { snapshot };
