# E03-M01 · Branches dropdown

**Epic:** E03 · Branch filtering and find
**Base tag:** v0.1.0
**State:** in flight

## Goal

Show the history of the branches a person chooses: a Branches dropdown with Show All, a multiple selection
and a filter box; a Show Remote Branches checkbox; both remembered per repository; and a repository with over
a thousand branches or very many tags loading as any other. It is the second milestone of the MVP
(`docs/PLAN.md` §4) and is promoted as **v0.2.0**.

Before that, it takes what E01-M01's last reviews and its first continuous-integration run left to it, and a
light / dark / follow-the-system theme selector the owner brought forward (owner's ruling, 2026-10-17).

## Slices

| ID | title | wave | outcome |
| --- | --- | --- | --- |
| S01 | theme selector | 1 | A Light / Dark / System control in the bar that applies at once, follows the system when set so, and is remembered across restarts. |
| S02 | licence exceptions on Linux | 1 | `gates:licences` green on the continuous-integration runner, where the bundler's Linux binary is installed. |
| S03 | mutation gate on the runner | 1 | `gates:mutation` reads which test failed on the continuous-integration runner as it does on the development machine. |
| S04 | carried sentences | 2 | Every committed sentence E01-M01's reviews found contradicted by the tree, corrected in one lane. |
| S05 | test-harness checks | 2 | The end-to-end partition, the CI regime, the copied helpers and the fixture stores each held by a check of their own. |
| S06 | mutation gate's remaining clauses | 3 | Kills resting on vitest's own clock re-measured like the others, and the gate's own sentences corrected. |
| S07 | commit range from the latest tag | 2 | `gates:commits` reads from the latest promotion's tag, as its header says, so a release commit of an earlier milestone no longer reddens every tier. |
| S08 | the Node engine pin | 3 | `package.json`'s `engines` and the lockfile's copy of it name the Node the gates compare under, 24.18.0. |

**Owed by S06** (merged 2026-10-25 with its audit `INCOMPLETE` on this one item, all its code and `npm run gates` green
at `01fb07d`): its scope item 2's three dedicated runs of `npm run gates:mutation`, measuring how often the
re-measure clause chooses kills, re-runs them, and refuses unchanged source. It had two draws inside full gate runs
(3 and 2 kills chosen, all clock-only; no second run starved), which is not a rate. The next review or a later
slice takes the measurement.

The Branches dropdown's slices are added once the reference extension's dropdown has been observed and
recorded (`AGENTS.md` §1, §4); they take the next free numbers.

Scope and boundary of each slice live **only** in its task file (`AGENTS.md` §3).

## Gates

Every gate of `docs/ADR-0003-quality-gates-and-ci.md` §2, as E01-M01 left them, behind the tiered scripts of
`AGENTS.md` §11: `npm run gates:static`, `npm run gates:quick`, `npm run gates`, and the wall-clock budgets as
their own gate, `npm run gates:budgets`. Each task names its lane's tier. The reviewer runs `npm run gates` and
`npm run gates:budgets` at every round (`AGENTS.md` §7, §11).

Always, for every slice (`TASK_TEMPLATE.md`): the boundary check, the commit check, the placeholder check,
and `git status --short` printing nothing.

## Delivery record

Filled in before promotion (`AGENTS.md` §8.5).

| field | value |
| --- | --- |
| base tag | v0.1.0 |
| reviewed commit | |
| review rounds | |
| tasks | |
| tag created | |
