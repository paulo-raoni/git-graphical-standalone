# E03-M01-S11 · Very many branches and refs

**Parent:** E03 Branch filtering and find > E03-M01 Branches dropdown > E03-M01-S11 very many branches and refs

Nothing in the window changed in this slice. It is about the refs a repository has, read by the reader
(`src/adapters/`, `src/core/parse/`), rather than about the control that shows them. Three behaviours of the
reference extension, from `docs/PLAN.md`'s inventory for this milestone, which takes them from the extension's
Marketplace page; none of them was observed in the running extension for this slice:

- a repository with **over a thousand branches, or very many tags**, opens and lists as any other;
- a user configuration that makes git colour branch names (`color.branch=always`, `color.ui=always`) **never
  puts colour codes into a branch or tag name** the application shows or uses;
- **remote branches created by `git svn`** display as remote branches.

In short: the first and third already held, and are now measured and held by tests; the second held for the
commands as they are, and the reader is now immune to it whatever format a later slice adds. One counter joined
`gates:perf`. No contract changed.

## Very many branches and tags

### The repository

`many-refs`, built by `src/adapters/reference-fixtures.spec-support.ts`: a trunk of 3 000 commits on `main`,
1 000 local branches `branch-0000` onwards, 1 000 remote-tracking branches `origin/branch-0000` onwards on the same
commits, and 500 tags `tag-000` onwards, every even-numbered one annotated: 2 501 references, packed, as a clone
leaves them. Branch `i` stands on the trunk's commit `7i mod 3000` counted from the root, so no two branches share
a commit and they are spread over the whole history; tag `j` on commit `11j mod 3000`. Of the 2 501, 200 stand on a
commit of the first page of 300 (counted by the reader on every reading below).

**Why it is not a shape of `test/fixtures/generate.ts`.** The generator measured 299 lines of code by the lint
gate's own count (ESLint's `max-lines`, blank lines and comments skipped, run on the file at this slice's base),
against the gate's limit of 300, so any shape added to it fails `gates:lint`. ESLint's configuration says a module
that long is two modules not yet split, and this slice's boundary holds no new module in `test/fixtures/` to split
it into. So the three repositories of this slice are built in `src/adapters/reference-fixtures.spec-support.ts`,
inside the boundary, from the generator's own building blocks: each starts from one of its shapes, written by
`generateRepository`, and continues with its `git` and `gitAt`, which this slice exported and did not change.
`suiteFixtureAt` of `src/adapters/fixtures.spec-support.ts` publishes and verifies them as the specification's
repositories are, under a name that carries a digest of the code that builds them, so a change to that code builds a
new copy rather than handing back an old one. What they lack is the generator's two proofs: their object names are
not recorded in `expected-object-names.json` and they are not built twice and compared. No assertion made over them
depends on an object name; each compares the reader with what git reports about the same repository.

Importing a `fast-export` of an earlier build of this repository, which creates its 2 501 references as loose files,
took 10.9 seconds on the development machine, one run, where importing its trunk alone took 0.6. So `fast-import`
writes only the 250 annotated tags, which are objects; every other reference is written straight into `packed-refs`
as one `<object name> <reference>` line, the file's plainest form; and `git pack-refs --all` folds the loose ones in
and rewrites the file as git writes it.

### What arrives

`src/adapters/git-refs.spec.ts` (the fixtures suite) holds that a first page of 300 lists all 2 501 references by
kind — 1 001 local, 1 000 remote, 500 tags of which 250 annotated, no symbolic head; that every one points at its
commit's row, or at `UNKNOWN_INDEX` when its commit is past the page, equal reference for reference to `git
for-each-ref` and `git log` of the same repository; that the page's commits are git's first 300; and that once the
whole history is read every reference lands on a row.

### The readings

Taken by this lane on 2026-10-27 with a script outside the repository that calls `createGitRepositoryReader().
readPage({ pageSize: 300 })`, ten runs after one warm-up per repository, and then runs each of the five git
commands the reader runs ten times on its own, and the reader's in-process work — parsing 300 commits into the store,
parsing `for-each-ref`'s output in 64 KiB chunks, joining references to rows, building the `Refs` block — fifty
times. To see what grows with the references, the same repository was read with its references multiplied: copies
of `many-refs` with 1 reference (`main` alone), and with 5 001, 10 001 and 20 001 in the same mix, written into
`packed-refs` the same way.

**The machine was not free.** Other projects' test runs were in progress, and the total processor load sampled
every 1.5 seconds during each repository's readings averaged 56 to 84 per cent, with samples from 33 to 100 per cent.
These are not budget readings, and no wall-clock figure here is a budget; they are recorded with that load because
it is the condition they were read under.

| references | first page, ms (min / median / max) | `for-each-ref`, ms (min / median) | in-process, ms (min / median) | `Refs` block | load, % (mean, range) |
| --- | --- | --- | --- | --- | --- |
| 1 | 385.7 / 503.0 / 660.4 | 59.4 / 70.7 | 1.9 / 3.5 | 0 KiB | 82 (58–94) |
| 2 501 | 553.7 / 660.3 / 1 024.2 | 96.5 / 120.0 | 5.7 / 7.8 | 87.9 KiB | 84 (67–100) |
| 5 001 | 627.0 / 903.7 / 1 265.0 | 152.2 / 218.4 | 15.1 / 20.8 | 181.7 KiB | 76 (40–98) |
| 10 001 | 486.9 / 556.6 / 870.2 | 137.1 / 154.6 | 22.4 / 27.3 | 369.2 KiB | 56 (33–85) |
| 20 001 | 753.6 / 895.1 / 1 302.3 | 336.6 / 426.1 | 50.7 / 66.0 | 744.2 KiB | 74 (43–97) |

An earlier series of the same script the same evening, at a load averaging 58 per cent (32 to 96) over all five,
read the in-process minimum as 1.5, 6.6, 10.6, 20.9 and 37.7 ms for the same five repositories, and the first page's
median as 411.2, 444.2, 486.0, 565.0 and 784.0 ms.

The `Refs` block is the reference columns of the page, the name string counted at two bytes a character: 36 to 38
bytes a reference, computed from the block itself and the same on every run. The JavaScript heap grew by 2.6 MiB
(median of ten) over one first page of `many-refs` and by 0.8 MiB over one of the single-reference copy; a reading
of what stayed retained after a collection was lost in the noise of the heap, between −0.2 and 0.3 MiB, and is not a
figure.

**What it shows.** Every reference arrived at every size: the reader counted 8 001, 8 000 and 4 000 by kind at
20 001. A first page costs about half a second, nearly all of it the five git processes, each of which took 59 to
124 ms at its fastest in these readings, the commands that read no reference included; `git for-each-ref` is the one
that grows with the references. The reader's own work grew from 5.7 to 50.7 ms at its fastest for eight times the
references: 1.5 to 2.4 µs a reference above the single-reference copy's 1.9 ms. **Nothing grew
faster than the references** within the spread of these readings, which on this machine is wide: the ratios of
consecutive minima are 2.6, 1.5 and 2.3 for each doubling. That is a reading of a loaded machine and not a proof, so
the one step whose cost could be a product of references and commits is now counted (below), and the reader's other
steps are linear by construction: each reads every reference once, in one pass over `for-each-ref`'s output. So
nothing was fixed for size.

### The counter

`resolveCommitRows` of `src/core/parse/commit-lookup.ts` now answers the full object-name comparisons it made beside
the rows it found; the adapter takes the rows, as before. It is one function and not a counted twin of the old one
because the twin did not fit: with a second exported function wrapping the first, `repository.cjs` measured 28 707
production bytes against its budget of 28 672 (`npm run gates:size`, this lane, 2026-10-27), and with one function
28 667, against 28 609 at this slice's base: the colour override and the counter cost 58 bytes, and 5 are left under
the budget. A reference whose commit is on the page should cost one
comparison, and one that is not on it none, however many references there are; a lookup that compared every
reference with every row would cost a page's worth each.

`perf/refs.perf.test.ts` (`gates:perf`) reads a synthetic `for-each-ref` stream in `many-refs`' mix through the
reader's own parser, every reference on a page of 10 000 commits, and holds two entries of `perf/baselines.json`:

| entry | baseline | reading |
| --- | --- | --- |
| `refLookupComparisonsPerRef` | 1 | 2 501 comparisons for 2 501 references, identical on every run |
| `refLookupScalingRatio` | 3.999 | 3.9988, which is 10 001 over 2 501: one comparison each at both sizes |

It also kills a mutant that `scripts/gates/mutation-survivors.json` carried as not behavioural, because
`src/core/parse/` had no work counter to assert it against: `prefixAt` of `commit-lookup.ts` emptied, which puts
every target in one bucket and leaves every answer the same. Planted by this lane at its head, it turned four cases of
`commit-lookup.test.ts` red — 6 and 10 comparisons where 2 are asserted, 2 where none are, 50 000 where 1 000 are —
and the counted benchmark's comparisons per reference red at 10 000; all were green again with it removed, so the
entry was removed.

## Colour codes

### What the reader's commands print today

Nothing coloured. With each of `color.ui`, `color.branch`, `color.diff`, `color.status`, `color.decorate` and
`color.showBranch` set to `always` on the command line, one at a time and all six together, none of the five
commands the reader runs — `rev-parse`, `log`, `for-each-ref`, `stash list`, `status` — printed an escape sequence
(git 2.51.0, measured by this lane on a scratch repository), while `git branch` under `color.branch=always`
printed three. Every format the reader asks for is plain: `--format` without a `%C` placeholder, `for-each-ref`
without a `%(color)` atom, and porcelain `status`.

### Why it is overridden anyway, and which key

A `%C(…)` placeholder in a `git log` or `git stash list` format is coloured whenever colour is on for the command,
so the first format to use one would put escape sequences into a subject or a stash name for every user with colour
on. The reader now runs every command with `-c color.diff=never`, in `PARSING_CONFIGURATION` of
`src/adapters/git-commands.ts`, beside the two keys it already overrode. **That line is what the immunity hinges
on.**

`color.diff` and not `color.ui`, and this is the configuration of another kind that would defeat the obvious
override: `git log` and `git stash list` read `color.diff` for colour and fall back to `color.ui` only when it is
unset. With `-c color.ui=never` alone, a user's `color.diff=always` still coloured `%C(red)` in both; with
`-c color.diff=never`, none of `color.ui`, `color.diff`, `color.branch` or `color.status` set to `always` coloured
either. Given on the command line, `color.diff=never` also beat `color.diff=always` from a global file named by
`GIT_CONFIG_GLOBAL`, from `GIT_CONFIG_COUNT` and its pairs, and from `GIT_CONFIG_PARAMETERS` (each measured by this
lane, git 2.51.0). `for-each-ref` reads no colour key for its `%(color)` atoms — under `color.ui=always` it printed
none, and printed them only with `--color=always` — and porcelain `status` is never coloured, so neither needs a key.
A command added later that reads a key of its own, such as `git branch` and `color.branch`, needs that key
overridden beside this one; the comment above `PARSING_CONFIGURATION` says so.

### What holds it

`src/adapters/git-colour.spec.ts`, against three sources of colour, one at a time, each with the system file off and
an empty global file except where the global file is the source: the repository's own `.git/config` (the
`colour-config` repository: `color.ui`, `color.branch`, `color.diff` and `color.status` all `always`, with a branch,
both kinds of tag, a remote-tracking branch, a stash and an untracked file), a global file setting `color.ui` and
`color.branch` to `always`, and `GIT_CONFIG_COUNT` setting `color.diff` to `always`. For each:

- every command the reader runs prints no escape sequence, and every reference name, subject and person on a page
  is free of one and equal to what git reports — which held before the override, so it cannot catch its removal;
- a `%C(red)` placeholder in a `log` and a `stash list` format **is** coloured when git runs without the reader's
  configuration, and is not coloured, and otherwise identical, when it runs with it. This is the case that catches
  the override being removed.

**The planted regressions**, each run once by this lane on 2026-10-27, predicted first:

| planted in `PARSING_CONFIGURATION` | predicted | observed |
| --- | --- | --- |
| `color.diff=never` removed | the override case red for all three sources; the six other cases green | 3 failed, 6 passed |
| `color.diff=never` replaced by `color.ui=never` | red for the repository and the environment, whose `color.diff=always` defeats it; green for the global file, which sets only `color.ui` and `color.branch` | 2 failed (repository, environment), 7 passed |
| restored | all green | 9 passed |

`src/adapters/git-selection.spec.ts`, which holds the default argument lists written out by hand, gained the two
new entries, with a comment saying this slice added them.

## Remote branches from git svn

By git-svn's own documentation (no `git svn` was run for this slice), `git svn` without a prefix writes the svn
trunk as `refs/remotes/trunk`, each svn branch as `refs/remotes/<branch>` and each svn tag as
`refs/remotes/tags/<tag>`; with `--prefix=svn/` they sit under `refs/remotes/svn/`. None of these names a remote.
The `svn-remotes` repository writes those references with `update-ref`, which is all a page reads of what `git svn`
leaves behind.

**What the reader makes of each**, measured on the `svn-remotes` repository (`refs/remotes/trunk` on a commit no
other reference reaches, `refs/remotes/tags/v1`, `refs/remotes/svn/trunk` and `refs/remotes/origin/main`): every one
is `RefKind.RemoteBranch`, named by what follows `refs/remotes/` — `trunk`, `tags/v1`, `svn/trunk`, `origin/main`
— which is exactly the list `git branch -r` prints. It already did so before this slice: the reader classifies by
the `refs/remotes/` prefix alone and never splits a name into remote and branch, so nothing needed fixing.
`--remotes` walks every reference under `refs/remotes/`, so the commit only `trunk` reaches is on the page with its
label; a selection of `refs/remotes/trunk` or `refs/remotes/tags/v1` reads that branch's history, since S09 reads any
name under `refs/remotes/`; and hiding remote branches drops all four and that commit. `src/adapters/git-refs.spec.ts`
holds each of these against git.

**`refs/remotes/tags/v1` stays a remote branch named `tags/v1`, not a tag**, for three reasons:

- it is what git says: `git branch -r` lists it among the remote branches, and `git tag` lists nothing in that
  repository (both run by this lane);
- it is what it is in svn, by svn's model rather than by anything measured here: an svn tag is a copy in the
  repository that can be committed to like any branch, so the reference that follows it can move, where a git tag
  is not expected to;
- a tag here would break the one rule S09 gives S10 for turning a label back into the name a selection carries —
  `refs/remotes/` before a remote branch's name, `refs/heads/` before a local one's — and a selection names
  branches only, so the history behind an svn tag could not be selected. Kept a remote branch, it is selected as
  `refs/remotes/tags/v1` like any other.

## What is not handled

- **A reading on a free machine.** The readings above were taken under 56 to 84 per cent average load and say
  nothing about absolute speed. No budget was set from them; the counter is the ratchet.
- **Loose references.** `many-refs` is packed. A repository whose thousands of references are loose files makes
  `for-each-ref` read a file each; that was not measured.
- **More than `for-each-ref` reads.** References under `refs/` outside `heads/`, `remotes/` and `tags/` — notes, a
  host's `refs/pull/*` — are not read, as before.
- **The contract's sentence.** `RefKind.RemoteBranch` in `src/contracts/refs.ts` documents itself as
  `refs/remotes/<remote>/<branch>`, which an svn branch such as `refs/remotes/trunk` is not. What the reader does is
  unchanged and correct by git's account; the sentence is outside this slice's boundary, so it was not changed.
- **The view.** How the Branches dropdown lists thousands of branches, and how labels of svn branches are drawn,
  is `src/ui/`'s and S10's.
