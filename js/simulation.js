import { k } from "../data/constants.js";
import {
  resolveAttack,
  resolveSpellHit,
  rollCrit,
  suppressCrit,
} from "./attack-resolver.js";
import { EFFECT_KINDS, auraRegistry } from "./auras.js";
import { ModifierPipeline, isNeutral, scopeMatches } from "./modifiers.js";
import { damageTags } from "./damage-tags.js";
import { ProcRunner } from "./procs.js";
import { createRng, normalizeSeed } from "./rng.js";

// Auras already running lose this step. One applied during rotation is not
// in the map yet, so it keeps the duration it was given. Returns the auras
// still up and, in the order they were applied, the ones that ran out.
function tickAuras(auras, dt) {
  const kept = {};
  const expired = [];
  for (const [id, aura] of Object.entries(auras)) {
    aura.duration -= dt;
    if (aura.duration > k("sim.tickEpsilon")) {
      kept[id] = aura;
    } else {
      expired.push([id, aura]);
    }
  }
  return { kept, expired };
}

// Bleeds (physical periodic damage) and nature damage ignore armor. Other
// damage uses armor.mitigation. The event's tags say which it is
// (js/damage-tags.js: the bleed tag, the nature school), so a direct hit and a
// tick follow the same rule. Spell resistance is not applied.
function skipsArmor(context) {
  if (context.tags.includes("bleed") && k("bleed.ignoresArmor")) {
    return true;
  }
  return context.school === "nature" && k("nature.ignoresArmor");
}

// The counter that an attack outcome adds to, in the per-ability record.
// "cast" has none: a non-attack cast only counts as a cast.
const OUTCOME_COUNTERS = {
  hit: "hits",
  crit: "crits",
  glancing: "glances",
  miss: "misses",
  dodge: "dodges",
  parry: "parries",
  block: "blocks",
};

function newAbilityRecord() {
  return {
    damage: 0,
    casts: 0,
    hits: 0,
    crits: 0,
    glances: 0,
    misses: 0,
    dodges: 0,
    parries: 0,
    blocks: 0,
    ticks: 0,
    tickCrits: 0,
  };
}

const NO_MODIFIERS = Object.freeze([]);

export class Simulation {
  // The simulation owns the one rng. Pass a seed for a repeatable fight, or an
  // rng function (returns [0, 1)) to script the rolls. Without either it uses
  // rng.defaultSeed. The rogue draws from the same rng.
  constructor(rogue, { seed = k("rng.defaultSeed"), rng } = {}) {
    this.rogue = rogue;
    this.seed = normalizeSeed(seed);
    this.rng = rng ?? createRng(this.seed);
    // The modifier pipeline (js/modifiers.js) belongs to the rogue, which
    // holds the static modifiers (talents). The fight attaches itself as the
    // provider of the timed ones (the auras that are up). A rogue without a
    // pipeline gets an empty one. A pipeline serves one fight: a second
    // Simulation on the same rogue throws here, before it touches the rogue.
    this.modifiers = rogue.modifiers ?? new ModifierPipeline();
    this.modifiers.attach(this);
    rogue.rng = this.rng;
    this.currentTime = 0;
    this.damageDone = 0;
    this.gcd = 0; // Global Cooldown
    this.gcdDuration = k("gcd.duration");
    this.combatLog = [];
    this.nextCombatEventId = 0;
    // Per-ability totals for the whole fight, keyed by ability id. Unlike
    // combatLog it is never capped. See recordAbility. abilityNames holds the
    // display name of each id, for abilityBreakdown and nothing else.
    this.abilityStats = {};
    this.abilityNames = {};
    // Every map below is keyed by id: the ability catalogue's id (js/abilities.js).
    this.cooldowns = {}; // Seconds left on each skill's cooldown
    this.activeBuffs = {}; // Self auras: Slice and Dice, Adrenaline Rush, Blade Flurry, Ghostly Strike
    this.activeDebuffs = {}; // Target auras: the Rupture marker, Hemorrhage
    this.activeDots = {}; // Track active damage over time effects
    // The definition of every aura this fight knows (js/auras.js), by id.
    this.auraDefinitions = auraRegistry();
    // The auras that carry modifiers, by kind. Built on first use and again
    // when a new aura definition is registered.
    this.auraModifierIndex = null;
    // The procs the rogue was given (js/procs.js), with their cooldowns and
    // counts. Empty unless the host listed some.
    this.procs = new ProcRunner(this, rogue.procs ?? []);
  }

  // Advance the fight by dt seconds. The engine reads no clock: the host
  // (js/main.js live, a test or a batch runner headless) decides the step.
  step(dt) {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError(
        `Simulation.step needs a finite time step in seconds, 0 or more. Got ${dt}.`,
      );
    }
    this.currentTime += dt;

    // This step covers the interval that just ended. Read the auras before
    // their countdown so the part of the step still inside an
    // energyRegen aura (Adrenaline Rush) regenerates at the bonus rate,
    // including the step it runs out.
    this.regenerateResources(dt);

    // Timers already running lose this step. A buff, debuff, or cooldown
    // applied during rotation keeps its full duration until the next one.
    const buffs = tickAuras(this.activeBuffs, dt);
    const debuffs = tickAuras(this.activeDebuffs, dt);
    this.activeBuffs = buffs.kept;
    this.activeDebuffs = debuffs.kept;
    // Expiry hooks run once both maps are settled, so a hook sees the fight
    // as it is after this step's countdown.
    for (const [id, aura] of [...buffs.expired, ...debuffs.expired]) {
      this.auraDefinitions.get(id)?.onExpire?.(this, aura);
    }
    this.cooldowns = Object.fromEntries(
      Object.entries(this.cooldowns).map(([key, value]) => {
        const remaining = value - dt;
        return [key, remaining <= k("sim.tickEpsilon") ? 0 : remaining];
      }),
    );

    this.tickGcd(dt);

    // Handle existing DoTs before rotation so newly cast DoTs start ticking next update.
    for (const [dotId, dot] of Object.entries(this.activeDots)) {
      const elapsed = Math.min(dt, dot.duration);
      dot.duration -= dt;
      dot.timeUntilNextTick -= elapsed;

      const dotContext = this.abilityContext(dotId, dot);
      while (dot.timeUntilNextTick <= k("sim.tickEpsilon")) {
        let dotTickDamage = dot.tickDamage;

        // An aura on the target can raise the damage the DoT takes
        // (hemorrhage.ruptureBonus.bonus: Rupture ticks only).
        for (const { value, stacks } of this.auraEffects("dotDamageTaken")) {
          if (value.ids.includes(dotId)) {
            dotTickDamage *= 1 + value.bonus * stacks;
          }
        }

        let dotHitCrit = "Hit";
        // roll crit for each tick
        const tickCritChance = this.rogue.getCritChance(dotContext);
        if (
          k("dot.canCrit") &&
          rollCrit(
            k("dot.critSuppression")
              ? suppressCrit(tickCritChance)
              : tickCritChance,
            this.rng,
          )
        ) {
          dotTickDamage *= this.modifiers.resolve(
            "critDamage",
            k("dot.critMultiplier"),
            dotContext,
          );
          dotHitCrit = "Crit";
        }
        dotTickDamage = this.applyArmor(
          dotTickDamage,
          skipsArmor(dotContext),
          dotContext,
        );
        this.updateDamage(dotTickDamage);
        const dotSource = { id: dotId, name: dot.name ?? dotId };
        this.recordAbility(
          dotSource,
          dotHitCrit === "Crit" ? "crit" : "hit",
          dotTickDamage,
          { tick: true },
        );
        this.addCombatEvent(
          dotSource.name,
          "skill",
          dotTickDamage,
          dotHitCrit,
          dotHitCrit,
          dot.icon,
        );
        dot.timeUntilNextTick += dot.tickInterval;
        this.procs.onDotTick(dotContext);
      }

      if (dot.duration <= k("sim.tickEpsilon")) {
        delete this.activeDots[dotId];
      }
    }

    // Points already counting down lose this step (Premeditation). A cast
    // during rotation keeps the full premeditation.cpExpiry until the next one.
    this.rogue.tickResources(dt);

    this.rogue.rotation(this, dt);
  }

  // Run the fight for `duration` seconds in fixed steps of k("sim.fixedStep"),
  // then one shorter step for what is left, so the fight ends exactly
  // `duration` after it started. This is the headless entry point: the same
  // seed and the same calls give the same fight. A split that lands on a step
  // boundary gives the same fight as one long call. A split inside a step
  // does not, because the short step at the end of the call is a step of its
  // own.
  run(duration) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError(
        `Simulation.run needs a finite duration in seconds, 0 or more. Got ${duration}.`,
      );
    }
    const stepSize = k("sim.fixedStep");
    // The step is a power of two, so this division is exact and `leftover`
    // is the exact remainder, never a rounding artefact.
    const wholeSteps = Math.floor(duration / stepSize);
    for (let index = 0; index < wholeSteps; index++) {
      this.step(stepSize);
    }
    const leftover = duration - wholeSteps * stepSize;
    if (leftover > 0) {
      this.step(leftover);
    }
  }

  // Regenerate every resource that has a regen rule (energy) over a step of dt
  // seconds. The base rate holds for the part of the step no timed modifier of
  // the rule's kind covers. Each such modifier (Adrenaline Rush's) changes the
  // rate for the part of the step its aura was still up, so the pieces are cut
  // where an aura runs out. One aura gives two pieces: the base rate, then the
  // boosted rate. Static modifiers (a talent) apply to every piece. The rate is
  // combined through the pipeline, so a flat bonus and a multiplier stack as
  // modifiers.stacking says.
  regenerateResources(dt) {
    const { resources } = this.rogue;
    for (const id in resources) {
      if (resources[id].definition.regen !== undefined) {
        this.regenerateResource(resources[id], dt);
      }
    }
  }

  regenerateResource(pool, dt) {
    const { perSecond, modifier } = pool.definition.regen;
    const base = k(perSecond);
    const all = this.modifiers.contributions(modifier);
    if (all.length === 0) {
      pool.regenerate(dt, base);
      return;
    }
    const applied = all.filter(({ duration }) => duration === Infinity);
    const timed = all
      .filter(({ duration }) => duration !== Infinity)
      .map((contribution) => ({
        contribution,
        covered: Math.min(dt, contribution.duration),
      }))
      .sort((a, b) => b.covered - a.covered);
    let rate = this.modifiers.combine(modifier, base, applied);
    let remaining = dt;
    for (const { contribution, covered } of timed) {
      pool.regenerate(remaining - covered, rate);
      remaining = covered;
      applied.push(contribution);
      rate = this.modifiers.combine(modifier, base, applied);
    }
    pool.regenerate(remaining, rate);
  }

  // Put an aura up. `duration` (seconds) defaults to the definition's; a
  // second application follows the definition's refresh rule and its stack
  // rule (up to maxStacks), and restores the charges. The aura goes in
  // activeBuffs (target "self") or activeDebuffs (target "target"), keyed by id. Returns the aura record:
  // { id, name, icon, duration, stacks, charges }, with charges null when the
  // definition has none.
  applyAura(definition, { duration, stacks = 1, icon } = {}) {
    // NaN would reach the stack maths (armorMultiplier, haste) and spread.
    if (!Number.isInteger(stacks) || stacks < 1) {
      throw new RangeError(
        `Simulation.applyAura needs a whole number of stacks, 1 or more, for "${definition.id}". Got ${stacks}.`,
      );
    }
    const length = duration ?? definition.duration;
    if (!Number.isFinite(length) || length <= 0) {
      throw new RangeError(
        `Simulation.applyAura needs a duration above 0 for "${definition.id}". Got ${length}.`,
      );
    }
    // The first definition of an id is the one the fight uses for its
    // effects. A different definition under a known id is a mistake, not a
    // replacement, so it fails here and not as a silent change of effects.
    const known = this.auraDefinitions.get(definition.id);
    if (known === undefined) {
      this.auraDefinitions.set(definition.id, definition);
      this.auraModifierIndex = null;
    } else if (known !== definition) {
      throw new Error(
        `Simulation.applyAura got a second definition for the aura "${definition.id}".`,
      );
    }
    const auras =
      definition.target === "target" ? this.activeDebuffs : this.activeBuffs;
    const current = Object.hasOwn(auras, definition.id)
      ? auras[definition.id]
      : undefined;
    if (current === undefined) {
      auras[definition.id] = {
        id: definition.id,
        name: definition.name,
        icon: icon ?? definition.icon,
        duration: length,
        stacks: Math.min(stacks, definition.maxStacks),
        charges: definition.charges,
      };
      definition.onApply?.(this, auras[definition.id], { refreshed: false });
      return auras[definition.id];
    }
    if (definition.refresh === "extend") {
      current.duration += length;
    } else if (definition.refresh === "replace-if-longer") {
      current.duration = Math.max(current.duration, length);
    } else {
      current.duration = length;
    }
    const wanted =
      definition.stackRule === "highest"
        ? Math.max(current.stacks ?? 1, stacks)
        : (current.stacks ?? 1) + stacks;
    current.stacks = Math.min(wanted, definition.maxStacks);
    // Every application restores the charges.
    current.charges = definition.charges;
    definition.onApply?.(this, current, { refreshed: true });
    return current;
  }

  // The share of a physical hit that armor lets through. The target's armor
  // is target.armor less any armorReduction aura on it (Expose Armor), and
  // never below 0. Then any armorIgnore modifier for this attack's context
  // takes that fraction of what is left (Serrated Blades, Hack and Slash with a
  // mace). Spell resistance is not applied.
  armorMultiplier(context) {
    let reduction = 0;
    for (const { value, stacks } of this.auraEffects("armorReduction")) {
      reduction += value * stacks;
    }
    let armor = Math.max(0, k("target.armor") - reduction);
    const ignored = this.modifiers.resolve("armorIgnore", 0, context);
    if (ignored > 0) {
      armor *= 1 - Math.min(ignored, 1);
    }
    const mitigation = k("armor.mitigation");
    const denominator =
      armor + mitigation.constant + mitigation.perLevel * k("character.level");
    if (denominator <= 0) {
      return 1;
    }
    let share = armor / denominator;
    if (share > mitigation.cap) {
      share = mitigation.cap;
    }
    if (share < 0) {
      share = 0;
    }
    return 1 - share;
  }

  applyArmor(damage, skipArmor, context) {
    if (skipArmor) {
      return damage;
    }
    return damage * this.armorMultiplier(context);
  }

  // Use up `count` charges of an aura (by id), as a landed hit does. The aura
  // ends when none are left, the same as running out of time: it is removed
  // and its onExpire hook runs. Returns the charges left, or null when the
  // aura is not up or has no charges.
  consumeCharge(id, count = 1) {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError(
        `Simulation.consumeCharge needs a whole number of charges, 1 or more. Got ${count}.`,
      );
    }
    const definition = this.auraDefinitions.get(id);
    const auras =
      definition?.target === "target" ? this.activeDebuffs : this.activeBuffs;
    // Own properties only: an inherited name ("toString") is not an aura.
    const aura = Object.hasOwn(auras, id) ? auras[id] : undefined;
    if (
      definition === undefined ||
      aura === undefined ||
      aura.duration <= 0 ||
      typeof aura.charges !== "number"
    ) {
      return null;
    }
    aura.charges = Math.max(0, aura.charges - count);
    if (aura.charges === 0) {
      delete auras[id];
      definition.onExpire?.(this, aura);
    }
    return aura.charges;
  }

  // A landed hit on the target uses one charge of every charged aura on it.
  consumeHitCharges() {
    for (const [id, aura] of Object.entries(this.activeDebuffs)) {
      if (typeof aura.charges === "number") {
        this.consumeCharge(id);
      }
    }
  }

  // A landed attack uses one charge of every charged self aura that had a say
  // in it: one whose modifiers' scope matches the attack (an unscoped modifier
  // matches every attack). Cold Blood's crit is "the next" Eviscerate, not the
  // next swing, so a white swing leaves it up. The charge goes on a landed
  // attack that reached the crit roll: a miss, dodge, parry or block keeps it
  // for the next try. Nothing here names an aura.
  consumeUseCharges(context) {
    for (const id of Object.keys(this.activeBuffs)) {
      const definition = this.auraDefinitions.get(id);
      if (
        definition?.modifiers.some((modifier) =>
          scopeMatches(modifier.scope, context),
        )
      ) {
        this.consumeCharge(id);
      }
    }
  }

  // The effects of one kind (haste, energyRegenMultiplier, dotDamageTaken,
  // armorReduction)
  // from every aura that is up, as { id, value, stacks, duration }, in the
  // order the definitions were registered. An aura is up while it has time
  // left. The engine asks by kind, so it names no aura.
  auraEffects(kind) {
    // A kind nobody defines would give [] for ever, so a typo in an engine
    // call fails here and not as a missing bonus.
    if (!EFFECT_KINDS.includes(kind)) {
      throw new RangeError(
        `Simulation.auraEffects: unknown effect kind "${kind}". Known: ${EFFECT_KINDS.join(", ")}.`,
      );
    }
    const found = [];
    for (const definition of this.auraDefinitions.values()) {
      if (!Object.hasOwn(definition.effects, kind)) {
        continue;
      }
      const value = definition.effects[kind];
      const auras =
        definition.target === "target" ? this.activeDebuffs : this.activeBuffs;
      const aura = Object.hasOwn(auras, definition.id)
        ? auras[definition.id]
        : undefined;
      if (aura !== undefined && aura.duration > 0) {
        found.push({
          id: definition.id,
          value,
          stacks: aura.stacks ?? 1,
          duration: aura.duration,
        });
      }
    }
    return found;
  }

  // The modifiers the auras that are up give for one kind, as the pipeline's
  // contributions { modifier, stacks, duration, source }, in registry order.
  // Each aura counts once per modifier, scaled by its stacks (add: value ×
  // stacks, mult: value ** stacks, haste: once per stack). An aura is up while
  // it has time left.
  auraModifiers(kind) {
    if (this.auraModifierIndex === null) {
      this.auraModifierIndex = new Map();
      for (const definition of this.auraDefinitions.values()) {
        for (const modifier of definition.modifiers) {
          if (isNeutral(modifier)) {
            continue;
          }
          const list = this.auraModifierIndex.get(modifier.kind) ?? [];
          list.push({ definition, modifier });
          this.auraModifierIndex.set(modifier.kind, list);
        }
      }
    }
    const entries = this.auraModifierIndex.get(kind);
    if (entries === undefined) {
      return NO_MODIFIERS;
    }
    let found = NO_MODIFIERS;
    for (const { definition, modifier } of entries) {
      const auras =
        definition.target === "target" ? this.activeDebuffs : this.activeBuffs;
      const aura = Object.hasOwn(auras, definition.id)
        ? auras[definition.id]
        : undefined;
      if (aura !== undefined && aura.duration > 0) {
        if (found === NO_MODIFIERS) {
          found = [];
        }
        found.push({
          modifier,
          stacks: aura.stacks ?? 1,
          duration: aura.duration,
          source: definition.id,
        });
      }
    }
    return found;
  }

  // What the modifier scopes see of an attack:
  // { ability, hand, weaponType, school, tags }. A source names its hand (a
  // weapon's swing does; a skill is main hand). The school and tags come from
  // js/damage-tags.js: the id picks the school, finisher, bleed and poison,
  // and the attack type picks white ("weapon") or yellow ("skill"). A source
  // may say `bleed: true`. The result is built fresh for each attack.
  attackContext(source, attackType = "skill") {
    const hand = source.hand ?? "mainHand";
    const { school, tags } = damageTags({
      id: source.id,
      attackType,
      bleed: source.bleed === true,
    });
    return {
      ability: source.id,
      hand,
      weaponType: this.rogue.weapons?.[hand]?.type ?? null,
      school,
      tags,
    };
  }

  // The context of an ability by id, for what has no source object to hand
  // (a DoT tick): the ability's own main-hand attack, with the attack type and
  // bleed flag the DoT was applied with.
  abilityContext(id, options = {}) {
    if (options === null || typeof options !== "object") {
      throw new RangeError(
        `abilityContext options must be an object { attackType, bleed }, not ${options === null ? "null" : typeof options}.`,
      );
    }
    const { attackType, bleed } = options;
    return this.attackContext({ id, bleed }, attackType);
  }

  // Whether the aura is up, by id.
  hasAura(id) {
    const definition = this.auraDefinitions.get(id);
    const auras =
      definition?.target === "target" ? this.activeDebuffs : this.activeBuffs;
    const aura = Object.hasOwn(auras, id) ? auras[id] : undefined;
    return (aura?.duration ?? 0) > 0;
  }

  // The per-ability totals by display name: the shape runFight returns. The
  // engine keys them by id; the name is only the label of the result.
  abilityBreakdown() {
    const breakdown = {};
    for (const [id, record] of Object.entries(this.abilityStats)) {
      const name = this.abilityNames[id] ?? id;
      if (name in breakdown) {
        throw new Error(
          `Two abilities share the display name "${name}", so the breakdown cannot key them by name.`,
        );
      }
      breakdown[name] = { ...record };
    }
    return breakdown;
  }

  setGcd() {
    this.gcd = this.gcdDuration;
  }

  tickGcd(dt) {
    if (this.gcd > 0) {
      this.gcd = Math.max(0, this.gcd - dt);
    }
  }

  updateDamage(d) {
    this.damageDone += d;
  }

  // `source` is who made the attack: { id, name, icon? }. A skill is one, and
  // so is a weapon's swing (Weapon.attack). The id keys the totals, the name
  // and icon go in the combat log. A white swing then fires its procs
  // (js/procs.js); a skill's fire at the end of its cast. `extra` marks a swing
  // an extra attack made (it is recorded under the hand like any swing).
  resolveAttack(source, attackType, baseDamage, { extra = false } = {}) {
    const context = this.attackContext(source, attackType);
    const result = resolveAttack({
      attackType,
      baseDamage: this.modifiers.resolve("damage", baseDamage, context),
      bonusHitChance: this.rogue.getBonusHitChance(context),
      critChance: this.rogue.getCritChance(context),
      critMultiplier: this.modifiers.resolve(
        "critDamage",
        k("crit.meleeMultiplier"),
        context,
      ),
      dodgeReduction: this.modifiers.resolve("dodgeReduction", 0, context),
      parryReduction: this.modifiers.resolve("parryReduction", 0, context),
      behind: this.rogue.config.target.behind,
      rng: this.rng,
    });
    const damage = this.applyArmor(result.damage, skipsArmor(context), context);
    if (result.landed && damage > 0) {
      this.updateDamage(damage);
    }
    this.recordAbility(source, result.outcome, result.landed ? damage : 0);
    this.addCombatEvent(
      source.name,
      attackType,
      damage,
      result.status,
      result.outcome,
      source.icon ?? null,
    );
    if (result.landed) {
      // After armor, so the hit that uses the last charge still gets it.
      this.consumeHitCharges();
      // A block is a landed hit that never reaches the crit roll, so it does
      // not use up the charge of an aura that asked for one (Cold Blood).
      if (result.outcome !== "block") {
        this.consumeUseCharges(context);
      }
    }
    const resolved = { ...result, damage };
    if (attackType === "weapon") {
      this.procs.onSwing(source, resolved, extra);
    }
    return resolved;
  }

  // Damage a proc deals from a source of its own (js/procs.js, dealDamage).
  // `spell.missTarget` applies when it is a spell hit, with one draw, before
  // the damage. Then the damage roll, one draw, when min and max differ. The
  // damage modifiers, armor, the fight totals and the log work as for an
  // attack. It does not crit and it fires no procs.
  resolveProcDamage({ id, name, min, max, spellHit }) {
    const source = { id, name, icon: null };
    const context = this.attackContext(source, "skill");
    let hit = { outcome: "hit", status: "Hit", landed: true };
    if (spellHit) {
      hit = resolveSpellHit({ rng: this.rng });
    }
    let damage = 0;
    if (hit.landed) {
      const rolled =
        max === min ? min : Math.floor(this.rng() * (max - min + 1)) + min;
      damage = this.applyArmor(
        this.modifiers.resolve("damage", rolled, context),
        skipsArmor(context),
        context,
      );
      this.updateDamage(damage);
    }
    this.recordAbility(source, hit.outcome, damage);
    this.addCombatEvent(name, "skill", damage, hit.status, hit.outcome);
    return { ...hit, damage };
  }

  resolveDotAttack(source, attackType, baseDamage, duration, bleed = false) {
    const context = this.attackContext(
      bleed ? { ...source, bleed: true } : source,
      attackType,
    );
    const result = resolveAttack({
      attackType,
      // The damage modifiers apply to the whole DoT when it is cast, the same
      // moment attack power is read (dot.snapshot).
      baseDamage: this.modifiers.resolve("damage", baseDamage, context),
      bonusHitChance: this.rogue.getBonusHitChance(context),
      // The application roll does not crit. Ticks read getCritChance().
      // tickDamage stays before armor; the tick loop applies it.
      critChance: 0,
      canCrit: false,
      dodgeReduction: this.modifiers.resolve("dodgeReduction", 0, context),
      parryReduction: this.modifiers.resolve("parryReduction", 0, context),
      behind: this.rogue.config.target.behind,
      rng: this.rng,
    });
    const tickInterval = k("rupture.tickInterval");
    const tickCount = Math.floor(duration / tickInterval);
    if (result.landed && result.damage > 0 && tickCount > 0) {
      this.activeDots[source.id] = {
        name: source.name,
        duration,
        tickInterval,
        timeUntilNextTick: tickInterval,
        tickDamage: result.damage / tickCount,
        icon: source.icon ?? null,
        // What the ticks need to build the same context as the application.
        attackType,
        bleed: context.tags.includes("bleed"),
      };
    }
    // The application deals no damage; the ticks do.
    this.recordAbility(source, result.outcome, 0);
    this.addCombatEvent(
      source.name,
      attackType,
      0,
      result.status,
      result.outcome,
      source.icon ?? null,
    );
    return result;
  }

  // Add one outcome to the ability's fight totals, under source.id. An attack, a DoT
  // application, or a non-attack cast ("cast") counts as one cast and adds its
  // outcome (hit, crit, glancing, miss, dodge, parry or block) to the matching
  // counter, so those counters add up to casts. A DoT tick is not a cast: it
  // counts under ticks (and tickCrits) instead. damage is what the outcome
  // dealt after armor, so the abilities' damage adds up to damageDone.
  recordAbility(source, outcome, damage = 0, { tick = false } = {}) {
    this.abilityStats[source.id] ??= newAbilityRecord();
    this.abilityNames[source.id] = source.name;
    const record = this.abilityStats[source.id];
    record.damage += damage;
    if (tick) {
      record.ticks += 1;
      if (outcome === "crit") {
        record.tickCrits += 1;
      }
      return;
    }
    record.casts += 1;
    const counter = OUTCOME_COUNTERS[outcome];
    if (counter) {
      record[counter] += 1;
    }
  }

  addCombatEvent(
    name,
    type,
    damage,
    status = "Hit",
    outcome = "hit",
    icon = null,
  ) {
    this.combatLog.unshift({
      id: this.nextCombatEventId++,
      time: this.currentTime,
      name,
      type,
      damage,
      status,
      outcome,
      icon,
    });
    if (this.combatLog.length > k("log.maxEvents")) {
      this.combatLog.pop();
    }
  }
}
