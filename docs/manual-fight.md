# Manual fight B1 (#348)

`createManualFight({ seed, duration, config })` in `js/manual-fight.js` runs one
fight whose casts are the caller's. It uses the same `createFight` validation,
the one seeded rng, and the same opening auras as `runFight`. The scripted
rotation is not asked. `js/fight.js` re-exports `createManualFight` and
`blockedText`.

## Loop

`openCore(sim, duration, { decide })` runs the queued action inside a decision
event, so a cast's GCD, cooldown and aura timers start at that time. With no
`decide`, a scripted run is unchanged.

An on-GCD cast stays at its own instant. An off-GCD cast is allowed at that
same instant, within `sim.tickEpsilon`, which is the scripted rotation's
re-ask (Preparation, then Premeditation). James, 11 Nov 2026 ruling:
it is refused later inside that GCD with `GCD, {time} left`, and nothing is
spent. The only caller that can leave the clock inside the held GCD is
`advanceTo` (a test helper); `getState`, `wait`, and the next on-GCD `cast`
run out to the GCD end first. A GCD remainder within `sim.tickEpsilon` is
already clear, so that advance does not move the clock by a rounding ulp. `getState` runs a held GCD out to its end and returns the state at that
decision. `peekState()` returns the same shape at the current instant and
does not move the clock, draw from the rng, process events, or change the
fight. While the GCD is held, an on-GCD slot is not castable. An off-GCD
slot is castable at the opening instant, within `sim.tickEpsilon`, and not
later inside that GCD (James, 11 Nov 2026 ruling). `getState().over`
is true once time has reached the duration, so the board does not offer a
decision at the end (Q3). A `cast`
that is already requested at that instant still runs, matching the scripted
decision at the fight's end, and `result()` closes the fight.

## Board arming

James, 12 Nov 2026 ruling, replacing the 11 Nov same-instant hold: when you
press a skill it should always trigger the GCD. If you press Sinister Strike
you should not then be able to press something that is off the GCD. If you
select a skill that is off the GCD, the board highlights (arms) it, so you
can then press a skill that requires the GCD, or highlight it and press Wait
which casts the armed skill.

Pressing a ready off-GCD ability arms it instead of casting. Pressing it
again un-arms it. Several can be armed at once, and the pick order is kept.
Only abilities that are ready right now (`peekState` / `getState`
`castable`) can be armed. Preparation is on the GCD, so it cannot be armed.
Premeditation then Preparation then Premeditation is no longer possible from
the board; arming Premeditation and then pressing Preparation still lands
both at the same instant.

Pressing an on-GCD ability first casts the armed off-GCD abilities at the
current instant in pick order, then casts the on-GCD ability (for example
Cold Blood then Eviscerate), then clears the armed set. Pressing a Wait
first casts the armed abilities, then does the chosen Wait. If an armed
ability is not castable when it fires, the board skips it and announces the
reason. The board uses `peekState()` between those armed casts so it does
not run a GCD out. After a successful on-GCD cast or a Wait, `getState()`
runs the clock as usual.

The same number keys toggle the highlight. W still focuses the first Wait.
Armed slots use an accent outline and inset fill, an "Armed" note, and
`aria-pressed`.

The armed set is cleared on Start, Replay, Stop, Reset, and Back to Fight,
and after an on-GCD ability or a Wait fires, whether each armed ability
succeeded. If a published `peekState()` shows an armed ability is no longer
ready (for example it went on cooldown, or energy changed), it is dropped
from the set.

A direct `host.cast` of an off-GCD ability that is on cooldown records a
Blocked entry. That path is API only; it comes from Kira's #369 N1.

## API

```js
const m = createManualFight({ seed, duration, config });
m.slots;
m.getState();
m.peekState(); // same shape, does not run out a held GCD
m.cast(abilityId); // { ok, reason, stopReason, advancedBy, events }
m.wait({ kind: "energy" } | { kind: "cooldown" } | { kind: "time" });
m.isOver();
m.result(); // fightResult shape, plus manual.inputs
m.replay();
m.dispose();
m.advanceTo(t); // test helper, not part of the board
```

`reason` is null when `ok` is true. A refusal spends nothing, draws no rng,
does not move the clock, and returns `events: []`. `blockedText(reason)` is
the same string the engine returns.

`wait` returns `stopReason` of `{ code, text, abilityId? }` when it runs:
`target` ("Reached the wait"), `early` ("Stopped early: {ability} is ready"),
or `fight-end` ("Fight ended before the wait finished"). When the early stop
and the wait's own target fall at the same instant, the code is `target`
(Scout, 11 Nov 2026). `reason` is only set when the wait is refused.
`stopReason` is null on a cast and on a refused wait.

### slots

`[{ abilityId, name, iconKey, icon, cost, costResource, isFinisher, onGcd }]`,
frozen, for every ability `rotationHost.usable` allows. Order is builders,
finishers, cooldowns, racials (`js/manual-fight.js`). `iconKey` is null when
the snapshot has no icon. `onGcd` is false for Premeditation, Cold Blood and
the racials. Preparation is on the GCD.

### getState()

`{ seed, duration, time, remaining, over, dps, energy, comboPoints, gcd,
buffs, debuffs, slots, waits, waitCooldownTarget, decision }`. `slots` repeats
the bar with `castable`, `reason`, `cost` and `cooldownRemaining`. `waits` is
energy (target 40), cooldown (the soonest end; a tie follows slot order), and
time (0.5 s). Each row has `available` and `reason`. There is no `totalDamage`.

### Events

Each call returns the mapped stream events from that call, in stream order.
`{ t, kind, abilityId, source, amount, outcome, name?, procName? }`. A `hit`,
`cast` and `aura` carry `name`, taken from the stream event when it has one,
otherwise from the ability or aura definition. The name is omitted only when
neither has one. See [events.md](events.md).

### Refusals

`canCast`'s order: level, build, main hand, off hand, aura, GCD, cooldown,
combo points, energy. The strings are "Not available at this level", "Not
granted by this build", "Needs a dagger in the main hand", "Needs daggers in
both hands", "Needs Ambush window", "GCD, {time} left", "On cooldown, {time}
left", "Needs combo points", "Not enough energy", "Already at 40+ energy",
"Nothing on cooldown", "The fight is over". `{time}` is floored tenths:
`12.4 s` under 60 s, and `MM:SS.s` from 60 s.

A cast during a GCD that the clock has not already left is refused. A wait
whose target is past the end still runs, stops at the end, and returns
`ok: true` with `stopReason.code` `fight-end`.

## Rulings

- James, 11 Nov 2026, Q1: after an on-GCD cast the next decision is at the
  GCD end. An off-GCD cast does not start a GCD.
- James, 11 Nov 2026, Q2: a wait also stops at the first strictly earlier
  moment an ability that was not castable becomes castable.
- Scout, 11 Nov 2026: Q3 through Q11, the wait targets, and the same-instant
  tie (`target`, not `early`).
- James, 12 Nov 2026: the board arms ready off-GCD abilities and fires them
  at the current instant when an on-GCD ability or a Wait is pressed,
  replacing the 11 Nov same-instant hold.
