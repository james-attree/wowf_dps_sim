# Handover

Where the work stands on main at `590c00c8` (#434), written 25 Nov 2026.
PR numbers and merge commits below were checked against GitHub. Anything not
checked that way is marked unverified.

## Shipped since 19 Nov

One line each, from the PR title. The parenthetical is the merge commit.

- [#417](https://github.com/james-attree/wowf_dps_sim/pull/417) `d8741fb3` — Fix phone dock overlap on start-preset cards (#329 regression).
- [#418](https://github.com/james-attree/wowf_dps_sim/pull/418) `b8724527` — #287 PR4: refusal times round up so they never read 0.0 s.
- [#420](https://github.com/james-attree/wowf_dps_sim/pull/420) `2ab91d85` — Raise status chip and rule borders to 3:1 (#287 PR 2).
- [#421](https://github.com/james-attree/wowf_dps_sim/pull/421) `152f79c3` — #287 7d: unskip leftover browser tests, one-shot reset banner, clearer Custom level-only line.
- [#423](https://github.com/james-attree/wowf_dps_sim/pull/423) `8c3eebb8` — Wrap enchant hints and start-card names without clipping (#287 PR 3).
- [#424](https://github.com/james-attree/wowf_dps_sim/pull/424) `cf2e8827` — #287 item 8: docs nits for the old 70 s, the hit cap, and the wrap-up.
- [#426](https://github.com/james-attree/wowf_dps_sim/pull/426) `f5a0916b` — #287 PR 5: manual board polish (+7c).
- [#427](https://github.com/james-attree/wowf_dps_sim/pull/427) `8ae8f60d` — Pin the Results name, nav words, and Link copied announcer (#287).
- [#429](https://github.com/james-attree/wowf_dps_sim/pull/429) `a729d48c` — #287 PR 7a: compact layout tests and dedupe.
- [#431](https://github.com/james-attree/wowf_dps_sim/pull/431) `dde81bbe` — #287 PR 7b: copy fixes.
- [#434](https://github.com/james-attree/wowf_dps_sim/pull/434) `590c00c8` — #287 7a layout follow-up: phone condition ✕ on the first line when it fits; pin the phone header and the board's bottom padding (#432). Closes #432. Ships #322 phone ✕ and the #299 P5 header pin. Leaves out #263 trees 2+1 and #376 item 2 (the #434 changelog and the PR body both say so).

Earlier, from [changelog](changelog.md) and [roadmap](roadmap.md): #287 PR1
keeps Manual on the share link and in a saved setup (a link with both
`manual` and `mode` is corrupt; ignoring that corrupt link is the
coordinator's #332 ruling). #388 selects Live when Manual is selected. #403
moves hard-coded component edges onto `--control`. #297 PR6 and PR7 are the
gear doll, derived stats, and named gear builds. The talent-rework rows
TR-01 through TR-09 and TR-11 are merged; TR-10 (#340) is open and parked.
The roadmap's Phase 5 list is a 1 Nov snapshot and still says "open" for
issues that have since merged (#285 is one: its keyboard test and tap-target
audit landed in PR #378, per the #424 changelog entry).

## Unfinished #287

[#287](https://github.com/james-attree/wowf_dps_sim/issues/287) is still
open. Its body (200% text: the over-cap chip on the Talents label, sideways
scroll, clipped selects, landscape chrome) still has every Done-when box
unchecked. That body was last updated 15 Nov, before the PRs above, so those
boxes are not a fresh measurement. Whether L1–L5 still fail on main was not
rechecked for this note.

#431's changelog says the preset hint names the parts that already match
(the "already match" branch, stretch item 4). Folding the repeated "Not
your race" rule chips into the context line (stretch item 6) is called out
there as not in that PR, so it did not ship.

#434 shipped two of those four layout items: #322 phone ✕, and the #299 P5
header pin. The same changelog entry leaves the other two out: #263 trees
2+1 (three across needs a wider Talents column; Fran accepted 2+1 for
launch) and #376 item 2 (keeping the folded CI and AP figures on one line
overflows at 320 / 150% text). They are still open.

## Known limits

- **#427 N1.** Under DejaVu, the 320px / 150% mid-word nav check (one
  client rect per word) does not fail when `overflow-wrap: normal` or
  `flex-wrap: wrap` is dropped on its own. The words still fit. Only the
  computed-style pins (`overflow-wrap: normal`, `flex-wrap: wrap`) catch
  that drop. Seen while proving the #427 mutants.
- **#426 Fran N1.** Slot names can break mid-word with no visible hyphen.
  Accepted: an axe / WCAG 2.5.3 clash. Recorded as Fran's finding on #426;
  the finding text is not re-quoted from a review comment here.
- **#426 Kira N1.** The `(hover: hover)` restriction was unpinned on #426.
  #429's changelog says a ready slot does not take the hover look when
  `hover` is `none`, which catches a dropped `@media (hover: hover)`
  wrapper (Kira's #426 N1). So that pin landed in #429, after #426.
- **#429 Kira N1.** At 150% text the first view clips the manual board's
  lower slot row under the dock. Pre-existing. #429 did not change the
  screen: the row scrolls clear, and a browser test pins the scrolled and
  Tab positions.
- **#429 Kira N2.** On #429 the board's `padding-bottom` was unpinned
  (M14/M15). #434 pins the computed `padding-bottom` to at least the dock's
  height (changelog, #287 7a layout follow-up).
- **#434 Kira N1.** At 1024px and 150% text the header share button wraps
  under the title. The #434 PR body records the same wrap (116 px at
  1024 / 150%, and 122 px at 521 / 150% in DejaVu) as a note for Fran, left
  out of that PR. Fran confirmed main does the same. The label "Kira N1"
  is this brief's; it is not in the #434 PR body.
- **#431 Kira N1 / M6.** `startCards()` builds the Custom card from
  `pageDefaultConfig()` (`js/start-preset.js`). The unit test still expects
  the literals `"13/35/3"` and `"The page defaults: Combat daggers talents
and rotation"` (`test/start-preset.test.js`). The Custom short line is
  also compared with `pointsText(pageDefaultConfig().talents)`. A change to
  the defaults fails those literals; they are not derived inside the test.
- **#421.** A save that soft-resets a known field is rewritten. A save that
  also carries an unknown field is left as it is (changelog, #287 7d).
- **Warning border.** `--warning-border` is `#866a34` and `--control` is
  `#7d6c50`. Their contrast is about 1.002:1 (computed for this note, not
  taken from a test). A later hue pass is still needed. No issue number for
  that pass was checked.

## Backlog

- [#275](https://github.com/james-attree/wowf_dps_sim/issues/275) is open:
  spec UI copy and a "Partly simulated" talent state (legend, tile badge,
  accessible name, detail line). Its Done-when boxes are unchecked.
- [#287](https://github.com/james-attree/wowf_dps_sim/issues/287) is open.
  The nit lists are the N-items in the section above, plus the unchecked
  L1–L5 boxes in the issue body. Stretch item 6 (repeated "Not your race"
  chips) did not ship in #431.

## Open decisions

Undecided. None of these is a decision by James.

- Subtlety poisons. The page assumes Instant on the main hand and Deadly on
  the off hand. `docs/rotation.md` says James has not ruled Subtlety poisons.
- A Premeditation number key (#373 N1). The gap is in
  [manual-fight.md](manual-fight.md): number keys cover the first ten slots
  only, and Premeditation is slot 13 on the Subtlety daggers bar. That doc
  says James has not ruled on a key, or on whether later slots share the
  `1`–`0` row.
- The restyle milestone. No recorded decision was found in the changelog.
  What the milestone contains was not verified against a GitHub milestone.

Resolved, not open: #398 is merged (`94841dcf`, #297 PR4) and shipped
James's sentence "Remove the link between weapons and talent/rotation
choices." The changelog records that sentence as his, to the coordinator,
and says presets leave gear alone.

## Tests and CI

From `package.json`:

```sh
npm run lint          # eslint . --max-warnings 0 && prettier --check .
npm test              # node --test
npm run test:browser  # node --test "browser-tests/*.browser.mjs"
npm run provenance    # rewrites docs/provenance.md; fails on a bad ref
npm run golden:update # dry run; add -- --write to rewrite fixtures
```

`npm test` does not rewrite goldens or seeds. Regenerating fixtures is only
for a change that is meant to move results.

CI is `.github/workflows/ci.yml`. It runs on every `push` and every
`pull_request`: lint, `npm test`, browser tests, provenance, a check that
`docs/provenance.md` is committed, talent coverage, and racial coverage.
Node 22. `pages.yml` is the pages workflow, not the test gate.
