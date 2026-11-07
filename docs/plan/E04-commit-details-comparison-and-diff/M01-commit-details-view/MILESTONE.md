# E04-M01 · Commit Details View

**Epic:** E04 · Commit details, comparison and diff
**Base tag:** v0.2.0
**State:** in flight

## Goal

Click a commit, a stash or the uncommitted changes and read its details under the row: hash, parents, author and
committer with their dates, the whole message as written, and the files it changed as a tree or a list, with the
keyboard to move between commits and the panel's size and place remembered. It is the third and last milestone of
the MVP (`docs/PLAN.md` §4) and is promoted as **v0.3.0**.

Before that, it takes what E03-M01's reviews carried to it (`docs/PLAN.md`, *Carried into E04-M01*), including the
literal 16.7 ms frame check and the bound on a reading's reference time the owner placed here (rulings of
2026-10-28 and 2026-11-01).

## Slices

| ID | title | wave | outcome |
| --- | --- | --- | --- |
| S01 | mutation gate's committed checks | 1 | The mutation gate's report reading and re-measure clause held by committed checks, and its survivor list keyed by something a moved line does not change. |
| S02 | ref names and the adapter's sentences | 1 | A branch name git's ref-name rules refuse never reaches git, the colour override held for every argument list, and the adapter's sentences true. |
| S03 | theme, window and branches polish | 1 | A choice that cannot be kept is said in the window, the window's background held by a check, and the Branches control's check mark and first-paint state corrected. |
| S04 | end-to-end isolation | 2 | Every end-to-end suite on a profile of its own, the selection race held by a check, and the suite's limits argued from its time under load. |
| S05 | budgets and the reference bound | 2 | The literal 16.7 ms frame check, a reading whose reference time is out of bound discarded, the launch race closed and the fixed waits replaced. |
| S06 | commit details read | 2 | The details of a commit and of the uncommitted changes, with every changed file, its status and its line counts, read from git on request and handed to the window. |
| S07 | fixture store and gate messages | 3 | The fixture store's numbering held and its sentences true, and the licences and commits gates' messages and range held by checks. |
| S08 | rounded lines | 3 | Every change of lane drawn as a smooth curve instead of a straight diagonal. |
| S09 | the details panel | 5 | A click opens the details under the row, as observed in the reference extension, and a second click, the close button or another row closes it. |
| S10 | the changed files | 6 | The changed files as a tree or a list, chosen per repository, with their status, counts, actions and context menu. |
| S11 | keyboard navigation | 7 | Up, Down, Ctrl+Up and Ctrl+Down with and without Shift, and Escape, move between commits as the reference documents, with the opened row kept in view. |
| S12 | panel size, place and options | 8 | The panel's height and divider dragged and remembered per repository, docked at the bottom when chosen, and its options chosen from the view. |
| S13 | unkept choice said without blocking | 3 | A choice that cannot be kept is said by a notice inside the window that blocks nothing, in place of a message box. |
| S14 | stash rows | 4 | Every stash a row of the graph, drawn as a stash, whose details list its untracked files; the details read on the git the setup states. |

**Owner's rulings of 2026-11-02:** the stash rows of E01-M02 come into this milestone, because a stash's details
need its row (S08 when ruled; S14 since the split of 2026-11-07); and every setting `docs/PLAN.md` §2 names
for E04-M01 is built with its alternative values and
a control in the view to choose them (S10, S12), which the settings UI of E02-M03 later takes over.

**Added on 2026-11-04 from the owner's report:** the graph's lane changes are drawn as straight diagonals, which the
owner found crooked (a screenshot of the `remotes` fixture); S08 draws them as curves. And the message box S03
added for a choice that cannot be kept appeared during a test run and blocked the owner's screen until dismissed;
S13 replaces it with a notice inside the window, and E04-M01-S04 finds the case that made a write fail.

**Changed on 2026-11-07 by the orchestrator:** S08 was split. Its curves need no observation of the reference
extension, so they stay in wave 3 as S08. Its stash rows need one, so they become S14 in a wave of their own,
before the details panel, and S09 to S12 move one wave later. S14 also takes review round 02's C-10: the details
read passes options newer than the git 2.25 that docs/ADR-0001-stack.md states, and it must read on git 2.25
before S09 draws the details.

**The orchestrator's choices, for the owner to overrule:** the control is a settings button on the panel's own
strip; a choice that cannot be kept is said in the window (S03), then without blocking (S13): by a strip inside the
window that stays until the person closes it, reached by a message from the main process; the Show Remote Branches
checkbox shows neither state before the first page (S03); a branch name git refuses is refused before git runs
(S02); and the end-to-end limits move only on a measurement under load (S04).

The reference behaviour of S09 and S10 was observed on 2026-10-25 (`.omc/observations`, not committed); the
behaviour of S14, S11 and S12 and the alternative values of the settings need an observation of the reference
extension, or its Marketplace page where an observation cannot reach (keys, drags, the context menu), before
their tasks are written (`AGENTS.md` §1, §7).

Scope and boundary of each slice live **only** in its task file (`AGENTS.md` §3).

## Gates

Every gate of `docs/ADR-0003-quality-gates-and-ci.md` §2, behind the tiered scripts of `AGENTS.md` §11:
`npm run gates:static`, `npm run gates:quick`, `npm run gates`, and the wall-clock budgets as their own gate,
`npm run gates:budgets`. Each task names its lane's tier. The reviewer runs `npm run gates` and
`npm run gates:budgets` at every round (`AGENTS.md` §7, §11).

Always, for every slice (`TASK_TEMPLATE.md`): the boundary check, the commit check, the placeholder check,
and `git status --short` printing nothing.

## Delivery record

Filled in before promotion (`AGENTS.md` §8.5).

| field | value |
| --- | --- |
| base tag | v0.2.0 |
| reviewed commit | |
| review rounds | |
| tasks | |
| tag created | |
