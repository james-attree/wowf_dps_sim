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
import { EventStream, RingLog, SIM_EVENT_TYPES } from "./event-stream.js";
import { DOT_REFRESH } from "./core/dots.js";
import { ENGINES, runOnCore } from "./core/fight.js";
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

// A fight length for the rotation: none (undefined or null) is null, which
// fightTimeRemaining reads as Infinity; anything else is a finite number of
// seconds, 0 or more, as Simulation.run checks its duration.
function readFightLength(fightLength) {
  if (fightLength === undefined || fightLength === null) {
    return null;
  }
  if (!Number.isFinite(fightLength) || fightLength < 0) {
    throw new RangeError(
      `A fight length (createFight's options.duration) must be a finite number of seconds, 0 or more, or none. Got ${fightLength}.`,
    );
  }
  return fightLength;
}

// The engine a Simulation runs on when its constructor is not told: legacy
// (fixed steps) unless a caller changed it with Simulation.useEngine.
let defaultEngine = ENGINES.legacy;

function readEngine(engine) {
  if (!Object.values(ENGINES).includes(engine)) {
    throw new RangeError(
      `Unknown engine ${JSON.stringify(engine)}. Known: ${Object.values(ENGINES).join(", ")}.`,
    );
  }
  return engine;
}

export class Simulation {
  // Set the engine every Simulation built after this runs on, when its own
  // options do not say, and return the one it replaces. For tests that run a
  // whole test file on the event core (#197, test/core-engine-files.test.js);
  // an app or a batch run passes its engine to the constructor instead.
  static useEngine(engine) {
    const previous = defaultEngine;
    defaultEngine = readEngine(engine);
    return previous;
  }

  // The simulation owns the one rng. Pass a seed for a repeatable fight, or an
  // rng function (returns [0, 1)) to script the rolls. Without either it uses
  // rng.defaultSeed. The rogue draws from the same rng.
  //
  // `fightLength` is the fight's length in seconds as the rotation is told it
  // (fightTimeRemaining, #191), or none (null). It is the rotation's only: it
  // does not decide how long the fight runs, which is run(duration)'s
  // argument, so the host that runs the fight passes the same number to both
  // (createFight's options.duration; runFight and SimRunner do).
  //
  // `engine` is how run() moves the fight on (ENGINES in js/core/fight.js):
  // "legacy", fixed steps of k("sim.fixedStep") (the default), or "events",
  // the Phase 3.5 event core (#197), which jumps from event to event and runs
  // the rotation only at its decision points. step() is always a fixed step.
  constructor(
    rogue,
    {
      seed = k("rng.defaultSeed"),
      rng,
      fightLength,
      engine = defaultEngine,
    } = {},
  ) {
    this.rogue = rogue;
    this.engine = readEngine(engine);
    // The event core while it runs this fight (js/core/fight.js), told where
    // a DoT starts; null on the legacy engine.
    this.core = null;
    // What the last event core run on this fight left for the next one to go
    // on from exactly (js/core/fight.js carry()); null on the legacy engine.
    this.coreCarry = null;
    this.fightLength = readFightLength(fightLength);
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
    // The event stream (js/event-stream.js, docs/events.md). Everything the
    // fight reports goes through it, and so does the combat log: a ring of the
    // newest k("log.maxEvents") rows, fed by the "hit" events. It subscribes
    // first, so a handler that reads the log sees the row of the hit it was
    // told about.
    this.events = new EventStream({ types: SIM_EVENT_TYPES });
    this.log = new RingLog(k("log.maxEvents"));
    this.events.on("hit", (event) => {
      this.log.push({
        id: event.id,
        time: event.time,
        name: event.name,
        type: event.attack,
        damage: event.damage,
        status: event.status,
        // The log has always shown a DoT tick's outcome as its status.
        outcome: event.origin === "dot" ? event.status : event.outcome,
        icon: event.icon,
      });
    });
    this.nextCombatEventId = 0;
    this.ended = false;
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
    // The pools tell the fight when they move (Resource.onChange); it tells
    // the stream, when anyone listens.
    for (const pool of Object.values(rogue.resources ?? {})) {
      pool.onChange = (change, before, source) => {
        this.emitResource(pool, change, before, source);
      };
    }
  }

  // Subscribe handler(event, type) to one event type (SIM_EVENT_TYPES), or to
  // all of them with "*". Returns the unsubscribe function. See
  // js/event-stream.js for the delivery rules and docs/events.md for events.
  on(type, handler) {
    return this.events.on(type, handler);
  }

  // Subscribe to the errors that handlers throw: handler({ error, type, event }).
  onError(handler) {
    return this.events.onError(handler);
  }

  // The combat log, newest first, as a new array of the rows. The rows are
  // the same objects each call. Holds at most k("log.maxEvents") of them.
  get combatLog() {
    return this.log.toArray();
  }

  // Build an event (frozen, plain data, stamped with the fight time) and
  // deliver it. The callers ask events.has(type) first, so a fight nobody
  // listens to builds none of them.
  publish(type, fields) {
    this.events.emit(
      type,
      Object.freeze({ type, time: this.currentTime, ...fields }),
    );
  }

  emitCast(ability, cost) {
    if (this.events.has("cast")) {
      this.publish("cast", {
        ability: ability.id,
        name: ability.name,
        icon: ability.icon ?? null,
        resource: ability.costResource,
        cost,
        onGcd: ability.triggersGcd,
      });
    }
  }

  emitResource(pool, change, before, source) {
    if (this.events.has("resource")) {
      this.publish("resource", {
        resource: pool.id,
        change,
        before,
        after: pool.value,
        source,
      });
    }
  }

  emitProc(proc, event) {
    if (this.events.has("proc")) {
      this.publish("proc", {
        proc: proc.id,
        trigger: proc.trigger,
        ability: event.context.ability,
      });
    }
  }

  emitAura(definition, aura, change, { source = null, reason = null } = {}) {
    if (this.events.has("aura")) {
      this.publish("aura", {
        aura: definition.id,
        name: aura.name,
        target: definition.target === "target" ? "target" : "self",
        change,
        stacks: aura.stacks ?? 1,
        duration: aura.duration,
        charges: aura.charges ?? null,
        source,
        reason,
      });
    }
  }

  // The fight is over: tell the stream once, with the summary. The host that
  // ran the fight calls this (runFight and SimRunner do). A second call does
  // nothing.
  end() {
    if (this.ended) {
      return;
    }
    this.ended = true;
    if (this.events.has("end")) {
      this.publish("end", {
        totalDamage: this.damageDone,
        dps: this.currentTime > 0 ? this.damageDone / this.currentTime : 0,
        resources: this.resourceWaste(),
      });
    }
  }

  // What each resource lost to its cap over the fight (#146), by id:
  // { energy: { cappedTime, overflow }, comboPoints: { ... } }, frozen, for the
  // end event. See Resource#cappedTime and #overflow.
  resourceWaste() {
    const waste = {};
    for (const [id, pool] of Object.entries(this.rogue.resources ?? {})) {
      waste[id] = Object.freeze(pool.waste());
    }
    return Object.freeze(waste);
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
      const definition = this.auraDefinitions.get(id);
      if (definition !== undefined) {
        this.emitAura(definition, aura, "expire", { reason: "time" });
      }
      definition?.onExpire?.(this, aura);
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

      // A tick interval of 0 or less would tick forever at this time (#193).
      // NaN and Infinity are refused too: they would never tick, silently.
      if (!(dot.tickInterval > 0 && dot.tickInterval < Infinity)) {
        throw new RangeError(
          `DoT "${dotId}" has tick interval ${dot.tickInterval}; it must be a finite number of seconds above 0.`,
        );
      }
      const dotContext = this.abilityContext(dotId, dot);
      while (dot.timeUntilNextTick <= k("sim.tickEpsilon")) {
        this.resolveDotTick(dotId, dot, dotContext);
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

  // One tick of the DoT `dot` (an activeDots entry) under `dotId`: an aura on
  // the target that raises the DoT's damage (Hemorrhage on Rupture), the
  // per-tick crit roll, armor (a bleed skips it), the fight totals and the
  // log. `dotContext` is abilityContext(dotId, dot). The caller moves the
  // tick clock and then fires the tick's procs (procs.onDotTick): step() does
  // for the legacy engine, the core's dot-tick handler for the new one (#196).
  resolveDotTick(dotId, dot, dotContext) {
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
      dotHitCrit === "Crit" ? "crit" : "hit",
      dot.icon,
      dotId,
      "dot",
    );
  }

  // Run the fight for `duration` seconds in fixed steps of k("sim.fixedStep"),
  // then one shorter step for what is left, so the fight ends exactly
  // `duration` after it started. This is the headless entry point: the same
  // seed and the same calls give the same fight. A split that lands on a step
  // boundary gives the same fight as one long call. A split inside a step
  // does not, because the short step at the end of the call is a step of its
  // own.
  //
  // On the "events" engine the same duration is run on the event core
  // instead (runOnCore, js/core/fight.js): the fight ends `duration` after it
  // started, and a split anywhere, on an event's time or between two, gives
  // the same fight as one long call (#198, from #197 QA M1). Each call keeps
  // the fight's clock and goes on from the exact state the last one left
  // (sim.coreCarry); only the core's counts (coreStats) see the split. A
  // host that hands the fight time in pieces can also hold one core open
  // (openCore, as SimRunner does since #198).
  run(duration) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError(
        `Simulation.run needs a finite duration in seconds, 0 or more. Got ${duration}.`,
      );
    }
    if (this.engine === ENGINES.events) {
      runOnCore(this, duration);
      this.end();
      return;
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
    this.end();
  }

  // Regenerate every resource that has a regen rule (energy) over a step of dt
  // seconds. The base rate holds for the part of the step no timed modifier of
  // the rule's kind covers. Each such modifier (Adrenaline Rush's) changes the
  // rate for the part of the step its aura was still up, so the pieces are cut
  // where an aura runs out. One aura gives two pieces, in order of time: the
  // boosted rate while the aura is up, then the base rate (#155). Static modifiers (a talent) apply to every piece. The rate is
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
    // A timed contribution (Adrenaline Rush) covers the start of the step,
    // up to the moment it runs out, so the step is regenerated in order of
    // time (#155): first with every contribution, then without each as it
    // runs out, the shortest first, and the rest at the rate the untimed ones
    // leave. Order matters to the cap: the pool reaches it at the right
    // moment, and its cappedTime counts the right part of the step. Each
    // segment combines the same contributions in the same order (untimed,
    // then timed from the longest) as before, so the rates are unchanged.
    const applied = all.filter(({ duration }) => duration === Infinity);
    const timed = all
      .filter(({ duration }) => duration !== Infinity)
      .map((contribution) => ({
        contribution,
        covered: Math.min(dt, contribution.duration),
      }))
      .sort((a, b) => b.covered - a.covered);
    let elapsed = 0;
    for (let last = timed.length - 1; last >= 0; last -= 1) {
      const { covered } = timed[last];
      const active = applied.concat(
        timed.slice(0, last + 1).map(({ contribution }) => contribution),
      );
      pool.regenerate(
        covered - elapsed,
        this.modifiers.combine(modifier, base, active),
      );
      elapsed = covered;
    }
    pool.regenerate(
      dt - elapsed,
      this.modifiers.combine(modifier, base, applied),
    );
  }

  // Put an aura up. `duration` (seconds) defaults to the definition's; a
  // second application follows the definition's refresh rule and its stack
  // rule (up to maxStacks), and restores the charges. The aura goes in
  // activeBuffs (target "self") or activeDebuffs (target "target"), keyed by id. Returns the aura record:
  // { id, name, icon, duration, stacks, charges }, with charges null when the
  // definition has none.
  applyAura(definition, { duration, stacks = 1, icon, source = null } = {}) {
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
      this.emitAura(definition, auras[definition.id], "apply", { source });
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
    const stacked =
      Math.min(wanted, definition.maxStacks) > (current.stacks ?? 1);
    current.stacks = Math.min(wanted, definition.maxStacks);
    // Every application restores the charges.
    current.charges = definition.charges;
    definition.onApply?.(this, current, { refreshed: true });
    this.emitAura(definition, current, stacked ? "stack" : "refresh", {
      source,
    });
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
      this.emitAura(definition, aura, "expire", { reason: "charges" });
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
  // for the next try. That is our design choice, not verified against Classic,
  // and not what wowsims does (it drops the aura after the next flagged spell
  // whatever its outcome). Nothing here names an aura.
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
      source.id,
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
  // the damage. Then the damage roll, one draw, when min and max differ. Then,
  // when the action `canCrit` and the hit landed, one crit draw (Instant
  // Poison): the melee crit chance, less the crit suppression when
  // poison.instantCritSuppression says so, and the damage times
  // poison.instantCrit through the critDamage modifiers. A resist draws no
  // crit. The damage modifiers, armor, the fight totals and the log work as for
  // an attack. It fires no procs.
  resolveProcDamage({ id, name, icon = null, min, max, spellHit, canCrit }) {
    const source = { id, name, icon };
    const context = this.attackContext(source, "skill");
    let hit = { outcome: "hit", status: "Hit", landed: true };
    if (spellHit) {
      hit = resolveSpellHit({ rng: this.rng });
    }
    let damage = 0;
    let outcome = hit.outcome;
    let status = hit.status;
    if (hit.landed) {
      const rolled =
        max === min ? min : Math.floor(this.rng() * (max - min + 1)) + min;
      let modified = this.modifiers.resolve("damage", rolled, context);
      if (canCrit) {
        const critChance = this.rogue.getCritChance(context);
        if (
          rollCrit(
            k("poison.instantCritSuppression")
              ? suppressCrit(critChance)
              : critChance,
            this.rng,
          )
        ) {
          modified *= this.modifiers.resolve(
            "critDamage",
            k("poison.instantCrit"),
            context,
          );
          outcome = "crit";
          status = "Crit";
        }
      }
      damage = this.applyArmor(modified, skipsArmor(context), context);
      this.updateDamage(damage);
    }
    this.recordAbility(source, outcome, damage);
    this.addCombatEvent(
      name,
      "skill",
      damage,
      status,
      outcome,
      icon,
      id,
      "poison",
    );
    return { ...hit, outcome, status, damage };
  }

  // A damage over time a proc applies (js/procs.js, applyDot), under a source
  // of its own: the spell hit first (one draw, when asked), then, if it
  // landed, one more stack of the action's target aura (if it names one) and
  // the DoT in activeDots under `id`, with its own tick interval. A second
  // landed application refreshes the DoT to `duration` and keeps its tick
  // clock (wowsims ApplyOrRefresh: the aura is refreshed, the ticks go on), and
  // each tick is the stacks × tickDamage. The application deals no damage and
  // is logged like a DoT cast (0 damage; Hit or Resist). The ticks are in
  // step(), or on the core's dot-tick events (js/core/dots.js, #196).
  resolveProcDot({
    id,
    name,
    icon = null,
    tickDamage,
    interval,
    duration,
    aura,
    spellHit,
  }) {
    const source = { id, name, icon };
    const context = this.attackContext(source, "skill");
    let hit = { outcome: "hit", status: "Hit", landed: true };
    if (spellHit) {
      hit = resolveSpellHit({ rng: this.rng });
    }
    if (hit.landed) {
      const stacks =
        aura === undefined
          ? 1
          : this.applyAura(this.auraDefinitions.get(aura), {
              duration,
              icon,
              source: id,
            }).stacks;
      const running = Object.hasOwn(this.activeDots, id)
        ? this.activeDots[id]
        : undefined;
      this.activeDots[id] = {
        name,
        duration,
        tickInterval: interval,
        timeUntilNextTick: running?.timeUntilNextTick ?? interval,
        tickDamage:
          this.modifiers.resolve("damage", tickDamage, context) * stacks,
        icon,
        attackType: "skill",
        bleed: false,
      };
      this.core?.dotApplied(id, DOT_REFRESH.keepClock);
    }
    this.recordAbility(source, hit.outcome, 0);
    this.addCombatEvent(
      name,
      "skill",
      0,
      hit.status,
      hit.outcome,
      icon,
      id,
      "poison",
    );
    return hit;
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
      this.core?.dotApplied(source.id, DOT_REFRESH.restart);
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
      source.id,
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

  // One result on the target: a "hit" event (docs/events.md), and through it
  // a row of the combat log. `ability` is the id of who made it, and `origin`
  // is white, yellow, poison or dot. Left out, the origin follows `type`:
  // "weapon" is white and anything else yellow.
  addCombatEvent(
    name,
    type,
    damage,
    status = "Hit",
    outcome = "hit",
    icon = null,
    ability = null,
    origin = null,
  ) {
    this.publish("hit", {
      id: this.nextCombatEventId++,
      ability,
      name,
      icon,
      origin: origin ?? (type === "weapon" ? "white" : "yellow"),
      attack: type,
      outcome,
      status,
      damage,
    });
  }
}
