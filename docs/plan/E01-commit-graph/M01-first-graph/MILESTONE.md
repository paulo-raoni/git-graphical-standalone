# E01-M01 · First graph

**Epic:** E01 · The commit graph
**Base tag:** v0.0.0
**State:** in flight

## Goal

A window that opens a real repository and draws its commit graph: one row per commit with the graph, the
description, the date, the author and the abbreviated hash; branch, remote-branch and tag labels on their
commits; the uncommitted changes as the top row when the working tree is dirty; and a Load More Commits
button that appends the next page. It is the first milestone of the MVP (`docs/PLAN.md` §4) and is promoted
as **v0.1.0**.

It also lays the ground every later milestone stands on: the four rings and the dependency rule of
`docs/ADR-0002-architecture-and-performance.md`, the frozen contracts, and the gate pipeline of
`docs/ADR-0003-quality-gates-and-ci.md`.

## Slices

| ID | title | wave | outcome |
| --- | --- | --- | --- |
| S01 | scaffold, rings and the frozen contract | 1 | The project with its rings, the dependency rule enforced mechanically, every development dependency of the milestone pinned, the frozen contracts, the static gates, and a window that opens. |
| S02 | gate pipeline, the commit store and CI | 2 | The columnar commit store with its builder and accessors, its 96-byte budget proved by benchmark; unit and coverage thresholds, StrykerJS, the Playwright harness, the benchmark harness and its baselines, deterministic fixture repositories, `npm run gates`, and the single grouped workflow. |
| S03 | git read adapter and the log parser | 3 | Git discovery; log, refs, status and stash list streamed and parsed incrementally into the store; the git version floor measured. |
| S04 | lane layout engine | 3 | The single-pass, incremental lane assignment from the store to layout rows, with unit tests over fixture shapes. |
| S08 | the contract decode API | 3 | Move the pure decoders of CommitColumns out of core and into contracts, where the renderer can reach them (ADR-0002 decision 3, amended). |
| S05 | graph table renderer | 4 | Recycled virtualised rows and the coalesced graph canvas, drawing layout buffers supplied as fixtures. |
| S06 | open a repository | 5 | The composition root: open by argument or folder dialog, initial load, Load More, refresh, and the error page when git is missing. |
| S07 | budgets, baselines and render stability | 6 | The assembled application measured against every budget of ADR-0002, the baselines committed, and the golden-image question settled. |

Scope and boundary of each slice live **only** in its task file (`AGENTS.md` §3).

## Gates

Every gate of `docs/ADR-0003-quality-gates-and-ci.md` §2, reachable through `npm run gates`, at the state the
sequence has reached: a gate exists from the slice that lands it and is run by every slice after it.

| from | gates |
| --- | --- |
| S01 | format, lint, boundaries, types, build |
| S02 | contract, unit with coverage thresholds, mutation, end to end, performance, size, licences, provenance, commits, placeholders |

Always, for every slice (`TASK_TEMPLATE.md`): the boundary check, the commit check, the placeholder check,
and `git status --short` printing nothing.

The reviewer runs the full set at the end of every wave and again over the whole sequence before promotion
(`AGENTS.md` §7).

## Delivery record

Filled in before promotion (`AGENTS.md` §8.5).

| field | value |
| --- | --- |
| base tag | v0.0.0 |
| reviewed commit | |
| review rounds | |
| tasks | |
| tag created | |
