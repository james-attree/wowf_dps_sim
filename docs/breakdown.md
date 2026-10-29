# Per-ability breakdown (S2, issue #145)

`js/ability-breakdown.js` says what each ability, white swing, poison and DoT did
in a fight, and the same summed over a batch. It is read from the event stream
([events.md](events.md)) and nothing else: `hit` events (every result on the
target, misses included) and `cast` events (an ability was used). It reads no
engine internals and names no step or frame, so it works on a `SimRunner`, a
`Simulation`, a recorded array of events or the Phase 3.5 engine, as long as the
events are the same. It has no DOM, reads no clock and draws no randomness, and
subscribing it changes no fight.

## Using it

One fight:

```js
import { FightBreakdown } from "./js/ability-breakdown.js";

const breakdown = new FightBreakdown();
const off = breakdown.attach(runner); // before run(), so no event is missed
runner.run();
runner.advance(Infinity);
breakdown.summary(); // { totalDamage, rows }, readable mid-fight too
off(); // unsubscribe
```

`attach(source)` takes anything with `on(type, handler)` that returns an
unsubscribe function. `observe(event)` reads one event by hand (types other than
`hit` and `cast` are ignored). `breakdownFromEvents(events)` is the same summary
for events already in hand (any iterable).

A batch: `runBatch(...)` and `BatchRunner#result` carry it as
`result.breakdown` ([batch.md](batch.md)). By hand, `BatchBreakdown#add(summary)`
takes one fight's summary at a time, in fight order, and `summary()` gives the
totals.

## One fight: `FightBreakdown#summary()`

| Field         | Meaning                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `totalDamage` | The damage of every `hit` event, added in event order: equal to the fight's `totalDamage`, exactly. |
| `rows`        | One per ability id, sorted by id (code-point order), so the order never depends on timing.          |

A row:

| Field          | Meaning                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | The ability id (`main-hand`, `off-hand`, `sinister-strike`, `deadly-poison`, ...): the key.                                                                           |
| `name`, `icon` | Labels from the first event of that id. Never used as a key.                                                                                                          |
| `origin`       | `white`, `yellow` or `poison`: where its attack rolls came from. `dot` for a row with only ticks.                                                                     |
| `casts`        | `cast` events. 0 for a white swing or a poison proc, which are not casts.                                                                                             |
| `attempts`     | Attack rolls: `hit` events that are not DoT ticks. A miss, a DoT application and a `cast` outcome (Slice and Dice, Adrenaline Rush) each count one.                   |
| `outcomes`     | Attempts by outcome: `hit`, `crit`, `glancing`, `miss`, `dodge`, `parry`, `block`, `cast` (`BREAKDOWN_OUTCOMES`), plus any other outcome seen. Adds up to `attempts`. |
| `hits`         | Attempts that dealt damage (above 0).                                                                                                                                 |
| `directDamage` | Their damage, ticks not included.                                                                                                                                     |
| `averageHit`   | `directDamage / hits`. `null` with no hit.                                                                                                                            |
| `ticks`        | `{ count, crits, damage, average }` of the DoT ticks, which are not attempts. `average` is `null` with no tick.                                                       |
| `damage`       | `directDamage + ticks.damage`.                                                                                                                                        |
| `share`        | `damage / totalDamage`, 0 if the fight dealt none.                                                                                                                    |

The rows' `damage` adds up to `totalDamage`, and their `share` to 1, within
floating-point rounding: damage values are not whole numbers (armor), and the
rows add them in another grouping than the event-order total. `totalDamage`
itself is bit-equal to the fight's.

`result.abilities` (the engine's own per-ability record, keyed by display name)
is unchanged. The breakdown agrees with it (tests check this): a record's
`casts` is the breakdown's `attempts`, its `hits`, `crits`, `glances`, ... are
`outcomes`, its `ticks` and `tickCrits` are `ticks.count` and `ticks.crits`, and
its `damage` is `damage`. What the breakdown adds: the real cast count, rows
keyed by id, damage split into direct and tick damage, averages and shares, and
the batch totals below.

## A batch: `result.breakdown`

`{ fights, totalDamage, rows }`, where `fights` is the fights added (the batch's
`completed`) and `totalDamage` their damage. Each row has the fields above,
summed over the fights, and:

| Field                         | Meaning                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `averageHit`, `ticks.average` | Pooled: summed damage over summed count, not the mean of each fight's average.                                                                                |
| `share`                       | `damage / totalDamage` over the whole batch.                                                                                                                  |
| `perFight.damage`, `.casts`   | `RunningStats` summaries (`{ count, mean, stdDev, min, max, ci95 }`, as `result.summary`) of the row's damage and casts per fight. A fight without it is a 0. |

So `perFight.damage.mean` is what the ability does in an average fight, and the
rows' `perFight.damage.mean` add up to the batch's mean DPS times the fight
length.

## Determinism and accuracy

- Fights are added in iteration order, and every sum is taken in that order, so
  the breakdown depends on the base seed, the iterations, the duration and the
  config, never on how the work was sliced or driven. Tests compare it across
  slicings and against a breakdown built from each iteration's own fight.
- Damage sums over the batch are compensated (Neumaier's algorithm,
  `CompensatedSum` in `js/running-stats.js`), so small values next to large ones
  are not lost. Counts are integers. The per-fight statistics are Welford's
  (`RunningStats`), as for DPS.
- A row that first shows up in a later fight is back-filled with a 0 for each
  fight before it, in order, so its per-fight statistics are those of every
  fight.

## Shape

New: `js/ability-breakdown.js` (`FightBreakdown`, `BatchBreakdown`,
`breakdownFromEvents`, `BREAKDOWN_OUTCOMES`), `js/running-stats.js`
(`RunningStats`, moved from `js/batch-runner.js`, which still exports it, and
`CompensatedSum`), and the `breakdown` field of the batch result. `runFight`'s
result, `SimConfig` and the rotation JSON are unchanged. No new constants.
