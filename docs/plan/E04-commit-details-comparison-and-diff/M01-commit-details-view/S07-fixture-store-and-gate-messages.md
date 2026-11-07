# E04-M01-S07 · Fixture store and gate messages

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S07 fixture store and
gate messages

Nothing in the window changed in this slice, and no gate decides anything differently. Each gap below was a
guarantee of the project's own gates or test fixtures that no committed check held, or a sentence that a
measurement contradicted. It takes items 8, 11, 12, 13, 14 and 15 that E03-M01's reviews carried into this
milestone (`docs/PLAN.md`), and the findings C-01, C-02, C-03 and C-05 of this milestone's review round 01 and
C-14 of its round 02. It has no reference behaviour of Git Graph.

Every probe named below was planted, seen red, removed and seen green by this slice on 2026-11-07, on the
development machine; the audit carries the four steps of each.

## The licences gate says why it refuses a package

**What was wrong.** `scripts/gates/licences.js` said a licence "is not on the allow-list" for every refusal,
also for a package that `licence-allow-list.json` names under an exception for another licence. The list's
`comment` did not mention exceptions at all.

**The message now.** One of two, after `<package>@<version> is under "<licence>", which is not on the
allow-list, and`:

- `no exception names <package>`, when no entry of `exceptions` names the package;
- `the exception for <package> allows "<licence>" only`, when one does, for another licence.

This is the one message of a gate this slice changed. The `comment` now says that an exception names one package,
one licence and the reason, and allows that licence for that package and nothing else.

**Held by** `test/gates/licences.test.ts`, which calls the gate's `findingsFor` over the committed list for
packages it names, both reasons, `UNKNOWN` for a scoped package, a package under several licences, and the two
verdicts that accept. The line it hinges on is `whyRefused` in `licences.js`. Probe: the old message put back,
four of six cases red. For the check to import the gate without running the licence checker, the gate now runs
only when it is the program started (the same guard as `mutation.js`); `node scripts/gates/licences.js` still
checked 518 packages and printed `licences: ok`.

## The commits gate's range, read in a repository the check builds

**What was wrong.** Review round 02 of E03-M01 removed `--no-contains=HEAD` from `promotionTagsBehindHead` and
every gate stayed green. Without it a promotion tag on `HEAD` itself is the latest, so the commit a promotion
tags reads an empty range, and its release merge is read by none.

**Held by** `test/gates/commits.test.ts`. It builds a repository in a temporary directory of its own: a scaffold
tagged `v0.0.0`, two promotions merged from `dev` into `main` with `--no-ff` and tagged `v0.1.0` and `v0.2.0` as
annotated tags, a lightweight `v0.9.0` behind `dev`'s tip, a branch joining two independent annotated tags, and an
orphan branch with no tag. It moves `HEAD` and reads `defaultRange`, the range `commits.js` reads when none is
given, now exported and taking the repository; the gate itself passes this repository's root, as before. Five
cases: the release merge tagged `v0.2.0` reads `v0.1.0..HEAD`, which holds that merge and its slice; `dev`'s tip
reads `v0.2.0..HEAD`, past the lightweight tag; the orphan reads `HEAD`; the joined branch is refused; and the
repository is outside this one. Each range is held by the subjects of the commits it holds, which no commit of
this repository carries.

The line it hinges on is `--no-contains=HEAD`. Probe: removed, the release-merge case red, reading
`v0.2.0..HEAD`. The gate runs only as the program started, like the licences gate; `node scripts/gates/commits.js`
still printed `commits: checking v0.2.0..HEAD, because v0.2.0 is the latest promotion tag behind HEAD`.

## The store's checks split, and its copy numbering held

**The split.** `test/fixtures/shared-store.test.ts` was at 298 of the 300 lines `max-lines` counts. The cases
that call `verifiedCopy` directly, *a copy that differs from its record the moment it is published* and *removes a
changed copy once every process it was handed to has exited*, moved to `test/fixtures/shared-store-copies.test.ts`
with their bodies unchanged; the old file keeps every case that loads the two stores. The old file's 36 case
names, as vitest's JSON reporter listed them from a run before the split, are exactly the 36 names the two files
report after it, with the new case the only one added; all 37 passed. Only comments in the moved case changed:
the one pointing at `holdsTo`, which now names the file it is in, and the one the next section narrows.

**The numbering.** A store builds the copy one past the highest that exists (`(copies.at(-1) ?? 0) + 1` in
`verifiedCopy`). Review round 02 of E03-M01 changed that, and all 36 cases stayed green: each reached a new copy
with copies 1 to n present, where the count of copies plus one is the same number. The new case, *the number of
the copy a store builds is one past the highest copy that exists, so a gap below it is not built into*, lets the
store leave a gap: copy 1 is handed to the check and changed, copy 2 is handed to another process that exits and
then changed, and the next ask removes copy 2 and builds copy 3. With copies 1 and 3 both changed and kept, the
next ask must build copy 4, and copy 2 stays absent. Probe: the number counted (`copies.length + 1`), the case red
with `linear.3 differs from its record as soon as published`, since copy 3 exists.

## "No number is used twice", narrowed

That sentence stood in `shared-store.ts`'s header, in E03-M01-S05's slice document and in the comment of the last
case. What the code holds is narrower: a copy is built one past the highest that exists when a process lists the
copies, so a number below a copy that exists then is never built again, and a removed copy below the highest
leaves a gap nothing builds into, which the case above holds. A number is built again when a process lists the
copies at a moment when no copy at or above it exists. Review round 02 of E03-M01 read one such moment in the
code: a process lists the copies after another has removed the only copy and before that one has published the
next, so it builds copy 1 again. This slice did not measure that race; each of the three places labels it as round
02's reading. The S05 document keeps its sentence under a dated note.

## What `vitest.fixtures.config.js` collects

Its header said it collects every check outside `src/` and that what they prove is agreement with a real git.
`perf/**/*.perf.test.ts` (collected by `vitest.perf.config.js`) and `test/e2e/**/*.spec.ts` (Playwright) are
checks outside `src/` it does not collect, and the checks of `test/gates/` spawn no git, except the commits check,
which spawns git only to build its repository. The header now names the two patterns, the three kinds of check
under `test/` (fixtures and stores against git, the end-to-end partition against Playwright, the gate scripts
over recorded reports, named entries or a built repository), and why no coverage is collected for either half.

## The survivor list's arithmetic, dated

The list's `comment` and `mutation.js` argued that `break` cannot fail for anything short of a collapse from
"the 1195 mutants of this scope": 180 survivors to fail, 140 in the largest file. This milestone's review round 01
reported 1617 mutants in its gate run, and its rounds 02 and 03 reported 1896 each, as their gate matrices read;
Stryker instrumented 1896 for this slice's dry runs. Both texts now state the argument in a form that holds at any size, `break` passing the
loss of one file's tests while no single file carries 15 per cent of the scope, and give the old numbers as those
of E01-M01-FIX-07 (`9ab3a17`, 2026-09-13), which wrote them. This slice did not count the largest file's share of
today's scope.

## Stryker's event records kept out of its sandbox

Stryker's `event-recorder` reporter writes its records under `reports/mutation/events/`, and Stryker 10.0.0
always leaves out of its sandbox only the HTML and JSON reports of `reports/`, with `node_modules`, `.git` and a
few others (`ALWAYS_IGNORE` and the reporters' file names in `dist/src/fs/project-reader.js` of
`@stryker-mutator/core`, read by this slice). So every run copied the previous run's records into its sandbox.
`stryker.config.json` now sets `ignorePatterns` to `/reports/mutation/events`.

Shown with `npx stryker run --dryRunOnly --cleanTempDir false`, which keeps the sandbox: with the ignore removed,
the sandbox held the previous run's `reports/mutation/events/00000-onDryRunCompleted.json`, 258 files outside
`node_modules` against 257; with the ignore, the sandbox had no `reports/` at all, 257 files.
`mutation-remeasure.js` reads the dry-run record from the working tree, not the sandbox: after the run with the
ignore, `remeasure` handed one suspect and no recorded dry run gave its first run a budget of 126 004.5 ms, which
is 1.5 times the record's net 4 003 ms plus `timeoutMS`' 120 000 and its overhead of 0, so it found the record.

## `originalOf`'s white-space collapse held

The survivor list keys a mutant by the text it replaces with every run of white space read as one space
(`originalOf` in `mutation-remeasure.js`), so that a reflowed survivor keeps its key, and no check went red without
that. `test/gates/mutation-survivors.test.ts` now breaks the listed `bytes.ts` condition `at < units.length` over
two lines, moves every position after the break, and holds the run to no refusal. The line it hinges on is
`.replace(/\s+/g, ' ')`. Probe: that line deleted, the case red with two findings, the survivor unlisted and the
entry naming nothing.

## `perf/baselines.ts`'s count

Its comment said the `ciTolerance` of "all eight entries" of `perf/baselines.json` that have one. There are nine
since E04-M01-S05, read by this slice on 2026-11-07, each at 4. The comment now says every entry that has one, at
4, with who read it and when, and that an entry without one is not widened.
