# E04 · Commit details, comparison and diff

What a row of the graph opens: the details of a commit, of a stash or of the uncommitted changes, the files each
one changed, and from there the diff of a file, the comparison of two commits and a code review.

## Goal

Read what a commit did without leaving the graph: who wrote it and when, its whole message, and every file it
changed, at a repository of fifty thousand commits as at one of five. Then see any file's diff, compare any two
commits, and review a commit's files one by one.

## In scope

The behaviour inventory of E04 in `docs/PLAN.md` §2: the Commit Details View (M01), the diff and file viewer
(M02), the comparison of two commits (M03), code review (M04) and the rich rendering of details (M05).

## Out of scope

- Every action that writes to the repository, including those reached from a file's context menu (E05).
- The settings UI that lists every setting (E02-M03); E04-M01 gives its own settings a control in the view.
- Issue linking and pull requests (E06-M02).

## Milestones

| ID | title | state |
| --- | --- | --- |
| E04-M01 | Commit Details View | in flight |
| E04-M02 | Diff and file viewer | planned |
| E04-M03 | Commit comparison | planned |
| E04-M04 | Code review | planned |
| E04-M05 | Rich details | planned |

Outcomes are in `docs/PLAN.md` §2. Approved with the plan on 2026-09-11 (`AGENTS.md` §2). E04-M01 is the third and
last milestone of the MVP. It also takes the stash rows of E01-M02 and builds the alternative values of its own
settings, by the owner's rulings of 2026-11-02, and the work E03-M01's reviews carried to it.
