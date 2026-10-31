import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { abilityCatalogue } from "./abilities.js";
import { AURAS } from "./auras.js";
import { isRequiredAura } from "./required-auras.js";
import { spellIconUrl } from "./icons.js";

// The generic ability executor (roadmap D2). An Ability is built from one
// entry of js/ability-data.js and casts it. Every ability goes through the
// same cast, so a new ability is a new entry and no new class.
//
// The executor knows no resource by name. What an ability pays, gains and
// spends is data (js/ability-data.js: cost, gain, spend, expires), each naming
// a resource by id, and the pools are the host's `resources` (js/resource.js,
// js/resource-data.js). A cost, a gain or a spend is a call on a pool, so a
// second resource needs a data row and no change here, and a proc (A4) can
// make the same calls.
//
// An ability is identified by its id, the catalogue's id for it (js/abilities.js,
// slugify(name)). Its name is read from the catalogue for display: the page,
// the combat log and the result's per-ability breakdown. Nothing compares it.

// A weapon multiplier is one number, or { dagger, other } by the main-hand
// type. Only the config's weapon type decides it.
function weaponMultiplier(value, rogue) {
  if (typeof value === "number") {
    return value;
  }
  return rogue.weapons.mainHand.type === "dagger" ? value.dagger : value.other;
}

// How each damage kind is worked out. Each gets the entry's `damage` spec, the
// row's constants, the rogue and the amount the cast spends (what the spent
// resource holds before the cast resets it), and returns the damage or, for a
// dot, the total. The weapon and finisherRoll kinds draw one number from the
// rogue's rng, and the dot kind none.
const DAMAGE = {
  weapon(spec, stats, rogue) {
    const multiplier =
      spec.multiplier === undefined
        ? 1
        : weaponMultiplier(stats[spec.multiplier], rogue);
    const bonus = spec.bonus === undefined ? 0 : stats[spec.bonus];
    return rogue.rollWeaponDamageForSkill() * multiplier + bonus;
  },

  finisherRoll(spec, stats, rogue, spent) {
    const modifier = rogue.getAttackPower() * spent * k(spec.apPerCp);
    let min = modifier;
    let max = modifier;
    const bands = stats[spec.bands];
    if (spent >= 1 && spent <= bands.length) {
      min += bands[spent - 1].min;
      max += bands[spent - 1].max;
    }
    return Math.floor(rogue.random() * (max - min + 1) + min);
  },

  dot(spec, stats, rogue, spent, durations) {
    // Totals, not per tick. The DoT applicator divides this by the tick count.
    const apBySpent = k(spec.ap);
    if (
      spent < 1 ||
      spent > stats.damageByCp.length ||
      spent > durations.length ||
      spent > apBySpent.length
    ) {
      return null;
    }
    return (
      stats.damageByCp[spent - 1] +
      rogue.getAttackPower() * apBySpent[spent - 1]
    );
  },
};

// Read once: the interpreter asks about the GCD at every decision point.
const TICK_EPSILON = k("sim.tickEpsilon");

// The GCD is clear: what is left of it is within sim.tickEpsilon. The rotation
// interpreter asks this (js/rotation-host.js) to tell "cannot cast yet, the
// GCD is running" from "cannot cast, short of the cost".
export function gcdClear(simulation) {
  return simulation.gcd <= TICK_EPSILON;
}

// An ability-data entry's requiresAura, checked: a list of one or more
// distinct self aura ids from AURAS (js/required-auras.js), or none at all.
// Returned frozen, empty for an entry without one.
function requiredAuras(definition) {
  const list = definition.requiresAura;
  if (list === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(list) || list.length === 0) {
    throw new TypeError(
      `The ability "${definition.id}" needs requiresAura as a list of aura ids, one or more. Got ${JSON.stringify(list)}.`,
    );
  }
  for (const id of list) {
    if (!isRequiredAura(id)) {
      throw new Error(
        `The ability "${definition.id}" requires the aura "${String(id)}", which is not a self aura in AURAS (js/auras.js).`,
      );
    }
  }
  if (new Set(list).size !== list.length) {
    throw new Error(
      `The ability "${definition.id}" names an aura in requiresAura more than once.`,
    );
  }
  return Object.freeze([...list]);
}

export class Ability {
  constructor(definition, rogue) {
    const stats = k(definition.row);
    this.definition = definition;
    this.rogue = rogue;
    this.id = definition.id;
    const catalogued = abilityCatalogue.get(definition.id);
    if (catalogued === undefined) {
      throw new Error(
        `The ability "${definition.id}" is not in the ability catalogue.`,
      );
    }
    this.name = catalogued.name;
    // What a cast pays, and in which resource (resource-data.js ids).
    this.cost =
      definition.cost === undefined ? 0 : stats[definition.cost.field];
    this.costResource = definition.cost?.resource ?? null;
    // The share of the cost a cast that does not land gives back.
    this.refund =
      definition.cost?.refund === undefined ? 0 : k(definition.cost.refund);
    // What a cost modifier's scope sees of this ability. An ability
    // attacks with the main hand (Simulation.attackContext reads `hand`).
    this.hand = "mainHand";
    this.costContext = Object.freeze({ ability: this.id });
    // The main-hand weapon type a cast needs, or null for none (Backstab).
    this.requiresMainHand = definition.requiresMainHand ?? null;
    // The self auras a cast needs one of (js/required-auras.js), a frozen
    // list; empty for none (Ambush: ["cutthroat"], #261).
    this.requiresAura = requiredAuras(definition);
    this.cooldown = stats.cooldown;
    // A hand-made file in img/ where the entry has one; else the spell's icon
    // from the icon CDN (js/icons.js), the question mark if it has none.
    this.icon = definition.icon ?? spellIconUrl(this.name);
    // Whether a cast starts the global cooldown. An off-GCD ability skips the
    // wait for a clear GCD and does not start one.
    this.triggersGcd = catalogued.startsGcd;
    // A spender needs at least one of its resource and spends all of it.
    this.spender = definition.spend !== undefined;
    this.spendResource = definition.spend?.resource ?? null;
    // What a landed cast adds, and to which resource.
    this.gain =
      definition.gain === undefined ? 0 : stats[definition.gain.field];
    this.gainResource = definition.gain?.resource ?? null;
    // Every resource the definition names must be one the rogue has, said
    // here and not in the middle of a cast. A pool is only looked up, never
    // read, so this costs no draw.
    for (const id of [
      this.costResource,
      this.spendResource,
      this.gainResource,
    ]) {
      if (id !== null) {
        this.pool(id);
      }
    }
    // A gift that expires: the points a cast adds are removed `after` seconds
    // later, unless a later cast adds some or a spend takes them first.
    this.expires =
      definition.expires === undefined
        ? null
        : Object.freeze({
            amount: k(definition.expires.amount),
            after: k(definition.expires.after),
          });
    this.attackSkill = definition.damage !== undefined;
    this.dot = definition.damage?.kind === "dot";
    this.bleed = definition.damage?.bleed === true;
    // The aura (js/auras.js) a cast puts up for `duration` seconds, if any. An
    // aura on the player (haste, energy regen) is a buff, one on the target (a
    // DoT, or bonus damage taken) a debuff: the definition says which.
    this.aura =
      definition.aura === undefined ? null : AURAS[definition.aura.id];
    // The aura's length when it does not depend on the combo points spent.
    this.duration = 0;
    const length = definition.aura?.duration;
    if (length?.field !== undefined) {
      this.duration = k(length.row ?? definition.row)[length.field];
    }
  }

  // The resource pool an id names on the host. An id the host has no pool for
  // is a data error, said when it is first needed.
  pool(id) {
    // Own pools only: an inherited name ("toString") is not a resource.
    const { resources } = this.rogue;
    const pool =
      resources !== undefined && Object.hasOwn(resources, id)
        ? resources[id]
        : undefined;
    if (pool === undefined) {
      throw new RangeError(
        `Ability "${this.id}" names the resource "${id}", which the rogue does not have.`,
      );
    }
    return pool;
  }

  // The damage and aura length of a cast now: { damage, duration }. `spent` is
  // what the cast spends, by default what the spend resource holds now, which
  // is read before a cast resets it. A damage kind that draws from the rng does
  // it here, once per call. A length by amount spent is 0 outside the amounts
  // the table covers, and so is the damage of a dot. The length then goes
  // through the "duration" modifiers scoped to this ability (Improved Slice and
  // Dice), so the refresh and the time left follow it with no other change; a
  // length of 0 stays 0, and with no such modifier the length is untouched.
  resolve(spent = this.spendable()) {
    const { definition, rogue } = this;
    const stats = k(definition.row);
    let duration = this.duration;
    const table = definition.aura?.duration.bySpent;
    if (table !== undefined) {
      const durations = stats[table];
      duration =
        spent >= 1 && spent <= durations.length ? durations[spent - 1] : 0;
    }
    duration = rogue.modifiers.resolve("duration", duration, this.costContext);
    const spec = definition.damage;
    if (spec === undefined) {
      return { damage: 0, duration };
    }
    const damage = DAMAGE[spec.kind](
      spec,
      stats,
      rogue,
      spent,
      stats[table] ?? [],
    );
    return damage === null ? { damage: 0, duration: 0 } : { damage, duration };
  }

  // What the spend resource holds now, the most a cast could spend. 0 for an
  // ability that spends nothing.
  spendable() {
    return this.spendResource === null
      ? 0
      : this.pool(this.spendResource).value;
  }

  damage() {
    return this.resolve().damage;
  }

  onCooldown(rogue, simulation) {
    return simulation.cooldowns[this.id] > 0;
  }

  // Whether the main hand is the type the ability needs (always, for one that
  // needs none). Only the config's weapon type decides it.
  mainHandAllowed(rogue) {
    return (
      this.requiresMainHand === null ||
      rogue.weapons.mainHand.type === this.requiresMainHand
    );
  }

  // Whether an aura the ability requires is up now (always, for one that
  // requires none). Ambush: the cutthroat aura, which nothing grants yet
  // (#261).
  auraMet(simulation) {
    return (
      this.requiresAura.length === 0 ||
      this.requiresAura.some((id) => simulation.hasAura(id))
    );
  }

  // Whether anything in this fight can put up an aura the ability requires
  // (Rogue.grantedAuras): false for Ambush today, as nothing grants the
  // cutthroat aura (#261). The rotation host's usable asks it.
  auraReachable(rogue) {
    return (
      this.requiresAura.length === 0 ||
      this.requiresAura.some((id) => rogue.grantedAuras.has(id))
    );
  }

  // The checks a cast makes before any other, which spend and draw nothing:
  // the main hand, then the required aura.
  requirementsMet(rogue, simulation) {
    return this.mainHandAllowed(rogue) && this.auraMet(simulation);
  }

  // What a cast would pay now: the cost after the cost modifiers of its
  // resource (Improved Sinister Strike). With none, it is this.cost as it
  // stands. 0 for an ability that pays nothing.
  costNow(simulation) {
    if (this.costResource === null) {
      return 0;
    }
    const { definition } = this.pool(this.costResource);
    return definition.costModifier === undefined
      ? this.cost
      : simulation.modifiers.resolve(
          definition.costModifier,
          this.cost,
          this.costContext,
        );
  }

  // Whether cast() would go ahead right now. It makes the same six checks
  // cast() makes, in another order (the answer is a yes only if all six
  // pass), and changes nothing: no draw, no spend.
  // The main hand is the type the ability needs (Backstab: a dagger); an
  // aura it requires is up (Ambush: the cutthroat aura, granted by nothing
  // yet, #261); not on cooldown; a spender holds at least one of what it spends; the pool
  // affords the cost; and, on the GCD, the GCD is clear (a remainder within
  // sim.tickEpsilon counts as clear). An off-GCD ability skips the GCD check.
  // The rotation interpreter (js/rotation-interpreter.js) asks this; the build
  // lock is its own check (Rogue.lockedByBuild, which with no build locks every
  // talent ability the host does not grant, #199). test/can-cast.test.js holds
  // the two together: cast() acts exactly when this is true.
  canCast(rogue, simulation) {
    if (!this.requirementsMet(rogue, simulation)) {
      return false;
    }
    // The GCD is asked first: on most steps it is running, and that settles
    // an on-GCD ability before its cost is worked out.
    if (this.triggersGcd && !gcdClear(simulation)) {
      return false;
    }
    if (this.onCooldown(rogue, simulation)) {
      return false;
    }
    if (this.spender && this.pool(this.spendResource).value < 1) {
      return false;
    }
    return (
      this.costResource === null ||
      this.pool(this.costResource).has(this.costNow(simulation))
    );
  }

  cast(rogue, simulation) {
    // The wrong main hand, or no required aura up (Ambush without the
    // cutthroat aura, #261), is refused before anything else: no cast is
    // told, nothing is spent, no cooldown or GCD starts, and the rng is not
    // drawn.
    if (!this.requirementsMet(rogue, simulation)) {
      return null;
    }
    if (this.onCooldown(rogue, simulation)) {
      return null; // On cooldown, cannot cast
    }
    // A spender (Eviscerate, Rupture, Slice and Dice) needs at least one of
    // the resource it spends.
    const spends = this.spender ? this.pool(this.spendResource) : null;
    if (spends !== null && spends.value < 1) {
      return null;
    }
    // gcd.flags: an ability on the GCD waits until it is clear. A remainder
    // within sim.tickEpsilon counts as clear, the same tolerance buffs,
    // cooldowns, DoT expiry, and weapon swings already use. Every off-GCD
    // ability skips that wait and does not start one, not only Premeditation.
    // A future off-GCD ability, such as Cold Blood, inherits this.
    // The cost after the cost modifiers of its resource (Improved Sinister
    // Strike). With none, it is this.cost as it stands.
    const paid =
      this.costResource === null ? null : this.pool(this.costResource);
    const cost = this.costNow(simulation);
    if (
      (paid === null || paid.has(cost)) &&
      (simulation.gcd <= k("sim.tickEpsilon") || !this.triggersGcd)
    ) {
      // The cast is told first: what it does follows it.
      simulation.emitCast(this, paid === null ? 0 : cost);
      paid?.spend(cost, this.id);
      // The cast uses one charge of each required aura that is up, whatever
      // the attack's outcome (#261, js/required-auras.js): Ambush takes the
      // cutthroat aura. After the cast event, so the log reads cast, expire.
      // consumeCharge leaves an aura that is not up alone.
      for (const id of this.requiresAura) {
        simulation.consumeCharge(id);
      }
      if (this.triggersGcd) {
        simulation.setGcd();
      }

      let result = null;
      let spent = 0;
      const { damage, duration } = this.resolve();

      if (this.attackSkill) {
        if (this.dot) {
          // DoTs log the application with no immediate damage. Ticks use the resolved amount.
          result = simulation.resolveDotAttack(
            this,
            "skill",
            damage,
            duration,
            this.bleed,
          );
        } else {
          result = simulation.resolveAttack(this, "skill", damage);
        }
      } else {
        simulation.recordAbility(this, "cast");
        simulation.addCombatEvent(
          this.name,
          "skill",
          0,
          "Cast",
          "cast",
          this.icon,
          this.id,
        );
      }

      if (result && !result.landed) {
        // A miss refunds skill.missEnergyRefund of the cost and does not start the cooldown.
        paid?.gain(cost * this.refund, this.id);
        return result; // Return the result of the attack attempt
      }

      if (spends !== null) {
        // The amount spent is what resolve() read above.
        spent = spends.spendAll(this.id);
        // A spend takes the points a gift would have removed.
        spends.clearExpiry();
      } else if (this.gainResource !== null) {
        const gains = this.pool(this.gainResource);
        const gained = gains.gain(this.gain, this.id);
        if (this.expires !== null) {
          gains.armExpiry(this.expires.amount, this.expires.after);
        } else if (gained > 0) {
          gains.clearExpiry();
        }
      }

      //  Put this attack on CD
      if (this.cooldown > 0) {
        simulation.cooldowns[this.id] = this.cooldown; // Set the ability's cooldown
      }

      if (duration > 0 && this.aura) {
        simulation.applyAura(this.aura, {
          duration,
          icon: this.icon,
          source: this.id,
        });
      }

      // The procs this cast triggers (js/procs.js) fire last, so they see the
      // cast as it stands: its points gained or spent, its cooldown, its aura.
      simulation.procs.onCast(this, result, spent);
      return result;
    }
    return null;
  }
}

// The rogue's abilities by key, in the order of ABILITY_DEFINITIONS.
export function createAbilities(rogue) {
  return Object.fromEntries(
    ABILITY_DEFINITIONS.map((definition) => [
      definition.key,
      new Ability(definition, rogue),
    ]),
  );
}
