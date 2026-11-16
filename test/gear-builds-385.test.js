import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EMPTY_NAME,
  STORAGE_REASON,
  duplicateNameMessage,
  guardedRemove,
  guardedRename,
  guardedSave,
  nameConflict,
  trimmedName,
} from "../js/gear-builds.js";
import { saveGearBuild } from "../js/gear-store.js";

const slots = { mainHand: { item: 19324, enchant: 1900, suffix: null } };
const SRC = readFileSync(
  fileURLToPath(new URL("../js/gear-builds.js", import.meta.url)),
  "utf8",
);

function memory({ fail } = {}) {
  const map = new Map();
  return {
    getItem(key) {
      if (fail === "read") throw new Error("refused");
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (fail === "write") throw new Error("full");
      map.set(key, value);
    },
    removeItem(key) {
      if (fail === "write") throw new Error("full");
      map.delete(key);
    },
  };
}

describe("gear build name and storage guards (#385)", () => {
  it("trims names and rejects empty or whitespace names", () => {
    assert.equal(trimmedName("  Raid  "), "Raid");
    assert.equal(trimmedName("   "), "");
    assert.equal(trimmedName(""), "");
    assert.equal(nameConflict("", []), EMPTY_NAME);
    assert.equal(nameConflict("   ", []), EMPTY_NAME);
    assert.equal(guardedSave({ name: "  ", slots }, memory()).ok, false);
    assert.equal(guardedSave({ name: "  ", slots }, memory()).reason, "name");
    assert.equal(
      guardedSave({ name: "  ", slots }, memory()).message,
      EMPTY_NAME,
    );
    assert.equal(guardedRename("id", "\t", memory()).message, EMPTY_NAME);
  });

  it("rejects a duplicate name and a rename collision", () => {
    const storage = memory();
    const first = guardedSave({ name: "P1", slots }, storage);
    assert.equal(first.ok, true);
    const again = guardedSave({ name: "  P1  ", slots }, storage);
    assert.equal(again.ok, false);
    assert.equal(again.reason, "name");
    assert.equal(again.message, duplicateNameMessage("P1"));
    const other = guardedSave({ name: "Raid", slots }, storage);
    const collision = guardedRename(other.build.id, "P1", storage);
    assert.equal(collision.ok, false);
    assert.equal(collision.message, duplicateNameMessage("P1"));
    const same = guardedRename(first.build.id, "P1", storage);
    assert.equal(same.ok, true);
  });

  it("surfaces { ok: false, reason: 'storage' } as a live message", () => {
    const missing = guardedSave({ name: "P1", slots }, null);
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, STORAGE_REASON);
    assert.match(missing.message, /could not be saved/);
    const full = memory({ fail: "write" });
    const saved = guardedSave({ name: "P1", slots }, full);
    assert.equal(saved.ok, false);
    assert.equal(saved.reason, STORAGE_REASON);
    assert.equal(
      saved.message,
      "The gear build could not be saved. Storage is off or full.",
    );
    const later = memory();
    const built = saveGearBuild({ name: "P1", slots }, later);
    later.setItem = () => {
      throw new Error("full");
    };
    const renamed = guardedRename(built.build.id, "Raid", later);
    assert.equal(renamed.reason, STORAGE_REASON);
    assert.match(renamed.message, /could not be renamed/);
    const gone = guardedRemove(built.build.id, null);
    assert.equal(gone.reason, STORAGE_REASON);
    assert.match(gone.message, /could not be deleted/);
  });

  it("the store never throws through the guards", () => {
    assert.doesNotThrow(() => guardedSave({ name: "P1", slots }, null));
    assert.doesNotThrow(() =>
      guardedSave({ name: "P1", slots }, memory({ fail: "write" })),
    );
    assert.doesNotThrow(() => guardedRename("missing", "Raid", null));
    assert.doesNotThrow(() => guardedRemove("missing", null));
  });
});

describe("mutants for the name and storage guards (#385)", () => {
  const prelude = () => `
    const EMPTY_NAME = ${JSON.stringify(EMPTY_NAME)};
    const STORAGE_REASON = ${JSON.stringify(STORAGE_REASON)};
    function trimmedName(name) {
      return typeof name === "string" ? name.trim() : "";
    }
    function duplicateNameMessage(name) {
      return ${JSON.stringify(duplicateNameMessage("NAME")).replace("NAME", "${name}")};
    }
  `;

  const nameConflictSource = () => {
    const start = SRC.indexOf("export function nameConflict");
    const end = SRC.indexOf("\nexport function slotsEqual", start);
    assert.ok(start >= 0 && end > start);
    return SRC.slice(start, end).replace("export ", "");
  };

  const withStorageSource = () => {
    const start = SRC.indexOf("function withStorageMessage");
    const end = SRC.indexOf("\nexport function guardedSave", start);
    assert.ok(start >= 0 && end > start);
    return SRC.slice(start, end);
  };

  it("M: dropping the empty-name return lets a whitespace name through", () => {
    const body = nameConflictSource().replace(
      /if \(trimmed === ""\) \{\s*return EMPTY_NAME;\s*\}/,
      "/* mutant: empty name allowed */",
    );
    assert.notEqual(body, nameConflictSource());
    const run = new Function(
      "name",
      "builds",
      "exceptId",
      `${prelude()}\n${body}\nreturn nameConflict(name, builds, exceptId);`,
    );
    assert.equal(nameConflict("  ", []), EMPTY_NAME);
    assert.equal(run("  ", [], null), "");
  });

  it("M: dropping the taken-name check lets a duplicate through", () => {
    const body = nameConflictSource().replace(
      "build.name === trimmed && build.id !== exceptId",
      "false",
    );
    assert.notEqual(body, nameConflictSource());
    const run = new Function(
      "name",
      "builds",
      "exceptId",
      `${prelude()}\n${body}\nreturn nameConflict(name, builds, exceptId);`,
    );
    const builds = [{ id: "gear-1", name: "P1" }];
    assert.equal(nameConflict("P1", builds), duplicateNameMessage("P1"));
    assert.equal(run("P1", builds, null), "");
  });

  it("M: skipping the storage message leaves reason 'storage' silent", () => {
    const body = withStorageSource().replace(
      "if (result?.ok === false && result.reason === STORAGE_REASON)",
      "if (false)",
    );
    assert.notEqual(body, withStorageSource());
    const run = new Function(
      "result",
      "message",
      `${prelude()}\n${body}\nreturn withStorageMessage(result, message);`,
    );
    const result = { ok: false, reason: STORAGE_REASON };
    const message =
      "The gear build could not be saved. Storage is off or full.";
    // The production wrapper still attaches the message.
    const live = guardedSave({ name: "P1", slots }, null);
    assert.equal(live.message, message);
    const silent = run(result, message);
    assert.equal(silent.ok, false);
    assert.equal(silent.reason, STORAGE_REASON);
    assert.equal(silent.message, undefined);
  });
});
