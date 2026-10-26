# WoW Forever rogue DPS simulator

A vanilla JavaScript app, loaded as ES modules, with no build step. It
simulates rogue DPS on WoW Forever from talents, skills, poisons, and weapon
and character stats. There is no item database.

## Hosting

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) deploys the static
site from `main`. The site deploys to
https://james-attree.github.io/wowf_dps_sim/ once Pages is enabled. Set the
repository source to GitHub Actions under Settings > Pages. The workflow
publishes `index.html`, `styles.css`, `js/`, `data/`, and `img/`.

## Status

Phase 0 is complete. Phase 1, the deterministic headless engine, is built and
merged; it is complete once James signs it off. Combat is the first spec. The
page runs the placeholder Combat rotation in `js/rogue.js`:
Blade Flurry, Adrenaline Rush, then Slice and Dice or Eviscerate at the
finisher combo points, otherwise Sinister Strike. Talent ranks in the vendored
snapshot are not applied yet. The [roadmap](docs/roadmap.md#phase-1-status) has
the Phase 1 issue list and the benchmark result.

## How the engine fits together

A fight is a seed plus the steps it is given. `js/rng.js` is the one source of
randomness. `Simulation.step(dt)` is the only way time moves, and
`Simulation.run(duration)` calls it with the fixed step `sim.fixedStep`.
`runFight({ seed, duration, config })` in `js/fight.js` builds a fight, runs it and
returns plain data, with no DOM. `config` is an optional SimConfig (character,
weapons, talent ranks, poisons); leave it out for the default fight. The live page builds the same fight with
`createFight` and feeds it whole fixed steps, so a seed gives the same fight
live and headless. The golden tests pin four `runFight` results, and
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

`npm ci` installs the dev dependencies (`eslint`, `@eslint/js`, and
`prettier`). The package has no runtime dependencies.

| Script                  | Runs                                                   |
| ----------------------- | ------------------------------------------------------ |
| `npm test`              | `node --test` (everything in `test/`)                  |
| `npm run lint`          | `eslint . --max-warnings 0`, then `prettier --check .` |
| `npm run provenance`    | `node scripts/provenance.mjs`                          |
| `npm run data:refresh`  | `node scripts/refresh-data.mjs`                        |
| `npm run golden:update` | `node scripts/golden-update.mjs`                       |
| `npm run bench`         | `node scripts/bench.mjs`                               |
| `npm run serve`         | `node scripts/serve.mjs`                               |

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on `push` and
`pull_request`, on `ubuntu-latest`, with Node 22. The job checks out the repo,
installs with `npm ci`, then runs `npm run lint`, `npm test`, and
`npm run provenance`. Refreshing the talentsforever snapshot stays a local
command.
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
crits. A change to a rule, a constant, or the engine that moves
those numbers fails the test, and the message lists the fields that changed.

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
  effects, cooldowns, and the combat log). Loads `styles.css` and `js/main.js`
  as an ES module.
- `styles.css` — Dark layout and meters for that page.
- `js/main.js` — UI entry: the animation frame, pause control, and DOM updates.
  It is a view of the engine: it builds the fight with `createFight`, turns
  each frame timestamp into whole fixed steps with `FrameClock`, calls
  `Simulation.step`, and draws. It shows the random seed it picks at page load
  in the header. The DPS readout is high at 00:00 (see
  [Live page](docs/mechanics.md#live-page)). The GCD status reads "On cooldown" while `gcd > 0`. The only
  file under `js/` that may use `document`, `window`, or the clock; lint
  rejects those, and `Math.random`, in every other file under `js/`.
- `js/frame-clock.js` — `FrameClock`, which turns frame timestamps in
  milliseconds into a whole number of `sim.fixedStep` steps. It carries the
  remainder between frames and caps one frame at `sim.maxFrameTime`, which is
  `sim.maxFrameTime / sim.fixedStep` steps (16 at the current values). It takes
  timestamps as arguments and reads no clock.
- `js/rng.js` — `createRng(seed)`, the seeded mulberry32 generator the
  `Simulation` owns. Every random draw in the engine goes through it.
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
- `js/sim-config.js` — The SimConfig (E2-lite): `defaultConfig()` builds the
  default fight's inputs from `data/constants.js`, and `normalizeConfig(config)`
  validates a config (unknown keys, ranges, weapon types, poison ids, talent ids
  and ranks against the catalogue) and returns it in full form as a new object.
  A weapon speed below `config.minWeaponSpeed` (0.1 s) is rejected, because a
  speed near 0 never finishes a fight.
  `Rogue` takes the config. The character and weapons change the fight; talents
  and poisons are only carried until their effects land. See
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
- `js/skill.js` — Shared `Skill` cast path, plus Sinister Strike, Eviscerate,
  Premeditation, Adrenaline Rush, Slice and Dice, Ghostly Strike, Backstab,
  Ambush, Blade Flurry, Rupture, and Hemorrhage. Premeditation does not start
  the GCD. `Skill.cast` treats a remainder within `sim.tickEpsilon` as ready.
  Rupture's AP term is length-guarded with the damage and duration tables,
  and Rupture sets `bleed` so its ticks can skip armor. A skill has an `id`
  (the catalogue's) and a display `name`, and the engine keys cooldowns, auras
  and DoTs by id.
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
  schools and tags. See [Modifiers](docs/mechanics.md#modifiers).
- `js/damage-tags.js` — The school and tags of a damage event (A3).
  `damageTags({ id, attackType, bleed })` gives `{ school, tags }`: the school
  is physical or nature, and the tags are `bleed`, `poison`, `white`, `yellow`
  and `finisher`. They come from the ability catalogue, `bleed.spells`,
  `poison.spells`, `nature.spells` and the attack type, never from a name.
  `Simulation.attackContext` passes them to the modifier scopes
  (`scope.schools`, `scope.tags`), and the armor skip for bleeds and nature
  damage reads them. See
  [Damage tags](docs/mechanics.md#damage-tags).
- `js/attack-resolver.js` — One-roll melee outcomes (miss, dodge, parry,
  glancing, crit, hit) for white swings and skills. Chances come from `k(id)`.
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
  and rank on text it cannot read. Data only: the engine does not read it until
  D2. See [Ability schema](docs/mechanics.md#ability-schema).
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
  `js/main.js`) must not touch `document` or `window`, must not read a clock
  (`performance`, `Date`), must not use `Math.random`, must not log, and must
  not contain game-number literals.
- `eslint/engine-purity.js` — Rule `engine-purity/no-numeric-literal`. A
  numeric variable initializer in an engine module fails lint, except `0`,
  `1`, and `-1`. Rule `engine-purity/no-display-name` fails a spell, aura or
  weapon display name used as a string or key in `js/`, outside `js/skill.js`,
  `js/auras.js` and `js/weapon.js`.
- `test/abilities.test.js` — The ability schema: Sinister Strike R8, Eviscerate
  R9, Rupture R6 and Slice and Dice R2 against a pinned snapshot of their
  values, every other ability's shape, parity with the hand-set constants the
  engine still uses, the constants each missing number comes from, malformed
  text rejected with the spell and rank named (including an unknown cost unit,
  min damage above max and an unread damage sentence), a refreshed snapshot, deep
  freezing, and a failed import of `js/abilities.js`.
- `test/auras.test.js` — The aura model: definition validation, refresh rules,
  stacks, hooks, effects by kind (haste, energy regeneration, DoT damage
  taken), the skill ids matching the catalogue, and the id-keyed breakdown.
- `test/modifiers.test.js` — The modifier schema and pipeline: validation, how
  each kind stacks, scope and conditions, rank tables, aura modifiers, the
  engine's hooks (hit table, crit, damage, armor, energy), and that a run with
  no effective modifiers is identical and draws the same random numbers.
- `test/damage-tags.test.js` — Damage modifier hooks by tag (A3): the tags of
  each kind of event, `scope.schools` and `scope.tags` (validation, OR within a
  key, fail closed), "+30% Rupture" and "+20% poison" as data through a real
  cast, a poison hit and tick, white and yellow, finishers, the order against
  crit and armor, the armor skip following the tags, and a fight with no
  matching modifier staying identical and rng-neutral.
- `test/combat-talents-as-data.test.js` — Every Combat talent classified, the
  11 DPS-relevant ones written as data and checked against the snapshot's rank
  text, and a full build run through a fight.
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
  published `js` file must be imported by the page, except `js/abilities.js`
  until D2 reads it.
- `test/live-view.test.js` — The live page as a view of the engine: `FrameClock`
  (the first frame, the carry, the frame cap, `restart`), `createFight`, a live
  fight against `runFight`, and `js/main.js` on a stand-in page (the seed in the
  header, pause, resume, and a late frame from a backgrounded tab).
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
- `img/` — JPEG ability icons. Skills set their own file; the `Skill`
  default is `img/stealth.jpg`. `img/garotte.jpg` is not referenced.
  `.prettierignore` excludes the directory.
- `package.json` — `"type": "module"`, the npm scripts, the Node `engines`
  range, and the dev dependencies. No runtime dependencies.
- `package-lock.json` — Lockfile `npm ci` installs from.
- `.github/workflows/ci.yml` — The lint, test, and provenance job described
  above.
- `.github/workflows/pages.yml` — Deploys `index.html`, `styles.css`, `js/`,
  `data/`, and `img/` from `main` to GitHub Pages.
- `.gitignore` — Ignores `node_modules/` and macOS's `.DS_Store`.
- `.prettierignore` — Ignores `img/` and `test/golden/`.

## Data credit and licence

Talent, spell, and poison data comes from
[talentsforever.com](https://talentsforever.com/) and is used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The vendored copy
in `data/talentsforever/` is pretty-printed, with values unchanged.

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
