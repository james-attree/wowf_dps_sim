import { k } from "../data/constants.js";

// The aura model (A1). An aura is a timed effect on the player (a buff) or on
// the target (a debuff or a DoT's marker). Each one is a definition: an id,
// who it sits on, how a second cast treats it, optional hooks and the effects
// it has while it is up. The engine asks for effects by kind
// (Simulation.auraEffects) and never by the aura's name, so a new aura is a
// new definition and no change to the engine.
//
// A target aura can have stacks (up to maxStacks, by its stackRule) and
// charges. A charged aura (charges set) ends after that many landed
// hits on the target as well as when its duration runs out; a new application
// restores them. Stacks and charges are separate counts.
//
// The id is the ability catalogue's id (js/abilities.js: slugify(name)) for an
// aura an ability applies. The display name is carried for the page and the
// combat log and is never compared.

// Who the aura is on. A self aura lives in Simulation.activeBuffs, a target
// aura in Simulation.activeDebuffs. Both are keyed by id.
export const AURA_TARGETS = Object.freeze(["self", "target"]);

// What a cast of an aura that is already up does to it:
//   refresh           the duration becomes the new one
//   extend            the new duration is added to what is left
//   replace-if-longer the duration becomes the new one only if it is longer
// A stackable aura (maxStacks above 1) also gains stacks, by its stack rule.
export const REFRESH_RULES = Object.freeze([
  "refresh",
  "extend",
  "replace-if-longer",
]);

// How a second application changes the stacks of an aura with maxStacks above
// 1, both capped at maxStacks:
//   add      the stacks of the new application are added to the current ones
//            (Deadly Poison: each proc is one more stack)
//   highest  the stacks become the higher of the current and the new count
//            (Expose Armor: one stack per combo point spent, and a weaker cast
//            does not take away what a stronger one gave)
export const STACK_RULES = Object.freeze(["add", "highest"]);

// The effect kinds the engine reads:
//   haste                  a number, e.g. 0.3 for +30% attack speed. Each
//                          stack applies it again (haste.stacking).
//   energyRegenMultiplier  a number, e.g. 2 for double energy regeneration.
//                          Each stack multiplies again.
//   dotDamageTaken         { ids: [dot ids], bonus }, a target aura: the named
//                          DoTs tick for (1 + bonus) times as much. Each stack
//                          adds bonus again.
//   armorReduction         a number of armor points, a target aura: the
//                          target's armor is that much lower for armor
//                          mitigation (never below 0). Each stack takes it
//                          off again.
export const EFFECT_KINDS = Object.freeze([
  "haste",
  "energyRegenMultiplier",
  "dotDamageTaken",
  "armorReduction",
]);

function fail(id, message) {
  throw new TypeError(`Aura "${id}": ${message}`);
}

function checkEffect(id, kind, value) {
  if (kind === "dotDamageTaken") {
    if (
      value === null ||
      typeof value !== "object" ||
      !Array.isArray(value.ids) ||
      value.ids.length === 0 ||
      !value.ids.every((dotId) => typeof dotId === "string" && dotId !== "") ||
      !Number.isFinite(value.bonus)
    ) {
      fail(id, "dotDamageTaken needs { ids: [DoT ids], bonus: a number }.");
    }
    return Object.freeze({
      ids: Object.freeze([...value.ids]),
      bonus: value.bonus,
    });
  }
  if (!EFFECT_KINDS.includes(kind)) {
    // The kinds above are the ones this function knows how to check. A kind
    // added to EFFECT_KINDS without a check here fails, not passes unchecked.
    fail(id, `unknown effect "${kind}". Known: ${EFFECT_KINDS.join(", ")}.`);
  }
  if (!Number.isFinite(value)) {
    fail(id, `the ${kind} effect needs a finite number. Got ${value}.`);
  }
  if (kind === "energyRegenMultiplier" && value <= 0) {
    fail(id, `energyRegenMultiplier must be above 0. Got ${value}.`);
  }
  if (kind === "armorReduction" && value <= 0) {
    fail(id, `armorReduction must be above 0. Got ${value}.`);
  }
  return value;
}

// Check a definition and freeze it. A typo in a field fails here, at load,
// not as a missing effect in the middle of a fight.
export function defineAura(spec) {
  const {
    id,
    name,
    icon = null,
    target = "self",
    duration = null,
    maxStacks = 1,
    stackRule = "add",
    charges = null,
    refresh = "refresh",
    effects = {},
    onApply = null,
    onExpire = null,
  } = spec ?? {};
  if (typeof id !== "string" || id === "") {
    fail(id, "needs a non-empty string id.");
  }
  if (typeof name !== "string" || name === "") {
    fail(id, "needs a display name.");
  }
  if (!AURA_TARGETS.includes(target)) {
    fail(
      id,
      `target must be one of ${AURA_TARGETS.join(", ")}. Got ${target}.`,
    );
  }
  if (!REFRESH_RULES.includes(refresh)) {
    fail(
      id,
      `refresh must be one of ${REFRESH_RULES.join(", ")}. Got ${refresh}.`,
    );
  }
  if (!STACK_RULES.includes(stackRule)) {
    fail(
      id,
      `stackRule must be one of ${STACK_RULES.join(", ")}. Got ${stackRule}.`,
    );
  }
  if (!Number.isInteger(maxStacks) || maxStacks < 1) {
    fail(id, `maxStacks must be a whole number, 1 or more. Got ${maxStacks}.`);
  }
  if (charges !== null && !(Number.isInteger(charges) && charges >= 1)) {
    fail(
      id,
      `charges must be a whole number, 1 or more, or null. Got ${charges}.`,
    );
  }
  if (duration !== null && !(Number.isFinite(duration) && duration > 0)) {
    fail(id, `duration must be above 0 seconds, or null. Got ${duration}.`);
  }
  for (const [hook, fn] of [
    ["onApply", onApply],
    ["onExpire", onExpire],
  ]) {
    if (fn !== null && typeof fn !== "function") {
      fail(id, `${hook} must be a function or null.`);
    }
  }
  // Only own properties are effects. An object that inherits one would have
  // it ignored by Object.entries, so a plain object is required.
  const proto =
    effects === null || typeof effects !== "object"
      ? undefined
      : Object.getPrototypeOf(effects);
  if (proto !== Object.prototype && proto !== null) {
    fail(id, "effects must be a plain object of { kind: value }.");
  }
  const checked = {};
  for (const [kind, value] of Object.entries(effects)) {
    if (!EFFECT_KINDS.includes(kind)) {
      fail(id, `unknown effect "${kind}". Known: ${EFFECT_KINDS.join(", ")}.`);
    }
    checked[kind] = checkEffect(id, kind, value);
  }
  return Object.freeze({
    id,
    name,
    icon,
    target,
    duration,
    maxStacks,
    stackRule,
    charges,
    refresh,
    effects: Object.freeze(checked),
    onApply,
    onExpire,
  });
}

// The auras the Combat rogue applies. The order is the order effects are
// combined in, so it does not depend on which one was cast first.
export const AURAS = Object.freeze({
  sliceAndDice: defineAura({
    id: "slice-and-dice",
    name: "Slice and Dice",
    effects: { haste: k("sliceAndDice").haste },
  }),
  adrenalineRush: defineAura({
    id: "adrenaline-rush",
    name: "Adrenaline Rush",
    duration: k("adrenalineRush").duration,
    effects: { energyRegenMultiplier: k("adrenalineRush").regenMultiplier },
  }),
  bladeFlurry: defineAura({
    id: "blade-flurry",
    name: "Blade Flurry",
    duration: k("bladeFlurry").duration,
    effects: { haste: k("bladeFlurry").haste },
  }),
  // ghostlyStrike.duration is a self buff. Its dodge chance is not applied.
  ghostlyStrike: defineAura({
    id: "ghostly-strike",
    name: "Ghostly Strike",
    duration: k("ghostlyStrike").duration,
  }),
  // The marker for the Rupture DoT on the target. Its duration is the DoT's,
  // which depends on the combo points spent, so each cast gives it.
  rupture: defineAura({
    id: "rupture",
    name: "Rupture",
    target: "target",
  }),
  // hemorrhage.ruptureBonus.bonus applies to Rupture ticks only.
  hemorrhage: defineAura({
    id: "hemorrhage",
    name: "Hemorrhage",
    target: "target",
    duration: k("hemorrhage.ruptureBonus").duration,
    effects: {
      dotDamageTaken: {
        ids: ["rupture"],
        bonus: k("hemorrhage.ruptureBonus").bonus,
      },
    },
  }),
  // Expose Armor (a finisher; not in the rotation yet). One stack per combo
  // point spent, each taking exposeArmor.armorPerComboPoint off the target's
  // armor. A cast with fewer combo points does not weaken a stronger one.
  exposeArmor: defineAura({
    id: "expose-armor",
    name: "Expose Armor",
    target: "target",
    duration: k("exposeArmor").duration,
    maxStacks: k("combo.max"),
    stackRule: "highest",
    effects: { armorReduction: k("exposeArmor").armorPerComboPoint },
  }),
  // The Deadly Poison stacks on the target. Each proc adds a stack and
  // restarts the duration. The poison's damage over time is a DoT of its own
  // (nature, so it skips armor); procs are wired in A5 (#105), so nothing
  // applies this aura yet. The poisons are not in the ability catalogue until
  // D9, so the id is the slug the poison's DoT already uses.
  deadlyPoison: defineAura({
    id: "deadly-poison",
    name: "Deadly Poison",
    target: "target",
    duration: k("poison.deadly").duration,
    maxStacks: k("poison.deadly").stacks,
  }),
});

// Every definition keyed by id, in the order above.
export function auraRegistry() {
  return new Map(Object.values(AURAS).map((aura) => [aura.id, aura]));
}
