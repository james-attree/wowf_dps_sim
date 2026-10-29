import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { compileCondition, conditionProblems } from "./rotation-conditions.js";
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
// plain object that was never checked, and what decide walks for it: for each
// rule, its action and its conditions as functions of the state
// (compileCondition), made once.
const COMPILED = new WeakMap();

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
  COMPILED.set(compiled, {
    rules: compiled.rules.map((rule) => ({
      action: rule.action,
      holds: rule.conditions.map(compileCondition),
    })),
    host: null,
    onGcd: [],
  });
  return compiled;
}

// All of a rule's conditions hold (none: always). A loop and not `every`: this
// runs on every step of a fight, and a closure per rule shows in the bench.
function holds(conditions, state) {
  for (const condition of conditions) {
    if (!condition(state)) {
      return false;
    }
  }
  return true;
}

// What decide returns when nothing was cast, shared so that a decision point
// that does nothing (most of them) builds nothing. Frozen: a result is read,
// not changed.
const NO_CASTS = Object.freeze([]);
const POOLING = Object.freeze({ casts: NO_CASTS, outcome: "pooling" });
const NOTHING = Object.freeze({ casts: NO_CASTS, outcome: "none" });

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
  const program = COMPILED.get(rotation);
  if (program === undefined) {
    throw new TypeError(
      "decide needs a rotation from compileRotation, which checks it once.",
    );
  }
  const { rules } = program;
  // Whether each rule's ability starts the GCD is asked of a host once, not at
  // every decision point: it is a property of the ability.
  if (program.host !== host) {
    program.onGcd = rules.map((rule) => host.onGcd(rule.action));
    program.host = host;
  }
  const { onGcd: startsGcd } = program;
  let casts = NO_CASTS;
  let state = null;
  // Asked once: only an on-GCD cast starts the GCD, and one ends the walk.
  const clear = host.gcdClear();
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    // While the GCD is running an on-GCD rule is passed over whatever its
    // conditions say, and that is settled by one cheap question. Past it, the
    // conditions are read before canCast is asked: the state view is built a
    // part at a time (js/rotation-state.js), so a condition that fails costs
    // little, and canCast (which works out what a cast would cost) is only
    // asked of a rule that holds. Both are read-only, so the order changes
    // nothing a host can see but the calls it gets.
    const onGcd = startsGcd[index];
    if (onGcd && !clear) {
      continue;
    }
    state ??= host.state();
    if (!holds(rule.holds, state)) {
      continue;
    }
    if (!host.canCast(rule.action)) {
      if (!onGcd) {
        // An off-GCD rule that cannot be cast is passed over.
        continue;
      }
      // An on-GCD rule that holds, with the GCD clear: pool for it.
      return casts === NO_CASTS ? POOLING : { casts, outcome: "pooling" };
    }
    host.cast(rule.action);
    casts = casts === NO_CASTS ? [rule.action] : [...casts, rule.action];
    state = null;
    if (onGcd) {
      return { casts, outcome: "cast" };
    }
  }
  return casts === NO_CASTS ? NOTHING : { casts, outcome: "none" };
}
