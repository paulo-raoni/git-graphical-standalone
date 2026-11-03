# E04-M01-S02 · Ref names and the adapter's sentences

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S02 ref names and the
adapter's sentences

Nothing in the window changed in this slice. A branch selection the window sends is now read only for names git's
own ref-name rules accept, the colour override is held for every argument list the git adapter exports, and four
sentences of the adapter and its documents that measurement had contradicted are put right. It takes the items 24,
25, 31 and 33 that E03-M01's review rounds 04 and 05 carried into this milestone (`docs/PLAN.md`). It has no
reference behaviour of Git Graph: the rules are git's.

## A branch name git refuses never reaches git

**What was wrong.** The adapter read a selected name when it began with `refs/heads/`, or with `refs/remotes/`
while remote branches are shown (`isReadBranch` in `src/adapters/git-commands.ts`), and three places said that
this kept a tag, `HEAD` or `refs/stash` from riding in under a branch's name. E03-M01's review round 04 measured
`refs/heads/side...refs/stash` and `refs/heads/side..HEAD` passing that check, and git reading the stash's and
HEAD's commits for them, since git reads `a..b` and `a...b` as ranges.

**The rule.** `isRefName` in `src/core/page/ref-name.ts` says whether a name is one git accepts as a reference
name: the rules of `git check-ref-format`, applied to the whole name, without `--allow-onelevel`, `--normalize` or
`--refspec-pattern`. It refuses a name holding `..`, `@{`, a control character (U+0000 to U+001F, U+007F), a
space, `~`, `^`, `:`, `?`, `*`, `[` or `\`; a name with no `/`, which is how the single character `@` is refused;
a name beginning or ending with `/` or holding `//`; a component beginning with `.` or ending with `.lock`; and a
name ending with `.`. `isReadBranch` reads a name only when the prefix rule holds **and** `isRefName` accepts it;
the line the guarantee hinges on is `isRefName(name)` in `isReadBranch`'s return expression. It spawns no git.

**Measured against git, not only read from its documentation.** A script outside the repository called
`isRefName` and `git check-ref-format <name>` (git 2.51.0, on the development machine, one process per name) on
652 names: `refs/heads/<x>` for every string `<x>` of one or two characters over a 24-character alphabet (`a`,
`.`, `/`, `@`, `{`, `}`, `~`, `^`, `:`, `?`, `*`, `[`, `]`, `\`, space, tab, line feed, U+0001, U+001F, U+007F,
`!`, `-`, `é` and U+1F600), 600 names, and 52 whole names written by hand for what a two-character suffix cannot
reach (`.lock` components, one-level names, `@`, leading and doubled slashes, round 04's two names, and others).
The two gave the same verdict on all 652, accepting 110 (E04-M01-S02, 2026-11-03). The names were passed to git
as process arguments through Node's `spawnSync`, so a name holding NUL was not in the corpus; NUL is refused by
the control-character rule and the unit test holds it.

**Where it lives, and why there.** It decides which names a page is read from, a decision that can be wrong, so
it is in `src/core/` under the mutation gate (`docs/ADR-0002-architecture-and-performance.md` decision 1), and it
sits in `src/core/page/` beside `shownWorkingTree`, the other rule a branch selection is read under. Not in
`src/core/parse/`, which holds parsers of git's output, and not in `src/contracts/`, whose rules are there because
the renderer, which may reach no other ring, calls them (`src/contracts/index.ts`); nothing in the renderer calls
this one, and in `src/contracts/` it would have entered the contract's shape record for no reader.

**What a refused name gets.** The same answer as a name git does not resolve: it is dropped and the rest of the
selection is read, and a selection whose every name is dropped reads no commit. No request or response shape
changed. The fixtures suite holds this on the `colour-config` fixture, which has a branch `side` one commit below
`main`, HEAD on `main` and a stash on top of it (`src/adapters/git-colour.spec.ts`, *a selection naming a revision
expression behind a branch's name*): git's own log of each of round 04's names holds HEAD's commit and the
stash's two commits; the page of either name alone has no commit, like the page of `refs/heads/gone`; and the
page of either beside `refs/heads/side` equals the page of `refs/heads/gone` beside it and git's log of
`refs/heads/side`, holding none of those three commits. The case is in that file and not in
`git-selection.spec.ts` because this slice's boundary held the one and not the other.

**What it costs a page request.** One call per selected name in `revisionArgs` and one in `selectsAnyRevision`.
Timed outside the repository over four names (`refs/heads/main`, a 59-character branch name, a 35-character
remote-tracking name and `refs/heads/side..HEAD`), a million calls a run after a warm-up: 2.2 to 2.5 µs a name
over five runs, with the processor load sampled at 100 % before and after by the operating system's processor
counter (other work on the shared machine; no budget reads this number, so the reading was kept, and it is a
figure taken under load, not on a free machine).

**What neither check refuses.** A name passing both is still resolved by git's own rules for a name, which try it
under `refs/`, `refs/tags/`, `refs/heads/` and `refs/remotes/` as well as alone. On a scratch repository with no
branch `gone` and a tag spelled `refs/heads/gone` (the reference `refs/tags/refs/heads/gone`), git 2.51.0 printed
that tag's history for `log --ignore-missing refs/heads/gone --` (E04-M01-S02, 2026-11-03). The Branches dropdown
builds names from the branches a page lists (E03-M01-S10), so through it such a name can reach git only for a
branch deleted since it was chosen, in a repository holding a reference of that spelling; that is an inference
from how the dropdown builds names, not a measurement. Closing it is not in this slice: it is raised in its audit.

**The sentences.** `isReadBranch`'s comment, the description of `BranchSelection` in `src/contracts/ipc.ts`, and
the S09 slice document of E03-M01 now say what is refused, why, and who measured it; the S09 document keeps its
original sentence's place with a dated correction rather than a silent rewrite.

**Size.** `repository.cjs` measured 28 903 production bytes against 28 614 at the base, both by
`npm run gates:size` on 2026-11-03 (the base over a `git archive` of `9f5a1ac`), 289 bytes more: `ref-name.ts` is
281 of them in esbuild's metafile and `git-commands.ts` grew from 1 127 to 1 135. Its budget had 58 bytes left, so
it moved to the measured size, the smallest that holds, as the task directed; `scripts/gates/size-budget.json`
says so under `comment-e04-m01-s02`, and `scripts/gates/module-manifest.json` names the new module.

## The colour override is held for every argument list

`src/adapters/git-colour.spec.ts` held the `color.diff=never` override through `PARSING_CONFIGURATION` and two
argument lists written in the test, so E03-M01's review round 05 removed it from `stashArgs` and the suite stayed
green. It now holds it for every list the adapter exports, in two ways:

- **Every list carries it, ahead of the git command.** For each of `repositoryProbeArgs`, `commitLogArgs` (every
  branch, and a selection), `referenceArgs` (remote branches shown and hidden), `stashArgs` and `statusArgs`, the
  whole of `PARSING_CONFIGURATION` must appear, in order, before the git command's own name, where git reads it as
  configuration. A further case compares the names of the module's exports ending in `Args` with the lists held,
  so a list exported later fails that case until it is added.
- **The two lists a `%C` placeholder colours are run as built.** The log and stash-list lists, with their format
  swapped for one holding `%C(red)`, are run under each of the three colour sources and must print no escape
  sequence, while the same list with the configuration taken out must print one. The probe, the reference list
  and the status list print nothing a `%C` placeholder reaches, so for them the first check is all that can be
  held.

Removing the override from `stashArgs` turned both checks red; removing it from `statusArgs` turned the first one
red (this slice's probes, recorded in its audit).

## The other two sentences

- `revisionArgs`'s comment named `git-page.spec.ts` as the file holding the default argument list;
  `git-selection.spec.ts` holds it (its *every branch, as the arguments that were run before selections existed*).
- `perf/refs.perf.test.ts` attributed the `many-refs` fixture to `test/fixtures/generate.ts`; it is built by
  `manyRefs` in `src/adapters/reference-fixtures.spec-support.ts`, which the generator does not name.

## What proves it

- `src/core/page/ref-name.test.ts`: round 04's two names, each refusing rule by name with a name that only that
  rule refuses, and accepted names beside them; 100 % coverage inside the mutation scope.
- `src/adapters/git-colour.spec.ts`: the override in every exported list, the two coloured lists run as built, and
  round 04's names through the reader on the `colour-config` fixture.
