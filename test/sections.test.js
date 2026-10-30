// The page's sections registry (#239, Phase 4.5 UX1): its checks, its area
// statuses and the one equality the issue asks for: the areas' errors add up
// to Run's blocked count, the talent and rotation errors included.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockedCount } from "../js/views/run-model.js";
import {
  AREAS,
  DEFAULT_AREA,
  PAGE_SECTIONS,
  areaIds,
  areaLabel,
  badgeOf,
  createSections,
  isArea,
  reveal,
} from "../js/views/sections.js";

const noop = () => {};
const pageRegistry = () => {
  const registry = createSections();
  for (const section of PAGE_SECTIONS) {
    registry.registerSection({ ...section, render: () => noop });
  }
  return registry;
};

const section = (overrides = {}) => ({
  id: "stats",
  label: "Stats",
  area: "character",
  order: 0,
  summary: () => null,
  status: () => ({ errors: 0, warnings: 0, edited: false }),
  render: () => noop,
  ...overrides,
});

describe("areas", () => {
  it("are Character, Rotation, Fight and Results, Character first", () => {
    assert.deepEqual(areaIds(), ["character", "rotation", "fight", "results"]);
    assert.equal(DEFAULT_AREA, "character");
    assert.equal(areaLabel("fight"), "Fight");
    assert.equal(areaLabel("nope"), null);
    assert.equal(isArea("results"), true);
    assert.equal(isArea("stats"), false);
    assert.equal(Object.isFrozen(AREAS), true);
  });
});

describe("registerSection", () => {
  it("keeps a section and lists an area's in their order", () => {
    const registry = createSections();
    registry.registerSection(section({ id: "b", order: 2 }));
    registry.registerSection(section({ id: "a", order: 1 }));
    registry.registerSection(section({ id: "r", area: "rotation" }));
    assert.deepEqual(
      registry.inArea("character").map(({ id }) => id),
      ["a", "b"],
    );
    assert.deepEqual(
      registry.all().map(({ id }) => id),
      ["b", "a", "r"],
    );
  });

  it("refuses a section with a missing or bad part", () => {
    const registry = createSections();
    assert.throws(() => registry.registerSection(), TypeError);
    assert.throws(() => registry.registerSection(section({ id: "" })));
    assert.throws(() => registry.registerSection(section({ label: "" })));
    assert.throws(
      () => registry.registerSection(section({ area: "stats" })),
      RangeError,
    );
    assert.throws(() => registry.registerSection(section({ order: "1" })));
    for (const name of ["summary", "status", "render"]) {
      assert.throws(
        () => registry.registerSection(section({ [name]: null })),
        new RegExp(name),
      );
    }
    registry.registerSection(section());
    assert.throws(() => registry.registerSection(section()), /already/);
  });

  it("registers the page's sections, each in one area", () => {
    const registry = pageRegistry();
    assert.deepEqual(
      AREAS.map(({ id }) => registry.inArea(id).map((s) => s.id)),
      [["setup", "talents"], ["rotation"], ["fight"], ["results"]],
    );
    for (const { summary } of PAGE_SECTIONS) {
      assert.equal(summary({}), null);
    }
  });
});

// States that block Run in every way it counts (#155, #204, #217, #237).
const RUN_ERRORS = [
  {},
  { duration: "Too long" },
  { duration: "Too long", iterations: "Too many", seed: "Not a number" },
  { iterations: "Too many" },
];
const FORM_ERRORS = [
  {},
  { "weapons.mainHand.max": "Max under Min", "weapons.mainHand.min": null },
  { attackPower: "Too high", critChance: "Too high", hitChance: "Too high" },
  { __form: "The config is not valid" },
];
const TALENTS = [{}, { error: "Over the level cap" }];
const ROTATIONS = [
  {},
  { rotationErrors: ["unknown ability"], rotationWarnings: ["unused"] },
  { rotationErrors: ["a", "b", "c"] },
  { rotationErrors: [], rotationWarnings: ["unused", "never casts"] },
];

function* states() {
  for (const mode of ["live", "batch"]) {
    for (const errors of RUN_ERRORS) {
      for (const formErrors of FORM_ERRORS) {
        for (const talents of TALENTS) {
          for (const rotation of ROTATIONS) {
            yield {
              run: { mode, state: "idle", errors },
              form: { errors: formErrors, ...rotation },
              talents,
            };
          }
        }
      }
    }
  }
}

describe("area statuses", () => {
  it("add up to Run's blocked count in every state", () => {
    const registry = pageRegistry();
    let checked = 0;
    for (const state of states()) {
      const byArea = areaIds().map(
        (area) => registry.areaStatus(state, area).errors,
      );
      const sum = byArea.reduce((total, errors) => total + errors, 0);
      assert.equal(sum, blockedCount(state), JSON.stringify(state));
      assert.equal(registry.totalErrors(state), blockedCount(state));
      checked += 1;
    }
    assert.ok(checked > 0);
  });

  it("count the talent and rotation errors the form's footer does not", () => {
    const registry = pageRegistry();
    const state = {
      run: { mode: "live", errors: {} },
      form: { errors: {}, rotationErrors: ["x", "y"] },
      talents: { error: "Over the level cap" },
    };
    assert.equal(registry.areaStatus(state, "character").errors, 1);
    assert.equal(registry.areaStatus(state, "rotation").errors, 1);
    assert.equal(blockedCount(state), 2);
    assert.equal(registry.totalErrors(state), 2);
  });

  it("put the iterations' error in Fight only in batch mode", () => {
    const registry = pageRegistry();
    const errors = { iterations: "Too many" };
    const live = { run: { mode: "live", errors }, form: {}, talents: {} };
    const batch = { run: { mode: "batch", errors }, form: {}, talents: {} };
    assert.equal(registry.areaStatus(live, "fight").errors, 0);
    assert.equal(registry.areaStatus(batch, "fight").errors, 1);
  });

  it("show the rotation's warnings only while it has no errors", () => {
    const registry = pageRegistry();
    const base = { run: { errors: {} }, talents: {} };
    const warned = { ...base, form: { rotationWarnings: ["a", "b"] } };
    const both = {
      ...base,
      form: { rotationErrors: ["e"], rotationWarnings: ["a"] },
    };
    assert.deepEqual(registry.areaStatus(warned, "rotation"), {
      errors: 0,
      warnings: 2,
      edited: false,
    });
    assert.deepEqual(registry.areaStatus(both, "rotation"), {
      errors: 1,
      warnings: 0,
      edited: false,
    });
    assert.deepEqual(registry.areaStatus(warned, "results"), {
      errors: 0,
      warnings: 0,
      edited: false,
    });
  });
});

describe("badgeOf", () => {
  it("names the errors, else the warnings, else nothing", () => {
    assert.deepEqual(badgeOf({ errors: 1, warnings: 3 }), {
      count: 1,
      words: "error",
    });
    assert.deepEqual(badgeOf({ errors: 2, warnings: 0 }), {
      count: 2,
      words: "errors",
    });
    assert.deepEqual(badgeOf({ errors: 0, warnings: 1 }), {
      count: 1,
      words: "warning",
    });
    assert.equal(badgeOf({ errors: 0, warnings: 0 }), null);
  });
});

describe("reveal", () => {
  it("asks for the node's area with a bubbling event", () => {
    const sent = [];
    class CustomEvent {
      constructor(type, init) {
        Object.assign(this, { type, ...init });
      }
    }
    const node = {
      ownerDocument: { defaultView: { CustomEvent } },
      dispatchEvent: (event) => sent.push(event),
    };
    reveal(node);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "section-reveal");
    assert.equal(sent[0].bubbles, true);
  });

  it("does nothing without a window or a node", () => {
    assert.doesNotThrow(() => reveal(null));
    assert.doesNotThrow(() => reveal({ ownerDocument: {} }));
  });
});
