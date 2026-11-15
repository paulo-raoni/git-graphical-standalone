# E03 · Branch filtering and find

Choosing which part of a repository's history the graph shows, and finding a commit in what is shown.

## Goal

Show the history of the branches a person cares about, not all of it: choose branches, hide the remote ones,
and keep that choice per repository — at a repository with over a thousand branches as at one with three. Then
find a commit by what it says, who wrote it, or which ref points at it.

## In scope

The behaviour inventory of E03 in `docs/PLAN.md` §2: the Branches dropdown (Show All, multi-selection, a filter
box, the remote-branches toggle, persistence per repository, very many branches and tags) and the Find widget.

## Out of scope

- Predefined glob patterns and the branch context-menu action that selects a branch: both need E05-M01's
  context menus.
- Per-remote visibility from the repository settings (E06-M01).
- Everything the graph itself draws (E01) and what a row opens (E04).

## Milestones

| ID | title | state |
| --- | --- | --- |
| E03-M01 | Branches dropdown | delivered, v0.2.0 |
| E03-M02 | Find widget | planned |

Outcomes are in `docs/PLAN.md` §2. Approved with the plan on 2026-09-11 (`AGENTS.md` §2). E03-M01 is the second
milestone of the MVP and also carries the work E01-M01's last reviews left to it (`docs/PLAN.md`, *Carried into
E03-M01*) and a theme selector the owner brought forward on 2026-10-17.
