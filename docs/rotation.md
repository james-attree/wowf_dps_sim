# Rotation as data (R1, issue #138; R2, issue #139; R3, issue #140; R4, issue #141; R5, issue #142; R6, issue #143)

A rotation is a priority list of rules, written as JSON. The Rogue casts one at
every decision point: `SimConfig.rotation`, by default today's placeholder
Combat rotation (example 1 below, `js/rotation-default.js`, with its numbers in
`data/constants.js`). The rotation builder, presets and import/export need the
same rotation as data, and this page fixes what that data looks like.

R1 ([#138](https://github.com/james-attree/wowf_dps_sim/issues/138)) fixed the
**shape**. R2 ([#139](https://github.com/james-attree/wowf_dps_sim/issues/139))
fixes the **condition vocabulary**: the condition types a rule can use, their
params, and the state they read. R3
([#140](https://github.com/james-attree/wowf_dps_sim/issues/140)) is the
**interpreter** that casts from a list, and the wiring of a rotation into a
fight ([The interpreter](#the-interpreter)). R4
([#141](https://github.com/james-attree/wowf_dps_sim/issues/141)) is the
**validator** and the **readable summary**
([Validation](#validation), [The readable summary](#the-readable-summary)).
R5 ([#142](https://github.com/james-attree/wowf_dps_sim/issues/142)) is the
**presets** ([Presets](#presets)). R6
([#143](https://github.com/james-attree/wowf_dps_sim/issues/143)) is
**import and export** ([Import and export](#import-and-export)).
The shape check is in `js/rotation-schema.js`, the vocabulary in
`js/rotation-conditions.js`, the state view in `js/rotation-state.js`, the
interpreter in `js/rotation-interpreter.js`, the validator in
`js/rotation-validator.js` and the summary in `js/rotation-summary.js`. The default rotation casts what
the code rotation cast before R3, fight for fight, so no fight changes.

## The model

```json
{
  "schemaVersion": 1,
  "name": "Default (Combat)",
  "rules": [{ "action": "sinister-strike", "conditions": [] }]
}
```

| Field                | Type   | Meaning                                                                                                                 |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`      | number | The format version. This build reads and writes `1`.                                                                    |
| `name`               | string | A label for the rotation. Not empty, at most `rotation.maxNameLength` (80) characters.                                  |
| `rules`              | array  | The rules, highest priority first. At most `rotation.maxRules` (50).                                                    |
| `rules[].action`     | string | An **ability id** from the ability data (`js/ability-data.js` `id`, for example `sinister-strike`). Not a display name. |
| `rules[].conditions` | array  | An AND list of condition objects. At most `rotation.maxConditionsPerRule` (10).                                         |
| a condition          | object | `{ "type": "...", ...params }`. `type` is a non-empty string. The params belong to the type.                            |

All three top-level fields and both rule fields are required. Nothing in the
model counts steps, frames or ticks: a time is in seconds, and a rotation reads
the same on any engine clock.

The ability id is the catalogue id (`slugify` of the name), the same id the
engine keys cooldowns, auras and the result's breakdown by. It is not the key
on `Rogue.abilities` (`sinisterStrike`), which `data/constants.js` rows such as
`rotation.priority` use. The ids of the rogue abilities are `premeditation`,
`sinister-strike`, `eviscerate`, `adrenaline-rush`, `slice-and-dice`,
`ghostly-strike`, `backstab`, `ambush`, `blade-flurry`, `rupture`,
`hemorrhage`, `cold-blood` and `preparation` (#270). TR-08
([#338](https://github.com/james-attree/wowf_dps_sim/issues/338)) adds
`shank` and `death-mark` to the actions a rule may cast. No new condition
type is added. Cooldowns use `cooldownReady`. The self auras `venom`,
`poised` and `ambush-window` use `auraActive` and `auraRemaining`. The
target debuff `death-mark` uses `debuffActive`, `debuffRemaining` and
`debuffStacks`. There is no `deathMarkStored` condition (James, 5 Nov 2026,
issue #338). A Shank rule with no `cooldownReady` is the existing
`cooldownNotChecked` warning. The validator and the warnings do not know
whether the fight has an off-hand weapon: Shank strikes with the off hand,
and a missing off hand is not a warning code. An Ambush rule with no
Ghostly Strike in the build is passed over by the host (`usable` is false);
the warnings still say nothing about Ambush, as they did for the old
Cutthroat gate.

## The four decisions

**An empty `conditions` list.** The rule always applies. An AND over no
conditions is true, so `"conditions": []` is how a fallback such as the builder
is written. The field is still required: a rule that leaves it out is a shape
problem, so a missing list is never read as "always" by accident.

**How list order sets priority.** The list is the priority: the first rule is
the highest. At a decision point (the engine is asked what to cast now) the
interpreter walks the list from the top. A rule whose conditions do not all
hold is passed over. For a rule whose conditions hold, what happens depends on
whether its ability is on the global cooldown:

- **An off-GCD ability** (Cold Blood and Premeditation: `abilities.offGcd`): if
  it can be cast right now it is cast, and the walk goes on to the next rule.
  If it **cannot** be cast right now (it is on cooldown, the build holds it
  back, or there is not the energy), the rule is **skipped and the walk goes
  on**, exactly as if its conditions had failed. This holds with an empty
  `conditions` list: Cold Blood on cooldown, with no conditions at all, does
  not stop the walk.
- **An on-GCD ability** (Slice and Dice, Eviscerate, Sinister Strike, and also
  Blade Flurry and Adrenaline Rush, which start the GCD in the engine): if it
  can be cast it is the pick, and the walk stops. If its conditions hold but it
  **cannot be afforded** yet, the rule still **ends the walk**: nothing lower is
  cast, so the rogue pools energy for a finisher and does not fall through to a
  builder. This is the only kind of rule that ends the walk without a cast. A
  rule that should be passed over while its on-GCD ability is on cooldown says
  so with a condition (`cooldownReady`, as the dagger example does for Ghostly
  Strike). The same goes for a build that lacks the ability
  (`abilityUnlocked`) and, when it must not hold the walk for want of energy,
  for the energy (a `resource` condition).
- **While the GCD is running** no on-GCD ability can be cast, whatever its
  cost. An on-GCD rule that holds is then **passed over** and does not end the
  walk, so an off-GCD rule below it (Cold Blood) is still reached. The walk
  ends at an on-GCD rule only when the GCD is clear and the rule cannot be
  cast. This clause is what R3 added to the wording above: without it a
  finisher that waits on the GCD would hide Cold Blood, which the code rotation
  cast in that case.
- **An ability the fight's weapon rules out** (Backstab without a dagger main
  hand), or that requires an aura nothing in the fight grants (Ambush without
  the Cutthroat talent, which needs the "Ambush allowed" aura, #261, #271), is passed over whatever its
  conditions say, on or off the GCD, and never ends the walk (#155): no amount
  of pooling makes it castable. With a dagger, a Backstab rule that cannot be
  afforded still pools as above.
- **An ability whose required aura is down** (Ambush, with Cutthroat in the
  build, #271) is passed over at that decision point, whatever its conditions say,
  and never ends the walk: pooling cannot bring the aura up. While the aura is
  up the rule is walked as any other (#261, the coordinator's ruling on Kira's
  QA of #262).

A rule is never reordered by a field of its own: there is no `priority`
number, so the list order is the only order. This restates the "cast the first
rule whose conditions pass" line of the
[Phase 3.5 plan](phase-3.5-engine-rewrite.md) and fixes the off-GCD case that
line left open. R3 builds the interpreter to this wording.

The earlier version of this page listed Blade Flurry and Adrenaline Rush as
off-GCD. They are not: both start the GCD in the engine (`gcd.flags`; only
Premeditation and Cold Blood are in `abilities.offGcd`). The rotation below is
written for that.

**How `schemaVersion` is checked.** Exactly. The value must be the number the
build reads (`ROTATION_SCHEMA_VERSION`, `1`). Any other value, higher or lower,
a string `"1"` or a missing field, is rejected, and a rotation with another
version is checked no further, because its other fields may mean something
else. There is no migration yet. When the shape changes in a way an older
reader would misread, the number goes up and the change brings a migration from
the version before.

**Unknown fields.** Rejected. A top-level or rule key that is not in the table
above is a problem that names the key and the allowed ones, so a typo such as
`condtions` is caught and a field a later version added is not silently
dropped. This is how `SimConfig` and the Rogue options already treat unknown
keys. The one place the shape check leaves open is a condition: its keys other than
`type` are the type's params, and the
[vocabulary](#the-condition-vocabulary) says which each type allows. A param a
type does not list is rejected there, by the same rule.

## The shape check

`js/rotation-schema.js` exports:

- `rotationShapeErrors(rotation)`: every shape error in reading order, as
  `{ code, path, message, ...data }` ([the codes](#error-codes)). The path says where (`rules[2].conditions[0].type`; `""`
  is the rotation itself) and the message says what, never where
  ([the message contract](#the-message-contract)).
- `rotationShapeProblems(rotation)`: `rotationShapeErrors` as strings, each
  the path then the message (`rules[2].conditions[0].type: The condition needs
a non-empty string "type".`). An empty list means the shape is right.
- `formatError({ path, message })`, `formatErrors(entries)`: the string form of
  an entry, `path: message` (the message alone when the path is `""`). Every
  string and thrown form below is written by these.
- `isRotationShape(rotation)`: `true` when there are none.
- `assertRotationShape(rotation)`: returns the rotation, or throws a
  `RangeError` that lists the problems.
- `ROTATION_SCHEMA_VERSION`, `ROTATION_KEYS`, `RULE_KEYS`.

It checks: the value is a plain object; the version; `name`; `rules` is an
array; each rule has exactly `action` and `conditions`; `action` looks like an
ability id (lowercase words joined by hyphens, so `Sinister Strike` fails);
`conditions` is an array of objects that each have a non-empty string `type`;
the three limits; and no unknown fields.

It does **not** check whether an `action` is a real ability, whether a `type`
exists, whether a condition's params are right, whether a number is in range,
or whether a rule is unreachable, and an empty `rules` list is a valid shape.
That is the validator (R4, [Validation](#validation)), which uses
`conditionErrors` for the types and params. A rotation can pass the shape check
and still be rejected there.

## The condition vocabulary

A condition is `{ "type": "...", ...params }`. All of a rule's conditions must
hold (AND). `js/rotation-conditions.js` is the vocabulary: `CONDITION_TYPES`,
`CONDITION_PARAMS` (below), `conditionErrors(condition, where)` (every
problem, as `{ code, path, message, ...data }`, the path starting at `where`),
`conditionProblems(condition, where)` (the same as `path: message` strings),
`assertCondition(condition)` (throws a `RangeError`), `evaluate(condition,
state)` and `evaluateAll(conditions, state)`. A condition is checked every time
it is evaluated: the type must be known, every required param present and
right, and no param the type does not list.

**Operators.** A comparing type has `op`, one of `>=`, `>`, `<=`, `<`, `==`, and
`value`, a finite number. The comparison is exact, with no tolerance, as the
code rotation's `<=` is. **Time is seconds** of fight time, never steps.
**Ids** are ability and aura ids (`slice-and-dice`), never display names. A
resource is named by its resource id (`energy`, `comboPoints`). Whether an
ability or aura id exists, and whether a number is in range, is the
validator's check (R4), not this one's.

**`CONDITION_PARAMS`** (#214) is every type's params as data, the one source
for the builder's condition editor, `conditionErrors` and the validator. It is
deeply frozen:

```js
CONDITION_PARAMS = {
  [type]: {
    [param]: { kind, optional?, default?, of?, values? },
  },
};
// for example
CONDITION_PARAMS.auraActive = {
  aura: { kind: "id", of: "aura" },
  active: { kind: "boolean", optional: true, default: true },
};
```

The types are in `CONDITION_TYPES` order and each type's params in the order
a condition is written. `kind` is one of `id`, `operator`, `number`,
`boolean`, `resource`. `of` (on an `id` only) says what the id names:
`ability`, `aura` or `debuff`; the validator reads it to pick the id check.
`values` (on an `operator` or `resource` only) is the closed list it takes
(`OPERATORS`; `energy`, `comboPoints`). `optional: true` params may be left
out; `default` is what a left-out one means (`active` and `ready` are `true`),
and the `duplicateRule` warning treats a param written out at its default as
left out.

**What is not up counts as zero.** An aura, a debuff or a cooldown that is not
in the fight has 0 s remaining, and a debuff that is not up has 0 stacks.
`auraRemaining` `<= 10` is therefore true when Slice and Dice is missing and
when it has at most 10 s left, which is the code rotation's refresh test
(`!active || active.duration <= 10`) in one condition. `auraRemaining` `> 10`
is false when it is missing. `auraActive` is the way to ask "is it up" itself.

| Type                 | Params                    | True when                                                                                        |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `resource`           | `resource`, `op`, `value` | The pool's current value compares (`energy >= 40`).                                              |
| `comboPoints`        | `op`, `value`             | Combo points compare. The same as `resource` with `comboPoints`.                                 |
| `auraActive`         | `aura`, `active`?         | The self buff is up (`active` defaults to `true`; `false` means "is not up").                    |
| `auraRemaining`      | `aura`, `op`, `value`     | Seconds left on a self buff compare. Not up is 0.                                                |
| `debuffActive`       | `debuff`, `active`?       | The target debuff is up (or, with `active: false`, is not).                                      |
| `debuffRemaining`    | `debuff`, `op`, `value`   | Seconds left on a target debuff compare. Not up is 0.                                            |
| `debuffStacks`       | `debuff`, `op`, `value`   | Stacks of a target debuff compare. Not up is 0.                                                  |
| `cooldownReady`      | `ability`, `ready`?       | The ability's own cooldown is over (`ready` defaults to `true`; `false` means "is on cooldown"). |
| `fightTime`          | `op`, `value`             | Seconds of fight time so far compare.                                                            |
| `fightTimeRemaining` | `op`, `value`             | Seconds of fight left compare; 0 at and past the length. With no length known, `Infinity`.       |
| `energyToCap`        | `op`, `value`             | Seconds until energy reaches its cap at the current regeneration rate compare. 0 at the cap.     |
| `abilityGranted`     | `ability`                 | The build or the host grants the ability. Strict: see below.                                     |
| `abilityUnlocked`    | `ability`                 | The build does not hold the ability back. See below.                                             |

`cooldownReady` is about the ability's own cooldown only. It says nothing about
the global cooldown or the energy: whether a rule can be cast right now is the
interpreter's check, and the walk rule above says what happens when it cannot.

One example of each type:

```json
{ "type": "resource", "resource": "energy", "op": ">=", "value": 40 }
```

```json
{ "type": "comboPoints", "op": ">=", "value": 5 }
```

```json
{ "type": "auraActive", "aura": "adrenaline-rush" }
```

```json
{ "type": "auraRemaining", "aura": "slice-and-dice", "op": "<=", "value": 10 }
```

```json
{ "type": "debuffActive", "debuff": "rupture", "active": false }
```

```json
{ "type": "debuffRemaining", "debuff": "rupture", "op": "<=", "value": 2 }
```

```json
{ "type": "debuffStacks", "debuff": "deadly-poison", "op": ">=", "value": 5 }
```

```json
{ "type": "cooldownReady", "ability": "ghostly-strike" }
```

```json
{ "type": "fightTime", "op": ">=", "value": 5 }
```

```json
{ "type": "fightTimeRemaining", "op": "<", "value": 20 }
```

```json
{ "type": "energyToCap", "op": "<=", "value": 1 }
```

```json
{ "type": "abilityGranted", "ability": "cold-blood" }
```

```json
{ "type": "abilityUnlocked", "ability": "blade-flurry" }
```

### Granted and unlocked: no build selected

Three of the Combat rogue's abilities come from talents: Blade Flurry,
Adrenaline Rush and Cold Blood (and, since #207, Ghostly Strike, Hemorrhage and
Premeditation). Since #199, **no build is untalented**: with no talents picked
and no host grant, the fight has none of them, and the engine does not cast
them whatever the rotation says. Before #199 a fight with no build selected
cast Blade Flurry and Adrenaline Rush, as the fight did before talents (D7,
#106); the default fight's DPS drops by about 3.4% with the change (#199).

The engine's rule is one test, `Rogue.lockedByBuild`: a talent grants the
ability, and neither the build nor the host grants it. The rotation host
answers `usable` with it (`js/rotation-host.js`), and the interpreter passes
over a rule that is not usable, never pooling for it and never holding the
walk on it, as it does for a weapon the ability cannot use. The grants are
fixed for the fight, so the host asks once. The rotation builder and the
stats form's summary use the same test (`js/rotation-skips.js`), so a rule
they show as skipped is the one the engine passes over.

One gap: the preview reads the config only, and the config has no host
grants. A host that passes an ability in its `abilities` option (Blade Flurry
with no build, say) makes it usable in the engine, but the builder, the
summary and the talent tree still say the rule is skipped. The app passes no
host grants, so its fights match the preview; a host of your own that grants
abilities does not match the preview: the engine casts rules the preview
calls skipped.

Two conditions still say whether a talent ability is there:

- `abilityGranted` is **strict**. It is true only when the ability is in the
  rogue's granted set: the build's grants plus the host's `abilities` option.
  With no build selected and no host grant, **no talent ability is granted**,
  so `abilityGranted` for Blade Flurry is `false` there. Cold Blood uses it.
- `abilityUnlocked` is **unchanged**. It is `false` only when a build is
  selected, a talent grants the ability, and the build does not have it. In
  every other case it is `true`: with no build selected, for an ability no
  talent grants, and when the build has the talent. With no build it says
  `true` for Blade Flurry, but the rule is still passed over, because the
  ability is not usable.

Blade Flurry and Adrenaline Rush carry `abilityUnlocked` in the Combat example
below. The validator still requires a guard on every rule that casts a talent
ability (rule 5), and still takes `abilityUnlocked` for those two; with the
engine's skip the guard no longer decides whether they are cast, and whether
to make rule 5 strict is its own change.

### The state a condition reads

`evaluate(condition, state)` reads a state view and nothing else:
no `Rogue`, no `Simulation`. `rotationState(rogue, simulation, { duration })` in
`js/rotation-state.js` builds it from a fight without changing the fight:

| Field             | Meaning                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `time`            | Seconds of fight time so far.                                                                                               |
| `duration`        | The fight's length in seconds, or `null` when the host did not say (#191). Only `fightTimeRemaining` reads it.              |
| `resources`       | By resource id: `{ value, max, regenPerSecond }`. `regenPerSecond` is the rate now (Adrenaline Rush doubles it); 0 if none. |
| `auras`           | The self buffs that are up, by id: `{ remaining, stacks }`.                                                                 |
| `debuffs`         | The target debuffs that are up, by id: `{ remaining, stacks }`.                                                             |
| `cooldowns`       | Seconds left by ability id, only for those above 0.                                                                         |
| `build.selected`  | A talent build is selected.                                                                                                 |
| `granted`         | The ids of the abilities the build and the host grant.                                                                      |
| `talentAbilities` | The ids of the abilities some talent grants (Blade Flurry, Adrenaline Rush, Cold Blood, ...).                               |

The view names no step, frame or tick, so a different engine core can build
the same view and the vocabulary does not change.

## The interpreter

`js/rotation-interpreter.js` has two functions and knows nothing of the engine.

- `compileRotation(rotation)` checks a rotation once with the validator
  ([Validation](#validation)) and returns a frozen copy. A bad rotation is a
  `RangeError` that lists every problem with its path, so it never starts a
  fight. The ability ids are looked up by id; a display name is rejected as an
  unknown id.
- `decide(compiled, host)` is one decision point, the walk above. It returns
  `{ casts, outcome }`: the ability ids it cast, in order, and `"cast"` (an
  on-GCD ability was cast), `"pooling"` (an on-GCD rule held, the GCD was clear
  and it could not be cast) or `"none"` (the walk ran off the end). It reads the
  state again after each cast. It takes only a rotation from `compileRotation`
  (a `TypeError` otherwise), so a rotation is never walked unchecked.

The `host` is five functions: `state()` (the view above), `canCast(id)`,
`onGcd(id)`, `gcdClear()` and `cast(id)`, and three optional ones. `usable(id)`
is false when nothing in this fight can make the ability castable (Backstab
without a dagger main hand, #155; Ambush without Cutthroat, whose aura nothing
else grants, #261, #271).
`gated(id)` is true when the ability needs something that comes and goes in
the fight (Ambush's required aura), and `ready(id)` says whether it is there
now. `decide` asks `onGcd`, `usable` and `gated` once per host, and `ready` at
each decision point but only of a gated rule. It passes over a rule that is
not usable, or gated and not ready, as if its conditions had failed, so it
never pools for one. A host without `usable` has every ability usable, and one
without `gated` has none gated. There is no step, frame or tick in
them, so the Phase 3.5 engine writes a host of its own and calls `decide`
unchanged. The Rogue's host is `rotationHost` in `js/rotation-host.js`:
`canCast` is "the build does not lock it and `Ability.canCast` is true" (not on
cooldown, a spender has something to spend, the cost is there, the GCD is clear
for an on-GCD ability), and `Ability.canCast` makes the same checks `cast` does,
without casting (`test/can-cast.test.js` holds the two together).

**In a fight.** `SimConfig` has a `rotation` field (default `defaultRotation()`).
`normalizeConfig` validates it and a bad one is a `RangeError` before the
fight starts (before the `Simulation`, and so the rng, exists); the result's `config` records it in full, so a recorded config repeats
the fight. `Rogue.castRotation` asks the interpreter what to cast at each
decision point; the white swings and their haste are the core's own events
(`js/core/swing.js`).

**The fight length (#191).** The Rogue tells the state view the fight's length
(`duration`): `createFight(seed, config, { duration })` sets the Simulation's
`fightLength`, and the Rogue passes it to its rotation host. `runFight` and
`SimRunner` pass the duration they run, so `fightTimeRemaining` is the seconds
left in that fight (a rule with `fightTimeRemaining < 10` fires in the last
10 s). The length is the rotation's only: `simulation.run(duration)` still
decides when the fight ends, so give both the same number. With no length
(`createFight(seed, config)`, or a `Simulation` built by hand) `duration` is
`null` and `fightTimeRemaining` reads as `Infinity`. A length that is not a
finite number of seconds, 0 or more, is a `RangeError` (`null` and `undefined`
are none). No default rotation or golden reads it, so their fights are
unchanged.

**At and past the length, it reads 0.** `fightTimeRemaining` is
`max(0, duration - time)` (`js/rotation-conditions.js`), so it never goes
below 0. When `run` is given the same number as the length, the fight's last
decision is at `time == duration`, where it reads 0: a `<= 0` or `== 0` rule
holds there, at that one decision only. When the fight runs past its length
(`run(duration)` longer than the length told), it reads 0 at every decision
from the length on, so a `<= 0` or `== 0` rule holds at each of them, and a
`< x` rule with `x > 0` keeps holding too. A `< 0` rule never holds, and a
`> 0` rule stops holding at the length (Kira's QA on #209, #200).

**What it costs.** A five minute fight has 19,200 decision points, and the old
code rotation did about 1 µs of work at each, so anything the interpreter adds
to a decision point shows in the bench. Where it went and what was done
(measured on the dev box, Node 24):

- `evaluate` checks its condition on every call: about 3.5 µs for the 11
  conditions in the default rotation, against 0.34 µs without the check. The
  interpreter checks once in `compileRotation` and builds a closure for each
  condition then (`compileCondition`), so a decision point does no checking and
  no dispatch on the condition's type or operator.
- The state view was a full copy (about 1.4 µs, most of it freezing, and the
  resources view works out the regeneration rate through the modifiers) built at
  every decision point. The host now gives a view that reads the pools when
  asked and works out the auras, debuffs and cooldowns only when a condition
  reads them (`rotationStateReader`). What a fight does not change (the build,
  the grants, the talent abilities) is made once. It says what `rotationState`
  says (`test/rotation-host.test.js` holds the two equal at every step of a
  fight) and is not frozen: a view is valid until the fight next changes, and
  the interpreter asks for a new one after each cast.
- A rule's conditions are read before `canCast` is asked of it, so `canCast`
  (which works out what a cast would cost) is asked only of a rule that holds.
  While the GCD is running an on-GCD rule is passed over without a look at its
  conditions. The conditions and `canCast` are read-only, so the order changes
  nothing a host can see but the calls it gets.
- `decide` asks a host `onGcd`, `usable` and `gated` once for each rule and
  keeps the answers for that host (`rotationHost`'s `usable` is
  `Ability.mainHandAllowed` and `Ability.auraReachable`, so a Backstab rule on
  a sword, or an Ambush rule, is passed over and falls through, #155, #261;
  its `gated` is "requires an aura"), asks `ready` (`Ability.auraMet`) only of
  a gated rule, and
  returns shared, frozen results for a decision point that casts
  nothing (most of them).

The fight-level cost is the `npm run bench` result in the pull request: a 5
minute fight, median, interleaved against `main`. What is left is the walk
itself: the interpreter reads about 6 rules at a decision point where the code
rotation tried about 3 casts, and every condition is a call through the state
view.

## Validation

`js/rotation-validator.js` is the check a rotation passes before a fight. It
exports:

- `validateRotation(rotation, context)`: every error in reading order, as a
  frozen `{ code, path, message, ...data }` ([error codes](#error-codes)). An
  empty list means the rotation is valid.
- `assertValidRotation(rotation, context)`: returns the rotation, or throws a
  `RangeError` (`Bad rotation:` and one `path: message` line per error). It
  reports the same errors; a caller uses whichever suits it.
  `rotationProblems(rotation, context)` is the same lines as strings.
- `rotationContext(given)`: what a rotation is validated against, below.
- `abilityLabel(id)`: how a message writes an ability, `Cold Blood (cold-blood)`,
  or the id alone when the catalogue has no display name for it (#203).

The **path** says where (`rules[2].conditions[0].aura`; `""` is the rotation as
a whole) so a builder can mark the field. The **message** says what is wrong
and never where ([the message contract](#the-message-contract)). The string
forms write the path first, for example:

```text
rules[1].action: "nonsense" is not an ability in the spell data. The rogue casts: ...
rules[2].conditions[0].aura: "rupture" is a debuff on the target; use debuffActive, ...
```

| Case                               | Path                                      | What is wrong                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything the shape check rejects   | as in [the shape check](#the-shape-check) | The wrong version, a missing field, too many rules or conditions, and so on. The check carries on past them ([below](#carrying-on-past-shape-errors)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `rules: []`                        | `rules`                                   | A rotation with no rules casts nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Unknown ability id in `action`     | `rules[i].action`                         | Not an ability in the spell data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| An ability the rogue does not cast | `rules[i].action`                         | In the spell data (Garrote, Cheap Shot, ...), but the engine does not cast it yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Unknown condition `type`           | `rules[i].conditions[j].type`             | Lists the known types.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A param that is missing or wrong   | `rules[i].conditions[j].<param>`          | A missing or unknown param, or one of the wrong type (an operator not in `>= > <= < ==`, a `value` that is not a finite number, a non-boolean `active`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Unknown aura id                    | `rules[i].conditions[j].aura`             | `auraActive` and `auraRemaining` need a self buff. A target debuff id says to use the `debuff` types.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Unknown debuff id                  | `rules[i].conditions[j].debuff`           | `debuffActive`, `debuffRemaining` and `debuffStacks` need a target debuff. A self buff id says to use the `aura` types.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Unknown ability id in a condition  | `rules[i].conditions[j].ability`          | `cooldownReady`, `abilityGranted` and `abilityUnlocked` take an ability the rogue casts, as `action` does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A number out of range              | `rules[i].conditions[j].value`            | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A talent ability without its guard | `rules[i].conditions`                     | A rule that casts an ability a talent grants (`talentGrantedAbilities`, from the talent effects data: today Cold Blood, Blade Flurry, Adrenaline Rush and, since #207, Ghostly Strike, Hemorrhage and Premeditation) needs a guard on that ability among its conditions (issues #155 and #188), so a build without the talent never casts it. Cold Blood needs `{ "type": "abilityGranted", "ability": "cold-blood" }`. Until issue #199 the others take `abilityGranted` or `abilityUnlocked`; #199 makes `abilityGranted` required for all. The message writes the ability's display name and id (`Cold Blood (cold-blood)`, or the id alone when it has no display name, #203) and names the condition or conditions to add. |

**Ranges.** `resource` and `comboPoints`: `value` is between 0 and the pool's
maximum (`energy.max`, `combo.max`), and a whole number for combo points, so
`comboPoints >= 6` is refused and not left to never hold. Seconds
(`auraRemaining`, `debuffRemaining`, `fightTime`, `fightTimeRemaining`,
`energyToCap`): 0 or more, as a time is never negative. `debuffStacks`: a whole
number, from 0 up to the debuff's `maxStacks`. A number that is not finite is a
param of the wrong type, and is written in the message as `NaN` or `Infinity`
(not `null`, which is what `JSON.stringify` makes of them).

**The context** is which ids exist. `abilities` is every id in the spell data,
`castable` the abilities the rogue casts, `auras` the self buffs and `debuffs`
the target debuffs as `{ id: maxStacks }`, and `talentGrantedAbilities` the
abilities a talent grants, whose rules need a guard. The four lists are each
an array or a `Set` of id strings; a list is copied, `null` is taken as
absent, and anything else, such as a string or a plain object, is a
`TypeError` that says what was given (#207, #210). `debuffs` given as
anything but an object (an array, a `Map`, a number) is a `TypeError` too,
and so is a context that is not an object; a `null` context is none (#210).
Only an ordinary object is read as a context or as its `debuffs`: a `Map`
(#238 QA), a `WeakMap` or another built-in with contents that are not
properties (#248 QA) is refused, not quietly read as the defaults.
Each defaults to the engine's own (`js/ability-data.js`,
`js/abilities.js`, `js/auras.js`, and `talentGrantedAbilities` from
`js/talent-build.js`) and a caller may replace any of them, for a test or for a
build that has fewer abilities.

**What it does not check.** Whether a rule is reachable, or whether the order
makes sense. Some orders that pool by accident are [warnings](#warnings), not
errors.

`compileRotation` calls the validator, so `createFight`, `runFight` and
`SimRunner` reject an invalid rotation before the `Simulation` exists and so
before any rng draw. The validator's messages name ids. The talent-guard error, which the import UI shows, also writes the ability's display name beside its id (`abilityLabel(id)`, exported); the name is only written out, never compared.

### Carrying on past shape errors

Since #212 the validator does not stop at the first shape error, so an empty
`name` no longer hides what is wrong with the rules:

- It stops entirely only for a rotation that is not an object (`notAnObject`,
  path `""`) or another `schemaVersion` (`badSchemaVersion`): that one entry is
  all there is. A missing `schemaVersion` is a `missingField` and the check
  carries on.
- The top-level fields are checked one by one: missing and unknown fields
  first, then `name`, then `rules`. `rules: []` gives `noRules` and the name is
  still checked. A `rules` that is not an array (`rulesNotArray`) or has more
  than `rotation.maxRules` rules (`tooManyRules`) is not read any further.
- A rule that is not an object gives `ruleNotObject` alone. A missing
  `conditions`, or one that is not an array or is over
  `rotation.maxConditionsPerRule`, gives its shape errors and the rule is
  skipped. A missing `action`, or one that is not an id, skips only the action
  id check and the talent guard: its conditions are still checked. The rules
  after a broken one are still checked. An unknown field alone leaves the rule
  readable.
- A condition of the wrong shape (`conditionNotObject`, `conditionNoType`) is
  skipped; the others are checked. So every entry `rotationShapeErrors` gives
  is in `validateRotation`'s list too.
- The order is reading order, rule by rule: a rule's shape errors, its action,
  each condition, then its talent guard. No two entries share a path and code.

Only the entries that an early stop used to hide are new.
`rotationShapeErrors` is still the shape alone.

### Error codes

Every error is a frozen `{ code, path, message, ...data }`. The `code` is a
stable name for the kind of error, for a builder to switch on instead of
reading the message. The data fields
are the code's own, only where a view needs them: `field` and `param` name the
key, `max` is the limit, `resource` the pool, `ability` the ability id.

| Code                   | Data              | Path                             | When                                                    |
| ---------------------- | ----------------- | -------------------------------- | ------------------------------------------------------- |
| `notAnObject`          |                   | `""`                             | The rotation is not a plain object. Stops the check.    |
| `badSchemaVersion`     |                   | `schemaVersion`                  | Another version. Stops the check.                       |
| `missingField`         | `field`           | the field                        | A rotation or rule field is missing.                    |
| `unknownField`         | `field`           | the field                        | A rotation or rule field the shape does not have.       |
| `nameEmpty`            |                   | `name`                           | `name` is not a non-empty string.                       |
| `nameTooLong`          | `max`             | `name`                           | Longer than `rotation.maxNameLength`.                   |
| `rulesNotArray`        |                   | `rules`                          | `rules` is not an array; the rules are not read.        |
| `tooManyRules`         | `max`             | `rules`                          | More than `rotation.maxRules`; the rules are not read.  |
| `ruleNotObject`        |                   | `rules[i]`                       | A rule that is not an object.                           |
| `actionNotId`          |                   | `rules[i].action`                | Not an ability id (`Sinister Strike`).                  |
| `conditionsNotArray`   |                   | `rules[i].conditions`            | `conditions` is not an array.                           |
| `tooManyConditions`    | `max`             | `rules[i].conditions`            | More than `rotation.maxConditionsPerRule`.              |
| `conditionNotObject`   |                   | `rules[i].conditions[j]`         | A condition that is not an object.                      |
| `conditionNoType`      |                   | `rules[i].conditions[j].type`    | No non-empty string `type`.                             |
| `noRules`              |                   | `rules`                          | `rules: []`.                                            |
| `unknownAbility`       |                   | `rules[i].action`, or `.ability` | Not an ability in the spell data.                       |
| `notCastYet`           |                   | `rules[i].action`, or `.ability` | In the spell data, but the engine does not cast it yet. |
| `notSelfBuff`          |                   | `rules[i].conditions[j].aura`    | Not a self buff.                                        |
| `debuffAsBuff`         |                   | `rules[i].conditions[j].aura`    | A target debuff in an `aura` type.                      |
| `notDebuff`            |                   | `rules[i].conditions[j].debuff`  | Not a target debuff.                                    |
| `buffAsDebuff`         |                   | `rules[i].conditions[j].debuff`  | A self buff in a `debuff` type.                         |
| `unknownConditionType` |                   | `rules[i].conditions[j].type`    | Not a known condition type.                             |
| `missingParam`         | `param`           | `rules[i].conditions[j].<param>` | A param the type needs is missing.                      |
| `badParam`             | `param`           | `rules[i].conditions[j].<param>` | A param of the wrong kind.                              |
| `unknownParam`         | `param`           | `rules[i].conditions[j].<param>` | A param the type does not take.                         |
| `notWhole`             | `resource`        | `rules[i].conditions[j].value`   | Not a whole number for a whole pool (combo points).     |
| `outOfRange`           | `resource`, `max` | `rules[i].conditions[j].value`   | Outside 0 to the pool's maximum.                        |
| `negativeSeconds`      |                   | `rules[i].conditions[j].value`   | A time below 0.                                         |
| `badStacks`            |                   | `rules[i].conditions[j].value`   | A stack count that is not a whole number, 0 or more.    |
| `tooManyStacks`        | `max`             | `rules[i].conditions[j].value`   | More stacks than the debuff's `maxStacks`.              |
| `talentGuard`          | `ability`         | `rules[i].conditions`            | A talent ability's rule without its guard.              |
| `notText`              |                   | `""`                             | Import: the file is not a string.                       |
| `tooLarge`             | `max`             | `""`                             | Import: more than `rotation.maxImportChars` characters. |
| `notJson`              |                   | `""`                             | Import: not JSON, or nested too deeply to parse.        |

### The message contract

(#214.) A `message` says what is wrong and carries no place: no `rules[2]`,
no `The condition (comboPoints)` standing for a path. The place is the
`path`, and whoever prints the entry adds it:

- The string and thrown forms (`rotationProblems`, `assertValidRotation`,
  `rotationShapeProblems`, `assertRotationShape`, `conditionProblems`,
  `assertCondition` and the `RangeError` of `exportRotation`) write
  `formatError(entry)`: the raw path, `: `, then the message, or the message
  alone for the path `""`.
- A view writes its own readable place ("Rule 3, condition 2") from the path
  and shows the message beside it. The page's import box does
  (`errorLine`, `js/config-form.js`, #217): "Rotation name", "Rules",
  "Rule N" for anything about a rule, or "Rule N, condition M" for anything
  under a condition, then `: ` and the message; a problem with the file as a
  whole (the path `""`, or one that is none of these, such as
  `schemaVersion`) reads "File: " and the message. The rotation builder places each entry
  on its rule, condition or field and shows short copy chosen by `code`.

So the path and the text can no longer disagree (the `missingParam` path ends
`.value`, where the old text began `rules[i].conditions[j] (type)`). A message
still names the thing it is about: a type (`The comboPoints condition is
missing "value"`), an id (`"nonsense" is not an ability`) or an ability
(`Cold Blood (cold-blood) comes from a talent`). The same holds for
[warnings](#warnings).

## Warnings

`js/rotation-warnings.js` (issue
[#189](https://github.com/james-attree/wowf_dps_sim/issues/189)) points at
pooling traps in a rotation the validator accepts. The interpreter holds the
walk at an on-GCD rule whose conditions hold but which cannot be cast (see
[the interpreter](#the-interpreter)). That is by design, so a rule that holds
when its ability cannot be cast stops every rule below it. A warning is advice,
never a refusal: `validateRotation` is unchanged, a rotation with warnings
imports and runs, and nothing here changes what a fight casts.

- `rotationWarnings(rotation, context)`: every warning in rule order, as a
  frozen `{ code, path, message, ...data }`, as errors are
  ([warning codes](#warning-codes); the message carries no place,
  [the message contract](#the-message-contract)). `[]` means no trap was
  found, and a rotation the validator refuses gets `[]` too (its errors come
  first).
- `warningContext(given)`: what the warnings read, as lists of ability ids:
  `finishers` (the abilities that spend combo points, from the ability data's
  `spend`), `cooldowns` (a constants row `cooldown` above 0) and `onGcd` (the
  catalogue's `startsGcd`). A context may give any of them, each as an array
  or a `Set` of id strings, and the validator's own fields; what it leaves
  out, or gives as `null`, is the engine's. A list given as anything else (a
  string, `{}`) is a `TypeError` that names the field and says what was given
  (#207).
  `grantedNotTalent` and `unlockedNotTalent` read the validator's
  `talentGrantedAbilities`.

| Trap                                                                                                                                                                    | Path                  | Why it pools                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A finisher with no combo points condition that needs a combo point (`comboPoints`, or `resource` on `comboPoints`; one that holds at 0, such as `>= 0`, counts as none) | `rules[i].conditions` | It is cast at one combo point, and with none it can't be cast, so it holds back every rule below it.                                                                                                                                                                                                                                                                        |
| An on-GCD ability with a cooldown and no `cooldownReady` for it                                                                                                         | `rules[i].conditions` | While it is on cooldown it cannot be cast, so it holds back every rule below it. An off-GCD cooldown is passed over, not pooled for, so it is not warned for.                                                                                                                                                                                                               |
| An on-GCD rule with no conditions, or only ones that always hold, above another on-GCD rule                                                                             | `rules[i]`            | Whenever the GCD is clear it is cast or pooled for, so no on-GCD rule below it is reached. The last on-GCD rule, the usual builder, may have none. "Always hold" is the cheap case only: `>= 0` on `comboPoints`, a `resource`, `fightTime` or `fightTimeRemaining`, and an `abilityUnlocked` check on an ability no talent grants (`unlockedNotTalent`, Kira's QA on #216) |

Three more are not pooling traps but rules or checks that do nothing, or never let a rule cast:

| Trap                                                      | Path                     | Why                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A rule the same as one above it                           | `rules[i]`               | The one above is tried first under the same conditions, so this one is never reached. Compared after normalising: conditions in any order, keys in any order, and a param written out at its `CONDITION_PARAMS` default (`active: true`, `ready: true`) counts as left out. |
| An `abilityGranted` check on an ability no talent grants  | `rules[i].conditions[j]` | The fight grants only talent and host abilities, so it is never true and the rule never casts.                                                                                                                                                                              |
| An `abilityUnlocked` check on an ability no talent grants | `rules[i].conditions[j]` | Only a talent ability can be locked, so it is always true and does nothing. It also counts as always holding for `starves`.                                                                                                                                                 |
| A condition the same as an earlier one of its rule        | `rules[i].conditions[j]` | It changes nothing. Compared as rules are; a repeated `abilityUnlocked` check on an ability no talent grants gets `unlockedNotTalent` instead.                                                                                                                              |

One cause gives one warning: a rule that repeats an earlier one gets only
`duplicateRule`, and is left out of every `starves` `below` (a duplicated
Backstab is not said to starve itself). For `duplicateRule` a condition
repeated within a rule counts once and an `abilityUnlocked` check on an
ability no talent grants not at all, since neither changes what the rule
does: Sinister Strike with no conditions, then Sinister Strike with only
that check, is one rule twice (#215, #216). A rule with a `grantedNotTalent`
check never casts, so it gets only that warning (one per such check), holds
nothing back, and is left out of every `starves` `below` too. A finisher with
`finisherNoComboPoints` and no on-GCD rule above it that can cast waits at 0
combo points, and does not also get `starves` (#207); with such a rule above
to build the points it does cast, so it gets `starves` as well, with its
`below` (Kira's QA on #216). "Every rule below it" counts the on-GCD rules
below that can cast: with none, a finisher or cooldown message says the
rotation waits at it instead.

### Warning codes

| Code                    | Data                           | Path                     | When                                                                                                                                                            |
| ----------------------- | ------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicateRule`         | `ability`, `same`              | `rules[i]`               | The same as the rule at index `same` above it. The rule's only warning.                                                                                         |
| `finisherNoComboPoints` | `ability`, `condition`         | `rules[i].conditions`    | A finisher with no combo points condition that needs a point. `condition` is the index of its combo points condition that holds at 0, or `null`.                |
| `cooldownNotChecked`    | `ability`                      | `rules[i].conditions`    | An on-GCD cooldown with no `cooldownReady` for it.                                                                                                              |
| `grantedNotTalent`      | `ability`, `condition`         | `rules[i].conditions[j]` | `abilityGranted` on `ability`, which no talent grants; `condition` is `j`. One per such condition. The rule never casts: its only warnings.                     |
| `unlockedNotTalent`     | `ability`, `condition`         | `rules[i].conditions[j]` | `abilityUnlocked` on `ability`, which no talent grants, so it is always true; `condition` is `j`. One per such condition.                                       |
| `duplicateCondition`    | `ability`, `condition`, `same` | `rules[i].conditions[j]` | The same as condition `same` of the rule, earlier; `condition` is `j`. One per repeat, except an `unlockedNotTalent` one.                                       |
| `starves`               | `ability`, `below`, `reason`   | `rules[i]`               | Its conditions always hold. `below` is the index of every on-GCD rule below it that can cast (frozen, rule order); `reason` is `noConditions` or `alwaysHolds`. |

`ability` is always the rule's action, except for `grantedNotTalent` and
`unlockedNotTalent`, where it is the condition's. Per rule the order is
`finisherNoComboPoints`, `cooldownNotChecked`, then `grantedNotTalent` and
`unlockedNotTalent` in condition order, then `duplicateCondition` in
condition order, then `starves`.

The default rotation, every preset and every example below give no warnings
(test/rotation-warnings.test.js). A message names the ability as the
talent-guard error does, display name and id (`abilityLabel`, #203), and
its advice fits the case (#207): it names the condition to add, but a
finisher whose combo points condition holds at 0 is told to change it to
need at least one, and a rule none of whose conditions can fail is told to
change them so they are sometimes false. On a rule with no on-GCD rule below
it that can cast, which has nothing to hold back, it says the rotation waits
there instead. The wording
is Fran's (#207), with the message contract (#214). In the string form:

```text
rules[0].conditions: Eviscerate (eviscerate) is a finisher, but its rule has no combo points condition. It is cast at one combo point, and with none it can't be cast, so it holds back every rule below it. Add one, such as { "type": "comboPoints", "op": ">=", "value": 5 }.
rules[0]: Sinister Strike (sinister-strike) starts the global cooldown and its rule has no conditions, so it is cast or waited for whenever the global cooldown is clear. The 2 rules below it for Backstab (backstab) and Eviscerate (eviscerate) never cast. Give it conditions or move it below them.
rules[3]: Backstab (backstab) is never reached: a rule above it casts it under the same conditions. Delete this one.
rules[1].conditions[0]: Sinister Strike (sinister-strike) isn't granted by a talent, so 'is granted' is never true here and this rule never casts.
rules[0].conditions[1]: Eviscerate (eviscerate) doesn't need a talent, so 'is not locked' is always true and does nothing.
rules[2].conditions[1]: This condition is the same as an earlier one in the rule for Sinister Strike (sinister-strike), so it changes nothing. Delete it.
```

`unlockedNotTalent` is about abilities no talent grants. A talent ability's
`abilityUnlocked` check is not warned for, though with no build selected it
is true too: since #199 no build is untalented, so the engine passes over
that rule anyway (see "Granted and unlocked: no build selected").

The warnings do not know the fight: an unconditional Backstab rule is warned
for even though, without a dagger main hand, the interpreter passes it over.

## The readable summary

`js/rotation-summary.js` writes a rotation as plain text, for the builder, a
preset's description and an error report. It is a display-edge helper: the
engine does not import it, and the ability and aura names come from the
catalogue (`js/abilities.js`) and the aura definitions (`js/auras.js`) when a
line is written. An id with no display name is written as the id. It does not
validate; it reads a rotation that has the right shape (a `TypeError` for
something that is not a rotation, rule or condition object).

- `summarizeCondition(condition)`: one condition.
- `summarizeRule(rule)`: `<Ability> if <condition> and <condition>`, or
  `<Ability> (always)` for a rule with no conditions.
- `summarizeRotation(rotation)`: the name, then one numbered line per rule in
  priority order, highest first.

```text
Default (Combat)
1. Blade Flurry if Blade Flurry is not locked by the build and Blade Flurry is ready and Energy >= 25
2. Adrenaline Rush if Adrenaline Rush is not locked by the build and Adrenaline Rush is ready
3. Slice and Dice if CP >= 5 and Slice and Dice missing or < 1s left
4. Slice and Dice if CP >= 5 and Slice and Dice missing or <= 5s left and Energy >= 100
5. Cold Blood if Cold Blood is granted and CP >= 5 and Slice and Dice has > 10s left
6. Eviscerate if CP >= 5
7. Sinister Strike (always)
```

| Type                                | Line                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `resource`                          | `Energy >= 40`, `CP == 5` (a pool without a label is written by its id)                 |
| `comboPoints`                       | `CP >= 5`                                                                               |
| `auraActive`                        | `Slice and Dice is up`, `Cold Blood is not up`                                          |
| `auraRemaining`                     | `Slice and Dice missing or <= 3s left`, `Slice and Dice has > 10s left`                 |
| `debuffActive`                      | `Rupture is up on the target`, `Rupture is not up on the target`                        |
| `debuffRemaining`                   | `Rupture on the target missing or <= 2s left`, `Hemorrhage on the target has > 2s left` |
| `debuffStacks`                      | `Expose Armor on the target has >= 5 stacks`                                            |
| `cooldownReady`                     | `Blade Flurry is ready`, `Blade Flurry is on cooldown`                                  |
| `fightTime`, `fightTimeRemaining`   | `fight time >= 10s`, `fight time left < 20s`                                            |
| `energyToCap`                       | `time to energy cap > 1.5s`                                                             |
| `abilityGranted`, `abilityUnlocked` | `Cold Blood is granted`, `Adrenaline Rush is not locked by the build`                   |

A thing that is not there counts as 0 s left, so `auraRemaining` and
`debuffRemaining` write "missing or" when the comparison holds for 0 (`<= 3`,
`< 3`, `>= 0`) and "has" when it does not (`> 10`).

## Presets

R5 ([#142](https://github.com/james-attree/wowf_dps_sim/issues/142)) adds
rotations to pick from. A preset is a rotation (the JSON above) with an id, a
name and a short description, held as data in `data/rotation-presets.js`. The
API is `js/rotation-presets.js`, with no DOM, so a page, a worker or a test
calls it the same way.

**Live presets.** James, 5 Nov 2026: the old four presets are scrapped.
`ROTATION_PRESETS` holds `combat-swords-temp` ("Combat swords (temporary)")
and, from 10 Nov 2026 ([#340](https://github.com/james-attree/wowf_dps_sim/issues/340),
TR-10), `combat-daggers` ("Combat daggers") and `assassination-daggers`
("Assassination daggers"). Combat swords stays temporary
and stays `pageDefaultConfig()`. The start screen offers those two cards
and Custom. The sections
[combat-swords](#combat-swords), [assassination-daggers](#assassination-daggers),
[subtlety-daggers](#subtlety-daggers) and [combat-daggers](#combat-daggers)
below are the pre-70755 record. They are not presets. Frozen link bases that
still decode are `defaults` and the pre-Shank `combat-swords-temp`. A link the
live catalogue rejects loads the default with no notice (James, 5 Nov 2026, #331).

**TR-10, one link at a time.** Append a `LINK_BASES` entry. Add a golden and a
lock test. Update the `deepEqual` in `test/short-links-306.test.js` that
expects the preset ids to be exactly `["combat-swords-temp", "combat-daggers", "assassination-daggers"]`
(`LINK_BASES` entries that set `preset`). James, 1 Nov 2026: the old preset
reference builds set Instant on the main hand and Deadly on the off hand, and
those presets are historical. James, 5 Nov 2026: this temporary preset uses
Instant on the main hand and Deadly on the off hand.

There is no `deathMarkStored` condition (James, 5 Nov 2026). `shank` and
`death-mark` are actions. `cooldownReady` covers both. Aura conditions cover
`venom`, `poised` and `ambush-window`. Debuff conditions cover `death-mark`.
James, 9 Nov 2026: the Shank off-hand warning is dropped. Every build has an
off hand, and Shank has no `requiresOffHand`. A Shank rule that skips its
cooldown still gets `cooldownNotChecked`. James, 31 Oct 2026: Ambush stays
freely addable, with no lock, warning, or explanatory note. Without Ghostly
Strike the host's `usable` is false, so the rule is passed over.

- `listPresets()`: `[{ id, name, description, summary }]` in registry order.
  `summary` is the rotation as text ([The readable summary](#the-readable-summary)).
- `presetRotation(id)`: a new copy of the preset's rotation. An id that is not a
  preset is a `RangeError` that lists the ids.
- `loadPreset(id, config)`: a copy of `config` (a SimConfig, or nothing) with
  `rotation` set to the preset's. The input is not changed. `createFight`,
  `runFight` and `SimRunner` take the result like any config.

Every preset passes `validateRotation` when the module is imported, so a bad
preset in the data never reaches a fight. **The default fight keeps the
placeholder rotation** (example 1 below) unless a preset is loaded, so a fight
with no preset is the fight it was before. The page's "Fight setup" form lists
the presets with `listPresets` and loads one with `presetRotation`
(`js/config-form.js`, #151).

The temporary preset's Shank threshold (energy below 50) is written in
`data/rotation-presets.js`, not in a `presetRotation.*` row. The older rows
(`presetRotation.combat`, `presetRotation.assassination`,
`presetRotation.subtlety`, `presetRotation.combatDaggers`) are the pre-70755
links (James, 2 Nov 2026, #310 and #328), tagged `assumption`. They are not
selectable. `test/presets-310.test.js` still compares those frozen links where
the suite has not retired the case.

Since [#278](https://github.com/james-attree/wowf_dps_sim/issues/278) (P5-03a,
Decision 6 of the Phase 5 plan) every preset opens with two rules the links
predate: Blood Fury, then Elune's Light, each guarded by `abilityGranted` and
nothing else (`ON_USE_RACIALS` in `data/rotation-presets.js`). Only the race
grants them (Orc and Night Elf, `config.race`), so with no race, or another
race, both rules are passed over and the fight is the fight it was before
(`test/on-use-racials.test.js`). Both are off the GCD (A21, an assumption), so
an off-GCD rule that holds and cannot be cast (on cooldown) is passed over and
they need no "is ready": each is cast at the pull and again as its cooldown
ends. `test/presets-310.test.js` compares the rest with the link. A rule
casting either needs `abilityGranted` (the validator's `talentGuard`, which
names the race); `abilityUnlocked` does not guard it, as a build never
unlocks a racial. The builder's palette offers each one, as "Blood Fury
(racial)" and so on, only when the chosen race grants it, with the "Race or
talent granted" guard; a rule for another race's racial reads "Not your race
(Orc only)" (P5-04, #280).

[#279](https://github.com/james-attree/wowf_dps_sim/issues/279) (P5-03b) adds
Berserking (Troll) and Eureka! (Gnome) the same way, as rules 3 and 4 of
every preset (Scout, 2 Nov 2026, on #315; see
[Berserking and Eureka!](mechanics.md#berserking-and-eureka-p5-03b-issue-279)).
Each racial rule added about 112 characters to a version-1 share link:
combat-swords' was 2,199 with all four, under the app's cap (`LINK_CAP`,
8,192, in `js/views/share-link.js`). Since #306 a share link is version 2
(`js/link-codec.js`), which names a preset and sends only what differs from
it, so a preset's link is 17 characters after the page's address and one
with a typical edit is under 40. The test budget (`PRESET_LINK_MAX` in
`test/build-codec.test.js`), 2,048 for #284 and 4,096 for #315, is now 64
characters after the address.

### combat-swords-temp

Temporary (TR-03 / #333, Shank wired in TR-04 / #337). It stays the page
default. Talents 16/35/0. Swords MH 100–187 at 2.6 s and OH 90–168 at 2.5 s
(`assumption` until a gear link). Instant main hand, Deadly off hand (James,
5 Nov 2026). Race unchanged. The rotation is the old Combat swords list
without Cold Blood, plus Shank when energy is below 50 and Shank is ready
(James, 5 Nov 2026: that is the only Shank rule). Its summary:

```text
Combat swords (temporary)
1. Blood Fury if Blood Fury is granted
2. Elune's Light if Elune's Light is granted
3. Berserking if Berserking is granted
4. Eureka! if Eureka! is granted
5. Slice and Dice if CP >= 3 and Slice and Dice missing or < 1s left
6. Adrenaline Rush if Adrenaline Rush is not locked by the build and Adrenaline Rush is ready and Energy < 25 and Slice and Dice is up
7. Blade Flurry if Blade Flurry is not locked by the build and Blade Flurry is ready and Slice and Dice is up
8. Shank if Shank is ready and Energy < 50
9. Eviscerate if CP >= 5 and Slice and Dice has >= 12s left
10. Sinister Strike if CP < 5
11. Eviscerate if CP >= 3 and time to energy cap < 1s
```

The share-link base for this rotation is `combat-swords-temp-337`. The id
`combat-swords-temp` in `LINK_BASES` is the frozen pre-Shank copy, not a
second preset. The page default encodes as `2.BgA`.

### combat-daggers

TR-10 / #340. James, 10 Nov 2026: the temporary Combat swords rotation with
Sinister Strike replaced by Backstab. Talents 13/35/3 from his 70755 link.
Weapons are the #328 reference daggers (main hand 73–137 at 1.8 s, off hand
59–111 at 1.6 s). The sheet is `character.dagger` (769 attack power, 22.14%
crit). James, 10 Nov 2026: that is an assumption, because those stats come
from Core Hound Tooth while the off hand is the unnamed 59–111. Instant main
hand, Deadly off hand. The share-link base is
`combat-daggers-340`. Its summary:

```text
Combat daggers
1. Blood Fury if Blood Fury is granted
2. Elune's Light if Elune's Light is granted
3. Berserking if Berserking is granted
4. Eureka! if Eureka! is granted
5. Slice and Dice if CP >= 3 and Slice and Dice missing or < 1s left
6. Adrenaline Rush if Adrenaline Rush is not locked by the build and Adrenaline Rush is ready and Energy < 25 and Slice and Dice is up
7. Blade Flurry if Blade Flurry is not locked by the build and Blade Flurry is ready and Slice and Dice is up
8. Shank if Shank is ready and Energy < 50
9. Eviscerate if CP >= 5 and Slice and Dice has >= 12s left
10. Backstab if CP < 5
11. Eviscerate if CP >= 3 and time to energy cap < 1s
```

### assassination-daggers

James, 10 Nov 2026 (#340). Talents 37/11/3 from his 70755 link. Same daggers
and the same `character.dagger` sheet assumption as Combat daggers. Instant
main hand, Deadly off hand. The share-link base is `assassination-daggers-340`.
Mutilate stops below 4 combo points, the same cap Combat swords uses for its
builder, and only at 50 or more energy so Shank's rule is reached. The four
racials are the opening every live preset uses. Its summary:

```text
Assassination daggers
1. Blood Fury if Blood Fury is granted
2. Elune's Light if Elune's Light is granted
3. Berserking if Berserking is granted
4. Eureka! if Eureka! is granted
5. Slice and Dice if CP >= 4 and Slice and Dice missing or < 2s left
6. Rupture if CP >= 4 and Rupture on the target missing or < 2s left
7. Eviscerate if CP >= 4 and Slice and Dice has > 10s left and Rupture on the target has > 10s left
8. Cold Blood if Cold Blood is granted and Cold Blood is ready
9. Mutilate if Mutilate is not locked by the build and CP < 4 and Energy >= 50
10. Shank if Shank is ready and Energy < 50
```

### combat-swords

Historical. Not in `ROTATION_PRESETS` after 5 Nov 2026. The record of James's
2 Nov 2026 share link (#310):

Slice and Dice recast at 3 combo points or more just before it ends,
Adrenaline Rush (under 25 energy) and Blade Flurry with Slice and Dice up,
Eviscerate at 5 combo points with Cold Blood while Slice and Dice has 12 s or
more, Sinister Strike to build, and Eviscerate at 3 combo points or more to
spend energy at the cap. It casts nothing that needs a dagger, so it runs on
any main hand. Its summary (`summarizeRotation`, checked against this block by
`test/rotation-presets.test.js`):

```text
Combat swords
1. Blood Fury if Blood Fury is granted
2. Elune's Light if Elune's Light is granted
3. Berserking if Berserking is granted
4. Eureka! if Eureka! is granted
5. Slice and Dice if CP >= 3 and Slice and Dice missing or < 1s left
6. Adrenaline Rush if Adrenaline Rush is not locked by the build and Adrenaline Rush is ready and Energy < 25 and Slice and Dice is up
7. Blade Flurry if Blade Flurry is not locked by the build and Blade Flurry is ready and Slice and Dice is up
8. Cold Blood if Cold Blood is granted and CP >= 5 and Slice and Dice has > 5s left
9. Eviscerate if CP >= 5 and Slice and Dice has >= 12s left
10. Sinister Strike if CP < 5
11. Eviscerate if CP >= 3 and time to energy cap < 1s
```

The numbers are `presetRotation.combat`:

- 1 and 2: Blood Fury and Elune's Light, cast only when the race grants them
  ([#278](https://github.com/james-attree/wowf_dps_sim/issues/278), above).
- 3 and 4: Berserking and Eureka!, cast only when the race grants them
  ([#279](https://github.com/james-attree/wowf_dps_sim/issues/279), above).
- 5: Slice and Dice at `sliceAndDiceComboPoints` (3) or more with less than
  `sliceAndDiceRecastSeconds` (1 s) left. If it holds and the energy is short,
  the walk stops: the rotation pools energy for it. James's link opens with a
  second Slice and Dice rule at 5 combo points with the same time; it is the
  same rule with more points, so it never decides, and it is folded into this
  one (the same damage and casts in all 1,500 fights checked: 500 seeds at
  60 s, 120 s and 300 s; `test/presets-310.test.js` repeats it on 40 seeds).
- 6: Adrenaline Rush under `adrenalineRushEnergyBelow` (25) energy, with Slice
  and Dice up.
- 7: Blade Flurry with Slice and Dice up. The link gives it no energy
  condition, so when it holds and its energy is short the walk pools for it.
- 6 and 7 carry `abilityUnlocked` because a rule for an on-GCD ability that
  holds and cannot be cast ends the walk
  ([The interpreter](#the-interpreter)): without it, a build with Blade Flurry
  or Adrenaline Rush locked would stop at that rule and cast nothing else.
- 8: Cold Blood (off the GCD) with `abilityGranted` at
  `finisherComboPoints` (5) while Slice and Dice has more than
  `coldBloodSliceAndDiceSeconds` (5 s), so its charge goes on the Eviscerate
  that follows.
- 9: Eviscerate at 5 combo points while Slice and Dice has
  `eviscerateSliceAndDiceSeconds` (12 s) or more. Below that, with 5 combo
  points, no rule but 11 holds, so the rotation waits.
- 10: Sinister Strike below 5 combo points.
- 11: Eviscerate at 3 combo points or more when energy is less than
  `energyToCapSeconds` (1 s) from the cap, so the energy is not wasted.

#### Slice and Dice and energy (#122)

From [#122](https://github.com/james-attree/wowf_dps_sim/issues/122) to #310
this preset kept Slice and Dice with a pair of rules: recast at 5 combo points
with less than `rotation.pooling.recastSeconds` (1 s) left, or with at most
`rotation.pooling.windowSeconds` (5 s) left at the energy cap, with Eviscerate
and the builder held inside the window so energy was pooled for the recast.
The placeholder rotation still uses that pair (#155, example 1 below); the
preset now recasts at 3 combo points (rule 3) and holds Eviscerate below 12 s
of Slice and Dice (rule 7) instead.

#### Hazards

- A Backstab rule on a main hand that is not a dagger never casts (Backstab is
  refused, see [mechanics](mechanics.md)). It is passed over, as if its
  conditions had failed, so the walk goes on to the rules below it (#155; before
  that it ended the walk every time it held and the rotation pooled forever).
  There is no weapon-type condition: the host's `usable` answers it from the
  fight's main hand, so the same list works on daggers and on a sword. The
  validator does not know the weapon.
- An Ambush rule casts only after Ghostly Strike: Ambush needs a dagger and the
  ambush window (id `ambush-window`, standing in for Stealth), and the sim
  models no stealth (#261, TR-06 / #335, see [mechanics](mechanics.md)). A landed
  Ghostly Strike opens the window for 7 s and one charge. Without Ghostly Strike
  the host's `usable` is false for it on any weapon, so it is passed
  over in the same way. With Ghostly Strike, the rule is passed over while the window
  is down and cast while it is up (on a dagger). A
  rotation may still hold an Ambush rule: the validator and the warnings say
  nothing about it. Mutilate needs a dagger in both hands (#267): with any
  other weapon in either hand its rule is passed over in the same way, and
  nothing is said about it.
- Expose Armor (#268) is a finisher in the palette, so a rule for it takes a
  combo points condition like any finisher. It is baseline and rolls the
  attack table, so it can miss (#294). No preset casts it. The 25-energy Venom
  finisher is not in the palette (#334).
- Preparation (#270) is a talent cooldown in the palette's Cooldowns group
  ("Preparation (talent)"). Its rule needs an `abilityGranted` or
  `abilityUnlocked` guard. It finishes the cooldowns of Cold Blood,
  Premeditation, Ghostly Strike, Adrenaline Rush and Blade Flurry, so a rule
  usually casts it while one of those is on cooldown, for example with
  `{ "type": "cooldownReady", "ability": "ghostly-strike", "ready": false }`.
  subtlety-daggers casts it (#272).

### assassination-daggers

Historical. Not a preset after 5 Nov 2026.

Issues [#272](https://github.com/james-attree/wowf_dps_sim/issues/272) and
#310. Finishers at 4 combo points: Slice and Dice kept up, Eviscerate with
spare energy, Cold Blood for Mutilate, Mutilate to build. No Rupture. The
25-energy Venom finisher is not in this rotation (#334). It is written for
daggers and its reference build
(`data/preset-reference-builds.js`, below): Mutilate needs a dagger in both
hands, so on other weapons its rule is passed over. Its summary:

```text
Assassination
1. Blood Fury if Blood Fury is granted
2. Elune's Light if Elune's Light is granted
3. Berserking if Berserking is granted
4. Eureka! if Eureka! is granted
5. Slice and Dice if CP >= 4 and Slice and Dice missing or < 1s left
6. Slice and Dice if CP >= 4 and Slice and Dice missing or <= 5s left and Energy >= 100
7. Eviscerate if CP >= 4 and Energy >= 75
8. Cold Blood if Cold Blood is granted and CP < 5
9. Mutilate if Mutilate is granted and CP < 4
```

The numbers are `presetRotation.assassination`:

- 1 and 2: Blood Fury and Elune's Light, cast only when the race grants them
  ([#278](https://github.com/james-attree/wowf_dps_sim/issues/278), above).
- 3 and 4: Berserking and Eureka!, cast only when the race grants them
  ([#279](https://github.com/james-attree/wowf_dps_sim/issues/279), above).
- 5 and 6: Slice and Dice at `finisherComboPoints` (4) with less than
  `sliceAndDiceRecastSeconds` (1 s) left, or with at most
  `sliceAndDiceWindowSeconds` (5 s) left at `sliceAndDiceEnergy` (100) energy.
- 7: Eviscerate at 4 combo points with `eviscerateEnergy` (75) energy or more.
  With the reference build it was cast on 173 of 200 seeds at 60 s (mean 1.1)
  and on all 200 at 300 s (mean 6.2).
- 8: Cold Blood below `coldBloodBelowComboPoints` (5), so its charge goes on
  the next Mutilate or finisher.
- 9: Mutilate below 4 combo points.

No Expose Armor and no stealth opener.

### subtlety-daggers

Historical. Not a preset after 5 Nov 2026.

Issues [#272](https://github.com/james-attree/wowf_dps_sim/issues/272) and
#310. Rupture kept up at 5 combo points, Premeditation, Preparation once Ghostly
Strike is on cooldown, Slice and Dice at 3 combo points while Rupture has 10 s
or more, Ghostly Strike on cooldown and Hemorrhage to build. No Eviscerate, no
Ambush and no Backstab. Written for daggers and its reference build (the
Hemorrhage and Ghostly Strike build of James's link). Its summary:

```text
Subtlety
1. Blood Fury if Blood Fury is granted
2. Elune's Light if Elune's Light is granted
3. Berserking if Berserking is granted
4. Eureka! if Eureka! is granted
5. Rupture if CP >= 5 and Rupture on the target missing or < 1s left
6. Premeditation if Premeditation is granted and CP <= 3
7. Preparation if Preparation is granted and Preparation is ready and Ghostly Strike is on cooldown
8. Slice and Dice if CP >= 3 and Rupture on the target has >= 10s left and Slice and Dice missing or < 2s left
9. Ghostly Strike if Ghostly Strike is granted and CP < 5 and Ghostly Strike is ready
10. Hemorrhage if Hemorrhage is granted and CP < 5
```

The numbers are `presetRotation.subtlety`:

- 1 and 2: Blood Fury and Elune's Light, cast only when the race grants them
  ([#278](https://github.com/james-attree/wowf_dps_sim/issues/278), above).
- 3 and 4: Berserking and Eureka!, cast only when the race grants them
  ([#279](https://github.com/james-attree/wowf_dps_sim/issues/279), above).
- 5: Rupture at `ruptureComboPoints` (5) with less than `ruptureRecastSeconds`
  (1 s) left on the target. With the reference build it is cast on every seed
  (mean 4.2 at 60 s, 20.0 at 300 s, 200 seeds).
- 6: Premeditation (off the GCD) at `premeditationMaxComboPoints` (3) or
  fewer, so its 2 combo points fit under 5. An off-GCD rule that cannot be
  cast is passed over, so it needs no "is ready".
- 7: Preparation while Ghostly Strike is on cooldown; it finishes the
  cooldowns of Premeditation and Ghostly Strike (`preparation.resets`). Its
  cooldown is 600 s, so it is cast once in a fight of 10 minutes or less.
- 8: Slice and Dice at `sliceAndDiceComboPoints` (3) or more while Rupture has
  `sliceAndDiceRuptureSeconds` (10 s) or more left, when Slice and Dice is
  missing or has less than `sliceAndDiceRecastSeconds` (2 s) left.
- 9: Ghostly Strike when it is ready, below `builderBelowComboPoints` (5).
- 10: Hemorrhage below 5 combo points: the builder.

#### Reference builds (#272)

`data/preset-reference-builds.js` holds the build each live preset is written
for. `combat-swords-temp` is level 60, the 16/35/0 talents in
`data/reference-build.js`, the default swords, Instant on the main hand and
Deadly on the off hand (James, 5 Nov 2026, #333). `combat-daggers` is level
60, the 13/35/3 talents from James's 10 Nov 2026 link, the #328 daggers, the
`character.dagger` sheet, and the same poisons. `assassination-daggers` is
level 60, the 37/11/3 talents from his other 10 Nov 2026 link, those daggers,
that sheet, and those poisons. The
1 Nov ruling is the historical reference builds, which this file no longer
stores. `loadPreset` sets the rotation only. The page default
(`pageDefaultConfig`) copies talents, weapons, poisons and the rotation.
`referenceBuild(id)` returns a copy. The constant
`presetReferenceBuild.poisons` still lists the scrapped ids; those are not
presets. `js/preset-reference-builds.js` (re-exported by
`js/rotation-presets.js`) is the API: `referenceBuild(id)` (a copy),
`talentDifferences(build, talents)` (each talent whose rank differs),
`weaponTypeDifferences(build, weapons)` (the type in each hand) and
`referenceWeapon(build, hand)` (a hand to put into `config.weapons`),
`poisonDifferences(build, poisons)` (the poison id in each hand) and
`referencePoison(build, hand)` (a hand's poison id for `config.poisons`).
`combat-daggers` and `assassination-daggers` also carry the `character.dagger`
attack power and crit. Combat swords does not.

### combat-daggers

Historical. Not a preset after 5 Nov 2026.

Issue [#328](https://github.com/james-attree/wowf_dps_sim/issues/328). James's
Combat daggers link as sent: every finisher at 4 combo points, Slice and Dice
recast just before it ends or early at full energy, then Eviscerate, and
Backstab to build. Blade Flurry and Adrenaline Rush are talented but no rule
casts them, so the talent check that guards them in combat-swords does not
apply. Written for daggers and its reference build (16/33/2, the dagger
presets' daggers, Instant Poison on the main hand and Deadly on the off hand:
the link has no poisons, so it follows the dagger presets, an assumption). Its
summary:

```text
Combat daggers
1. Blood Fury if Blood Fury is granted
2. Elune's Light if Elune's Light is granted
3. Berserking if Berserking is granted
4. Eureka! if Eureka! is granted
5. Slice and Dice if CP >= 4 and Slice and Dice missing or < 1s left
6. Slice and Dice if CP >= 4 and Slice and Dice missing or <= 5s left and Energy >= 100
7. Eviscerate if CP >= 4
8. Backstab if CP < 4
```

The numbers are `presetRotation.combatDaggers`:

- 1 to 4: the on-use racials, cast only when the race grants them (above).
- 5 and 6: Slice and Dice at `finisherComboPoints` (4) or more, with less than
  `sliceAndDiceRecastSeconds` (1 s) left, or at most
  `sliceAndDiceWindowSeconds` (5 s) left with `sliceAndDiceEnergy` (100)
  energy.
- 7: Eviscerate at 4 combo points or more.
- 8: Backstab below 4 combo points: the builder. Its check is the link's, a
  `resource` condition on `comboPoints`, which reads the same as a
  `comboPoints` one.

## Import and export

R6 ([#143](https://github.com/james-attree/wowf_dps_sim/issues/143)) writes a
rotation as text and reads it back. `js/rotation-io.js` is pure (text in, text
or a result out) and reads no file, the clipboard or the DOM; a page or a tool
does that and hands the text over: the page's "Fight setup" form does
(`js/config-form.js`, #151).

- `exportRotation(rotation)`: the canonical JSON text of a valid rotation. An
  invalid one is a `RangeError` (`Bad rotation:` and one message per line), so a
  bad file is never written.
  The page's Export… button never gets that far: while the rotation on screen
  (a rotation builder draft, #217) has errors it is off (`aria-disabled`, with
  "Export is off: the rotation has N errors."), the same as Run.
- `importRotation(text)`: `{ ok, rotation, errors, warnings }`. `ok` is `true`, with the
  rotation and `errors: []`, when the text is a valid rotation. Otherwise `ok`
  is `false`, `rotation` is `null` and `errors` is the list of `{ code, path, message, ...data }` that [the validator](#validation) gives,
  or one error with the path `""` and its own code when the text as a whole is wrong (`notText`, `tooLarge`, `notJson`; [error codes](#error-codes)).
  `warnings` (#189) is what [`rotationWarnings`](#warnings) gives for an
  accepted rotation, cut like the errors; a rotation with warnings is still
  `ok`, and a refused one has `warnings: []`. The page's form imports it and
  shows the warnings under the status line, in the same place as a refused
  file's errors, without blocking it.

**How many the form lists.** `importRotation` and the validator return every
error, and `rotationWarnings` every warning: there is no cap on the lists
(a 50-rule file of unknown params gives some 18,000 errors). The page's form
lists the first `rotation.maxListedEntries` (50) of a refused file's errors,
or of an accepted file's warnings, one per line, then one line
`…and N more` for the rest (`listedLines`, `js/config-form.js`, #214). Only
the text shown is cut. The counts are of all of them: the status line's
"with N warnings" is the whole list, and the Run bar's "settings to fix" is
unchanged by an import (a refused file blocks nothing).

**The file.** UTF-8 text, a rotation exactly as [the model](#the-model) has it,
written the same way every time: the keys of every object in sorted order
(UTF-16 code unit order, not the locale's), two spaces per level, `\n` line
ends and one newline at the end. The rules and conditions keep their order,
because the order of the rules is the priority. For the smallest rotation:

```text
{
  "name": "Builder only",
  "rules": [
    {
      "action": "sinister-strike",
      "conditions": []
    }
  ],
  "schemaVersion": 1
}
```

**Canonical and stable.** The same rotation always gives the same text, however
its keys were ordered when it was made. Export, import, export gives the same
text byte for byte, and a rotation read from an exported file runs to the same
result (totals, log and rng draws) as the original, for every preset.
`importRotation` accepts any valid JSON layout (other spacing, key order, `\r\n`,
a byte-order mark at the start), and what it returns exports to the canonical
text. A key written twice in the file is read as JSON reads it: the last one
counts.

**What import does with a file it does not trust:**

| Case                                                    | Result                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not a string                                            | One error, path `""`.                                                                                                                                        |
| More than `rotation.maxImportChars` (131072) characters | One error, path `""`, checked before anything is parsed.                                                                                                     |
| Not JSON, or nested too deeply to parse                 | One error, path `""`, with the parser's message.                                                                                                             |
| JSON that is not a rotation (`null`, an array, ...)     | The shape error, path `""`.                                                                                                                                  |
| Another `schemaVersion`                                 | One error, path `schemaVersion`; the rest of the file is not read ([how it is checked](#the-four-decisions)).                                                |
| An unknown field at any level                           | An error that names the field and lists the allowed ones, path to the field. This includes `__proto__` and `constructor`, so they are refused like any typo. |
| An invalid rule or condition                            | The validator's errors, each with its path (`rules[2].conditions[0].aura`).                                                                                  |

A message echoes the value that was wrong, so a path or message longer than
`rotation.maxErrorChars` (1000 code points, not UTF-16 units; the longest ordinary one is about 250) is cut and ends in `…`. A file at the size limit cannot make a 100,000
character message. Unlike `rotation.maxNameLength` and
`rotation.maxImportChars`, which count UTF-16 units (a JavaScript string's
length), this counts code points, so an emoji written as a surrogate pair is
never split and the cut text is always well-formed. A ZWJ emoji sequence
(several code points shown as one) can still be cut part way; what is left is
still well-formed text. Text in an entry's data (an unknown field's name, the
`field`) is cut the same way; the code and every number are kept.

Import never runs the text: it is `JSON.parse` and the validator, with no
`eval` and no `Function`. A key such as `__proto__` is an own property of the
parsed value, is refused as an unknown field, and changes no prototype. The
result of a good import is the parsed value, not merged into anything.

An imported rotation goes into a fight like any other: set it as
`SimConfig.rotation`. `createFight`, `runFight` and `SimRunner` validate it again
(`normalizeConfig`), so a rotation that reaches the engine by another way is
checked too. Nothing in the file or the code knows a step or a frame.

## Examples

The three below are checked by `test/rotation-schema.test.js` (the shape) and
`test/rotation-conditions.test.js` (every condition in them, and each example in
the vocabulary above, must pass `conditionProblems`). The Combat one must match
the constants `defaultRotation()` reads (`rotation.priority`,
`rotation.finisherComboPoints`, `rotation.pooling`, `energy.max`,
`rotation.sliceAndDiceRefreshSeconds`).

### 1. Today's placeholder Combat rotation

What the Rogue casts by default (issue #68, and the Cold Blood rule). This is
`defaultRotation()` in `js/rotation-default.js`, and
`test/rotation-default.test.js` holds this example equal to it:

- Blade Flurry and Adrenaline Rush when each is ready, in that order (Blade
  Flurry only with the energy it costs).
- At 5 combo points, Slice and Dice when it is missing or has less than 1 s
  left (`rotation.pooling.recastSeconds`), or when it has at most 5 s left
  (`rotation.pooling.windowSeconds`) and energy is full. These are the
  combat-swords preset's two refresh rules ([Presets](#presets)), taken into the
  default in issue #155; before that the default recast Slice and Dice at 10 s
  left (`rotation.sliceAndDiceRefreshSeconds`).
- Otherwise at 5 combo points, Cold Blood first when the build grants it and
  Slice and Dice has more than 10 s left, then Eviscerate.
- Otherwise Sinister Strike.

```json
{
  "schemaVersion": 1,
  "name": "Default (Combat)",
  "rules": [
    {
      "action": "blade-flurry",
      "conditions": [
        {
          "type": "abilityUnlocked",
          "ability": "blade-flurry"
        },
        {
          "type": "cooldownReady",
          "ability": "blade-flurry"
        },
        {
          "type": "resource",
          "resource": "energy",
          "op": ">=",
          "value": 25
        }
      ]
    },
    {
      "action": "adrenaline-rush",
      "conditions": [
        {
          "type": "abilityUnlocked",
          "ability": "adrenaline-rush"
        },
        {
          "type": "cooldownReady",
          "ability": "adrenaline-rush"
        }
      ]
    },
    {
      "action": "slice-and-dice",
      "conditions": [
        {
          "type": "comboPoints",
          "op": ">=",
          "value": 5
        },
        {
          "type": "auraRemaining",
          "aura": "slice-and-dice",
          "op": "<",
          "value": 1
        }
      ]
    },
    {
      "action": "slice-and-dice",
      "conditions": [
        {
          "type": "comboPoints",
          "op": ">=",
          "value": 5
        },
        {
          "type": "auraRemaining",
          "aura": "slice-and-dice",
          "op": "<=",
          "value": 5
        },
        {
          "type": "resource",
          "resource": "energy",
          "op": ">=",
          "value": 100
        }
      ]
    },
    {
      "action": "cold-blood",
      "conditions": [
        {
          "type": "abilityGranted",
          "ability": "cold-blood"
        },
        {
          "type": "comboPoints",
          "op": ">=",
          "value": 5
        },
        {
          "type": "auraRemaining",
          "aura": "slice-and-dice",
          "op": ">",
          "value": 10
        }
      ]
    },
    {
      "action": "eviscerate",
      "conditions": [
        {
          "type": "comboPoints",
          "op": ">=",
          "value": 5
        }
      ]
    },
    {
      "action": "sinister-strike",
      "conditions": []
    }
  ]
}
```

Read with the walk rule above: Cold Blood is off the global cooldown, so the
walk goes past it, whether or not it could be cast (on cooldown, for one). The
other five abilities are on it, so the first of them whose conditions hold is
the pick. Blade Flurry and Adrenaline Rush start the GCD, so each says when it
can be cast: a rule for one that is not ready, or that a selected build lacks
(`abilityUnlocked`), or that Blade Flurry cannot pay for, is passed over and
does not hold the walk. With no build both are passed over whatever the
conditions say, since no build is untalented (#199). The energy
condition is the Blade Flurry cost (the `bladeFlurry` row, 25), written as a
number in the JSON; Adrenaline Rush costs none. Cold Blood is cast only when
granted (`abilityGranted`). See "Granted and unlocked" above.

### 2. The smallest rotation

One rule, no conditions: always the builder.

```json
{
  "schemaVersion": 1,
  "name": "Builder only",
  "rules": [{ "action": "sinister-strike", "conditions": [] }]
}
```

### 3. Slice and Dice, Rupture, then a dagger builder

A different shape of rotation, with a debuff condition and a rule that is
skipped while its ability is on cooldown. Ghostly Strike comes from a Subtlety
talent, so its rule also carries the talent guard (`abilityUnlocked`, #207): a
build without the talent passes over it. A copy saved before #207 has no guard
and is now refused until it is added:

```json
{
  "schemaVersion": 1,
  "name": "Dagger: Slice and Dice, Rupture, Backstab",
  "rules": [
    {
      "action": "slice-and-dice",
      "conditions": [
        { "type": "comboPoints", "op": ">=", "value": 3 },
        {
          "type": "auraRemaining",
          "aura": "slice-and-dice",
          "op": "<=",
          "value": 3
        }
      ]
    },
    {
      "action": "rupture",
      "conditions": [
        { "type": "comboPoints", "op": ">=", "value": 5 },
        {
          "type": "debuffRemaining",
          "debuff": "rupture",
          "op": "<=",
          "value": 2
        }
      ]
    },
    {
      "action": "eviscerate",
      "conditions": [{ "type": "comboPoints", "op": ">=", "value": 5 }]
    },
    {
      "action": "ghostly-strike",
      "conditions": [
        { "type": "abilityUnlocked", "ability": "ghostly-strike" },
        { "type": "cooldownReady", "ability": "ghostly-strike" }
      ]
    },
    { "action": "backstab", "conditions": [] }
  ]
}
```

## What the shape check rejects

| Value                                                          | Problem                                        |
| -------------------------------------------------------------- | ---------------------------------------------- |
| `null`, an array, a string, a number                           | A rotation must be an object.                  |
| `{ "schemaVersion": 2, ... }`, `"1"`, or a missing version     | Not the version this build reads.              |
| `{ "schemaVersion": 1, "name": "x" }`                          | `rules` is missing.                            |
| `"rules": { ... }`                                             | `rules` must be an array.                      |
| `{ "action": "Sinister Strike", "conditions": [] }`            | `action` is a display name, not an ability id. |
| `{ "action": "sinister-strike" }`                              | `conditions` is missing.                       |
| `{ "action": "sinister-strike", "conditions": [{}] }`          | A condition needs a string `type`.             |
| `{ "action": "sinister-strike", "conditions": [], "when": 1 }` | Unknown field `when`.                          |

## Limits

The three limits are `data/constants.js` rows (`rotation.maxRules`,
`rotation.maxConditionsPerRule`, `rotation.maxNameLength`), and a fourth,
`rotation.maxImportChars` (131072), caps the text `importRotation` reads, and a
fifth, `rotation.maxErrorChars` (1000 code points, not UTF-16 units), cuts a path or message it returns. A
sixth, `rotation.maxListedEntries` (50), is how many errors or warnings the
page's form lists for one import (Scout's number, #214). The issues gave no
numbers for the first five, so they are the dev's engineering choices; all six
are tagged `engineering` and listed in [provenance](provenance.md). They are display and import-size caps,
not game rules.
