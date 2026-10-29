import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { conditionProblems, evaluateTrusted } from "./rotation-conditions.js";
import { rotationShapeProblems } from "./rotation-schema.js";

// The rotation interpreter (roadmap R3, issue #140). It reads a RotationRule
// list (js/rotation-schema.js, docs/rotation.md) and decides what to cast at
// one decision point: "the engine is asked what to cast now".
//
// It knows nothing of the engine. It does not see a Rogue, a Simulation, a
// step or a frame. A host gives it five things (the `host` of decide), and the
// Phase 3.5 engine can give the same five at its own decision point:
//
//   host.state()          the state view of the fight now (js/rotation-state.js)
//   host.canCast(id)      true when the ability can be cast right now: its own
//                         cooldown, its cost, the GCD, and any build lock
//   host.onGcd(id)        true when a cast of the ability starts the GCD
//   host.gcdClear()       true when the GCD is not running
//   host.cast(id)         cast it
//
// Ids are ability ids (js/ability-data.js `id`), never display names. The
// interpreter looks nothing up by name.
//
// compileRotation checks a rotation once, when it is loaded, and decide trusts
// what it compiled, so the walk does no per-call checking (the cost of
// `evaluate` checking its condition on every call, flagged at #139, is paid
// once here instead of once per condition per decision point).

// The ability ids a rotation may name. A rotation is the rogue's, and the
// rogue's abilities are the entries of the ability data.
const ABILITY_IDS = Object.freeze(
  ABILITY_DEFINITIONS.map((definition) => definition.id),
);

// Every problem with a rotation, in reading order, as strings that name where
// it is. An empty list means it can be compiled. The shape comes first and,
// if it is wrong, is all that is reported: a condition list that is not a list
// cannot be read. Then each condition's type and params
// (js/rotation-conditions.js) and each action, which must be a rogue ability.
// This is the load check R3 needs; the validator (R4, #141) is the fuller one
// (unknown aura ids, usable by the rogue, summaries) and will take its place.
export function rotationProblems(rotation) {
  const shape = rotationShapeProblems(rotation);
  if (shape.length > 0) {
    return shape;
  }
  const problems = [];
  rotation.rules.forEach((rule, index) => {
    if (!ABILITY_IDS.includes(rule.action)) {
      problems.push(
        `rules[${index}].action ${JSON.stringify(rule.action)} is not a rogue ability. Known: ${ABILITY_IDS.join(", ")}.`,
      );
    }
    rule.conditions.forEach((condition, at) => {
      problems.push(
        ...conditionProblems(condition, `rules[${index}].conditions[${at}]`),
      );
    });
  });
  return problems;
}

// What compileRotation returned, so decide can tell a checked rotation from a
// plain object that was never checked.
const COMPILED = new WeakSet();

function freezeCopy(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const copy = Array.isArray(value)
    ? value.map(freezeCopy)
    : Object.fromEntries(
        Object.entries(value).map(([key, member]) => [key, freezeCopy(member)]),
      );
  return Object.freeze(copy);
}

// Checks a rotation and returns it ready to decide with: a frozen copy, so
// changing the original afterwards changes nothing. An invalid rotation is a
// RangeError that lists every problem, so it never starts a fight.
export function compileRotation(rotation) {
  const problems = rotationProblems(rotation);
  if (problems.length > 0) {
    throw new RangeError(`Bad rotation:\n${problems.join("\n")}`);
  }
  const compiled = freezeCopy(rotation);
  COMPILED.add(compiled);
  return compiled;
}

// All of a rule's conditions hold (none: always). A loop and not `every`: this
// runs on every step of a fight, and a closure per rule shows in the bench.
function holds(conditions, state) {
  for (const condition of conditions) {
    if (!evaluateTrusted(condition, state)) {
      return false;
    }
  }
  return true;
}

// One decision point. Walks the rules from the top (docs/rotation.md, "How
// list order sets priority"):
//
//   - a rule whose conditions do not all hold is passed over;
//   - an off-GCD ability whose conditions hold is cast if it can be, and the
//     walk goes on; if it cannot be cast it is skipped and the walk goes on,
//     exactly as if its conditions had failed;
//   - an on-GCD ability whose conditions hold ends the walk: it is cast if it
//     can be, and if it cannot be afforded yet nothing lower is cast (the
//     rogue pools for it). This is the only rule that ends a walk without a
//     cast;
//   - except that while the GCD is running no on-GCD ability can be cast at
//     all, so an on-GCD rule is passed over then and does not hold the walk:
//     an off-GCD rule below it (Cold Blood) is still reached.
//
// It returns what happened: `casts`, the ids cast in order, and `outcome`,
// "cast" (an on-GCD ability was cast), "pooling" (an on-GCD rule held, the GCD
// was clear, and it could not be cast) or "none" (the walk ran off the end of the list). Each
// cast can change the fight, so the state is read again after one.
export function decide(rotation, host) {
  if (!COMPILED.has(rotation)) {
    throw new TypeError(
      "decide needs a rotation from compileRotation, which checks it once.",
    );
  }
  const casts = [];
  let state = null;
  // Asked once: only an on-GCD cast starts the GCD, and one ends the walk.
  const clear = host.gcdClear();
  for (const rule of rotation.rules) {
    // What the host can say cheaply goes first, and the state view, which is
    // the dear part, is only built for a rule that can matter: asking
    // canCast changes nothing, so the answer is the same as checking the
    // conditions first. While the GCD is running an on-GCD rule is passed over
    // whatever its conditions say. An off-GCD rule that cannot be cast is
    // passed over too, and an on-GCD rule that cannot be cast with the GCD
    // clear is the pooling one, if its conditions hold.
    const onGcd = host.onGcd(rule.action);
    if (onGcd && !clear) {
      continue;
    }
    const castable = host.canCast(rule.action);
    if (!castable && !onGcd) {
      continue;
    }
    state ??= host.state();
    if (!holds(rule.conditions, state)) {
      continue;
    }
    if (!castable) {
      // An on-GCD rule that holds, with the GCD clear: pool for it.
      return { casts, outcome: "pooling" };
    }
    host.cast(rule.action);
    casts.push(rule.action);
    state = null;
    if (onGcd) {
      return { casts, outcome: "cast" };
    }
  }
  return { casts, outcome: "none" };
}
