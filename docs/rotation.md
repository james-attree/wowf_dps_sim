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

- `rotationShapeErrors(rotation)`: every shape error in reading order, as
  `{ path, message }`. The path says where (`rules[2].conditions[0].type`; `""`
  is the rotation itself) and the message says what and names the same place.
- `rotationShapeProblems(rotation)`: the messages of `rotationShapeErrors`, as
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
or whether a rule is unreachable, and an empty `rules` list is a valid shape.
That is the validator (R4, [Validation](#validation)), which uses
`conditionErrors` for the types and params. A rotation can pass the shape check
and still be rejected there.

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
ability or aura id exists, and whether a number is in range, is the
validator's check (R4), not this one's.

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
`onGcd(id)`, `gcdClear()` and `cast(id)`. There is no step, frame or tick in
them, so the Phase 3.5 engine writes a host of its own and calls `decide`
unchanged. The Rogue's host is `rotationHost` in `js/rotation-host.js`:
`canCast` is "the build does not lock it and `Ability.canCast` is true" (not on
cooldown, a spender has something to spend, the cost is there, the GCD is clear
for an on-GCD ability), and `Ability.canCast` makes the same checks `cast` does,
without casting (`test/can-cast.test.js` holds the two together).

**In a fight.** `SimConfig` has a `rotation` field (default `defaultRotation()`).
`normalizeConfig` validates it and a bad one is a `RangeError` before the
fight starts (before the `Simulation`, and so the rng, exists); the result's `config` records it in full, so a recorded config repeats
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

## Validation

`js/rotation-validator.js` is the check a rotation passes before a fight. It
exports:

- `validateRotation(rotation, context)`: every error in reading order, as
  `{ path, message }`. An empty list means the rotation is valid.
- `assertValidRotation(rotation, context)`: returns the rotation, or throws a
  `RangeError` (`Bad rotation:` and one message per line). It reports the same
  errors; a caller uses whichever suits it. `rotationProblems(rotation,
context)` is the messages as strings.
- `rotationContext(given)`: what a rotation is validated against, below.

The **path** says where (`rules[2].conditions[0].aura`; `""` is the rotation as
a whole) so a builder can mark the field. The **message** names the rule index
and the problem and reads on its own, for example:

```text
rules[1].action "nonsense" is not an ability in the spell data. The rogue casts: ...
rules[2].conditions[0].aura "rupture" is a debuff on the target; use debuffActive, ...
```

| Case                               | Path                                      | What is wrong                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anything the shape check rejects   | as in [the shape check](#the-shape-check) | The wrong version, a missing field, too many rules or conditions, and so on. If the shape is wrong, that is all that is reported.                                  |
| `rules: []`                        | `rules`                                   | A rotation with no rules casts nothing.                                                                                                                            |
| Unknown ability id in `action`     | `rules[i].action`                         | Not an ability in the spell data.                                                                                                                                  |
| An ability the rogue does not cast | `rules[i].action`                         | In the spell data (Mutilate, Garrote, ...), but the engine does not cast it yet.                                                                                   |
| Unknown condition `type`           | `rules[i].conditions[j].type`             | Lists the known types.                                                                                                                                             |
| A param that is missing or wrong   | `rules[i].conditions[j].<param>`          | A missing or unknown param, or one of the wrong type (an operator not in `>= > <= < ==`, a `value` that is not a finite number, a non-boolean `active`).           |
| Unknown aura id                    | `rules[i].conditions[j].aura`             | `auraActive` and `auraRemaining` need a self buff. A target debuff id says to use the `debuff` types.                                                              |
| Unknown debuff id                  | `rules[i].conditions[j].debuff`           | `debuffActive`, `debuffRemaining` and `debuffStacks` need a target debuff. A self buff id says to use the `aura` types.                                            |
| Unknown ability id in a condition  | `rules[i].conditions[j].ability`          | `cooldownReady`, `abilityGranted` and `abilityUnlocked` take an ability the rogue casts, as `action` does.                                                         |
| A number out of range              | `rules[i].conditions[j].value`            | See below.                                                                                                                                                         |
| Cold Blood without its grant       | `rules[i].conditions`                     | A `cold-blood` rule needs `{ "type": "abilityGranted", "ability": "cold-blood" }` among its conditions (issue #155), so a build without the talent never casts it. |

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
the target debuffs as `{ id: maxStacks }`. Each defaults to the engine's own
(`js/ability-data.js`, `js/abilities.js`, `js/auras.js`) and a caller may replace
any of them, for a test or for a build that has fewer abilities.

**What it does not check.** Whether a rule is reachable, or whether the order
makes sense.

`compileRotation` calls the validator, so `createFight`, `runFight` and
`SimRunner` reject an invalid rotation before the `Simulation` exists and so
before any rng draw. The validator reads no display name; its messages name ids.

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
Combat (placeholder)
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
calls it the same way:

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
with no preset is the fight it was before. The page does not call `listPresets`
yet: it has no config UI (the UI issues, #149 and #150, wire it).

A preset's numbers are read from `data/constants.js` (the finisher's combo
points, the Blade Flurry cost, the energy cap, `rotation.pooling`), so they keep
their provenance. A preset is written for one weapon setup and says so.

### combat-swords

Slice and Dice kept up and recast just before it ends, Eviscerate with Cold
Blood, Sinister Strike to build, Blade Flurry and Adrenaline Rush on cooldown.
It casts nothing that needs a dagger, so it runs on any main hand. Its summary
(`summarizeRotation`, checked against this block by `test/rotation-presets.test.js`):

```text
Combat swords
1. Blade Flurry if Blade Flurry is not locked by the build and Blade Flurry is ready and Energy >= 25
2. Adrenaline Rush if Adrenaline Rush is not locked by the build and Adrenaline Rush is ready
3. Slice and Dice if CP >= 5 and Slice and Dice missing or < 1s left
4. Slice and Dice if CP >= 5 and Slice and Dice missing or <= 5s left and Energy >= 100
5. Cold Blood if Cold Blood is granted and CP >= 5 and Slice and Dice has > 5s left
6. Eviscerate if CP >= 5 and Slice and Dice has > 5s left
7. Sinister Strike if CP < 5
```

Rules 1 and 2 carry `abilityUnlocked` because a rule for an on-GCD ability that
holds and cannot be cast ends the walk
([The interpreter](#the-interpreter)): without it, a build with Blade Flurry or
Adrenaline Rush locked would stop at that rule and cast nothing else. Rule 5 is
Cold Blood (off the GCD) with `abilityGranted`, so it is cast right before the
Eviscerate that follows it, and only when the build or the host grants it.

#### Slice and Dice and energy (#122)

Issue #122 says an uptime buff should be recast as late as it can be: energy
generated while the buff is still up is energy the next cast does not have to
find, so a recast with time left throws part of the buff away. Its rule: when
Slice and Dice is within 5 seconds of ending, keep the energy for it and recast
it with less than 1 second left (the GCD is 1 second), or at once if energy
is at its maximum, since waiting then wastes regeneration.

The placeholder rotation recasts Slice and Dice whenever it has 5 combo points
and 10 seconds or less are left (`rotation.sliceAndDiceRefreshSeconds`), so with
the points and the energy it recasts early and loses the rest of the buff. In
the reference build the fight is bound by energy and combo points, so the
recast already comes with about 0.2 seconds left and the early cut-off is small;
it grows with a build that has more energy (talents). The measured effect of the
preset is in the pull request that added it.

The preset's rules are:

- 3: Slice and Dice at 5 combo points with less than 1 second left
  (`rotation.pooling.recastSeconds`). If it holds and the energy is short, the
  walk stops: the rotation waits for energy and casts nothing else.
- 4: the same with 5 seconds or less left (`rotation.pooling.windowSeconds`),
  only at the energy cap, so full energy is spent at once.
- 5 and 6: Cold Blood and Eviscerate only when Slice and Dice has more than 5
  seconds left. Inside the window, with 5 combo points and energy below the
  cap, no rule holds and the rotation waits.
- 7: Sinister Strike below 5 combo points.

The window and recast numbers (5 s and 1 s) are the issue's, tagged
`assumption` with `retune` on in `data/constants.js`. Slice and Dice is only
recast at 5 combo points, so a Slice and Dice that ends with fewer is not
protected: it lapses until the points are built (a known gap, not handled here).

#### Hazards

- A Backstab rule on a main hand that is not a dagger never casts, and ends the
  walk every time it holds (Backstab is refused, see
  [mechanics](mechanics.md)), so the rotation pools forever. The validator does
  not know the weapon. A weapon-type condition would fix it and is not in the
  vocabulary.
- Ambush and Mutilate also list a dagger requirement in the ability catalogue,
  and are not enforced.

## Import and export

R6 ([#143](https://github.com/james-attree/wowf_dps_sim/issues/143)) writes a
rotation as text and reads it back. `js/rotation-io.js` is pure (text in, text
or a result out) and reads no file, the clipboard or the DOM; a page or a tool
does that and hands the text over (the UI issues, #149 and #150).

- `exportRotation(rotation)`: the canonical JSON text of a valid rotation. An
  invalid one is a `RangeError` (`Bad rotation:` and one message per line), so a
  bad file is never written.
- `importRotation(text)`: `{ ok, rotation, errors }`. `ok` is `true`, with the
  rotation and `errors: []`, when the text is a valid rotation. Otherwise `ok`
  is `false`, `rotation` is `null` and `errors` is the list of path and message pairs that [the validator](#validation) gives,
  plus one error with the path `""` when the text as a whole is wrong (too long, not JSON).

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
`rotation.maxErrorChars` (1000 characters; the longest ordinary one is about 250) is cut and ends in `…`. A file at the size limit cannot make a 100,000
character message.

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
  "name": "Combat (placeholder)",
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
`rotation.maxConditionsPerRule`, `rotation.maxNameLength`), and a fourth,
`rotation.maxImportChars` (131072), caps the text `importRotation` reads, and a
fifth, `rotation.maxErrorChars` (1000), cuts a path or message it returns. The issue gave no
numbers, so they are the dev's engineering choices, tagged `engineering`, and
listed in [provenance](provenance.md). They are display and import-size caps,
not game rules.
