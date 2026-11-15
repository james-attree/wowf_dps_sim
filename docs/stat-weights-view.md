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
view is showing, as it is for Live fight.

Issue #283 (the dock badge, disabling Average/Live Run while weights run, a
wake lock, and a desktop column card) is out of scope here.
