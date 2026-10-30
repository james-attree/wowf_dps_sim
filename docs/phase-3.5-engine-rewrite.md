# Phase 3.5: event-queue engine

Status: planned, not started. This is a proposal for James to review. No
issues exist for it yet, and nothing here is scheduled until James decides it
is. Phase 3 comes first and is not blocked by this document.

This phase replaces the fixed-step core of `Simulation` with an event queue:
time jumps from one event to the next instead of advancing in steps of
`k("sim.fixedStep")`. It changes how time is resolved. It does not change game
rules, constants or the public interface Phase 3 builds on top of the engine.

Formulas are in [docs/mechanics.md](mechanics.md). Constants, sources and the
retune list are in [docs/provenance.md](provenance.md). This document does not
copy them. The roadmap is in [docs/roadmap.md](roadmap.md).

## Context

The roadmap's engine theme (E) described an event queue: E3 a scheduler, E4 to
E6 swings, the GCD, cooldowns, DoTs and decision points as events, E7 to E9 the
event stream, `SimRunner` and the live adapter, E11 a parity test. Phase 1
delivered the exit criterion (a seeded 5-minute fight in Node in under 50 ms,
live mode a view of it) with a smaller design instead: a deterministic
fixed-step `Simulation` in `js/simulation.js`. `Simulation.step(dt)` moves time,
`Simulation.run(duration)` calls it in steps of `k("sim.fixedStep")`, and
`runFight` / `createFight` in `js/fight.js` build and run it. E1, E2 and the
parts of E7 to E9 that the exit criterion needed were done in that shape. E3 to
E6 and E11 were not built. See "Simulation clock" and "Known limits of Phase 1"
in mechanics.md.

Phase 3 adds a thin `SimRunner` state machine (the roadmap's E8 in a small
form) and a `sim.on` event stream (E7 in a small form) on top of that
fixed-step engine, plus the rotation interpreter (R3). Those two interfaces are
what the UI, the Web Worker and the batch runner use. Phase 3.5 puts a new core
under them. It is only a success if the code above the engine does not have to
change, apart from removing workarounds for the step.

How the fixed step works today, because it is what changes:

- `step(dt)` runs the same sequence every step: regenerate energy, count down
  auras, cooldowns and the GCD, tick DoTs, expire Premeditation points, then
  call `Rogue.rotation`, which tries every ability and swings both weapons
  (see "Tolerance and the order inside a step").
- A 5-minute fight is 19,200 steps, so the rotation runs 19,200 times. For
  `runFight({ seed: 1, duration: 300 })` with the default config, the casts
  and swings in the result add up to about 390 (86 casts, 301 swings, no DoT
  ticks; counted from the result's per-ability records on `main` at 260c563).
  Nearly every rotation call finds nothing to do.
- Every event lands on a step boundary. A cast, swing or tick that falls due
  inside a step happens at the end of it, and the rng can be drawn in a
  different order for a different step size or an unaligned `run` split. QA
  measured this on seeds 1 to 200: 142 of 200 seeds change total damage at
  300 s when the step is 0.01 s instead of the fixed step, while the mean over
  many seeds barely moves (see "Fixed step" in mechanics.md).
- Energy is added as `rate * dt` each step, with the regen rate cut where an
  Adrenaline Rush aura runs out inside the step (`regenerateResource`).
- `scripts/scripted-fight.mjs` (the golden finisher case) replaced
  `Rogue.prototype.rotation` for the duration of a run, relying on the
  per-step rotation call. Since #197 it hooks `Rogue.prototype.castRotation`,
  which both engines call.

## Goals and benefits

1. **Exact event timing.** A swing, a GCD end, a cooldown, an aura expiry and a
   DoT tick happen at their own timestamps, not at the end of the step that
   contains them. Rupture ticks land exactly every `k("rupture.tickInterval")`
   after the cast, and a 20 s cooldown set at t is ready at exactly t + 20.
2. **Energy as a function of time.** Energy at time t equals
   `min(cap, e0 + rate * (t - t0))`, with the rate and cap re-based at the
   moment a modifier changes them (Adrenaline Rush applying or expiring, a
   talent's regen bonus). That is what the roadmap's E4 asks for, and it
   removes the slicing code in `regenerateResource`. Energy regenerates
   continuously in Forever (the note on `k("energy.regenPerSecond")`); the
   current engine approximates that in steps.
3. **Fewer computations per fight, and faster batches.** Work happens when
   something changes, not 19,200 times per 5-minute fight. This should make
   batches cheaper (1,000 or 10,000 fights per run in Phase 3's batch runner,
   and thousands more per answer for Phase 5's stat weights). This is an
   expectation, not a measurement. See "Performance".
4. **Decision-point rotation evaluation.** The rotation is evaluated when the
   state it can react to changes: the GCD ends, energy reaches the cost of a
   candidate ability, combo points or an aura change, a cooldown is ready, an
   aura gets down to a threshold a rule names. That is the roadmap's E6, and it
   is how the Phase 3 interpreter (R3) is described: "at each decision point
   cast the first rule whose conditions pass".
5. **`runUntil(t)` as the one way to move time.** A live view, a replay, a
   speed control (1x, 4x, max) and a headless run are all `runUntil` with a
   different target. A split at any time gives the same fight as one long call,
   because there are no steps to land inside. That removes the caveat in
   "Fixed step" (a split that ends inside a step takes a short step of its own
   and can change the fight), and with it the step-size sensitivity in the
   table there.
6. **Easier haste and cooldown effects.** Haste, cooldown reduction and
   duration changes become "reschedule the affected events" in one place,
   instead of each timer decrementing by `dt` in its own loop. Assassination and
   Subtlety effects in Phase 4 are the main users.

## Non-goals

- No change to game rules, constants, the attack table, damage formulas, the
  modifier pipeline, the aura model, procs or poisons. If the rewrite finds a
  behaviour that looks wrong (the haste rule for a swing in progress is one
  candidate: today it keeps its remaining time and wowsims rescales it), it is
  recorded as a separate issue and not changed here, so a DPS difference can be
  put down to timing and not to a rule.
- No change to the public interface that Phase 3 delivers (`SimRunner`,
  `sim.on` events, `runFight`'s result shape, `SimConfig`). 3.5 may add new
  event types. It does not rename or remove one, or change a field.
- No latency model (`k("latency")` is an assumption the engine does not use),
  no multi-target or movement, no new abilities or talents.
- No new UI. The live view keeps using whatever Phase 3 gave it.
- No promise that results equal the legacy engine's per seed. They will not
  (see Risks). The promise is statistical parity, and exact timing.
- No build step, no runtime dependencies. The engine stays vanilla ES modules
  and passes the existing ESLint engine-purity rules.

## Scope, mapped to the roadmap

| Roadmap task | In this phase                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E3           | Min-heap scheduler keyed by time, a tie-break class and a sequence number. `runUntil(t)` and `runToEnd()`.                                                   |
| E4           | Swings, GCD, cooldowns, aura and Premeditation expiry as events. Energy continuous at the regen rate, with a wake-up when energy reaches the next cost.      |
| E5           | DoTs as scheduled tick events, ticks at exact multiples of the interval from the application.                                                                |
| E6           | Decision points: the rotation runs when state changes, not per frame.                                                                                        |
| E7 to E9     | Finishing and re-pointing the Phase 3 versions (event stream, `SimRunner`, live adapter) onto the new core, keeping their interface.                         |
| E11          | Parity test against the legacy engine: mean DPS within 2% over many seeds, with the Phase 3 rotation (R3) and the Q-fixes in.                                |
| E10          | Not part of this phase. The new core takes the end time through `runToEnd`. Check the status of E10 when this phase is planned and fold it in if it is open. |

## Design

This section is the starting point for the first issue, not a fixed design.
Where it says "proposed", the issue should confirm or change it.

**Scheduler (E3).** A binary min-heap of events. An event is
`{ time, order, seq, kind, payload }`. `runUntil(t)` pops events with
`time <= t` in order, sets `now` to each event's time and runs it, then sets
`now = t`. `runToEnd()` is `runUntil(duration)`. A cancelled or superseded
event is marked and skipped when popped (lazy deletion) instead of being
removed from the heap; each timer (a swing, an aura's expiry) holds a token, so
a refresh or a haste change schedules a new event and invalidates the old one.
Pure module, no DOM, no clock, no random numbers.

**Ordering at the same timestamp.** Same-time events must run in one fixed
order, or a seed gives different fights on different engines or Node versions.
Proposed: sort by `time`, then by a fixed `order` class, then by `seq` (the
order they were scheduled in). The classes follow the order the fixed step
already uses (see "Tolerance and the order inside a step"): resource and regen
changes, aura, cooldown and GCD expiries, DoT ticks, swings, then decision
points last, so the rotation always sees the state after everything due at that
instant has happened. The exact classes are for the E3 issue to settle and
document. Times that should coincide (a 1 s GCD ending as a 1 s aura expires)
must compare equal. Proposed: compute each event time from its anchor, as
`applied_at + n * interval` for ticks and `start + duration` for expiries, and
not by adding a delta to the previous event, so floating-point error does not
accumulate. Compare with `k("sim.tickEpsilon")` where the legacy engine does.
Plain doubles are the proposal. Integer ticks of a fine unit are the
alternative, and need a decision before E3 lands.

**Energy (E4).** The energy pool stores `(value0, t0, rate, cap)` and reads as
`min(cap, value0 + rate * (now - t0))`. A spend, a gain or a rate or cap
change first re-bases (`value0 = value(now)`, `t0 = now`). The rate changes
only at events (an aura applying or expiring, a talent), so each change
re-bases at its own timestamp. The pool schedules a wake-up for the time energy
reaches the cheapest cost the rotation can currently use. The source of that
cost is the rotation: the decision-point rule below says how it asks. Static
and timed modifiers still go through `ModifierPipeline`; only when the rate
is read changes.

**Swings, GCD, cooldowns (E4).** Each weapon holds the time of its next swing
and schedules one swing event. A haste change reschedules per the rule the
legacy engine uses today (a swing already counting down keeps its remaining
time), because changing that rule is a non-goal. The GCD, each cooldown, each
aura expiry and Premeditation's point expiry are events scheduled when they
start. The internal cooldown on a proc already stores `readyAt`, an absolute
time, and needs no event.

**DoTs (E5).** A DoT cast at t with a tick interval i and duration d schedules
ticks at `t + i`, `t + 2i`, and so on up to the count the legacy code computes
(`floor(d / i)`, see "Bleeds and damage over time"). A refresh schedules a new
set and invalidates the old. The tick body (snapshot damage, Hemorrhage bonus,
per-tick crit roll, armor skip, the proc hook) is not rewritten, only moved
from the step loop into the event handler.

**Decision points (E6).** After each event that can change what the rotation
would do, one decision event is queued at that time (one per timestamp, not
one per change). It runs the rotation, which casts until nothing more can be
cast now. Then it schedules its own next wake-up: the earliest of the GCD end,
a cooldown ready time, the time energy reaches the cost of an ability the
rotation wants, and any time a rule needs (an aura's remaining time passing a
threshold, fight time). The Phase 3 condition vocabulary (R2) already has the
conditions the rotation can ask about, so each condition type declares the
times it can next change. A new condition type that cannot say when it changes
is rejected by a test, so a rotation can never silently go stale. The rule is
that the rotation may not depend on a value that changes with no event behind
it. The placeholder rotation and the Cold Blood rule are rotation data now (R3,
`js/rotation-default.js`, walked by `js/rotation-interpreter.js`), and the cast
decision is already split from the swing handling (`Rogue.castRotation`).

**Event stream and runner (E7 to E9).** The engine emits the same events it
does at the end of Phase 3, from the new handlers. `SimRunner` calls
`runUntil` for its steps (a live frame, a batch run, a paused state) and no
longer needs the fixed step, `FrameClock`'s carry or the per-step cap. The
live adapter (E9) is `runUntil(now * speed)`.

## Proposed issues and landing order

One PR per issue, as in earlier phases. Ids here are working names; real issue
numbers are created when James approves the plan. The legacy engine stays in
place and is the default until issue 8.

| #   | Roadmap | Issue                                  | Depends on |
| --- | ------- | -------------------------------------- | ---------- |
| 1   | E11     | Design note and parity harness         | -          |
| 2   | E3      | Scheduler                              | 1          |
| 3   | E4      | Continuous energy                      | 2          |
| 4   | E4      | Swings, GCD, cooldowns, expiries       | 3          |
| 5   | E5      | DoT ticks, procs and poisons on events | 4          |
| 6   | E6      | Decision points and the rotation       | 5          |
| 7   | E7-E9   | Re-point runner, stream, live adapter  | 6          |
| 8   | E11     | Parity gate and switch-over            | 7          |
| 9   | -       | Remove the legacy engine, docs         | 8          |

**1. Design note and parity harness.** Write the ordering and time-representation
decisions into mechanics.md (as a planned-section note, not as current
behaviour). Build the parity script: it runs a named engine over seeds 1 to N
for the Combat default and the golden configs and prints mean and standard
deviation of DPS, the per-ability damage and cast means, and the 95% interval
of the difference. With only the legacy engine available, it compares legacy
to legacy and the difference must be exactly 0, which proves the harness.
Done when: the harness runs under `npm run`, has a test, and the legacy
self-comparison is exactly zero.
Landed in #192: `npm run parity` (`scripts/parity.mjs`, tested in
`test/parity.test.js`), and the time and ordering note in mechanics.md
("Planned: event-queue engine (Phase 3.5)"). The scripted golden case runs its
config without its script, as `finishers-50s-without-script`, and a
parity-only DoT case (`dot-hemorrhage-rupture-120s`) covers Rupture ticks.
`--gate 2` is #199's gate: `|mean A - mean B| / mean B` at most 2% on every
case, on the point estimate, with B = legacy (mechanics.md "Parity harness").

**2. Scheduler (E3).** The heap, `runUntil`, `runToEnd`, cancel tokens and the
ordering rule. Done when: unit tests cover same-time ordering (including 1,000
events at one time), cancel and reschedule, `runUntil` splits giving the same
order as one call, `now` after `runUntil(t)` equal to t, and a randomised test
against a sorted-array reference; the module passes the engine-purity lint
rules.
Landed in #193: `js/core/scheduler.js`, tested in `test/scheduler.test.js`
(including 200 seeded rounds against a sorted-array reference), with
decisions last at one timestamp, the hard stop
(`k("sim.maxEventsPerTimestamp")`, `k("sim.maxEventsPerSecond")`), and a
runtime check that a legacy DoT's `tickInterval` is a finite number above 0
(mechanics.md "Planned: event-queue engine (Phase 3.5)" and "Bleeds and
damage over time").

**3. Continuous energy (E4).** The pool stores `(value0, t0, rate, cap)`, with
re-basing on spend, gain, rate or cap change, and the threshold wake-up.
Done when: energy at t equals `min(cap, e0 + rate * t)` exactly for a run with
no modifier and equals the piecewise form across an Adrenaline Rush apply and
expiry (tests for both), the cap is respected, and `resourceMax` modifiers
still apply. It runs on the new core only. The legacy pool stays for legacy.
Landed in #194: `js/core/energy.js` (`EnergyPool`), tested in
`test/energy.test.js`. That includes exact `min(cap, e0 + rate * t)` reads and
200 seeded runs across an Adrenaline Rush apply and expiry against Kira's #183
chronological regen model. The host calls `modifiersChanged()` at a modifier
event, and the threshold wake-up is one-shot, in the energy class (mechanics.md
"Planned: event-queue engine (Phase 3.5)").

**4. Swings, GCD, cooldowns, expiries (E4).** Done when: swing count over 60 s
is the same at any query granularity and equals the exact count for the weapon
speed (`floor(60 / speed)` or one more at a boundary); a 20 s cooldown set at
t is ready at exactly t + 20; a 1 s GCD ends at exactly t + 1; auras and
Premeditation points expire at their timestamps; haste applying mid-swing
follows the legacy rule.
Landed in #195: `js/core/swing.js` (`SwingTimer`, swings anchored at the swing
where the interval last changed) and `js/core/timers.js` (`Timer`,
`TimerSet`, `refreshedEnd`, `createTimers` for the GCD, cooldowns, auras and
Premeditation's points), tested in `test/swing.test.js` and
`test/timers.test.js`, including the same swings at any query granularity
and against the legacy `Weapon.tick` with random haste changes (mechanics.md
"Planned: event-queue engine (Phase 3.5)").

**5. DoT ticks, procs, poisons (E5).** Done when: Rupture ticks land exactly
every `k("rupture.tickInterval")` for its duration (a test that asserts
timestamps); a refresh does not leave a stale tick; a tick that falls inside a
Hemorrhage window is boosted and one outside it is not; proc internal
cooldowns, poison charges and `extra` attacks keep their rules, with the
existing proc and poison tests passing on the new core, unmodified where they
do not mention steps.
Landed in #196: `js/core/dots.js` (`DotTicks`, ticks anchored at
`anchor + n * interval`, a restart and a keep-clock refresh) and
`Simulation.resolveDotTick` (the legacy tick body, shared by both engines),
tested in `test/dots.test.js` with a test host (`test/core-host.js`): exact
Rupture tick times, no stale tick after a refresh, a Hemorrhage window that
ends at a tick, internal cooldowns, extra attacks and poisons on events, and
200 seeds where the fight on events equals the legacy loop hit for hit
for casts scripted at .125 s offsets, which never tie with a swing or a tick
(three edges differ, listed in mechanics.md "Planned: event-queue engine (Phase 3.5)"). The shipped engine
runs it on the `"events"` engine from #197; the default stays legacy until
#198 and #199.

**6. Decision points and rotation (E6).** Done when: there is no per-frame
polling; the count of rotation evaluations in a fight is at most the count of
events (assert it); the placeholder Combat rotation and the Phase 3 JSON
rotation (R3) both run on the new core; the Cold Blood rule works; the
scripted-fight harness is re-pointed to the decision hook, with the golden
finisher case still reaching Rupture ticks and a tick crit; each R2 condition
type declares its wake-up times and a test fails for one that does not.
Landed in #197: `js/core/fight.js` (`runOnCore`, the `"events"` engine of
`Simulation` and `createFight`; legacy stays the default), each condition
type's drift and `conditionWakeAt` in `js/rotation-conditions.js`, the
scripted fight hooked on `Rogue.prototype.castRotation`, and the energy pool's
waste. Tested in `test/core-fight.test.js` (a 1/64 s poll on top casts the
same, the decisions are at most the events, Cold Blood, the pool's host
contract, the scripted golden case), `test/core-rules.test.js` (the legacy
step tests' rules on the core), `test/core-engine-files.test.js` (the proc
and poison files on the core) and `test/rotation-wakes.test.js`. The runner,
the stream and `runFight`'s engine are #198; parity and the default are #199.

**7. Event stream, `SimRunner`, live adapter (E7 to E9).** Done when: the
Phase 3 contract tests for the stream and the runner pass unchanged against the
new core (this assumes Phase 3 writes them; if it does not, adding them is
the first part of this issue and they must be written against the legacy
engine first); Stop then Run reproduces the identical seeded fight; live
output equals headless output for the same seed at 1x, 4x and max; the UI
and the Web Worker need no change beyond deleting step-related code.
Landed in #198: `openCore` in `js/core/fight.js` (the event core held open
over many calls; `runOnCore` is open, one `runUntil`, close), the `engine`
option of `runFight`, `SimRunner` (and `runner.engine`) and `createLiveRun`,
`FrameClock.seconds`, the scheduler's `nextTime` and `current`, swing events
named by the engine's hand (`mainHand`, `offHand`; any weapon hand but `main`
and `off` refused), and the core's input checks from #195's QA
(`refreshedEnd`, `TimerSet` ids, a `Timer`'s payload frozen, `swung()` from
its own swing event only). Tested in `test/runner-engine-files.test.js` (the
sim-runner, event-stream, live-run, live-feed, run-controls and
ability-breakdown files on the core), `test/runner-events.test.js` (any
split, no step artefact, Stop then Run, live equals headless at 1x, 4x and
max, procs and poisons through the runner, the feed between calls) and
`test/core-checks-198.test.js`. The step-artefact test (#185(f)'s
"600 × advance(1/60) ends one step short" in `test/sim-runner.test.js`) is
skipped on the core and stays for legacy until the step code goes (#200). The
UI and the Worker are unchanged: they run legacy until #199 switches the
default.

**8. Parity gate and switch-over (E11).** Done when: the harness shows the
mean DPS of the new core within 2% of legacy over many seeds (proposed:
seeds 1 to 200 at 300 s for the default Combat build, and the same for the
talented and poisoned configs), and per-ability damage and cast means agree
within a tolerance Kira signs off, with any difference above it explained. The
engine default switches to the new core. The golden fixtures are regenerated
with `npm run golden:update -- --write` in their own commit, and Kira reviews
the diff of every fixture and signs off. If the mean is outside 2%, the PR does
not merge and the cause is fixed or James decides.

**9. Remove the legacy engine, docs.** Done when: the fixed-step loop,
`Simulation.step` as a public method (or a documented shim if the live page or
tests still need it), `k("sim.fixedStep")`, `k("sim.maxFrameTime")` if nothing
reads it, and the step-only parts of `FrameClock` are gone; "Simulation clock",
"Fixed step", "Live page", "Tolerance and the order inside a step", "Energy",
"Benchmark" and "Known limits of Phase 1" in mechanics.md describe the new
engine; `npm run provenance` is clean; no constant is left with no reader; the
bench is re-measured and its numbers written down.

Issues 3 to 5 each need their own tests, since the legacy tests mostly drive
`step(dt)`. Where a test pins a rule (not a timing), port it to the new core.
Where it pins a step artefact, say so in the PR and drop it. A test that is
dropped or weakened is listed in the PR description for Kira.

## Risks

- **Golden fixtures and the rng draw order change.** The legacy engine draws
  in step order, and the new one draws in event order. Both are correct, and
  neither equals the other per seed. Every golden fixture (6 today, including
  the finisher, talented and poisoned cases) will change in the switch-over.
  Plan: regenerate in one PR with the engine change and fixtures in separate
  commits, `golden:update --write` as the only writer, and Kira reviews the diff
  line by line for what moved and why, and checks the fixtures still exercise
  what they were made for (DoT ticks and a tick crit, Eviscerate, procs, poison
  rolls). Mean-over-seeds parity is the check that the numbers are right, since
  per-seed equality cannot be.
- **Mutation and equivalence testing is redone.** Kira's mutation runs and
  step-equivalence checks (scripts and results from Phase 2 QA) target the
  legacy code paths. They need redoing for each ported area, and the fixed-step
  equivalence tests have no counterpart. Plan for QA time in each of issues 3
  to 8, not only at the end.
- **Proc, aura and poison timing.** These read `currentTime` and the step's
  order today (proc `readyAt`, aura charges, poison rolls between swings,
  Hack and Slash chains, Cold Blood waiting for the next landing attack). A
  timing change can change which attack a charge lands on or how often a proc
  fires. These are the most likely source of a parity miss and get their own
  tests in issue 5.
- **Same-timestamp ties.** A GCD that ends as an aura expires, a swing and a
  DoT tick at the same time, two procs. Without a fixed rule the result depends
  on insertion order. Mitigation: the ordering rule in the scheduler, a test per
  pair of event classes that can coincide, and a determinism test that runs
  each golden case twice and under a different insertion order of independent
  events.
- **Floating-point drift in times.** Event times built by repeated addition
  drift, and `<=` against a drifted value makes a swing or a tick land a
  decision early or late. Mitigation: anchored times, the `sim.tickEpsilon`
  tolerance where the legacy engine used it, tests for long fights (a long
  duration is part of the parity run).
- **Rotation going stale.** If a rotation condition changes with no event, a
  decision point never fires and the rotation idles. Mitigation: the
  wake-up declaration in issue 6, and a test that compares decision-point
  results with a brute-force "evaluate at every 1/64 s" run on the same fight:
  the cast sequence must match except for the small timing offsets.
- **Mixing a rewrite with rule changes.** Mitigated by the non-goal above, and
  by reviewing each PR for rule changes.
- **Interface drift.** If Phase 3's interface is too tied to steps (a `step`
  event, a frame-based pause), the new core cannot keep it. Phase 3's issues for
  the runner and stream should avoid exposing steps. Check this when the Phase
  3 headless checkpoint is reviewed.
- **Size and scope.**
  This is a rewrite of the 861-line `js/simulation.js` plus the resource,
  weapon, aura and rotation paths around it, and the work is mostly in the
  tests. Splitting it in nine PRs, each reviewable on its own, is meant to let it
  pause between any two issues.

## Migration strategy

1. **Build alongside.** The new core goes in its own directory
   (proposed: `js/core/`), next to the legacy `Simulation`. Shared pieces
   (the attack resolver, the modifier pipeline, aura definitions, ability data,
   the rng, `SimConfig`, the poison and proc data) are reused, not copied. Where
   a shared piece reads `simulation.currentTime` or ticks its own timer, it
   gets the minimal change that works for both engines.
2. **Parity test against legacy.** The harness from issue 1 runs both engines
   over many seeds. This is the E11 test. Mean DPS within 2% (the figure the
   roadmap uses, and the same bound `test/fixed-step.test.js` already holds for
   step size), plus per-ability agreement.
3. **Switch over.** One PR makes the new core the default for `createFight`,
   `runFight`, `SimRunner` and the live page, and regenerates the golden
   fixtures.
4. **Remove legacy.** After the switch-over has been through James's review,
   a PR removes the legacy engine. Git history keeps it, and a tag on the last
   commit that has both is cheap. Keeping both engines forever is not
   proposed, since a second engine doubles the places a rule has to change.
5. **Rules that do not move.** `golden:update --write` stays the only thing
   that writes fixtures (`npm test`, `lint` and `provenance` never write one).
   The ESLint engine-purity rules (no `document`, `window`, `performance`,
   `Date`, `Math.random`, no game-number literals, no display-name keys) apply
   to the new directory from its first commit. Every number still comes from
   `k(id)`, and `npm run provenance` stays clean. CI keeps its checks, and no
   issue loosens one.

## Performance

Measured on `main` (260c563) on our box (Node 20.19.2), `npm run bench`, which
runs `runFight({ seed: 1, duration: 300 })` 20 times: warm median 20.8 ms, cold
(first run in the process) 52.8 ms. The numbers move between runs and machines;
mechanics.md "Benchmark" has earlier measurements (about 22 ms warm and about
40 ms cold on this box, and 60 to 65 ms per fight on the GitHub Actions runner
during Phase 1). The 50 ms target in `scripts/bench.mjs` is a development
machine target, not a CI guarantee.

Re-measured at #192 on `main` (74f1c57), our box, Node v24.22.1, with other jobs
running: over ten `npm run bench` runs, the median warm median was 27.5 ms
(25.3 to 42.4 ms) and the median cold run 57.6 ms (54.6 to 78.7 ms). Issues 6
and 8 compare the new core with these, measured the same way (mechanics.md
"Benchmark").

For 3.5: the target is that the new core is faster than the legacy engine on the
same machine, same Node and same config, measured with the same bench. The
expected reason is the evaluation count (19,200 rotation calls against about 390
casts and swings in the default fight). The size of the gain is not known. It
will be measured at issue 6 and again at issue 8, and the measured numbers (not
estimates) go in the PR and in mechanics.md "Benchmark". Batch speed
(1,000 fights, as the Phase 3 batch runner does it) is measured as well as one
fight. If the new core is not faster, the phase's other benefits are still its
case, and that is reported plainly to James before the switch-over. It is not
presented as a win.

Memory and garbage are watched as well: events are objects, so the scheduler
should reuse them or keep the allocation per fight small enough that a batch
does not spend its saving on the collector. Measured, not assumed.

## Exit criteria

- The new core is the default behind `runFight`, `createFight`, `SimRunner` and
  the live page, and the legacy engine is removed (or James has chosen to keep
  it as a test-only reference, recorded here).
- Energy at time t equals `min(cap, e0 + rate * t)` exactly for the unmodified
  case, and swings, GCD ends, cooldowns, aura expiries and DoT ticks land at
  their exact timestamps (tests).
- The rotation runs on state changes only: evaluations per fight are at most
  events per fight (test), and a seeded fight is the same whether it is run in
  one `runToEnd` call or split over any `runUntil` calls.
- The parity test passes: mean DPS within 2% of the legacy engine over the
  agreed seeds and configs, with per-ability differences explained and signed
  off by Kira.
- Golden fixtures are regenerated with `golden:update --write`, reviewed by Kira
  and accepted by James, and CI is green on every supported Node version.
- The Phase 3 interface is unchanged: its contract tests pass against the new
  core and the UI and Web Worker needed no functional change.
- Benchmark numbers for the new and the old core are recorded from a real
  `npm run bench` run, with the machine and Node version named, whether or not
  the result is a speed-up.
- mechanics.md describes the engine as it is, ESLint engine-purity rules apply
  to all engine code, and `npm run provenance` is clean.

## Relationship to the other phases

- **Phase 3** is done first, as planned. Its headless work (`SimRunner`, the
  event stream, the rotation interpreter, the batch runner) is what 3.5 builds
  under. It is not blocked by 3.5, and its issues should not expose the step
  size in any interface.
- **Phase 3.5 starts when James decides.** The current proposal is after the
  Phase 3 headless checkpoint, and before Phase 4 adds talents, since each
  Phase 4 effect that touches timing (haste, cooldowns, procs) would otherwise
  be written against the fixed-step engine and moved later. Whether it starts
  then, or after the whole of Phase 3, or is left until Phase 5's stat weights
  make speed matter, is James's call. Phase 4 does not start without his
  go-ahead either way.
- **Phase 4** (talent tree, rotation builder, history, Assassination and
  Subtlety effects) and **Phase 5** (stat weights, sharing, racials) use the
  public interface, so they do not depend on which engine is underneath. The
  later the rewrite, the more engine effects and fixtures it has to carry over.

## Open questions for James

1. When does 3.5 start: after the Phase 3 headless checkpoint (proposed), after
   all of Phase 3, or later?
2. Keep the legacy engine as a test-only reference after the switch-over, or
   remove it (proposed, with a git tag)?
3. Is the 2% mean-DPS bound, from the roadmap, the right gate, and are seeds
   1 to 200 at 300 s enough? A tighter bound needs more seeds, and costs
   run time.
4. Should the swing-haste rule (a swing in progress keeps its remaining time)
   be revisited? It is out of scope here, and would be its own issue.
