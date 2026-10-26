# Mechanics

How the engine on `main` resolves attacks, resources, and time. Every
formula names a constant id from [`data/constants.js`](../data/constants.js).
Values, units, source tags, refs, and notes are in the generated
[`docs/provenance.md`](provenance.md). This file does not copy those values
out as bare numbers.

`k(id)` returns the constant's `value`. A constant is on the retune list
when its source is not `wowf-export` and its `retune` flag is on. Talent
ranks in the vendored snapshot are not applied. The behaviour below is what
the current modules do.

## Random numbers

Every random draw in the engine comes from one rng that the `Simulation`
owns. `js/rng.js` builds it with `createRng(seed)`, a mulberry32 generator
(`k("rng.mulberry32")`, `engineering`, retune off) that returns a number in
[0, 1) and gives the same sequence for the same seed on every Node version.
`new Simulation(rogue, { seed })` seeds it, and `k("rng.defaultSeed")`
(`engineering`, retune off) is the seed when none is passed. A caller may
pass `{ rng }` instead to script the draws. The simulation hands the same
function to its rogue, so the weapon die, Eviscerate's damage roll, the
attack roll, and each DoT tick's crit roll all draw from it. Nothing under
`js/` except `js/main.js` uses a platform random source, and lint rejects
`Math.random` there, including `Math['random']`, `globalThis.Math.random`, and
`self.Math.random`. The live page picks
a random seed at load, keeps it in `simulation.seed`, and shows it in the
header. A `Rogue` that no
`Simulation` has adopted has no rng, and a draw throws.

## Attack table

`resolveAttack` in `js/attack-resolver.js` resolves white swings and special
attacks with one roll. `k("table.white")` (`classic-1.12`, on the retune
list) records the Classic order miss, dodge, parry, glancing, block, crit,
hit. The note says the engine uses one roll and omits block, and that a
glancing blow cannot crit. `k("table.yellow")` (same source, on the retune
list) records two rolls for specials. The note says that shape is not
applied: a yellow attack still uses this single roll and does not glance.

The live roll is one draw from the simulation's rng (see Random numbers)
times `k("attack.rollScale")` (`engineering`, retune off). Callers may
inject a roll on that scale, and then no draw is made. The
function walks the bands in order, adding each chance times the scale, and
takes the first band whose running threshold is strictly above the roll. A
roll that lands on a threshold falls through to the next band. Whatever is
left is a hit. The chances are not renormalised, so a crit chance at the
top of the clamp can leave no hit band.

Bonus hit and crit are clamped into the unit interval. A non-finite chance
throws. The sim passes `Rogue.getBonusHitChance()` and
`Rogue.getCritChance()`, which are `k("character.bonusHitChance")` and
`k("character.critChance")`. Both are assumptions on the retune list.

White miss, for `attackType` `"weapon"` (main hand and off hand):

`max(0, k("miss.yellow") + k("miss.dualWieldPenalty") - bonusHit)`

Yellow miss, for `attackType` `"skill"`:

`max(0, k("miss.yellow") - bonusHit)`

`k("miss.yellow")` and `k("miss.dualWieldPenalty")` are `classic-1.12` and
on the retune list. The dual-wield note says the penalty is for white swings
only. `k("hit.suppression")` (same source, on the retune list) is not read.
Its note says the first portion of bonus hit is ignored, and that this is
not applied until the full table lands. `resolveAttack` subtracts the whole
clamped bonus hit. `k("weaponSkill.base")` and `k("target.defense")` are not
read either. Their notes defer that comparison to the same later table.

Dodge is `k("dodge.target")` on every roll (`classic-1.12`, on the retune
list). Nothing reduces it. Ghostly Strike stores `k("ghostlyStrike").duration`
as a self buff and does not change this chance.

Parry is a band with zero width. The code passes a zero chance. The note on
`k("parry.target")` says the same: the engine still passes a zero parry
chance on the single roll, and the front/behind split is later.
`k("target.behind")` is an assumption on the retune list. Its note says the
engine does not branch on it yet.

Block is omitted. The note on `k("block.target")` says it is not on the
current single-roll table.

Glancing is pushed only for `"weapon"`. The chance is `k("glancing.chance")`
and the damage factor is `k("glancing.damage")` (both `classic-1.12`, on the
retune list). The glancing-damage note says the flat average is what is in
force, and that the low/high range is later. Because glancing is its own
band, placed before crit, a glancing blow cannot crit.

Crit uses the clamped crit chance it was given. `k("crit.suppressionSkill")`
and `k("crit.suppressionAura")` are `classic-1.12` and on the retune list.
Both notes say the suppression is not applied yet, so the roll is not
reduced by defense or by an aura.

Damage is the base times a multiplier, then `Math.floor`. A miss, dodge, or
parry multiplies by zero. A glance uses `k("glancing.damage")`. A crit uses
`k("crit.meleeMultiplier")` (`classic-1.12`, on the retune list). A hit keeps
the base damage. The result is `landed` for a glance, a crit, or a hit. A
glance can floor to zero damage and still count as landed.

`Simulation.resolveAttack` then runs that damage through armor (see Armor)
and adds it to the total when the attack landed and the armored damage is
still positive.

## Weapon swings and normalised speed

`Weapon` in `js/weapon.js` holds a min, a max, a speed, a hand
(`"main"` or `"off"`), and a type. The constructor throws a `RangeError`
when min damage, max damage, or speed is not a finite number, and when
speed is not greater than 0. Min damage greater than max damage throws the
same way. The sample weapons are `k("weapon.mainHand")` and
`k("weapon.offHand")`, both assumptions on the retune list. The main-hand
type is copied from that constant onto the weapon. The off-hand constant
has no type, so that weapon's type is null.

The weapon die is an inclusive integer from min through max. The `1` in the
span is the code's inclusive end, not a constant:

`floor(random * (max - min + 1)) + min`

A white swing's hit, in `Weapon.rollDamage`, is that die plus attack power
divided by `k("ap.perDps")`, times the weapon's own speed. Attack power is
`Rogue.getAttackPower()`, the sample `k("character.attackPower")` (assumption,
on the retune list). `k("ap.perDps")` is `classic-1.12` and on the retune
list. An off-hand swing then multiplies that whole sum, die and attack-power
term together, by `k("offHand.damageMult")` (`classic-1.12`, on the retune
list). The note says Dual Wield Specialization is not applied on top.

Specials that use the weapon call `Rogue.rollWeaponDamageForSkill`. That is
the main-hand die plus attack power divided by `k("ap.perDps")`, times
`k("normalizedSpeed.dagger")`. The rogue copies that normalised speed once,
in the constructor. The note on `k("normalizedSpeed.dagger")`
(`classic-1.12`, on the retune list) says instant attacks use normalised
speed for the attack-power term and that the engine assumes a dagger.
`k("normalizedSpeed.oneHand")` (same source, on the retune list) is not
selected. Its note says so.

Sinister Strike is the rotation's builder. It deals the normalised hit plus
`k("sinisterStrike").bonusDamage` and has no weapon multiplier. Hemorrhage
and Ghostly Strike stay implemented and are not in the rotation. A landed
Hemorrhage deals that normalised hit times one entry of
`k("hemorrhage").weaponMultiplier` and applies a target debuff for
`k("hemorrhage.ruptureBonus").duration`. A landed Ghostly Strike deals the
normalised hit times one entry of `k("ghostlyStrike").weaponMultiplier`.
The main-hand type `"dagger"` selects the `dagger` entry. Every other type,
including the sample main hand, selects `other`. Both constants are
`wowf-export` and are not on the retune list. Backstab is that hit times
`k("backstab").weaponMultiplier`, plus `k("backstab").bonusDamage`. Ambush
is that hit times `k("ambush").weaponMultiplier`, plus
`k("ambush").bonusDamage`. Sinister Strike, Backstab, and Ambush are
`wowf-export`. Only the notes on `k("backstab")` and `k("ambush")` say
dagger, behind, or stealth requirements are not enforced. The note on
`k("sinisterStrike")` is weapon damage plus the bonus. `Rogue.rotation`
does not cast Backstab or Ambush.

`Weapon.tick` subtracts the frame from `swingTimer`. While the timer is at
or below `k("sim.tickEpsilon")` and the interval is positive, it fires a
swing and adds one interval. Time past a swing stays on the timer, so a long
frame can hold several swings and a short frame does not drop the leftover.
The interval is weapon speed divided by the haste multiplier passed in from
`Rogue.rotation` (see Haste stacking). The main-hand timer starts due, so
the first tick swings it. The off-hand timer starts at
`k("weapon.offHand").initialSwing`. The note says that delay keeps the hands
from swinging together on the first frame. Haste does not rewrite a delay
that is already counting down.

Each swing calls `Simulation.resolveAttack` with attack type `"weapon"`.

## Global cooldown

`Simulation` stores `gcdDuration` from `k("gcd.duration")` (`classic-1.12`,
on the retune list). The note says this is the rogue GCD and that wowsims
uses the same length for its minimum. `Simulation.setGcd` sets `gcd` to that
duration. `Simulation.tickGcd` subtracts the frame and floors at zero. It
does not compare the remainder with `k("sim.tickEpsilon")`, so a positive
remainder can stay on `gcd`. The note on `k("sim.tickEpsilon")` lists the
GCD among the timers that use that tolerance. The countdown does not snap
that remainder. `Skill.cast` is what compares it.

`Skill.cast` in `js/skill.js` treats `triggersGcd` as on unless a subclass
turns it off. An ability that triggers the GCD is ready when `simulation.gcd`
is at or below `k("sim.tickEpsilon")`. A larger remainder still waits. A
cast that proceeds calls `setGcd`. The stored remainder can still be
positive on that frame, so the cast can land about one frame earlier than a
check for exact zero. An ability that does not trigger the GCD skips that
wait, does not start a GCD, and does not clear one that is already running.
The comment on that branch says a later off-GCD ability would inherit the
same rule.

`k("gcd.flags")` (`classic-1.12`, on the retune list) records Slice and Dice,
Blade Flurry, and Adrenaline Rush on the GCD, and Premeditation off. The
note says this is applied. Premeditation sets `triggersGcd` off. Slice and
Dice, Blade Flurry, Adrenaline Rush, and the other `Skill` subclasses leave
it on, so a successful cast starts the GCD. This is the rule from #57.

The GCD is ticked before `Rogue.rotation`, so a GCD started during this
frame's casts is not reduced until the next frame. The same is true of a
cooldown, a buff, or a debuff applied during the rotation: `tickAuras` has
already run.

`js/main.js` sets the GCD status to "On cooldown" while `simulation.gcd > 0`,
and to "Ready" otherwise. On the frame where the remainder is still positive and
already within `k("sim.tickEpsilon")`, that label can read "On cooldown"
while `Skill.cast` treats the GCD as ready.

## Sample rotation

`Rogue.rotation` reads `k("rotation.priority")` (`wowf-designer`, on the
retune list). The ref records the placeholder Combat rotation. It tries, in
order:

1. Each ability in `onCooldown`, in order: Blade Flurry, then Adrenaline
   Rush. Both are tried whenever they are ready. Adrenaline Rush has no
   energy threshold.
2. When combo points are at `k("rotation.finisherComboPoints")`, Slice and
   Dice if that buff is missing or its remaining duration is at or below
   `k("rotation.sliceAndDiceRefreshSeconds")`. Otherwise Eviscerate.
3. Otherwise Sinister Strike.
4. Both weapon swings, with the haste multiplier from `stackHaste`.

Ghostly Strike, Premeditation, Hemorrhage, and Rupture stay implemented and
are not in this list. This replaces the earlier rule that refreshed Slice and
Dice before combo points were full, ahead of a Rupture at `k("combo.max")`.
Sinister Strike spends its energy cost on the way to the next finisher, so a
fight can reach `k("rotation.finisherComboPoints")` only after Slice and Dice
has already fallen to `k("rotation.sliceAndDiceRefreshSeconds")` or less.
Eviscerate is still the branch taken when the buff is longer than that.

Each cast still has to pass `Skill.cast` (cooldown, combo points for a
spender, energy, and the GCD). Every ability in the list starts the GCD, so
the first one that succeeds blocks the rest of that frame. Weapon swings run
after the casts, whether or not a cast succeeded.

## Energy

The fight starts at `k("start.state").energy`. That object is an assumption
on the retune list. `Rogue.regenerateEnergy` adds `rate * dt` and caps at
`k("energy.max")` (`classic-1.12`, on the retune list). The note on
`k("energy.max")` says the cap matches the export's Vigor bonus.

Regen per second is `k("energy.regenPerSecond")` (`wowf-export`, not on the
retune list). The note says Forever regenerates continuously, and that
Classic used a periodic tick. The engine adds `rate * dt` every frame. It
does not wait for a tick.

`Simulation.step` reads Adrenaline Rush's remaining time before buffs are
counted down. The slice of the step still inside the buff, including the
step the buff runs out, uses

`k("energy.regenPerSecond") * k("adrenalineRush").regenMultiplier`

and the rest of the frame uses `k("energy.regenPerSecond")`. The base-rate
slice is added first, then the bonus-rate slice. Each add is capped. The
cast frame itself stays at the base rate, because the buff is applied later,
inside `Rogue.rotation`.

`Skill.cast` spends `energyCost` before the attack roll. If the attack does
not land, it refunds `energyCost * k("skill.missEnergyRefund")` and returns
without a cooldown, combo points, or an aura. The GCD, if this ability
starts one, is already running. `k("skill.missEnergyRefund")` is an
assumption on the retune list. Its ref says Classic and the export do not
describe that refund. Its note says the refund has been present since the
initial skill code. A glance, a crit, or a hit is landed, so it is not
refunded. Adrenaline Rush, Blade Flurry, Slice and Dice, and Premeditation
are not attacks, so they have no miss refund.

## Combo points

The fight starts at `k("character.startingComboPoints")`. `k("start.state")`
records the same combo-point count and full energy. Both are assumptions on
the retune list. The ref on `k("character.startingComboPoints")` says there is no pre-pull
Premeditation. The note says the sample fight reads this value, and that
`k("start.state")` records the same combo points and full energy. The cap is `k("combo.max")` (`wowf-export`, not on the retune
list).

A builder adds its `comboPointsGenerated`, capped at `k("combo.max")`. If
that add actually gained a point, and the ability is not Premeditation,
`Rogue.clearPremeditation` cancels the expiry timer and leaves the points in
place. A non-Premeditation builder that gains nothing, because the rogue is
already capped, leaves the timer alone. A spender sets combo points to none
and cancels the timer. `Skill.cast` rejects a spender when the rogue has no combo
points, before it spends energy or starts the GCD.

A landed Sinister Strike, the rotation's builder, adds
`k("sinisterStrike").comboPoints`. A landed Hemorrhage adds
`k("hemorrhage").comboPoints`. A landed Ghostly Strike adds
`k("ghostlyStrike").comboPoints` and then sits on
`k("ghostlyStrike").cooldown`. The rotation does not cast Hemorrhage or
Ghostly Strike. Premeditation is covered below.

## Finishers

Eviscerate, Rupture, and Slice and Dice set `spender`. Each needs a combo
point, and a successful cast spends all of them and cancels Premeditation
expiry. Slice and Dice is covered in its own section. It deals no damage.
The placeholder Combat rotation's damaging finisher is Eviscerate, when
combo points are at `k("rotation.finisherComboPoints")` and Slice and Dice
is present with more than `k("rotation.sliceAndDiceRefreshSeconds")` left.
Rupture is implemented and `Rogue.rotation` does not call it.

Eviscerate, in `Eviscerate.damage`, rolls an inclusive integer from min to
max. The attack-power term is attack power times combo points times
`k("eviscerate.apPerCP")` (`classic-1.12`, on the retune list). The note says
a larger coefficient belongs to a later expansion. Min and max each add that
term to the matching band of `k("eviscerate").damageByCp` (`wowf-export`).
The note says a cast with no combo points would add no base damage. The
spender check rejects that cast first. The roll then goes through
`resolveAttack` as a skill, then armor.

Rupture, in `Rupture.damage`, adds the matching entry of
`k("rupture").damageByCp` (`wowf-export`) to attack power times the
`k("rupture.apByCP")` entry for the combo points spent. That entry is the
total AP fraction for the whole DoT, not a per-tick coefficient. The comment
in `Rupture.damage` says so, and the dot applicator divides the floored total
by the tick count, so the fraction is split evenly across the ticks. The
duration is the matching entry of `k("rupture").durationByCp`. The three
arrays are length-guarded together. If there are no combo points, or the
combo points run past `damageByCp`, `durationByCp`, or `k("rupture.apByCP")`,
the duration is cleared and the cast deals no damage, so no DoT is stored.
`k("rupture.apByCP")` has source `cataclysm` and is on the retune list. Its
unit is `AP total`. Its note is: "WoW Forever tooltip says AP scaling; Cata
coefficients used as reference. Per tick this is 0.015, 0.024, 0.03,
0.0342857, 0.0375 across 4–8 ticks. Classic was 0.04, 0.10, 0.18, 0.21,
0.24." A landed cast also stores a target debuff of that duration. Tick
damage is read from the dot, not from the debuff. The application and the
ticks are under Bleeds and damage over time.

A missed Eviscerate or Rupture does not spend combo points. The refund rule
is under Energy.

## Premeditation

`Premeditation` spends `k("premeditation").energy`, adds
`k("premeditation").comboPoints`, and starts
`k("premeditation").cooldown`. The constant is `wowf-export` and is not on
the retune list. It is not an attack, so the log records a cast. It does not
start the GCD. The comment on `Premeditation` in `js/skill.js` says the
export spell_desc has no Stealth requirement and that Classic required it.
The note on `k("premeditation.cpExpiry")` says Classic needed Stealth. The
engine does not check for it. There is no Stealth check in `Premeditation`.
`Rogue.rotation` does not cast it.

On a successful cast `Rogue.armPremeditation` sets the removal amount to
`k("premeditation.cpRemovedOnExpiry")` and the timer to
`k("premeditation.cpExpiry")`. A later Premeditation replaces both. The
expiry constant is `wowf-export` and is not on the retune list. Its note says
Classic used a shorter expiry. The removal amount is an assumption on the
retune list. Its note says expiry always removes that many points, even when
the cap meant fewer were added, and that the result is clamped so combo
points do not go below zero.

`Rogue.tickPremeditation` runs in `Simulation.step` before the rotation, so
the cast step does not count. When the remaining time is at or below
`k("sim.tickEpsilon")`, combo points drop by the armed amount, clamped at
zero, and the timer is cleared. A finisher, or a later cast that actually
adds a combo point, clears the timer first, so those points are not removed
on top of being spent or folded into a new builder.

## Adrenaline Rush

`AdrenalineRush` spends `k("adrenalineRush").energy`, applies a self buff for
`k("adrenalineRush").duration`, and starts `k("adrenalineRush").cooldown`.
The constant is `wowf-export` and is not on the retune list. The note says
the engine uses the export cooldown, and that casting starts the GCD. It is
not an attack. It does not generate combo points.

`Rogue.rotation` tries it on cooldown, after Blade Flurry, as the second
`onCooldown` id in `k("rotation.priority")`. It does not wait for an energy
threshold. While the ability is on cooldown, `Skill.cast` returns without
refreshing the buff. The regen multiplier is under Energy:
`k("adrenalineRush").regenMultiplier` on the portion of a later frame still
inside the buff.

## Blade Flurry

`BladeFlurry` spends `k("bladeFlurry").energy`, applies a self buff for
`k("bladeFlurry").duration`, and starts `k("bladeFlurry").cooldown`. The
constant is `wowf-export` and is not on the retune list. The note says cleave
is ignored on a single target, and that casting starts the GCD. It is not an
attack and it grants no combo points. There is no second target.

`Rogue.rotation` tries it on every frame, first in `k("rotation.priority")`.
When the cast succeeds it takes the GCD, so Adrenaline Rush, Slice and Dice,
Eviscerate, and Sinister Strike wait. While the buff's duration is still
positive, its haste fraction `k("bladeFlurry").haste` is passed to
`stackHaste`.

## Slice and Dice

`SliceAndDice` in `js/skill.js` is a spender and not an attack. It spends
`k("sliceAndDice").energy`, spends every combo point, and clears a
Premeditation timer. `k("sliceAndDice").cooldown` does not become a cooldown
entry, because `Skill.cast` records one only when the cooldown is positive.
The cast is logged as a cast, with no attack roll. The constant is
`wowf-export` and is not on the retune list. Its ref names the `spell_desc`
row the export uses for this cast.

`triggersGcd` stays at the `Skill` default, so a cast that proceeds calls
`Simulation.setGcd`. The `sliceAndDice` note and the `gcd.flags` note both
say casting it starts the GCD.

Duration is per combo point. When the combo points fall inside
`k("sliceAndDice").durationByCp`, `SliceAndDice.cast` copies that entry onto
the buff before `Skill.cast` stores it on `activeBuffs`. The first entry is
the duration for one combo point. The `sliceAndDice` note says the stored
series is the export's per-combo-point duration, a base plus a step times
combo points,
written out per point so the engine can index it. The engine does not
evaluate that expression itself. The buff is a player aura, not a debuff,
and it deals no damage.

`Rogue.rotation` considers it only when combo points are at
`k("rotation.finisherComboPoints")`. The cast is attempted when the buff is
missing, or its remaining duration is at or below
`k("rotation.sliceAndDiceRefreshSeconds")`. Both thresholds are
`wowf-designer` and on the retune list, and `k("rotation.priority")` records
the same decision. A longer remaining duration spends those combo points on
Eviscerate instead. Blade Flurry and Adrenaline Rush are tried earlier and
start the GCD, so when one of them is ready it takes this frame and Slice
and Dice waits until the GCD is clear.

While the buff's duration is positive, `Rogue.rotation` passes
`k("sliceAndDice").haste` through `stackHaste`. The note says that haste
shortens the next swing of both weapons. A swing already counting down keeps
its remaining time. The `haste.stacking` note says wowsims rescales that
swing in `UpdateSwingTimers`. This engine does not. The combination with
Blade Flurry is the next section.

## Haste stacking

`stackHaste` in `js/rogue.js` reads `k("haste.stacking")`. The shipped value
is multiplicative. The constant is `classic-1.12` and on the retune list.
The note says Classic attack-speed effects multiply, as wowsims does in
`MultiplyMeleeSpeed`, and that Slice and Dice and Blade Flurry each
contribute.

`Rogue.rotation` starts the swing multiplier at 1, then, for each buff that
is present with duration still positive, replaces it with `stackHaste` of
the current multiplier and that buff's haste fraction. Slice and Dice is
applied first, then Blade Flurry. `Weapon.tick` divides weapon speed by the
result. Both hands use the same multiplier.

- Multiplicative: `stackHaste` returns the current multiplier times
  `(1 + haste)`. With both buffs the interval divisor is
  `(1 + k("sliceAndDice").haste) * (1 + k("bladeFlurry").haste)`. That is
  the product the `haste.stacking` note describes.
- Additive: `stackHaste` returns the current multiplier plus the haste
  fraction. With both buffs the divisor is
  `1 + k("sliceAndDice").haste + k("bladeFlurry").haste`.
- Any other value throws `Unknown haste.stacking: …` from `stackHaste`.

One buff alone is `1 + haste` under either setting, because the multiplier
starts at 1. The `1` there is the unhasted multiplier in `Rogue.rotation`,
not a constant.

`Weapon.tick` does not multiply `swingTimer` when a buff is applied or
removed. It subtracts the frame from the time already left and, only after a
swing fires, adds `speed / hasteMultiplier` using the multiplier on that
tick. The next swing is the one that shortens. The swing that was already
counting down keeps its remaining time, including the off-hand's opening
delay. The notes on `sliceAndDice` and `haste.stacking` both say this. The
`haste.stacking` note says wowsims rescales the swing in progress in
`UpdateSwingTimers`. This engine does not.

## Armor

`armorMultiplier` in `js/simulation.js` reads `k("target.armor")` (an
assumption on the retune list; negative armor is treated as zero) and
`k("armor.mitigation")` (`classic-1.12`, on the retune list). The reduction
is

`armor / (armor + k("armor.mitigation").constant + k("armor.mitigation").perLevel * k("character.level"))`

capped at `k("armor.mitigation").cap`, and not below zero. Damage kept is
the incoming damage times one minus that reduction. If the denominator is
not positive, the multiplier is one and nothing is removed.
`k("character.level")` is `wowf-export` and is not on the retune list. The
notes on `character.level` and `armor.mitigation` describe the divisor's
constant term at that level. The engine evaluates the expression above.

`Simulation.resolveAttack` always applies this to a direct hit, after
`resolveAttack` has floored the pre-armor damage. The running total keeps
the product. `js/main.js` floors a combat-log cell when it draws it.

A tick skips armor when `tickSkipsArmor` says so. A bleed tick skips when
`k("bleed.ignoresArmor")` is set and the dot is marked `bleed` or its name
is in `k("bleed.spells")`. A nature tick skips when `k("nature.ignoresArmor")`
is set and the name is in `k("nature.spells")`. Those four constants are
`classic-1.12` and on the retune list. The bleed note says physical periodic
damage skips armor, and that a physical direct hit is reduced. The nature
note says armor is for physical damage and that spell resistance is not
modelled. Nothing in `js/simulation.js` applies spell resistance.

`k("bleed.spells")` names Rupture and Garrote. `k("nature.spells")` names
Deadly Poison. Rupture's cast sets `bleed`, so its ticks skip when
`k("bleed.ignoresArmor")` is set. Garrote has no skill class. A dot named
Deadly Poison would skip as nature. The rotation does not create one. See
Poisons.

## Bleeds and damage over time

`Simulation.resolveDotAttack` rolls the application as a skill with a zero
crit chance, so the application cannot crit. The log event for that cast
records no damage. The tick count is the duration divided by
`k("rupture.tickInterval")`, floored. That interval is `classic-1.12` and on
the retune list. The note says the dot applicator uses it for every DoT.
When the attack landed, the floored damage is positive, and the tick count
is positive, the sim stores

`tickDamage = floored application damage / tick count`

with `timeUntilNextTick` set to one interval. That division splits the
whole-DoT total, including the `k("rupture.apByCP")` term, evenly across
the ticks. The cast frame does not reduce that timer, because the dot is
stored after the tick loop. Otherwise no dot is stored.
`k("dot.snapshot")` (`classic-1.12`, on the retune list) says Rupture damage
is fixed when the cast resolves. The stored `tickDamage` is that snapshot.
The per-tick crit roll is not part of it.

The tick loop in `Simulation.step` runs before the rotation, so a dot cast
this step does not tick until a later step, and the first tick waits out
one interval. For each tick still inside the dot's remaining time:

1. Start from `tickDamage`.
2. If the tick is Rupture and the Hemorrhage debuff is up, multiply by
   `1 + k("hemorrhage.ruptureBonus").bonus`. The `1` is the code's base, not
   a constant. `k("hemorrhage.ruptureBonus")` is `wowf-export` and is not on
   the retune list. Its note says only Rupture ticks are increased. Garrote,
   Deadly Poison, and any other DoT are unchanged. A Hemorrhage aura stored
   on the player does not count. The strike itself is a direct hit and takes
   armor.
3. If `k("dot.canCrit")` is set and `rollCrit` succeeds, multiply by
   `k("dot.critMultiplier")` and mark the tick a crit. `rollCrit` is a
   separate draw from the simulation's rng, checked against `Rogue.getCritChance()`, not
   another attack-table roll. A tick does not miss, dodge, or glance.
   `k("dot.canCrit")` is `wowf-designer` and is not on the retune list. Its
   ref says all DoTs, bleeds included, can crit in WoW Forever. Its note
   names Rupture, Garrote, and Deadly Poison, says this differs from Classic,
   and says the per-tick crit roll stays.
   `k("dot.critMultiplier")` is an assumption and is not on the retune list.
   Its note says the multiplier matches other crits. Its ref says to update
   the code if that changes.
4. Apply armor unless `tickSkipsArmor` skips it.
5. Add the result to the damage total. Tick damage is not floored here.

The time until the next tick is reduced only by the part of the frame still
inside the dot (`min(dt, duration)`). A tick that falls due in that window
deals a full tick. The duration itself loses the whole frame, and the dot is
removed when duration is at or below `k("sim.tickEpsilon")`. A long frame can
fire several ticks. Each one schedules the next by adding
`k("rupture.tickInterval")`.

## Poisons

Instant Poison, Deadly Poison, and the poison hit, proc, tick, and charge
constants are not used by the rotation. The notes on `k("poison.instant")`,
`k("poison.deadly")`, `k("poison.hitModel")`, `k("poison.procSource")`,
`k("poison.deadlyTick")`, `k("poison.instantCrit")`, and `k("poison.charges")`
say they are not simulated or not applied yet. `k("spell.missTarget")` is
the same: its note says spell miss is for poisons and is not applied yet.
There is no poison proc on a white or yellow hit. A tick whose name is in
`k("nature.spells")` would skip armor, and the deadly-poison tick note says
those ticks can crit through `k("dot.canCrit")`, but nothing in the engine
starts that dot.

## Simulation clock

The engine has no clock of its own. `Simulation.step(dt)` is the only way time
moves: `dt` is a time step in seconds, and `step` adds it to `currentTime`. No
file under `js/` except `js/main.js` reads `performance`, `Date`, or any other
wall clock, and lint rejects `performance` and `Date` there (and `Math.random`,
see Random numbers). A `dt` that is negative, `NaN`, or infinite throws a
`RangeError`. Two simulations with the same seed that are given the same steps
end in the same state.

Elsewhere in this document, "frame" is older wording for one `step`.

### How the pieces fit

A fight is a seed plus the steps it is given. The same seed and the same steps
end in the same state, whoever drives them.

- `createRng(seed)` (`js/rng.js`) is the one source of randomness. The
  `Simulation` owns it (see Random numbers).
- `Simulation.step(dt)` is the only way time moves. `Simulation.run(duration)`
  calls it with `k("sim.fixedStep")` for a duration (see Fixed step).
- `createFight(seed)` and `runFight({ seed, duration })` (`js/fight.js`) build
  the `Rogue` and `Simulation` pair. `runFight` runs it with one `run` call and
  returns plain data (see Headless fight).
- The live page (`js/main.js`) builds the same pair with `createFight` and gives
  it whole fixed steps from `FrameClock` (see Live page). It is a view of the
  engine and holds no combat rule.
- The golden tests pin the `runFight` result for four fixed cases, one of them a
  scripted list of casts (see Golden-seed tests). They fail when anything on
  this path changes a number.
- `npm run bench` times a seeded 5-minute `runFight` (see Benchmark).

What the engine does not yet do is under Known limits of Phase 1.

### Fixed step

Headless runs use one step size, `k("sim.fixedStep")` (`engineering`, retune
off). It is about a 60 fps frame and far below every game timer, so the GCD,
swing timers, DoT ticks, and the `k("sim.tickEpsilon")` handling behave as they
do at live frame rates. It is a power of two, so adding it up is exact in
floating point.

`Simulation.run(duration)` advances the fight by `duration` seconds:

1. Take `floor(duration / k("sim.fixedStep"))` whole steps, each a
   `step(k("sim.fixedStep"))`.
2. If time is left over, take one shorter step for it.

The leftover is exact when the call starts from a step boundary, so the fight
then ends exactly `duration` seconds after the call began. A call that starts
between boundaries is exact only up to float rounding. A duration of a whole
number of steps ends on a step boundary, and any other duration ends on it
after one short step. A `duration` that is negative, `NaN`, or infinite throws
a `RangeError`, and `0` takes no step. The `run` call does no timing and draws
no randomness of its own; the seed and the calls decide the fight.

Results depend on the step size and on where the steps fall, because swings,
casts, and ticks land on step boundaries and then the rng can be drawn in a
different order. QA measured how much, for seeds 1 to 200, by comparing each
seed's total damage with the `run` result at `k("sim.fixedStep")`:

| Change                                   | 10 s    | 60 s    | 120 s    | 300 s     |
| ---------------------------------------- | ------- | ------- | -------- | --------- |
| Step of 0.01 s instead of the fixed step | 0 / 200 | 3 / 200 | 53 / 200 | 142 / 200 |
| A `run` split 0.1 s in, then the rest    | -       | 1 / 200 | 52 / 200 | 142 / 200 |
| A `run` split half a step off a boundary | 0 / 200 | 0 / 200 | -        | 120 / 200 |

(Each count is the number of seeds, out of 200, whose total damage differs. A
dash means that case was not measured. The figures are QA-measured over seeds
1 to 200; we re-ran them and got the same counts.) So the effect is small for
short fights and common at 5 minutes. Over many seeds the mean damage barely
moves: by under 0.04% in those runs, and `test/fixed-step.test.js` holds the
mean within 2% of 60 and 144 fps. That is
why every headless run uses `k("sim.fixedStep")` and one `run` call per fight,
and why changing the step or the way a duration is split can change the seeded
fights and the golden fixtures.

Splitting a fight over several `run` calls gives the same fight as one call
when each call but the last is a whole number of steps long, so every split
lands on a step boundary. A call that ends inside a step takes a short step
there, which a single long call would not. The short step moves every later
step boundary by that amount, so the fight can differ from the unsplit one,
as the table shows. The total time is the duration asked for either way.
`runFight` makes one `run` call, so it is never split.

### Live page

`js/main.js` is a view of the same engine `runFight` uses. It builds the fight
with `createFight(seed)` from `js/fight.js`, shows the seed in the header
(plain text, so the same seed can be replayed in `runFight`), and from each
animation frame it takes whole steps of `k("sim.fixedStep")` through
`step`. It holds no combat or timing rule. The conversion from a frame
timestamp to a number of steps lives in `FrameClock` (`js/frame-clock.js`),
which reads no clock itself:

1. The first frame, and the first frame after a resume, take no steps. They
   only record the timestamp.
2. After that, `elapsed = (time - previousTime) / k("sim.msPerSecond")`,
   floored at 0 and capped at `k("sim.maxFrameTime")`.
3. `available = carry + elapsed`, `steps = floor(available / k("sim.fixedStep"))`,
   and `carry = available - steps * k("sim.fixedStep")`. The leftover under
   one step carries to the next frame.

`k("sim.msPerSecond")` and `k("sim.maxFrameTime")` are `engineering` and retune
is off, and `js/frame-clock.js` is their only reader. One frame takes at most
`k("sim.maxFrameTime") / k("sim.fixedStep")` steps (16 at the values in
`data/constants.js`; the number follows the two constants and is not stored).
A backgrounded tab, a stalled main thread, or a long pause never turns into
one huge step or a burst of catch-up, and the excess time is dropped. It is not
a game rule: a 60 or 144 fps display never reaches it, and a page that runs
below the reciprocal of `k("sim.maxFrameTime")` frames per second (4 at these
values) runs slower than real time. Pausing cancels the animation frame, and
resume restarts the frame clock, so the paused gap is not simulated.

Every step is the same size as in `run`, so a seed gives the same fight live
and headless when both take the same steps (`test/live-view.test.js`). The page
has no short step, so a live fight always sits on a step boundary.

The DPS readout is high for the first moments. The page's first animation frame
takes no step. The first step comes with the first frame that fills one. It
fires the opening casts at fight time `k("sim.fixedStep")`, and the readout is
`damageDone / currentTime`, so an opening hit that lands is divided by that one
tiny step while the clock still reads 00:00. It can show thousands of DPS, and falls as
fight time accumulates. This is display only. Damage, casts, and the headless
result's `dps` (total damage over the whole duration) are not affected.

### Other time inputs

`k("latency")` is an assumption on the retune list. Its note says the engine
does not delay casts. `k("fight.duration")` is an assumption on the retune
list. Its note says the live sim runs until pause and does not read it. A
headless caller passes the duration to `run`, or to `runFight` (see Headless
fight).

### Tolerance and the order inside a step

`k("sim.tickEpsilon")` (`engineering`, retune off) is the tolerance for
`tickAuras` (buffs and debuffs), cooldown expiry, DoT ticks and DoT expiry,
`Rogue.tickPremeditation`, and `Weapon.tick`. The note also names the GCD.
`Simulation.tickGcd` does not read it. `Skill.cast` treats the GCD as ready
when the remainder is at or below it. See Global cooldown.

One step, in `Simulation.step`, does this in order:

1. Advance `currentTime` and regenerate energy, using Adrenaline Rush time
   from before the countdown.
2. Tick buffs, debuffs, and cooldowns. A cooldown at or below
   `k("sim.tickEpsilon")` becomes zero.
3. Tick the GCD. A remainder inside `k("sim.tickEpsilon")` stays positive
   until the subtraction reaches zero. `Skill.cast` already treats it as
   ready.
4. Tick dots that were already running.
5. Tick Premeditation expiry.
6. Run `Rogue.rotation`, which may cast and then swing. Anything applied
   here keeps the duration it was given until the next step.

The combat log keeps the newest `k("log.maxEvents")` rows (`engineering`,
retune off). That cap is display, not a game rule.

## Headless fight

`runFight({ seed, duration })` in `js/fight.js` is the one entry point for a
headless fight. It builds a `Rogue` and a `Simulation` with that seed, makes a
single `Simulation.run(duration)` call (so every step is `k("sim.fixedStep")`),
and returns the result as plain data. The module imports only engine files, so
it loads in Node with no `document`, `window`, `performance`, or other browser
global, and it reads no clock. The same `seed` and `duration` always give a
deep-equal result.

`seed` is required and must be an integer; it wraps to an unsigned 32-bit
value as in Random numbers, and the result reports that wrapped value. A seed
of 2^32 or above wraps and aliases to a small seed (`2 ** 32 + 5` is seed `5`),
so two such seeds can give the same fight.
`duration` is in seconds and follows the rules of `run`: a negative, `NaN`, or
infinite value throws a `RangeError`, and `0` is an empty fight. A missing or
non-integer `seed` also throws a `RangeError`, as does an argument that is
not an object (`runFight()` and `runFight(null)`).

The result has these fields:

- `seed` — the seed used.
- `duration` — the simulated seconds, `Simulation.currentTime` after the run.
- `totalDamage` — `Simulation.damageDone`, after armor.
- `dps` — `totalDamage / duration`, or `0` for an empty fight.
- `abilities` — an object keyed by ability name, in the order each first acted.
  White swings are `Main-hand` and `Off-hand`. Each value has the fields below.
- `log` — the combat log, newest first, holding at most `k("log.maxEvents")`
  events. Each event is a copy of the engine's row: `id`, `time`, `name`,
  `type`, `damage`, `status`, `outcome`, `icon`.
- `dataVersion` — which data produced the result (see Data version). It is a
  string and the last field. It does not change any number in the result.

The result is numbers, strings, plain objects and arrays. It holds no
reference to the `Rogue` or the `Simulation`, so `structuredClone`, JSON, and
`postMessage` carry it, and changing it changes nothing in another run.

### Per-ability record

`Simulation.abilityStats` keeps one record per ability for the whole fight. It
is not capped, unlike the log, so a long fight still has full totals.
`Simulation.recordAbility` adds to it from the places that already resolve an
attack: `resolveAttack`, `resolveDotAttack`, the DoT tick loop, and the cast
of a skill that is not an attack. It records and changes no combat rule.

- `damage` — damage dealt, after armor. A miss, dodge, or parry deals none. A
  DoT application deals none; its ticks do. The abilities' damage adds up to
  `totalDamage`.
- `casts` — attempts: one per swing, one per skill cast (a miss counts), and one
  per DoT application. A DoT tick is not a cast.
- `hits`, `crits`, `glances`, `misses`, `dodges`, `parries` — the outcome of each
  attempt, from the attack table. For an attack they add up to `casts`. A cast
  that is not an attack (Adrenaline Rush, Slice and Dice, Blade Flurry,
  Premeditation) has an outcome of none, so it only adds to `casts`. `hits` is
  a plain hit; a crit or a glance is counted under its own field. A DoT
  application cannot crit.
- `ticks`, `tickCrits` — DoT ticks, and the ticks that crit (see Bleeds and
  damage over time).

The attack table never gives a parry yet, so `parries` stays `0`.

### Load-time validation

`buildTalentCatalogue` checks the data as it builds, and throws on the first
problem. The catalogue for the vendored snapshot is built when `js/talents.js`
loads, so bad data fails that import loudly. The checks (roadmap D11):

- Every tree and talent has a non-empty `name` and `icon`, and a talent has
  `row`, `col`, `max` and `desc`.
- `row`, `col` and `max` are whole numbers of 1 or more.
- `max` equals the number of rank texts in `desc`, and each rank text is
  non-empty.
- Ids are unique, trees are unique, and no two talents in a tree share a row and
  column.
- A `req` names a talent in the same tree, on an earlier row, and not the talent
  itself. A `req` that names a talent in another tree is rejected, with a
  message that says so. A talent with no `req` is fine: Adrenaline Rush has none
  in the snapshot.

`test/talents.test.js` feeds each of these broken data and checks the message,
and checks the vendored snapshot passes. It also imports a copy of
`js/talents.js` beside a broken snapshot in a fresh Node process, to prove the
module itself fails to load.

## Data version

Every result says which data it came from. `js/data-version.js` builds
`dataVersion` from `data/talentsforever/manifest.json`, the file
`npm run data:refresh` writes: the snapshot's `generated` date and the client
`build`, joined as `<generated>+<build>`, for example `2026-10-20+1.60.1.70425`.
Neither part may be empty or contain a `+`, and a manifest that fails this stops
the module loading. A refresh changes the version with no code change.

`runFight` returns it as the last field, `dataVersion`, and `createFight`
returns it beside `seed`. The module reads the small manifest only, so the live
page does not load the 170 KB snapshot just to know its version.
`test/data-version.test.js` checks that the manifest agrees with `rogue.json`
(`generated` and `spellbook.build`), and with what `buildManifest` would write
for it.

Adding the field did not change any number. The golden fixtures do not hold it
(see Golden-seed tests), so they stayed byte-identical.

## Golden-seed tests

A golden test pins the whole result of a fixed fight, so a change to a rule, a
constant, or the engine shows up in review as a diff of numbers. The cases are
listed in `GOLDEN_CASES` in `scripts/golden-update.mjs`: a short fight (seed 1,
10 s), a 5-minute fight (seed 1, 300 s), another seed (12345, 90 s), and a
scripted-cast fight (seed 68, 50 s, described below). Each
has a fixture in `test/golden/<name>.json` holding the `runFight` result:
`seed`, `duration`, `totalDamage`, `dps`, every ability's record, and the capped
log. The one result field it leaves out is `dataVersion` (see Data version).
`runGoldenCase` drops it before comparing and before writing (`UNPINNED_FIELDS`
in `scripts/golden-update.mjs`), because it changes on every
`npm run data:refresh`, even when no number in a fight moves, and pinning it
would rewrite every fixture each time. `test/golden.test.js` checks it
separately: no fixture mentions it, and every result carries the current
`dataVersion`. The files put one ability and one log event on each line, so a
git diff points at the line that moved.

None of the first three cases casts Eviscerate or Rupture: the placeholder
rotation never calls Rupture, and it only rarely reaches Eviscerate, when Slice
and Dice has more than `k("rotation.sliceAndDiceRefreshSeconds")` left at the finisher
combo points (see `rotation.priority`). So they cannot pin finisher damage, DoT
ticks, or tick crits. The scripted case does. Its case in `GOLDEN_CASES` has a
`script`: a list of `Rogue.abilities` names, cast in order, each as soon as the
energy, the GCD, and the cooldown allow. `FINISHER_SCRIPT` is Sinister Strike
four times, Hemorrhage, Rupture, Sinister Strike five times, then Eviscerate.
Hemorrhage comes just before Rupture, so the fixture has Rupture ticks with
the Hemorrhage bonus and, after the debuff runs out, without it.
`scripts/scripted-fight.mjs` runs it on the real `runFight`: it swaps
`Rogue.prototype.rotation` for the one call so the script casts first, then
the rogue's own rotation runs with its skill casts switched off, so only the
weapon swings and the haste buffs are left. Nothing under `js/` changes, and a
script that has not finished by the end of the fight throws. The fixture has
8 Rupture ticks (2 of them crits) and an Eviscerate crit.

No golden case contains a parry. The attack table gives a parry chance of 0
until the front/behind split (A7), so a parry cannot happen. `parries` is
pinned at 0 in every fixture, and a test checks the attack table. When parry
becomes possible, add a case that has one.

`npm test` runs `test/golden.test.js`, which runs each case and compares it
with its fixture, field by field and exactly. It only reads the fixtures. When
a case fails, the message lists the fields that changed (for example
`abilities.Sinister Strike.damage: 734.6 -> 801.2`) and says how to regenerate.

When to update them:

- A change meant to move results (a rule fix, a new ability in the rotation, a
  retuned constant, a different `k("sim.fixedStep")`): regenerate the fixtures
  in the same pull request, and say in the description what changed and why the
  new numbers are right.
- A change that must not move results (a refactor, a speed-up, a rename): the
  golden tests are what proves that. If they fail, the change is wrong. Do not
  regenerate.
- Never regenerate just to make CI pass.

How to update them, on purpose:

```sh
npm run golden:update            # dry run: lists the changed fields, writes nothing
npm run golden:update -- --write # rewrites the fixtures that differ
```

Then read the fixture diff in git before committing it. `npm test`, `npm run
lint`, and `npm run provenance` never write a fixture. To add a case, add it to
`GOLDEN_CASES` and run the script with `--write`; to remove one, delete its
entry and its file. A fixture file with no matching case fails the tests, and
the message says to delete the file or add the case. `.DS_Store` is the one
file the check ignores. To change the scripted case, edit `FINISHER_SCRIPT` or
the seed in `scripts/golden-update.mjs`, then regenerate. Keep a seed that
still has tick crits: `test/golden.test.js` checks for them.
`.prettierignore` lists `test/golden/`, because Prettier would reflow the
one-line rows.

## Benchmark

The Phase 1 exit criterion is that a seeded 5-minute fight runs in Node in
under 50 ms (`TARGET_MS` in `scripts/bench.mjs`). `npm run bench` measures it:
it calls `runFight({ seed: 1, duration: 300 })` 20 times in one process, timing
each call, and prints the median, the slowest run, the cold run, and the warm
median. The cold run is the first call in a fresh process, while the engine is
still being compiled and cached; it is the slowest and the one closest to the
target. The warm median covers the runs after it. The seed and duration are
fixed, so every run is the same fight and only the timing differs. The report
names the Node version, because both it and the machine change the number.

The 50 ms target is for a development machine, and must not be read as a CI
guarantee. Measured on our own box (8 vCPU Xeon, Node 20): about 22 ms warm and
about 40 ms cold. Measured on the GitHub Actions runner (Ubuntu 24.04, Node
22.23.3), from the CI logs of PR #87: about 60 to 65 ms per 5-minute fight (the
five fights of the timing test took 308 and 328 ms in two runs). The runner is
about three times slower than our box and over the target, so no test asserts
the 50 ms figure.

`npm run bench` compares the median with `TARGET_MS` (50) and exits with status
1 when it is not under it. `--target-ms N` compares with `N` instead, so a
test can check the report and the exit status without depending on the speed
of the machine it runs on: a target of 0 always fails, and a target of a
million always passes. `test/bench.test.js` also drives the exit status with a
fake benchmark, including a 65 ms median against the real 50 ms default.

`test/bench.test.js` has one test that runs real fights and asserts a time: the
CI bound. It takes the median of 5 runs and asserts it is under `CI_BOUND_MS`,
which is 10 times the target (500 ms), about 8 times the runner's measured 60 to
65 ms. The bound is loose on purpose. A timing test on shared CI hardware must
not fail because the runner is slow or one run was stalled, so it uses a median,
not the slowest run, and a multiple of the target well above what any machine
we have measured needs. It catches a change that makes a fight cost many times
more, and leaves smaller slowdowns to `npm run bench`.

Timer reads (`performance.now()`) live only in `scripts/bench.mjs` and
`test/bench.test.js`. Lint rejects `performance` and `Date` in every engine
file, so no timing reaches `js/`. A speed-up to the engine must leave the golden
fixtures unchanged (see Golden-seed tests).

## Known limits of Phase 1

What a reader should not assume from the sections above:

- **Step size and splits.** A different step size, or a `run` split that ends
  inside a step, can change a seeded fight. QA measured seeds 1 to 200: the
  effect is small for short fights (0 to 3 seeds in 200 up to 60 s) and common
  at 5 minutes (120 to 142 in 200), while the mean damage over many seeds moves
  by under 0.04%. Changing `k("sim.fixedStep")` can change the golden
  fixtures. Use one `run` call per fight at the fixed step, as `runFight` does
  (see Fixed step for the table). The live page never takes a short step.
- **First DPS frame.** The live DPS readout reads high at 00:00 (see Live page).
- **Benchmark numbers are local.** The 22 ms warm and 40 ms cold figures are
  from our box (8 vCPU Xeon, Node 20). The GitHub Actions runner measured about
  60 to 65 ms per fight, so the 50 ms target is not a CI guarantee and no test
  asserts it (see Benchmark).
- **Parry.** The attack table gives a parry chance of 0 until the front/behind
  split (A7), so `parries` is `0` in every result and no golden fixture has a
  parry (see Golden-seed tests).
- **Live page.** It picks a new random seed on every load and has no way to
  enter one; replay a seed with `runFight`. It does not stop at
  `k("fight.duration")` (see Other time inputs). A page below the frame rate
  that matches `k("sim.maxFrameTime")` runs slower than real time.
- **Placeholder rotation, no talents.** The rotation is the placeholder Combat
  priority. It never calls Rupture, and it only rarely reaches Eviscerate, when
  Slice and Dice has more than `k("rotation.sliceAndDiceRefreshSeconds")` left
  at the finisher combo points. None of 100 seeds (1 to 100) cast it in a 120 s
  run, so the golden tests reach both through a scripted case. Talent ranks are not applied.

## Talent catalogue

`js/talents.js` reads the talent trees from the vendored snapshot,
`data/talentsforever/rogue.json`, into one lookup (roadmap D4). It holds no
talent number of its own. Every field below comes from the snapshot when the
module loads, so `npm run data:refresh` changes the catalogue with no code
change. Nothing in the engine or the live page uses it yet; the later Phase 2
issues build on it. It is validated when it loads (see Load-time validation).

Each talent has:

- `id`: `tree.slug`, for example `combat.precision` or
  `combat.dual-wield-specialization`.
- `tree`, `name`, `row`, `col` (the snapshot's 1-based grid position) and `max`
  (the rank cap).
- `req`: the id of the prerequisite talent in the same tree, or `null`. The
  snapshot names the prerequisite by talent name, and the loader resolves it.
- `icon`: the snapshot's icon name. It is a name only. Resolving it to a picture
  is a later issue.
- `ranks`: the tooltip text of each rank, rank 1 first (`ranks.length` is
  `max`).
- `passive`, `cost` and `fixed`: the snapshot's own fields. `cost` is the cost
  line of an active talent such as Blade Flurry, and `fixed` is a list the
  snapshot carries for Quietus. Both are `null` when the snapshot has none.

The slug rule is in `slugify`: lower-case the name, delete apostrophes, turn each
run of other characters into one hyphen, and strip hyphens from the ends. The
tree part of an id is the slug of the tree's name (`assassination`, `combat`,
`subtlety`).

The snapshot holds 53 talents: 17 Assassination, 17 Combat and 19 Subtlety. Its
`removed` lists (Classic talents that this build does not have) are not
loaded, and neither are the `classic` comparison fields. The lookups are
`get(id)`, `byTree(treeId)`, `byName(name, treeId?)` and `rankText(id, rank)`.
`byName` ignores case and leading and trailing whitespace (`" premeditation\n"`
finds Premeditation), and it throws a `TypeError` for a name that is not a
string. The catalogue is deeply frozen, because one object is shared by every
caller: `trees`, each tree, each tree's `talents` (the same array `byTree`
returns), `talents` and each talent are read-only. Loading it draws no random numbers, and the
module reads the JSON through an import attribute, so it needs no `fetch` or
`fs` and runs in Node and in the browser.
