# WoW Forever rogue DPS simulator

A vanilla JavaScript app, loaded as ES modules, with no build step. It
simulates rogue DPS on WoW Forever from talents, skills, poisons, and weapon
and character stats. There is no item database. Static hosting on GitHub Pages
is planned; this file does not include a public URL while that work is open
([#5](https://github.com/james-attree/wowf_dps_sim/issues/5)).

## Status

Phase 0. Combat is the first spec. The page runs the single rotation in
`js/rogue.js`. Talent ranks in the vendored snapshot are not applied yet.

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
directory, so this only works from the repository root.

Open the page through one of those servers. A `file://` URL will not load it.
`index.html` pulls in `js/main.js` with `<script type="module">`, and browsers
do not import ES modules from `file://`.

## Development

`npm ci` installs the dev dependencies (`eslint`, `@eslint/js`, and
`prettier`). The package has no runtime dependencies.

| Script                 | Runs                                                   |
| ---------------------- | ------------------------------------------------------ |
| `npm test`             | `node --test` (everything in `test/`)                  |
| `npm run lint`         | `eslint . --max-warnings 0`, then `prettier --check .` |
| `npm run provenance`   | `node scripts/provenance.mjs`                          |
| `npm run data:refresh` | `node scripts/refresh-data.mjs`                        |
| `npm run serve`        | `node scripts/serve.mjs`                               |

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on `push` and
`pull_request`, on `ubuntu-latest`, with Node 22. The job checks out the repo,
installs with `npm ci`, then runs `npm run lint`, `npm test`, and
`npm run provenance`. Refreshing the talentsforever snapshot stays a local
command.

## Constants and provenance

Every game number lives in [`data/constants.js`](data/constants.js). An entry
is `{ value, unit, source, ref, note, retune }`. Engine code reads the number
with `k(id)`, which returns `value` or throws if the id is unknown. Keep raw
numbers out of engine modules and out of this README. Formulas will be written
against those ids in `docs/mechanics.md`
([#26](https://github.com/james-attree/wowf_dps_sim/issues/26)).

`source` is one of:

- `wowf-export` — taken from the talentsforever snapshot. Re-read it when that
  snapshot refreshes.
- `wowf-designer` — James's knowledge of WoW Forever.
- `classic-1.12` — a Classic 1.12 reference value. This is the fallback
  wherever WoW Forever data is missing, and it stays until WoW Forever is
  measured.
- `cataclysm` — a later mechanic WoW Forever borrows on purpose.
- `assumption` — a default or sample input. Sign the `ref` as
  `James, 22 Oct 2026: <reason>`.
- `engineering` — simulator machinery, not a game rule. Leave `retune` off.

`npm run provenance` checks `data/constants.js`, then rewrites
[`docs/provenance.md`](docs/provenance.md). The command fails if a `ref` is
missing, is only a dash, or is a placeholder (`TBD`, `N/A`, `?`, `tbd later`,
or text containing `fill in` or `no recorded owner decision`), or if `source`
is not one of the tags above. `docs/provenance.md` is generated. Do not edit
it by hand. Its retune list is every constant whose source is not
`wowf-export` and whose `retune` flag is on.

## Module map

- `index.html` — Simulator page (damage, energy, combo points, the GCD,
  effects, cooldowns, and the combat log). Loads `styles.css` and `js/main.js`
  as an ES module.
- `styles.css` — Dark layout and meters for that page.
- `js/main.js` — UI entry: the animation frame, pause control, and DOM updates.
  The only file under `js/` that may use `document` and `window`.
- `js/simulation.js` — Steps energy, auras, cooldowns, the GCD, DoTs, and
  Premeditation expiry, runs the rotation, and records damage and the combat
  log.
- `js/rogue.js` — Energy, combo points, crit, hit, weapons, abilities, and the
  priority rotation.
- `js/skill.js` — Shared `Skill` cast path, plus Sinister Strike, Eviscerate,
  Premeditation, Adrenaline Rush, Slice and Dice, Ghostly Strike, Backstab,
  Ambush, Blade Flurry, Rupture, and Hemorrhage.
- `js/attack-resolver.js` — One-roll melee outcomes (miss, dodge, parry,
  glancing, crit, hit) for white swings and skills. Chances come from `k(id)`.
- `js/weapon.js` — Swing timer and damage roll for a main-hand or off-hand
  weapon.
- `js/gcd-meter.js` — Sets the GCD meter's ARIA range from
  `simulation.gcdDuration` (`gcd.duration`).
- `data/constants.js` — The number table above, exported as `CONSTANTS` and
  `k`.
- `data/talentsforever/` — Vendored talentsforever rogue export. `rogue.json`
  is the snapshot; `manifest.json` records the source URL, credit, licence,
  generated date, client build, and fetch date. The app never fetches it.
- `docs/` — `docs/provenance.md` only, generated by `npm run provenance`.
- `scripts/serve.mjs` — Dev static server on `127.0.0.1`, port 8000 unless
  `PORT` is set.
- `scripts/provenance.mjs` — Checks `data/constants.js` and rewrites
  `docs/provenance.md`.
- `scripts/refresh-data.mjs` — Downloads the talentsforever rogue export,
  pretty-prints it with values unchanged, writes the manifest, and prints a
  review diff.
- `eslint.config.js` — Flat config. Engine modules (`js/**/*.js` except
  `js/main.js`) must not touch `document` or `window`, must not log, and must
  not contain game-number literals.
- `eslint/engine-purity.js` — Rule `engine-purity/no-numeric-literal`. A
  numeric variable initializer in an engine module fails lint, except `0`,
  `1`, and `-1`.
- `test/` — Node's built-in tests for the attack table, weapons, finishers,
  Premeditation, the simulation clock, the GCD meter, constants, provenance,
  the data refresh, the static server, engine lint, the dev package, and the
  CI workflow.
- `img/` — JPEG ability icons. Skills set their own file; the `Skill`
  default is `img/stealth.jpg`. `img/garotte.jpg` is not referenced.
  `.prettierignore` excludes the directory.
- `package.json` — `"type": "module"`, the npm scripts, the Node `engines`
  range, and the dev dependencies. No runtime dependencies.
- `package-lock.json` — Lockfile `npm ci` installs from.
- `.github/workflows/ci.yml` — The lint, test, and provenance job described
  above.
- `.gitignore` — Ignores `node_modules/`.
- `.prettierignore` — Ignores `img/`.

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
assumption `ref` as `James, 22 Oct 2026: <reason>`. Use `classic-1.12` where
WoW Forever data is missing. After a constants change, run
`npm run provenance` and commit the generated `docs/provenance.md`. Do not
edit that file by hand.
