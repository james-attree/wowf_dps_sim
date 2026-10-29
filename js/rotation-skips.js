import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "./abilities.js";
import { evaluateTrusted } from "./rotation-conditions.js";
import { applyBuild, talentGrantedAbilities } from "./talent-build.js";
import { talentCatalogue } from "./talents.js";

// Which rules the current talent build skips (Phase 4, #217, U7 spec D9 and
// section 8). A rule is skipped when one of its own talent checks
// (abilityGranted, abilityUnlocked) fails for the build. The answer is the
// engine's: each check is evaluated with evaluateTrusted against the state
// the fight would have (js/rotation-state.js: build.selected, granted,
// talentAbilities), so nothing here copies the talent rules. Used by the
// rotation builder's cards and context line and by the stats form's summary.

const GUARDS = Object.freeze(["abilityGranted", "abilityUnlocked"]);

// The part of a fight's state a talent check reads, for config's build. A
// build the config can't hold (over its level's cap) never gets here: the
// config keeps the last legal one (#204), so this reads that.
export function talentState(config) {
  let build;
  try {
    // As js/rogue.js builds it for the fight.
    build = applyBuild(config?.talents ?? {});
  } catch {
    build = { selected: false, abilities: [] };
  }
  return Object.freeze({
    build: Object.freeze({ selected: build.selected }),
    granted: Object.freeze([...build.abilities]),
    talentAbilities: Object.freeze([...talentGrantedAbilities]),
  });
}

// The talent that grants an ability, by name ("Cold Blood"), or null.
export function grantingTalentName(ability) {
  const entry = Object.entries(TALENT_EFFECTS).find(
    ([, effect]) => effect?.ability === ability,
  );
  return entry === undefined
    ? null
    : (talentCatalogue.get(entry[0])?.name ?? null);
}

const nameOf = (id) => abilityCatalogue.get(id)?.name ?? id;

// Why `rule` is skipped with this build: { ability, talent, text } for its
// first talent check that fails ("no Cold Blood talent"), or null when every
// one holds. A condition with a param missing (an unfinished edit) is passed
// over: it is an error of its own.
export function skipOf(rule, state) {
  const failing = rule.conditions.find(
    (condition) =>
      GUARDS.includes(condition.type) &&
      typeof condition.ability === "string" &&
      !evaluateTrusted(condition, state),
  );
  if (failing === undefined) {
    return null;
  }
  const talent = grantingTalentName(failing.ability) ?? nameOf(failing.ability);
  return { ability: failing.ability, talent, text: `no ${talent} talent` };
}

// The talents a rule's checks find taken: { ability, talent } for its first
// talent check on an ability the build grants, or null.
export function takenOf(rule, state) {
  const taken = rule.conditions.find(
    (condition) =>
      GUARDS.includes(condition.type) &&
      state.talentAbilities.includes(condition.ability) &&
      state.granted.includes(condition.ability),
  );
  if (taken === undefined) {
    return null;
  }
  return {
    ability: taken.ability,
    talent: grantingTalentName(taken.ability) ?? nameOf(taken.ability),
  };
}
