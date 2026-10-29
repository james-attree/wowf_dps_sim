# Rotation as data (R1, issue #138; R2, issue #139; R3, issue #140)

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
fight ([The interpreter](#the-interpreter)). The validator (R4) comes later.
The shape check is in `js/rotation-schema.js`, the vocabulary in
`js/rotation-conditions.js`, the state view in `js/rotation-state.js` and the
interpreter in `js/rotation-interpreter.js`. The default rotation casts what
the code rotation cast before R3, fight for fight, so no fight changes.

## The model

```json
{
  "schemaVersion": 1,
  "name": "Combat (placeholder)",
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
`hemorrhage` and `cold-blood`.

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

- `rotationShapeProblems(rotation)`: every shape problem in reading order, as
  strings that name where it is (`rules[2].conditions[0] needs a non-empty
string "type".`). An empty list means the shape is right.
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
or whether a rule is unreachable. That is the validator (R4), which uses
`conditionProblems` for the types and params. A rotation can pass the shape
check and still be rejected there.

## The condition vocabulary

A condition is `{ "type": "...", ...params }`. All of a rule's conditions must
hold (AND). `js/rotation-conditions.js` is the vocabulary: `CONDITION_TYPES`,
`conditionProblems(condition)` (every problem, as strings that name the param),
`assertCondition(condition)` (throws a `RangeError`), `evaluate(condition,
state)` and `evaluateAll(conditions, state)`. A condition is checked every time
it is evaluated: the type must be known, every required param present and
right, and no param the type does not list.

**Operators.** A comparing type has `op`, one of `>=`, `>`, `<=`, `<`, `==`, and
`value`, a finite number. The comparison is exact, with no tolerance, as the
code rotation's `<=` is. **Time is seconds** of fight time, never steps.
**Ids** are ability and aura ids (`slice-and-dice`), never display names. A
resource is named by its resource id (`energy`, `comboPoints`). Whether an
ability or aura id exists is the validator's check (R4), not this one's.

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
| `fightTimeRemaining` | `op`, `value`             | Seconds of fight left compare. With no fight length known it is `Infinity`.                      |
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
Adrenaline Rush and Cold Blood. The code rotation treats them in two different
ways, and a rotation as data has to say both:

- **Cold Blood** is cast only when it is granted. With no build selected and no
  host grant, it is never cast.
- **Blade Flurry and Adrenaline Rush** are skipped only when a build is selected
  and lacks their talent (`Rogue.lockedByBuild`). With **no build selected**
  they are cast, as the fight did before talents (D7, #106). That is the
  default config, and the goldens depend on it.

So there are two conditions, because one meaning cannot be both:

- `abilityGranted` is **strict**. It is true only when the ability is in the
  rogue's granted set: the build's grants plus the host's `abilities` option.
  With no build selected and no host grant, **no talent ability is granted**
  (the untalented rogue has none), so `abilityGranted` for Blade Flurry is
  `false` there. Cold Blood uses it, and so behaves exactly as today.
- `abilityUnlocked` is **the negation of `Rogue.lockedByBuild`**. It is `false`
  only when a build is selected, a talent grants the ability, and the build does
  not have it. In every other case it is `true`: with no build selected, for an
  ability no talent grants, and when the build has the talent.

Blade Flurry and Adrenaline Rush therefore carry `abilityUnlocked` in the
Combat example below, not `abilityGranted`. Writing `abilityGranted` on them
would be the cleaner reading ("no build means untalented") but it would stop
the default fight from casting them, which changes every golden. That is a
change of behaviour, not of vocabulary, so it is left out. R3 proves the
default config is unchanged with a fixed-seed fight.

**`abilityUnlocked` is not redundant on those two rules** (R3's decision). The
interpreter's host does hold back an ability a build locks (`canCast` is false
for it), but Blade Flurry and Adrenaline Rush are on the GCD, and an on-GCD
rule that holds and cannot be cast ends the walk. Without `abilityUnlocked`, a
build without Adrenaline Rush would hold the walk at that rule for as long as
its other conditions held, and nothing below it would be cast. With the condition the locked rule is passed over. A rule for an
ability a build can lack therefore carries `abilityUnlocked`, and
`test/rotation-interpreter.test.js` and `test/rotation-equivalence.test.js`
hold both halves.

### The state a condition reads

`evaluate(condition, state)` reads a state view and nothing else:
no `Rogue`, no `Simulation`. `rotationState(rogue, simulation, { duration })` in
`js/rotation-state.js` builds it from a fight without changing the fight:

| Field             | Meaning                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `time`            | Seconds of fight time so far.                                                                                               |
| `duration`        | The fight's length in seconds, or `null` when the host did not say. Only `fightTimeRemaining` reads it.                     |
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

- `compileRotation(rotation)` checks a rotation once (the shape, every
  condition's type and params, and that every `action` is a rogue ability id) and
  returns a frozen copy. A bad rotation is a `RangeError` that lists every
  problem with its path, so it never starts a fight. The ability ids are looked
  up by id; a display name is rejected as an unknown id.
- `decide(compiled, host)` is one decision point, the walk above. It returns
  `{ casts, outcome }`: the ability ids it cast, in order, and `"cast"` (an
  on-GCD ability was cast), `"pooling"` (an on-GCD rule held, the GCD was clear
  and it could not be cast) or `"none"` (the walk ran off the end). It reads the
  state again after each cast. It takes only a rotation from `compileRotation`
  (a `TypeError` otherwise), so a rotation is never walked unchecked.

The `host` is five functions: `state()` (the view above), `canCast(id)`,
`onGcd(id)`, `gcdClear()` and `cast(id)`. There is no step, frame or tick in
them, so the Phase 3.5 engine writes a host of its own and calls `decide`
unchanged. The Rogue's host is `rotationHost` in `js/rotation-host.js`:
`canCast` is "the build does not lock it and `Ability.canCast` is true" (not on
cooldown, a spender has something to spend, the cost is there, the GCD is clear
for an on-GCD ability), and `Ability.canCast` makes the same checks `cast` does,
without casting (`test/can-cast.test.js` holds the two together).

**In a fight.** `SimConfig` has a `rotation` field (default `defaultRotation()`).
`normalizeConfig` checks it and a bad one is a `RangeError` before the fight
starts; the result's `config` records it in full, so a recorded config repeats
the fight. `Rogue.rotation` asks the interpreter what to cast, and then does
the haste and the white swings as it did. `fightTimeRemaining` reads as
`Infinity` in the engine as it is: the Rogue passes no fight length to the state
view (`duration` is `null`).

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
- `decide` asks a host `onGcd` once for each rule and keeps the answers for that
  host, and returns shared, frozen results for a decision point that casts
  nothing (most of them).

The fight-level cost is the `npm run bench` result in the pull request: a 5
minute fight, median, interleaved against `main`. What is left is the walk
itself: the interpreter reads about 6 rules at a decision point where the code
rotation tried about 3 casts, and every condition is a call through the state
view.

## Examples

The three below are checked by `test/rotation-schema.test.js` (the shape) and
`test/rotation-conditions.test.js` (every condition in them, and each example in
the vocabulary above, must pass `conditionProblems`). The Combat one must match
the constants the code rotation reads (`rotation.priority`,
`rotation.finisherComboPoints`, `rotation.sliceAndDiceRefreshSeconds`).

### 1. Today's placeholder Combat rotation

What the Rogue casts by default (issue #68, and the Cold Blood rule). This is
`defaultRotation()` in `js/rotation-default.js`, and
`test/rotation-default.test.js` holds this example equal to it:

- Blade Flurry and Adrenaline Rush when each is ready, in that order (Blade
  Flurry only with the energy it costs).
- At 5 combo points, Slice and Dice when it is missing or has at most 10 s
  left.
- Otherwise at 5 combo points, Cold Blood first when the build grants it, then
  Eviscerate.
- Otherwise Sinister Strike.

```json
{
  "schemaVersion": 1,
  "name": "Combat (placeholder)",
  "rules": [
    {
      "action": "blade-flurry",
      "conditions": [
        { "type": "abilityUnlocked", "ability": "blade-flurry" },
        { "type": "cooldownReady", "ability": "blade-flurry" },
        { "type": "resource", "resource": "energy", "op": ">=", "value": 25 }
      ]
    },
    {
      "action": "adrenaline-rush",
      "conditions": [
        { "type": "abilityUnlocked", "ability": "adrenaline-rush" },
        { "type": "cooldownReady", "ability": "adrenaline-rush" }
      ]
    },
    {
      "action": "slice-and-dice",
      "conditions": [
        { "type": "comboPoints", "op": ">=", "value": 5 },
        {
          "type": "auraRemaining",
          "aura": "slice-and-dice",
          "op": "<=",
          "value": 10
        }
      ]
    },
    {
      "action": "cold-blood",
      "conditions": [
        { "type": "abilityGranted", "ability": "cold-blood" },
        { "type": "comboPoints", "op": ">=", "value": 5 },
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
      "conditions": [{ "type": "comboPoints", "op": ">=", "value": 5 }]
    },
    { "action": "sinister-strike", "conditions": [] }
  ]
}
```

Read with the walk rule above: Cold Blood is off the global cooldown, so the
walk goes past it, whether or not it could be cast (on cooldown, for one). The
other five abilities are on it, so the first of them whose conditions hold is
the pick. Blade Flurry and Adrenaline Rush start the GCD, so each says when it
can be cast: a rule for one that is not ready, or that a selected build lacks
(`abilityUnlocked`, which is true when no build is selected), or that Blade
Flurry cannot pay for, is passed over and does not hold the walk. The energy
condition is the Blade Flurry cost (the `bladeFlurry` row, 25), written as a number
in the JSON; Adrenaline Rush costs none. Cold Blood is cast only when granted
(`abilityGranted`). See "Granted and unlocked" above.

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
skipped while its ability is on cooldown:

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
      "conditions": [{ "type": "cooldownReady", "ability": "ghostly-strike" }]
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
`rotation.maxConditionsPerRule`, `rotation.maxNameLength`). The issue gave no
numbers, so they are the dev's engineering choices, tagged `engineering`, and
listed in [provenance](provenance.md). They are display and import-size caps,
not game rules.
