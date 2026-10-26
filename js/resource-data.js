// The rogue's resources, as data (roadmap D3). The generic ability executor
// (js/ability.js) and the resource model (js/resource.js) know a resource only
// by its id and by these fields, so energy and combo points are rows here and
// no field names in the engine. Another class adds a row (rage, focus) and
// its abilities name it, with no engine change.
//
// Like js/ability-data.js an entry holds no number of its own: every value is
// the id of a constants row (data/constants.js, read with k()), so provenance
// and the retune list stay in one place.
//
//   id        what an ability names it by ("energy", "comboPoints"), and the
//             `resources` scope of a resourceMax modifier
//   max       constants id of the base cap. A resourceMax modifier changes it
//   start     where the fight starts it: a constants id, or { id, field } for
//             a field of a row
//   regen     optional. The resource refills with time:
//               perSecond   constants id of the base rate
//               modifier    the modifier kind that changes the rate. The
//                           aura and talent modifiers of that kind change it
//                           for the part of a step they are up
//               tick        constants id naming how it applies. Only
//                           "continuous" is supported: every step adds
//                           rate * dt
//   whole     optional, true: the pool holds whole units only (combo points).
//             A gain or a spend of a fraction is a RangeError, where a proc
//             or an ability would otherwise leave 0.5 of a point behind
//   costModifier
//             optional. The modifier kind (scoped by ability) that changes
//             what an ability pays in this resource
//   onTargetChange
//             optional. Constants id of "clear" (the points are lost when the
//             target changes) or "keep"
//
// A resource that can be given for a limited time (Premeditation's combo
// points) says so in the ability that gives it (js/ability-data.js
// `expires`), and the resource counts the time down.
export const RESOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "energy",
    max: "energy.max",
    start: Object.freeze({ id: "start.state", field: "energy" }),
    regen: Object.freeze({
      perSecond: "energy.regenPerSecond",
      modifier: "energyRegen",
      tick: "energy.tickMode",
    }),
    costModifier: "energyCost",
  }),
  Object.freeze({
    id: "comboPoints",
    max: "combo.max",
    start: Object.freeze({ id: "character.startingComboPoints" }),
    onTargetChange: "combo.onTargetChange",
    whole: true,
  }),
]);
