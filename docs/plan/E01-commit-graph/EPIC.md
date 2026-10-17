# E01 · The commit graph

The table whose first column is the drawn commit graph. Everything else in the product hangs off it: the
details view opens from a row, filtering changes which rows exist, and every action is reached from one.

## Goal

Open a repository and read its history: one row per commit, the branch structure drawn beside it, refs on
the commits they point at, the working tree at the top, and more history on demand — at a repository of any
realistic size, without the window ever stopping.

## In scope

The behaviour inventory of E01 in `docs/PLAN.md` §2: loading and paging, what is shown and what can be
hidden, the drawing itself, reference labels, the columns, message rendering, refresh and navigation.

## Out of scope

- Everything reached **from** a row: the details view (E04), filtering and find (E03), actions (E05).
- Repository management around the view (E02), repository settings (E06), packaging (E07).

## Milestones

| ID | title | state |
| --- | --- | --- |
| E01-M01 | First graph | in flight |
| E01-M02 | Graph fidelity | planned |
| E01-M03 | Live view | planned |
| E01-M04 | Message rendering | planned |

Outcomes are in `docs/PLAN.md` §2. Approved with the plan on 2026-09-11 (`AGENTS.md` §2).
