import manifest from "../data/talentsforever/manifest.json" with { type: "json" };

// The data version (roadmap D11): which snapshot produced a result. It is the
// snapshot's `generated` date and the client `build`, both read from
// data/talentsforever/manifest.json, the file `npm run data:refresh` writes
// next to rogue.json. Nothing here is typed by hand, so a refresh changes the
// version with no code change.
//
// The id is `<generated>+<build>`, for example "2026-10-20+1.60.1.70425". Both
// parts must be non-empty text without a "+", so the id splits back into the
// two parts. A manifest that lacks either part fails when this module loads.
//
// This module reads only the small manifest, not the 170 KB snapshot, so
// importing it (as js/fight.js does, and so the live page) costs almost
// nothing. test/data-version.test.js checks the manifest against the snapshot.
export function buildDataVersion(source) {
  const parts = {};
  for (const field of ["generated", "build"]) {
    const value = source?.[field];
    if (
      typeof value !== "string" ||
      value.trim() === "" ||
      value !== value.trim() ||
      value.includes("+")
    ) {
      throw new TypeError(
        `The data manifest needs a "${field}" text with no "+" and no spaces at the ends, not ${JSON.stringify(value)}.`,
      );
    }
    parts[field] = value;
  }
  return Object.freeze({
    generated: parts.generated,
    build: parts.build,
    id: `${parts.generated}+${parts.build}`,
  });
}

// The version of the vendored snapshot, built once when the module loads.
export const dataVersionInfo = buildDataVersion(manifest);

// The string every fight result carries as `dataVersion`.
export const dataVersion = dataVersionInfo.id;
