# Event stream (P3-2, issue #137)

A fight reports what happens in it as **events**: plain data, frozen, with no
reference to the engine. `Simulation` and `SimRunner` both have

```js
const off = sim.on("hit", (event, type) => { ... }); // one type
sim.on("*", handler);                                  // every type
off();                                                 // unsubscribe
sim.onError(({ error, type, event }) => { ... });      // see Errors
```

`sim.on` is `Simulation.on` (`js/simulation.js`) and `SimRunner.on`
(`js/sim-runner.js`). On a runner a subscription made once stays for every
run. An unknown type is a `RangeError`; a handler that is not a function is a
`TypeError`. Delivery is in `js/event-stream.js`.

## The contract has no step and no frame

Every event says what happened and when, in fight seconds (`time`). No event
and no field names a step or a frame, and none exists per step. Phase 3.5
replaces the engine core ([phase-3.5-engine-rewrite.md](phase-3.5-engine-rewrite.md))
behind this same interface: it may add event types and fields, never rename or
remove one. `test/sim-events.test.js` and `test/event-stream.test.js` read
events and results only, and have to pass unchanged on the new core.

Two things follow from that. `time` on a fixed-step core is the time at the end
of the move that caused the event, so an aura that ran out between two moves
has the later time; an event-queue core gives the exact time. And continuous
change is not an event: energy regeneration is not reported (a `resource` event
for it every move would be the engine's step in disguise). A reader that wants
the energy now reads it; a `resource` event always carries `before` and `after`,
so it is absolute.

## Events

Every event has `type` and `time` (fight seconds) first, then the fields below,
in this order.

### `cast`

An ability was used: it passed its checks (cooldown, cost, the GCD) and is about
to be paid for. It comes before the `resource` and `hit` events the cast causes.

| field      | meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `ability`  | ability id                                                        |
| `name`     | display name                                                      |
| `icon`     | icon path, or `null`                                              |
| `resource` | id of the resource it pays (`"energy"`), or `null` for a free one |
| `cost`     | what it paid, after cost modifiers. `0` for a free one            |
| `onGcd`    | `true` if it started the global cooldown                          |

### `hit`

One result on the target: a swing, an attack, a poison, or a DoT tick, a miss
included.

| field     | meaning                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | the combat log row id, counted up from 0 per fight                                                                                           |
| `ability` | id of the ability, weapon hand or proc that made it (`null` only if a caller of `addCombatEvent` gave none)                                  |
| `name`    | display name                                                                                                                                 |
| `icon`    | icon path, or `null`                                                                                                                         |
| `origin`  | `"white"` (weapon swing), `"yellow"` (ability), `"poison"` (damage or DoT application a proc deals; today the poisons), `"dot"` (a DoT tick) |
| `attack`  | `"weapon"` or `"skill"`, the attack type                                                                                                     |
| `outcome` | `"hit"`, `"crit"`, `"glancing"`, `"miss"`, `"dodge"`, `"parry"`, `"block"`, or `"cast"`                                                      |
| `status`  | the log's label for it (`"Hit"`, `"Crit"`, `"Glancing"`, `"Miss"`, `"Resist"`, `"Cast"`, ...)                                                |
| `damage`  | damage dealt after armor. `0` for a miss and for a DoT application                                                                           |

A DoT's application is a `hit` with `damage: 0`; each tick is a `hit` with
`origin: "dot"`. An ability that makes no attack roll (Slice and Dice, Adrenaline
Rush) gives one `hit` with `outcome: "cast"` and `damage: 0`, because the combat
log has always shown it. **The `damage` of all `hit` events adds up to
`totalDamage`.**

### `resource`

A resource changed by a discrete action. It is sent only when the value moved.

| field      | meaning                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `resource` | `"energy"` or `"comboPoints"`                                                                             |
| `change`   | `"gain"`, `"spend"`, `"expire"` (points a timed gift gave ran out), `"clear"` (a new target cleared them) |
| `before`   | the value before                                                                                          |
| `after`    | the value after                                                                                           |
| `source`   | id of the ability or proc that caused it, or `null`                                                       |

Not reported: regeneration, and the correction of a pool above a lowered cap.

### `aura`

| field      | meaning                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `aura`     | aura id                                                                                                           |
| `name`     | display name                                                                                                      |
| `target`   | `"self"` (a buff) or `"target"` (a debuff)                                                                        |
| `change`   | `"apply"` (it was not up), `"refresh"` (up again, same stacks), `"stack"` (up again with more stacks), `"expire"` |
| `stacks`   | stacks after the change (`1` for an aura without stacks)                                                          |
| `duration` | seconds left after the change (at most `0` for an `"expire"`)                                                     |
| `charges`  | charges left, or `null` for an aura without charges                                                               |
| `source`   | id of the ability or proc that applied it. `null` for an `"expire"`                                               |
| `reason`   | for an `"expire"`: `"time"` or `"charges"` (the last charge was used). Else `null`                                |

### `proc`

A proc fired (its chance roll succeeded). Its actions' own events follow.

| field     | meaning                                                  |
| --------- | -------------------------------------------------------- |
| `proc`    | proc id                                                  |
| `trigger` | the trigger it fired on (`"onHit"`, `"onWhiteHit"`, ...) |
| `ability` | id of the ability or swing that triggered it             |

### `end`

The fight is over. Sent once, last, by `runFight` and by `SimRunner` (before it
moves to `finished`), at the fight duration.

| field         | meaning                                          |
| ------------- | ------------------------------------------------ |
| `totalDamage` | the fight's total damage                         |
| `dps`         | `totalDamage / time`, 0 for a fight of no length |

`time` is the fight duration. `Simulation.end()` sends it, once; a host that
drives a `Simulation` itself calls it.

## Delivery rules

These are what `test/event-stream.test.js` pins.

- **Order.** Events reach every handler in the order they were emitted. A
  handler that makes the stream emit (it calls `run()`, `pause()` or `stop()` on
  a runner) does not start a nested delivery. The new event waits until the
  current one has reached all its handlers. So no handler sees events out of
  order. The runner's `state` is always the live one: a handler told
  `running → paused` may already find it `running` again.
- **Subscribing.** One event goes to the type's handlers and the wildcard ones in
  the order they subscribed. A handler added during delivery gets the next
  event. A handler removed during delivery gets nothing more, not even the event
  in hand.
- **Errors.** A handler that throws cannot stop the other handlers, the fight,
  or (on a runner) the driver start or stop of a state change. The error goes to
  the `onError` handlers as `{ error, type, event }`. A runner's `onError` hears
  state-handler errors (`type: "state"`, `event: { from, to }`) and event-handler
  errors alike. With no `onError` handler the error is rethrown from a microtask:
  never silent, and it cannot change the fight. An error handler that throws is
  rethrown the same way.
- **Data.** An event is a frozen plain object that every handler shares.
- **Cost.** An event type nobody subscribed to is not built. A fight with no
  subscribers builds only the `hit` events the combat log needs.
- **Results.** Subscribing changes nothing: no rng draw, no order, no result.
  The tests compare results, logs and rng draws with and without subscribers,
  and with throwing ones.
- **Time on a runner.** `pause()` or `stop()` from an event handler takes
  effect when the engine has finished the move it is in. Events of that move
  are still delivered after `pause()`, none after `stop()`. `advance()` from a
  handler banks its time for the call that is running; the engine is never
  entered twice. The runner's `state` handlers follow the same rules.

## The combat log

`Simulation.combatLog` (and `runFight(...).log`) is a ring of the newest
`k("log.maxEvents")` rows, fed by the `hit` events through `js/event-stream.js`'s
`RingLog`. Newest first, the same rows as before: `{ id, time, name, type,
damage, status, outcome, icon }`. A row's `outcome` for a DoT tick is, as it has
been, the tick's status (`"Hit"` or `"Crit"`); the `hit` event's `outcome` is
lowercase like every other.
