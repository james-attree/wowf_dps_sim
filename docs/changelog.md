# Changelog

## #287 PR 7a

The compact start-panel typography is one rule block instead of two copies (Kira's #417 N6). CSS cannot join the phone query and the start-column container query with "or", so the start panel's content sits in a new `.start-body` wrapper, and each query names that wrapper as the `start-compact` container, which the single block queries. The container copy's `.start-panel` padding rule is dropped: a container query cannot style its own container, so it never applied. Nothing changes on screen: computed styles and boxes of the start panel and everything in it are identical before and after at 12 widths from 320 to 1440, at 100% and 150% text, under Inter and DejaVu. New browser tests cover the start column under 16rem at 1024 / 150% text (Kira's #417 N2), the 30em to 32.5em band and the first width past it, and 500, 768 and 1024 at 100% and 150% text with no sideways scroll and the cards and race field reachable above the dock (Kira's #417 N3). coordinator call 19 Nov (James delegated).

## #287 item 8

Docs only. The plan's old stat-weights figure of about 70 s stays on the record, and the current measurement is 73.1 s (the page says about 73 s). The README names the yellow-hit cap as 9% at a +3 target, which is miss plus hit suppression at level 60 against level 63. The roadmap no longer leaves the #285 keyboard test and tap-target audit open: both are in PR #378. The sharing section says a talents-over-cap press shows the notice and does not copy. coordinator call 19 Nov (James delegated).

## #287 7d

The leftover "Undo closes on a reload" browser test runs again, against the current Subtlety daggers card. The touch Fix check measures the phone dock (the run strip and the area nav), not the strip alone. The two weapon-skill cases are gone: `#cfg-character-weaponSkill` is no longer on the page. The target-level cases at 100% and 150% cover that dock measurement. The skipped armour-of--1 browser case is retired; the browser test "an armour of -1 shows the banner once, and the repaired save stays" covers it. A saved setup that soft-resets a known field is rewritten, so the banner shows once; a save that also carries an unknown field is left as it is. Picking Custom when only the level changes says "Level set to 60. Nothing else changed." A lenient save read covers Manual, a bad fight mode, and no fight mode. coordinator call 19 Nov (James delegated).

## #287 PR2

Status chip and rule borders (ok, error, warning) use shared tokens so every edge is at least 3:1 against its fill, the card, and the page (WCAG 1.4.11). Covers `.chip.is-ok`, `.chip.is-error`, `.chip.is-warning`, `.rule.has-error`, `.rule.has-warning`, `.cond.has-error`, and `.rot-banner.is-error` / `.is-warning`. `--connector-unlit` is unchanged. Closes Kira's #413 N1. coordinator call 19 Nov (James delegated).

## #287 PR4

A GCD or cooldown refusal, and the Manual "Wait until … ready" label, round the time left up to the next tenth, so a remainder under a tenth reads "0.1 s" and never "0.0 s" while it still applies. The label and the "On cooldown, … left" refusal show the same tenth. An exact tenth stays that tenth. The run clock still floors its tenths. coordinator call 19 Nov (James delegated).

## Phone dock overlap

The five start-preset cards and the race field under them sit above the phone dock again at 320 / 100% and at 360 / 100% and 150% text. The compact grid is two across on a narrow phone, including at 100% text, and the header share control is icon-sized so the title stays on one line. Long card names wrap inside the column instead of clipping, each card's accessible name is the full label, and the share icon keeps a tooltip and paints in forced colours. Follow-up to #329. coordinator call 19 Nov (James delegated).

## #287 PR1

A share link and a saved setup keep Manual. The link grows a `manual` part at bit 13, with no payload. Manual writes that part and not the `mode` part, because Manual is live. Scripted writes nothing new, so old links stay the same bytes and still read as Scripted. A link that carries both `manual` and `mode` is corrupt (coordinator call 19 Nov (James delegated)). Ignoring that corrupt link silently is the coordinator's #332 ruling. A part bit past `manual` (bit 14, `bytes(0, 0x80, 0x80, 0x01)`) is still `newer`. The saved setup writes `run.fightMode` only when it is `manual`; a reload opens Manual and Live. coordinator call 19 Nov (James delegated).

#287 item #327 N1 (weapon skill focus order) is closed with no change. Weapon skill is no longer a typed field, so the item no longer applies. coordinator call, 19 Nov (James delegated).

## #388

Selecting Manual also selects Live fight, in the same turn, and the Run button uses the live label. Average stays disabled while Manual is selected, with the reason "Manual fights are live, step by step". Choosing Scripted leaves Live selected. Reset to defaults returns Scripted and Average. coordinator call 15 Nov (James delegated).

## #403

Non-text component edges that were still hard-coded `#54452b` or `#81745c` now use `--control` (`#7d6c50`), so they meet 3:1 against their backgrounds (WCAG 1.4.11). The leftover text uses (`.value-divider`, the inactive sort icon) move to `--text-muted`, which stays above 4.5:1. `--connector-unlit` stays `#54452b` for the decorative unlit talent path. coordinator call 16 Nov (James delegated).

## #297 PR7

Read-only stats and named gear builds (issue #385). The typed character sheet, the weapon form and the cramped phone Stats summary are gone. Stats on Character › Stats are derived from the equipped gear. A legacy sheet (an older link or save) is read-only, with a banner and a way to start from the wowsims Forever P1 default or from an empty set.

Named builds: save, load, rename and delete. Empty or whitespace names, duplicate names and rename collisions are rejected in the UI and model layer (`js/gear-builds.js`). The store is not edited and never throws. A `{ ok: false, reason: "storage" }` result is shown in an accessible live message (`#gear-builds-live`). Reset to defaults clears the setup on screen and does not remove saved builds.

Race is still on Character. Changing it re-derives `config.character` so the doll and the sim stay in agreement; it does not drop `config.gear`. The out-of-date banner names only what the user changed (the race), not derived attack power or crit. coordinator call 16 Nov, James delegated 15 Nov.

Gear builds need level-60 base stats: Run is blocked with "Base stats are only known for level 60." `data/constants.js` `sheet.classBase` is a single level-60 rogue row (wowsims `ClassBaseStats ClassRogue`); `deriveSheet` refuses any other level because levels 1–59 have no curve in this snapshot. coordinator call 16 Nov, James delegated 15 Nov. A legacy sheet still runs at any level. An empty main hand still blocks Run; an empty off hand is still MH-only (coordinator call 16 Nov, James delegated, settled in PR6).

Presets leave gear alone (no behaviour change here; #398 shipped it). coordinator call 16 Nov, James delegated 15 Nov. James 15 Nov 2026, to the coordinator: 'Remove the link between weapons and talent/rotation choices.' (supersedes the 10 Nov #340 preset-sets-weapons rulings)

The item picker's title is an `h2` so the heading order stays intact with the picker open. It names the slot with a verb: "Choose main hand", "Choose chest". The 3-column doll at 1024 / 100% does not mid-word wrap (`overflow-wrap: normal; hyphens: auto`). `overflow-wrap: anywhere` is only in the stacked phone and narrow-container layouts.

Race help on Character › Stats is "Your race's bonuses are already included in these stats." On a legacy sheet it is "These numbers were entered without racials; the race adds them." because those frozen numbers were typed without racials and the fight still adds the race's modifiers.

When the chosen rotation's abilities require a weapon type (ability-data `requiresMainHand` / `requiresOffHand`) and the equipped hand does not match, a short note appears next to the Rotation preset, for example "This preset's rotation uses daggers; your main hand is a sword.", followed by a Go to Gear link. It does not block Run and does not change gear. A preset whose actions have no such requirement (Combat swords) does not raise this note. coordinator call 16 Nov (James delegated).

## #297 PR6

The Character › Gear screen is a paper doll and a type-to-search item picker (issue #384, pull request #405). Stats on the gear screen are derived from the equipped items. The wowsims Forever P1 default is already on the page: The Lobotomizer (dagger) in the main hand, Dark Iron Destroyer (axe) in the off hand, human, seed 1 / 300 s is 307.27 DPS.

An empty main hand blocks Run: "This setup can't run: Equip a main-hand weapon." An empty off hand is legal and runs main-hand only; the doll and the sim agree. coordinator call 16 Nov (James delegated), per the Q10 ruling of 15 Nov.

On a phone the picker is a dialog with a focus trap and sits above the run dock (Fran's P2). The stacked-list `@container` reset stays below the `.gear-slots-right` / `<64em` media rule so right-hand icons stay on the left when the 20rem fallback stacks (Fran's P3).

Chip contrast is left to #403.

## #297 PR5

A share link can carry gear. The part is appended: a slot mask, then each worn item's id, enchant (0 is none) and suffix (0 is none). A gear link has no character or weapons part. Decode derives the sheet. Race and level stay on the character. The first-load link is 9 characters (`2.DYEgBQA`). Old links and saves decode to the same config as before, and `isLegacySheet` marks them. The read-only screen for that sheet is PR7.

`wowf_dps_sim.setup` accepts an optional `config.gear`. `wowf_dps_sim.gear` stores named item builds (`js/gear-store.js`). Reset to defaults does not remove them. PR6 and PR7 consume that store. A save, rename or remove that does not reach storage returns `{ ok: false, reason: "storage" }`. A stored change returns `{ ok: true, build }` (remove returns `{ ok: true }`). Empty names, whitespace-only names, duplicate names and rename collisions are rejected by `js/gear-builds.js` before the store is written. The store still does not check names and never throws.

`combat-swords-temp-337` stays live so the legacy sword link stays `2.BgA`. The `-297` dagger bases are frozen. New links use the no-weapon `-383` bases.

An empty gear slot mask is `GEAR_MARKER_P1_BSCOMBAT_92E67A7A`, the frozen `p1_bscombat` list at wowsims commit `92e67a7ae61f984e8a1fc006ebdeb012f31ac7d1`, not the current page default (coordinator call 16 Nov, James delegated 15 Nov). The typed character sheet and the weapon form are gone (PR7). A race change re-derives the sheet and keeps `config.gear`, and the link still carries the gear part. Weapon skill and target level stay beside gear. The first-load link is 9 characters (`2.DYEgBQA`), was 133.

Browser short-link lengths, characters after the address (old → new): a preset with the main-hand speed edited 64 → 57; a deleted rotation rule 75 → 37.

Dropping gear because the sheet or a weapon was edited is not a separate settings change in the out-of-date line. A gear edit that keeps a gear list still is.

Saved-setup `PAGE_FORM` (old → new): the page-default link decode without `character.expertise` and without per-hand `weaponSkill` → the full first-load config, expertise 11 and weapon skill 300 on both hands. Reset matches that config, and seed 1 / 300 s is 307.2716836384642.

Share-link lock expectations (old → new), coordinator call 16 Nov (James delegated 15 Nov), in `test/short-links-306.test.js` only:

- A preset rotation on the default build was `length <= 8` for every preset. Combat swords stays `2.BgA` (5). Combat daggers is `2.BpABA6gDYKMCDg` (16, ceiling 24). Assassination daggers is `2.DgT_AcgB9gKIBAK0AdAC9AMC` (26). Subtlety daggers is `2.DwT_AcgB9gKIBAK0AdAC9AMC` (26).
- `LOCKED_CONTENT` gains hashes for `combat-daggers-383`, `assassination-daggers-383` and `subtlety-daggers-383`. No existing hash changed.
- The frozen `subtlety-daggers-297` base stays locked. The last base was `subtlety-daggers-297` → `subtlety-daggers-383`.
- The `newer` probe was part bit 12 (`bytes(0, 0x80, 0x20)`) → part bit 13 (`bytes(0, 0x80, 0x40)`). Bit 12 is the gear part.

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
