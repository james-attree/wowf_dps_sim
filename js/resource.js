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
  gain(amount) {
    const before = this.value;
    this.value = Math.min(before + amount, this.max);
    return Math.max(0, this.value - before);
  }

  // Take `amount` away. The caller has checked has(amount).
  spend(amount) {
    this.value -= amount;
    return amount;
  }

  // Spend everything, as a finisher does, and return how much that was. The
  // count is read before the pool is reset, so the effect of the spend (a
  // finisher's damage, a proc's chance per point) can use it.
  spendAll() {
    const spent = this.value;
    this.value = 0;
    return spent;
  }

  // Refill over dt seconds at `rate` per second, up to the cap.
  regenerate(dt, rate) {
    this.value = Math.min(this.value + rate * dt, this.max);
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
    this.value = Math.max(0, this.value - this.expiryAmount);
    this.clearExpiry();
  }

  // A host reports a new target. What happens is the resource's data: "clear"
  // loses the points (and any pending expiry), "keep" or no rule leaves them.
  targetChanged() {
    const rule = this.definition.onTargetChange;
    if (rule !== undefined && k(rule) === "clear") {
      this.value = 0;
      this.clearExpiry();
    }
  }
}

// One Resource per definition, by id. `definitions` defaults to the rogue's.
export function createResources(modifiers, definitions = RESOURCE_DEFINITIONS) {
  const resources = {};
  for (const definition of definitions) {
    if (Object.hasOwn(resources, definition.id)) {
      throw new RangeError(`Duplicate resource id "${definition.id}".`);
    }
    resources[definition.id] = new Resource(definition, modifiers);
  }
  return resources;
}
