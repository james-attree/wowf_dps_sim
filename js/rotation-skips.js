import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "./abilities.js";
import { expandRace, raceCatalogue, raceGrantedAbilities } from "./racials.js";
import { evaluateTrusted } from "./rotation-conditions.js";
import { applyBuild, talentGrantedAbilities } from "./talent-build.js";
import { talentCatalogue } from "./talents.js";

// Which rules the current talent build skips (Phase 4, #217, U7 spec D9 and
// section 8). A rule is skipped when its action is a talent ability the build
// does not grant (the engine's host.usable, Rogue.lockedByBuild: with no
// build too, #199), or when one of its own talent checks (abilityGranted,
// abilityUnlocked) fails for the build. The answer is the engine's: each
// check is evaluated with evaluateTrusted against the state
// the fight would have (js/rotation-state.js: build.selected, granted,
// talentAbilities), so nothing here copies the talent rules. Used by the
// rotation builder's cards and context line and by the stats form's summary.

const GUARDS = Object.freeze(["abilityGranted", "abilityUnlocked"]);

// The part of a fight's state a talent check reads, for config's build. A
// build the config can't hold (over its level's cap) never gets here: the
// config keeps the last legal one (#204), so this reads that.
// The config has no host grants (Rogue's `abilities` option), so `granted` is
// the build's and the race's (#278) alone: an ability a host grants with no build (Blade Flurry,
// say) is usable in the engine but shown here as skipped. The app passes no
// host grants (docs/rotation.md, "Granted and unlocked").
export function talentState(config) {
  let build;
  try {
    // As js/rogue.js builds it for the fight.
    build = applyBuild(config?.talents ?? {});
  } catch {
    build = { selected: false, abilities: [] };
  }
  // The race's on-use racials (#278), as js/rogue.js grants them. A race the
  // config can't hold grants nothing here (normalizeConfig refuses it first).
  let race;
  try {
    race = expandRace(config?.race ?? null);
  } catch {
    race = expandRace(null);
  }
  return Object.freeze({
    build: Object.freeze({ selected: build.selected }),
    granted: Object.freeze([...build.abilities, ...race.abilities]),
    talentAbilities: Object.freeze([
      ...talentGrantedAbilities,
      ...raceGrantedAbilities,
    ]),
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

// The races that grant an on-use racial, by name ("Orc"), in catalogue order.
export function grantingRaceNames(ability) {
  return raceCatalogue.races
    .filter((race) => expandRace(race.id).abilities.includes(ability))
    .map((race) => race.name);
}

// "Orc", "Orc or Troll", "Gnome, Orc or Troll".
function orList(names) {
  const rest = names.slice(0, -1);
  return rest.length === 0
    ? names.join("")
    : `${rest.join(", ")} or ${names.at(-1)}`;
}

// The skip for an ability the build lacks: { ability, talent, race, text,
// phrase }. An on-use racial (#278) the race doesn't grant reads "Not your
// race (Orc only)" (#280): race is then the granting races ("Orc") and
// talent null. Otherwise race is null and, a
// guard on an ability no talent grants (abilityGranted on Sinister Strike)
// is never true, whatever the talents: no talent to name, and the ability
// is baseline, so the text says its check is never true (#244, Fran's #255
// check, P1, and her qa-256 P-c wording; it read "Sinister Strike is never
// granted (no talent gives it)"). talent is null then.
// phrase is text as it reads after "skipped: " ("not your race (Orc
// only)").
function skipFor(ability) {
  if (raceGrantedAbilities.has(ability)) {
    const race = orList(grantingRaceNames(ability));
    const text = `Not your race (${race} only)`;
    return {
      ability,
      talent: null,
      race,
      text,
      phrase: `not your race (${race} only)`,
    };
  }
  const talent = grantingTalentName(ability);
  if (talent === null) {
    const text = `${nameOf(ability)} is baseline, so its talent check is never true`;
    return { ability, talent: null, race: null, text, phrase: text };
  }
  const text = `no ${talent} talent`;
  return { ability, talent, race: null, text, phrase: text };
}

// Why `rule` is skipped with this build: { ability, talent, text } for its
// action when that is a talent ability the build lacks, else for its first
// talent check that fails ("no Cold Blood talent"), or null when every one
// holds. A condition with a param missing (an unfinished edit) is passed
// over: it is an error of its own.
export function skipOf(rule, state) {
  // The engine passes over a talent ability the build does not grant, with
  // no build too, whatever the rule's conditions say (#199).
  if (
    state.talentAbilities.includes(rule.action) &&
    !state.granted.includes(rule.action)
  ) {
    return skipFor(rule.action);
  }
  const failing = rule.conditions.find(
    (condition) =>
      GUARDS.includes(condition.type) &&
      typeof condition.ability === "string" &&
      !evaluateTrusted(condition, state),
  );
  if (failing === undefined) {
    return null;
  }
  return skipFor(failing.ability);
}

// The talents a rule's checks find taken: { ability, talent, race } for its
// first talent check on an ability the build or the race grants, or null.
// For an on-use racial, race is the granting races ("Orc") and talent null;
// otherwise race is null.
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
  if (raceGrantedAbilities.has(taken.ability)) {
    return {
      ability: taken.ability,
      talent: null,
      race: orList(grantingRaceNames(taken.ability)),
    };
  }
  return {
    ability: taken.ability,
    talent: grantingTalentName(taken.ability) ?? nameOf(taken.ability),
    race: null,
  };
}
