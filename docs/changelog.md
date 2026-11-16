# Changelog

## #297 PR4

The page default moves from sword Combat to dagger Combat. The main hand is
The Lobotomizer, a dagger. The off hand is Dark Iron Destroyer, an axe.

Changed default values (old → new), seed 1, 300 s:

- preset: Combat swords (`combat-swords-temp`) → Combat daggers (`combat-daggers`)
- race: none → human
- attack power: 767 → 608
- crit: 22.45% (0.2245) → 17.9705% (0.179705), 17.97% rounded
- hit: 7% (0.07) → 8.7% (0.087)
- expertise: none → 11 rating (1.1%)
- main hand: sword 100–187 at 2.6 → dagger 54–102 at 1.8, skill 300
- off hand: sword 90–168 at 2.5 → axe 71–134 at 2.4, skill 300
- poisons: Instant / Deadly (unchanged)
- DPS, seed 1, 300 s: 323.47 → 307.27

Presets no longer set weapons or the character sheet. Goldens keep the old
weapons and sheets from `data/legacy-sheets.js`. Old `?s=2` links still
decode against that legacy page. The read-only "sheet from an older link"
screen is left for PR5.

### Expectations retuned (coordinator call 16 Nov, James delegated 15 Nov, option A)

Group 1 is pinned to `data/legacy-sheets.js`. No expected number in these
files changed: `weapon-skill-target-level`, `combat-daggers-sheet`,
`subtlety-daggers`, `assassination-daggers`, `weights-support`,
`weights-model`, `manual-fight`.

Group 2, old → new:

- `build-label.test.js`: page label `Combat 16/35/0 · 51/51 · Combat swords (temporary) · Instant MH, Deadly OH` → `Combat 13/35/3 · 51/51 · Combat daggers · Instant MH, Deadly OH`.
- `results-panel.test.js`: the build name in two fight lines, `Combat swords (temporary)` → `Combat daggers`. The `16/35/0` stays; that fixture still uses the reference talent build.
- `config-form.test.js`: rotation choice `combat-swords-temp` → `combat-daggers` (two tests). The summary name and rule count follow Combat daggers. The speed test sets the main hand to a sword first, so 2.4 then 1.7 stay. The level-40 custom build clears the per-hand skill of 300 so the lower cap still accepts the config.
- `talent-tree.test.js`: page summary `Combat 16/35/0 · 51/51` → `Combat 13/35/3 · 51/51`. Empty setups clear weapon skill 300 before a lower level. The reference-build summary stays `16/35/0`.
- `rotation-builder.test.js`: the two draft tests write the draft onto `combat-daggers` instead of `combat-swords-temp`. The restored rotation is the dagger list (`sinister-strike` → `backstab` in the builder slot). `blood-fury` at index 9 stays.
- `start-preset.test.js`: the open card `combat-swords-temp` / `Combat swords (temporary)` → `combat-daggers` / `Combat daggers`. Custom's talent line `16/35/0` → `13/35/3`. A Combat swords pick leaves the page weapons and the sheet (attack power stays the edited 1234, not 767). The race test clears human before it expects a missing race. The level-40 undo clears weapon skill 300 first.
- `live-view.test.js`: the stub document accepts a text node in `append`. No expected string changed.

`preset-build.test.js` asserts that applying each preset leaves the weapons
and the character sheet unchanged. James 15 Nov 2026, to the coordinator: 'Remove the link between weapons and talent/rotation choices.' (supersedes the 10 Nov #340 preset-sets-weapons rulings)

Browser expectations that moved with the same default:

- `character-screens.browser.mjs`: talents chip `Combat 16/35/0 · 51/51` → `Combat 13/35/3 · 51/51`.
- `share-link.browser.mjs`: the preset link's talents are Combat daggers, not Combat swords. The encoded length of the first-load deleted-rule share link, measured past the origin, is 75. It was 64 when the page was the codec baseline. `PRESET_LINK_MAX` is still 64.
- `saved-setup.browser.mjs`: Reset and a storage failure that reloads the page show the new sheet (608 attack power, 0.179705 crit, 0.087 hit, human) without the baked expertise 11 and without per-hand weapon skill 300. The version 2 link does not carry those fields; the version 1 save does. A broken save still opens the legacy sheet.
- `haste-field.browser.mjs`: the one-line check stays at 360 and 390. The stats summary uses the full row and 0.65rem below 64em so the no-haste line fits.
- `manual-fight.browser.mjs`: Cold Blood's key is `9` → `8`. Mutilate is not on the board when the off hand is an axe.

Lowering the talent level now blanks a per-hand weapon skill above the new level's cap (coordinator call 16 Nov, James delegated 15 Nov).
