# WoW Forever rogue DPS simulator

A vanilla JavaScript app, loaded as ES modules, with no build step. It
simulates rogue DPS on WoW Forever from talents, skills, poisons, and weapon
and character stats. There is no item database.

## Hosting

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) deploys the static
site from `main`. The site deploys to
https://james-attree.github.io/wowf_dps_sim/ once Pages is enabled. Set the
repository source to GitHub Actions under Settings > Pages. The workflow
publishes `index.html`, `styles.css`, `talent-tree.css`, `js/`, `data/`, and
`img/`.

## Status

Phase 0 is complete. Phase 1, the deterministic headless engine, is built and
merged; it is complete once James signs it off. Phase 2 (abilities, resources,
the attack table, auras, modifiers, procs, Combat and the reference
Assassination talents as data, applying a selected build, Instant and Deadly
Poison, and icons by hot-link) is built; its last issue, #107, closed on
2026-10-26. Phase 3 (rotation as data, the stats and poison form, run controls,
batch runs in a Web Worker and the results panel) is built; #155 is its
wrap-up, and the phase ends with a review by James. Phase 3.5, an event-queue
engine, is [a proposal](docs/phase-3.5-engine-rewrite.md). Combat is the first
spec. A fight is `runFight` with an
optional SimConfig: weapons, a talent build (51 points, validated), a
poison per hand, and a rotation. With no config `runFight` runs, and the page
starts with, the placeholder
Combat rotation (`config.rotation`, `js/rotation-default.js`, cast by
`js/rotation-interpreter.js`): Blade Flurry, Adrenaline Rush, then at the
finisher combo points Slice and Dice when it has less than 1 s left, or 5 s or
less with full energy (the combat-swords preset's rules, #173), else Cold Blood
when the build grants it and Eviscerate; otherwise Sinister Strike. A rotation
that casts Cold Blood must say "when granted" (`abilityGranted`), or the
validator rejects it (#173); since #188 every ability a talent grants needs its
guard, and until #199 Blade Flurry and Adrenaline Rush may use
`abilityUnlocked` instead.
The page's first fight adds Instant Poison on the main hand and Deadly Poison
on the off hand (`pageDefaultConfig()`, #152); `runFight`'s default has no
poisons, so the goldens do not move. The page's "Fight setup" form (Phase 3)
edits the stats, weapons, talents, rotation and poisons. The
[roadmap](docs/roadmap.md#phase-3-status) has the Phase 3 issue list, the exit
criteria and what is left open for review, and
[mechanics](docs/mechanics.md#known-limits-at-the-end-of-phase-2) the known limits.

## How the engine fits together

A fight is a seed plus the steps it is given. `js/rng.js` is the one source of
randomness. `Simulation.step(dt)` is the only way time moves, and
`Simulation.run(duration)` calls it with the fixed step `sim.fixedStep`.
`runFight({ seed, duration, config })` in `js/fight.js` builds a fight, runs it and
returns plain data, with no DOM. `config` is an optional SimConfig (character,
weapons, a talent build, poisons); leave it out for the default fight. The live
page builds the same fight with `createFight` and feeds it whole fixed steps, so
a seed gives the same fight live and headless. The golden tests pin seven `runFight` results, and
`npm run bench` times one. [Mechanics](docs/mechanics.md#simulation-clock) has
the details, and [Known limits of Phase 1](docs/mechanics.md#known-limits-of-phase-1)
says what to keep in mind.

To run a fight in Node, from the repository root:

```sh
node --input-type=module -e 'import { runFight } from "./js/fight.js"; console.log(runFight({ seed: 1, duration: 300 }).dps)'
```

## Running locally

`package.json` accepts Node `^20.19.0 || ^22.13.0 || >=24`. From the
repository root:

```sh
npm ci
npm run serve
```

`npm run serve` runs `scripts/serve.mjs`, a static server bound to
`127.0.0.1`. The default address is <http://127.0.0.1:8000/>. Set `PORT` to
use another port (an integer from 0 to 65535).

Without Node, from the same directory:

```sh
python3 -m http.server
```

Python 3's `http.server` also defaults to port 8000 and serves the current
directory, so this only works from the repository root. Unlike `npm run serve`,
it listens on all network interfaces by default. Add `--bind 127.0.0.1` to keep
it to your own machine.

Open the page through one of those servers. A `file://` URL will not load it.
`index.html` pulls in `js/main.js` with `<script type="module">`, and browsers
do not import ES modules from `file://`.

The code imports JSON files with import attributes (`import data from
"./x.json" with { type: "json" }`). The live page does it for
`data/talentsforever/manifest.json` (the data version), and `js/snapshot.js` does
it for `rogue.json`, which the live page now loads too (a SimConfig checks its
talent ids against the catalogue, through `js/talents.js`). That needs Chrome or Edge 123+, Safari 17.2+, or Firefox
138+ (the `engines` range in `package.json` is `^20.19.0 || ^22.13.0 || >=24`).
An older browser fails to load the page.

## Development

`npm ci` installs the dev dependencies (`eslint`, `@eslint/js`, `prettier`,
and `playwright-core` for the browser tests). The package has no runtime
dependencies.

| Script                     | Runs                                                   |
| -------------------------- | ------------------------------------------------------ |
| `npm test`                 | `node --test` (everything in `test/`)                  |
| `npm run test:browser`     | `node --test "browser-tests/*.browser.mjs"` in Chrome  |
| `npm run lint`             | `eslint . --max-warnings 0`, then `prettier --check .` |
| `npm run provenance`       | `node scripts/provenance.mjs`                          |
| `npm run talents:coverage` | `node scripts/talent-coverage.mjs`                     |
| `npm run data:refresh`     | `node scripts/refresh-data.mjs`                        |
| `npm run golden:update`    | `node scripts/golden-update.mjs`                       |
| `npm run icons:check`      | `node scripts/check-icons.mjs`                         |
| `npm run bench`            | `node scripts/bench.mjs`                               |
| `npm run serve`            | `node scripts/serve.mjs`                               |

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on `push` and
`pull_request`, on `ubuntu-latest`, with Node 22. The job checks out the repo,
installs with `npm ci`, then runs `npm run lint`, `npm test`,
`npm run test:browser`, `npm run provenance`, then `npm run talents:coverage`.
The browser tests (`browser-tests/`) serve the page on a free port and drive
the installed Google Chrome through `playwright-core` (no browser download);
set `CHROME_PATH` to use another Chrome or Chromium binary. Refreshing the
talentsforever snapshot stays a local command.
`npm run talents:coverage` checks the talent effects (`data/talent-effects.js`)
against the snapshot. It warns, listing each Assassination or Subtlety talent
that has no effect yet (expected until Phase 4), and fails (exit 1) for a Combat
talent with no effect and no `noDpsEffect`, for an effect whose stored rank-text
hash no longer matches the snapshot (printed with the old and new hash and the
current rank texts), and for an effect of a talent that is gone. See
[Talent effects](docs/mechanics.md#talent-effects). Run it after
`npm run data:refresh`.

A stale `docs/provenance.md` fails CI; run `npm run provenance` and commit it.
On Node 20.19, which the `engines` range allows, that failure in
`keeps docs/provenance.md equal to the generated report` can show
node:test's generic message that the values have the same structure but are
not reference-equal, instead of the assertion's own text (`docs/provenance.md
is out of date with data/constants.js`). The generic message appears when
the change lies past Node's diff truncation point. An edit near the top of
`docs/provenance.md` still shows the custom message. The test name still
names the file. Node 22, which CI uses, shows the custom message.

## Constants and provenance

Every game number lives in [`data/constants.js`](data/constants.js). An entry
is `{ value, unit, source, ref, note, retune }`. Engine code reads the number
with `k(id)`, which returns `value` or throws if the id is unknown. Keep raw
numbers out of engine modules and out of this README. Formulas in
[docs/mechanics.md](docs/mechanics.md) are written against those ids. The
phased plan is in [docs/roadmap.md](docs/roadmap.md).

`source` is one of:

- `wowf-export` — taken from the talentsforever snapshot. Re-read it when that
  snapshot refreshes.
- `wowf-designer` — James's knowledge of WoW Forever. Sign the `ref` as
  `<owner>, <date>: <reason>` (for example `James, 22 Oct 2026: ...`).
- `classic-1.12` — a Classic 1.12 reference value. This is the fallback
  wherever WoW Forever data is missing, and it stays until WoW Forever is
  measured.
- `cataclysm` — a later mechanic WoW Forever borrows on purpose.
- `assumption` — a default, a sample input, or James's presumption where WoW
  Forever data is missing. Sign the `ref` the same way.
- `engineering` — simulator machinery, not a game rule. Leave `retune` off.

`npm run provenance` checks `data/constants.js`, then rewrites
[`docs/provenance.md`](docs/provenance.md). The command fails if a `ref` is
missing, is made only of Unicode dashes (a hyphen, an en dash, an em dash, or
a run of them; spaces do not count), or is a placeholder, or if `source` is
not one of the tags above.

A placeholder is judged on the normalized ref: lower-cased, with word
separators turned into spaces, other punctuation and symbols removed, and
whitespace collapsed. Dashes, underscores (`_`), colons (`:`), slashes (`/`),
backslashes (`\`), and vertical bars (`|`) separate words. Other punctuation
and symbols are deleted, so they do not separate words: `TBD.` becomes `tbd`
and `N.A.` becomes `na`. The whole normalized ref `na`, `n a`, or `tbd later`
fails, so `NA`, `N.A.`, `N/A`, `tbd-later`, and `tbd_later` fail, and a longer
ref such as `Na (sodium)` does not. A ref whose first word is `tbd` fails,
including `TBD`, `TBD.`, `TBD:x`, and `TBD/James`. A ref that normalizes to
nothing fails, which is a ref made only of punctuation or symbols, such as
`?`, `??`, or `...`. The phrases `fill in` and `no recorded owner decision`
fail only as whole words, so `fill-in` and `fill_in` fail and
`refill interval` does not.

A ref such as `TBD: needs James's decision` fails CI by design. Placeholder
refs are rejected, and `:`, `/`, `\`, `|`, `_`, and dashes split words.

`docs/provenance.md` is generated. Do not edit it by hand. Its retune list is
every constant whose source is not `wowf-export` and whose `retune` flag is
on.

## Golden-seed tests

`test/golden.test.js` pins the full `runFight` result for a few fixed seeds and
durations (a short fight, a 5-minute fight, and another seed) in
`test/golden/*.json`. One more case casts a fixed list of abilities instead of
the placeholder rotation, so it covers Eviscerate, Rupture, DoT ticks, and tick
crits. Two cases carry a `config`: the reference build (Assassination 18 /
Combat 33 / Subtlety 0), and the same build with Instant Poison on the main hand
and Deadly Poison on the off hand. A third runs the reference build with the
combat-swords preset rotation (#164). A change to a rule, a constant, or the engine
that moves those numbers fails the test, and the message lists the fields that
changed.

Regenerate the fixtures only when a change is meant to move results, in the
same pull request, and say why in the description. A refactor or a speed-up
must leave them alone; if they fail, the change is wrong.

```sh
npm run golden:update            # dry run: lists changed fields, writes nothing
npm run golden:update -- --write # rewrites the fixtures that differ
```

`npm test` never rewrites a fixture. Review the diff in git before you commit
it. [Golden-seed tests](docs/mechanics.md#golden-seed-tests) has the rules.

## Benchmark

Phase 1's exit criterion is a seeded 5-minute fight that runs in Node in under
50 ms. `npm run bench` times `runFight({ seed: 1, duration: 300 })` 20 times in
one process and prints the median, the slowest run, the cold run (the first
one, before the engine is warmed up), and the warm median (the runs after it).
`npm run bench -- --runs 50` changes the count (1 to 1000). It exits with status 1 when the
median is not under 50 ms. The numbers depend on the machine and Node version,
so the report names the Node version.

The 50 ms target is a figure for a development machine, not a CI guarantee. On
our own box (8 vCPU Xeon, Node 20) a 5-minute fight takes about 22 ms warm and
about 40 ms cold. The GitHub Actions runner (Node 22.23.3) measured about 60 to
65 ms per fight, over the target, so no test asserts the 50 ms figure.
`npm run bench -- --target-ms N` compares the median with `N` ms instead of
50, which lets a test check the output and the exit status on any machine
(`--target-ms 0` always exits 1).

`npm test` runs `test/bench.test.js`, which asserts a looser bound (10 times the
target, 500 ms, on the median of 5 fights) so a slow CI runner does not fail the
build. It guards against a large regression only; the real number is the one
`npm run bench` prints. See [Benchmark](docs/mechanics.md#benchmark) for why the
bound is what it is. Timer reads belong in the script and the test; lint
rejects them under `js/`.

## Module map

- `index.html` — Simulator page (damage, energy, combo points, the GCD,
  effects, cooldowns, and the combat log). Loads `styles.css`, `talent-tree.css` and `js/main.js`
  as an ES module.
- `styles.css` — Dark layout and meters for that page.
- `talent-tree.css` — The talent tree's styles (U6, #204; Fran's mockup CSS):
  tiles, row gates, arrows, the detail pane and the narrow tabs. Its one
  narrow `@media` block uses the same query as `styles.css`.
- `js/main.js` — UI entry (#149): the bootstrap. It builds the store, the
  live run (`js/live-run.js`, over the animation frame), the `BatchClient`
  and the run actions (`js/run-actions.js`), hands the store and the actions
  to the views in `js/views/`, and draws an empty fight at 0:00 with a random
  seed. The page starts idle: nothing runs until Run (#153). The DPS readout is high at 00:00 (see
  [Live page](docs/mechanics.md#live-page)). The GCD status reads "On cooldown" while `gcd > 0`. With
  `js/views/`, the only files under `js/` that may use `document`, `window`,
  or the clock; lint rejects those, and `Math.random`, in every other file
  under `js/`.
- `js/store.js` — The page's store (U1, #149): `createStore(initial)` with
  `get`, `set`, `update`, `batch`, `subscribe` and `onError`, over named
  slices (`config`, `form`, `run`, `batch`, `frame`, `results`, and the feed's
  `resources`, `gcd`, `effects`, `procs`, `spend`, `moment`, `log`; #150: no slice holds an engine object). One change
  event per `set` or batch, listing the slices that changed; delivery follows
  `EventStream`. No DOM or clock: engine lint applies. `config.rotation`
  is the page's one rotation; there is no `rotation` slice (#151).
- `js/config-form.js` — The stats form's model (U2, #151):
  `createConfigForm(store)` fills the `form` slice from `config` and returns
  the actions the form view calls (`input`, `change`,
  `chooseRotation`, `importText`, `exportRotation`, `reset`, `undo`). Field
  checks give the player's-unit messages, `normalizeConfig` is the backstop,
  and `config` is written only when every field is valid. `nextRunConfig(state)`
  is the config the next run starts with, or null while the form or the talent tree (#204) has errors.
  `pageDefaultConfig()` is what the page starts with and Reset restores:
  `defaultConfig()` with the page's poisons (`ui.pageDefaultPoisons`, #152).
  Each hand's poison is a field whose value is the config id (`instant`, the
  catalogue `key`, not its `id`) or null for None; `poisonOptions()` and
  `poisonInfo(key)` give the selects their choices and the read-only top rank,
  proc numbers, tooltip and no-DPS reason. The
  talents and their level are the talent tree's (#204): the form keeps
  whatever build the config has, and its Reset and Undo cover it. Engine lint
  applies.
- `js/live-feed.js` — The live page's feed (#150): `createLiveFeed({ rogue,
simulation })` with `read()` and `stop()`. The combat log rows (from `hit`
  events) and the combo points (from `resource` events) come from the event
  stream; the energy and the time left on the GCD, each aura and each cooldown
  are read at the frame, since continuous change is not an event
  (docs/events.md). Phase 3 (#150) adds, from events with no schema change:
  each aura's full length and stacks (`aura`), cooldown lengths from the
  ability data (`cooldownOf`), the procs and their counts (`proc`, named by
  id from the poison and talent data, `procName`), the last combo point
  spend, the last buff up or gone, and `fromProc` on log rows a proc made.
  `read()` returns frozen plain slices. Engine lint applies.
- `js/views/` — The page's views (#149). Each is a factory `(document,
store)` that owns its own elements, draws from the store when its slices
  change, and returns its unsubscribe: `controls.js` (#153: the sticky run
  control bar, the only home of Run, Pause, Stop and Reset, with the Live and
  Batch toggle, the fight length, fights and seed fields, the status line ("Can't run · N
  settings to fix" and a "Fix N settings" link while Run is blocked, #155), a
  polite announcement on each live state change (in batch mode only Ready: the
  results panel announces the batch, #155) and the batch's own progress;
  below 520 px one compact sticky row with a settings summary and a closed
  "Run settings" section under it; it draws `js/views/run-model.js` and calls the run actions, and never writes the
  store), `run-model.js` (what each control shows in each state, the field
  checks and their messages, the narrow summary and errors link; pure), `visualiser.js` (combo
  points, energy, the GCD meter, effects, cooldowns, procs, the combat log and
  its announcements; redraws on `frame`, from the feed's slices only), `results.js` (time, damage, DPS; redraws on `results`; hidden in batch
  mode, where the results panel is the one place a batch's numbers show,
  #155), `results-panel.js` and `results-render.js` (#154: the
  batch results panel from Fran's spec on the issue: the empty, running
  "0 of N", previous result greyed, done, partial, "Stopped, 0 fights" and
  error states; the headline with its 95% CI and SE, the per-fight damage
  by ability table with sort buttons, aura uptime, resources with the
  energy-cap flag `ui.energyCapWarnFraction` and `ui.energyCapWarnMinFights`,
  the two charts from `js/charts.js` after every table (the DPS histogram,
  and damage over time with Cumulative / Damage per second radios), each in
  a sideways-scrolling region (520 px minimum on a narrow screen) with its
  table in a `<details>`, run details, and a polite live region for start,
  each quarter and the outcome; `results-render.js` is pure and returns `js/svg.js` nodes), and `config-form.js`
  (#151: the "Fight setup" form; draws the `form` slice and calls the
  actions `js/config-form.js` gives it, which `js/main.js` hands in, so it
  imports nothing from the engine). Edits apply to the next run: Run snapshots
  the config, and the form shows "Edited — applies to the next run" while it
  differs from the fight on the page. `talent-tree.js` (U6, #204): the
  talent tree from Fran's U6 spec; the summary row in Fight setup, the panel
  under the form, three trees at 520 px and up and tabs below, with a
  roving tab stop per tree (arrows, Home/End; Enter, Space, + or = adds;
  −, Backspace, Delete or Shift+Enter removes), the detail pane, the effects
  box and one polite live region. It draws the `talents` slice's `view` and
  calls the actions `js/talent-tree.js` gives it, patching tiles in place so
  focus stays put. `breakpoints.js` holds the one narrow
  breakpoint both use: `(max-width: 519.98px)`, so 520 px and up is wide and
  519 px is narrow; the narrow `@media` blocks in `styles.css` and
  `talent-tree.css` repeat it.
- `js/live-run.js` — The live page's run (#153): `createLiveRun(store,
frames)` with `run({ seed, duration, config })`, `pause`, `resume`, `stop`,
  `reset`, and `clear({ seed, config })` (an empty fight at 0:00, drawn while
  idle). One `SimRunner` per Run, driven by injected animation frames through
  `FrameClock`, its state mirrored into `run.state` (the one writer), and a
  new live feed per fight. The fight ends at `batch.duration` (300 s) and the
  page shows it as finished. No DOM and no clock. Engine lint applies.
- `js/run-actions.js` — What the control bar's buttons do (#153):
  `createRunActions({ store, live, client, drawSeed, now })` with `run`,
  `pause`, `resume`, `stop`, `reset`, `setMode`, `edit` and `newSeed`. Live
  mode drives `js/live-run.js`: Stop discards the fight and Run replays the
  same seed from 0:00. Batch mode runs `BatchClient` and writes the `batch`
  slice as #154 §10 says (0 of N at once, late progress ignored, `done`,
  `cancelled` with the partial result, or `error`); Stop keeps the partial
  result. `tick()`, which the page calls about once a second, moves a running
  batch's elapsed time between progress messages (#155). `emptyBatch(mode)` is the idle slice. Engine lint applies.
- `js/frame-clock.js` — `FrameClock`, which turns frame timestamps in
  milliseconds into a whole number of `sim.fixedStep` steps. It carries the
  remainder between frames and caps one frame at `sim.maxFrameTime`, which is
  `sim.maxFrameTime / sim.fixedStep` steps (16 at the current values). It takes
  timestamps as arguments and reads no clock.
- `js/rng.js` — `createRng(seed)`, the seeded mulberry32 generator the
  `Simulation` owns. Every random draw in the engine goes through it.
  `normalizeSeed(seed)` is the one seed check: every entry point that takes a
  seed throws the same `RangeError`, "A seed must be an integer; got <value>."
  (#187).
- `js/simulation.js` — `step(dt)` advances the fight by `dt` seconds and reads
  no clock. `run(duration)` repeats the fixed step `sim.fixedStep` for a
  duration, with a short last step, for headless runs. Each step handles
  energy, buffs, debuffs, cooldowns, the GCD, DoTs, and Premeditation expiry,
  applies armor to direct hits and to ticks (bleeds and nature damage can skip
  it), rolls DoT crits, runs the rotation, and records damage, the combat log,
  and per-ability totals (`abilityStats`, from `recordAbility`).
- `js/fight.js` — `runFight({ seed, duration, config })`, the headless entry
  point, and `createFight(seed, config)`, the `Rogue` and `Simulation` pair that
  `runFight` and the live page both build. `runFight` makes one `run(duration)`
  call, and returns a plain object: seed, simulated duration, total damage, DPS,
  a per-ability breakdown (`Simulation.abilityStats`), the combat log,
  `dataVersion` (which data snapshot the fight ran on), and `config` (the
  SimConfig it used). An option other than `seed`, `duration` and `config` is a
  `RangeError`. `createFight` returns `dataVersion` and `config` too. The same seed and duration give a deep-equal result, and it
  loads in Node with no DOM.
- `js/sim-runner.js` — `SimRunner` (P3-1, #136), the run controller over the
  fight: states `idle`, `running`, `paused`, `finished`; `run`, `pause`,
  `resume`, `stop`, `reset`, `advance(seconds)`, `onStateChange`, and `fight` (the
  running fight's rogue and simulation, for the live feed; read-only: the
  handle is frozen but the rogue and simulation are the live engine objects,
  so a caller reads them and never writes or steps them). `result` is the same
  object on every read, not a copy, and is live and read-only in the same way.
  `advance(duration)` runs a whole fight in one call; many small calls can
  leave it one step short until the next call (the carry, in Mechanics). The live page runs
  on it since #153 (`js/live-run.js`). Its default length is `batch.duration`
  (300 s). See the Run controller section of
  [Mechanics](docs/mechanics.md).
- `js/batch-runner.js` — The batch runner (S1, #144): `runBatch({ seed,
iterations, duration, config, signal, onProgress })` and the sliced,
  cancellable `BatchRunner` (`run`, `advance(iterations)`, `cancel`, `reset`,
  `onProgress`, an injected driver as on `SimRunner`). Iteration `i` is the fight
  of seed `deriveSeed(base, i)` (a documented hash, no repeats), so a batch is
  reproducible from its base seed however it is sliced. `RunningStats` is
  Welford's algorithm; the result has the mean, SD, min, max, 95% CI and a
  `Float64Array` of every iteration's DPS. Defaults are 1,000 iterations of 300 s
  (`batch.duration`). No DOM and no clock. The page runs it through
  `BatchClient` (#153). See
  [Batch runner](docs/batch.md).
- `js/batch-host.js` — The batch host (S4, #147): the message side of a batch.
  Takes `start` and `cancel` messages, drives a `BatchRunner` in slices of
  `batch.sliceBudget`, and posts `progress` (throttled to
  `batch.progressInterval`), `result` (the `dps` buffer transferred) and
  `error`. Touches no global: the host passes `post`, `now` and `schedule`. See
  [Batch worker](docs/worker.md).
- `js/batch-worker.js` — The module Web Worker (S4, #147): the batch host with
  `self.postMessage` and `performance.now()`. Posts `ready` once loaded. A host,
  like `js/main.js`.
- `js/batch-client.js` — `BatchClient` (S4, #147): `run(options, callbacks)`
  returns a promise of `runBatch`'s result (`callbacks.onProgress` for
  progress), `cancel()`, `terminate()`. Runs the batch in the worker, or on the
  main thread in slices where module workers are missing or the worker fails to
  load (`mode` `"auto"`, `"worker"` or `"main"`). The page's batch mode uses it (#153). See [Batch worker](docs/worker.md).
- `js/ability-breakdown.js` — The per-ability breakdown (S2, #145): a
  `FightBreakdown` subscribed to a fight's `hit` and `cast` events, and a
  `BatchBreakdown` that sums fights in order. Rows are keyed and sorted by
  ability id: casts, attempts, outcomes, hits, direct and tick damage, averages,
  share, and per-fight statistics over a batch. The batch result carries it as
  `breakdown`. The page's batch result carries it (#153); #154 draws it. See
  [Per-ability breakdown](docs/breakdown.md).
- `js/fight-metrics.js` — Fight metrics (S3, #146): aura uptime. A `FightAuras`
  subscribed to a fight's `aura` and `end` events, and a `BatchAuras` that sums
  fights in order. Rows are keyed by aura id and side (self or target): uptime
  in seconds and as a fraction of the fight, applications, refreshes, and for a
  stacking aura (Deadly Poison) stack-seconds, mean stacks and full-stack
  uptime, with per-fight statistics over a batch. The batch result carries it as
  `auras`. Also resource waste: a `FightResources` that reads the `end` event's
  `resources` (energy capped time and overflow, combo point waste) and a
  `BatchResources`, carried by the batch result as `resources`. Not yet used by
  the page. See [Aura uptime](docs/mechanics.md#aura-uptime-s3-issue-146) and
  [Resource waste](docs/mechanics.md#resource-waste-issue-146).
- `js/damage-timeline.js` — The damage timeline (S5, #148): a
  `FightTimeline` subscribed to a fight's `hit` events (the damage of each
  second, `timeline.bucketSeconds`) and a `BatchTimeline` that sums fights in
  order: the mean damage per second and the mean, lowest and highest cumulative
  damage. The batch result carries it as `timeline`. See
  [Batch charts](docs/charts.md).
- `js/build-label.js` — The batch build label (#154): `buildLabel(config)`
  gives "Combat 18/33/0 · 51/51 · Combat swords · Instant MH, Deadly OH" from
  the config a batch ran ("· level 40" before the points below 60, and "· N
  not simulated yet" after them, #204), `talentLabel(talents, level)` for the
  talents part alone (the talent tree's summary row), and `poisonName`. Engine
  lint applies; `js/main.js` hands both to the results panel.
- `js/talent-tree.js` — The talent tree's model (U6, #204): `createTalentTree(store)`
  fills the `talents` slice from `config.talents` and `config.talentLevel`
  and returns the actions the tree view calls (`setOpen`, `toggle`, `select`,
  `chooseTab`, `show`, `add`, `remove`, `setLevel`, `resetAll`, `undo`). The
  rules come from `js/talent-build.js` (#190), never re-implemented; the
  slice's `view` is everything the view draws (tiles, row gates, arrows, the
  detail pane, the effects box, the summary row). A legal build is written to
  `config` on every change; over the cap `talents.error` is set,
  `nextRunConfig` returns null and Run is off. No persistence and no links in
  U6 (Fran's U6 spec, D13, D15). Engine lint applies.
- `js/svg.js` — SVG and HTML as node descriptions (S5, #148): `el`, `text`,
  `toMarkup` (a string) and `toDom` (DOM nodes, no `innerHTML`). Escapes every
  text and attribute value and allows only a fixed list of tags.
- `js/charts.js` — The batch charts (S5, #148), plain SVG: `histogramChart`
  (the DPS of each iteration, the mean and its 95% CI) and `timelineChart`
  (damage over the fight, cumulative or per second), with `histogramTable` and
  `timelineTable` as their text alternatives, and the pure numbers under them
  (`histogramBins`, `niceTicks`, `linearScale`, `timelineSeries`). Not yet used
  by the page; `demo/charts.html` draws them from a real batch. See
  [Batch charts](docs/charts.md).
- `demo/charts.html`, `demo/charts.css`, `demo/charts-demo.js` — A development
  harness for the charts (#148): runs a batch through `BatchClient` and draws
  both charts and their tables without a reload. Open
  `http://127.0.0.1:8000/demo/charts.html` under `npm run serve`. Not deployed.
- `js/running-stats.js` — `RunningStats` (Welford's mean, SD, min, max and 95%
  CI, from #144) and `CompensatedSum` (Neumaier's compensated sum, #145).
- `js/event-stream.js` — The event stream (P3-2, #137): `EventStream` (`on`,
  the `"*"` wildcard, `onError`, queued in-order delivery, errors isolated per
  handler), `RingLog` (the combat log's ring buffer), and `SIM_EVENT_TYPES`
  (`cast`, `hit`, `resource`, `aura`, `proc`, `end`). `Simulation.on` and
  `SimRunner.on` use it. See [Events](docs/events.md).
- `js/rotation-schema.js` — The RotationRule JSON shape (R1, #138): a
  `{ schemaVersion, name, rules: [{ action, conditions }] }` list in priority
  order, and `rotationShapeProblems`, `isRotationShape` and
  `assertRotationShape`, a shape check (not the R4 validator). Read by the
  interpreter's load check (`compileRotation`). See
  [Rotation as data](docs/rotation.md).
- `js/rotation-conditions.js` — The rotation condition vocabulary (R2, #139):
  the types a rule's conditions can use (`resource`, `comboPoints`,
  `auraActive`, `auraRemaining`, `debuffActive`, `debuffRemaining`,
  `debuffStacks`, `cooldownReady`, `fightTime`, `fightTimeRemaining`,
  `energyToCap`, `abilityGranted`, `abilityUnlocked`), `conditionProblems` and
  `assertCondition` for their params, and the pure `evaluate(condition, state)`
  and `evaluateAll`. An aura or debuff that is not up counts as 0 s remaining.
  `evaluateTrusted` is `evaluate` without the check of the condition, for
  conditions the interpreter has already checked. See
  [Rotation as data](docs/rotation.md).
- `js/rotation-state.js` — `rotationState(rogue, simulation, { duration })`: the
  frozen, read-only state view the conditions read (time, resources, auras,
  debuffs, cooldowns, build and granted abilities), built from a fight without
  changing it. In seconds, no steps. Read by the interpreter's host at each
  decision point.
- `js/sim-config.js` — The SimConfig (E2-lite): `defaultConfig()` builds the
  default fight's inputs from `data/constants.js`, and `normalizeConfig(config)`
  validates a config (unknown keys, ranges, weapon types, poison ids, talent ids
  and ranks against the catalogue) and returns it in full form as a new object.
  A weapon speed below `config.minWeaponSpeed` (0.1 s) is rejected, because a
  speed near 0 never finishes a fight.
  `Rogue` takes the config. The character and weapons change the fight; Instant
  and Deadly Poison in `poisons` add procs (A5, #105); a selected talent build is validated and applied (D7, #106). See
  [SimConfig](docs/mechanics.md#simconfig).
- `js/data-version.js` — The data version (D11): `dataVersion`, a string
  `<generated>+<build>` such as `2026-10-20+1.60.1.70425`, read from
  `data/talentsforever/manifest.json`. `buildDataVersion(manifest)` validates a
  manifest. Every `runFight` result carries it.
- `js/rogue.js` — Energy, combo points, crit, hit, weapons, abilities, the
  placeholder Combat priority (`rotation.priority`), and the static modifier
  pipeline (`rogue.modifiers`, from `new Rogue(config, { modifiers })`). Attack
  power, crit and hit are read through it; swing haste comes from the
  simulation's pipeline.
- `js/rotation-interpreter.js` — The rotation interpreter (R3, #140):
  `compileRotation(rotation)` checks a RotationRule list once and
  `decide(rotation, host)` walks it at one decision point and casts through the
  `host` it is given (`state`, `canCast`, `onGcd`, `gcdClear`, `cast`, and an
  optional `usable`). A rule whose ability is not `usable` is passed over, never
  pooled for, so a Backstab rule on a sword falls through to the rules below it
  (#155). It knows no Rogue, step or frame. See
  [Rotation as data](docs/rotation.md).
- `js/rotation-host.js` — `rotationHost(rogue, simulation)`: the Rogue's side of
  the interpreter, with the build lock and `Ability.canCast`. Its `usable(id)` is
  `Ability.mainHandAllowed`: false for Backstab when the main hand is not a
  dagger.
- `js/rotation-default.js` — `defaultRotation()`: today's placeholder Combat
  rotation, with the Cold Blood rule, as a RotationRule list built from the
  `rotation.*` constants. It is the default of `SimConfig.rotation`.
- `js/rotation-io.js` — Rotation import and export (R6, #143):
  `exportRotation(rotation)` is the canonical JSON text (keys sorted, two-space
  indent, trailing newline) and `importRotation(text)` is `{ ok, rotation, errors }`:
  size-limited (`rotation.maxImportChars`), parsed as data (no eval), checked by
  `validateRotation`, every error a path and a message. Pure: no file, clipboard
  or DOM. See [Rotation as data](docs/rotation.md#import-and-export).
- `js/ability-data.js` — The abilities the engine casts, as data (D2):
  Sinister Strike, Eviscerate, Premeditation, Adrenaline Rush, Slice and Dice,
  Ghostly Strike, Backstab, Ambush, Blade Flurry, Rupture, and Hemorrhage. Each
  entry names its catalogue `id`, the constants row with its numbers, its icon,
  what it costs, gains and spends (each by resource id), its damage formula (`weapon`,
  `finisherRoll` or `dot`) and the aura it applies. It holds no number and no
  display name.
- `js/ability.js` — The one generic executor (D2). `Ability.cast` runs every
  ability: cooldown, the resource it spends, its cost (after the cost
  modifiers of that resource), the GCD (a remainder within `sim.tickEpsilon`
  counts as clear), the attack or DoT roll, the miss refund, the gain or spend,
  an expiring gift, the cooldown and the aura. It names no resource; it reads
  the entry (D3).
  `createAbilities(rogue)` builds `rogue.abilities` from the entries. An ability
  has an `id` (the catalogue's) and a display `name` read from the catalogue,
  and the engine keys cooldowns, auras and DoTs by id. There is no class per
  ability.
- `js/resource-data.js` — Energy and combo points as class data (D3): each
  resource's cap, start value, regen rule, cost modifier kind and what a target
  change does, all constants ids.
- `js/resource.js` — The `Resource` pool (D3). `gain`, `spend`, `spendAll` (the
  count it took, before the reset), `regenerate`, an expiry (Premeditation's
  rule) and `targetChanged`. The cap goes through `resourceMax` modifiers. Each
  pool counts what it lost to its cap: `cappedTime` and `overflow` (#146). The
  generic executor and the procs use these by resource id. See
  [Resources](docs/mechanics.md#resources).
- `js/procs.js` — The proc system (A4). `defineProc` and `defineRankedProc`
  validate and freeze a proc: a trigger (`onHit`, `onCrit`, `onWhiteHit`,
  `onAbility` by ability id or tag, `onDotTick`), a chance (`flat`, `ppm`,
  `perSpent` by the combo points spent), an optional internal cooldown, a
  filter (a modifier scope) and actions (`gainResource`, `applyAura`,
  `dealDamage`, `extraAttack`). `ProcRunner` runs them, drawing only when a
  proc could fire. Hosts pass them as `options.procs` to `Rogue` or
  `createFight`; `runFight` and its result are unchanged. `js/proc-data.js`
  reads the rank tables of Hack and Slash and Puncturing Wounds from
  `data/talent-effects.js`. See [Procs](docs/mechanics.md#procs).
- `data/talent-effects.js` and `js/talent-build.js` — What each talent does, as
  data (D5). One entry per talent id: modifier rank tables, procs, a granted
  ability or a `noDpsEffect` reason, and a hash of the rank text it was written
  from. All 17 Combat talents are in, and the six Assassination talents of the
  reference build (D8a: Malice, Improved Slice and Dice and Lethality in PR 1,
  Ruthlessness, Relentless Strikes and Cold Blood in PR 2).
  `expandTalents({ talent id: rank })` gives the `modifiers`, `procs` and
  `abilities`, and lists the talents with points but no effect or no entry.
  `validateBuild` and `applyBuild` (D7, #106) check a build (51 points,
  prerequisites, row gating) and apply it: `runFight` reads `config.talents`. See
  [Talent effects](docs/mechanics.md#talent-effects) and
  [Applying a talent build](docs/mechanics.md#applying-a-talent-build-d7-issue-106).
- `js/auras.js` — The aura model (A1). `AURAS` holds each buff and debuff as a
  definition (id, name, target, duration, stacks and stack rule, charges,
  refresh rule, hooks, effects: `haste`, `energyRegenMultiplier`,
  `dotDamageTaken`, `armorReduction`). Hemorrhage, Expose Armor and Deadly
  Poison are the target debuffs (A6). `defineAura` validates and freezes one. The engine reads effects by kind through
  `Simulation.auraEffects`, never by name. An aura can also carry `modifiers`
  (the A2 schema), and its `haste` and `energyRegenMultiplier` effects compile
  into them. See [Aura model and ids](docs/mechanics.md#aura-model-and-ids).
- `js/modifiers.js` — The modifier schema and pipeline (A2). A modifier is
  `{ kind, op, value, scope?, source? }`: one stat change for the attacks its
  scope names. `defineModifier` validates and freezes one, `expandRank` turns a
  talent's rank table into modifiers (rank 0 gives none), and `ModifierPipeline`
  combines static modifiers with the auras that are up. A kind with nothing to
  apply returns its base value untouched, which keeps a run with no modifiers
  identical to one without. A scope can name abilities, hands, weapon types,
  schools, tags and, for a resource's cap (`resourceMax`), resource ids. See
  [Modifiers](docs/mechanics.md#modifiers).
- `js/damage-tags.js` — The school and tags of a damage event (A3).
  `damageTags({ id, attackType, bleed })` gives `{ school, tags }`: the school
  is physical or nature, and the tags are `bleed`, `poison`, `white`, `yellow`
  and `finisher`. They come from the ability catalogue, `bleed.spells`,
  `poison.spells`, `nature.spells` and the attack type, never from a name.
  `Simulation.attackContext` passes them to the modifier scopes
  (`scope.schools`, `scope.tags`), and the armor skip for bleeds and nature
  damage reads them. See
  [Damage tags](docs/mechanics.md#damage-tags).
- `js/attack-resolver.js` — The Classic 1.12 melee attack table (A7): a white
  swing is one roll over miss, dodge, parry, glancing, block, crit and hit; a
  skill is a roll for miss, dodge, parry and block, then a crit roll. Parry and
  block exist only from the front (`config.target.behind`). Chances come from
  `k(id)`.
- `js/talents.js` — The talent catalogue (D4). `talentCatalogue` is built from
  `data/talentsforever/rogue.json` when the module loads: 53 talents with
  `tree.slug` ids, row, column, max rank, prerequisite (`req`), icon name and
  the text of every rank. `buildTalentCatalogue(snapshot)` builds one from any
  parsed export and validates it (D11): unique ids, `req` resolves in the same
  tree, `max` equals the rank texts, sane positions. `slugify(name)` is the id
  rule. `js/sim-config.js` uses it, so the live page loads it. It reads the
  snapshot through `js/snapshot.js`.
- `js/snapshot.js` — The one place the page and the engine import
  `data/talentsforever/rogue.json` (an import attribute). `js/talents.js` and
  `js/abilities.js` read it from here.
- `js/abilities.js` — The ability schema (D1). `abilityCatalogue` is built from
  the `spell_desc` text of each rogue ability's highest rank when the module
  loads: cost, cooldown, cast time, combo points awarded, % weapon damage, flat
  damage, per-combo-point damage and duration tables. What the text leaves out
  comes from `k(id)` (`abilities.apCoefficients`, `abilities.offGcd`,
  `bleed.spells`). `parseSpell` throws an `AbilityParseError` naming the spell
  and rank on text it cannot read. The engine reads an ability's display name
  and whether it starts the GCD from it (D2); the numbers still come from
  `k(id)`. See [Ability schema](docs/mechanics.md#ability-schema) and
  [Ability executor](docs/mechanics.md#ability-executor).
- `js/poisons.js` — The poison definitions (D9). `poisonCatalogue` is built from
  the `spell_desc` text of every rank of each rogue poison when the module
  loads: the chance per strike, the coating time, the charges and one effect
  (`damage`, `dot`, `healingReduction`, `slow` or `castSlow`). `poison.spells`
  says which poisons deal damage (Instant and Deadly); each other poison needs a
  reason in `poison.noDpsReasons`. `parsePoison` throws an `AbilityParseError`
  naming the poison and rank on text it cannot read. `poisonProcs(config.poisons)`
  turns the Instant and Deadly Poison definitions into procs (A5, #105). See
  [Poison definitions](docs/mechanics.md#poison-definitions-d9-issue-104) and
  [Poison procs](docs/mechanics.md#poison-procs-a5-issue-105).
- `js/weapon.js` — Swing timer, damage roll, and type for a main-hand or
  off-hand weapon. A speed below `config.minWeaponSpeed` throws a `RangeError`.
  `WEAPON_ATTACKS` gives the `main-hand` and `off-hand` ids and their labels.
- `js/gcd-meter.js` — Sets the GCD meter's ARIA range from
  `simulation.gcdDuration` (`gcd.duration`).
- `data/constants.js` — The number table above, exported as `CONSTANTS` and
  `k`.
- `data/talentsforever/` — Vendored talentsforever rogue export. `rogue.json`
  is the snapshot; `manifest.json` records the source URL, credit, licence,
  generated date, client build, and fetch date. The app never calls `fetch` for
  it. The live page imports `manifest.json` (for the data version) through
  `js/data-version.js`, and does not load `rogue.json` yet.
- `docs/mechanics.md` — Attack table, weapons, the GCD, energy, combo points,
  the placeholder Combat rotation, finishers, Premeditation, Adrenaline Rush,
  Blade Flurry, Slice and Dice, haste stacking, armor, bleeds and DoTs, the
  simulation clock, the headless fight, and the golden-seed tests. Formulas name constant ids. See
  [Mechanics](docs/mechanics.md).
- `docs/roadmap.md` — Phased plan, theme legend, the Phase 1 status, and the
  Phase 0 issue snapshot. See [Roadmap](docs/roadmap.md).
- `docs/charts.md` — The batch charts (#148): the timeline field, the bin and
  tick rules, accessibility, and the demo harness. See
  [Batch charts](docs/charts.md).
- `docs/phase-3.5-engine-rewrite.md` — Proposal for an event-queue engine, not
  scheduled. See [Phase 3.5](docs/phase-3.5-engine-rewrite.md).
- `docs/screenshots/` — Before and after screenshots of the live page, desktop
  and mobile, from issue #76 (`76-live-view/`).
- `docs/provenance.md` — Generated by `npm run provenance`. Do not edit it by
  hand.
- `scripts/serve.mjs` — Dev static server on `127.0.0.1`, port 8000 unless
  `PORT` is set.
- `scripts/provenance.mjs` — Checks `data/constants.js` and rewrites
  `docs/provenance.md`.
- `scripts/golden-update.mjs` — Lists the golden cases (`GOLDEN_CASES`), runs
  them, and compares each with its fixture in `test/golden/`. Dry run by
  default; `--write` rewrites the fixtures that differ. See Golden-seed tests.
- `scripts/check-icons.mjs` — `npm run icons:check`: sends a HEAD request for
  every icon name in the snapshot and reports the ones the CDN does not have;
  `--write` records them in `data/icons.json`. Not run in CI or by `npm test`.
- `scripts/scripted-fight.mjs` — Runs `runFight` with a list of casts in place
  of the placeholder rotation, for the scripted golden case.
- `scripts/bench.mjs` — `npm run bench`: times a seeded 5-minute `runFight` over
  several runs and prints the median and slowest. `--target-ms N` changes the
  target it compares with. The only place besides `test/bench.test.js` that
  reads a timer.
- `scripts/refresh-data.mjs` — Downloads the talentsforever rogue export,
  pretty-prints it with values unchanged, writes the manifest, and prints a
  review diff.
- `eslint.config.js` — Flat config. Engine modules (`js/**/*.js` except
  `js/main.js`, `js/views/`, and the worker hosts) must not touch `document` or `window`, must not read a clock
  (`performance`, `Date`), must not use `Math.random`, must not log, and must
  not contain game-number literals. View modules (`js/views/`) may import only
  other views, `js/gcd-meter.js`, `js/icons.js`, `data/constants.js` and the
  #148 helpers `js/svg.js` and `js/charts.js` (`no-restricted-imports`, #150,
  #154).
- `eslint/engine-purity.js` — Rule `engine-purity/no-numeric-literal`. A
  numeric variable initializer in an engine module fails lint, except `0`,
  `1`, and `-1`. Rule `engine-purity/no-display-name` fails a spell, aura or
  weapon display name used as a string or key in `js/`, outside `js/auras.js`
  and `js/weapon.js`.
- `test/abilities.test.js` — The ability schema: Sinister Strike R8, Eviscerate
  R9, Rupture R6 and Slice and Dice R2 against a pinned snapshot of their
  values, every other ability's shape, parity with the hand-set constants the
  engine still uses, the constants each missing number comes from, malformed
  text rejected with the spell and rank named (including an unknown cost unit,
  min damage above max and an unread damage sentence), a refreshed snapshot, deep
  freezing, and a failed import of `js/abilities.js`.
- `test/poisons.test.js` — The poison definitions: Instant Poison R6 and Deadly
  Poison R5 against the snapshot text, the other three top ranks, every rank
  against an independent number reader, which poisons are DPS and which are
  no-ops with a reason, the ids kept in step with `config.poisonIds`,
  `poison.spells`, `nature.spells` and the `poison.instant` and `poison.deadly`
  constants, and malformed text, tabs, ranks and constants rejected with the
  poison and rank named.
- `test/poison-procs.test.js` — The poison procs (A5): `poisonProcs` for each
  slot and poison, Instant Poison's chance, spell hit and damage draws, Deadly
  Poison's stacks, refresh, tick clock and tick damage, armor skipped, the
  proc rates and resist rate over many seeded fights, and a build with no
  poison drawing nothing extra.
- `test/ability-parity.test.js` — The generic executor (D2) against the skill
  classes it replaced, kept word for word in `test/legacy-skills.js`: the same
  totals, log, auras, cooldowns and random draws, in the same order, over four
  seeds, daggers, stats, modifiers and a fight that casts every ability in a
  changing order. Also: damage and duration at 0 to 6 combo points, one class
  for every ability, and every entry matching the catalogue.
- `test/auras.test.js` — The aura model: definition validation, refresh rules,
  stacks, hooks, effects by kind (haste, energy regeneration, DoT damage
  taken), the skill ids matching the catalogue, and the id-keyed breakdown.
- `test/modifiers.test.js` — The modifier schema and pipeline: validation, how
  each kind stacks, scope and conditions, rank tables, aura modifiers, the
  engine's hooks (hit table, crit, damage, armor, energy), and that a run with
  no effective modifiers is identical and draws the same random numbers.
- `test/modifier-hardening.test.js` — Tests added after the QA of the modifier
  pipeline (PR #115), each pinning something the first tests left open: a DoT's
  damage modifier at cast, the hit table and the tick's crit read with the
  attack's context, armor ignore, the miss refund of the cost paid, a swing's
  hand, aura modifiers with several stacks, regeneration over a step that
  straddles an aura, the `modifiers.stacking` rows, and the rejected shapes.
- `test/resources.test.js` — Resources as data (D3): no energy or combo point
  names in the executor, a second resource run through it, the max-energy
  modifier, `Resource` gain, spend, regen, expiry and target change,
  Premeditation on the pool, and the cap counters (#146): gain and regeneration
  overflow, capped time from the moment the cap is reached, a fight that never
  casts capped throughout, and no change to what is reported.
- `test/damage-tags.test.js` — Damage modifier hooks by tag (A3): the tags of
  each kind of event, `scope.schools` and `scope.tags` (validation, OR within a
  key, fail closed), "+30% Rupture" and "+20% poison" as data through a real
  cast, a poison hit and tick, white and yellow, finishers, the order against
  crit and armor, the armor skip following the tags, and a fight with no
  matching modifier staying identical and rng-neutral.
- `test/combat-talents-as-data.test.js` — Every Combat talent classified, the
  11 DPS-relevant ones in `data/talent-effects.js` checked against the snapshot's
  rank text, and a full build run through a fight.
- `test/talent-effects.test.js` — The talent effects data (shape, text hashes,
  proc chances against the text), `expandTalents` (ranks, order, rank 0 drawing
  nothing, bad input), the data check refusing a bad entry, the Assassination
  shapes of D8a, and the reference build (Assassination 18 / Combat 33 /
  Subtlety 0) decoded from its talentsforever.com link
  (`data/reference-build.js`) and run through `createFight`.
- `test/assassination-talents-as-data.test.js` — Malice, Lethality and Improved
  Slice and Dice (D8a PR 1) against the snapshot's rank text at every rank, the
  `duration` modifier kind (scope, floor, stacking), the Slice and Dice length
  by rank, Lethality's 2.0 to 2.2 crit multiplier, and untalented fights
  unchanged.
- `test/assassination-procs-as-data.test.js` — Ruthlessness, Relentless Strikes
  and Cold Blood (D8a PR 2) against the snapshot's rank text, the procs'
  chances and draws, Cold Blood's sure crit and when its charge is spent, the
  rotation rule (only when granted), and the Rogue `abilities` option.
- `test/carry-overs-124.test.js` — The Puncturing Wounds `onAbility` trigger,
  `expandTalents` refusing inherited keys and an unknown id at rank 0, and the
  import-time data check observed from a subprocess.
- `test/two-tree-modifiers.test.js` — Assassination, Subtlety and Combat
  modifiers combined in one pipeline.
- `test/adrenaline-rush.test.js` — Adrenaline Rush cooldown from the export,
  and recast timing.
- `test/attack-resolver.test.js` — Attack-table bands, damage, and rejected
  inputs.
- `test/target-debuffs.test.js` — Target debuffs (A6): Hemorrhage's +15% on
  Rupture only and its 15 s expiry and refresh, stacks (cap, refresh, the
  `highest` rule, separate ids), charges (use, restore, expiry), Expose Armor
  and Deadly Poison in the data, and inherited names and unknown effect kinds
  rejected.
- `test/bleed-armor.test.js` — DoT crits, and armor skipped on bleeds and
  nature ticks.
- `test/breakpoints.test.js` — The narrow breakpoint: 519 px narrow, 520 px
  wide, the views on the shared query, and every narrow `@media` block in
  `styles.css` on the same one.
- `test/bench.test.js` — The benchmark: the CI bound on a 5-minute fight, the
  median and report, the script's arguments, and its exit status (with a fake
  benchmark or a target of 0 or a million ms, never the real 50 ms).
- `test/ci-workflow.test.js` — CI step order, including a re-indented workflow
  fixture.
- `test/constants.test.js` — The constant table's shape and the values the
  engine reads.
- `test/data-version.test.js` — `dataVersion`: its format, that it matches the
  manifest and the snapshot, bad manifests, and that `runFight`, `createFight`
  and the scripted harness all carry it.
- `test/engine-lint.test.js` — The engine lint rules (numeric literals, console,
  `document` and `window`, clocks, `Math.random`, display names) and Prettier
  coverage.
- `test/finisher.test.js` — Finishers need a combo point.
- `test/event-stream.test.js` — `EventStream` and `RingLog`: subscribe, the
  wildcard, unsubscribe, queued delivery under re-entrancy, error isolation and
  surfacing, the ring's bound and order.
- `test/sim-events.test.js` — The events of a fight: a payload-shape test for
  each type (the `end` event's `resources` included), `hit` damage adding up to `totalDamage`, results and rng draws
  equal with and without subscribers, the ring-buffer log, and the runner's
  `on` (pause, stop and run from handlers, state handlers that throw or re-enter).
- `test/fixed-step.test.js` — `Simulation.run`: the fixed step, total time,
  a 5-minute fight, and results that do not depend on how a duration is split.
- `test/gcd-epsilon.test.js` — GCD readiness within `sim.tickEpsilon`.
- `test/gcd-flags.test.js` — Which abilities start the GCD.
- `test/gcd-meter.test.js` — The GCD meter's ARIA range.
- `test/golden.test.js` — The golden-seed tests: each case against its fixture
  (without `dataVersion`, which is not pinned), the failure message, and the
  update script's dry run and `--write`.
- `test/golden/` — The pinned `runFight` results, one JSON file per golden
  case. Written only by `npm run golden:update -- --write`. Prettier skips the
  directory.
- `test/pages.test.js` — The data-credit footer and the Pages workflow. Every
  published `js` file must be imported by the page.
- `test/live-view.test.js` — The live page as a view of the engine: `FrameClock`
  (the first frame, the carry, the frame cap, `restart`), `createFight`, a live
  fight against `runFight`, and `js/main.js` on a stand-in page (idle at load
  with the seed in the bar, Run, pause, resume, a late frame from a
  backgrounded tab, the finish at 300 s equal to `runFight`, Stop then Run,
  Reset, and a batch end to end on the main thread).
- `test/live-run.test.js` — The live run (#153) with hand-driven frames: the
  store mirrors the runner, the finish equals `runFight`, the frame cap, pause
  and a stale frame, Stop then Run reproduces the fight, reset, Run again with
  new options, `clear()`, and that no view writes `run.state`.
- `test/run-controls.test.js` — The run control bar (#153): the field checks
  and messages, every live state and transition (each control in each
  state), batch mode against #154 §10 with a stand-in client (0 of N, progress,
  done, Stop keeps partial, error, mode lock), the config snapshot, the
  view on a stand-in document (labels, focus, announcements, aria), and the
  narrow bar (summary, Run or Pause slot, closed settings, the errors link,
  reading order per width, and the sticky and 44 px rules in the CSS).
- `test/premeditation.test.js` — Premeditation combo points and expiry.
- `test/provenance.test.js` — The provenance check, the CLI, and the generated
  report.
- `test/refresh-data.test.js` — The talentsforever refresh, manifest, and
  snapshot diff.
- `test/rng.test.js` — `createRng`: the mulberry32 sequence, seeds, and the
  `Simulation`'s one shared rng, with a check that no engine file uses
  `Math.random`.
- `test/rolls.js` — A helper, not a test file. `testRng` and `setRoll` give a
  `Simulation` a fixed roll.
- `test/rotation.test.js` — Placeholder Combat priority, including the Slice
  and Dice refresh boundary.
- `test/run-fight.test.js` — `runFight`: the result shape, the per-ability
  breakdown, the capped log, determinism, different seeds, a 5-minute fight, and
  a run in Node with the browser globals poisoned, and rejected inputs
  (including `runFight()` and `runFight(null)`).
- `test/results-panel.test.js` — The batch results panel (#154): per-fight
  figures (total = mean × fight length, SE from the 95% interval), the
  energy-cap flag at its 5% and 10-fight edges, sorting, the time estimate;
  every state (empty, 0 of N with the inert previous result, running, done,
  partial, Stopped 0 fights, error) with no panel buttons; the charts after
  the tables, drawn by the #148 helpers with their tables and mode radios;
  the live region; and the view on a stand-in DOM (aria-busy, sort in place
  with focus, the timeline mode swap).
- `test/build-label.test.js` — `buildLabel` and `poisonName` (#154): the
  reference build with the Combat swords and default rotations, no talents,
  tied and top trees.
- `test/views.test.js` — The page views (#149) on a recording stand-in
  document: no two views query the same element, controls toggle `run.state`
  through the store, results formatting, the visualiser redraws only on
  `frame`, and each view's unsubscribe; the visualiser drawing hand-made plain
  slices with no fight behind them (#150); Phase 3: aura bars, stacks,
  labels and the low-time cue, energy at cap, the spend flash, proc chips and
  "↳" rows, reduced motion, stepping the log while paused, and the throttled,
  opt-in announcements.
- `test/live-feed.test.js` — The live feed (#150): its reading equals the
  engine's state at every frame of sword and dagger fights over uneven frames,
  it is plain frozen data, a reading does not change after later steps, its
  log equals `runFight`'s, it subscribes to `hit`, `resource`, `aura` and
  `proc` only, `stop()`, and it leaves the fight unchanged; Phase 3: aura
  durations and stacks equal the last aura event's, cooldown lengths the
  ability data's, proc counts and names, `fromProc` rows, the last spend and
  the last buff moment, all against the recorded event stream.
- `test/sim-runner.test.js` — `SimRunner`: the transition table, invalid
  actions, state subscriptions, a run to the end equal to `runFight`, pause and
  resume, Stop then Run and the rng draws, the driver, options, the public
  names (no steps), and `fight` (#153).
- `test/batch-runner.test.js` — The batch runner: the seed scheme (equal to an
  independent statement of it, pinned values, no repeats up to the batch limit,
  unrelated base seeds), the statistics against a two-pass reference, every
  iteration equal to `runFight` with its derived seed, the same result for the
  same base seed however the work is sliced or driven, progress, cancel (handler,
  signal, driver, before the start), the transition table, options, the
  `advance` count (a whole number of 1 or more, or Infinity, #145), and that the
  module names no step or frame and uses only `SimRunner`.
- `test/batch-worker.test.js` — The batch worker: the host through its
  messages with a fake clock and queue (results equal to `runBatch` to the byte,
  the `dps` transfer, the progress throttle and order, slices, cancel and its
  bound, stale ids, one batch at a time, errors and recovery), a real
  `worker_threads` thread running `js/batch-worker.js` through `BatchClient`
  (`test/batch-worker-thread.js` gives it a `self` over Node's `parentPort`),
  the client's modes, fallback, errors and
  options with fake workers, and that the worker file is thin.
- `test/ability-breakdown.test.js` — The per-ability breakdown: its total equal
  to the fight's, rows that add up, agreement with the engine's own records,
  casts from `cast` events, sorting by id, recorded events, mid-fight reads,
  pooled batch averages, back-filled per-fight statistics, compensated sums, the
  batch result's breakdown against each iteration's fight however it is sliced,
  and that the module names no step or frame and imports no engine.
- `test/fight-metrics.test.js` — Aura uptime: hand-built fights with known
  uptimes, stacks and full-stack time, auras still up at the end, agreement with
  the engine's own auras over every step, Adrenaline Rush and Blade Flurry at
  their full duration, recorded events, mid-fight reads, pooled batch values,
  back-filled per-fight statistics, the batch result's `auras` against each
  iteration's fight however it is sliced, and that the module names no step or
  frame and imports only the aura data and the statistics. Resource waste: the
  end event's counts, combo points a builder-only rotation wastes at 5, the
  opening seconds at the cap, capped time equal to the engine's energy step by
  step, pooled batch values and the batch result's `resources` however it is
  sliced.
- `test/damage-timeline.test.js` — The damage timeline: buckets (the part
  bucket at the end, a hit at the end, a fight of no length), validation, the
  timeline against the fight's own total, batch means and compensated sums, the
  fixed length, the last cumulative mean against the mean total damage, the
  same timeline however the batch is sliced, and that the module is pure.
- `test/svg.test.js` — The node descriptions: escaping of text and attributes,
  hostile strings, the tag list, refused event-handler attributes, markup order,
  and `toDom` on a stand-in document.
- `test/charts.test.js` — The charts: bins (counts that add up to `n`, no
  variance, one iteration, no value), ticks, scales, number formatting, the
  timeline series, the charts and tables as markup against snapshots of a fixed
  dataset, accessibility (title, desc, labels, tables), escaping, and contract
  tests on a real batch result.
- `test/snapshots/` — The chart snapshots for `test/charts.test.js` (`.snap`
  files, exact markup). Rewritten only with `UPDATE_SNAPSHOTS=1`.
- `test/rotation-equivalence.test.js` — The Combat rotation as JSON against the
  code rotation it replaced (`test/legacy-rotation.js`): the same fights, field
  for field, log and rng draws included, over builds, weapons, poisons, seeds
  and lengths.
- `test/rotation-interpreter.test.js`, `test/rotation-host.test.js`,
  `test/rotation-default.test.js`, `test/rotation-config.test.js`,
  `test/can-cast.test.js` — The walk rule, the host, the default rotation and
  the docs example, `SimConfig.rotation`, and `Ability.canCast` against `cast`.
- `test/rotation-schema.test.js` — The RotationRule shape check: the examples
  in `docs/rotation.md` pass, the Combat example matches the rotation
  constants, each wrong shape is rejected with a message that names it, the
  four documented decisions, and the limits.
- `test/rotation-conditions.test.js` — The condition vocabulary: the examples
  in `docs/rotation.md` are checked, every comparing type at its boundary for
  every operator, an aura or debuff that is not up counts as 0, granted and
  unlocked with and without a build, every bad param rejected with its name,
  `evaluate` pure, and the conditions agree with the code rotation's questions
  on every step of real fights.
- `test/rotation-io.test.js` — Export is canonical (sorted keys, same text from
  any key order, the documented example), export, import, export is the same
  text, and a rotation read back runs the same fight (totals, log, rng draws) for
  every preset, the default and a custom rotation over several seeds; every
  refusal (not text, too large, not JSON, wrong version, unknown field,
  invalid rule) with its path; `__proto__` and `constructor` keys; nothing run.
- `test/rupture-ap.test.js` — Rupture's AP totals and the length guard.
- `test/scripted-fight.test.js` — The scripted-cast fight used by the golden
  cases: cast order, waiting, errors (a missing or non-object argument, unknown
  or inherited ability names), and restoring the rotation.
- `test/serve.test.js` — The static server's port and path checks, and that the
  page's script graph, including the JSON module, is served with the right
  content types.
- `test/sim-config.test.js` — The SimConfig: defaults, merging, strict
  validation of every field with its message, talent ranks, idempotence, the
  default fight being unchanged, a config reaching the rogue, the result's
  `config` repeating a fight, `runFight`'s unknown-option check, `given[id]`
  read once, and the weapon speed lower bound (a minimum-speed fight finishes).
- `test/store.test.js` — The store's contract (#149): frozen state, no-op
  sets, subscribe and unsubscribe, update, batches (nested, set back, a
  throwing `fn`), delivery order, a set from inside a subscriber, a throwing
  subscriber, and argument errors.
- `test/simulation.test.js` — Console silence, buff and cooldown duration,
  Adrenaline Rush energy, buff and debuff lists, and DoT expiry.
- `test/slice-and-dice.test.js` — Slice and Dice refresh, swing haste, and
  `haste.stacking`.
- `test/step.test.js` — `Simulation.step(dt)`: time moves only by `dt`, rejected
  steps, no wall-clock reads, and the same state for the same seed and steps.
- `test/talents.test.js` — The talent catalogue: the 17, 17 and 19 tree counts,
  unique ids, every field against the snapshot, known talents end to end, the
  lookups, the freeze, and the load-time validation with deliberately broken
  data (including a failed import of `js/talents.js` with `js/snapshot.js`).
- `test/tooling.test.js` — The dev package's scripts and Node `engines` range.
- `test/weapon.test.js` — Weapon damage, the off-hand penalty, and swing-timer
  overshoot.
- `js/icons.js` — Icon names to hot-link URLs, the fallback icon, and the
  `attachIconFallback` image handler (D10). See [docs/icons.md](docs/icons.md).
- `data/icons.json` — The icon names `npm run icons:check` found missing (none).
- `img/` — JPEG ability icons. Each entry in `js/ability-data.js` sets its own
  file. `img/garotte.jpg` and `img/stealth.jpg` are not referenced.
  `.prettierignore` excludes the directory.
- `package.json` — `"type": "module"`, the npm scripts, the Node `engines`
  range, and the dev dependencies. No runtime dependencies.
- `package-lock.json` — Lockfile `npm ci` installs from.
- `.github/workflows/ci.yml` — The lint, test, and provenance job described
  above.
- `.github/workflows/pages.yml` — Deploys `index.html`, `styles.css`,
  `talent-tree.css`, `js/`, `data/`, and `img/` from `main` to GitHub Pages.
- `.gitignore` — Ignores `node_modules/` and macOS's `.DS_Store`.
- `.prettierignore` — Ignores `img/` and `test/golden/`.

## Data credit and licence

Talent, spell, and poison data comes from
[talentsforever.com](https://talentsforever.com/) and is used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The vendored copy
in `data/talentsforever/` is pretty-printed, with values unchanged.

Icons are hot-linked from a public image CDN and are not part of this
repository or its CC BY 4.0 licence ([docs/icons.md](docs/icons.md)).

World of Warcraft names, icons, and tooltip text belong to Blizzard
Entertainment. This project is not affiliated with Blizzard Entertainment or
talentsforever.com.

## Contributing

One issue per pull request. Branch off `main`, and name the branch for that
issue. Reference the issue in the pull request so it closes when the pull
request merges. If `main` moves, merge `main` into the branch. Do not
force-push. Peer review comes first, then QA, and the coordinator merges.

New game numbers go in `data/constants.js` and are read with `k(id)`. Sign an
`assumption` or `wowf-designer` `ref` as `<owner>, <date>: <reason>` (for
example `James, 22 Oct 2026: ...`). Use `classic-1.12` where WoW Forever data
is missing. After a constants change, run `npm run provenance` and commit the
generated `docs/provenance.md`. Do not edit that file by hand.
