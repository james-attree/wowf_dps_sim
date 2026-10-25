# Roadmap

A WoW Forever rogue DPS simulator covering talents, skills, poisons, and
weapon and character stats, with no item database. It will have a talent
tree UI, a drag-and-drop rotation builder, Run/Pause/Stop controls, and
history in localStorage. Combat comes first. Assassination, Subtlety, and
hybrids use the same modifier system.

James reviews at the end of each phase. The next phase does not start
without his go-ahead.

Formulas are in [docs/mechanics.md](mechanics.md). Constants, sources, and
the retune list are in [docs/provenance.md](provenance.md). This roadmap
does not copy them. Finisher priority is deferred to Phase 1's rotation
builder. Later-phase task ids get GitHub issues when that phase starts.

## Phases

| Phase   | Focus                                                                            | Themes                           | Exit criterion                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 | Make today correct and testable, vendor the data, one home for every number      | Q, F, D0, D13, D14               | CI green, resolver tested, known bugs fixed, snapshot pinned, every constant has provenance. Tracked by the `phase-0` label (#1 to #26 plus follow-ups such as #49 and #59). |
| Phase 1 | Deterministic headless engine                                                    | E1 to E11                        | A seeded 5-minute fight runs in Node in under 50 ms, and live mode is a view of it.                                                                                          |
| Phase 2 | Data-driven abilities, Combat talents defining the modifier system, plus poisons | D1 to D7, D9 to D11, A1 to A7    | Combat talents fully simulated from data, poisons proc, no buff-name checks.                                                                                                 |
| Phase 3 | Rotation as data, stats, inputs, controls                                        | R1 to R6, S1 to S5, U1 to U5, U8 | The user sets stats and poisons, runs a Combat batch with Run, Pause and Stop, and sees the breakdown.                                                                       |
| Phase 4 | Talent tree, rotation builder, history, Assassination and Subtlety effects       | U6, U7, H1 to H6, D8             | The full loop works for any build (build, rotate, run, save, compare).                                                                                                       |
| Phase 5 | Polish and depth                                                                 | S6, H6, U9, D12                  | Stat weights, sharing, racials.                                                                                                                                              |

## Theme legend

- Q — quick fixes
- F — foundations and tooling
- E — engine
- A — auras, modifiers, procs and poisons
- D — data import and definitions
- R — rotation as data
- S — results and statistics
- U — UI
- H — history and persistence

## Phase 0 status

Phase 0 is complete: every issue with the `phase-0` label is closed. Phase 1
waits for James's go-ahead. This is a snapshot of those issues as of
2026-10-25. GitHub is the source of truth. This list will go stale.

- [#1](https://github.com/james-attree/wowf_dps_sim/issues/1) — [F2] Add dev-only package.json with serve, test, lint and data:refresh scripts — closed
- [#2](https://github.com/james-attree/wowf_dps_sim/issues/2) — [F3] Unit tests with node:test, starting with the attack resolver — closed
- [#3](https://github.com/james-attree/wowf_dps_sim/issues/3) — [F4] ESLint flat config + Prettier, with engine purity and no-magic-numbers rules — closed
- [#4](https://github.com/james-attree/wowf_dps_sim/issues/4) — [F1] README: purpose, running locally, module map, data credit — closed
- [#5](https://github.com/james-attree/wowf_dps_sim/issues/5) — [F6] Host the app on GitHub Pages with data credit in the footer — closed
- [#6](https://github.com/james-attree/wowf_dps_sim/issues/6) — [D0] Vendor pinned talentsforever rogue.json snapshot + refresh script — closed
- [#7](https://github.com/james-attree/wowf_dps_sim/issues/7) — [D13] Create data/constants.js with provenance for every number, read via k(id) — closed
- [#8](https://github.com/james-attree/wowf_dps_sim/issues/8) — [F5] GitHub Actions: lint + test + data checks on push and PR — closed
- [#9](https://github.com/james-attree/wowf_dps_sim/issues/9) — [Q1] Fix swapped main-hand min/max damage — closed
- [#10](https://github.com/james-attree/wowf_dps_sim/issues/10) — [Q2] Apply the off-hand 50% penalty to the whole hit, not just the weapon roll — closed
- [#11](https://github.com/james-attree/wowf_dps_sim/issues/11) — [Q3] Remove stray console.log in the DoT loop — closed
- [#12](https://github.com/james-attree/wowf_dps_sim/issues/12) — [Q4] Finishers require at least 1 combo point — closed
- [#13](https://github.com/james-attree/wowf_dps_sim/issues/13) — [Q5] Carry swing timer overshoot and allow multiple swings per step — closed
- [#14](https://github.com/james-attree/wowf_dps_sim/issues/14) — [Q6] Don't decrement cooldowns and buffs in the frame they are applied — closed
- [#15](https://github.com/james-attree/wowf_dps_sim/issues/15) — [Q7] Stop showing target debuffs and DoTs as player buffs — closed
- [#16](https://github.com/james-attree/wowf_dps_sim/issues/16) — [Q8] Derive the GCD meter's aria-valuemax from the simulation GCD — closed
- [#17](https://github.com/james-attree/wowf_dps_sim/issues/17) — [Q9] Tidy copy-paste comments and unused fields — closed
- [#18](https://github.com/james-attree/wowf_dps_sim/issues/18) — [Q10] Premeditation: add 20s combo point expiry and start fights at 0 CP — closed
- [#19](https://github.com/james-attree/wowf_dps_sim/issues/19) — [Q12] Adrenaline Rush cooldown should be 5 minutes, not 180s — closed
- [#20](https://github.com/james-attree/wowf_dps_sim/issues/20) — [Q13] Re-enable Slice and Dice in the Combat rotation — closed
- [#21](https://github.com/james-attree/wowf_dps_sim/issues/21) — [Q14] Ghostly Strike and Hemorrhage: weapon-type multipliers, Hemorrhage boosts Rupture only — closed
- [#22](https://github.com/james-attree/wowf_dps_sim/issues/22) — [D14] Provenance report (npm run provenance) and CI check — closed
- [#23](https://github.com/james-attree/wowf_dps_sim/issues/23) — [Q11] DoT crits: keep the per-tick crit roll, drive it from constants; bleeds ignore armor — closed
- [#24](https://github.com/james-attree/wowf_dps_sim/issues/24) — [Q15] Blade Flurry, Adrenaline Rush and Slice and Dice should trigger the 1s GCD — closed
- [#25](https://github.com/james-attree/wowf_dps_sim/issues/25) — [Q16] Move Rupture AP coefficients (Cataclysm reference) into constants — closed
- [#26](https://github.com/james-attree/wowf_dps_sim/issues/26) — [F7] docs/mechanics.md: every formula written against constant ids — closed
- [#41](https://github.com/james-attree/wowf_dps_sim/issues/41) — [Q6 follow-up] Make the global cooldown use sim.tickEpsilon — closed
- [#48](https://github.com/james-attree/wowf_dps_sim/issues/48) — Tighten the provenance placeholder-ref check — closed
- [#49](https://github.com/james-attree/wowf_dps_sim/issues/49) — Weapon rejects NaN and non-finite damage inputs — closed
- [#50](https://github.com/james-attree/wowf_dps_sim/issues/50) — Harden the talentsforever refresh: duplicate keys, a single unit for the two writes, and manifest note wording — closed
- [#52](https://github.com/james-attree/wowf_dps_sim/issues/52) — CI: fail when docs/provenance.md drifts from data/constants.js — closed
- [#59](https://github.com/james-attree/wowf_dps_sim/issues/59) — Adrenaline Rush recast test margin is fragile (7ms at 144 fps) — closed
- [#68](https://github.com/james-attree/wowf_dps_sim/issues/68) — Update rotation post phase0 to be more "combat" relevant — closed
