import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { defineModifier } from "./modifiers.js";

// The aura model (A1). An aura is a timed effect on the player (a buff) or on
// the target (a debuff or a DoT's marker). Each one is a definition: an id,
// who it sits on, how a second cast treats it, optional hooks and the effects
// it has while it is up. The engine asks for effects by kind
// (Simulation.auraEffects) and never by the aura's name, so a new aura is a
// new definition and no change to the engine.
//
// What an aura changes while it is up is data of two kinds. Its effects
// are the engine-read kinds below. Its modifiers are the A2 schema
// (js/modifiers.js): { kind, op, value, scope? } entries that the modifier
// pipeline combines with talents and every other source. A haste or
// energyRegenMultiplier effect is shorthand for the matching modifier
// (haste add, energyRegen mult); defineAura writes that modifier for it, and
// the engine reads the modifier. The effects stay as written so an aura
// definition keeps one obvious place for its number.
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
    modifiers = [],
    onApply = null,
    onExpire = null,
  } = spec ?? {};
  if (typeof id !== "string" || id === "") {
    fail(id, "needs a non-empty string id.");
  }
  // Auras are looked up by id in plain objects. "__proto__" would set a
  // prototype and not a key.
  if (id === "__proto__") {
    fail(id, 'the id "__proto__" is reserved.');
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
  if (!Array.isArray(modifiers)) {
    fail(id, "modifiers must be an array of modifiers.");
  }
  // Effects that are shorthand for modifiers come first, then the explicit
  // ones, so the order is the same on every load.
  const derived = [];
  if (Object.hasOwn(checked, "haste")) {
    derived.push({ kind: "haste", op: "add", value: checked.haste });
  }
  if (Object.hasOwn(checked, "energyRegenMultiplier")) {
    derived.push({
      kind: "energyRegen",
      op: "mult",
      value: checked.energyRegenMultiplier,
    });
  }
  const compiled = [...derived, ...modifiers].map((modifier) => {
    try {
      return defineModifier({ ...modifier, source: id });
    } catch (error) {
      throw new TypeError(`Aura "${id}": ${error.message}`, { cause: error });
    }
  });
  const aura = Object.freeze({
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
    modifiers: Object.freeze(compiled),
    onApply,
    onExpire,
  });
  SPECS.set(aura, { ...spec, effects: { ...effects } });
  return aura;
}

// The spec each definition was built from, so auraWithEffects can build it
// again with other effects.
const SPECS = new WeakMap();

// An aura defined again with some effects changed (#290): a lower rank's
// Slice and Dice haste or Expose Armor armour. Same id, name and rules; the
// effects' modifiers are derived again from the new values. The fight
// registers it under its id in place of the AURAS one (Simulation).
export function auraWithEffects(aura, effects) {
  const spec = SPECS.get(aura);
  if (spec === undefined) {
    throw new TypeError(
      "auraWithEffects needs an aura made by defineAura (js/auras.js).",
    );
  }
  return defineAura({ ...spec, effects: { ...spec.effects, ...effects } });
}

// Venom's aura from the current constants. Chance is added only when
// venom.chanceAddMode is the team assumption "percentage points".
export function venomAura() {
  const chance =
    k("venom.chanceAddMode") === "percentage points" ? k("venom.chanceAdd") : 0;
  return defineAura({
    id: "venom",
    name: "Venom",
    duration: k("venom").duration,
    modifiers: [
      { kind: "poisonChance", op: "add", value: chance },
      {
        kind: "damage",
        op: "mult",
        value: k("venom").poisonDamage,
        scope: { tags: ["poison"] },
      },
    ],
  });
}

// Poised's aura for a reduction of `energy` (the spell's 10 plus Composure).
export function poisedAura(energy) {
  // Every energy-paying ability, not white swings: an unscoped modifier would
  // also match a swing (consumeUseCharges) and the opener would eat Poised.
  const abilities = ABILITY_DEFINITIONS.filter(
    (definition) => definition.cost !== undefined,
  ).map((definition) => definition.id);
  return defineAura({
    id: "poised",
    name: "Poised",
    duration: k("poised").duration,
    charges: 1,
    modifiers: [
      {
        kind: "energyCost",
        op: "add",
        value: -energy,
        scope: { abilities },
      },
    ],
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
  // The Ambush and Garrote gate (TR-06 / #335, Garrote in #340). A landed
  // Ghostly Strike applies it for ghostlyStrike.ambushWindow seconds. One
  // charge (the "next" cast). It is not Stealth.
  ambushWindow: defineAura({
    id: "ambush-window",
    name: "Ambush window",
    charges: k("ghostlyStrike.ambushWindowCharges"),
  }),
  // Cold Blood: the next attack of the listed abilities crits for sure, then
  // the aura is gone. The crit is a flat add to the crit chance, scoped to the
  // abilities of the talent text; the one charge is used by the first of them
  // to land (Simulation.consumeUseCharges). No timer in the game: duration is
  // an hour, longer than any fight.
  coldBlood: defineAura({
    id: "cold-blood",
    name: "Cold Blood",
    duration: k("coldBlood").duration,
    charges: 1,
    modifiers: [
      {
        kind: "critChance",
        op: "add",
        value: k("coldBlood").critChance,
        scope: { abilities: [...k("coldBlood").abilities] },
      },
    ],
  }),
  // Blood Fury (Orc, P5-03a, #278): attack power x1.10 for 15 s. A mult, so it
  // multiplies the base and every flat add (modifiers.stacking attackPower).
  bloodFury: defineAura({
    id: "blood-fury",
    name: "Blood Fury",
    duration: k("racial.bloodFury").duration,
    modifiers: [
      {
        kind: "attackPower",
        op: "mult",
        value: k("racial.bloodFury").attackPower,
      },
    ],
  }),
  // Elune's Light (Night Elf, P5-03a, #278): +10% crit on every attack for
  // 15 s, unscoped as Ruthless's is (A18).
  elunesLight: defineAura({
    id: "elunes-light",
    name: "Elune's Light",
    duration: k("racial.elunesLight").duration,
    modifiers: [
      {
        kind: "critChance",
        op: "add",
        value: k("racial.elunesLight").critChance,
      },
    ],
  }),
  // Berserking (Troll, P5-03b, #279): +10% attack speed for 15 s, a haste add
  // as Slice and Dice's (A20): a swing under way is not rescaled.
  berserking: defineAura({
    id: "berserking",
    name: "Berserking",
    duration: k("racial.berserking").duration,
    effects: { haste: k("racial.berserking").haste },
  }),
  // Eureka! (Gnome, P5-03b, #279): for 8 s the non-periodic damaging
  // abilities (racial.eurekaAbilities, A22) cost x0.9, rounded down (A19), and
  // deal x1.1; Instant Poison deals x1.1 too. Not Rupture's or Deadly
  // Poison's ticks, nor white swings.
  eureka: defineAura({
    id: "eureka",
    name: "Eureka!",
    duration: k("racial.eureka").duration,
    modifiers: [
      {
        kind: "energyCost",
        op: "mult",
        value: k("racial.eureka").energyCost,
        scope: { abilities: [...k("racial.eurekaAbilities")] },
      },
      {
        kind: "damage",
        // A tagged assumption (#279 QA N5): a mult, not an add.
        op: k("racial.eurekaDamageOp"),
        value: k("racial.eureka").damage,
        scope: {
          abilities: [...k("racial.eurekaAbilities"), "instant-poison"],
        },
      },
    ],
  }),
  // The marker for the Rupture DoT on the target. Its duration is the DoT's,
  // which depends on the combo points spent, so each cast gives it.
  // The marker for the Garrote bleed on the target. Its length is the DoT's.
  garrote: defineAura({
    id: "garrote",
    name: "Garrote",
    target: "target",
  }),
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
        ids: ["rupture", "garrote"],
        bonus: k("hemorrhage.ruptureBonus").bonus,
      },
    },
  }),
  // Expose Armor (a finisher, #268; no preset casts it). One stack per combo
  // point spent, each taking exposeArmor.armorPerComboPoint off the target's
  // armor. A cast with fewer combo points does not weaken a stronger one
  // (A12: the highest reduction wins, as it would against Sunder Armor).
  exposeArmor: defineAura({
    id: "expose-armor",
    name: "Expose Armor",
    target: "target",
    duration: k("exposeArmor").duration,
    maxStacks: k("combo.max"),
    stackRule: "highest",
    effects: { armorReduction: k("exposeArmor").armorPerComboPoint },
  }),
  // Venom (TR-05 / #334): a self aura Shank applies when the talent is taken.
  // Poison damage is × venom.poisonDamage (venom.stacking). The apply-chance
  // add is venom.chanceAdd only while venom.chanceAddMode is percentage points.
  // createFight builds this again so those rows are read at fight start.
  venom: venomAura(),
  // Poised (TR-05 / #334): the next energy-costing ability costs poised.energy
  // less. Composure is added when the fight is built. One charge.
  poised: poisedAura(k("poised").energy),
  // The Deadly Poison stacks on the target. Each landed proc adds a stack and
  // restarts the duration (the applyDot action, js/procs.js; A5, #105). The
  // poison's damage over time is a DoT of its own (nature, so it skips armor),
  // each tick the stacks × one stack's tick. The id is the slug of the poison's
  // name (js/poisons.js), which is also the id of its DoT.
  // Death Mark (TR-07 / #336): the target stores a fraction of damage dealt
  // for the aura's length, then the stored amount is dealt. The cast fills
  // stored, rate, baseCap and comboPoints (Simulation.armDeathMark).
  deathMark: defineAura({
    id: "death-mark",
    name: "Death Mark",
    target: "target",
    duration: k("deathMark").duration,
    onExpire(simulation, aura) {
      simulation.releaseDeathMark(aura);
    },
  }),
  deadlyPoison: defineAura({
    id: "deadly-poison",
    name: "Deadly Poison",
    target: "target",
    duration: k("poison.deadly").duration,
    maxStacks: k("poison.deadly").stacks,
  }),
  // "Ambush allowed" (#261): the self aura Ambush requires (requiresAura in
  // js/ability-data.js; the hook in js/required-auras.js). It stands in for
  // Cutthroat's proc ("your next Ambush within 10 sec to not require
  // Stealth"): one charge, used by the next Ambush that goes ahead. It is not
  // Stealth, and nothing in the sim treats it as being stealthed: it allows
  // Ambush and does nothing else. No duration: whatever applies it gives one.
  // Cutthroat's Backstab proc applies it for 10 s (#271). Registered here so rotation conditions and the
  // page's labels can name it; it has no effects, so it changes no damage.
  cutthroat: defineAura({
    id: "cutthroat",
    name: "Ambush allowed",
    charges: k("cutthroat.aura").charges,
  }),
  // Thousand Cuts (#269, A13): each Rupture tick adds a stack (up to 5) and
  // refreshes the 10 s; each stack takes 3 energy off the next Hemorrhage or
  // Backstab, which uses them all (its one charge, hit or miss:
  // Simulation.consumeCostCharges). energyCost never goes below 0.
  thousandCuts: defineAura({
    id: "thousand-cuts",
    name: "Thousand Cuts",
    duration: k("thousandCuts").duration,
    maxStacks: k("thousandCuts").maxStacks,
    stackRule: "add",
    refresh: "refresh",
    charges: 1,
    modifiers: [
      {
        kind: "energyCost",
        op: "add",
        value: -k("thousandCuts").energyPerStack,
        scope: { abilities: ["hemorrhage", "backstab"] },
      },
    ],
  }),
});

// Every definition keyed by id, in the order above.
export function auraRegistry() {
  return new Map(Object.values(AURAS).map((aura) => [aura.id, aura]));
}
