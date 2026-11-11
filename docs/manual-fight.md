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

An on-GCD cast stays at its own instant. An off-GCD cast made before the next
read can follow it there, which is the scripted rotation's same-instant
re-ask (Preparation, then Premeditation). The clock then runs to the end of
that GCD on the next `getState`, `wait`, or on-GCD `cast`. A GCD remainder
within `sim.tickEpsilon` is already clear, so that advance does not move the
clock by a rounding ulp. `getState().over` is true once time has reached the
duration, so the board does not offer a decision at the end (Q3). A `cast`
that is already requested at that instant still runs, matching the scripted
decision at the fight's end, and `result()` closes the fight.

## API

```js
const m = createManualFight({ seed, duration, config });
m.slots;
m.getState();
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
