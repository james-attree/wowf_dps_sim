// talentGrantedAbilities cannot be changed through Set.prototype (#210, from
// #238; #244). Object.freeze leaves a Set's data open, and the own add,
// delete and clear that throw (#207) do not stop Set.prototype.add.call.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { talentGrantedAbilities } from "../js/talent-build.js";

describe("talentGrantedAbilities is read-only (#210)", () => {
  it("Set.prototype's add, delete and clear cannot change it", () => {
    const before = [...talentGrantedAbilities];
    for (const [method, args] of [
      ["add", ["sinister-strike"]],
      ["delete", [before[0]]],
      ["clear", []],
    ]) {
      assert.throws(
        () => Set.prototype[method].call(talentGrantedAbilities, ...args),
        TypeError,
        method,
      );
    }
    assert.deepEqual([...talentGrantedAbilities], before);
    assert.equal(talentGrantedAbilities.has("sinister-strike"), false);
    assert.equal(talentGrantedAbilities.size, before.length);
  });

  it("still reads as a Set: has, size, iteration, forEach and a copy", () => {
    const list = [...talentGrantedAbilities];
    assert.ok(talentGrantedAbilities instanceof Set);
    assert.ok(list.length > 0);
    assert.ok(list.every((id) => talentGrantedAbilities.has(id)));
    assert.deepEqual([...new Set(talentGrantedAbilities)], list);
    assert.deepEqual([...talentGrantedAbilities.values()], list);
    assert.deepEqual([...talentGrantedAbilities.keys()], list);
    assert.deepEqual(
      [...talentGrantedAbilities.entries()],
      list.map((id) => [id, id]),
    );
    const seen = [];
    talentGrantedAbilities.forEach(function (id, key, set) {
      seen.push([this, id, key, set]);
    }, "self");
    assert.deepEqual(
      seen,
      list.map((id) => ["self", id, id, talentGrantedAbilities]),
    );
  });
});
