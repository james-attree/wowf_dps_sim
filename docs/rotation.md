# Rotation as data (R1, issue #138)

A rotation is a priority list of rules, written as JSON. The rotation the Rogue
casts today is code (`Rogue.rotation` in `js/rogue.js`, with its numbers in
`data/constants.js`). The rotation builder, presets and import/export need the
same rotation as data, and this page fixes what that data looks like.

This is roadmap R1. It fixes the **shape**. The conditions a rule can use
(R2, [#139](https://github.com/james-attree/wowf_dps_sim/issues/139)), the
validator (R4) and the interpreter that casts from a list (R3) come later. The
shape check is in `js/rotation-schema.js`. Nothing in the engine or the live
page reads it yet, so no fight changes.

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
interpreter walks the list from the top and, for each rule whose conditions all
hold, casts its ability. If that ability is on the global cooldown, the rule is
the pick and the walk stops. If it is off the global cooldown (Blade Flurry,
Adrenaline Rush, Cold Blood), the walk goes on to the next rule, as the code
does now. A rule whose conditions hold but whose ability cannot be afforded yet
still ends the walk: nothing lower is cast, so the rogue pools energy for a
finisher and does not fall through to a builder. A rule that should be skipped
while its ability is on cooldown says so with a condition (R2 has a "cooldown
ready" type). A rule is never reordered by a field of its own: there is no
`priority` number, so the list order is the only order. This restates the
"cast the first rule whose conditions pass" line of the
[Phase 3.5 plan](phase-3.5-engine-rewrite.md); R3 confirms the off-GCD rule when
it builds the interpreter.

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
keys. The one open place is a condition: its keys other than `type` are the
type's params, and R2 says which each type allows.

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
or whether a rule is unreachable. That is the validator (R4). A rotation can
pass the shape check and still be rejected there.

## Examples

The three below are checked by `test/rotation-schema.test.js`: each must pass
the shape check, and the Combat one must match the constants the code rotation
reads (`rotation.priority`, `rotation.finisherComboPoints`,
`rotation.sliceAndDiceRefreshSeconds`).

The condition types in them (`comboPoints`, `auraRemaining`, `abilityGranted`,
`debuffRemaining`) are **illustrative**. The shape check does not read them,
and #139 fixes the real vocabulary and the names. When it does, these examples
change with it. Where a condition says an aura has `<= 10` seconds left, an aura
that is not up counts as 0 seconds left, so one condition covers "missing or at
most 10 s left".

### 1. Today's placeholder Combat rotation

What `Rogue.rotation` does now (issue #68), including the Cold Blood rule of
`js/rotation-rules.js`:

- Blade Flurry and Adrenaline Rush on cooldown, in that order.
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
    { "action": "blade-flurry", "conditions": [] },
    { "action": "adrenaline-rush", "conditions": [] },
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

Read with the order rule above: Blade Flurry, Adrenaline Rush and Cold Blood
are off the global cooldown, so the walk goes past them. Slice and Dice,
Eviscerate and Sinister Strike are on it, so the first of them whose conditions
hold is the pick. Two things the code does that this JSON does not say yet, both
for #139: the code skips Blade Flurry and Adrenaline Rush when a selected build
lacks their talents (`Rogue.lockedByBuild`), which the `abilityGranted`
condition on Cold Blood would also express for them, and what "granted" means
when no build is selected.

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
