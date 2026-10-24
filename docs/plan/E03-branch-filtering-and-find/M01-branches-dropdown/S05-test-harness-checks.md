# E03-M01-S05 · Test-harness checks

**Parent:** E03 Branch filtering and find > E03-M01 Branches dropdown > E03-M01-S05 test-harness checks

E01-M01's review rounds 21 and 22 carried seven gaps in the test harness to this milestone (`docs/PLAN.md`,
*Carried into E03-M01*, items 15, 16, 17, 25, 26, 29 and 31). None is a defect a user meets; each let a later
edit break the harness without any gate saying so. Six of them now have a check or no longer exist. The
seventh, `engines`, is decided below and **not changed**: the change needs a line of `package-lock.json`,
which this slice could not touch.

Every measurement here was taken on 2026-10-24 on the development machine (Windows 11, Node 24.18.0, npm
11.16.0, Playwright 1.63.0, Vitest 5.0.0) by this slice's executor, unless it names another author. Other
lanes of this wave, a review of this milestone and another project's runs held the machine at or near 100 per
cent processor load for most of the day; no reading below except the budgets readings is a time.

## The end-to-end partition (item 15)

`test/e2e-partition.test.ts` asks Playwright which cases each project of `playwright.config.js` collects and
holds the two lists to every case of `test/e2e/`: a case in both projects, a case in neither, a case a project
lists that is not a case of the folder, or a third project, each fails it with the case named. It is a
`*.test.ts` under `test/`, so `vitest.fixtures.config.js` collects it and `npm run gates:unit` runs it, which
puts it in the quick and the full tier and in the workflow's unit job without a new script. Listing loads the
spec files and runs none of them; under the load of the day Vitest reported 8.9 seconds for the file in one
run, and the whole command took 26.

**Every case is not what `playwright test --list` prints with no project named**, although that is the list
E01-M01-S11 compared with. With no project named, Playwright lists each project's own cases, so a case no
project collects is missing from that list as well. Measured with the `budgets` project's pattern changed to
match nothing: no project named, 44 cases; `--project=application`, 44; `--project=budgets`, 0. The union of
the two projects equals the unfiltered list, so that comparison passes with six cases run by no gate. So the
check lists every case a second time, through a configuration that imports the committed one and replaces its
two projects with one that filters nothing, written for the run into a temporary directory of its own and
removed after it.

At this slice's head: 50 cases, 44 in `application` and 6 in `budgets`, none in both or neither.

| probe, in `playwright.config.js` | result |
| --- | --- |
| `application`'s `grepInvert` changed to a pattern that matches no title | red: the six tagged cases named, each "in both projects"; application listed 50 |
| `budgets`' `grep` changed to a pattern that matches no title (a renamed tag) | red: the same six named, each "in neither project, so no gate runs it"; budgets listed 0 |
| both removed | green, 50 cases |

The line it hinges on is the one in `partitionComplaints` that requires each case of the folder to be in
exactly one project. The comparison's own three cases hold it with chosen lists, so it is seen failing without
touching the configuration.

## The CI regime (item 16)

`regimeOf` in `perf/baselines.ts` now reads four spellings of `CI` and refuses every other: unset, empty or
blank, `0` or `false` is the strict regime; `true` or `1` the CI regime; case and surrounding space ignored.
Anything else throws, with the value in the message, so the case that asked fails.

The argument. GitHub Actions' variables reference, read on 2026-10-24, gives `CI` as always set to `true`, and
`.github/workflows/ci.yml` does not set it, so the CI regime needs nothing but `true` from the runner. Nothing
on the development machine set `CI` that day, in a Bash or a PowerShell session, for the process, the user or
the machine, so a value there is typed by a person. A wrong reading has two directions, and they are not
alike: read as the CI regime, a value meant as "not CI" holds the run to limits four times wider (the
`ciTolerance` of all eight entries of `perf/baselines.json` that have one) and stays green, which nobody sees;
before this slice `no` and `off` were read that way. Read as the strict regime, a value meant as "CI" goes red
on a runner, which is seen but blames the product. Refusing is wrong in neither direction and costs one
retype. `1` stays beside `true` because the code read it as the CI regime before and it is the other spelling
of yes a shell user reaches for. The accepted spellings are a `Map`, so that `constructor` is not found on an
object's prototype and read as a regime.

`perf/baselines.perf.test.ts` holds every spelling: five forms of `true` and `1` read as the CI regime, seven
of `0` and `false` and four of unset or empty read as the strict one, and eleven values refused (`no`, `off`, `yes`, `on`, `ci`, `github`, `2`, `-1`, `01`, `t r u e`, `constructor`).

| probe, in `regimeOf` | predicted | result |
| --- | --- | --- |
| the refusal disabled and an unread value returned as `ci`, the old reading | the eleven refusals red, the other 42 cases green | 11 failed, 42 passed |
| the `Map` lookup replaced by the same table as a plain object | only `constructor` red | 1 failed, 52 passed |

The line it hinges on is the `if (regime === undefined)` that throws.

## The copied helpers (item 17)

`perf/workloads.ts` holds the one copy of everything the timed benchmark files used to copy from their
counted siblings: `braided` and the two page sizes, the store's `nameInto` and `build` and its three sizes
(with the comments that say why each was chosen), `held`, and `slackPerCent`, `siteOf` and `report`. All four
files import it. Its name matches neither `*.perf.test.ts`, which `vitest.perf.config.js` collects, nor
`*.timed.perf.test.ts`, which `gates:perf` excludes and `gates:budgets:benchmarks` selects.

**No assertion changed and none was lost.** As S11 did, a script read every `perf/*.perf.test.ts` and listed,
for every case, its describe path and title, the baseline entries its body names and the number of `expect`
calls in its body. At the base and at the commit that moved the helpers (`ebe3dbb`, read from an archive of
that commit) the two lists are equal, 36 cases. At
this slice's head they differ only by the cases scope item 2 added to `baselines.perf.test.ts`. The one
`expect` that moved is the `toBeDefined` inside `held`, which is now `perf/workloads.ts`'s and is called by the
same cases with the same arguments. `vitest list` with each gate's arguments at the head: `gates:perf` collects
`allocation`, `baselines`, `layout` and `store` and no case of a timed file; `gates:budgets:benchmarks`
collects the three timed cases in the three timed files; the two lists together are the unfiltered list, and
`perf/workloads.ts` contributes no case to any of them.

What this costs the budgets gate: the timed layout and the timed store build now call functions of another
module. Whether that moves their readings is read under *The budgets gate* below.

## The index half of the fixture record (item 25)

Review round 22 found that with the index's digest made constant, every case of
`test/fixtures/shared-store.test.ts` passes. Reproduced at the base: 32 of 32 passed. The new damage, *a file
removed from the index alone*, is `git rm --cached file.txt` on a `linear` repository: the working tree keeps
the file, now untracked, and `.git/index` is left out of the record, so only the digest of what
`git ls-files --stage` lists moves. It is made to a repository of each store.

| probe | predicted | result |
| --- | --- | --- |
| the index's digest made constant in `stateOf` | the two new cases red, the other 34 green | 2 failed, 34 passed |

The line it hinges on is the `INDEX` entry of `stateOf` in `test/fixtures/shared-store.ts`.

## Damage cases that leaked (item 26)

The adapter suite's store handed out one published copy per shape, so a damage case was handed what an
earlier case had damaged, or its next copy. Shown at the base by running the file with Vitest's
`--sequence.shuffle.tests --sequence.seed=1`: 1 of 32 failed, *publishes every repository of the
specification*, which had come after *a branch moved* and *a branch removed* and found `branch-and-merge`
changed.

`fixtureAt` in `src/adapters/fixtures.spec-support.ts` now takes an optional set, and publishes a set's
repositories under the store's `sets/<set>/`, which no other caller names; every damage case asks for
`damage-<index>`. The end-to-end store's cases already asked for a name of their own each. Run at this slice's
head in three orders, all 36 passing in each: the declared order, and shuffled with seeds 1 and 2, in which
*publishes every repository* came sixth and seventh among the adapter suite's cases.

| probe | predicted | result |
| --- | --- | --- |
| the set ignored, so every damage case is handed the shared copy again; shuffled, seed 1 | *publishes every repository* red | 1 failed, 35 passed: that case |

The line it hinges on is the `published` path of `fixtureAt`.

## What the stores leave behind (item 29)

**A changed copy is removed once no process it was handed to is running**, by the first process that passes
over it after that. A copy is handed out only while it matches its record, so whoever may still be reading a
changed copy was handed it before it changed. Beside each copy, `<copy>.handed/` holds one empty file per
process the copy was handed to, named by its process identifier and written before the check, so a process
deciding whether to remove a copy sees every process about to read it; a file whose process has exited is
removed by the next process that reads the directory. Copy numbers are never used twice: a store checks every
copy that exists, lowest first, and builds one past the highest, so a removed copy leaves a gap nothing builds
into again.

Why not by age: no bound is known on how long a run holds a path. Why not at once: E01-M01-FIX-33 measured, and
this slice did not repeat, that on Windows a recursive removal is refused while another process has its working
directory in the directory, but succeeds while that process merely holds a file open in it, and succeeds
between two git processes of a run whose next `git -C` then fails. `AGENTS.md` §5's caution is the same one in
another place: what another process may still be using is not removed on a guess. What this cannot see is a
process of code older than this slice, which writes no file; a copy that changes while such a process reads it
can be removed under it.

**The stores published before `ade2dd6`**, `git-graphical-standalone-e2e-shared-<recipe>` and
`git-graphical-standalone-unit-shared-<recipe>` under the temporary directory, are removed by
`removeOldStores`, which each store calls when its module loads. Their readers take no lease, so nothing can
say when none is running; they are removed anyway because what a removal can cost is small and bounded. Read in
`ade2dd6^`: the old end-to-end store builds a repository it does not find, and the old adapter suite's
`ensureFixtures` builds the whole set when it is absent, so the worst a removal does is redden one run of
pre-`ade2dd6` code that is going at that moment and whose git lands in the gap FIX-33 measured. No lane or
review of this milestone runs code that old; a checkout of it run on purpose is safe with a `TEMP` of its own.
Names are matched exactly, twelve hexadecimal characters after the prefix, so the current stores' `-verified-`
directories and anything else are left. On this machine the two were 21 MB and 3.2 MB by `du` before this
slice's first gate run in the real environment.

The cases, in `shared-store.test.ts`: two old-store names planted in the run's private temporary directory are
gone once the stores have loaded, and two look-alikes stay; a copy handed to a child process that has exited,
then damaged, is removed when the test process asks, together with its `.handed` directory, copy 2 is handed
out, and asked again copy 2 is handed out with copy 1 still absent. The other half, a changed copy kept while a
process it was handed to runs, is every damage case's: the test process was handed what it damages and still
runs, and each case requires the damaged copy to stay.

| probe, in `test/fixtures/shared-store.ts` | predicted | result |
| --- | --- | --- |
| `removeOldStores` returns at once | the old-store case red | 1 failed, 35 passed: that case |
| every lease's process read as running | the removal case red | 1 failed, 35 passed: that case |
| no lease counted, so a changed copy is removed while its reader runs | the 28 damage cases red, the removal case green | 28 failed, 8 passed |

## `engines` (item 31): decided, not changed

**What it should say: `"node": "24.18.0"`.** The project's own toolchain is what `engines` describes (the
application runs on Electron's Node, not this one), and that toolchain is held to one runtime:
`gates:perf`'s allocation case refuses to compare under any V8 but `13.6.233.17-node.50`, and continuous
integration is pinned to Node 24.18.0 for that reason. `>=24.0.0` admits every runtime that refusal turns away;
an exact version says the same thing as the workflow and the case, and is moved with them when their entries
are measured again.

**What `npm ci` does with it on another 24.x**, measured by giving a scratch copy of the project
`"node": "24.17.0"`, which the installed 24.18.0 does not satisfy: it prints an `EBADENGINE` "Unsupported
engine" warning naming the required and the current versions, installs all 534 packages, and exits 0. That
trial ran with `engine-strict` false, as `npm config get engine-strict` printed, and the project's `.npmrc`
sets only `save-exact`. So the change informs a developer on another Node at install time; it does not stop
them.

**Why it is not changed.** npm records the root package's `engines` in `package-lock.json` (its line 32 at the
base). Given `"24.18.0"` in a scratch copy, `npm install --package-lock-only` rewrote that line and nothing
else; `npm ci` with the old lockfile installed and left it unchanged. So the lockfile's metadata must change for
the two files to agree, and the task says to stop there, `package-lock.json` being outside this slice's
boundary. What is left is the two lines, `package.json` and `package-lock.json`, in one lane that may touch both.

## The budgets gate

The task requires `npm run gates:budgets` once on a free machine, because the timed benchmarks now call
`perf/workloads.ts`. The readings, kept and discarded, are in this slice's audit.

## What nothing checks

- `vitest.fixtures.config.js`'s header names the two suites it held before this slice and not the partition
  check; that file was outside this slice's boundary.
- A wall-clock case written without the tag still runs in `gates:e2e`: the partition check proves every case
  is in one project, not that it is in the right one.
- `perf/workloads.ts` is read by both gates, so an edit to it moves verdicts of both, in two tiers; that is the
  point of one copy, and also why a change there needs a budgets run.
- Stores of an older recipe digest, left when `test/fixtures/specification.json` changes, are not removed:
  another lane may still use that recipe, and they are not changed copies.
