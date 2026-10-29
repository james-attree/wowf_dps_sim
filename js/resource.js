import { k } from "../data/constants.js";
import { RESOURCE_DEFINITIONS } from "./resource-data.js";

// The resource model (roadmap D3). A Resource is one pool a class spends and
// gains: energy, combo points, later rage or focus. It is built from one entry
// of js/resource-data.js and knows nothing about a rogue. The generic ability
// executor spends and gains through it by id, and a later proc (A4) can do the
// same: "restore 25 energy" and "add a combo point" are gain(), a finisher's
// cost is spend() or spendAll(), whose return value is what was spent, so the
// count is available before the pool is reset.
//
// The cap goes through the modifier pipeline (kind resourceMax, scoped by the
// resource's id), so a talent or an aura changes it as data. The rate of a
// regenerating resource is combined by Simulation.regenerateResource, and a
// cost modifier by the executor; the kind names come from the definition.
//
// This module is pure: no DOM, no clock, no random numbers.

const TICK_MODES = Object.freeze(["continuous"]);
const TARGET_CHANGES = Object.freeze(["clear", "keep"]);

// A gain or a spend is an amount of 0 or more. A negative amount would be a
// spend called a gain (or the reverse), and NaN would poison the pool for the
// rest of the fight, so both fail where they are made. A pool that holds
// whole units only (combo points: `whole` in js/resource-data.js) takes a
// whole number, so no proc or ability can leave half a point behind.
function checkAmount(definition, verb, amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new RangeError(
      `Resource "${definition.id}" cannot ${verb} ${String(amount)}. An amount is a number, 0 or more.`,
    );
  }
  if (definition.whole === true && !Number.isInteger(amount)) {
    throw new RangeError(
      `Resource "${definition.id}" cannot ${verb} ${String(amount)}. It holds whole units, so an amount is a whole number.`,
    );
  }
}

function startValue(start) {
  const row = k(start.id);
  return start.field === undefined ? row : row[start.field];
}

export class Resource {
  // `modifiers` is the rogue's ModifierPipeline (or anything with a
  // resolve(kind, base, context) of the same shape).
  constructor(definition, modifiers) {
    if (
      definition.regen !== undefined &&
      !TICK_MODES.includes(k(definition.regen.tick))
    ) {
      throw new RangeError(
        `Resource "${definition.id}" has an unsupported regen tick mode. Known: ${TICK_MODES.join(", ")}.`,
      );
    }
    if (
      definition.onTargetChange !== undefined &&
      !TARGET_CHANGES.includes(k(definition.onTargetChange))
    ) {
      throw new RangeError(
        `Resource "${definition.id}" has an unknown onTargetChange. Known: ${TARGET_CHANGES.join(", ")}.`,
      );
    }
    this.definition = definition;
    this.id = definition.id;
    this.modifiers = modifiers;
    this.maxContext = Object.freeze({ resource: definition.id });
    // The cap before modifiers. A host or a test may set it.
    this.baseMax = k(definition.max);
    this.value = startValue(definition.start);
    // Points that will expire (a timed gift such as Premeditation's), and the
    // time before they do.
    this.expiryAmount = 0;
    this.expiryRemaining = 0;
    // The host's ear for the changes it wants told: onChange(change, before,
    // source) after a gain, a spend, a gift running out or a target change
    // clears the pool, only when the value moved. Regeneration and clamp() are
    // not reported: they are continuous, and a stream of them would be the
    // engine's step in disguise. The host reads the value when it wants it.
    this.onChange = null;
    // What the fight lost to the cap (#146), exact, for the end event:
    //   cappedTime  seconds the pool sat at its cap while regenerating, so
    //               regeneration had nowhere to go. A pool with no regen rule
    //               (combo points) is never regenerated and keeps 0.
    //   overflow    what a gain or regeneration would have added past the cap
    //               and did not: gain(amount) - added, plus regeneration past
    //               the cap. A loss (spend, expire, clear, clamp) is not
    //               overflow.
    // Counting draws nothing and reports nothing: the value, its events and the
    // fight are the same as without them.
    this.cappedTime = 0;
    this.overflow = 0;
  }

  report(change, before, source) {
    if (this.onChange !== null && this.value !== before) {
      this.onChange(change, before, source);
    }
  }

  // The cap now: the base cap through the resourceMax modifiers for this
  // resource. With none it is baseMax itself.
  get max() {
    return this.modifiers.resolve("resourceMax", this.baseMax, this.maxContext);
  }

  has(amount) {
    return this.value >= amount;
  }

  // Add up to the cap. Returns how much was added, which is less than
  // `amount` at the cap. A pool above a cap that has since fallen is brought
  // down to it (as regeneration always did), and has gained nothing.
  // `source` is the id of what caused it, for the host's report (null: none).
  gain(amount, source = null) {
    checkAmount(this.definition, "gain", amount);
    const before = this.value;
    this.value = Math.min(before + amount, this.max);
    this.report("gain", before, source);
    const added = Math.max(0, this.value - before);
    this.overflow += amount - added;
    return added;
  }

  // Take `amount` away. The caller has checked has(amount).
  spend(amount, source = null) {
    checkAmount(this.definition, "spend", amount);
    const before = this.value;
    this.value -= amount;
    this.report("spend", before, source);
    return amount;
  }

  // Spend everything, as a finisher does, and return how much that was. The
  // count is read before the pool is reset, so the effect of the spend (a
  // finisher's damage, a proc's chance per point) can use it.
  spendAll(source = null) {
    const spent = this.value;
    this.value = 0;
    this.report("spend", spent, source);
    return spent;
  }

  // Refill over dt seconds at `rate` per second, up to the cap, and count the
  // time spent at the cap and what the cap turned away. A pool already at (or
  // above) its cap is capped for all of dt; one that reaches it during dt is
  // capped from the moment it does, (max - before) / rate seconds in. The
  // overflow is the regeneration past the cap; the excess of a pool already
  // above a cap that fell is not regeneration, and clamp() takes it away
  // uncounted.
  regenerate(dt, rate) {
    const before = this.value;
    const max = this.max;
    const regenerated = rate * dt;
    this.value = Math.min(before + regenerated, max);
    if (before >= max) {
      this.cappedTime += dt;
      this.overflow += regenerated;
    } else if (before + regenerated > max) {
      // Never below 0 should rounding put the moment past dt.
      this.cappedTime += Math.max(0, dt - (max - before) / rate);
      this.overflow += before + regenerated - max;
    }
  }

  // The counters as plain data: { cappedTime, overflow }.
  waste() {
    return { cappedTime: this.cappedTime, overflow: this.overflow };
  }

  // A gift that expires: `amount` points are removed `seconds` from now unless
  // clearExpiry() is called first. A second call restarts it.
  armExpiry(amount, seconds) {
    this.expiryAmount = amount;
    this.expiryRemaining = seconds;
  }

  clearExpiry() {
    this.expiryAmount = 0;
    this.expiryRemaining = 0;
  }

  // Bring a pool that is above its cap down to it. The cap can fall while the
  // pool holds more (a resourceMax aura running out), and a cast that neither
  // gains nor spends would otherwise leave the excess in place. The host calls
  // this once a step (Rogue.tickResources). It never raises a pool.
  clamp() {
    this.value = Math.min(this.value, this.max);
  }

  // Count the expiry down by dt. When it runs out (within sim.tickEpsilon) the
  // points go, never below 0.
  tick(dt) {
    if (this.expiryRemaining <= 0) {
      return;
    }
    this.expiryRemaining -= dt;
    if (this.expiryRemaining > k("sim.tickEpsilon")) {
      return;
    }
    const before = this.value;
    this.value = Math.max(0, this.value - this.expiryAmount);
    this.clearExpiry();
    this.report("expire", before, null);
  }

  // A host reports a new target. What happens is the resource's data: "clear"
  // loses the points (and any pending expiry), "keep" or no rule leaves them.
  targetChanged() {
    const rule = this.definition.onTargetChange;
    if (rule !== undefined && k(rule) === "clear") {
      const before = this.value;
      this.value = 0;
      this.clearExpiry();
      this.report("clear", before, null);
    }
  }
}

// One Resource per definition, by id. `definitions` defaults to the rogue's.
export function createResources(modifiers, definitions = RESOURCE_DEFINITIONS) {
  const resources = {};
  for (const definition of definitions) {
    // The pools are a plain object keyed by id: "__proto__" would set a
    // prototype and not a pool.
    if (typeof definition.id !== "string" || definition.id === "__proto__") {
      throw new RangeError(
        `A resource id must be a string other than "__proto__", not ${String(definition.id)}.`,
      );
    }
    if (Object.hasOwn(resources, definition.id)) {
      throw new RangeError(`Duplicate resource id "${definition.id}".`);
    }
    resources[definition.id] = new Resource(definition, modifiers);
  }
  return resources;
}
