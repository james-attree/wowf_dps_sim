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
attack roll, the glancing-damage draw, the second (crit) roll of a yellow hit, and
each DoT tick's crit roll all draw from it. A yellow hit that can crit takes two
draws and a glancing blow takes two since A7 (#100): that is the one change to
the draw order the attack table made (see Attack table). Nothing under
`js/` except `js/main.js` uses a platform random source, and lint rejects
`Math.random` there, including `Math['random']`, `globalThis.Math.random`, and
`self.Math.random`. The live page picks
a random seed at load, keeps it in `simulation.seed`, and shows it in the run
bar's Seed field (#153), where the player can type one or draw a new one. A `Rogue` that no
`Simulation` has adopted has no rng, and a draw throws.

A seed is any integer, and it wraps to an unsigned 32-bit value (`-1` is seed
`4294967295`, `2 ** 32` is seed `0`). `normalizeSeed` in `js/rng.js` is the one
seed check (#187): `SimRunner`, `runFight`, `createFight`, `runBatch`,
`BatchRunner`, `deriveSeed`, `createRng` and `Simulation` all go through it, so a
bad seed throws the same `RangeError` everywhere, and the text names the value:
`A seed must be an integer; got <value>.` The value is shown by `describeSeed`:
a string is quoted (`got "7".`, so it reads differently from the number 7),
numbers, booleans, `undefined` and `null` read as they print (`got NaN.`,
`got 1.5.`, `got null.`), a bigint keeps its `n`, an object, array or function
is named by its kind (`got an object.`), and a string longer than
`k("rng.seedTextLimit")` (40, `engineering`, retune off) characters
is cut and ends in `...`. `createRng()` and `new Simulation(rogue)` with no seed
use `k("rng.defaultSeed")`; every other entry point requires one. The batch
worker sends the error back by name and message, so a batch run through
`BatchClient` rejects with the same text.

## Attack table

`resolveAttack` in `js/attack-resolver.js` is the Classic 1.12 melee attack
table (A7, #100), at 300 weapon skill against a level 63 target. The numbers
are the Magey Classic Warrior wiki's "Attack table" page, read as constants
(source `classic-1.12`, on the retune list; the page is the `ref`). They are
not re-derived from a skill gap: a change of `k("weaponSkill.base")` or
`k("target.defense")` moves only the hit suppression (below), and the other
rows would have to be retuned by hand.

The page is written for warriors and is cited as the Classic reference for the
table. Where a number is not defined, the row uses the Classic value (or 0)
tagged as an assumption with retune on: `block.value` and `dot.critSuppression`
are the two. A rogue-specific cross-check would be a good later task.
wowsims/classic's `sim/core/target.go` (`NewAttackTable`, which cites the same
page) gives the same miss, hit suppression, dodge, parry, block, glancing
chance, glancing damage range and crit suppression at these levels (read 26 Oct
2026); each row's note says so.

**Two shapes.** A white swing (`attackType` `"weapon"`, main hand and off
hand) is one roll over the bands, in this order (`k("table.white")`): miss,
dodge, parry, glancing, block, crit, hit. A yellow attack (`"skill"`) is two
rolls (`k("table.yellow")`). The first walks miss, dodge, parry, block and is
a hit when none of them takes it. A hit then rolls again for the crit, against
the crit chance alone. So a white crit is a slice of the one roll and takes
its share of the table, and a yellow crit is its own chance on top of a hit.
There is no glancing band for a yellow attack, and a glancing blow cannot crit.

**The roll and the draws.** The roll is one draw from the simulation's rng
(see Random numbers) times `k("attack.rollScale")` (`engineering`, retune
off). The function walks the bands in order, adding each chance times the
scale, and takes the first band whose running threshold is strictly above the
roll; a roll that lands on a threshold falls through. Whatever is left is a
hit. The chances are not renormalised, so a crit chance at the top of the clamp
can leave no hit band. The draws, in order:

1. the table roll (always);
2. on a glancing blow, the glancing-damage draw;
3. on a yellow hit that can crit, the crit roll (even when the crit chance is
   0, so the number of draws does not depend on gear).

Callers may inject any of the three (`roll`, `glanceRoll`, `critRoll`, on the
rollScale), and then no draw is made for it. An attack with `canCrit: false`,
which is a DoT's application, takes no crit roll.

**The chances.** Bonus hit and crit are clamped into the unit interval. A
non-finite chance throws. The sim passes `Rogue.getBonusHitChance()` and
`Rogue.getCritChance()` (the `k("character.bonusHitChance")` and
`k("character.critChance")` rows, `classic-1.12` and on the retune list).

| Band                  | Chance                                                                                           | At 300 against 315                         |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Yellow miss           | `max(0, k("miss.yellow") - hit)`                                                                 | 8% (5% + 15 x 0.2%)                        |
| White miss            | `max(0, k("miss.yellow") + k("miss.dualWieldPenalty") - hit)`                                    | 27% (8% + the flat 19% dual-wield penalty) |
| Dodge                 | `max(0, k("dodge.target") - dodgeReduction)`                                                     | 6.5%                                       |
| Parry (front only)    | `max(0, k("parry.target").front - parryReduction)`, 0 from behind                                | 14%                                        |
| Glancing (white only) | `k("glancing.chance")`                                                                           | 40%                                        |
| Block (front only)    | `k("block.target").front`, 0 from behind                                                         | 5%                                         |
| Crit                  | the clamped crit chance less `k("crit.suppressionSkill")` and `k("crit.suppressionAura")`, min 0 | 4.8% less (3% skill + 1.8% aura)           |

`hit` is the clamped bonus hit less `k("hit.suppression")` (1%), floored at 0. The suppression applies only while `k("target.defense")` is more than
`k("hit.suppressionGap")` (10) above `k("weaponSkill.base")`, which is true
here (315 against 300). That is why the hit cap is 9% for a yellow attack
(8% miss plus the 1% that does not count) and 28% for a white one. A dodge or
parry reduction comes from the modifier pipeline, comes off its own band only,
and never takes the band below 0, so it cannot move another band.
`k("target.behind")` is the default position (see SimConfig, `target.behind`).
Ghostly Strike stores `k("ghostlyStrike").duration` as a self buff and does
not change the dodge chance.

**Position.** `config.target.behind` (default `true`, `k("target.behind")`)
says where the rogue stands. Behind the target the parry and block bands have
zero width, so the default fight has no parry and no block. From the front
they are `k("parry.target").front` and `k("block.target").front`. The
position is read for every attack and DoT application, and the golden cases
all use the default.

**Scope: behind only.** This is a simulator for attacking from behind, where
neither parry nor block applies (project owner ruling 2026-10-26). The front
table (`target.behind = false`, with its parry and block bands) is retained in
the engine and covered by tests, but it is out of scope and unsupported for
tuning: its constants are not retuned and no result from the front should be
relied on. `k("block.value")` stays 0.

**Glancing damage.** A glancing blow does `k("glancing.damage")`, a range
`{ low, high }` (0.55 to 0.75 at this skill gap, the Magey formulas
`min(0.91, 1.3 - 0.05 x gap)` and `min(0.99, max(0.2, 1.2 - 0.03 x gap))`),
and the factor is the glancing draw spread evenly across it:
`low + (high - low) x draw / rollScale`. The result has `glanceFactor`; it is
null for anything else.

**Block.** A block is a landed hit that loses `k("block.value")` damage, never
below 0, and cannot crit. `k("block.value")` is 0 (an assumption, no source in
hand gives the amount), so a block does full damage. Blocks are counted under
`blocks` in an ability's record, next to `parries`.

**Where wowsims differs.** wowsims/classic draws a glancing-damage roll on
every white swing, and does not clamp the crit chance. This engine draws the
glancing roll only when the swing is a glancing blow, and clamps the crit
chance (to 0 to 1, after the suppression comes off: see below). The outcome bands are the
same; the difference is in how many draws a fight takes, and in a crit chance
that would go below 0 or above 1 (noted in the #121 QA review).

**Crit suppression.** The crit chance a white swing or a yellow second roll
reads is the chance less 3% (the skill gap, 0.2% per point) and less
1.8% (the aura term, a flat reduction Magey notes), then clamped to 0 to 1. The
suppression comes off before the clamp (D8a PR 2, #119), so a raw crit chance of
104.8% or more is a sure crit once the suppression is paid, which Cold Blood's
+100% needs; clamped first, it would have given 95.2%. A raw chance of 100% or
less is as it always was, so only a raw chance above 1 behaves differently, and
no golden fixture has one. The crit roll is still drawn at any chance above 0
after a `hit`, so the draw count does not depend on the chance. A DoT tick
reads the same suppressed chance (`dot.canCrit`), so its crit chance drops by
4.8% too. That is `k("dot.critSuppression")`, an assumption on the retune list:
no source says whether a tick takes the suppression, and `false` leaves a tick
at the full chance. The 2x tick crit multiplier is `dot.critMultiplier`. A
DoT's application never crits.

**Spell hit table.** `spellMissChance` and `resolveSpellHit` give the 17%
miss, floored at 1%, that a poison proc uses (A5, `k("spell.missTarget")`),
with status "Resist". A `dealDamage` or `applyDot` proc action with `spellHit`
draws one roll from it (see [Poison procs](#poison-procs-a5-issue-105)).

Damage is the base times a multiplier, then `Math.floor`. A miss, dodge or
parry multiplies by zero. A glance uses the glancing factor. A crit uses
`k("crit.meleeMultiplier")` (`classic-1.12`, on the retune list). A hit keeps
the base damage. The result is `landed` for a glance, a block, a crit or a
hit. A glance can floor to zero damage and still count as landed. The result
is `{ outcome, status, roll, critRoll, glanceFactor, damage, landed }`, with
`critRoll` null when no crit roll was made.

`Simulation.resolveAttack` then runs that damage through armor (see Armor)
and adds it to the total when the attack landed and the armored damage is
still positive.

## Weapon swings and normalised speed

`Weapon` in `js/weapon.js` holds a min, a max, a speed, a hand
(`"main"` or `"off"`), and a type. The constructor throws a `RangeError`
when min damage, max damage, or speed is not a finite number, and when
speed is not greater than 0. Min damage greater than max damage throws the
same way. The default weapons are `k("weapon.mainHand")` and
`k("weapon.offHand")` (Vis'kag and Brutality Blade, Classic reference values;
the dagger set is `weapon.dagger.*`). The main-hand type is `k("weapon.mainHand.type")`
(`"sword"`, Scout's recommendation from the research, relayed; the project owner asked for the Tier 1 stats), copied onto the
weapon. The off-hand constant carries its own type, `"sword"`.

The weapon die is an inclusive integer from min through max. The `1` in the
span is the code's inclusive end, not a constant:

`floor(random * (max - min + 1)) + min`

A white swing's hit, in `Weapon.rollDamage`, is that die plus attack power
divided by `k("ap.perDps")`, times the weapon's own speed. Attack power is
`Rogue.getAttackPower()`, the default `k("character.attackPower")` (`classic-1.12`,
on the retune list). `k("ap.perDps")` is `classic-1.12` and on the retune
list. An off-hand swing then multiplies that whole sum, die and attack-power
term together, by `k("offHand.damageMult")` (`classic-1.12`, on the retune
list). The note says Dual Wield Specialization is not applied on top.

Specials that use the weapon call `Rogue.rollWeaponDamageForSkill`. That is
the main-hand die plus attack power divided by `k("ap.perDps")`, times
the normalised speed of the main-hand weapon type (issue #129). The rogue
picks it once, in the constructor, from `config.weapons.mainHand.type`:
`k("normalizedSpeed.dagger")` (1.7 s) for `"dagger"`, and
`k("normalizedSpeed.oneHand")` (2.4 s) for any other type, including none.
Both are `classic-1.12` and on the retune list; the project owner confirmed
1.7 for daggers and 2.4 for the other one-hand weapons (relayed by Scout).
Only the main hand matters: every special rolls the main-hand weapon, and
the off-hand type and the off-hand swing (a white swing, which uses the
weapon's own speed) never use a normalised speed. The pick is made at
construction, so changing `weapons.mainHand.type` afterwards changes only
the Ghostly Strike and Hemorrhage weapon percent, not the normalised speed.

Sinister Strike is the rotation's builder. It deals the normalised hit plus
`k("sinisterStrike").bonusDamage` and has no weapon multiplier. Hemorrhage
and Ghostly Strike stay implemented and are not in the rotation. A landed
Hemorrhage deals that normalised hit times one entry of
`k("hemorrhage").weaponMultiplier` and applies a target debuff for
`k("hemorrhage.ruptureBonus").duration`. A landed Ghostly Strike deals the
normalised hit times one entry of `k("ghostlyStrike").weaponMultiplier`.
The main-hand type `"dagger"` selects the `dagger` entry. Every other type,
including the default Vis'kag (a sword), selects `other`. Both constants are
`wowf-export` and are not on the retune list. Backstab is that hit times
`k("backstab").weaponMultiplier`, plus `k("backstab").bonusDamage`. Ambush
is that hit times `k("ambush").weaponMultiplier`, plus
`k("ambush").bonusDamage`. Sinister Strike, Backstab, and Ambush are
`wowf-export`. Backstab needs a dagger in the main hand (see below). The note
on `k("ambush")` says its dagger, behind and stealth requirements are not
enforced, and the note on `k("backstab")` says its behind requirement is not.
The note on
`k("sinisterStrike")` is weapon damage plus the bonus. The default rotation
does not cast Backstab or Ambush.

Each hand has a `SwingTimer` (`js/core/swing.js`, #195) that
keeps one pending swing event. When it fires, the swing is resolved and the
next one is scheduled one interval on. The interval is weapon speed divided
by the haste multiplier read at that swing,
`simulation.modifiers.resolve("haste", 1)` (see Haste stacking). While the
interval stays the same, the n-th swing after the last change is at
`anchor + n * interval`, so swings do not drift. The main hand swings at the
fight's start. The off hand's first swing is at
`k("weapon.offHand").initialSwing`. The note says that delay keeps the hands
from swinging together at the start. Haste does not rewrite a delay that is
already counting down. Before #234 the fixed-step `Weapon.tick` did this per
frame, with the same haste rule.

Each swing calls `Simulation.resolveAttack` with attack type `"weapon"`.

## Global cooldown

`Simulation` stores `gcdDuration` from `k("gcd.duration")` (`classic-1.12`,
on the retune list). The note says this is the rogue GCD and that wowsims
uses the same length for its minimum. `Simulation.setGcd` sets `gcd` to that
duration. The event core keeps the GCD's end as one expiry event at the
exact time (see Expiry timers) and writes the time left back to `gcd` at
each event. At its end `gcd` is 0. The note on `k("sim.tickEpsilon")` lists
the GCD among the timers that use that tolerance: `Ability.cast` compares
the remainder with it.

`Ability.cast` in `js/ability.js` treats `triggersGcd` as on unless the
catalogue says the ability does not start the GCD (`startsGcd`, from
`abilities.offGcd`). An ability that triggers the GCD is ready when `simulation.gcd`
is at or below `k("sim.tickEpsilon")`. A larger remainder still waits. A
cast that proceeds calls `setGcd`. A remainder within the tolerance is
ready, so a cast can land up to `k("sim.tickEpsilon")` before the exact end
(on the core the GCD's end is an event, so a decision runs at it). An ability that does not trigger the GCD skips that
wait, does not start a GCD, and does not clear one that is already running.
The comment on that branch says a later off-GCD ability would inherit the
same rule.

`k("gcd.flags")` (`classic-1.12`, on the retune list) records Slice and Dice,
Blade Flurry, and Adrenaline Rush on the GCD, and Premeditation off. The
note says this is applied. Premeditation has `triggersGcd` off. Slice and
Dice, Blade Flurry, Adrenaline Rush, and the other abilities have it
on, so a successful cast starts the GCD. This is the rule from #57.

The decision runs after every expiry due at the same time (see Tolerance and
the order at one time), so a GCD that ends at a decision's time is ready for
it. A GCD, cooldown, buff, or debuff started at a decision runs its full
length from that time.

The live page (`js/views/visualiser.js`) sets the GCD status to "On cooldown" while `simulation.gcd > 0`,
and to "Ready" otherwise. When the remainder is still positive and already
within `k("sim.tickEpsilon")`, that label can read "On cooldown" while
`Ability.cast` treats the GCD as ready.

## Sample rotation

The default rotation (`js/rotation-default.js`, run by `Rogue.castRotation` at
each decision) reads `k("rotation.priority")` (`wowf-designer`, on the retune
list). The ref records the placeholder Combat rotation. It tries, in
order:

1. Each ability in `onCooldown`, in order: Blade Flurry, then Adrenaline
   Rush. Both are tried whenever they are ready. Adrenaline Rush has no
   energy threshold.
2. When combo points are at `k("rotation.finisherComboPoints")`, Slice and
   Dice if that buff is missing or its remaining duration is at or below
   `k("rotation.sliceAndDiceRefreshSeconds")`. Otherwise Eviscerate.
3. Otherwise Sinister Strike.

Weapon swings are not in the list: they are events of their own, with the
haste multiplier from `stackHaste` (see Weapon swings and normalised speed).

Ghostly Strike, Premeditation, Hemorrhage, and Rupture stay implemented and
are not in this list. This replaces the earlier rule that refreshed Slice and
Dice before combo points were full, ahead of a Rupture at `k("combo.max")`.
Sinister Strike spends its energy cost on the way to the next finisher, so a
fight can reach `k("rotation.finisherComboPoints")` only after Slice and Dice
has already fallen to `k("rotation.sliceAndDiceRefreshSeconds")` or less.
Eviscerate is still the branch taken when the buff is longer than that.

Each cast still has to pass `Ability.cast` (cooldown, combo points for a
spender, energy, and the GCD). Every ability in the list starts the GCD, so
the first one that succeeds blocks the rest of that decision. Weapon swings
are events of their own (see Weapon swings and normalised speed), not part of the rotation.

## Energy

Energy is a resource, a pool described as data in `js/resource-data.js` (see
[Resources](#resources)). The fight starts at `k("start.state").energy`. That
object is an assumption on the retune list. Energy caps at the pool's cap,
which is `k("energy.max")`
(`classic-1.12`, on the retune list) through any `resourceMax` modifiers. The
note on `k("energy.max")` says the cap matches the export's Vigor bonus.
`rogue.energy` and `rogue.maxEnergy` read and set the pool, so the page and the
tests use the names they always did.

Regen per second is `k("energy.regenPerSecond")` (`wowf-export`, not on the
retune list). The note says Forever regenerates continuously, and that
Classic used a periodic tick. The engine regenerates continuously (below). It
does not wait for a tick.

During a core run, energy is an `EnergyPool` (`js/core/energy.js`, #194). It
reads `min(cap, value0 + rate * (now - t0))`, so energy is exact at any time
and nothing is added per step. The rate is the pool's regen rule through the
modifier contributions of the kind that rule names, `energyRegen` (see
Modifiers). Adrenaline Rush's `energyRegenMultiplier` effect compiles into an
`energyRegen` `mult` modifier (`k("adrenalineRush").regenMultiplier`, once per
stack). With none, the rate is `k("energy.regenPerSecond")`. The rate and the
cap change only at events (an aura applying or expiring), and each change
starts a new line from the value at that time, so a timed contribution
applies exactly while its aura is up. The cast that applies Adrenaline Rush
does not get the faster rate before it: the buff starts at the cast. The pool
counts what it loses at the cap (`cappedTime`, overflow) as the `Resource`
does.

Before #234 the fixed-step engine added the regeneration per step
(`Simulation.regenerateResources`, `Resource.regenerate`). It sliced a step where a timed contribution ran out (#155); the
event core needs no slices.

`Ability.cast` spends the cost before the attack roll. The cost is the
base cost resolved through the `energyCost` modifiers for that ability (never
below 0, the cost kind the energy pool's definition names), so a talent that
lowers a cost is data. If the attack does
not land, it refunds `cost * k("skill.missEnergyRefund")` (a gain on the pool,
so it stops at the cap) and returns
without a cooldown, combo points, or an aura. The GCD, if this ability
starts one, is already running. `k("skill.missEnergyRefund")` is an
assumption on the retune list. Its ref says Classic and the export do not
describe that refund. Its note says the refund has been present since the
initial skill code. A glance, a block, a crit, or a hit is landed, so it is not
refunded. Adrenaline Rush, Blade Flurry, Slice and Dice, and Premeditation
are not attacks, so they have no miss refund.

## Combo points

The fight starts at `k("character.startingComboPoints")`. `k("start.state")`
records the same combo-point count and full energy. Both are assumptions on
the retune list. The ref on `k("character.startingComboPoints")` says there is no pre-pull
Premeditation. The note says the sample fight reads this value, and that
`k("start.state")` records the same combo points and full energy. The cap is `k("combo.max")` (`wowf-export`, not on the retune
list).

Combo points are a resource too (see [Resources](#resources)). A builder
gains its `gain` amount on the pool, capped at `k("combo.max")` through any
`resourceMax` modifiers. If
that gain actually added a point, and the ability is not Premeditation,
the pool's expiry timer is cancelled (`Rogue.clearPremeditation`) and the points stay in
place. A non-Premeditation builder that gains nothing, because the rogue is
already capped, leaves the timer alone. A spender spends all of the pool (`Resource.spendAll`, which returns the
count it took, read before the reset) and cancels the timer. `Ability.cast`
rejects a spender when the pool holds none, before it spends energy or starts the GCD.

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
Rupture is implemented and the default rotation does not call it.

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
start the GCD. The `premeditation` constant's note says the
export spell_desc has no Stealth requirement and that Classic required it.
The note on `k("premeditation.cpExpiry")` says Classic needed Stealth. The
engine does not check for it. There is no Stealth check in `Premeditation`.
The default rotation does not cast it.

On a successful cast the executor arms the combo point pool's expiry
(`Resource.armExpiry`, from the ability's `expires` data) and sets the removal amount to
`k("premeditation.cpRemovedOnExpiry")` and the timer to
`k("premeditation.cpExpiry")`. A later Premeditation replaces both. The
expiry constant is `wowf-export` and is not on the retune list. Its note says
Classic used a shorter expiry. The removal amount is an assumption on the
retune list. Its note says expiry always removes that many points, even when
the cap meant fewer were added, and that the result is clamped so combo
points do not go below zero.

The expiry is a timer on the event core (`js/core/fight.js`, the `points`
timer kind). When it runs out, the core calls the pool's `tick` with the time
that was left, so `Resource.tick` decides it as before: with the remaining time
at or below `k("sim.tickEpsilon")`, combo points drop by the armed amount,
clamped at zero, and the timer is cleared. The rotation decides after that, at
the same time. A finisher, or a later cast that actually
adds a combo point, clears the timer first, so those points are not removed
on top of being spent or folded into a new builder.

## Adrenaline Rush

`AdrenalineRush` spends `k("adrenalineRush").energy`, applies a self buff for
`k("adrenalineRush").duration`, and starts `k("adrenalineRush").cooldown`.
The constant is `wowf-export` and is not on the retune list. The note says
the engine uses the export cooldown, and that casting starts the GCD. It is
not an attack. It does not generate combo points.

The default rotation tries it on cooldown, after Blade Flurry, as the second
`onCooldown` id in `k("rotation.priority")`. It does not wait for an energy
threshold. While the ability is on cooldown, `Ability.cast` returns without
refreshing the buff. The regen multiplier is under Energy:
`k("adrenalineRush").regenMultiplier` while the buff is up: the energy
pool's rate changes at the buff's start and end (`modifiersChanged`).

## Blade Flurry

`BladeFlurry` spends `k("bladeFlurry").energy`, applies a self buff for
`k("bladeFlurry").duration`, and starts `k("bladeFlurry").cooldown`. The
constant is `wowf-export` and is not on the retune list. The note says cleave
is ignored on a single target, and that casting starts the GCD. It is not an
attack and it grants no combo points. There is no second target.

The default rotation tries it at every decision, first in
`k("rotation.priority")`.
When the cast succeeds it takes the GCD, so Adrenaline Rush, Slice and Dice,
Eviscerate, and Sinister Strike wait. While the buff's duration is still
positive, its haste fraction `k("bladeFlurry").haste` is passed to
`stackHaste`.

## Slice and Dice

Slice and Dice (`js/ability-data.js`) is a spender and not an attack. It spends
`k("sliceAndDice").energy`, spends every combo point, and clears a
Premeditation timer. `k("sliceAndDice").cooldown` does not become a cooldown
entry, because `Ability.cast` records one only when the cooldown is positive.
The cast is logged as a cast, with no attack roll. The constant is
`wowf-export` and is not on the retune list. Its ref names the `spell_desc`
row the export uses for this cast.

`triggersGcd` stays on (the catalogue's `startsGcd`), so a cast that proceeds calls
`Simulation.setGcd`. The `sliceAndDice` note and the `gcd.flags` note both
say casting it starts the GCD.

Duration is per combo point. When the combo points fall inside
`k("sliceAndDice").durationByCp`, `Ability.resolve` reads that entry as the
length of the buff `Ability.cast` stores on `activeBuffs`. Outside those combo
points the length is 0 and no buff is applied. The first entry is
the duration for one combo point. The `sliceAndDice` note says the stored
series is the export's per-combo-point duration, a base plus a step times
combo points,
written out per point so the engine can index it. The engine does not
evaluate that expression itself. The buff is a player aura, not a debuff,
and it deals no damage.

`Ability.resolve` then passes the length through the `duration` modifiers
scoped to the ability (Improved Slice and Dice, +15% of the length per rank, so
x1.15, x1.3 and x1.45; see [Modifiers](#modifiers)). The stored length is the
modified one, so the refresh check and the time left follow with no other
change. A length of 0 stays 0, and with no `duration` modifier the length is
untouched, so an untalented fight is unchanged.

The default rotation considers it only when combo points are at
`k("rotation.finisherComboPoints")`. The cast is attempted when the buff is
missing, or its remaining duration is at or below
`k("rotation.sliceAndDiceRefreshSeconds")`. Both thresholds are
`wowf-designer` and on the retune list, and `k("rotation.priority")` records
the same decision. A longer remaining duration spends those combo points on
Eviscerate instead. Blade Flurry and Adrenaline Rush are tried earlier and
start the GCD, so when one of them is ready it takes that decision and
Slice and Dice waits until the GCD is clear.

While the buff is up, its haste modifier gives
`k("sliceAndDice").haste` to `stackHaste`. The note says that haste
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

Each swing reads its multiplier as
`simulation.modifiers.resolve("haste", 1)`. The `haste` kind has the `haste`
stacking form: the pipeline starts at 1 and, for each `haste` modifier in
order, replaces the multiplier with `stackHaste` of the current multiplier and
the modifier's value, once per stack (an aura's `haste` effect compiles into a
`haste` `add` modifier, and its stacks repeat it). Static haste modifiers come
first, then the auras in the registry order of `js/auras.js`, Slice and Dice
then Blade Flurry, whichever was cast first. It names no aura. With no haste
modifier the multiplier is exactly 1. The swing timer divides weapon speed by
the result. Both hands use the same multiplier.

- Multiplicative: `stackHaste` returns the current multiplier times
  `(1 + haste)`. With both buffs the interval divisor is
  `(1 + k("sliceAndDice").haste) * (1 + k("bladeFlurry").haste)`. That is
  the product the `haste.stacking` note describes.
- Additive: `stackHaste` returns the current multiplier plus the haste
  fraction. With both buffs the divisor is
  `1 + k("sliceAndDice").haste + k("bladeFlurry").haste`.
- Any other value throws `Unknown haste.stacking: …` from `stackHaste`.

One buff alone is `1 + haste` under either setting, because the multiplier
starts at 1. The `1` there is the unhasted multiplier the swing passes to
`resolve`, not a constant.

The swing timer does not move a pending swing when a buff is applied or
removed. Only when a swing fires does it schedule the next one,
`speed / hasteMultiplier` later, using the multiplier at that swing. The next
swing is the one that shortens. The swing that was already
counting down keeps its remaining time, including the off-hand's opening
delay. The notes on `sliceAndDice` and `haste.stacking` both say this. The
`haste.stacking` note says wowsims rescales the swing in progress in
`UpdateSwingTimers`. This engine does not.

## Armor

`Simulation.armorMultiplier(context)` (a method, in `js/simulation.js`) reads
`k("target.armor")` (an assumption on the retune list; negative armor is
treated as zero), subtracts the armor the target's auras take off (the
`armorReduction` effects, such as Expose Armor, A6) and floors the result at
zero. Then it applies `k("armor.mitigation")` (`classic-1.12`, on the retune
list). The reduction is

`armor / (armor + k("armor.mitigation").constant + k("armor.mitigation").perLevel * k("character.level"))`

where `armor` is the figure left after the auras and after armor ignore. Armor
ignore is the `armorIgnore` modifier for the attack's context (a mace talent,
say): a fraction of the armor left after the auras, taken off before the
formula, and capped at 1. The reduction is capped at
`k("armor.mitigation").cap` and not below zero. Damage kept is the incoming
damage times one minus the reduction. If the denominator is not
positive, the multiplier is one and nothing is removed.
`k("character.level")` is `wowf-export` and is not on the retune list. The
notes on `character.level` and `armor.mitigation` describe the divisor's
constant term at that level. The engine evaluates the expression above.
`applyArmor(damage, skip, context)` is the one place damage meets it, for
direct hits and ticks alike.

`Simulation.resolveAttack` always applies this to a direct hit, after
`resolveAttack` has floored the pre-armor damage. The running total keeps
the product. The live page's combat log (`js/views/visualiser.js`) floors a cell when it
draws it.

A hit or a tick skips armor when the event's tags say so (`skipsArmor` in
`js/simulation.js`; see [Damage tags](#damage-tags)). A bleed skips when
`k("bleed.ignoresArmor")` is set and the event has the `bleed` tag (the dot is
marked `bleed` or its ability id is in `k("bleed.spells")`). A nature event
skips when `k("nature.ignoresArmor")` is set and its school is nature (the id is in
`k("nature.spells")`). Those four constants are
`classic-1.12` and on the retune list. The bleed note says physical periodic
damage skips armor, and that a physical direct hit is reduced. The nature
note says armor is for physical damage and that spell resistance is not
modelled. Nothing in `js/simulation.js` applies spell resistance.

`k("bleed.spells")` lists the ids `rupture` and `garrote`. `k("nature.spells")`
lists `instant-poison` and `deadly-poison`. Rupture's cast sets `bleed`, so its ticks skip when
`k("bleed.ignoresArmor")` is set. Garrote has no skill class. A dot with the id
`deadly-poison` skips as nature: Deadly Poison's ticks do skip armor. The
rotation does not create one; the poison procs do. See Poisons.

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
the ticks. Otherwise no dot is stored.
`k("dot.snapshot")` (`classic-1.12`, on the retune list) says Rupture damage
is fixed when the cast resolves. The stored `tickDamage` is that snapshot.
The per-tick crit roll is not part of it.

Each tick is its own event (`js/core/dots.js`, see DoT ticks under
Event-queue engine): the first is one interval after the cast, and the
n-th at the cast time plus n intervals. Each tick:

1. Start from `tickDamage`.
2. For each `dotDamageTaken` effect on the target that names this DoT's id
   (Hemorrhage's names `rupture`), multiply by `1 + bonus × stacks`. Stacks
   add, they do not compound: two stacks of a +15% effect give `1.30`, not
   `1.3225`. For Hemorrhage (one stack) that is
   `1 + k("hemorrhage.ruptureBonus").bonus`. The `1` is
   the code's base, not a constant. `k("hemorrhage.ruptureBonus")` is `wowf-export` and is not on
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
4. Apply armor unless `skipsArmor` skips it (a bleed or a nature tick).
5. Add the result to the damage total. Tick damage is not floored here.

Every tick deals a full tick. The dot is removed when its time left is at
or below `k("sim.tickEpsilon")`. A cast DoT has `floor(duration / interval)`
ticks, the count its damage is split over.

Before its ticks, each DoT's `tickInterval` is checked (#193). One that is not
a finite number above 0 throws a `RangeError` naming the DoT, for example
`DoT "rupture" has tick interval 0; it must be a finite number of seconds above 0.`
An interval of 0 or less would tick forever at one time, and `NaN` or
`Infinity` would silently never tick. No DoT the sim builds today has such an
interval, so no fight changes.

## Poisons

Instant Poison and Deadly Poison are applied through the proc pipeline when
`config.poisons` names them (A5, #105; see
[Poison procs](#poison-procs-a5-issue-105)). The default config names none, so
the default fight is the same as before. `k("poison.charges")` says charges are
ignored. `k("poison.spells")` lists the two poisons for the `poison` tag (see
[Damage tags](#damage-tags)), so a modifier can name them, and
`k("nature.spells")` makes their hits and ticks skip armor.

### Poison definitions (D9, issue #104)

`js/poisons.js` reads each rogue poison from the snapshot (`spell_desc`, the
spellbook's Poisons tab), rank by rank, the way `js/abilities.js` reads the
abilities (D1, #93). It builds `poisonCatalogue`, deeply frozen, with no random
numbers and no clock. The definitions are data only: the catalogue draws
nothing. `poisonProcs` (A5, #105, see [Poison procs](#poison-procs-a5-issue-105))
reads them to build the poison procs, and the golden fixtures do not move.

A poison's text is `COATING EFFECT [STACKS] [CHARGES]`, and each sentence is
matched whole, so an extra or reworded sentence is an error, not a skip. The
error is an `AbilityParseError` that names the poison and the rank ("Cannot
read Wound Poison rank 3 from the spell data: ..."). A rank's result is
`{ id, name, rank, spellId, chance, coatingDuration, charges, effect, text }`:

- `chance` is the chance per strike (0.2 for 20%), above 0 and at most 1.
- `coatingDuration` is the time the coating lasts, in seconds (the text says
  minutes; `abilities.secondsPerMinute` converts it).
- `charges` is the number of charges, or `null` when the text gives none
  (Crippling Poison has none).
- `effect` is one of five kinds:

| `effect.kind`      | Fields                                      | Poison         |
| ------------------ | ------------------------------------------- | -------------- |
| `damage`           | `school`, `min`, `max` (a direct hit)       | Instant Poison |
| `dot`              | `school`, `damage`, `duration`, `maxStacks` | Deadly Poison  |
| `healingReduction` | `amount`, `duration`, `maxStacks`           | Wound Poison   |
| `slow`             | `fraction`, `duration` (movement speed)     | Crippling      |
| `castSlow`         | `fraction`, `duration` (casting time)       | Mind-numbing   |

A kind that can stack (`dot`, `healingReduction`) reads "Stacks up to N times";
with no such sentence it has one stack. The school in the text must be the
spell entry's own school (`sc`).

A poison is `{ id, key, name, dps, noDpsReason, ranks, top }`. `id` is the slug
of its name (`deadly-poison`), `key` is the config id (`deadly`, one of
`config.poisonIds`), and `top` is the highest rank. The catalogue has
`poisons`, `dps`, `noOps`, `get(id)`, `byKey(key)` and `rank(id, number)`.
Ranks must run 1 to N with no gap or duplicate. The tab's Blinding Powder is
not a poison and is skipped by id (`k("poison.tabSkip")`).

Which poisons deal damage in this sim is a decision, not something the text
says: `k("poison.spells")` lists them (Instant and Deadly) and `dps` is true
for those. Every other poison needs a reason in `k("poison.noDpsReasons")`
(Wound, Crippling and Mind-numbing), and the catalogue throws for a poison with
neither or both. A no-op poison is still fully parsed, so its numbers are there
when a later phase wants them. The top ranks on the Forever beta text are
Instant Poison 6 (20%, 76 to 100 Nature, 175 charges), Deadly Poison 5 (30%,
92 Nature over 12 s, 5 stacks, 180 charges), Wound Poison 4 (30%, 165 healing
reduction for 15 s, 5 stacks, 160 charges), Crippling Poison 2 (30%, 70% slow
for 12 s) and Mind-numbing Poison 3 (20%, 60% longer casts for 14 s, 150
charges).

`k("poison.instant")` and `k("poison.deadly")` stay in the constants, and A5
reads the proc chance and the numbers from the catalogue; `test/poisons.test.js` checks them against the parsed top ranks, and
checks the poison ids in `config.poisonIds`, `poison.spells` and `nature.spells`
against the catalogue. `k("poison.charges")` stays `"unlimited"`: the parsed
`charges` are not used up in a fight, so a coating lasts the whole fight. The
page's poison selector says so: next to a poison whose top rank has charges it
shows "Charges not tracked" (#152). The values are the Forever text
(`d`), not the Classic text (`cd`).

### Poison procs (A5, issue #105)

`poisonProcs(config.poisons)` in `js/poisons.js` turns the two hand slots into
procs, and `js/rogue.js` adds them after any procs the host passed. A slot
that is `null`, or names a poison with no DPS here (Wound, Crippling,
Mind-numbing), makes none. A slot that names a poison the catalogue does not
know is a `RangeError`. With no poison the proc list is empty and nothing
draws a random number, so the default fight and the four golden fixtures are
byte-identical.

| Poison       | Proc id                 | Chance | Action                                             |
| ------------ | ----------------------- | ------ | -------------------------------------------------- |
| Instant (R6) | `instant-poison.<hand>` | 20%    | `dealDamage` 76 to 100, Nature, with `spellHit`    |
| Deadly (R5)  | `deadly-poison.<hand>`  | 30%    | `applyDot` 23 a tick, every 3 s for 12 s, 5 stacks |

Each proc triggers on a landed hit (`onHit`) of its hand (`scope.hands`). A
main-hand poison rolls on a main-hand white swing and on every landed skill (a
skill counts as a main-hand attack, finishers and extra attacks included); an
off-hand poison rolls on an off-hand white swing. The chance is the export's
top-rank chance, read from the catalogue, and is flat per hit (no weapon
speed). Charges are ignored.

**Which attacks roll a poison (a deliberate reference choice).** This follows
wowsims, whose main-hand mask includes the special attacks: the main-hand poison
rolls on every landed main-hand melee attack, white or special, so Eviscerate
and the other damaging finishers roll it as Sinister Strike does. A cast that
is not a direct attack (Rupture, which only applies a DoT, Slice and Dice,
Adrenaline Rush, Blade Flurry, Premeditation, Cold Blood) and a DoT tick land no
hit, so they roll nothing and draw nothing. This is not
verified against real Classic or WoW Forever, where a finisher might not roll a
poison; if it is measured to differ, narrow the proc's `scope` (a tag the
ability data would carry) and nothing else changes. `test/poison-procs.test.js`
pins the current rule, Eviscerate included.

**Spell hit.** The proc draws the 17% `k("spell.missTarget")` once. On a
resist nothing is dealt or applied, and the resist shows in the breakdown and
the log under the poison's name. A hit on the weapon table does not change it.

**Instant Poison** is a direct hit under the id `instant-poison`, display name
"Instant Poison": the damage is rolled between 76 and 100 (one draw), skips
armor (Nature, `k("nature.spells")`), and can crit (the `canCrit` flag on its
`dealDamage` action).

**Instant Poison crit (issue #105, an assumption).** A landed
Instant Poison hit rolls one crit at the rogue's melee crit chance
(`getCritChance`, with the crit modifiers for the `poison` tag) and a crit
deals `k("poison.instantCrit")` = 1.5x, the bonus part scaled by the
`critDamage` modifiers. The 1.5x is wowsims' spell crit multiplier for
`rogue/poisons.go` (`OutcomeMagicHitAndCrit`); the chance is the melee crit
chance, not a spell crit chance, because the engine has no spell crit. Issue
#105 gives the 1.5x; the melee chance is the developer's assumption. Both are
tagged `assumption` with the retune flag on. The crit context is the main
hand's for either hand's Instant Poison (the proc has no hand of its own in
`attackContext`), so a dagger main hand gets the +5% dagger/fist crit on
Instant Poison, including an Instant applied by the off hand. That is an
assumption too, not a verified Classic rule. The 4.8% crit suppression applies
(`k("poison.instantCritSuppression")`, true, an assumption, retune on): it is
the same treatment as the swing crit and a DoT tick's
(`k("dot.critSuppression")`), so one rogue has one crit chance whichever hit
rolls it. wowsims uses a different spell crit suppression, which is not
modelled; set the constant to `false` to crit at the full chance. Draw order
for one Instant Poison: the proc chance, the spell hit, the damage, then the
crit, and the crit is drawn only when the proc fired and the spell hit landed,
so a resist, a missed proc roll and a build with no poison draw nothing extra.
Once the hit has landed the crit always draws one roll, even at a crit chance of
0, as a swing and a tick do. A crit shows as "Crit" in the log and counts as a
crit in the breakdown.

**Deadly Poison** is the `applyDot` action (`resolveProcDot` in
`js/simulation.js`). A landed application adds a stack of the `deadly-poison`
target aura (up to 5, refreshing it to 12 s) and sets the DoT
`activeDots["deadly-poison"]`:

- tick damage is one stack's tick (92 / 4 = 23, as the export's 92 over 12 s
  and the tick count `k("poison.deadlyTick")` give) times the stacks, with
  damage modifiers resolved at each application (see the known difference
  below);
- a refresh sets the duration back to 12 s and keeps the running tick clock,
  as the wowsims DoT does (`ApplyOrRefresh`); resetting it would starve ticks
  at about 0.6 applications a second;
- ticks go through the existing DoT loop: every 3 s, Nature so they skip
  armor, a tick can crit (`k("dot.canCrit")`) for 2x at the melee crit chance
  with the crit suppression, and each tick shows as a tick in the breakdown
  and log under "Deadly Poison";
- the application itself deals no damage and does not crit.

`poisonProcs` throws a `RangeError` if the tick count and interval do not
fill the export's duration, so a retuned tick cannot silently change the
total. The interval and count (3 s, 4 ticks) are Classic values, verified
against wowsims `rogue/poisons.go`, and carry the retune flag.

**Known difference from wowsims: stack modifier snapshot.** This sim resolves
the `damage` modifiers at each application of Deadly Poison, for every stack,
so each application re-prices the stacks already on the target (the DoT's tick
damage is stacks x one stack's tick, all resolved at the latest application).
wowsims snapshots the modifiers on the first stack and keeps them for the DoT's
life. With no modifier that changes during a fight (the default, and any
static talent) the two agree; they differ only when a damage modifier changes
between a DoT's first and later stacks (a timed buff or a debuff). Kept as it
is, by ruling on PR #133; recorded here so a comparison with wowsims is
read with it in mind.

**Not in A5.** Vile Poisons, Improved Poisons and Venom (no entry in the
talent data yet; Malice has one and reaches poison crit, see
[Applying a talent build](#applying-a-talent-build-d7-issue-106)); a `procChance` modifier kind; poison charges. No
poison counter is in the `runFight` result.

## Simulation clock

The engine has no clock of its own. Fight time moves only when a caller hands
it seconds: `Simulation.run(duration)` for a headless fight, or a core run
(`runOnCore`, `openCore` in `js/core/fight.js`) that a host such as `SimRunner`
feeds in pieces. No file under `js/` except `js/main.js` reads `performance`,
`Date`, or any other wall clock, and lint rejects `performance` and `Date`
there (and `Math.random`, see Random numbers). A duration that is negative,
`NaN`, or infinite throws a `RangeError`. Two simulations with the same seed
that are given the same time end in the same state, however that time is
split.

The engine is the event core (Phase 3.5, see Event-queue engine): every swing,
tick, expiry and decision is an event at its own exact time, and the fight
moves from event to event. It has been the default since #199 and the only
engine since #234, which removed the fixed-step engine (`Simulation.step`, the
`sim.fixedStep` constant and the `engine` option). The last commit with the
fixed-step engine is tagged `legacy-engine-final` (see Parity harness, retired
for the final events-against-legacy numbers).

Elsewhere in this document, "frame" means one animation frame of the live page,
and "step" in a section written before #234 means the removed fixed step.

### How the pieces fit

A fight is a seed plus the time it is given. The same seed and the same total
time end in the same state, whoever drives them and however the time is split.

- `createRng(seed)` (`js/rng.js`) is the one source of randomness. The
  `Simulation` owns it (see Random numbers).
- `Simulation.run(duration)` runs the fight for `duration` seconds on the event
  core and ends it (see Headless runs).
- `createFight(seed)` and `runFight({ seed, duration })` (`js/fight.js`) build
  the `Rogue` and `Simulation` pair. `runFight` runs it with one `run` call and
  returns plain data (see Headless fight). `createFight`'s `options.duration`
  is the fight length the rotation reads as `fightTimeRemaining` (#191); it does
  not end the fight, and `runFight` and `SimRunner` pass the duration they run.
- The live page (`js/main.js`, through `js/live-run.js`) runs the same pair in
  a `SimRunner`, which holds one core run open and gives it each frame's
  seconds from `FrameClock` (see Live page). It is a view of the engine and
  holds no combat rule.
- The golden tests pin the `runFight` result for seven fixed cases, one of
  them a scripted list of casts and three of them the reference talent build
  (one with poisons, one with the combat-swords preset; see Golden-seed tests).
  They fail when anything on this path changes a number.
- `npm run bench` times a seeded 5-minute `runFight` (see Benchmark).

The goldens and the bench are the ongoing guard on the engine: the goldens pin
its numbers exactly, and the bench its cost. There is no second engine to
compare with since #234.

What a reader should not assume is under Known limits of Phase 1 (written at the
end of Phase 1) and Known limits at the end of Phase 2.

### Headless runs

`Simulation.run(duration)` runs the core for `duration` seconds and then ends
the fight (`Simulation.end`). The fight ends exactly `duration` seconds after it
started: the core runs every event at or before that time and leaves the
fight's fields reading it there. `0` runs nothing. The `run` call does no
timing and draws no randomness of its own; the seed and the time decide the
fight.

The results do not depend on how the time is cut. Events are at their own
times, not on step boundaries, so a fight run in one call and the same fight
cut into any number of `runOnCore` calls (on an event's time or between two)
are the same fight, field for field (#198, from #197 QA M1). Each call keeps
the fight's clock and goes on from the exact state the last one left
(`sim.coreCarry`). Under the fixed step, the step size and where the steps
fell changed the seeded fights (at 300 s, 142 of seeds 1 to 200 differed at a
0.01 s step); that table went with the fixed step in #234.

### Live page

`js/main.js` is a view of the same engine `runFight` uses. Since #149 it is a
bootstrap: it puts the fight's config in the page's store (`js/store.js`), and
the views in `js/views/` draw from the store (the visualiser on each frame, the totals
when the results change, the controls when the run state changes). Since #153
the fight runs in a `SimRunner` (see Run controller) held by `js/live-run.js`:
the control bar's buttons call its `run`, `pause`, `resume`, `stop` and
`reset` through `js/run-actions.js`, the runner starts and stops the frame
loop through its driver, and every state change is written to the store's
`run.state` (in live mode `js/live-run.js` is its one writer; the views only
read it). The page starts idle with an empty fight at 0:00; nothing runs
until Run. The fight is the Fight length field long (`k("batch.duration")`,
300 s, by default, the same default as a batch; 1 to 3,600 s, #155); the runner then moves to `finished`, the frame loop stops, the
status reads "Finished" with the fight's DPS, and Run reads "Run again".
Stop discards the fight (the last picture stays, dimmed) and Run replays the
same seed from 0:00; Reset ends it and empties the picture. Batch mode runs
the Fights field's fights (1 to `k("batch.maxIterations")`, 1,000 by default)
through `BatchClient` and puts the result in the store's `batch` slice for the
results panel (#154); a batch cannot pause, and Stop keeps the fights done so
far as a partial result. A Fights error left from batch mode does not block a live Run (its field is
hidden there). Below 520 px only one compact row stays sticky (Run or Pause,
Stop, Reset, and a one-line summary such as "Batch · 1,000 × 300 s · seed
1234" with the status under it, 62 px tall with 44 px buttons); the mode and
the three fields sit in a "Run settings" section under it, closed by default
and not sticky, and an error in a closed field shows "Fix 1 setting" in the
row, which opens the section at the field. Wider screens show the full bar as
before. The live feed reads the fight through `SimRunner.fight`.
Since #150 no view reads the engine: the live feed
(`js/live-feed.js`) fills the visualiser's slices each frame, the combat log
and combo points from the event stream and the energy, GCD, aura and cooldown
timers read at the frame. Phase 3 of #150 draws more from the same events
(no schema change): a duration bar per aura (its length at the last apply,
refresh or stack, amber with a decimal under `k("ui.auraLowSeconds")`), a
stacks badge, "AT CAP" on full energy, the spent combo points outlined for
`k("ui.spendFlashSeconds")` of fight time with the finisher's name, proc
chips with counts, and "↳" on a log row a proc made. Paused, Left and Right
step through the log; an opt-in role=status region announces a buff coming up
or going and the pause, at most one message per
`k("ui.announceIntervalSeconds")`. These are display rules only. The runner builds the fight
with `createFight(seed, config)` from `js/fight.js`; the page shows the seed in
the control bar's Seed field (editable, 0 to 4,294,967,295; empty draws a new
one at Run; the same seed can be replayed in `runFight`), and from each
animation frame it gives the runner that frame's seconds through `advance`. It
holds no combat or timing rule. The conversion from a frame timestamp to
seconds of fight time lives in `FrameClock` (`js/frame-clock.js`), which reads
no clock itself:

1. The first frame, and the first frame after a resume, give no time. They
   only record the timestamp.
2. After that, a frame gives
   `(time - previousTime) / k("sim.msPerSecond")` seconds, floored at 0 and
   capped at `k("sim.maxFrameTime")`.

There is no step and no carry (#234): the core takes any length of time, so
nothing is left over between frames. `k("sim.msPerSecond")` and
`k("sim.maxFrameTime")` are `engineering` and retune is off, and
`js/frame-clock.js` is their only reader. A backgrounded tab, a stalled main
thread, or a long pause never turns into one huge frame or a burst of
catch-up, and the excess time is dropped. It is not a game rule: a 60 or 144
fps display never reaches it, and a page that runs below the reciprocal of
`k("sim.maxFrameTime")` frames per second (4 at the values in
`data/constants.js`) runs slower than real time. Pausing cancels the animation
frame, and resume restarts the frame clock, so the paused gap is not
simulated.

`SimRunner` adds the frames' seconds up with a compensated (Neumaier) sum, so
600 frames of 1/60 s reach exactly 10 s, and the fight's events are at their
own times whatever the frames are. A seed therefore gives the same fight live
and headless, however uneven the frames (`test/live-view.test.js`,
`test/sim-runner.test.js`).

The DPS readout is high for the first moments. The page's first animation frame
gives no time. The opening casts are at fight time 0, inside the first frame
that gives time, and the readout is `damageDone / currentTime`, so an opening
hit that lands is divided by that one short frame while the clock still reads
00:00. It can show thousands of DPS, and falls as fight time accumulates. This
is display only. Damage, casts, and the headless result's `dps` (total damage
over the whole duration) are not affected.

### Other time inputs

`k("latency")` is an assumption on the retune list. Its note says the engine
does not delay casts. `k("batch.duration")` (300 s) is an assumption on the
retune list: the default fight length of `SimRunner`, the batch runner and the
live page, which ends its fight there and shows it as finished (#153). A
headless caller passes the duration to `run`, or to `runFight` (see Headless
fight).

### Tolerance and the order at one time

`k("sim.tickEpsilon")` (`engineering`, retune off) is the tolerance the core's
timers read: an aura, cooldown, GCD or points timer is running while more than
it is left and ready from then on, and a keep-clock DoT ticks up to it past its
end (see Event-queue engine). `Ability.cast` treats the GCD as ready when the
remainder is at or below it. See Global cooldown.

Events due at the same time run in a fixed order of classes: energy changes,
then expiries, then DoT ticks, then swings, then the decision, last, so the
rotation sees everything due at that instant (see Event-queue engine, "Order
at one timestamp"). Anything applied at a decision keeps the duration it was
given until time moves on.

The combat log keeps the newest `k("log.maxEvents")` rows (`engineering`,
retune off). That cap is display, not a game rule.

It is a ring buffer fed by the fight's `hit` events. The events, with their
fields and the rules for handlers, are in [Events](events.md).

## Event-queue engine (Phase 3.5)

**The engine since #199, and the only one since #234.** This records the
decisions the Phase 3.5 rewrite built on (#192; the proposal is
[docs/phase-3.5-engine-rewrite.md](phase-3.5-engine-rewrite.md)). It was
written while the fixed-step engine ("legacy") was still the default, so it
compares with it throughout; #234 removed that engine, and those comparisons
are the record of what the core kept and what it changed. The last commit
with the fixed-step engine is the tag `legacy-engine-final` (see Parity
harness).

**Time.** Times stay plain doubles in seconds, as `currentTime` is now. An
event's time is computed from its anchor and never by adding a delta to the
previous event, so floating-point error does not build up over a fight:

- a DoT's n-th tick is at `applied_at + n * interval`;
- an expiry (an aura, a cooldown, the GCD, Premeditation's points) is at
  `start + duration`.

Swings keep the legacy haste rule (a swing in progress keeps its remaining
time) and are anchored at the swing where the interval last changed: the n-th
swing after it is at `anchor + n * interval` (#195, below).

Times that should coincide must compare equal; where the legacy engine compares
with `k("sim.tickEpsilon")`, the new one does too. Integer ticks of a fine unit
were the alternative the proposal named. #192 chose doubles with anchored
times.

**Order at one timestamp.** Events due at the same time run in a fixed order:
by `time`, then by an order class, then by `seq`, the order they were scheduled
in. The classes followed the order of a fixed step (the old "Tolerance and the
order inside a step"; now Tolerance and the order at one time), so the rotation sees the state after everything due at that
instant:

1. energy and regeneration changes;
2. expiries: auras (buffs and debuffs), cooldowns, the GCD, and
   Premeditation's points;
3. DoT ticks (and a DoT's expiry after its last tick);
4. swings;
5. decision points, last: the rotation runs once per timestamp.

The fixed step cast before it swung (step 6, `Rogue.rotation`), while the
classes above put a swing before a decision at the same time. The new core
keeps the classes: decisions last, after swings (#193), so the rotation sees
every change due at that instant. Parity is measured over many seeds, so the
difference from the fixed step is allowed.

**Scheduler (#193).** `js/core/scheduler.js` holds the queue; the event core
(#197) runs on it, and is the default engine since #199. `new Scheduler({ endTime, handle })`
takes the fight's end time and one `handle(event, scheduler)` function that is
called for each event in order. `schedule({ time, order, kind, payload })`
adds an event at an absolute time, with `order` one of `ORDER` (`ORDER.energy`
to `ORDER.decision`, the five classes above), and returns it. The event is
its own token: `event.cancel()` drops it (cancelling twice, or after it ran,
does nothing), and `scheduler.reschedule(event, time)` cancels it and schedules
the same kind, order and payload at the new time, with a new `seq`.
Rescheduling an event that has already run schedules a fresh one the same way;
the old event stays "ran". There is one handle function for every class and
kind, with no per-kind handlers: it gets the event and the scheduler.
`runUntil(t)` runs every event due at or before t, including ones its handlers
schedule at or before t, and leaves `now` at t; `runToEnd()` is
`runUntil(endTime)`. Split calls give the same order as one call. A bad
argument is a `RangeError` or `TypeError`: an event before `now`, or with a
time that is not finite, an order that is not one of `ORDER`, or an empty
kind; `runUntil` before `now`, past the end time or at a time that is not
finite; an end time that is negative or not finite; and a missing handle
function. The text quotes a string, so a time of `"4"` reads `Got "4".`. A
call in the wrong state is a plain `Error`: `runUntil` from inside a handler,
and any call after a hard stop (below). A handler's error goes through with
`now` at that event's time. An event is frozen, so not even
`Object.defineProperty` can move one that is already in the queue.
Cancelling is lazy: a cancelled event keeps its heap slot until it reaches
the top, where `nextTime` and `runUntil` drop it, so a host that cancels and
reschedules often (a refresh every few seconds) holds one dead slot per
refresh until its time passes. `pendingCount` counts live events only, and
the hard stops count events that ran, not slots (#223).

**Hard stop (#193).** A run throws `SchedulerHardStopError`, naming the event
(its kind, time, class and `seq`), when more than
`k("sim.maxEventsPerTimestamp")` events run at one exact time (a handler that
keeps scheduling at `now`), or more than `k("sim.maxEventsPerSecond")` per
second of the end time run in all (a loop that creeps forward without reaching
the end; a fight under 1 s counts as 1 s). Both count over the scheduler's
whole life, so split calls stop at the same event as one call. The error also
carries the event's `order` and the scheduler's `endTime` as fields. The event
that trips the stop does not run: it stays "pending" and in `pendingCount`.
After a hard stop the scheduler will not run again, and `runUntil`,
`schedule` and `reschedule` throw a plain `Error` that names the stop, before
any check of their arguments; `cancel` still works. `runUntil` from inside
a handler is refused as such before its time is checked. `stoppedBy` is the
error that stopped the scheduler, or `null`. Both limits are 10,000 and are
`engineering` rows (the dev's numbers, not decisions by James, not on the
retune list), far above a real fight.

**Continuous energy (#194).** `js/core/energy.js` holds the new core's energy
pool; the event core (#197) puts it in place of the `Resource` pool
(`js/resource.js`) for a run. (The `Resource` pool's per-step regeneration,
`Simulation.regenerateResource`, went with the legacy engine in #234.)
`new EnergyPool({ definition, modifiers, scheduler })` takes a resource
definition with a regen rule (energy; one without, such as combo points, is a
`RangeError`), the rogue's `ModifierPipeline`, and the scheduler, whose `now`
is the pool's clock. The pool stores `(value0, t0, rate, cap)` and reads as
`min(cap, value0 + rate * (now - t0))`. The rate is
`k("energy.regenPerSecond")` through the `energyRegen` modifiers and the cap is
`k("energy.max")` through the `resourceMax` modifiers for energy, read from the
same pipeline and combined the same way as in legacy. A rate that is negative
or not finite is a `RangeError`. A gain (up to the cap; it returns what was
added), a spend or `spendAll` first re-bases: `value0` becomes the value now
and `t0` becomes now. Rate and cap change only at events: the host calls
`modifiersChanged()` from the event where such a modifier applies or runs out
(an Adrenaline Rush apply or expiry). The pool re-reads both and re-bases
there only if one of them moved, bringing a value above a cap that fell down
to it. A read never re-bases, so with no modifier the value is exactly
`min(cap, e0 + rate * t)`. As on the legacy pool, `onChange(change, before,
source)` hears a gain or a spend that moved the value; regeneration is not
reported, and the start value is the definition's. A gain or a spend of 0
changes nothing and does not re-base. After the scheduler's hard stop, a
gain, a spend, `spendAll`, `wakeAt`, `resumeWake` and `modifiersChanged`
throw a plain `Error` naming the stop before they change anything (#225).

**Threshold wake-up (#194).** `pool.wakeAt(amount)` schedules one event of
kind `"resource-threshold"` (`WAKE_KIND`), in the energy class, with the
payload `{ resource, amount }`. It fires at the first time the value reaches
the amount, or at now if it already has. The division
`t0 + (amount - value0) / rate` can round a hair early, so the time is nudged
up (by about one unit in the last place at a time) until the value there is
at least the amount. The handler always finds the energy, and the time is
within a few units in the last place of the exact one. Every re-base (a gain,
a spend, a rate or cap change) cancels the event and schedules it again from
the new line. While the amount cannot be reached (a rate of 0, or an amount
above the cap, or a rate so small that the time overflows to `Infinity`), no
event is scheduled until a re-base makes it reachable. The
pool keeps one threshold: a second `wakeAt` replaces the first,
`cancelWake()` drops it, and the event is one-shot. The rotation chooses the
amount (decision points, #197). The pool counts what it loses to the cap as
the legacy `Resource` does: `waste()` gives `{ cappedTime, overflow }`, the
seconds at the cap and the energy those seconds and any gain past the cap
would have added. The end-event contract arrives with the runner re-point
(#198).

Re-arming: once the wake has run, `wakeAt` sets a new threshold straight
away, from the wake's own handler or from outside, with nothing read in
between (#225). A `wakeAt` whose amount the pool already holds fires at now.
Called from a decision handler, that wake runs after the decision, as the
next event at that time (the energy class runs before a decision scheduled
at the same time after it). So a decision that asks again for energy it
already holds, and does nothing else, wakes itself at the same time without
end; the scheduler's hard stop (`k("sim.maxEventsPerTimestamp")` events at
one time) ends it with a `SchedulerHardStopError`. The rotation (#197) must
act on energy it holds rather than wait for it.

**DoT ticks (#196).** `js/core/dots.js` holds the new core's DoT clocks; the
event core (`js/core/fight.js`, #197) runs them on the `"events"` engine, and
the legacy `step()` loop ticked DoTs itself until #234. `new DotTicks({ scheduler })` keeps one pending event per DoT, of kind
`"dot-tick"` (`DOT_TICK_KIND`) in the DoT class, with the payload `{ id }`.
`apply(id, { interval, duration, refresh })` starts or refreshes a DoT at the
scheduler's `now`, and its n-th tick is at `anchor + n * interval`, never a sum
of deltas. There are two refresh rules (`DOT_REFRESH`):

- `"restart"` (Rupture, or any DoT a skill applies): the clock restarts at
  now, the pending tick is cancelled (no stale tick is left), and the DoT ticks
  `floor(duration / interval)` times, as legacy counts them;
- `"keep-clock"` (a poison or a proc's DoT, refreshed by a stack): the pending
  tick keeps its time and only the end moves to `now + duration`; ticks run
  while they fall at or before the end, within `k("sim.tickEpsilon")`. A
  refresh that changes the interval re-anchors at the pending tick, and a
  refresh to an earlier end drops a pending tick that no longer fits. A
  keep-clock DoT that has run out starts a fresh clock.

The host's handler calls `ticked(event)` for the DoT's own pending event (any
other event is an `Error`). It counts the tick, schedules the next one if it
fits, and returns `{ id, tick, last }`. The tick's damage is
`Simulation.resolveDotTick`, the body the legacy loop runs, so a tick's roll,
its Hemorrhage bonus and the procs it fires (`procs.onDotTick`) are the same
code on both engines. An aura that runs out at a tick's time expires first
(the expiry class runs before the DoT class), so a tick at the end of a
Hemorrhage window is not boosted. A bad interval is a `RangeError` with the
legacy text (#193); a bad duration, refresh rule or id is a `RangeError` or
`TypeError`.

Procs and poisons keep their rules on events: an internal cooldown is
measured from `currentTime`, which the host sets to each event's time, with
the same `k("sim.tickEpsilon")` tolerance; an extra attack is resolved inline
from the swing that procced it, at the same time, and does not move the
hand's next swing; a chain of extra attacks stops at `k("proc.maxChainDepth")`
with the same `RangeError`; a poison never uses up a charge
(`k("poison.charges")`). A test host (`test/core-host.js`) runs the same seeded
fight with swings, DoT ticks, aura expiries and scripted casts on the
scheduler, and over 200 seeds every hit, the damage and the ability
breakdown equal the legacy loop's. Those seeds script their casts at
.125 s offsets, which never tie with a swing or a tick; "hit for hit" holds
for those, not for every fight. Three edges differ from legacy, and the
first is in every fight once the core ships (#197, #198):

- (a) The first main-hand swing is at 0, not after the first 1/64 s step,
  and every later swing keeps that clock: default 2.6 s swings land at 2.6,
  5.2, ... on the core and at 2.609375, ... on legacy, so whatever is anchored
  on main-hand hits (the Deadly Poison clock, a swing proc) moves with them.
- (b) A refresh from a DoT's own last tick keeps the DoT. Legacy deletes the
  entry at the end of that step whether the refresh restarts it (a cast DoT)
  or keeps its clock (a proc's DoT or a poison), so on legacy the refresh is
  lost.
- (c) Ticks of two different DoTs at the same time run in the order they
  were scheduled (the scheduler's seq) on the core, and in the order the DoTs
  were first put in `activeDots` on legacy. Each tick's damage is the same;
  only which one draws its rolls first changes, so the mean is not moved, but
  a single seed can be.

(A keep-clock refresh that changes the interval keeps the pending tick's time
on both engines, so it is not a difference.)

**Swings (#195).** `js/core/swing.js` holds the new core's swing timer;
the event core (#197) runs it. (The legacy `Weapon.tick` went with the
fixed-step engine in #234.)
`new SwingTimer({ weapon, modifiers, scheduler })` takes a weapon (its speed
and hand), the rogue's `ModifierPipeline` and the scheduler. It keeps one
pending event of kind `"swing"` (`SWING_KIND`), in the swing class, with the
payload `{ hand }`. `start(at)` schedules the first swing at an absolute time:
the host starts the main hand at 0 and the off hand at
`k("weapon.offHand").initialSwing`, as legacy does. The host's handler resolves
the swing and then calls `swung()`, which reads the interval, the weapon speed
divided by `modifiers.resolve("haste", 1)` as legacy's `Rogue.rotation` read it, and
schedules the next swing. That is the legacy haste rule: haste is read when a
swing happens, and a change between two swings does not move the swing
already counting down. While the interval stays the same, the next swing is at
`anchor + n * interval`, so with constant haste the n-th swing is at exactly
`start + n * speed`. When the interval read at a swing differs from the last
one, that swing is the new anchor. An interval that is not a finite number
above 0 (haste of 0 or less) is a `RangeError`; the removed
fixed-step engine stopped swinging silently. `swung()` outside that hand's own swing event, just run, is a plain
`Error`, as is `start` while a swing is pending; `stop()` cancels it.
`nextSwingTime` and `swingTimer` (seconds to it, the legacy field) read it.
Over 60 s the swing count is the same at any `runUntil` granularity. Until
#234 a test drove the legacy `Weapon.tick` at the fixed step beside it with
random haste changes and found the same swings, each legacy one in the step
that held the core's. At one timestamp, decisions run after swings (#193), so haste from a
cast at t reaches the swing after the one at t, where the fixed step casts
first; parity (#199) covers that.

**Expiry timers (#195).** `js/core/timers.js` holds the GCD, cooldowns, aura
expiries and Premeditation's point expiry for the new core; the event core
(#197) runs them. A `Timer` (one end) or `TimerSet` (ends by id, payload `{ id }`) stores
the absolute end, `start + duration`, and keeps one event there, in the
expiry class. `start(duration)` sets it from now and `setEndsAt(time)` sets an
absolute end (a refresh); either replaces an end already set, so one event at
most is pending per timer. `clear()` drops it with no event (charges used up,
Premeditation's points kept by a later gain or spend). The event is at the
exact time: a 1 s GCD started at t ends at t + 1 and a 20 s cooldown at
t + 20, compared with `===`. Reads compare with `k("sim.tickEpsilon")` as
legacy does: `running` while more than that is left, `ready` from then on, and
`remaining` 0 once ready. `refreshedEnd(rule, { endsAt, now, duration })`
gives a re-applied aura's end for the rules of `REFRESH_RULES` in
`js/auras.js`: `refresh` is now plus the duration, `extend` the old end plus
the duration, and `replace-if-longer` the later of the old end and now plus
the duration. Stacks, charges and the `onApply` and `onExpire` hooks stay with
the host. `createTimers(scheduler)` builds the four: `gcd` (`"gcd-end"`),
`cooldowns` (`"cooldown-ready"`), `auras` (`"aura-expire"`) and
`premeditation` (`"points-expire"`, payload `{ resource: "comboPoints",
amount: k("premeditation.cpRemovedOnExpiry") }`, started for
`k("premeditation.cpExpiry")`); `TIMER_KINDS` names the kinds. A duration
that is not a finite number above 0 is a `RangeError`, an id that is not a
non-empty string a `TypeError`. A proc's internal cooldown keeps its absolute
`readyAt` and needs no event.

**Decision points and the rotation (E6, #197).** `js/core/fight.js` runs a
whole fight on the scheduler, and `Simulation.run` always goes there. It was
the `"events"` engine, the default since #199; #234 removed the `engine`
option, `Simulation.useEngine`, the fixed-step `"legacy"` engine and
`Simulation.step`. The Simulation stays the store of the fight's state and
does every hit, tick and proc as it did on legacy; the core only says when. For the run it puts an `EnergyPool` in place of the legacy
energy pool (taking over its value and cap, and giving the value and the
waste back at the end), starts a `SwingTimer` per hand from each weapon's
`swingTimer`, a `DotTicks` entry for each DoT already up (from its
`timeUntilNextTick`), and timers for the GCD, the cooldowns, the auras and
Premeditation's points. `Simulation.resolveDotAttack` and `resolveProcDot`
tell it where a DoT starts or is refreshed. Before each event every timer
writes its time left back to the legacy fields; after it, a field the event
changed moves its timer, the energy pool is told a modifier may have changed
(the #194 host contract), and the non-energy pools are clamped to their caps.
So a second `run` carries on from where the core left the fight.

A second `run` on the core is the same fight as one longer run, wherever the
split falls, on an event's time or between two (#198, from #197 QA M1). The
fields hold time left, which is the end minus now, rounded; a run that
re-based every timer from them would move later events by an ulp or so, and
an energy wake or a swing could then change places with a DoT tick at the
same time. So the core keeps the fight's own clock (its scheduler starts at
`sim.currentTime`, not 0), and on closing it leaves `sim.coreCarry`: the
exact end of each GCD, cooldown, aura and points timer, each DoT's tick clock
(also one whose last tick has run while it has time left, which a proc can
refresh on its clock), each swing's grid (its anchor, interval and count),
the check poll's next time and the energy pool's line. The next run takes each one while its field still
holds what was written; a field changed between the runs, or a run that does
not start where the last one closed, starts from the field as before. Only `sim.coreStats` can see the split. When nothing a
decision reads was changed between the runs, the next run does not ask the rotation at its start, since one run
would not ask at that time: it keeps the last decision's wakes, the energy
threshold at the very time it had and the condition crossing even when it lay
past the last run's end. A decision there would see a GCD or cooldown that
ends within `k("sim.tickEpsilon")` as ready and cast up to that much early
(#231 QA B1). A run that starts on a changed fight asks the rotation once at
its start. What counts as changed (`decisionMarks` in js/core/fight.js):
`sim.gcd` and `sim.fightLength`; the rotation program, config, build, the
granted set and the modifier pipeline, each replaced, and the build's `selected`
flag and the granted set's size (a pipeline's static modifiers are frozen and
indexed when it is made; its timed ones come from the auras); a weapon replaced
or its `swingTimer`; a cooldown, aura or DoT entry added, removed or replaced,
or one of its own fields; a pool replaced or its value, `baseMax` or
`expiryRemaining`; the abilities map replaced, an ability added, removed or
replaced, or one of its own fields such as `cost`, `triggersGcd` or `cooldown`
(#231 QA X1); and the energy pool's rate or cap. Objects inside those (an aura's
modifier spec, an ability's `definition`) are compared by identity only, so a
field changed inside one is not seen: replace the object, or clear
`sim.coreCarry`, to have the rotation asked. A DoT's tick clock is taken only
while its entry's `timeUntilNextTick`, `tickInterval` and `duration` are as
written. While a core run is open (`openCore`, as SimRunner holds one) the fight
is the core's, and a second core run on it throws until it is closed.

The rotation (`Rogue.castRotation`) runs at decision
points only, in the decision class after the other events at a time: once at
the time of any other event (a cast, a swing, a tick, a proc, an aura or
cooldown running out, the GCD ending), when energy reaches the cheapest cost
the rotation lacked (`EnergyPool.wakeAt`), and where a condition that moves
with time would cross its value with no event in between. A cast asks again at
the same time, so an off-GCD rule (Cold Blood) follows the cast that enabled
it; the re-asks stop when a decision casts nothing, or after as many
re-asks at one time as the rotation has rules: a rotation that casts at
every ask is asked the rule count plus one times at that time.
Each condition type in `js/rotation-conditions.js` declares its drift:
`AT_EVENTS` (its answer changes only at an event) or a rate per second of
fight time (energy and other pools below their cap, `auraRemaining`,
`debuffRemaining`, `fightTime`, `fightTimeRemaining`, `energyToCap`).
`conditionWakeAt(condition, state)` follows the number on that line and gives
the first time it meets the value, or null. A number at its value now wakes
just after now, the next double up; at t = 0 that is the smallest double,
which moves no number, so there the wake is when the number has moved by an
ulp of itself (#234). A type without a drift is a
`TypeError` when the module loads. There is no fixed polling. `runOnCore`
keeps counts on `sim.coreStats` (`events`, `decisions`, `conditionWakes`,
`energyWakes`, `casts`); two test-only options, `pollEvery` and
`afterEvent`, add a look at the rotation every so many seconds and a hook
after each event.

Tests: `test/core-fight.test.js` runs the default, the combat-swords preset,
the reference build with and without poisons and an imported rotation, and
checks the same fights with a 1/64 s poll on top cast the same abilities at
the same times (the poll never finds a cast); that the decisions are at most
the events and a small share of 1/64 s steps; Cold Blood with and without the
talent; the pool's rate and cap equal a fresh read after every event through
Adrenaline Rush; the waste given back; a DoT and the swings across split runs;
a condition wake in the second of two runs;
the scripted golden cases on the core (Rupture ticks and a tick crit); and the
#196 edges (a), (d) and same-time main- and off-hand swings.
`test/core-rules.test.js` runs the rules the legacy step-based tests pinned
(poisons on DoT ticks, Deadly Poison's clock, refresh and crits, an `applyDot`
proc, a Rupture tick's snapshot, charges and Expose Armor on ticks, an
`onDotTick` proc and the pool clamp) on the core, with a DoT dropped after
its last tick, an aura's `onExpire` and the GCD length, and
`test/rotation-wakes.test.js` holds every condition type to its drift and its
wake-up times (never at or before now). Timing differs from legacy as the #196
edges say; parity against legacy was #199, and its final numbers are under
Parity harness.

## Headless fight

`runFight({ seed, duration, config })` in `js/fight.js` is the one entry point
for a headless fight. `config` is optional (see SimConfig). It builds a `Rogue`
and a `Simulation` with that seed, makes a
single `Simulation.run(duration)` call on the event core, and returns the result as plain data. The module imports only engine files, so
it loads in Node with no `document`, `window`, `performance`, or other browser
global, and it reads no clock. The same `seed` and `duration` always give a
deep-equal result.

`seed` is required and must be an integer; it wraps to an unsigned 32-bit
value as in Random numbers, and the result reports that wrapped value. A seed
of 2^32 or above wraps and aliases to a small seed (`2 ** 32 + 5` is seed `5`),
so two such seeds can give the same fight.
`duration` is in seconds and follows the rules of `run`: a negative, `NaN`, or
infinite value throws a `RangeError`, and `0` is an empty fight. A missing or
non-integer `seed` also throws a `RangeError` with the one seed text (see
Random numbers), as does an argument that is
not an object (`runFight()` and `runFight(null)`). An option other than `seed`,
`duration` and `config` is a `RangeError` that names it, so a misspelt `confg`
cannot quietly run the default fight.

The result has these fields:

- `seed` — the seed used.
- `duration` — the simulated seconds, `Simulation.currentTime` after the run.
- `totalDamage` — `Simulation.damageDone`, after armor.
- `dps` — `totalDamage / duration`, or `0` for an empty fight.
- `abilities` — an object keyed by ability **display name**, in the order each
  first acted. White swings are `Main-hand` and `Off-hand`. Each value has the
  fields below. The engine keys its own maps by id (see Aura model and ids);
  `Simulation.abilityBreakdown()` turns them into this name-keyed shape, so the
  result's shape and every golden fixture are unchanged. It throws if two ids
  share a name.
- `log` — the combat log, newest first, holding at most `k("log.maxEvents")`
  events. Each event is a copy of the engine's row: `id`, `time`, `name`,
  `type`, `damage`, `status`, `outcome`, `icon`.
- `dataVersion` — which data produced the result (see Data version). It is a
  string. It does not change any number in the result.
- `config` — the SimConfig the fight ran with, in full form (see SimConfig),
  and the last field. It is a copy, so changing it changes nothing in another
  run. Passing it back as `config` repeats the fight exactly.

The result is numbers, strings, plain objects and arrays. It holds no
reference to the `Rogue` or the `Simulation`, so `structuredClone`, JSON, and
`postMessage` carry it, and changing it changes nothing in another run.

### Per-ability record

`Simulation.abilityStats` keeps one record per ability id (`sinister-strike`,
`main-hand`) for the whole fight, with the display name in
`Simulation.abilityNames`. It
is not capped, unlike the log, so a long fight still has full totals.
`Simulation.recordAbility` adds to it from the places that already resolve an
attack: `resolveAttack`, `resolveDotAttack`, the DoT tick loop, and the cast
of a skill that is not an attack. It records and changes no combat rule.

- `damage` — damage dealt, after armor. A miss, dodge, or parry deals none. A
  DoT application deals none; its ticks do. The abilities' damage adds up to
  `totalDamage`.
- `casts` — attempts: one per swing, one per skill cast (a miss counts), and one
  per DoT application. A DoT tick is not a cast.
- `hits`, `crits`, `glances`, `misses`, `dodges`, `parries`, `blocks` — the outcome of each
  attempt, from the attack table. For an attack they add up to `casts`. A cast
  that is not an attack (Adrenaline Rush, Slice and Dice, Blade Flurry,
  Premeditation) has an outcome of none, so it only adds to `casts`. `hits` is
  a plain hit; a crit or a glance is counted under its own field. A DoT
  application cannot crit.
- `ticks`, `tickCrits` — DoT ticks, and the ticks that crit (see Bleeds and
  damage over time).

The default fight is behind the target (`config.target.behind`), so `parries`
and `blocks` stay `0` there; from the front they count.

## SimConfig

A SimConfig is the input of one fight: the character's stats, the two weapons,
the talent ranks and the poison on each hand (roadmap E2-lite, issue #92).
`createFight(seed, config)` and `runFight({ seed, duration, config })` take it.
It is optional, and with none the fight is the one the engine ran before there
was a config: the defaults are the default character and weapons in `data/constants.js`
(`character.*` and `weapon.*`). The default is the level 60 Tier 1 rogue below
(issue #127), which moved the golden fixtures once, on purpose.
`js/sim-config.js` has `defaultConfig()` and `normalizeConfig(config)`.

```js
{
  character: { attackPower, critChance, bonusHitChance },
  weapons: {
    mainHand: { min, max, speed, type },
    offHand: { min, max, speed, type },
  },
  target: { behind },                        // true (default): no parry, no block
  talents: { "combat.precision": 3 },        // talent id -> rank
  talentLevel: 60,                           // caps the talent points (#190)
  poisons: { mainHand: "instant", offHand: "deadly" },   // a poison id, or null
}
```

Every field is optional, and a missing one (or one set to `undefined`) takes its
default. A section is merged field by field, so `{ character: { attackPower:
900 } }` changes only the attack power. This is what the engine does with it:

- **Character and weapons change the fight.** They go straight into the
  `Rogue`, where the constants used to be read. The dagger weapon percent for
  Ghostly Strike and Hemorrhage still depends on the main-hand `type` being
  `"dagger"`, and the normalised swing speed of the specials is 1.7 for a
  dagger and 2.4 for any other type. The off hand's first-swing delay
  (`weapon.offHand.initialSwing`) and the starting combo points are not part of
  the config.
- **Target position changes the attack table.** `target.behind` (a boolean,
  default `k("target.behind")`, true) is read by every attack and DoT
  application. Behind, the parry and block bands have zero width. From the front
  (`false`) they are 14% and 5% (see Attack table). Nothing keys off a weapon
  type for it; the default is the same for every weapon.
- **Talents are applied once a point is spent; poisons are opt-in.** They are
  validated, normalised and returned in the result. A config with no rank above 0
  has no build: nothing is checked, nothing changes and no random number is drawn.
  A config with any point is a selected build, and it must be a legal build of
  at most 51 points (D7, #106; partial builds since #190, see
  [Applying a talent build](#applying-a-talent-build-d7-issue-106)).
- **The talent level caps the points and nothing else** (#190).
  `config.talentLevel` (default 60) allows `level - 9` points
  (`k("talents.firstPointLevel")`, 10, the Classic rule, tagged `ASSUMPTION`).
  It does not set the character's level, the armor divisor or anything else in
  the fight; a legal build gives the same fight at any talent level that allows
  it.
  A rank of 0, or a talent that is not named, adds nothing. `poisons` is read by
  `js/rogue.js` (A5, #105): `instant` and `deadly` add a proc to that hand,
  and `null`, `wound`, `crippling` and `mind-numbing` add none, so they change
  nothing and draw no random number. The default is `null` for both hands.

`normalizeConfig` validates strictly and throws on the first problem, with a
message that names the field and the value. A value of the wrong type is a
`TypeError`; a value out of range, an unknown field and an unknown talent are a
`RangeError`.

- The config and each section must be a plain object. A key that is not in the
  list above is rejected, at every level, and the message lists the allowed ones.
- `target.behind` is `true` or `false`; anything else is a `TypeError`.
- `attackPower` is a finite number of 0 or more. `critChance` and
  `bonusHitChance` are numbers from 0 to 1.
- A weapon's `min` and `max` are whole numbers of 0 or more with `min` not above
  `max`, and `speed` is a finite number of `config.minWeaponSpeed` (0.1 s) or
  more. The swing loop does one pass per swing, so a speed of 1e-9 s made
  `runFight` run for more than 10 s. 0.1 s is well under
  any real weapon, and a 60 s fight with both hands at it takes about 20 ms. The
  `Weapon` constructor enforces the same bound. `config.minWeaponSpeed` is an
  engineering constant, not game data. `type` is one of
  `k("config.weaponTypes")` or `null`.
- A talent key must be an id in the talent catalogue, and its rank a whole
  number from 0 to that talent's `max`. Each rank is read from the input once. The 51-point cap, the row gating and
  the prerequisites are checked when a build is applied (D7, `validateBuild`).
- `talentLevel` is a whole number from 10 to 60 (`talentLevelRange()`): a
  number out of range is a `RangeError` and anything else a `TypeError`. Below
  60, `normalizeConfig` also throws a `RangeError` when `talents` spends more
  than `talentLevel - 9` points (`config.talents spends 32 talent points, and
config.talentLevel 40 allows at most 31 (level - 9).`). At 60 the 51-point
  cap is left to `validateBuild`, so its message is the one it always was.
- A poison is one of `k("config.poisonIds")` or `null`.

The result is a new plain object that shares nothing with the input. Talents are
listed in catalogue order with the zero ranks left out, so two spellings of one
build give the same config, and `normalizeConfig` of a normalised config is
that config again. The result's `config` therefore reproduces its fight.

The two id lists are engineering constants (`config.weaponTypes`,
`config.poisonIds`), not game data. The poison catalogue (D9, #104) is read
from the snapshot and a test keeps its ids equal to `config.poisonIds`.

### Default character (issue #127)

The default config is a level 60 Classic Human rogue in the wowsims Phase 1
Combat BiS preset (Nightslayer set, two Bloodfang pieces, `combat_sinister_strike_p1_bis`),
with sword/sword, no buffs. The project owner asked for the standard Tier 1 stats and
weapon damage on 2026-10-26 (issue #127, relayed via Scout); the sword/sword pairing is
Scout's recommendation from the research, not the project owner's explicit choice. The character sheet holds only what the talents do not already add,
so nothing is counted twice: Malice (+5% crit) and Precision (up to +3% hit, three
ranks of 1% in the snapshot) are talent modifiers on top of it, and are not in
`character.critChance` or `character.bonusHitChance`.

| Row                        | Default (sword/sword)                                     | Dagger/dagger                                                       | What it is                                                                                                             |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Strength                   | 166                                                       | 157                                                                 | 80 base + 73 gear + 13 enchants (daggers: 64 gear, without Brutality Blade's 9)                                        |
| Agility                    | 419                                                       | 410                                                                 | 130 base + 252 gear + 37 enchants (daggers: 243 gear, without Brutality Blade's 9)                                     |
| Gear attack power          | 82                                                        | 102                                                                 | Cape of the Black Baron 20, Hand of Justice 20, Blackstone Ring 20, Striker's Mark 22; daggers add Core Hound Tooth 20 |
| `character.attackPower`    | 767                                                       | 769                                                                 | 100 (2 x level - 20) + Str + Agi + gear AP                                                                             |
| `character.critChance`     | 0.2245                                                    | 0.2214                                                              | Agi / 29 + 8% gear crit (swords: Brutality Blade 1%; daggers: Core Hound Tooth 1%)                                     |
| `character.bonusHitChance` | 0.07                                                      | 0.07                                                                | 7% gear hit                                                                                                            |
| Weapons                    | Vis'kag 100-187 at 2.6 s, Brutality Blade 90-168 at 2.5 s | Perdition's Blade 73-137 at 1.8 s, Core Hound Tooth 57-107 at 1.6 s | Wowhead Classic item tooltips                                                                                          |

Sources (all `classic-1.12`, reference values on the retune list for the
character rows): base Str 80 and Agi 130, 1 AP per Str and per Agi, 100 base AP,
and crit per Agi (about 1 per 29) are from wowsims `sim/core/base_stats.go`; the
same level 60 Human rogue base is in the docs.rs `wow_world_base` table. Gear is
the wowsims preset, checked against its item database. The enchants are the
preset's: Greater Stats on the chest (+4 to each of the five stats), Superior
Strength on the bracers (+9 Str), Greater Agility on the gloves and boots (+7
Agi each), Lesser Arcanum of Voracity on the head and legs (+8 Agi each) and
Lesser Agility on the cloak (+3 Agi), which makes +13 Str and +37 Agi. The weapon
rows are Wowhead Classic item tooltips. The dagger set is `defaultDaggerConfig()`
in `js/sim-config.js` (the default config with the dagger sheet and dagger weapons).

With the build's talents the sheet reads (reference only): crit 0.2245 + Malice
0.05 = 27.5% and hit 0.07 + Precision 3/3 0.03 = 10%. Raid buffs and consumables
are not applied; they would add roughly 600 AP and 10% crit (Scout's estimate,
unverified) only (the engine has no buff slot for them).

What the default character does not model: the Chance on hit effects of Vis'kag
the Bloodletter (a 240 damage fatal wound) and Perdition's Blade (40 to 56 Fire
damage); the Crusader enchant procs; Hand of Justice's extra attack; the
Nightslayer set bonuses; and weapon skill. A Human gets +5 sword skill, which
would lower the miss and crit suppression a little, and the attack table has no
skill term, so the sheet's hit and crit are the ones it reads.

Hit above the cap: the table takes `bonusHitChance` less 1% (the engine's
suppression term, `miss.yellow` of 8% plus 1% is the 9% cap), so a yellow attack
(Sinister Strike and the other abilities) gains nothing above 9% hit, while a
white swing, which starts from 27% miss (8% plus the 19% dual-wield penalty),
still loses 1% of miss for each 1% of hit up to 27%. The default 7% sheet plus
Precision 3/3 is 10%: yellow is capped at 9% (1% spare), and white misses
27% - 9% = 18%. The engine already did this, so there is no code change for it.

## Data version

Every result says which data it came from. `js/data-version.js` builds
`dataVersion` from `data/talentsforever/manifest.json`, the file
`npm run data:refresh` writes: the snapshot's `generated` date and the client
`build`, joined as `<generated>+<build>`, for example `2026-10-20+1.60.1.70425`.
Neither part may be empty or contain a `+`, and a manifest that fails this stops
the module loading. A refresh changes the version with no code change.

`runFight` returns it as `dataVersion`, just before `config`, and `createFight`
returns it beside `seed`. `js/data-version.js` reads the small manifest only.
(The live page now loads the 170 KB snapshot anyway, because a SimConfig checks
its talent ids against the catalogue.)
`test/data-version.test.js` checks that the manifest agrees with `rogue.json`
(`generated` and `spellbook.build`), and with what `buildManifest` would write
for it.

Adding the field did not change any number. The golden fixtures do not hold it
(see Golden-seed tests), so they stayed byte-identical.

## Golden-seed tests

A7 (#100) changed every fixture on purpose: the attack table moved the white
miss and crit chances, added a crit draw to every yellow hit and a damage draw
to every glance (so the rng stream differs from the first yellow hit on), and
added `blocks` to each ability's record. The fixtures were rewritten in their
own commit, so the diff of the numbers can be read apart from the engine change.

A golden test pins the whole result of a fixed fight, so a change to a rule, a
constant, or the engine shows up in review as a diff of numbers. The cases are
listed in `GOLDEN_CASES` in `scripts/golden-update.mjs`: a short fight (seed 1,
10 s), a 5-minute fight (seed 1, 300 s), another seed (12345, 90 s), a
scripted-cast fight (seed 68, 50 s, described below; #234's in-budget script
in place of #85's), the two config cases
added by #107 (the talented build, the poison fight, described below), and the
combat-swords preset case added by #164 (seed 142, 120 s, described below):
seven in all. Each
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
rotation never calls Rupture, and in these three fights every finisher it
reaches goes to Slice and Dice (none, 12 and 3 casts; see example 1 in
[docs/rotation.md](rotation.md#1-todays-placeholder-combat-rotation)). So they
cannot pin finisher damage, DoT ticks, or tick crits. The scripted case does. Its case in `GOLDEN_CASES` has a
`script`: a list of `Rogue.abilities` names, cast in order, each as soon as the
energy, the GCD, and the cooldown allow. `FINISHER_SCRIPT_IN_BUDGET` is
Sinister Strike six times, Hemorrhage, Rupture, Sinister Strike four times,
then Eviscerate.
Hemorrhage comes just before Rupture, so the fixture has Rupture ticks with
the Hemorrhage bonus and, after the debuff runs out, without it.
`scripts/scripted-fight.mjs` runs it on the real `runFight`: it swaps
`Rogue.prototype.castRotation` (the rotation call both engines make, #197)
for the one call so the script casts first, then the rogue's own rotation runs
with its skill casts switched off, so only the weapon swings and the haste
buffs are left. Nothing under `js/` changes, and a
script that has not finished by the end of the fight throws. Its case,
`scripted-finishers-in-budget-seed-68-50s`, has 8 Rupture ticks (1 of them a
crit), ticks with and without the Hemorrhage bonus, a Sinister Strike miss, and
an Eviscerate that hits without a crit.

**The in-budget scripted case (#234).** It replaces #85's case,
`scripted-finishers-seed-68-50s`, which #234 retired with its fixture by
James's decision. #85's script (Sinister Strike seven times, Hemorrhage,
Rupture, Sinister Strike five times, then Eviscerate) was written for seed 68
and does not finish on 70 of seeds 1 to 200. The cause is energy, not a
stuck cast: it costs 12 × 45 + 35 + 25 + 35 = 635 energy, and from the 100 a
fight starts with at 10 a second (`energy.regenPerSecond`) the Eviscerate's
energy arrives at 53.5 s when every attack lands, after the 50 s fight ends.
A Sinister Strike that misses or is dodged still counts as a cast and refunds
80% of its cost (`skill.missEnergyRefund`), so the script finishes only on a
seed with enough of those; on all 70 that do not, Eviscerate is the one cast
still waiting. `FINISHER_SCRIPT_IN_BUDGET` costs 545 energy, so with every
attack landed its last cast goes out at 44.5 s, and a seed with
misses only finishes sooner (44.5 s is the latest on seeds 1 to 1,000). Six
Sinister Strikes and Hemorrhage are seven builders, so Rupture still goes out at
5 combo points when two of them do not land. Its case runs on the same seed
and length as #85's did. `test/golden.test.js` runs the script on seeds 1 to
200 (about a quarter of a second) and checks that every one finishes, and that
#85's script, kept in the test, still does not, with Eviscerate waiting.

**Config cases (#107).** A case may carry `config`, a partial SimConfig that
`runGoldenCase` passes to `runFight` (or `runScriptedFight`) like any caller's.
The first four cases have none and run the defaults, as before. Both #107 cases
run the reference build (Assassination 18 / Combat 33 / Subtlety 0, the
talentsforever link in `data/reference-build.js`, applied through `applyBuild`)
at seed 107 for 60 s:

- `talented-build-seed-107-60s`: the talents and no poisons. 15,009.86 damage,
  250.16 DPS, 280 random draws, 88 log rows. It casts Blade Flurry, Adrenaline
  Rush, Cold Blood, Slice and Dice twice and two Eviscerates, and Ruthlessness,
  Relentless Strikes and Hack and Slash all fire.
- `poisons-instant-deadly-seed-107-60s`: the same build with Instant Poison on
  the main hand and Deadly Poison on the off hand. 18,972.49 damage, 316.21
  DPS, 396 draws, 100 log rows (the cap). Instant Poison rolls 47 times and
  fires 7; Deadly Poison rolls 23 times and fires 9, with 15 ticks.

The two fights differ by more than the poison damage (2,585 of the 3,963).
That is the rng, not a rule: the poison rolls draw numbers between the swings,
so from the first poison roll the two fights are different draws of the same
seed (before #173 the poison fight dealt less than the talented one, with the
off-hand missing 12 of 32 swings). Do not compare the pair as a poison's
worth. The config is unpinned like `dataVersion`: `test/golden.test.js`
checks that a result's `config` is the default one, or for a config case the
case's talents and poisons laid over the defaults. Both fixtures log CDN icon
URLs (see Icons), so a change to `icons.cdn` rewrites the poison fixture, and
the talented one where a skill row carries a CDN icon (Cold Blood). The reference
build is read from the test helper (`scripts/golden-update.mjs` imports it) so
that the link is in one place.

**Combat-swords preset case (#164).** `combat-swords-preset-seed-142-120s` runs
the reference build with the combat-swords preset rotation
([docs/rotation.md](rotation.md#combat-swords)) at seed 142 for 120 s:
31,185.73 damage, 259.88 DPS. It casts Blade Flurry twice, Adrenaline Rush,
Cold Blood, Slice and Dice four times and Eviscerate three times, so it pins the
preset's Slice and Dice pooling (#122).

**Three fixtures moved on purpose in #173 (issue #155).** The default rotation
took the combat-swords preset's two Slice and Dice rules in place of its single
10 s refresh (example 1 in [docs/rotation.md](rotation.md)). That moved
`other-seed-12345-90s`, `talented-build-seed-107-60s` and
`poisons-instant-deadly-seed-107-60s`, rewritten in that pull request. `short-seed-1-10s`, `five-minute-seed-1-300s`,
`scripted-finishers-seed-68-50s` and `combat-swords-preset-seed-142-120s` did
not move.

**Every fixture moved in #199.** Option D (talent abilities need their talent)
moved the three untalented cases under legacy: `short-seed-1-10s`,
`five-minute-seed-1-300s` and `other-seed-12345-90s` no longer cast Blade
Flurry or Adrenaline Rush. The switch to the event core then moved all seven,
since the core draws the seed's numbers in event order, not step order (see
"Golden fixtures and the rng draw order change" in
[docs/phase-3.5-engine-rewrite.md](phase-3.5-engine-rewrite.md#risks)). One
seed is not a parity check; the mean over seeds was (`npm run parity`, retired in
#234; see Parity harness).

**What `five-minute-seed-1-300s` cannot catch.** With no talents, every finisher
in it is a Slice and Dice cast with at most 5 s left on the buff, under the old
10 s refresh and the new rules alike, so its numbers did not move when the
refresh rules changed. It pins Slice and Dice's effect on the fight, not when
the rotation refreshes it: a shift in Slice and Dice timing shows in
`other-seed-12345-90s`, the two seed-107 cases and the preset case, not here.

No golden case contains a parry or a block. Every case is behind the target
(the default `target.behind`), where both bands have zero width. `parries` and
`blocks` are pinned at 0 in every fixture, and `test/attack-table-engine.test.js`
runs the front position. If a case from the front is wanted, add one.

`npm test` runs `test/golden.test.js`, which runs each case and compares it
with its fixture, field by field and exactly. It only reads the fixtures. When
a case fails, the message lists the fields that changed (for example
`abilities.Sinister Strike.damage: 734.6 -> 801.2`) and says how to regenerate.

When to update them:

- A change meant to move results (a rule fix, a new ability in the rotation, a
  retuned constant, a change to the core's event order): regenerate the fixtures
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
file the check ignores. To change the scripted case, edit
`FINISHER_SCRIPT_IN_BUDGET` or the seed in `scripts/golden-update.mjs`, then
regenerate. Keep a seed that still has tick crits, and an in-budget script that
finishes on seeds 1 to 200: `test/golden.test.js` checks both.
`.prettierignore` lists `test/golden/`, because Prettier would reflow the
one-line rows.

## Icons (D10, issue #107)

Icons are hot-linked from a public image CDN, never vendored. `js/icons.js` turns
an icon name from the snapshot into a URL (constant `icons.cdn`, not Blizzard
hosted), and a missing name, an unchecked name or a failed load shows
`icons.fallback`. Instant and Deadly Poison's proc actions carry their icon, so
their log rows, DoT and debuff have one; `Ability.icon` is the hand-made `img/`
file where there is one and the CDN otherwise. The result shape gains no field,
but an `icon` that was `null` on a poison event is now a URL. `data/icons.json`
records which names `npm run icons:check` found missing (none), and nothing
fetches at test time. See [docs/icons.md](icons.md).

## Parity harness

Retired in #234. `npm run parity` (`scripts/parity.mjs`, #192) was the E11
harness the Phase 3.5 switch-over was gated on (#199): it ran two named
engines over seeds 1 to N on the golden configs and failed when a case's mean
DPS differed by more than a gate. With the fixed-step engine gone there is
nothing left to compare with, so #234 removed the harness, its `npm run
parity` script and its tests (`test/parity.test.js`). The goldens and the
bench are the ongoing guard (see Golden-seed tests and Benchmark).

The last commit with both engines is tagged `legacy-engine-final`. The final
events-against-legacy numbers there (#232) are, on seeds 1 to 200, every case
at 300 s, with a 2% gate on `|mean events - mean legacy| / mean legacy` (the
95% interval is the paired Student t interval as a percentage of the legacy
mean):

| Case                                  | Events − legacy | 95% interval        | Mean DPS, events / legacy |
| ------------------------------------- | --------------- | ------------------- | ------------------------- |
| `five-minute-seed-1-300s`             | −0.0609%        | [−0.4078, +0.2860]% | 139.45 / 139.54           |
| `talented-build-seed-107-60s`         | +0.0329%        | [−0.4771, +0.5429]% | 226.92 / 226.85           |
| `poisons-instant-deadly-seed-107-60s` | +0.4796%        | [−0.2564, +1.2156]% | 258.00 / 256.77           |
| `combat-swords-preset-seed-142-120s`  | −0.2721%        | [−0.7821, +0.2379]% | 226.22 / 226.84           |
| `dot-hemorrhage-rupture-120s`         | +0.0702%        | [−0.4517, +0.5921]% | 199.35 / 199.21           |
| `partial-build-8-points-300s`         | +0.1147%        | [−0.1763, +0.4057]% | 151.14 / 150.97           |

Every case passes the 2% gate. A case's name is its config's; the run puts
every case at 300 s on seeds 1 to 200, whatever the name says. The difference
is paired by seed, so both engines ran the same seeds. To reproduce them:

```sh
git checkout legacy-engine-final
node scripts/parity.mjs --engine events --against legacy --duration 300 --gate 2
```

The scripted finishers case was not under the gate: its script was written for
seed 68 and does not finish on 70 of seeds 1 to 200 on the event core. The
third #234 PR covers it with a script that finishes on seeds 1 to 200 and a
golden of its own (see "The in-budget scripted case" under Golden-seed tests);
there is no parity to rejoin.

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

Re-measured for Phase 3.5 (#192) on `main` at 74f1c57, on our box (8 vCPU
Intel Xeon, Node v24.22.1) while other jobs were running (load average about 5
to 6): over ten `npm run bench` runs, the median warm median was 27.5 ms (25.3
to 42.4 ms) and the median cold run 57.6 ms (54.6 to 78.7 ms). This is the
legacy baseline the new core is compared with at Phase 3.5 issues 6 and 8, on
the same machine and with the same bench. It was not measured on Node 22, the
CI version, which this box does not have.

Re-measured for #234 (the legacy engine removed), on the same box (8 vCPU,
Node v24.22.1, load average about 1.5): 30 `npm run bench` runs of this branch
interleaved with 30 of `main` at e5d6855 (the tag `legacy-engine-final`, the
event core already the default there). The median warm median was 4.6 ms on
both (4.4 to 6.4 ms here, 4.4 to 5.8 ms on `main`), and the median cold run
24.6 ms here against 25.1 ms on `main` (23.5 to 38.0 ms, 23.6 to 49.6 ms). The
removal changes no fight, so the same work is timed and the two match within
noise; both are well under the 50 ms target.

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

What a reader should not assume from the sections above. These were written at
the end of Phase 1; the limits Phase 2 adds or changes are under Known limits
at the end of Phase 2.

- **Step size and splits.** Gone with the fixed step in #234: on the event
  core a `run` split anywhere gives the same fight as one call (see Headless
  runs). Under the fixed step a different step size, or a split inside a
  step, could change a seeded fight (120 to 142 of seeds 1 to 200 at
  5 minutes).
- **First DPS frame.** The live DPS readout reads high at 00:00 (see Live page).
- **Benchmark numbers are local.** The 22 ms warm and 40 ms cold figures are
  from our box (8 vCPU Xeon, Node 20). The GitHub Actions runner measured about
  60 to 65 ms per fight, so the 50 ms target is not a CI guarantee and no test
  asserts it (see Benchmark).
- **Parry and block.** The default fight is behind the target, so `parries` and
  `blocks` are `0` in the default results and no golden fixture has either (see
  Golden-seed tests). `k("block.value")` is 0 for lack of a source, so a block
  does full damage.
- **Live page.** It picks a new random seed on every load; the Seed field
  replays one. It stops at the Fight length (`k("batch.duration")` by
  default, see Other time inputs). A page below the frame rate
  that matches `k("sim.maxFrameTime")` runs slower than real time.
- **Placeholder rotation.** The rotation is the placeholder Combat
  priority. It never calls Rupture, and it only rarely reaches Eviscerate, when
  Slice and Dice has more than `k("rotation.sliceAndDiceRefreshSeconds")` left
  at the finisher combo points. None of 100 seeds (1 to 100) cast it in a 120 s
  run, so the golden tests reach both through a scripted case. A selected talent build is applied (D7), but the page has no way to choose one.

## Known limits at the end of Phase 2

What a reader should not assume from the talent and poison sections. These are
open for James's review, not defects found by a test:

- **Backstab's dagger requirement** is enforced (#142): see "Backstab needs a
  dagger". Ambush's and Mutilate's dagger requirements, and every stealth and
  behind requirement, are parsed and not enforced.
- **Cold Blood** keeps its charge when the attack does not land (a miss, a
  dodge, and in front a parry or block). That is a design choice, not what
  wowsims does and not verified against Classic, and the front-block case is
  tested but out of scope behind-only. The cast-before-Eviscerate rule is the
  Scout's (the Cold Blood rule of `js/rotation-default.js`). See "Assumption: an attack that does not
  land keeps the charge".
- **Instant Poison's crit and suppression** are assumptions: the crit uses the
  rogue's melee crit chance (the engine has no spell crit) at 1.5x, and the
  4.8% crit suppression applies to it. Both are tagged `assumption` with the
  retune flag on (`poison.instantCrit`, `poison.instantCritSuppression`).
- **Poisons roll on finishers** as in wowsims. That is not verified against Classic.
- **Unmapped talents.** Eleven Assassination talents (Improved Gouge, Remorseless
  Attacks, Murder, Improved Expose Armor, Vile Poisons, Improved Poisons, Vigor,
  Mutilate, Improved Kidney Shot, Seal Fate, Venom) and sixteen of the nineteen
  Subtlety talents have no entry. Ghostly Strike, Premeditation and Hemorrhage
  have one since #207: the ability they grant, so a selected build without the
  talent does not cast it (`Rogue.lockedByBuild`). A build that spends points in them is legal and lists them in
  `fight.build.unmapped`. Improved Poisons, Vile Poisons and Venom do nothing, and
  so does Mutilate. D8 is Phase 4.
- **Partial builds are legal** (#190). A selected build spends at most
  `config.talentLevel - 9` points (51 at the default level 60) and must
  satisfy the gating, so a one-point row-1 map runs and a lone row-2 talent is
  a `RangeError`.
- **No talent UI.** Talent icons resolve and are tested but are not drawn.
- **The Rogue's `energy`, `maxEnergy`, `comboPoints` and `maxComboPoints`**
  accessors are still views on `rogue.resources`. Tests use them about 400 times
  in 32 files, so they were left.

## Talent catalogue

`js/talents.js` reads the talent trees from the vendored snapshot,
`data/talentsforever/rogue.json`, into one lookup (roadmap D4). It holds no
talent number of its own. Every field below comes from the snapshot when the
module loads, so `npm run data:refresh` changes the catalogue with no code
change. The engine reads it to check the talent ids and ranks of a
SimConfig (see SimConfig) and to validate a build (`validateBuild`: the
prerequisites and row gating); the effects are in the data of the next section. It is validated when it
loads (see Load-time validation below).

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
- A tree or a talent that is not an object (null, a number, an array) is
  rejected, and the message gives its position and what it was, for example
  `Talent at index 3 in assassination: a talent must be an object, not null.`
- A bad value is shown as it is. `NaN` and `Infinity` are written as `NaN` and
  `Infinity`, and a missing field as `undefined`, not as `null`.
- A `req` names a talent in the same tree, on an earlier row, and not the talent
  itself. A `req` that names a talent in another tree is rejected, with a
  message that says so. A talent with no `req` is fine: Adrenaline Rush has none
  in the snapshot.

`test/talents.test.js` feeds each of these broken data and checks the message,
and checks the vendored snapshot passes. It also imports a copy of
`js/talents.js` beside a broken snapshot in a fresh Node process, to prove the
module itself fails to load.

`byName` reports what it was given when it throws: `byName needs a talent name
as a string, not null.`

## Modifiers

Issue #96 (roadmap A2). A **modifier** is one piece of data that changes one
stat for the attacks it is scoped to. A talent rank, an aura stack, and later a
set bonus or a proc each give modifiers. The engine asks the pipeline for a
stat and never names a talent, a tree or an aura, so a new source is data and
needs no engine code. `js/modifiers.js` has the schema and the pipeline.

```js
{ kind: "damage", op: "add", value: 0.1,
  scope: { abilities: ["backstab"], hands: ["mainHand"], weaponTypes: ["dagger"] },
  source: "subtlety.opportunity" }
{ kind: "damage", op: "add", value: 0.3,
  scope: { tags: ["bleed"] }, source: "a bleed bonus" }
```

- `kind`: what changes. `attackPower`, `critChance`, `hitChance`,
  `dodgeReduction`, `parryReduction`, `armorIgnore`, `energyRegen`,
  `energyCost`, `resourceMax`, `damage`, `critDamage`, `haste`, `duration`. Each kind lists which scope
  keys it accepts (attack power, regen and haste are not per attack, so they
  accept none) and a floor for the result where a negative would be nonsense
  (attack power, regen, cost, a resource's cap, damage and a duration 0; the
  crit multiplier 1). `duration` is the length in seconds of an aura an ability
  applies, scoped by `abilities` only; `Ability.resolve` is the one place that
  applies it. Its stacking form is `percent` (`modifiers.stacking.duration`).
- `op`: `add` or `mult`. `value` is a finite number, and a `mult` must be above 0.
- `scope` (optional): conditions. Every key present must match the attack
  (AND). A key that lists several values matches any of them (OR). A missing
  key is unrestricted, and an absent or empty scope applies to everything.
  `abilities` are catalogue ids, `hands` are `mainHand` and `offHand`,
  `weaponTypes` are the types in `config.weaponTypes`, `schools` are `physical`
  and `nature`, and `tags` are `bleed`, `poison`, `white`, `yellow` and
  `finisher` (see [Damage tags](#damage-tags)), and `resources` are resource ids
  (`energy`, `comboPoints`, from `js/resource-data.js`). `resources` is accepted by
  `resourceMax` and by nothing else, and `resourceMax` accepts nothing else
  (the context for a cap is `{ resource: id }`; a `resourceMax` with no
  `resources` key changes the cap of every resource). `schools` and `tags` are
  accepted by the kinds that are per attack and not tied to a hand
  (`critChance`, `hitChance`, `armorIgnore`, `damage`, `critDamage`). An unknown key or value,
  an empty list, or a key the kind does not accept is a `RangeError` when the
  modifier is defined.
- `source` (optional): a label for `explain()` and tests.

`defineModifier` validates and freezes one. `expandRank(table, rank)` turns a
talent's per-rank modifier list into the modifiers for a rank. Rank 0, or no
entry, gives none.

**Context.** An attack passes `{ ability, hand, weaponType, school, tags }`. A
skill attacks with the main hand, so it passes `mainHand` and the main-hand
weapon's type. A weapon swing passes its own hand and weapon. A DoT tick passes
the context of the cast that applied it (its attack type and bleed flag are
kept on the DoT), so a tick and its application carry the same tags. A scope condition on a part the context lacks does not
match (it fails closed), and a call with no context matches only modifiers with
no scope.

**Where the engine asks.** Attack power (`Rogue.getAttackPower`), crit and hit
(`getCritChance(context)`, `getBonusHitChance(context)`, so also the crit roll
for a DoT tick, which sees the DoT's tags), dodge and parry reduction (the attack table, through
`resolveAttack`'s optional arguments), crit damage (the crit multiplier, for
skills and ticks), damage (before crit and armor), armor ignore
(`armorMultiplier`), energy regeneration (`regenerateResources`), energy cost
(`Ability.cast`), a resource's cap (`Resource.max`, kind `resourceMax`), and haste (each swing, `js/core/swing.js`). The damage modifier is the one
place a tag changes the damage itself, and it comes first: see
[Damage tags](#damage-tags) for where in the formula. `parryReduction` is read for the parry band, which has width only from the
front (`config.target.behind` false). Damage modifiers on a
DoT are read once, when the DoT is applied, as the snapshot of its tick damage.

**Stacking.** Sources are collected in a fixed order: static modifiers (talents,
gear) in the order given, then aura modifiers in aura registry order. Each
kind combines its contributions in the form `modifiers.stacking` gives it
(`data/constants.js`, an engineering judgement on the retune list). `A` is the
sum of the `add` values and `M` the product of the `mult` values:

| Form      | Kinds                                                                                                                 | Result                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `flat`    | attackPower, critChance, hitChance, dodgeReduction, parryReduction, armorIgnore, energyRegen, energyCost, resourceMax | `(base + A) × M`                                           |
| `percent` | damage                                                                                                                | `base × (1 + A) × M`                                       |
| `bonus`   | critDamage                                                                                                            | `1 + (base − 1) × (1 + A) × M`                             |
| `haste`   | haste                                                                                                                 | one step per modifier, by `haste.stacking`, once per stack |

So "+x% damage" talents add together, a separate multiplier (a buff) multiplies,
and a Lethality-style effect scales the crit bonus and not the whole hit. A
stack count repeats an aura's modifier that many times. The classic convention
(talents add, buffs multiply) is the assumption; if WoW Forever differs, change
the form for the kind in `modifiers.stacking` and nowhere else. The result of a
chance is clamped by whoever rolls it, not by the pipeline.

**No modifier, no change.** A modifier that does nothing (`add` 0, `mult` 1) is
dropped when it is built, and a kind with nothing left returns `base` itself,
with no arithmetic. A run with no modifiers (or only rank-0 talents, which
expand to none) therefore does the same sums as the code before A2: the
fixtures are byte-identical, and no random number is drawn or skipped, because
the pipeline never draws one and never changes whether a roll happens. A
zero-rank talent or proc consumes no rng. Tests check both.

**Supplying modifiers.** `new Rogue(config, { modifiers })` owns the static
list, and `createFight(seed, config, { modifiers })` passes it through. An
unknown option is a `RangeError`. The `Simulation` attaches itself to the
rogue's pipeline as the provider of the aura modifiers (`auraModifiers(kind)`),
and keeps an index that it rebuilds only when auras change. A `Rogue` (and so
its pipeline) can back only one `Simulation`: a second `new Simulation(sameRogue)`
throws, so build a new `Rogue` for each fight. A
selected talent build in `config.talents` supplies its modifiers from `runFight`
(D7, see [Applying a talent build](#applying-a-talent-build-d7-issue-106)); the
`runFight` result does not record modifiers, so its shape and the golden
fixtures are unchanged.
`explain(kind, context)` lists each contribution (source, op, value, stacks),
for tests and later for the UI.

**What is data and what is not.** The tests express the 11 DPS-relevant Combat
talents as modifier data (`test/combat-talents-as-data.test.js`), and combine
Assassination, Subtlety and Combat modifiers in one pipeline
(`test/two-tree-modifiers.test.js`). The effects that need a new roll, not a
number (a proc, such as an extra combo point or an extra attack) belong to A4,
and the talent table itself to D5.

**Cost.** A fight with no modifiers measured about 2 ms faster than before A2 on the
5-minute benchmark (22 ms against 24 ms warm median, five interleaved runs of
`npm run bench -- --runs 50`). The haste and regen reads go through one index
that is rebuilt only when auras change, which is the likely reason, though it
was not profiled. A 9-modifier Combat-style build adds about 3 ms over none.

## Damage tags

Issue #97 (roadmap A3). Every damage event (a white swing, a skill's hit, a
DoT's application and each of its ticks, and a poison hit or tick) is
described to the modifier pipeline by its ability id, one **school**, and some
**tags**. A modifier names them in its scope (`schools`, `tags`), so a talent
that says "+20% damage from poisons" is data and needs no engine code.
`js/damage-tags.js` builds them, `Simulation.attackContext(source, attackType)`
passes them, and nothing is keyed by a display name.

| Part       | Values               | Comes from                                                                                                                                                                                |
| ---------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `school`   | `physical`, `nature` | `nature.spells`, else the ability's `school` in the catalogue, else physical (an id the catalogue does not know)                                                                          |
| `bleed`    | tag                  | `bleed.spells`, or a source (a skill, a DoT) that sets `bleed`                                                                                                                            |
| `poison`   | tag                  | `poison.spells` (`instant-poison`, `deadly-poison`)                                                                                                                                       |
| `white`    | tag                  | the attack type `weapon`, an auto attack. A poison is never white                                                                                                                         |
| `yellow`   | tag                  | the attack type `skill`, an ability's attack. A poison is never yellow                                                                                                                    |
| `finisher` | tag                  | the ability's `finisher` field in the catalogue (a combo point cell in the spell data). The catalogue gives six: Eviscerate, Expose Armor, Kidney Shot, Rupture, Slice and Dice and Venom |

So Rupture is physical, `bleed`, `yellow` and `finisher`; Garrote is physical,
`bleed` and `yellow`; Backstab is `yellow`; a main-hand swing is `white`; Deadly
Poison is nature and `poison`. The constants are read when an event is built,
not copied at load, so changing `bleed.spells` or `poison.spells` takes effect
at once. `poison.spells` is a new row (an engineering judgement call by the dev,
not on the retune list). `nature.spells` now also lists `instant-poison`, which
deals Nature damage in Classic.

`damageTags` throws a `RangeError` for an event that is missing or not an
object, and for an `attackType` other than `"weapon"` or `"skill"`, rather than
returning an event with no `white` or `yellow` tag. `Simulation.abilityContext(id,
options)` takes no options or an object `{ attackType, bleed }`, and throws a
`RangeError` for `null`. A scope key given as an explicit `undefined`
(`{ tags: undefined }`) is rejected when the modifier is defined; it does not
mean "unrestricted". The module also fails to load if the catalogue has a school
that `SCHOOLS` does not list.

**Matching.** Keys AND and the values in a key OR, as for every scope. For
`tags` that means an event matches when it has _any_ of the listed tags. A
modifier cannot ask for two tags at once (Rupture is `bleed` and `finisher`:
there is no "bleed AND finisher"). Say the ability, or use two modifiers where
that is what is meant. A context with no `school` or `tags` (a stat read with
no attack) fails closed.

**Where it applies.** The `damage` modifier is read on the base damage: before
the crit multiplier, before the glancing reduction and before armor. The order
for a direct hit is `floor(base × damage modifier × crit multiplier)`, then
armor. There is no modifier applied after armor: damage is a multiplier and
armor is a multiplier, so the order only matters through the floor. A DoT reads
it once, when it is applied (the snapshot, as before), and its ticks then roll
crit with the DoT's tags (`critChance`, `critDamage`) and take `dotDamageTaken`
effects.

**Armor.** Both direct hits and ticks now take the armor rule from the tags and
not from an id list: an event with the `bleed` tag skips armor when
`bleed.ignoresArmor` is set, and a `nature` event skips it when
`nature.ignoresArmor` is set. The rotation never produces a nature or a
bleed-tagged direct hit, so no existing result changes. A direct poison hit
(A5, #105) skips armor with no further code.

**Not tags yet.** Aura definitions deal no damage today, so an aura has no
school or tags of its own. A5 (#105) added the poison hit and proc, and
`poison.spells` is checked against the poison catalogue (D9, #104). Tags are
not on the `runFight` result. The
result shape and the golden fixtures are unchanged, and an event with no
matching modifier does the same sums and draws the same random numbers as
before.

## Aura model and ids

Issue #94 (roadmap A1). A timed effect is an **aura**, defined once in
`js/auras.js`: an `id`, a display `name`, an `icon`, `target` (`self` goes in
`Simulation.activeBuffs`, `target` in `Simulation.activeDebuffs`), an optional
default `duration`, `maxStacks`, a `refresh` rule, `onApply` and `onExpire`
hooks, and `effects`. `defineAura` checks and freezes a definition, so a typo
fails when the module loads.

- `refresh`: a second cast sets the duration (`refresh`), adds to what is left
  (`extend`), or keeps the longer (`replace-if-longer`). A stackable aura gains a
  stack up to `maxStacks`.
- Effect kinds: `haste` (a fraction, once per stack), `energyRegenMultiplier`
  (once per stack), `dotDamageTaken` (`{ ids, bonus }` on the target, a
  multiplier of `1 + bonus × stacks` on the named DoTs) and `armorReduction` (a
  number of armor points on the target, A6). The engine asks for effects by kind with `Simulation.auraEffects(kind)` and
  never by an aura's name, so a new aura with one of these effects needs no
  engine change.
- `modifiers` (A2): an aura may also list modifiers, in the schema of the next
  section. They apply while the aura is up, once per stack, in registry order.
  `haste` and `energyRegenMultiplier` effects are compiled into modifiers when
  the aura is defined (`haste` becomes a `haste` `add`, `energyRegenMultiplier`
  an `energyRegen` `mult`), so the pipeline is the only place that reads them.
  `dotDamageTaken` and `armorReduction` stay effects for now (a target-side
  change, which A3 will take). `'__proto__'` is reserved and `defineAura`
  rejects it as an id.
- `applyAura` checks `stacks`: a whole number of 1 or more.
- `Simulation.applyAura(definition, { duration, stacks, icon })` puts one up and
  returns its record `{ id, name, icon, duration, stacks, charges }`. `hasAura(id)` asks
  whether one is up. The first definition seen for an id is the one used, and a
  second, different definition for the same id throws.
- A skill with `aura` set applies it after a landed cast with a positive
  `duration`. The effects are read in the registry order of `AURAS`, so the
  order the haste multipliers combine in never depends on which was cast first.

**Target debuffs, stacks and charges (A6, issue #95).** A target aura can have
stacks, charges, or both. They are separate counts and every debuff id tracks
its own.

- Stacks: `maxStacks` and a `stackRule`. `add` (the default) adds the stacks of
  each application, so each Deadly Poison proc is one more stack. `highest`
  takes the larger of the current and new count, so a 2-point Expose Armor
  does not weaken a 5-point one. Both stop at `maxStacks`. A new application
  also refreshes the duration by the `refresh` rule.
- Charges: `charges` (a whole number, or `null` for none). A charged aura
  ends when its charges run out as well as when its time does. Each landed
  direct attack on the target (a hit, glancing blow or crit from a skill or a
  white swing) uses one charge of every charged debuff on it, after the hit's
  armor is applied, so the hit that uses the last charge still gets the
  effect. A miss, dodge or parry, a DoT application and a DoT tick use none.
  A new application restores the charges to the full count. Using a charge
  draws no random number. `Simulation.consumeCharge(id, count)` is the one
  place charges go down; it returns the charges left, or `null` for an aura
  that is not up or has none. No aura in the data has charges yet: the game
  data in #95 does not give one, so this is the mechanism for later.
- `Hemorrhage`: +15% to Rupture ticks only, 15 s, from
  `k("hemorrhage.ruptureBonus")`. A landed Hemorrhage refreshes it to the full
  15 s. Its expiry is an event at exactly 15 s: just before 15 s it still
  counts, and at 15 s it is gone (test/target-debuffs.test.js).
- `Expose Armor` (`k("exposeArmor")`): one stack per combo point spent (up to
  `k("combo.max")`, rule `highest`), 30 s, and each stack is an
  `armorReduction` of `armorPerComboPoint` (450) armor. Armor mitigation uses
  `max(0, target.armor − Σ armorReduction × stacks)`, so with no Expose Armor
  up the number is `target.armor − 0` and every result is unchanged. Bleeds and
  Deadly Poison ticks skip armor, so it does not change them. Nothing in the
  rotation casts it yet.
- `Deadly Poison` (`k("poison.deadly")`): a target debuff with 5 stacks and 12 s,
  where each proc adds a stack and refreshes the time. The proc's `applyDot`
  action applies it and sets the DoT's damage to the number of stacks times one
  tick (A5, #105). The
  id is `deadly-poison`, the slug the poison's DoT uses. The poison catalogue
  (`js/poisons.js`, D9) lists the poisons; they are not in the ability
  catalogue.

**Checks on lookups.** An aura map, `auraEffects` and the weapon hand check
only use own properties, so an inherited name (`__proto__`, `constructor`,
`toString`) is never an aura, an effect or a hand. `auraEffects(kind)` throws
on a kind that is not in `EFFECT_KINDS`, and `defineAura` throws on an unknown
kind or an `effects` value that is not a plain object. Before this a typo gave
no effect and no error.

**Identifiers.** A spell, aura, cooldown or weapon is identified by its
catalogue id (`slugify(name)`): `sinister-strike`, `slice-and-dice`,
`main-hand`, `off-hand`. `Simulation.cooldowns`, `activeBuffs`, `activeDebuffs`,
`activeDots` and `abilityStats` are keyed by id, and the constants `bleed.spells`,
`nature.spells`, `abilities.offGcd` and `abilities.apCoefficients` hold ids. The
display name is carried beside the id for the page, the combat log
(`event.name`) and the result's `abilities` keys, and is never compared. The
Main-hand and Off-hand labels are the `WEAPON_ATTACKS` entries in `js/weapon.js`.
A name is written once, at the definition site (the spell data for an ability, `js/auras.js`,
`js/weapon.js`).

**Guard.** The lint rule `engine-purity/no-display-name` (`eslint/engine-purity.js`,
configured in `eslint.config.js`) fails `npm run lint` on a string, template or
identifier key equal to an ability name, `Main-hand`, `Off-hand` or
`Deadly Poison` anywhere in `js/` outside those three files. `test/engine-lint.test.js`
tests it.

**Result shape.** Unchanged. `runFight` and `createFight` still return
`abilities` keyed by display name and a log with `name`. The `Simulation`
internals changed (id keys, `resolveAttack(source, ...)` taking `{ id, name }`),
which is not part of the result. A6 (#95) adds `charges` to an aura record,
which is internal too. The golden fixtures are byte-identical.

## Ability schema

`js/abilities.js` turns the `spell_desc` text of the vendored snapshot into one
record per rogue ability (roadmap D1, issue #93). It reads the highest rank
of each spell on the Assassination, Combat and Subtlety tabs: 34 abilities,
for example Sinister Strike rank 8, Eviscerate rank 9, Rupture rank 6 and Slice
and Dice rank 2. The snapshot's `spellbook` lists the ranks and `spell_desc` holds the
text under the key `Rogue|Name|Rank N` (`Rogue|Name|` for a spell with one
rank, `Rogue|Name|Passive` for a passive). `js/snapshot.js` imports the JSON, so
the module needs no `fetch` or `fs`, and `npm run data:refresh` changes the
catalogue with no code change.

**D1 was data only.** D2 (#98) is the first reader: the executor takes an
ability's display name and `startsGcd` from the catalogue (see
[Ability executor](#ability-executor)). The numbers still come from the
constants, and `test/abilities.test.js` compares the catalogue with them
(`sinisterStrike`, `eviscerate`, `rupture`, `sliceAndDice` and the rest), so
the two cannot drift apart.

Each ability has:

- `id` (`slugify(name)`), `name`, `rank`, `spellId`, `tab`, `school`
  (lower-case) and `passive`.
- `cost`: `{ resource, amount }`, or `null` for no cost. `cooldown` in seconds
  (0 for none). `castTime`: 0 for an instant spell, seconds, or `null` when the
  text gives none (passives).
- `comboPointsAwarded` (a builder's points), and `finisher`: `{ min, max }`
  combo points, or `null`.
- `weaponPercent`: `{ base, dagger }` as multipliers (150% is 1.5), `dagger`
  being `null` unless the text gives a separate dagger figure. `flatDamage`:
  the bonus damage, or `null`.
- `dot`: `{ damage, duration }` for a plain periodic effect, or `null`.
- `perComboPoint`: the 1 to 5 point table, each row
  `{ comboPoints, damage: { min, max } | null, duration | null, armorReduction |
null }`. Eviscerate carries damage, Rupture damage and duration, Slice and
  Dice duration.
- `scalesWithAttackPower` and `ap`: `{ kind, constant, value }`, naming the
  constant the coefficient came from.
- `bleed`, `startsGcd` and `requires` (`"stealth"`, `"daggers"`).
- `text`: the source description.

**What the text does not say comes from `data/constants.js`.** The AP
coefficients are not in the tooltips: `abilities.apCoefficients` points at the
existing `eviscerate.apPerCP` and `rupture.apByCP` instead of copying them.
`abilities.offGcd` lists the ids of the abilities that do not start the GCD
(Premeditation; passives never do). `bleed.spells` lists the bleed ids.
`abilities.apCoefficients` is keyed by id too. `abilities.resources` lists the
resources a cost cell may name (`energy`). The unit
scales are `abilities.secondsPerMinute` and `abilities.percentScale`, and
`abilities.tabs` names the tabs read. Each has a `source` tag in
`docs/provenance.md`.

**Malformed text fails loudly.** Every cell and table row of `l` and every
number sentence the parser knows is read, and one it does not understand throws
an `AbilityParseError`. Its message starts with the spell and rank, for example
`Cannot read Rupture rank 6 from the spell data: ...`, and `.spell` and `.rank`
carry them. The catalogue is built when `js/abilities.js` loads, so a refreshed
snapshot with a reworded tooltip fails that import, not a fight. Sentences
that hold no number to read (for example "Must be stealthed") are skipped, and
numbers inside them are not taken.

Three checks make the parser stricter than a first read (issue #94, from the
#111 QA):

- A cost cell is `<amount> <resource>` only for a resource in
  `abilities.resources`. A cell such as `45 sec` or `45 Rage` is an
  unrecognised cell, not a cost.
- A table row with min damage above max damage throws.
- A damage-over-time sentence (`damage over <n>`) that the parser did not read,
  or a `<n> damage` number outside the table that neither the flat-damage nor
  the DoT reader took, throws, instead of becoming a silent `null`. "150%
  weapon damage" and a sentence with no number are not damage numbers.

**Not parsed yet.** Buff and debuff magnitudes (Slice and Dice's haste %,
Adrenaline Rush's energy %, Ghostly Strike's dodge, Hemorrhage's Rupture
bonus). They stay in `data/constants.js` until the issue that needs them. The
poisons are read the same way in `js/poisons.js` (D9, #104, see
[Poisons](#poison-definitions-d9-issue-104)), and the talent modifiers were
written later, by hand, in `data/talent-effects.js` (D5, #102). The catalogue is
deeply frozen, and building it draws no random numbers.

## Resources

Roadmap D3 (issue #99). Energy and combo points are resources: a class
describes each as data in `js/resource-data.js` (`RESOURCE_DEFINITIONS`,
deep-frozen), and `js/resource.js` turns one into a `Resource`, the pool a
rogue holds in `rogue.resources` by id. Neither the model nor the generic
executor (`js/ability.js`) names energy, combo points or Premeditation; a test
reads their source for those names, and another runs an ability against a
second resource ("rage", defined in the test) with no engine change.

A definition holds constants ids, not numbers:

- `max`: the cap before modifiers (`energy.max`, `combo.max`).
- `start`: the value at the start of a fight (`start.state` field `energy`,
  `character.startingComboPoints`).
- `regen`: `{ perSecond, modifier, tick }`. `perSecond` is the base rate,
  `modifier` the kind of the modifiers that change it (`energyRegen`, so
  Adrenaline Rush's bonus applies exactly while the buff is up, as in
  [Energy](#energy)), and `tick` how it is applied. `energy.tickMode` is
  `continuous` (a line in time, the core's `EnergyPool`, `engineering`), the
  only mode there is.
- `costModifier`: the modifier kind that changes what an ability pays from this
  resource (`energyCost`).
- `whole`: `true` when the pool holds whole units only (combo points). A gain
  or a spend of a fraction is a `RangeError`, and so is a `gainResource` action
  with a fractional amount on such a pool (checked when the proc loads).
- `onTargetChange`: what the pool does when the target changes, `combo.onTargetChange`,
  `clear` (the points go, and any pending expiry), or `keep`. It is an
  assumption on the retune list, since the engine has one target and nothing
  calls `Resource.targetChanged` yet; target swapping will.

`Resource` has `gain(amount)` (capped, returns what it added), `spend(amount)`,
`spendAll()` (returns the count it took, read before the reset), `has`,
`clamp()`, an expiry (`armExpiry`, `clearExpiry`, `tick`, which is
Premeditation's rule: points that go unless a later gain or a spend cancels
them), and `targetChanged()`. It has no regeneration of its own since #234:
during a core run energy is an `EnergyPool` (see Energy). The cap, `max`, is
`modifiers.resolve("resourceMax", baseMax, { resource: id })`, so a max-energy
talent is a modifier with `scope: { resources: ["energy"] }`.

These are the operations a proc (A4, #101) calls: "restore 25 energy" is
`gain(25)` on `energy`, "add a combo point" is `gain(1)` on `comboPoints`, and
a finisher's proc that depends on how many points it spent reads the count
`spendAll()` returned. See [Procs](#procs).

An amount must be a finite number of 0 or more: `gain` and `spend` throw a
`RangeError` for a negative, NaN, infinite or non-number amount, so a bad
data row fails where it is used and cannot add a resource by spending a
negative. `Resource.clamp()` brings a pool down to its cap. The event core
calls it after each event (energy's `EnergyPool` caps itself), so a cap that falls (a `resourceMax`
modifier that goes with an aura) takes the excess with it, and a cast that
neither gains nor spends no longer leaves it in place for ever. A default
fight never has a pool above its cap, so nothing changes there. An ability's
`cost`, `spend` and `gain` resource ids are checked when the `Ability` is built
(a `RangeError` naming the id, not a `TypeError` in the middle of a cast).
`Ability.pool` and `createResources` look ids up with `Object.hasOwn`, so
`"toString"` or `"__proto__"` is an unknown id and not a function on the
prototype.

`rogue.energy`, `rogue.maxEnergy`, `rogue.comboPoints` and
`rogue.maxComboPoints` stay, as views on the pools. Setting a `max` sets the
base cap, before modifiers. `Rogue.armPremeditation`, `clearPremeditation`,
`premeditationCp` and `premeditationCpRemaining` are views on the combo point
pool's expiry.

**Result shape.** Unchanged. `runFight` and `createFight` return the same
fields, the four golden fixtures are byte-identical, and the random numbers
are drawn in the same places. `Simulation.regenerateEnergy` is now
`Simulation.regenerateResources` (it has one caller, `step`), and the `Ability`
fields were renamed to generic ones (`cost`, `gain`, `spender`, `expires`).

## Ability executor

`js/ability-data.js` lists the abilities the engine casts as data, and
`js/ability.js` casts them with one class (roadmap D2, issue #98). The
subclasses of the old `js/skill.js` are gone. A new ability is a new entry and
no new code, unless it needs a damage kind or a rule the executor does not have
yet.

An entry holds no number and no display name:

- `key` is the property on `Rogue.abilities` (`sinisterStrike`), `id` the
  catalogue id, `row` the `data/constants.js` row with the ability's numbers
  and `icon` the image path.
- `cost` is `{ resource, field, refund }`: the amount is the row's `field`,
  paid from the resource with that id, and `refund` is the constants id of the
  share a miss gives back. `gain` is `{ resource, field }` (a landed cast adds
  the row's `field`). `spend` is `{ resource }` (needs one and spends all of it).
  `expires` is Premeditation's, `{ amount, after }`: the points it added expire
  unless a later cast adds one or a finisher spends them. Every entry is
  deep-frozen.
- `damage` is absent for an ability that is not an attack (the log records a
  "Cast"), or one of three kinds. `weapon` is the weapon roll times a
  multiplier plus a bonus. A multiplier is a number or `{ dagger, other }`,
  chosen by `config.weapons.mainHand.type` and nothing else (Ghostly Strike
  and Hemorrhage). `finisherRoll` is Eviscerate: attack power times combo
  points times `eviscerate.apPerCP`, plus a roll inside the band for the combo
  points. `dot` is Rupture: the row's damage plus attack power times
  `rupture.apByCP`, as a total the DoT applicator divides by the tick count,
  with `bleed` so the ticks skip armor.
- `aura` is the aura the cast applies (an `AURAS` key) and its length, a field of
  the row, of another row (Hemorrhage's 15 s is `hemorrhage.ruptureBonus`), or
  a table by the amount spent (`bySpent`: Slice and Dice, Rupture).

The display name and whether the ability starts the GCD come from the catalogue
(`name`, `startsGcd`). A definition whose `id` is not in the catalogue throws.

**One cast path.** `Ability.cast` is the one cast, in place of the old per-skill `cast` methods: on cooldown, or
a spender with no combo points, returns null. It then resolves the cost through
the cost modifiers of the resource it is paid from and needs that much of the
resource and a clear GCD (or no GCD).
It spends the cost, starts the GCD, resolves the damage and the aura length
once (`Ability.resolve`, which reads what the spend resource holds before the
reset), and makes the attack, the DoT or the cast. A miss
refunds `skill.missEnergyRefund` of the cost and stops. Otherwise it spends the
spend resource or gains the gain resource (arming or clearing an expiry), starts the cooldown and
applies the aura. The random numbers are drawn in the same places as before:
one for the weapon roll or the Eviscerate roll inside `resolve`, then the
attack's own rolls. A zero-rank talent or a proc never draws.

**What changed on the object.** `ability.damage()` still returns the damage.
`ability.duration` is the fixed length of an aura that has one. It no longer
holds the last Rupture or Slice and Dice length. `ability.resolve()` returns
`{ damage, duration }` for the rogue's current combo points, and the aura
records on `Simulation` hold what a cast applied. A Slice and Dice cast outside
the combo points its table covers applies no buff (before, it reused the last
length). With `combo.max` at 5 and tables of 5 that cannot happen in a default
fight. It can with more points than the tables cover: a `resourceMax` modifier
scoped to `comboPoints` (through `createFight` options, or `new Rogue(config,
{ modifiers })`) raises the cap to 6 or 7, and so does setting the pool by hand
(`rogue.resources.comboPoints.value = 6`). At 6 or 7 points the finishers do
this, and the code is `Ability.resolve` and the `DAMAGE` kinds in
`js/ability.js`:

- Slice and Dice spends all the points and applies no buff (its table gives a
  duration of 0).
- Rupture spends all the points, rolls the attack table, and applies no DoT
  (its damage is 0 outside 1 to 5 points, so there is nothing to tick).
- Eviscerate spends all the points and has no base damage band, because the
  bands cover 1 to 5. It still adds its attack-power term, `apPerCP` times the
  points spent, so 6 points hit for the attack-power part alone.

**Result shape.** Unchanged. `runFight` and `createFight` return the same
fields, and the four golden fixtures, including the scripted one, are
byte-identical. The seams `Rogue.prototype.rotation` (the scripted fight
hooks `castRotation` since #197), a per-instance
`skill.cast` and the `rogue.abilities` keys work as before, so
`scripts/scripted-fight.mjs` is unchanged.

**Parity.** `test/legacy-skills.js` keeps the old classes word for word.
`test/ability-parity.test.js` runs the old and the new abilities on the same
seeds and compares the draws, totals, log, auras, cooldowns and Premeditation
state, including a fight that casts every ability in a changing order.

## Procs

Roadmap A4 (issue #101). A proc is data in `js/procs.js`: a trigger, a chance,
an optional internal cooldown (ICD), a filter and an ordered list of actions.
`defineProc` checks it when it loads (an unknown key, trigger, mode, action,
aura, resource or ability id, or a chance outside 0 to 1 throws a `RangeError`)
and freezes it. `defineRankedProc(spec, rank)` takes a chance as a `values`
table by rank and returns `null` at rank 0, like `expandRank` for modifiers;
every rank is checked even at rank 0. The engine names no talent, poison or
ability to run them.

```js
defineProc({
  id: "hack-and-slash",
  trigger: "onHit",
  scope: { weaponTypes: ["sword", "axe"] },
  chance: { mode: "flat", value: 0.05 },
  actions: [{ type: "extraAttack" }],
});
```

**Who has them.** The host passes them to `new Rogue(config, { procs })` or
`createFight(seed, config, { procs })`, the way it passes `modifiers`. A `null`
(rank 0) is skipped, a duplicate id or an object `defineProc` did not make
throws, and so does an unknown option (`Known: modifiers, procs.`). The
SimConfig has no procs field and `runFight` does not take any. The only
procs a full fight has are the poison procs `config.poisons` builds
(`poisonProcs` in `js/poisons.js`, A5, #105; see
[Poison procs](#poison-procs-a5-issue-105)), and a selected talent build adds its own (D7): `procsFromTalents(ranks)` builds
the list from `PROC_TABLES` in `js/proc-data.js` (the `procs` of the entries in
`data/talent-effects.js`: Puncturing Wounds and Hack and Slash so far, in the
catalogue's order) and is not called by `runFight`. `procsFromTalents`
takes a plain object: `null`, an array or anything else is a `RangeError`, and
so is a key that is no talent in the catalogue (a typo would give a build that
quietly lacks its proc). A talent that exists but gives no proc is ignored.

**Triggers**, in the fixed order they are dispatched (`PROC_TRIGGERS`):

- `onHit`: a direct attack hit. A white swing, or an ability that attacks, and
  whatever the roll gave: hit, crit, glancing or block. Not a DoT application
  (it deals nothing yet) and not a tick.
- `onCrit`: a direct attack that crit.
- `onWhiteHit`: a white swing that hit (it fires `onHit` too).
- `onAbility`: a cast that went through, by ability id (`scope.abilities`) or
  by tag (`scope.tags: ["finisher"]`, from `js/damage-tags.js`). It fires at the
  end of the cast, after the cost, the gain or spend, the cooldown and the
  aura. A DoT application and a cast that does not attack (Adrenaline Rush) fire
  it; a cast that missed does not. A cast that does not attack has neither the
  `white` nor the `yellow` tag.
- `onDotTick`: one tick of a DoT, crit or not (`scope.tags: ["bleed"]` or
  `abilities: ["rupture"]`).

The filter is a modifier scope (`abilities`, `hands`, `weaponTypes`, `schools`,
`tags`), matched with `scopeMatches`. A scope with two keys needs both.

**Chance modes.** The chance is worked out before any draw.

- `flat`: `value`.
- `ppm`: `value` times the hand's base weapon speed over
  `proc.secondsPerMinute` (60), capped at 1. Haste does not change it. Not
  allowed with `onDotTick`, which has no hand. It needs a swing or an attack:
  a `ppm` proc that meets a cast that does not attack (Adrenaline Rush) is a
  `RangeError` when it is considered, because a quiet chance of 0 would hide a
  proc that can never fire.
- `perSpent`: `value` times the combo points the cast spent, capped at 1, with
  `onAbility` only. `Ability.spendable()` reads the count before the pool
  resets, so Eviscerate at 3 points with `value: 0.2` is a 60% chance, and a
  cast that spent none has chance 0.

**Actions**, run in the order given when the proc fires:

- `gainResource { resource, amount }`: `Resource.gain` on a pool of
  `rogue.resources` by id. `comboPoints` is an extra combo point, `energy` is
  an energy restore. The cap applies, and `stats.gained` counts what was added.
  Points gained clear a pending Premeditation expiry, as a builder's do. The id
  is checked when the `Simulation` is built.
- `applyAura { aura, duration?, stacks? }`: `Simulation.applyAura` of an aura id
  in `js/auras.js`, checked at load.
- `dealDamage { id, name?, min, max?, spellHit?, canCrit? }`: damage from a source of its
  own, in the ability record and the combat log. The damage modifiers, armor and
  the damage tags of the `id` apply (a poison id is a nature spell). With
  `spellHit` it first rolls a spell hit (no bonus hit), and a resist deals
  nothing. With `canCrit: true` a landed hit then rolls one crit at the melee
  crit chance (suppression per its constant, see Poison procs) for the crit
  multiplier given by `poison.instantCrit`; without it, the damage never crits.
  It fires no procs.
- `extraAttack`: one more white swing in the hand that triggered it, resolved
  by `resolveAttack` like any swing, so its own triggers run, depth first.

**Chains.** An extra attack that can itself trigger an extra attack is the
`hackAndSlash.chain` assumption (off, a retune item): a proc that holds an
`extraAttack` does not roll on an extra swing. With it on, a chain that goes
deeper than `proc.maxChainDepth` (64) throws a `RangeError` instead of looping.

**Random numbers, in order.** Procs draw only when they could fire.

1. The attack's own draws (table, crit, glance, weapon damage), as always.
2. Then the triggers in the order above; inside one trigger, the procs in the
   order the host listed them. A white swing fires `onHit`, `onCrit`,
   `onWhiteHit` right after its own draws. A cast fires its triggers last,
   after everything it did. A tick fires `onDotTick` after the tick's own draw.
3. Per proc, no draw when the filter does not match, the proc is on its ICD,
   the chain rule stops it, or its chance is 0 (a zero-rank talent is no proc at
   all). Otherwise one draw, and it fires when the draw is below the chance.
4. Then the actions, depth first: an `extraAttack` draws its weapon damage and
   table and runs its own triggers before the next action; `dealDamage` draws
   the spell hit (if any), then the damage if `min` and `max` differ.

A fight with no procs, or only `null` ones, draws what it always did: the four
golden fixtures are byte-identical.

**Counters.** `Simulation.procs.stats[id]` is `{ rolls, fires, blocked,
gained }` (draws made, procs that fired, ICD refusals, resource gained). It is
not in the `runFight` result.

**Result shape.** Unchanged: `runFight` and `createFight` return the same
fields, `SimConfig` has no new field, and the golden fixtures are byte-identical.
What was added is the `procs` option on `Rogue` and `createFight`, the
`Simulation.procs` runner and `scopeMatches` (the modifier module's scope
matcher, now exported). Extra-attack damage is recorded under the swinging
hand's ability record (`main-hand` or `off-hand`), so its `casts` count includes
the extra swings.

**Known limits.** There is no `procChance` modifier kind yet (Improved Poisons,
D8a, will need one); `dealDamage` crits only with `canCrit` (Instant Poison); `ppm` uses the unhasted weapon
speed; a selected talent build in `config.talents` supplies the talent procs (D7).

## Talent effects

Roadmap D5 (issue #102). What a talent does is data in `data/talent-effects.js`,
one entry per talent id, written by hand from the snapshot's rank text. The
Combat tree is done (17 entries), and so are the six Assassination talents of
the reference build (D8a, #119: three in PR 1, three in PR 2). The engine names no talent: `expandTalents`
(`js/talent-build.js`, also exported by `js/fight.js`) turns a map
`{ talent id: rank }` into what a fight takes, and the modifier pipeline and the
proc runner do the rest.

An entry has `textHash` and then one or more of these, or `noDpsEffect` alone:

- `modifiers`: rank tables for `expandRank`, `{ kind, op, values: [rank 1, ...],
scope? }`, with the kinds and scopes of [Modifiers](#modifiers).
- `procs`: proc specs for `defineRankedProc` with `chance.values` by rank (see
  [Procs](#procs)), their chances read from `data/constants.js`.
- `ability`: the id of the ability the talent grants (Blade Flurry, Adrenaline
  Rush). What it does is the ability's and its aura's definition.
- `noDpsEffect`: a one-line reason the talent does nothing in a damage fight.

`textHash` is the SHA-256 of the talent's rank texts joined with a newline. A
test recomputes it from the snapshot, so a refreshed snapshot that rewords or
renumbers a talent fails until its entry is read again. The same tests read
every modifier value and proc chance out of the text, at every rank
(`test/combat-talents-as-data.test.js`, `test/talent-effects.test.js`). The
coverage check (D6, below) lists the talents with no effect and the entries
whose text changed.

**Talent coverage check (D6, #103).** `npm run talents:coverage`
(`scripts/talent-coverage.mjs`, with `test/talent-coverage.test.js`) reads the
catalogue and the effects map and reports, by talent id:

| Finding   | What it is                                                                    | Status                               |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| uncovered | no entry, or an entry with no modifiers, procs, ability or `noDpsEffect`      | **fails** in Combat, warns elsewhere |
| changed   | the entry's `textHash` is not the hash of the catalogue's rank texts any more | **fails** in every tree              |
| orphan    | an entry for a talent id the catalogue does not have                          | **fails**                            |

The rule is the interim one of the Phase 2 plan: the Assassination and Subtlety
talents without an effect are expected until Phase 4 (D8), so they are warnings
and the command still exits 0. A Combat talent must be covered. A changed text
is a failure because the entry's numbers were read from the old text, so they
may be wrong; `test/talent-effects.test.js` already fails on the same condition,
and the command names the talent with the stored and current hash and every
current rank text. (It cannot name the rank that changed: the stored hash covers
all of a talent's rank texts together.) After a refresh, re-read the entry
against the text, then set `textHash` to the current hash the command prints.
Which tree must be fully covered is `FULL_COVERAGE_TREES` in the script
(`combat`); when D8 covers a tree, add it there.

In CI the command runs after the provenance steps and prints every finding,
and under GitHub Actions it also writes one `::warning` annotation listing the
uncovered ids and an `::error` per failure, so they show on the run. Exit
status: 0 with no failure, 1 with one, 2 for an unknown argument.

```js
import { createFight, expandTalents } from "./js/fight.js";

const build = expandTalents(config.talents); // or { "combat.precision": 3, ... }
const { modifiers, procs, abilities } = build;
createFight(seed, config, { modifiers, procs, abilities });
```

**The result of `expandTalents`** (frozen): `modifiers` and `procs`, and
`abilities` (the granted abilities of talents at rank 1 or more), which are the
three options of `Rogue`, and two lists for the host: `noDps` (talents with
points and no effect) and `unmapped` (talents with points and no entry: the
Subtlety tree, but for Ghostly Strike, Premeditation and Hemorrhage, #207, and
the Assassination talents the reference build does not take,
until D8b and later; they do nothing, so say so). For the reference build
`unmapped` is empty.
Rank 0, or a talent left out, expands to nothing: no modifier and no proc, so it
changes no number and draws no random number. Everything comes in catalogue
order whatever the order of the map, and the procs are rolled in that order. An
unknown talent id, a map that is not a plain object, and a rank that is not an
integer from 0 to the talent's maximum are a `RangeError`. The data is checked
against the catalogue when `js/talent-build.js` loads (`checkTalentEffects`):
shape, one value or chance per rank, unique proc ids, a real ability, and every
table through the pipeline at every rank, rank 0 too.

Since D7 (#106) the engine applies `config.talents` itself (`applyBuild`, see
[Applying a talent build](#applying-a-talent-build-d7-issue-106)), so a host no
longer has to call `expandTalents` and pass the lists to `createFight`; those
`createFight` options remain for extra modifiers, procs and abilities. With no
build, Blade Flurry and Adrenaline Rush stay in the default rotation without a
talent; with a selected build they are cast only when it has the talent. Cold
Blood is cast only when the build grants it (below).
`js/proc-data.js` is a view of the `procs` fields.

**The Combat tree: 11 with an effect, 6 without.**

| Talent                    | Max | What it is in the data                                                                                  |
| ------------------------- | --- | ------------------------------------------------------------------------------------------------------- |
| Improved Eviscerate       | 3   | `damage` +7/13/20%, Eviscerate                                                                          |
| Improved Sinister Strike  | 2   | `energyCost` -3/-5, Sinister Strike                                                                     |
| Lightning Reflexes        | 5   | none: dodge, nothing attacks the rogue                                                                  |
| Puncturing Wounds         | 3   | `critChance` +10/20/30% Backstab, +5/10/15% Mutilate; proc: Backstab adds a combo point 15/30/45%       |
| Deflection                | 3   | none: parry, nothing attacks the rogue                                                                  |
| Precision                 | 3   | `hitChance` +1/2/3%                                                                                     |
| Endurance                 | 2   | none: Sprint and Evasion cooldowns are not cast                                                         |
| Riposte                   | 1   | none: needs a parry; block and parry are out of scope (project owner ruling 2026-10-26)                 |
| Improved Sprint           | 2   | none: movement                                                                                          |
| Improved Kick             | 2   | none: interrupts                                                                                        |
| Flawless Execution        | 1   | `energyCost` -10, Eviscerate                                                                            |
| Dual Wield Specialization | 5   | `damage` +5..25%, off hand                                                                              |
| Blade Flurry              | 1   | grants the ability (haste aura)                                                                         |
| Hack and Slash            | 5   | `critChance` +1..5% (dagger, fist), `armorIgnore` +3..15% (mace); proc: extra attack 1..5% (sword, axe) |
| Weapon Expertise          | 2   | `dodgeReduction` and `parryReduction` +1/2%                                                             |
| Aggression                | 3   | `damage` +2/4/6%, Sinister Strike, Backstab, Eviscerate                                                 |
| Adrenaline Rush           | 1   | grants the ability (energy regeneration aura)                                                           |

**11 or 12.** Settled: 11 is confirmed (project owner confirmation 2026-10-26,
relayed), so there is no twelfth; the likely candidate, Riposte, needs a parry
and cannot trigger from behind. The open question that follows is kept for the
record. The roadmap and the issue say 11 or 12 DPS-relevant Combat
talents, and the classification above gives 11. Which would be a twelfth is not
settled: of the six without an effect, Riposte (a 150% weapon damage strike after
a parry), Endurance and Improved Sprint are the ones a count could include, and
none acts in a fight from behind with no incoming attack. The six are marked
`noDpsEffect`, each with its reason, so adding a twelfth is a change to one
entry. Two talents that do work only in some builds are counted as DPS: Hack and
Slash (a sword or axe, a dagger or fist, or a mace in the hand) and Puncturing
Wounds (Backstab, which the placeholder rotation never casts).

**The Assassination talents in D8a (#119): 6 of 6 for the reference build.**

| Talent                  | Max | What it is in the data                                                                                                                                                 |
| ----------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malice                  | 5   | `critChance` +1..5%, all attacks. "and Poisons" needs no extra entry: the modifier is unscoped, so it adds to Instant Poison's crit roll, and to Deadly Poison's ticks |
| Ruthlessness            | 3   | proc: `onAbility`, `scope.tags: ["finisher"]`, `flat` chance 20/40/60%, `gainResource` 1 combo point                                                                   |
| Improved Slice and Dice | 3   | `duration` +15/30/45% of the aura length, Slice and Dice (9 to 21 s becomes 13.05 to 30.45 s at 3/3)                                                                   |
| Relentless Strikes      | 1   | proc: `onAbility`, finisher tag, `perSpent` chance 20% per point, `gainResource` 25 energy                                                                             |
| Lethality               | 5   | `critDamage` +4..20%, the six abilities of the text (Gouge and Mutilate have no engine definition: never cast)                                                         |
| Cold Blood              | 1   | grants the ability `cold-blood` (instant, 3 minute cooldown, off the GCD); its aura is one charge of +100% crit                                                        |

`critDamage` stacks as `bonus`, `1 + (base - 1)(1 + A)`, so Lethality 5/5 takes
the 2.0 crit multiplier of melee to 2.2 (+20% of the crit bonus, not +20% of
the damage), and rank 1 to 2.04.

**Ruthlessness and Relentless Strikes (PR 2).** Both are `onAbility` procs that
fire at the end of a cast, after the finisher has spent its points, filtered by
the `finisher` tag (Slice and Dice, Rupture and Eviscerate carry it; a Slice and
Dice cast, which is not an attack, fires them too). Ruthlessness' text says
"add a Combo Point to your target", and the point goes to the rogue's combo
pool as a point does here: because it comes after the spend, it is the first
point of the next set (wowsims `AddComboPointsIgnoreTarget` does the same). Its
chance is 20/40/60% flat by rank. Relentless Strikes' text says "20% chance per
Combo Point" to restore 25 energy: `perSpent` is 0.2 times the points the
finisher spent, capped at 1, so one roll per finisher, at 5 points a sure
thing. The roll is drawn whenever the chance is above 0, so a 5-point finisher
still draws. A talent at rank 0 has no proc and draws nothing. The numbers are
the constants rows `ruthlessness.comboPoint` and `relentlessStrikes.energy`.

**Cold Blood (PR 2).** The talent grants the ability through the existing
`abilities` mechanism: `expandTalents` lists `"cold-blood"`, and the host passes
that list as the Rogue option `abilities` (below). The ability
(`js/ability-data.js`, row `coldBlood`) has no cost, a 180 s cooldown, and is off
the GCD (`abilities.offGcd`), so it does not wait for one. Its
aura (`js/auras.js`, `cold-blood`) has one charge and a `critChance` add of +1.0
scoped to the abilities its text names: Sinister Strike, Backstab, Ambush,
Eviscerate and Mutilate, by catalogue id (a test reads them out of the text).
Mutilate has no engine definition, so its entry is inert until it has one. The
text says "until used", so the aura's 3600 s duration stands in for no expiry.

The charge is spent by a generic step (`Simulation.consumeUseCharges`, called
from `resolveAttack` for a landed attack): a landed attack uses one charge of
every charged self aura whose modifiers' scope matches the attack, so nothing
there names Cold Blood. A white swing, a Slice and Dice, an ability outside the
scope, and an attack that misses, dodges, is parried or is blocked (from the
front) leave the charge. The crit chance goes through the pipeline, so +100% on
the rogue's crit chance is a raw chance above 1 and, with the suppression order
above, a sure crit. The crit roll is still drawn, so the draws are the same as
without it.

**Assumption: an attack that does not land keeps the charge.** That a miss,
dodge, parry or block does not spend the charge is our design choice ("the next
Eviscerate that lands"), an assumption that is not verified against Classic. It
is not what wowsims does: there the aura is dropped in `OnSpellHitDealt` after
the next flagged spell whatever its outcome, so a miss or dodge spends it too
(`sim/rogue/talents.go`, `registerColdBloodCD`, read 26 Oct 2026). Parry and
block cannot happen while the sim is behind-only, so for them it changes
nothing. A miss or dodge can happen behind, so a fight with Cold Blood granted
(Rogue option `abilities`) differs from wowsims there. No golden fixture
depends on it: the two config cases added by #107 grant Cold Blood, but seed 107
has no miss or dodge on a Cold Blood attack in either, so they would not move
if this rule changed. Three tests pin it (the Cold Blood test in
`test/assassination-procs-as-data.test.js`, and the front-block cases in
`test/carry-overs-103.test.js`); with the rule changed to spend the charge on
every outcome, those fail and the seven golden fixtures do not. If real Classic
spends the charge on a miss or a block, change the condition where
`resolveAttack` (`js/simulation.js`) calls `consumeUseCharges`, and the tests
that pin it.

**The Cold Blood rotation rule.** A rule from the Scout, for James to adjust:
cast Cold Blood right before the next 5-combo-point Eviscerate, when it is off
cooldown. Since R3 (#140) it is a rule of the rotation data
(`js/rotation-default.js`, [Rotation as data](rotation.md)), which the
interpreter walks; before that it was `beforeFinisher` in
`js/rotation-rules.js`, called with the finisher the code had chosen. It reads one constants row, `rotation.coldBlood`
(`{ ability: "coldBlood", beforeFinisher: "eviscerate" }`, ability keys), and
applies only when the build granted the ability, so a fight without the talent
is the fight it was. The rest of the rotation is unchanged. To change it: edit
the row to move it to another finisher; change the rule's conditions for another
condition (for example, hold it for a Rupture or a proc); or remove the rule to
stop casting it. Cold Blood does not make the Eviscerate go
next: when the rogue cannot afford it yet, the charge waits for the energy
(median 2.5 s, max 6.5 s over 400 default casts, Kira's measurement) and
sometimes lands on a Sinister Strike instead (21 of 400 charges). The cooldown
starts at the cast either way. Note that the default rotation reaches Eviscerate rarely
without the talents (it refreshes Slice and Dice at every 5 points while that
has 10 s or less left): in the reference build it casts about 8 Eviscerates
and 2 Cold Bloods in 300 s.

**Rogue option `abilities`.** `new Rogue(config, { modifiers, procs, abilities })`:
`abilities` is an array of ability catalogue ids the build grants (a `TypeError`
for anything else, a `RangeError` for an id the catalogue does not know). The
rogue keeps it as `granted`. The engine's own abilities are all defined; the
option gates only rules that wait for a grant, today Cold Blood's.

**Shape.** `runFight` and its result are unchanged, `SimConfig` has no new
field, and the golden fixtures are byte-identical. New: `data/talent-effects.js`,
`js/talent-build.js` and `expandTalents`; D8a PR 1 adds the `duration` modifier
kind and three entries; PR 2 adds three entries, the Cold Blood ability and
aura, `consumeUseCharges`, `js/rotation-rules.js` (replaced by the rotation data in R3), the Rogue option `abilities`
and the crit suppression order above, and no `runFight` or `SimConfig` change. `PROC_TABLES` is now derived from the
data (its keys are in the catalogue's order, so `procsFromTalents` lists
Puncturing Wounds before Hack and Slash).

## Applying a talent build (D7, issue #106)

`config.talents` is applied by the engine. `new Rogue(config)` (so `runFight` and
`createFight`) calls `applyBuild(config.talents)` in `js/talent-build.js`, and the
build's `modifiers`, `procs` and granted `abilities` are put in front of the
host's own `options.modifiers`, `options.procs` and `options.abilities`, which
still add to them. `createFight` returns the applied build as `fight.build`
(`selected`, `points`, `modifiers`, `procs`, `abilities`, `noDps`, `unmapped`),
which is where a host reads the talents that did nothing. `runFight`'s result is
unchanged.

**No build, and a build.** A map with no rank above 0 (or none) is no build. It is
legal, it changes nothing, it draws no random number, and the rotation is the
default one (Blade Flurry and Adrenaline Rush cast without a talent, as before
D7), so the goldens and the older tests are byte-identical. Any rank above 0 makes it a
selected build, and `validateBuild(ranks)` must pass. A selected build that fails
is a `RangeError` from `runFight`, `createFight` and `new Rogue`, listing every
problem and naming talents by id:

- at most `k("talents.maxPoints")` (51) points. Fewer is legal (a partial
  build, #190): 0, 1, 31 or 50 points run as long as the rules below hold;
- at most `level - (k("talents.firstPointLevel") - 1)` points, where the level
  is the talent level (`config.talentLevel`, 10 to 60, default 60, so 51
  points). A level `L` character has one point a level from level 10, `L - 9`
  in all (the Classic rule; the export does not state it, so the constant is
  tagged `ASSUMPTION`). At level 40, 31 points pass and 32 fail. The level
  caps the points and nothing else;
- a talent with a `req` needs that talent at its full rank (the Classic rule; it
  needs no constant);
- a talent on row `r` of a tree needs `k("talents.rowGating")` times `r - 1`
  points spent on the rows above it in the same tree. The 5 points a row is the
  Classic rule; the export does not state it, and James confirmed on 29 Oct 2026
  that WoW Forever matches Classic, so the constant is tagged `wowf-designer` and
  open question 14 is resolved.

A partial map such as `{ "combat.precision": 3 }` is a valid SimConfig
(`normalizeConfig` checks ids, ranks and the level cap) and an illegal fight.
For example: `Talent build is not valid: the build spends 52 talent points, and
at most 51 can be spent (talents.maxPoints); "combat.dual-wield-specialization"
needs its prerequisite "combat.precision" at rank 3, and it is at rank 2`.
Rank and id errors (an unknown id, a display name, a rank above `max`) come first,
as from `expandTalents`. Before #190 the first part read "and exactly 51 are
needed"; the prerequisite, row and rank texts did not change.

**The per-talent model** (#190, for the U6 picker). Beside the throwing
`validateBuild(ranks, catalogue, { level })` (it returns the points spent, 0
for an empty map), `js/talent-build.js` has calls that never throw, whatever
they are given; each takes `{ level }` (default 60) and the catalogue last:

- `buildProblems(ranks, { level })`: a frozen list of frozen
  `{ code, talent, need, have, message }`, empty for a legal build. The codes
  are `notAnObject` (alone), `unknownTalent`, `badRank`, `badLevel`, `overMax`
  (more than 51), `overLevel` (more than `level - 9`), `prerequisite` and
  `rowGate`. `talent` is the id at fault or `null`; `need` and `have` are the
  numbers the message names (the cap and the points, the prerequisite's full
  rank and its rank, the points the row needs and has). `validateBuild` throws
  these messages, in order, joined by "; ".
- `why(ranks, id, action = "add", { level })`: `null` when the step is legal,
  or one problem as above with `blockers`, the ids in the way. An add can be
  `maxRank`, `capReached`, `prerequisite` (blockers: the prerequisite) or
  `rowGate`; a remove can be `notTaken` or `strands`, when taking the point
  would leave a talent below without its prerequisite or its row gate (the
  `talent` is the first one stranded, `blockers` all of them; only problems the
  remove creates count). `badAction`, `unknownTalent`, `notAnObject`,
  `badRank` and `badLevel` answer bad input.
- `canAdd(ranks, id, { level })` and `canRemove(...)`: `why(...) === null`.
- `pointsByTree(ranks)`: `{ assassination, combat, subtlety, total }`, counting
  only valid ranks of known talents.
- `talentPointCap(level)` (a `RangeError` for a level outside 10 to 60) and
  `talentLevelRange()`, `{ min: 10, max: 60 }`; `DEFAULT_TALENT_LEVEL` is 60.

`applyBuild(ranks, effects, catalogue, { level })` passes the level on; the
`Rogue` passes none, and `normalizeConfig` has already checked the config's
level cap. A partial build is still a selected build (`build.selected` is
true), so a partial build without Blade Flurry or Adrenaline Rush locks them
(`lockedByBuild`), and the default rotation and the presets fall through to
the next rule. `decodeBuildLink` already decodes a partial talentsforever link
and its level. The build label (`js/build-label.js`) adds the points out of the
cap to every build, "Combat 0/5/0 · 5/51", and the level below 60, "Combat
0/31/0 · level 40 · 31/31" (#204, Fran's U6 spec D17).

**Gating the granted abilities.** An ability a talent grants
(`talentGrantedAbilities`, read from the `ability` fields of
`data/talent-effects.js`: Cold Blood, Blade Flurry, Adrenaline Rush, Ghostly
Strike, Premeditation and Hemorrhage) is cast only when the build has that
talent. With no talents picked the fight is untalented (#199): the rotation
skips every ability a talent grants. A host that passes the ability in
`options.abilities` still grants it to a build that lacks the talent.
`Rogue.lockedByBuild(ability)` is the test the rotation makes.

**Weapons.** The build never changes `config.weapons`: the weapons are the
character's and the build only reads them. Hack and Slash's crit bonus is
scoped to daggers and fists, its armor ignore to maces, and its extra attack to
swords and axes (`k("hackAndSlash.extraAttack")`), with the weapon type on the
attack context. So the sword/sword reference build gets the extra attack and no
crit bonus, and a dagger config gets the crit and no extra attack. The weapon
default is the config's (sword), and the build decides only whether the talent
is on. Backstab's dagger requirement was parsed and not enforced when #106 landed; #142
enforces it ("Backstab needs a dagger").

**Backstab needs a dagger** (#142, carried over from #108). The Backstab row in
`js/ability-data.js` has `requiresMainHand: "dagger"`. `Ability.canCast` is
false for it, and `Ability.cast` returns `null`, when `rogue.weapons.mainHand.type`
is anything else: no cast is told, no energy is spent, no cooldown or GCD starts
and no number is drawn, so it is a failed cast like one without the energy. The
interpreter's host answers "cannot be cast" for it, and also "not usable"
(`host.usable`, #155): the main hand is fixed for the fight, so no wait can make
it castable, and the interpreter passes over a Backstab rule on a sword as if
its conditions had failed. A Backstab rule above Sinister Strike falls through
to Sinister Strike with a sword. Before #155 the rule held, could not be cast
and ended the walk every time, so the rotation pooled forever. With a dagger and
too little energy it still pools as before. The placeholder rotation and the
presets do not cast Backstab, so no default fight moves. Ambush and Mutilate list a dagger
requirement in the catalogue and are not enforced, and neither are the
stealth and behind requirements.

**Poison damage.** Modifiers apply to Instant Poison and Deadly Poison ticks
through their ability context, with the scopes the talent data gives. Malice
(`critChance`, every attack) reaches Instant Poison's crit and Deadly Poison's
tick crit. Lethality (`critDamage`, Sinister Strike, Backstab and the like),
Aggression and Improved Eviscerate (`damage`, scoped to their abilities) do not.
Vile Poisons, Improved Poisons and Venom have no entry in the talent data, so a
build with points in them lists them under `fight.build.unmapped` and they change
nothing. They are out of scope for Phase 2 (tracker #108).

**Shape.** `runFight` and its result are unchanged, and `SimConfig` had no new
field until #190 added `talentLevel`. New exports: `validateBuild`, `applyBuild`, `talentGrantedAbilities`
(`js/talent-build.js`; `js/fight.js` re-exports `validateBuild` and `applyBuild`),
`Rogue.build` and `Rogue.lockedByBuild`, and `createFight(...).build`.

## Run controller (P3-1, issue #136)

`SimRunner` (`js/sim-runner.js`) owns one fight and a state:
`idle`, `running`, `paused`, `finished`. It has no DOM and reads no clock; the
host (the page, a test, a script) supplies time through `advance(seconds)` or an
injected `driver` object (`{ start(advance), stop() }`).

| Action   | From                | To        |
| -------- | ------------------- | --------- |
| `run`    | `idle`, `finished`  | `running` |
| `pause`  | `running`           | `paused`  |
| `resume` | `paused`            | `running` |
| `stop`   | `running`, `paused` | `idle`    |
| `reset`  | any state           | `idle`    |

An action from any other state throws an `Error` naming the action, the state
and the states that allow it. The state does not change. Reaching the fight
length (the `duration` option, default `batch.duration`) moves `running` to
`finished` and sets `result`, in the shape `runFight` returns. `advance` is not
a transition; it does nothing unless the state is `running`.

`run` builds a fresh fight from the stored seed and SimConfig (`createFight`), so
`stop` then `run` reproduces the same fight: the same totals, log and rng draws.
Pause and resume only stop time from passing. A fight advanced in any chunk
sizes, with or without pauses, equals `runFight` for the same seed, duration and
config. The interface says nothing about how the engine moves through time (no
step or frame events, no pause by frame), so the engine core can change behind it
(Phase 3.5).

`SimRunner.on(type, handler)` and `onError(handler)` hand the host the fight's
events ([Events](events.md)), and `onStateChange` handlers follow the same
rules: delivery is queued and in order when a handler calls the runner, and a
handler that throws goes to `onError` without costing the driver its start or
stop.

**Shape.** `runFight`'s result and `SimConfig` are unchanged. `js/fight.js`
gains the export `fightResult(fight)`, the code `runFight` already used to build
its result.

`SimRunner.fight` (#153) is the one engine handle: `{ rogue, simulation }`
while `running` or `paused`, and null when `idle` or `finished` (a new fight on
every `run`). It is read-only by contract. Only the wrapper is frozen: each read
returns a new frozen `{ rogue, simulation }`, and the `rogue` and `simulation`
in it are the live engine objects, which nothing freezes (freezing them would
freeze the running fight). The live page's feed (`js/live-feed.js`) reads the
energy, GCD, aura and cooldown timers from it and subscribes to its
simulation's events. A caller reads it and never writes to it or steps it: time
goes through `advance`.

`SimRunner.result` (#158) is the same object on every read, not a copy: the
runner keeps the one `fightResult` built when the fight finished and hands it
back each time. Nothing about it is frozen. Like `fight`'s `rogue` and
`simulation`, it is live and read-only by contract.
A caller that wrote to it would change what every later read of `result`
returns, until the next `run` sets it to null and a later finish builds a new
one. Read it; to change a result, change your own copy (`structuredClone`).

**`advance(seconds)` on the event core (#198, #234).** Each `run` opens the
event core once for the whole fight (`openCore`, `js/core/fight.js`), and
`advance(seconds)` runs it on to the time given. There is no step and no
carry, so the call that brings the given time to `duration` finishes the
fight (600 calls of `1 / 60` finish a 10 s fight on the 600th), and any split
of the time is the same fight as one call. Time given after the end is
dropped. The runner keeps the given time as a compensated sum, so the time
reached is the given seconds' sum correctly rounded (200 calls of `0.01`
reach exactly 2 s).

- `advance(duration)` as the first call of a run, or `advance(Infinity)`, runs
  the whole fight in one call and returns `"finished"`.
- The core runs one event time at a time, so a `pause` or `stop` from an event
  handler takes effect after the events at that time, and the rest of the given
  time is kept for `resume`.
- Between calls `fight`'s `rogue` and `simulation` read the fight at the time
  reached: energy, the GCD, auras and cooldowns move with the time alone, with
  no step to round them to.
- A fight of no length handles no events (#199).
- A run to the end equals `runFight` for any split of the time. A host loops
  until the state is `"finished"` and does not count seconds.

Before #234 the runner also took `engine: "legacy"`, which paid whole fixed
steps out of a carry of the given time (#158); #234 removed it with the
`engine` option of `SimRunner`, `runFight`, `createFight` and
`createLiveRun`. The result never recorded the engine, and its shape is
unchanged. An `engine` key, like any option a function does not take, is a
`RangeError` in `runFight`, `SimRunner`, `BatchRunner`, `new Simulation` and
`createLiveRun`'s `run` and `clear` (#236 QA); `createFight`'s options give
"Unknown Rogue option". `new Simulation`, `run` and `clear` read only the
options an object has of its own, as `runFight` does (#209): one it inherits
is not given. `new Simulation(rogue)` with no options is the defaults, but
null, an array or a value that is not an object is a `RangeError` ("Simulation
needs an options object"), and so is a built-in such as a `Map` or a
`WeakMap`, whose contents are not options (#248 QA); `run` and `clear` need a seed, so they take no
less than an options object and refuse undefined too (#238 QA).

`createLiveRun`'s `run({ seed, duration, config })` gives the runner one
`advance` per frame of its own seconds (`FrameClock.seconds`, at most
`k("sim.maxFrameTime")`, 0 for the first frame and the first after a resume).
The page (`js/main.js`), the batch Worker, `BatchRunner` and `runBatch` all
run on the event core.

## Aura uptime (S3, issue #146)

`js/fight-metrics.js` says how long each aura was up in a fight, and the same
over a batch. It is read from the event stream ([Events](events.md)): the
`aura` events (applied, refreshed, stacked, ran out, each with its `time`) and
the `end` event (the fight is over, at the fight duration). It reads no engine
state and names no step or frame, so it works on a `SimRunner`, a `Simulation`,
a recorded array of events or the Phase 3.5 engine, as long as the events are
the same. The one thing it reads besides events is each aura's `maxStacks` from
the aura definitions (`js/auras.js`), which is data, for the full-stack uptime.
It has no DOM, reads no clock and draws no randomness, and subscribing it
changes no fight.

```js
import { FightAuras } from "./js/fight-metrics.js";

const auras = new FightAuras();
const off = auras.attach(runner); // before run(), so no event is missed
runner.run();
runner.advance(Infinity);
auras.summary(); // { duration, ended, rows }, readable mid-fight too
off(); // unsubscribe
```

`attach(source)` takes anything with `on(type, handler)` that returns an
unsubscribe function. `observe(event)` reads one event by hand; other types only
move its clock, so a `"*"` subscription works too. `aurasFromEvents(events)` is
the same summary for events already in hand. `new FightAuras({ maxStacks })`
takes an object of aura id to stack limit for auras the definitions do not have.
One `FightAuras` reads one fight: an event after `end`, or one earlier than the
last it read, is a `RangeError`.

A batch: `runBatch(...)` and `BatchRunner#result` carry it as `result.auras`
([batch.md](batch.md)). By hand, `BatchAuras#add(summary)` takes one fight's
summary at a time, in fight order, and `summary()` gives the batch.

### Definitions

An aura is **up** from an `apply` event to the next `expire` event of the same
aura id on the same side (`target` of the event: `self` a buff, `target` a
debuff). A `refresh` or a `stack` keeps it up; a `stack` (and any up event)
sets the stacks to the event's `stacks`. All times are the events' `time`, in
fight seconds.

| Metric              | Definition                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| `duration`          | The `end` event's time. Before the end, the time of the latest event read.             |
| `uptime`            | Seconds up. An aura still up at `duration` is counted up to it (clipped to the fight). |
| `uptimeFraction`    | `uptime / duration`, `0` for a fight of no length.                                     |
| `applications`      | `apply` events: the times it went up from down.                                        |
| `refreshes`         | `refresh` and `stack` events: the times it was applied again while up.                 |
| `stackSeconds`      | Stacks times seconds, over the fight (stacking auras only).                            |
| `meanStacks`        | `stackSeconds / uptime`: the mean stacks while up, `null` if never up.                 |
| `fullStackUptime`   | Seconds at `maxStacks` (Deadly Poison: `k("poison.deadly").stacks`).                   |
| `fullStackFraction` | `fullStackUptime / duration`.                                                          |

A row's `stacks` is `null` for an aura of one stack (`maxStacks` 1, or an aura the
definitions do not know: `maxStacks` `null`), else `{ stackSeconds, meanStacks,
fullStackUptime, fullStackFraction }`. Rows are sorted by id, then side, in
code-point order. The display name is a label from the first event.

**Over a batch** (`BatchAuras#summary()`, `{ fights, duration, rows }`): counts
and seconds are summed in fight order with compensated sums; `duration` is the
fights' summed duration. `uptimeFraction`, `meanStacks` and `fullStackFraction`
are pooled (summed seconds over summed seconds), not means of each fight's.
`perFight.uptimeFraction` (and `perFight.fullStackFraction` for a stacking
aura) is a `RunningStats` summary over every fight, the mean and range of one
fight; a fight without the row counts as `0`, including the fights before the row
first appeared. Fights are added in iteration order, so the result does not
depend on how the batch was sliced.

### What it reports, and what it does not

- **Slice and Dice, Adrenaline Rush, Blade Flurry** (`self`) and **Deadly
  Poison** (`target`, stacking to `k("poison.deadly").stacks`) each have a row
  once applied. An aura never applied in a fight has no row in that fight.
- **Instant Poison: n/a.** It has no row. The weapon coating is not modelled as
  an aura: the engine sends no `aura` event for it, only the `hit` events of its
  procs, which the per-ability breakdown ([breakdown.md](breakdown.md)) counts.
  Only Deadly Poison's debuff on the target is an aura.
- **Cold Blood** gets a generic row like any other aura. Its definition has an
  hour's duration (`k("coldBlood").duration`, longer than any fight) and one
  charge, so it runs out with `reason: "charges"` when the next listed ability
  lands; its uptime is the time from the cast to that hit.
- **Stamping.** The event core stamps an `expire` event with the aura's exact
  end ([Events](events.md#the-contract-has-no-step-and-no-frame)), so the
  uptime is exact. (The fixed-step engine, removed in #234, stamped the end of
  the step, up to 1/64 s late.) `test/fight-metrics.test.js` samples a real
  fight and checks that the uptimes, stack-seconds and full-stack time agree
  with the engine's own `activeBuffs` and `activeDebuffs`, to a sample per
  change.

Energy-capped time and combo point waste (the rest of #146) are not observable
from the per-change events (energy regeneration is not reported, and a gain lost
at the cap moves nothing, so it sends no event). They are counted by the pools
and carried by the `end` event: see [Resource waste](#resource-waste-issue-146).

**Shape.** `runFight`'s result, `SimConfig` and the rotation JSON are unchanged.
The batch result gains `auras` ([batch.md](batch.md)). New module
`js/fight-metrics.js`: `FightAuras`, `aurasFromEvents`, `BatchAuras`. No
constants change.

## Resource waste (issue #146)

How much energy and how many combo points a fight lost to the cap. Neither can
be read from the per-change events: regeneration sends none, and a gain that
the cap stops moves nothing, so it sends none either. So each pool counts it
exactly as the fight runs (energy's `EnergyPool`, `js/core/energy.js`, during
a core run, and a `Resource`, `js/resource.js`, for combo points and between
runs), and the `end` event
carries the counts as `resources` ([Events](events.md#end)). The counters draw
no randomness and send no event: every fight, result and golden is the same
as before.

### What the pool counts

| Counter      | Definition                                                                                                                                                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cappedTime` | Seconds of regeneration spent at the cap. For each piece of the energy line (from one re-base to the next), the time from the moment the line reaches the cap, `t0 + (cap - value0) / rate`, or from the piece's start if it began at the cap, to the piece's end. A pool with no regeneration counts no time. |
| `overflow`   | What the cap took. `gain(amount)` adds `amount - added`; regeneration adds `rate` times the piece's capped time.                                                                                                                                                                                               |

- The opening seconds count: energy starts full (`start.state`), so any time
  before the first spend is at the cap. The default rotation spends at its
  first decision, at 0, so it starts with none.
- Energy is exact at any time on the event core, and a regen rate changes only
  at an event (Adrenaline Rush applying or running out) and starts a new piece,
  so the counts are exact for the engine's own energy.
  `test/fight-metrics.test.js` samples real fights and checks that
  `cappedTime` lies between the bounds the samples give. (On the fixed-step
  engine, removed in #234, a step regenerated first and the rotation spent
  after, sliced where Adrenaline Rush ran out.)
- A pool above a cap that fell (the max went down) is at the cap: its
  regeneration time counts and its regeneration is overflow, but the excess
  above the new cap is not (the engine's clamp removes it, and it was never
  gained against the cap).
- A miss refund (`skill.missEnergyRefund` of the cost, `js/ability.js`) that
  the cap stops is overflow, like any gain.
- A spend, a timed gift running out (Premeditation) and a target change
  clearing combo points are never overflow.
- Combo points do not regenerate, so their `cappedTime` is always 0; their
  `overflow` is the points a builder, a crit bonus or a proc could not add at
  `k("combo.max")`.

### The summary (`FightResources`, `BatchResources`)

`js/fight-metrics.js` reads the `end` event, like the aura uptimes:

```js
import { FightResources } from "./js/fight-metrics.js";

const resources = new FightResources();
resources.attach(runner); // subscribes to "end"
runner.run();
runner.advance(Infinity);
resources.summary();
```

| Metric                 | Definition                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duration`             | The `end` event's time, the fight duration.                                                                                                         |
| `energyCappedTime`     | `resources.energy.cappedTime`, seconds.                                                                                                             |
| `energyCappedFraction` | `energyCappedTime / duration`, `0` for a fight of no length.                                                                                        |
| `energyOverflow`       | `resources.energy.overflow`: energy points lost to the cap.                                                                                         |
| `comboPointWaste`      | `resources.comboPoints.overflow`: combo points a gain lost to the cap. Points lost to Premeditation running out or a target change are not counted. |

Before the `end` event every value is `null` and `ended` is `false`. A pool the
event does not carry counts as 0. One `FightResources` reads one fight.

**Over a batch** (`BatchResources#summary()`): `fights`, `duration`,
`energyCappedTime`, `energyOverflow` and `comboPointWaste` are summed in fight
order with compensated sums; `energyCappedFraction` is pooled (summed capped
time over summed duration). `perFight.energyCappedFraction` and
`perFight.comboPointWaste` are `RunningStats` summaries over the fights. The batch
result carries it as `resources`, after `auras` ([batch.md](batch.md)); it does
not depend on how the batch was sliced.

**Shape.** `runFight`'s result, `SimConfig` and the rotation JSON are unchanged.
The `end` event gains `resources` (additive). The batch result gains
`resources`. `Resource` gains `cappedTime`, `overflow` and `waste()`;
`Simulation` gains `resourceWaste()`; `js/fight-metrics.js` gains
`FightResources` and `BatchResources`. No constants change.
