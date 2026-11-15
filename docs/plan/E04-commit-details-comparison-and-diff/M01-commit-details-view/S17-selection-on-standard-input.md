# E04-M01-S17 · Selection on standard input

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S17 selection on
standard input

A page read under a branch selection gave `git log` one argument for each selected branch's full reference name.
Windows refuses to start a process whose command line is past 32 767 characters, so a large enough selection
could not be read. The selected names now go to git on its standard input, one a line, with `--stdin` in their
place among the arguments, as the stash bases of the every-branch case have since E04-M01-FIX-08. The commits a
page reads and their order are unchanged. None of this is behaviour of Git Graph.

## What was measured, and by whom

- **Review round 08 measured the failure** on 2026-11-11 (git 2.51.0.windows.1, Node 24.18.0, at `c8f9f7d`), not
  this slice: with one commit and 1 000 branches whose arguments are 53 characters, a selection of 400 or 500 was
  read and 600 and more answered `spawn ENAMETOOLONG`.
- **This slice reproduced it with the new case's probe** (2026-11-11): with the selected names put back on the
  command line, the case of `src/adapters/git-selection-many.spec.ts` (1 000 branches, 55-character names, about
  56 000 characters of arguments) failed with `git-failed: git could not be started: spawn ENAMETOOLONG`, and with
  the names on standard input it passed.
- **Git 2.25** was not installed and was not run. `rev-list-options.txt` at the tag `v2.25.0` was read raw on
  2026-11-11: `--stdin` reads the revisions "in addition to" those on the command line, stops at a `--` line, and
  `--ignore-missing` pretends a bad object name "in the input" was not given.
- **A name that resolves to nothing** is skipped silently on standard input by git 2.51.0 (review round 08, probe
  R1); the existing case of `git-selection.spec.ts` that selects `refs/heads/gone` beside `refs/heads/topic` now
  runs through that path and still reads `topic` alone.

## Why no line can be read as an option

Every name that reaches the log begins `refs/heads/` or `refs/remotes/` and has passed the ref-name rules
(`isReadBranch`), so no line begins with `-` and none is `--`.

## The standard-input error handler of `runGit`

`runGit` ignores an error on git's standard input, because git may exit before it has read what it was given. The
case in `src/adapters/git-process.spec.ts` gives `git version` 1 MiB and 16 MiB of input that git never reads and
counts uncaught exceptions: with the handler removed it counted two `write EOF` errors, with it none.
