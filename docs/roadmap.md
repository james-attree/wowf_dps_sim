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
does not copy them. Finisher priority is deferred to the rotation work (Phase 3,
rotation as data, and Phase 4, the builder). Later-phase task ids get GitHub
issues when that phase starts.

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

## Phase 2 status

Phase 2 is feature complete with #107 (PR pending James's review; the roadmap does not say
merged until it is). The tracker is
[#108](https://github.com/james-attree/wowf_dps_sim/issues/108), and its issues
(#90 to #107) land in the order listed there, one PR each. GitHub is the source
of truth, and this list will go stale.

- [#90](https://github.com/james-attree/wowf_dps_sim/issues/90) — [P2-1] D4: Talent catalogue loaded straight from the snapshot — closed. See [Talent catalogue](mechanics.md#talent-catalogue).
- [#91](https://github.com/james-attree/wowf_dps_sim/issues/91) — [P2-2] D11: Load-time data validation and `dataVersion` on every sim result — merged (PR #110). See [Load-time validation](mechanics.md#load-time-validation) and [Data version](mechanics.md#data-version).
- [#92](https://github.com/james-attree/wowf_dps_sim/issues/92) — [P2-3] E2-lite: minimal SimConfig and `createFight` options — merged (PR #111). See [SimConfig](mechanics.md#simconfig).
- [#93](https://github.com/james-attree/wowf_dps_sim/issues/93) — [P2-4] D1: Ability schema with numbers parsed from `spell_desc` — merged (PR #112). Data only until D2 (#98), the first reader. See [Ability schema](mechanics.md#ability-schema). It also folds in three small fixes from the #111 QA: a weapon speed lower bound, `readTalents` reading each rank once, and the off-hand speed assertion.
- [#94](https://github.com/james-attree/wowf_dps_sim/issues/94) — [P2-5] A1: Aura model, and no name-based checks left in the engine — merged (PR #113). Buffs, debuffs and DoT bonuses are definitions in `js/auras.js`, the engine reads their effects by kind, and every spell, aura, cooldown and weapon is identified by its catalogue id. `runFight`'s shape and the golden fixtures are unchanged. A lint rule guards against new name-keyed checks. It also folds in the #111 QA items: the parser throws on an unread damage sentence, an unknown cost unit and min damage above max, and the `config.minWeaponSpeed` note says it is a developer judgement call. See [Aura model and ids](mechanics.md#aura-model-and-ids).
- [#95](https://github.com/james-attree/wowf_dps_sim/issues/95) — [P2-6] A6: Target debuffs with stacks and charges — merged (PR #114). Debuffs have a stack rule (`add`, `highest`) and charges, and Hemorrhage (+15% to Rupture only, 15 s), Expose Armor and Deadly Poison are target debuffs in the data. Expose Armor lowers armor mitigation; Deadly Poison has no effect until A5 (#105). `runFight`'s shape and the golden fixtures are unchanged. It also folds in four #113 QA items: own-property checks on aura lookups and the weapon hand, `docs/mechanics.md` matching the code on `dotDamageTaken`, the `abilities.resources` provenance row, and unknown effect kinds throwing. See [Aura model and ids](mechanics.md#aura-model-and-ids).
- [#96](https://github.com/james-attree/wowf_dps_sim/issues/96) — [P2-7] A2: Generic modifier schema and pipeline — merged (PR #115). A modifier is data (`kind`, `op`, `value`, an optional scope of abilities, hands and weapon types, and a source) that the engine asks for by stat, so a talent, an aura or a later set bonus needs no engine code. Static modifiers come from `new Rogue(config, { modifiers })` and `createFight(seed, config, { modifiers })`; auras carry their own, and the old `haste` and `energyRegenMultiplier` effects compile into them. A run with no effective modifier is bit-identical and draws the same random numbers. The 11 DPS-relevant Combat talents are written as data in the tests and combined with two other trees; the talent effect table is D5 (#102) and the config wiring is D7. `runFight`'s shape and the golden fixtures are unchanged. It also folds in Kira's QA items from the #95 review: six provenance rows reattributed to Developer judgement, `applyAura` validating `stacks`, `defineAura` rejecting `__proto__`, the Armor section of `mechanics.md`, and two test gaps. See [Modifiers](mechanics.md#modifiers).
- [#97](https://github.com/james-attree/wowf_dps_sim/issues/97) — [P2-8] A3: Damage modifier hooks by tag — merged (PR #117). A damage event carries an ability id, a school (physical or nature) and tags (`bleed`, `poison`, `white`, `yellow`, `finisher`), taken from the catalogue, `bleed.spells`, `poison.spells`, `nature.spells` and the attack type, and a modifier's scope can name them (`schools`, `tags`). "+30% Rupture" and "+20% poison damage" are data with no engine code, and the armor skip for bleeds and Nature damage reads the same tags. It applies before crit and armor. `runFight`'s shape and the golden fixtures are unchanged. It also folds in two Kira items from the #116 QA: a note that a Rogue or pipeline backs one `Simulation`, and the `rng.defaultSeed` and `rng.mulberry32` rows reattributed to the dev. A follow-up adds the full finisher list, the `nature.spells` citation (`rogue/poisons.go`), mutation-gap tests, and `RangeError`s for a bad attack type or a missing event. See [Damage tags](mechanics.md#damage-tags).
- [#98](https://github.com/james-attree/wowf_dps_sim/issues/98) — [P2-9] D2: Rogue abilities as data, one generic ability executor — merged (PR #118). The eleven skill classes in `js/skill.js` are gone. `js/ability-data.js` lists each ability (cost and cooldown row, combo points, damage kind, aura) and `js/ability.js` casts them all with one `Ability.cast`, taking each name and GCD flag from the catalogue. A seeded parity test (`test/ability-parity.test.js`) runs the old classes, kept in `test/legacy-skills.js`, against the executor: same totals, log and random draws. No `runFight` result or golden fixture changes. See [Ability executor](mechanics.md#ability-executor).
- [#99](https://github.com/james-attree/wowf_dps_sim/issues/99) — [P2-10] D3: Resource abstraction (energy, combo points) in class data — merged (PR #120). `js/resource-data.js` describes energy and combo points (cap, start, regen rule, cost modifier kind, what a target change does) and `js/resource.js` is the pool the generic executor spends and gains through by id, so `js/ability.js` names neither. A `resourceMax` modifier, scoped by resource id, changes a cap. Procs (#101) and the Assassination talents (D8a) can call the same `gain` and `spendAll`. No `runFight` result or golden fixture changes. See [Resources](mechanics.md#resources).
- [#100](https://github.com/james-attree/wowf_dps_sim/issues/100) — [P2-11] A7: Classic 1.12 combat table — merged (PR #121). Attacks resolve on the Classic attack table (miss, dodge, parry, glancing, block, crit, hit), with a white swing as one roll and a yellow attack as two, and glancing blows, crit suppression and a `config.target.behind` position (default behind: no parry, no block). It changed the draws of every fight, so the golden fixtures were regenerated in a separate commit and the script of the finisher fixture was adjusted. `runFight`'s shape is unchanged. See [Attack table](mechanics.md#attack-table).
- [#101](https://github.com/james-attree/wowf_dps_sim/issues/101) — [P2-12] A4: Proc system — merged (PR #123). A proc is data (`js/procs.js`): a trigger (`onHit`, `onCrit`, `onWhiteHit`, `onAbility` by ability id or tag, `onDotTick`), a chance (`flat`, `ppm`, `perSpent` by combo points spent), an optional internal cooldown, a modifier-scope filter and actions (`gainResource` for combo points or an energy restore, `applyAura`, `dealDamage`, `extraAttack`). A proc draws a random number only when it could fire. Hosts pass procs as `options.procs` to `Rogue` and `createFight`; `runFight`'s shape and the golden fixtures are unchanged, and no talent is wired in until D7. It also folds in the #120 items: a pool above a fallen cap is clamped each step, resource ids are checked with `Object.hasOwn` and when an ability loads, and a negative amount throws. See [Procs](mechanics.md#procs).
- [#102](https://github.com/james-attree/wowf_dps_sim/issues/102) — [P2-13] D5: Combat talent effects as data — merged (PR #124). `data/talent-effects.js` has one entry per Combat talent (modifier rank tables, procs, a granted ability, or a `noDpsEffect` reason, and a hash of the snapshot text it was written from), and `expandTalents` turns `{ talent id: rank }` into the `modifiers` and `procs` that `createFight` takes. 11 of the 17 have an effect (11 confirmed, no twelfth). A talented run is reachable through `createFight` options; `runFight` and the goldens are unchanged, and `config.talents` is read by D7. It also folds in Kira's #123 items (tests for the real gaps, `procsFromTalents` input checks, a `ppm` proc needing an attack, whole combo points). See [Talent effects](mechanics.md#talent-effects).
- [#119](https://github.com/james-attree/wowf_dps_sim/issues/119) — [P2-19] D8a: Assassination talents as data — PR 1 merged (#125), PR 2 in review. Ruthlessness 3/3 and Relentless Strikes 1/1 are `onAbility` procs on the `finisher` tag (a flat chance by rank; 20% per combo point spent) and Cold Blood 1/1 is a granted ability: an instant off-GCD 3 minute cooldown whose one-charge aura adds +100% crit to the abilities of its text, spent by the first one that lands. A Rogue option `abilities` carries the grants, the Cold Blood rotation rule (the Scout's, isolated in `js/rotation-rules.js`) applies only when it is granted, and the crit suppression now comes off before the 0 to 1 clamp. The reference build's `unmapped` list is empty. `runFight`'s shape and the golden fixtures are unchanged. See [Talent effects](mechanics.md#talent-effects).

- [#103](https://github.com/james-attree/wowf_dps_sim/issues/103) — [P2-14] D6: Talent coverage check and CI step — merged (PR #131). `npm run talents:coverage` lists, per tree, the talents with an effect, the `noDpsEffect` ones and the ones with none, and CI runs it. See [Talent effects](mechanics.md#talent-effects).
- [#104](https://github.com/james-attree/wowf_dps_sim/issues/104) — [P2-15] D9: Poison definitions from the snapshot — merged (PR #132). `js/poisons.js` reads each rogue poison's numbers from `spell_desc`; Instant and Deadly deal damage and the others are no-ops with a reason. See [Poison definitions](mechanics.md#poison-definitions-d9-issue-104).
- [#105](https://github.com/james-attree/wowf_dps_sim/issues/105) — [P2-16] A5: Instant and Deadly Poison through procs — merged (PR #133). `config.poisons` per hand adds the poison's proc, so each weapon rolls its own. See [Poison procs](mechanics.md#poison-procs-a5-issue-105).
- [#106](https://github.com/james-attree/wowf_dps_sim/issues/106) — [P2-17] D7: Apply a selected build, with validation — merged (PR #134). `config.talents` is validated (51 points, requirements, row gating) and applied. See [Applying a talent build](mechanics.md#applying-a-talent-build-d7-issue-106).
- [#107](https://github.com/james-attree/wowf_dps_sim/issues/107) — [P2-18] D10: Icons by hot-link, plus Phase 2 wrap-up — in review. Icons for talents, abilities and poisons resolve to a CDN URL or a fallback, with no file added; two golden fixtures are new (the reference talented build, and an Instant/Deadly poison fight) and the four existing ones are byte-identical; the docs describe the Phase 2 end state. See [Icons](mechanics.md#icons-d10-issue-107) and [Config cases](mechanics.md#golden-seed-tests).

**Phase 2 exit criteria** (rechecked for #107, with the commands in its pull request):

1. Combat talents fully simulated from data: `npm run talents:coverage` reports no Combat talent missing and the reference build's `unmapped` empty.
2. Poisons proc, Instant and Deadly, per weapon: `test/poison-procs.test.js` and the poison fixture.
3. No name-keyed lookups in the engine: the `no-display-name` lint rule and a search of `js/`.

**Left for James's review** (full list in [Known limits at the end of Phase 2](mechanics.md#known-limits-at-the-end-of-phase-2)): Backstab's dagger requirement is not enforced, Cold Blood's rotation placement is a design choice, Instant Poison's crit and suppression and poison rolls on finishers are unverified, and the unmapped Assassination and Subtlety talents (Phase 4, D8) do nothing. Phase 3 does not start without his go-ahead.

**Scope (project owner ruling 2026-10-26).** Block and parry are out of scope: the sim is for attacking from behind, where neither applies. The front attack table (`config.target.behind = false`, with its parry and block bands) is retained in the engine and tests but is unsupported for tuning, and `block.value` stays 0. See [Position](mechanics.md#attack-table).

## Phase 1 status

Every Phase 1 issue is merged, and this docs issue (#78) is the last. James has
not signed the phase off yet, and the next phase does not start without that.
This is a snapshot as of 2026-10-25. GitHub is the source of truth. This list
will go stale.

Exit criterion: a seeded 5-minute fight runs in Node in under 50 ms, and live
mode is a view of it.

- A seeded 5-minute fight (`runFight({ seed: 1, duration: 300 })`) takes about
  22 ms warm and about 40 ms cold on our box (8 vCPU Xeon, Node 20), measured
  with `npm run bench`. That meets the target there. The GitHub Actions runner
  (Node 22) took about 60 to 65 ms per fight, over the target. The 50 ms figure
  is a development-machine target, not a CI guarantee, and no test asserts it.
  See [Benchmark](mechanics.md#benchmark).
- Live mode is a view of the engine. `js/main.js` builds the fight with
  `createFight`, steps it in whole steps of `sim.fixedStep`, and shows the seed.
  See [Live page](mechanics.md#live-page).

Issues:

- [#70](https://github.com/james-attree/wowf_dps_sim/issues/70) — docs: refresh the Phase 0 status list in docs/roadmap.md — closed (PR #79)
- [#71](https://github.com/james-attree/wowf_dps_sim/issues/71) — [P1-1] Seeded random number generator, injected wherever Math.random is used — closed (PR #80)
- [#72](https://github.com/james-attree/wowf_dps_sim/issues/72) — [P1-2] Remove wall-clock time from the engine: update takes a time step — closed (PR #81)
- [#73](https://github.com/james-attree/wowf_dps_sim/issues/73) — [P1-3] Fixed-step clock that runs a fight for a set duration — closed (PR #82)
- [#74](https://github.com/james-attree/wowf_dps_sim/issues/74) — [P1-4] Headless runFight({ seed, duration }) that works in Node with no DOM — closed (PR #83)
- [#75](https://github.com/james-attree/wowf_dps_sim/issues/75) — [P1-5] Benchmark and test: a seeded 5-minute fight runs in under 50 ms — closed (PR #87)
- [#76](https://github.com/james-attree/wowf_dps_sim/issues/76) — [P1-6] Live mode becomes a view of the engine — closed (PR #88)
- [#77](https://github.com/james-attree/wowf_dps_sim/issues/77) — [P1-7] Golden-seed regression tests — closed (PR #84)
- [#85](https://github.com/james-attree/wowf_dps_sim/issues/85) — [P1-7b] Golden-seed fixture that exercises Eviscerate, Rupture, DoT ticks and parry paths — closed (PR #86). The fixture covers Eviscerate, Rupture, DoT ticks and tick crits. It has no parry, because the default fight stands behind the target and the attack table has no parry or block band from behind (A7, #100). Parries and blocks are tested from the front (`config.target.behind = false`) in `test/attack-table-engine.test.js`.
- [#78](https://github.com/james-attree/wowf_dps_sim/issues/78) — [P1-8] Docs: simulation clock, headless runner, and roadmap status for Phase 1 — merged (PR #89)

Known limits are in [Known limits of Phase 1](mechanics.md#known-limits-of-phase-1).

## Phase 0 status

Phase 0 is complete: every issue with the `phase-0` label is closed. This is a
snapshot of the Phase 0 issues as of 2026-10-25. GitHub is the source of truth.
This list will go stale.

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
