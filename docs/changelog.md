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
