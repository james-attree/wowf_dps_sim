# Stat weights results view (issue #282)

The Results area's third kept view, at `#results/weights`. The engine that
produces the numbers is `js/stat-weights.js` (issue #374); this document is
the view's contract. Product copy uses **about 73 s**, not 70 s, for the
default 9 × 1,000 fights. Precise is not offered yet, so it is not in the
idle copy.

## Coordinator calls, 15 Nov (James delegated)

Scout accepted Fran's ten recommended decisions. Each is a
**coordinator call 15 Nov (James delegated)**:

1. **Idle copy covers the default run only.** The estimate is “About 73 s on a
   desktop. On a phone, longer. Background tabs and a sleeping phone slow it
   down.” Precise is not mentioned until the page has that control.
2. **A cancel marks the table stale only if the build changed.** Cancel
   discards the in-progress calculation (`statWeights` resolves to `null`).
   The last finished table stays. The help reads: “Cancel throws away this
   calculation; the last finished table stays, marked out of date if you
   changed the build.”
3. **Rows sort by AP equivalent, engine order as tie-break.** Descending
   `apEquivalent`; engine order (`attackPower`, `mainHand`, `offHand`,
   `crit`, `hit`, `haste`) breaks ties. Null or “Not measured” rows go last.
4. **2 decimal places per point and ±, 1 decimal place for the AP
   equivalent.** Reuse `formatNumber`. The AP figure is prefixed “= ” and
   suffixed “ AP”, with no interval of its own.
5. **The ± column folds below 64em** into the per-point cell as
   `2.34 ± 0.12`. The AP column stays.
6. **Text stands alone, with an aria-hidden CI bar from 64em up.** The bar
   shows the half-width relative to `|dpsPerPoint|`, capped at 100% of the
   cell. No bar under `prefers-reduced-motion` or on the folded layout.
7. **Fight length and seed go in the label and do not make the table stale**,
   matching Average. Only the build (`ran.weights.config` versus
   `state.config`) marks a kept table out of date.
8. **The previous table hides during a run.** It is kept in memory and is
   not a partial table.
9. **The done announcement is just “Stat weights finished.”** The live
   region does not read the table.
10. **Missing rows show “Not measured”.** All six row labels stay, so the
    table shape does not jump when a row id is absent from `result.rows`.

## Placement

`#results` and `#results/average` stay Average. `#results/weights` is this
view. An unknown sub still drops to `#results`. The page title is
`Stat weights · WoW Forever Rogue Simulator`. The desktop run column and
`#results-card` keep showing Average; `#results-panel` is hidden while this
view is showing, as it is for Live fight. The column also carries the
stat-weights summary line from issue #283, once a run has finished.

## Cap note and Run blocking (coordinator call 15 Nov, James delegated)

The yellow-hit cap note is computed from `ran.weights.config`, the
settings the table was run with, so a stale table's note matches its
figures. Changing hit or the levels marks the table out of date but does
not rewrite the note.

An invalid Fights field does not block Run stat weights, because the
calculation always uses 1,000 fights. Duration, seed, and real build
errors (the stats form, talents, rotation) still block it. Average's
blocking is unchanged: Fights still blocks Run average in batch mode.

## Across screens (issue #283)

coordinator call 15 Nov (James delegated). Leaving the Stat weights view
keeps the calculation running.

- **Progress badge.** While a run is going, the Results item on the area
  nav (the phone dock and the wide nav) shows a gold `3/9` badge, with the
  hidden words “stat weights running”. The badge is also drawn while the
  Results area is showing, so leaving the screen is not a special case.
  The phone dock strip (hidden on Results, shown after leaving) reads
  “Stat weights” and “Running · 3/9”.
- **Run disabled.** Average and Live Run (the Run bar and the Results
  buttons) are disabled with the reason “Stat weights are running”. The
  fight fields stay editable: the in-progress run already has its
  snapshot. The weights Cancel button stays enabled.
- **Wake lock.** A screen wake lock is requested for every weights run
  (Precise is not offered yet; a phone run still benefits). If the API is
  missing or the request fails, the running view and the Run bar status
  show “Keep the screen on”. The lock is released when the run ends, and
  asked for again if the tab comes back to the foreground mid-run.
- **Desktop column card.** Once a run has finished, `#results-card` shows
  a line of the form “Stat weights: crit 19.2 · MH 2.5 · OH 2.5 · hit 1.7
  · AP 1.0 (ran at 10:02)”, with a link to `#results/weights` labelled
  “open” (`aria-label` “Open the stat weights”). Every measured row is
  listed, in table sort order (AP equivalent descending), at 1 decimal
  place. An out-of-date table appends the existing short stale line,
  “{Names} changed after this ran.” The line is absent until the first
  finished run. During a re-run the line is marked as the previous
  result, “Stat weights running · 3/9 · Previous: crit 19.2 · … (ran at
  10:02)”, using the same progress count as the dock; the stale short is
  omitted while the new run is going. A first run (no previous table)
  keeps the card hidden. This stays one line rather than the Average
  card's greyed “Previous average” block.

Scout accepted the eight design decisions as built, with one condition
on the fourth, each a **coordinator call 15 Nov (James delegated)**:

1. A screen wake lock is requested for every weights run, not only for
   Precise (which is not offered yet).
2. Card rows are in table sort order (AP equivalent descending).
3. The card lists every measured row at 1 decimal place, with the short
   names AP, MH, OH, crit, hit and haste, and no ellipsis.
4. The last finished card stays during a re-run, **on the condition**
   that it is clearly marked as the previous result (the line above).
5. The Results nav badge is shown while a run is going, including on
   the Results area itself.
6. Fight fields stay editable during a weights run.
7. A stale table appends the existing short line on the card, except
   while a new run is going (see 4).
8. The wake-lock fallback “Keep the screen on” is on the weights view
   and the Run bar status; the dock keeps the short “Running · 3/9”.
