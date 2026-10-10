# E01-M01-S11 · Gate tiers, and the wall-clock budgets as their own gate

`AGENTS.md` §11, *Gate tiers*, rules that a lane runs the gates its change can move and that the wall-clock
budgets are a gate of their own. It names four scripts. This slice lands them: three tiers in `package.json`,
the end-to-end cases split in two by a tag, the benchmarks of `perf/` split in two by a file name, and a job
for the new gate in the one workflow file. Two gates' commands changed, each only in what it selects:
`gates:e2e` and `gates:perf`. No script was removed or renamed, no assertion, limit, baseline or tolerance
changed, and nothing under `src/` or `scripts/` was touched.

## The four scripts

| script | what it runs, in order |
| --- | --- |
| `npm run gates:static` | `gates:provenance`, `gates:commits` |
| `npm run gates:quick` | `gates:format`, `gates:lint`, `gates:boundaries`, `gates:types`, `gates:contract`, `gates:unit`, `gates:build`, `gates:e2e`, `gates:perf`, `gates:size`, `gates:licences`, `gates:provenance`, `gates:commits`, `gates:placeholders` |
| `npm run gates` | the fourteen of `gates:quick` with `gates:mutation` between `gates:unit` and `gates:build`, where it was before this slice |
| `npm run gates:budgets` | `gates:build`, then `gates:budgets:benchmarks` (the timed benchmarks of `perf/`), then `gates:budgets:e2e` (the budgets set of the end-to-end cases) |

`gates` and `gates:quick` are two lists in `package.json`, each handed to `run-s`, which runs them one after
another and stops at the first that fails. They are two lists and not one script calling the other because
mutation sits in the middle of the order. So the two can drift: nothing checks that `gates` is `gates:quick`
plus mutation except a reader of that file. Compared on 2026-10-10 at `b60051f` by removing `gates:mutation`
from the first list: the remainder is the second, name for name.

`gates:e2e` keeps its name and is now `playwright test --project=application`. `gates:perf` keeps its name and
is now the same `vitest` run with the timed files excluded. `gates:budgets` is in none of the tiers, so
`npm run gates` no longer runs a case or a benchmark that is held to a clock.

`gates:budgets` builds for itself, as `gates:build` does, so that it can be run alone in a fresh worktree. Its
two steps are scripts of their own, `gates:budgets:benchmarks` and `gates:budgets:e2e`, run by
`run-s --continue-on-error`: a red in the first does not stop the second, so that one run reports every
reading, and the run fails if either failed. Measured on 2026-10-10 with a failing assertion planted in a
timed benchmark: the benchmark step went red, the six end-to-end cases ran after it, and the run exited 1.
In that run one end-to-end case was red as well, under load, so the exit status alone does not show the rule;
the same runner with the same flag, given the planted benchmark step and then `gates:size`, ran both, printed
`gates:size` green and exited 1.

## How the two end-to-end sets are selected

**By a tag in the case's title.** `playwright.config.js` holds one pattern, `BUDGETS`, which matches
`@budgets`, and uses it twice: as the `grep` of a project named `budgets` and as the `grepInvert` of a project
named `application`. A case whose title the pattern matches is collected by the first and refused by the
second; any other case is collected by the second and refused by the first. Whatever a case is called, it is
in exactly one set, and that one constant is the line the partition hinges on.

**The rule for whoever writes the next case:** a case whose verdict depends on the clock or on the machine's
load — a time, a frame cost, a processor percentage, a memory reading that waits for a settle — ends its title
with `@budgets`. A case with no tag runs in `gates:e2e`. The tag travels with the case through a rename of the
case or of its file, which a list of titles or a file-name pattern would not.

The split is by case, not by file, because two files hold both kinds:

| file | budgets set (`gates:budgets`) | application set (`gates:e2e`) |
| --- | --- | --- |
| `budgets-start.spec.ts` | all three cases: two cold starts and one load, each a time in milliseconds | — |
| `budgets-memory.spec.ts` | its one case: private memory after a settle, five idle minutes of processor time and wake-ups, memory after closing | — |
| `budgets-frames.spec.ts` | *main-thread work per frame while scrolling*: two frame costs in milliseconds | *live row elements* and *canvas redraws*: counts |
| `open-repository.spec.ts` | *the main process keeps answering while the whole of a large load runs*: asserts the worst round trip under 500 ms | its other eight cases |
| `budgets-git.spec.ts` | — | its one case: git processes per request and stored bytes, all counts |
| `golden-graph.spec.ts` and the seven other files | — | every case: counts, texts, orders and one byte comparison |

Measured on 2026-10-10 with `playwright test --list`, at `dab51b5` by this slice's third session and again at
`b60051f` by its fourth: 45 cases in 13 files with no project named, 39 in 11 files for
`--project=application`, 6 in 4 files for `--project=budgets`. Compared by file and title, no case is in both
lists and the two together are the 45. The list at this slice's base, `ef3981f`, was taken by this slice's
second session, the same day, from an unpacked copy of that commit: 45 cases in 13 files, the same ones once
the tag is removed from six titles. That session saw its comparison fail: with one line removed from the
application list it reported the partition broken.

How each untagged case was judged: every `expect` in `test/e2e/*.spec.ts` that compares a magnitude, and every
read of a clock, was listed by search on 2026-10-10 by the third session. Outside the six tagged cases the
magnitudes are counts (row elements, redraws, strokes, lanes), and the two clocks that are read — the five
*load more* presses of `open-repository.spec.ts` and the settle order of `superseded-reply.spec.ts` — are
printed or used for order, never compared with a limit.

**What nothing checks.** The judgement itself: a new wall-clock case written without the tag, or with the tag
misspelt, runs in `gates:e2e`, on a machine nobody checked was free. And nothing counts the budgets set, so
six cases becoming five is caught by no gate.

**The tagged lines are the only code that changed in the test files under `test/e2e/`.** Each of the six files
this slice touched there was transpiled by TypeScript with comments removed, from the base commit and from
the working tree, and compared line by line on 2026-10-10 at `dab51b5`: `budgets-git.spec.ts` and
`support/budgets.ts` are identical, and the other four differ in three, one, one and one lines, each a
`test('…'` line equal to its base line once ` @budgets` is removed. The comparison was seen failing at that
commit: a changed number in `budgets-git.spec.ts` and an added statement in `budgets-frames.spec.ts` each made
it report a difference and exit 1, and an added comment did not. No file under `test/e2e/` changed after
`dab51b5` (`git diff --name-only dab51b5..b60051f -- test/e2e` prints nothing). `open-repository.spec.ts`
still counts 285 of the 300 lines `max-lines` allows (measured by this slice's second session by running
ESLint with the limit set to 1).

## How the timed benchmarks are selected

`gates:perf` held three readings that are times. Run inside a tier on 2026-10-10 they were red on an unchanged
product in seven runs of seven (*The timed benchmarks before they moved*, below), as the end-to-end cases this
slice had already moved were on 2026-10-04, so they moved too.

**Which entries are which.** `perf/baselines.json` has 34 entries. Each is named by exactly one test file,
found on 2026-10-10 by searching every `perf/*.perf.test.ts` and `test/e2e/*.spec.ts` for the entry's quoted
name. Twenty belong to the end-to-end cases and are covered by the table above. The fourteen of the
benchmarks:

| entry | what its verdict is | gate |
| --- | --- | --- |
| `structuralBytesPerCommitWorst`, `structuralBytesPerCommit`, `structuralBytesPerCommitLarge` | bytes the store retains for a fixed number of commits: a count, no tolerance | `gates:perf` |
| `scalingRatio`, `workPerCommit` | operations the store counted: a count, no tolerance | `gates:perf` |
| `layoutWorkPerRow`, `layoutScalingRatio` | units of work the layout counted: a count, no tolerance | `gates:perf` |
| `parseBufferBytesPerCommit`, `layoutBufferBytesPerRow` | typed-array bytes allocated: a count, no tolerance | `gates:perf` |
| `parseHeapBytesPerCommit`, `layoutHeapBytesPerRow` | heap bytes allocated in a child process with no collection inside the run: not a time, held to 1.001 and 1.01 times the baseline | `gates:perf` |
| `parseMicrosecondsPerCommit` | **a time**: the fastest of five timed parses | `gates:budgets` |
| `layoutMicrosecondsPerCommit` | **a time**: the fastest of five timed layouts | `gates:budgets` |
| `buildMilliseconds` | **a time**: the slowest of three timed builds, held to ten times its baseline | `gates:budgets` |

The two heap entries read a number that differs a little from process to process (their `unit` strings record
3168.7272 to 3168.776 and 13.4814 to 13.5118 over five processes). They read no clock. They were green in the
`gates:perf` of every tier run of 2026-10-10 that this document records, the reddest of which ran at a
sampled load of 60 to 100 per cent; that a loaded machine cannot move them is not shown by that, only that it
did not.

**By the file's name.** A benchmark whose verdict is a time lives in a file named `*.timed.perf.test.ts`.
Both scripts run `vitest` with `vitest.perf.config.js`, which is unchanged and includes every
`perf/**/*.perf.test.ts`: `gates:perf` adds `--exclude "**/*.timed.perf.test.ts"`, and
`gates:budgets:benchmarks` adds the file filter `.timed.perf.test.ts`. No new configuration file was needed.
The selection hinges on those two arguments in `package.json` saying the same thing.

| file | `gates:budgets:benchmarks` | `gates:perf` |
| --- | --- | --- |
| `perf/parse.timed.perf.test.ts` | its one case; the file was `perf/parse.perf.test.ts` and is renamed, being wholly timed | — |
| `perf/layout.timed.perf.test.ts`, new | *lays a commit out in no more than five microseconds* | — |
| `perf/layout.perf.test.ts` | — | its two counted cases |
| `perf/store.timed.perf.test.ts`, new | *stays inside an order of magnitude of its recorded wall clock* | — |
| `perf/store.perf.test.ts` | — | its six other cases |
| `perf/allocation.perf.test.ts`, untouched | — | its one case |

Measured on 2026-10-10 with `vitest list` and the two scripts' arguments: 12 cases in 4 files at `c485633`,
before the move; at `b60051f`, 9 in 3 files for `gates:perf`, 3 in 3 files for `gates:budgets:benchmarks`, 12
in 6 files with neither argument. No case is in both lists, their union is the unfiltered list, and that list
is the 12 of before with only file names and one suite name changed (the store's timed case moved from the
suite *the commit store, counted* to *the commit store, timed*).

**No assertion changed and none was lost.** A script read each `perf/*.perf.test.ts` at `c485633` and in the
working tree and listed, for every case, its title, the baseline entries it names and the number of `expect`
calls in its body: the two lists are equal, twelve cases, with nine in files `gates:perf` selects and three in
files `gates:budgets:benchmarks` selects. The comparison was seen failing: with the one `expect` of the timed
layout case removed it reported that case different and exited 1. `perf/baselines.json` and
`perf/baselines.ts` are untouched.

**What the move cost.** The timed layout and store cases need the page shape and the build that the counted
cases use, and a test file cannot import another without running its cases too, which would put the counted
cases in both gates. So `braided` is copied into `perf/layout.timed.perf.test.ts`, and `nameInto`, `build` and
the three sizes into `perf/store.timed.perf.test.ts`. Compared as text on 2026-10-10 at `b60051f`, each copy
equals its original; nothing keeps them equal afterwards. A helper module both files import would, and was
outside what this slice could add.

One thing about the layout timing is different and no limit moved for it: it used to run after the two
counted cases in the same file, which had already laid the page out three times, and now runs after its own
single warm-up pass, as its comment always said it did. Its baseline is 0.59 microseconds a commit and its
limit 0.885; in the seven budgets runs of 2026-10-10 that ran to their end it read 0.552 to 0.641 in five and
0.807 and 1.195 in the other two, on a loaded machine every time (*The budgets gate on its own*).

**What nothing checks.** A new timed benchmark written in a file without `.timed.` in its name runs in
`gates:perf`, inside the tiers. Nothing counts the three. And `perf/baselines.json`, which this slice could
not touch, still says in the `unit` of the parse entry that it was measured by `perf/parse.perf.test.ts`, a
name that no longer exists; the gate prints that string with every verdict.

## What a Markdown-only change can move: `gates:static`

Two gates, established by planting changes in a document on 2026-10-10 and by reading what the others read.

| gate | can a `*.md` change its verdict? | how that was established |
| --- | --- | --- |
| `gates:provenance` | **yes** | it walks the working tree and reads the files it finds, documents among them; a line naming one of its own tokens, appended to the S07 slice document, turned it red, and `gates:static` and `gates:quick` with it |
| `gates:commits` | **yes** | it reads the messages of the commits since the base tag, and a document change arrives in a commit; a commit object with a 120-character body line, read through the gate's own range variable, turned it red, and `gates:static` with it |
| `gates:format` | no | `.prettierignore` excludes `*.md`; a misaligned table and list markers planted in the same document left it green |
| `gates:lint` | no | a fenced JavaScript block with `var`, `==` and `console.log` planted in the same document left it green |
| `gates:placeholders` | no | it reads the extensions `placeholder-patterns.json` lists, and `.md` is not one; its first pattern planted in the same document left it green, and the same marker in `playwright.config.js` turned it red |
| `gates:boundaries` | no | reads `src` with the extensions `.ts`, `.js` and `.json` |
| `gates:types` | no | three `tsc` projects, none of which includes a document |
| `gates:contract` | no | the compiler's view of `src/contracts/index.ts` |
| `gates:unit` | no | includes `src/**/*.test.ts`, `test/**/*.test.ts` and `src/adapters/**/*.spec.ts` |
| `gates:mutation` | no | mutates the files `stryker.config.json` lists and runs the unit suite |
| `gates:build`, `gates:e2e`, `gates:size` | no | read the sources and the built application |
| `gates:perf` | no | includes `perf/**/*.perf.test.ts`, less the timed files |
| `gates:licences` | no | reads the installed packages |

The commit object and the plants in `gates:format`, `gates:lint` and `gates:placeholders` are the second
session's; the third session planted the provenance token again and saw the same three stay green beside
it. For the last eight rows nothing was planted: the argument is their commands and configuration, read on
2026-10-10, and one search of `src`, `test`, `perf` and `scripts` for a quoted string ending in `.md` or naming
`docs` outside comment lines, which printed nothing. A source file that started reading a document would
make that argument false without any gate noticing.

## Continuous integration

`.github/workflows/ci.yml`, the one workflow file, has a new job, `budgets`: on `windows-latest`, the runner the
`e2e` job uses, needing the `build` job as that job does, running `npm run gates:budgets` — the timed
benchmarks and the budgets set. It is in the `needs` of `gate`, the single required check, which fails when
any job it needs was skipped. The job does not download the `dist` artefact: `gates:budgets` builds for
itself, there as in a worktree. The `e2e` job still calls `npm run gates:e2e`, which is now the application
set, and the `perf` job still calls `npm run gates:perf`, which is now the counted benchmarks.

**Unproven.** No run of this workflow has happened since the scaffold, and none will until the owner asks for
a push. Whether the job starts, whether the budget cases and the timed benchmarks hold on a hosted runner
under the wide regime `CI` selects, and how long they take there, are all unmeasured.

## How the scripts were proved

Two sessions of this slice measured what follows, both on **2026-10-10** and on the development machine: an
Intel Core i5-10310U, four cores and eight threads, 15.6 GB, Windows 11 Pro 10.0.26200, Node 24.18.0,
Electron 44.3.0, Playwright 1.63.0, Vitest 5.0.0, Stryker 10.0.0 (the versions as the third session read
them). The third session ran from 00:43 to 08:40 local time at commit `dab51b5`, before the timed benchmarks
moved. The fourth ran from 08:45 to 16:52 at `b60051f`, after. A fifth session, the same day, ran
the static and quick tiers once more at `71d141c` from 16:58 (*What the tiers measured*) and took no budgets
run. Exit statuses were read from the command itself, never through a pipe.

**Other projects' agents ran test, lint, mutation and build runs on the machine through both sessions.** The
third session sampled load every five seconds from Windows' formatted processor counter and read the process
table every fifteen; between 00:45 and 03:47, the hours of this slice's own mutation run, its sampler was
starved and wrote nothing for up to forty-eight minutes at a time. The fourth session's sampler is described
under *The budgets gate on its own*. A run started inside the WSL virtual machine is in Windows' process
table only as the `wsl.exe` that launched it, when one did, and otherwise was visible only as load.

**Every run of both sessions used a private temporary directory** (`TEMP` and `TMP` set for the run), for the
reason given under *A damaged fixture cache* below.

### The planted failures

One at a time, each removed before the next, `git status --short` printing nothing after each removal. The
first and third rows and the budgets cell of the fourth are the third session's, at `dab51b5`; the rest are
the fourth's, at `b60051f`.

| planted | `gates:static` | `gates:quick` | `gates:budgets` |
| --- | --- | --- | --- |
| a formatting error in `playwright.config.js` | exit 0 | exit 1 at `gates:format`, which named the file | not run |
| one of the provenance gate's own tokens in the S07 slice document | exit 1 at `gates:provenance`, which named the document; exit 0 once removed | exit 1 at `gates:provenance`, which named the document, after the eleven gates before it ran green | not run |
| a failing assertion in an application case, *the window opens and shows the empty state* of `window.spec.ts` | exit 0 | exit 1 at `gates:e2e`: 38 passed, 1 failed, the planted case | exit 0: 6 passed, the planted case not among them |
| a failing assertion in a budgets case, the row count of *the main process keeps answering…* in `open-repository.spec.ts` | exit 0 | exit 0: all fourteen gates, 39 application cases passed, the planted case not among them | exit 1: the planted case failed on its planted line, expected 10 001 and received 10 000 |
| a failing assertion in a counted benchmark, the ratio of *does about four times the work for four times the rows* in `perf/layout.perf.test.ts` | not run | `gates:perf` alone exit 1: that case failed on the planted line, 8 passed; exit 0 once removed | `gates:budgets:benchmarks` alone exit 0, 3 passed |
| a failing assertion in a timed benchmark, the verdict of *lays a commit out in no more than five microseconds* in `perf/layout.timed.perf.test.ts` | not run | `gates:perf` alone exit 0, 9 passed | exit 1: the benchmark step failed on the planted line, 2 passed; the six end-to-end cases ran after it |

What the table does not show, said plainly:

- **The last two rows were not run through a whole `gates:quick`.** That `gates:quick` is red on the first of
  them and green on the second is an **inference** from `gates:perf` alone and from `gates:quick` running
  `gates:perf` and neither budgets script.
- **The budgets run of the last row had a second red that was not planted**: the cold start to a first page
  read 2222 ms against 1560, in a run during which another project's run held the sampled load at 100 per
  cent for whole minutes (mean 47.8 per cent over the run, 37 of 130 samples over 75). That it is load and not
  the plant is an inference: the plant is one changed word in a benchmark file the end-to-end cases do not
  read. With the plant removed, `gates:budgets:benchmarks` alone was red once more at 09:46 — layout 1.223
  microseconds a commit against 0.885, at a sampled load of 51 to 73 per cent in the twenty seconds before —
  and green a minute later at 0.679.
- **The budgets run of the fourth row, in the third session, had four other reds** — the frame case, both
  cold starts and the load — on a machine at 2 to 100 per cent load, median 52. The planted case failed on its
  own line.
- **That `npm run gates` gives the same verdict for each plant is an inference from composition**, not a run:
  `gates` is `gates:quick`'s fourteen gates with `gates:mutation` added, as the comparison under *The four
  scripts* shows, and `run-s` stops at the first gate that fails.

## What the tiers measured

**`npm run gates:quick` at `b60051f`, 09:25:01 to 09:29:14: exit 0.** It ran the fourteen gates of its list in
order, the list `gates` holds without mutation: 380 unit tests in 25 files and 70 in 5 against fixture
repositories, the build, **39 end-to-end cases, the application set**, in 1.2 minutes, 9 benchmarks in 3
files, the production build at 48 087 of 54 272 budgeted bytes, and the five gates after it. The sampled load
during it averaged 64.3 per cent and was over 75 in nineteen of its forty-nine samples, with another
project's unit run in the process table. It exited 0 once more, at 09:34, with the planted budgets-case
assertion of the table above in the tree.

**`npm run gates:static` at `b60051f`: exit 0**, at 09:32, after the planted token was removed.

**Both tiers at `71d141c`, by the fifth session: exit 0.** `git diff --name-only b60051f..71d141c` lists
this document and nothing else. `npm run gates:static`, 16:58:14 to 16:58:19, ran its two gates and exited
0. `npm run gates:quick`, 16:58:19 to 17:02:03, ran its fourteen and exited 0, with the same counts as at
`b60051f`: 380 unit tests in 25 files and 70 in 5, 39 end-to-end cases in 2.0 minutes, 9 benchmarks in 3
files, 48 087 of 54 272 bytes. Load was not sampled during these two runs. No reading of that tier is a
time: the nine benchmarks it ran are the counted ones of the table under *How the timed benchmarks are
selected*.

**The commits gate had been red in between, on this slice's own history.** The commit that first carried
this document's fourth-session text had a subject of 73 characters against the 72 `gates:commits` allows,
and both tiers exited 1 there, at that gate and at no other (the fourth session, 16:46 to 16:50). That
commit was replaced by one with the same tree and a shorter subject, and the commit after it re-applied
unchanged; `71d141c` is the result.

**`npm run gates`, once, by the third session at `dab51b5`, 00:58 to 03:52: it did not exit 0, and the gate
that stopped it no longer holds what stopped it.**

| gate | in that run |
| --- | --- |
| `gates:format`, `gates:lint`, `gates:boundaries`, `gates:types`, `gates:contract` | green; boundaries cruised 101 modules and 335 dependencies |
| `gates:unit` | green: 380 tests in 25 files, then 70 tests in 5 files against fixture repositories |
| `gates:mutation` | green, 161 minutes 51 seconds on the loaded machine: 1 353 mutants, 1 303 killed, 47 timed out, 3 survived, none without coverage, none in error; score 99.78 against a threshold of 85; 49 of the 1 350 detections rest on a clock, 3.6 per cent against the gate's cap of 25; the survivor list holds 3 entries and the run left 3 alive, the same three |
| `gates:build` | green |
| `gates:e2e` | green: 39 cases, the application set, in 2.8 minutes |
| `gates:perf` | **red** on parse and layout time a commit, 24.298 and 0.913 microseconds; its ten other cases green |
| `gates:size`, `gates:licences`, `gates:provenance`, `gates:commits`, `gates:placeholders` | not reached in that run; each run alone at the same commit at 06:40, all five exit 0 |

**`npm run gates` was not run at `b60051f`. That it would exit 0 there is an inference**, from four things
measured:

1. the run above, green through `gates:mutation` and `gates:e2e` at `dab51b5`;
2. `git diff --name-only dab51b5..b60051f`, which lists `.github/workflows/ci.yml`, `package.json`,
   `playwright.config.js`, the S07 and S11 slice documents and five files under `perf/`. By
   `stryker.config.json` and `vitest.config.js` the mutation run mutates `src/core` and `src/contracts` and
   runs the suite of `src/**/*.test.ts`; none of those paths is a file it mutates, a test it runs or a
   configuration it names. `package.json` is the one it could consult, and its diff is the `scripts` lines
   of `gates:budgets` and `gates:perf`, neither of which the mutation gate calls. That is read from the two
   configuration files; which files the run opens was not traced;
3. `gates:quick` exit 0 at `b60051f`, above;
4. the two lists compared at `b60051f`: `gates` is `gates:quick` with `gates:mutation` added.

The same inference holds at `71d141c`, where `gates:quick` exited 0 as well and the only file changed
since `b60051f` is this document, which neither the mutation run nor any gate but `gates:provenance` and
`gates:commits` reads (*What a Markdown-only change can move*).

## The timed benchmarks before they moved

The third session's readings at `dab51b5`, when `gates:perf` still held the two per-commit times, fastest of
five, microseconds a commit, against limits of 21.87 and 0.885. They are why the benchmarks moved.

| run | started | parse | layout | verdict | load sampled in the minute before it | another run in the process table |
| --- | --- | --- | --- | --- | --- | --- |
| in `npm run gates`, after mutation, build and e2e | 03:52:41 | 24.298 | 0.913 | red | 67 to 100 % | not known: the sampler of that hour listed this run's own processes and no other |
| alone | 03:55:40 | 18.852 | 0.635 | green | 14 to 100 % | another project's, at the start of the minute |
| alone | 03:55:48 | 29.450 | 0.907 | red | 14 to 91 %, in the 20 s before | none listed |
| alone | 03:55:59 | 25.682 | 1.069 | red | 53 to 95 %, in the 20 s before | one inside WSL |
| in `gates:quick` | 04:28:44 | 24.996 | 0.826 | red (parse) | 62 to 100 % | one inside WSL |
| in `gates:quick` | 05:56:55 | 38.021 | 1.631 | red | 51 to 99 % | another project's |
| in `gates:quick` | 06:01:18 | 22.748 | 0.898 | red | 33 to 92 % | another project's, up to twelve processes |
| in `gates:quick` | 06:05:48 | 27.774 | 1.499 | red | 55 to 99 % | another project's |
| in `gates:quick`, clean head | 06:38:42 | 30.950 | 1.004 | red | 60 to 100 % | another project's, three processes |
| alone | 06:39:22 | 19.870 | 0.749 | green | 30 to 67 %, in the 30 s before | the same three |
| alone | 06:39:49 | 20.074 | 0.841 | green | 16 to 53 %, in the 20 s before | the same |
| in `gates:quick`, clean head | 06:43:53 | 30.305 | 1.410 | red | 60 to 100 % | the same three |

Seven of seven readings taken inside a tier were red, and three of five taken alone were green. The four tier
runs of 04:28 to 06:05 carried the planted budgets-case assertion, which `gates:perf` does not read. In the
06:38 run the machine read 3 to 49 per cent in the minute before the tier started and 60 to 100 through its
own `gates:e2e`, so the load `gates:perf` met there was at least in part the tier's own. Why the readings
were that far from the baseline that night was not established. The readings of the same three benchmarks in
their new gate are in the next section.

## The budgets gate on its own

### The rule a run was held to

The machine is free for a reading when the processor load, sampled every five seconds or oftener across all
processors, averaged **under 40 per cent over the minute before it and over the reading itself, with no
sample over 75 per cent during it**. A reading taken when the machine was not free by that measure is
discarded whatever it read, and taken again; a red on a free machine is red. That is `AGENTS.md` §11 as amended
on `dev` on 2026-10-10 and as this slice's task states it; the copy of `AGENTS.md` in this lane is older and
still has the earlier wording.

How the fourth session applied it. A reading is one whole `npm run gates:budgets` at a clean `b60051f`: the
build, the three timed benchmarks and the six tagged cases, about nine minutes. Load was sampled every five
seconds from the raw idle-time counter of Windows' processor data
(`Win32_PerfRawData_PerfOS_Processor`, `_Total`), so each sample is the mean load of the eight logical
processors over the seconds since the one before it, and a burst shorter than a sample is averaged into it
and not missed. Of the 5 420 samples taken between 08:50 and 16:43, 113 spanned more than 6.5 seconds, the
longest 30.3, each in a stretch at 100 per cent; the sampler was restarted once, and wrote nothing between
09:00:45 and 09:01:48. Every fifteen seconds the process table was read for test, mutation, lint, type-check
and build processes that did not descend from this lane's own runner; before 09:01:48 that listing did not
tell this lane's processes from another's, so for run 1 only the entries that name another project or a
mutation run are used.

A run was started only when the twelve samples before it averaged under 40 per cent and none was over 75.
A run that met a sample over 75 per cent in its first six minutes was already discarded, and was stopped
there — this lane's own process tree and nothing else — to give the time back; later than that it ran to its
end. (Run 2 is the exception: it was stopped at 8.2 minutes, before the six-minute bound was written.) No
process of another project was stopped or signalled.

### What was taken: 65 runs, none kept

**No kept run was obtained, and this slice ends without one.** Between 08:51 and 16:42 on
2026-10-10, 65 runs were started. 7 ran to their end and 58 were stopped, after 0.1 to
8.2 minutes, 49 of them within two; every one of the 65 met at least one sample over 75 per cent, so
every one is discarded. Read from the two tables below: the mean load in the minute before a run was 13.7
to 41.0 per cent, the highest sample met by a run 75.1 to 100 per cent, and the mean load during the seven
that ended 25.2 to 64.2 per cent.

In the minute before or during 39 of them the process table listed another project's test, mutation or lint
run, or a `wsl.exe`: the worktrees named were another project's review and fix lanes. In the other 26, all
started from 13:02 on, it listed none, and the load went over 75 per cent all the same. One reading of
processor time by process name, over ten seconds at 16:43 with nothing listed, found the WSL virtual
machine's process using 11.3 per cent of the eight processors; what runs inside it is not in Windows' table.

The runs that reached their end. A figure in bold is a red; in a discarded run it is not a verdict.

| | run 1 | run 3 | run 5 | run 8 | run 58 | run 64 | run 65 | limit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| started, lasted | 08:51, 8.7 min | 09:14, 9.4 min | 09:54, 14.7 min | 11:02, 8.9 min | 15:54, 10.1 min | 16:23, 9.3 min | 16:32, 9.2 min |  |
| mean load in the minute before | 20.7 % | 24.6 % | 17.1 % | 31.6 % | 34.5 % | 39.2 % | 36.6 % | under 40 % |
| load during: mean, highest sample | 31.8 %, 99.6 % | 26.2 %, 100 % | 64.2 %, 100 % | 25.2 %, 90.3 % | 53.1 %, 97.6 % | 38.0 %, 76.3 % | 36.0 %, 90.7 % | under 40 %, 75 % |
| samples over 75 % | 3 of 105 | 8 of 112 | 84 of 163 | 1 of 106 | 31 of 118 | 2 of 111 | 1 of 109 | none |
| other runs listed | a mutation run | another project's review worktree, a unit run, a lint run | a mutation run, another project's fix worktree, a unit run | another project's fix worktree, a mutation run, a unit run | a unit run, wsl | none listed | none listed |  |
| **free by the rule** | no: discarded | no: discarded | no: discarded | no: discarded | no: discarded | no: discarded | no: discarded |  |
| exit | 0 | 1 | 1 | 0 | 1 | 1 | 1 |  |
| parse, µs a commit | 14.198 | 16.476 | 15.882 | 16.054 | 15.811 | **24.998** | 18.821 | 21.87 |
| layout, µs a commit | 0.552 | 0.638 | 0.611 | 0.641 | 0.586 | **1.195** | 0.807 | 0.885 |
| store build, ms per 10 000 commits | 43.805 | 47.315 | 61.676 | 57.181 | 51.201 | 95.034 | 65.496 | 3000 |
| frame, mean of the 1 200 px scroll, ms | 5.085 | 6.417 | 6.713 | 6.603 | 6.065 | **8.374** | **8.16** | 7.86 |
| frame, worst of the 1 200 px scroll, ms | 8 | **12.3** | **17.5** | 10.4 | 10.6 | **14.2** | **15.1** | 11.55 |
| private memory at 50 000, bytes | 161030144 | 160751616 | 156643328 | 159723520 | 156692480 | 158543872 | 160763904 | 173 109 657 |
| resident after five idle minutes, ratio | 1.003 | 0.977 | 1.002 | 1.003 | 0.978 | 0.978 | 1.002 | 1.02 |
| processor while idle, % of a core | 0.078 | 0.109 | 0.115 | 0.12 | 0.047 | 0.109 | 0.052 | 0.5 |
| page callbacks, redraws, main-process callbacks while idle | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0 |
| resident after closing, bytes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cold start, empty repository, ms | 1035 | 1029 | **1498** | 1065 | **1977** | **1584** | 1173 | 1486.5 |
| cold start, first page of 10 000, ms | 1076 | 1041 | 1174 | 1111 | **1748** | 1467 | 1482 | 1560 |
| 10 000 commits, one load, ms | 461.3 | 625.6 | 490.7 | 464 | **1302** | 545.1 | 630.2 | 635.25 |
| worst main-process round trip during a load, ms | 3 | 40 | — | 3 | 3 | 3 | 2 | under 500 |

Each start and load time is the fastest of ten, each frame cost the median of five, each benchmark the
fastest of five (the store build the slowest of three), as the cases compute them. The limit column is the
smaller of the entry's ceiling and its baseline times its tolerance, computed here from `perf/baselines.json`
and not printed by the gate. The exit status of run 3 was not captured by the runner and is read from the
log, whose last line is the runner's error for `gates:budgets:e2e`.

The runs that were stopped, with the readings each had printed by then:

| run | started | stopped after | the sample that stopped it | mean load in the minute before | other runs listed | parse | layout | store build | frame mean, worst |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 09:05:33 | 8.2 min | 77.7 % | 23.4 % | a mutation run | 14.914 | 0.628 | 46.807 | 6.117, 10.6 |
| 4 | 09:50:18 | 0.9 min | 99.9 % | 32.1 % | a mutation run, another project's fix worktree, a lint run, a unit run | 19.716 | 0.651 | 49.364 | —, — |
| 6 | 10:19:48 | 1.1 min | 83.6 % | 27.4 % | another project's fix worktree, a unit run, a lint run, a type check | 15.214 | 0.589 | 58.318 | 7.189, **12** |
| 7 | 10:35:13 | 1.8 min | 99.8 % | 35.8 % | another project's fix worktree, a mutation run, a unit run, a lint run, a type check | 15.195 | 0.667 | 50.063 | 5.965, 10.9 |
| 9 | 11:12:04 | 0.3 min | 94.5 % | 38.2 % | another project's fix worktree, a mutation run, a unit run | 15.762 | 0.616 | 145.49 | —, — |
| 10 | 11:16:14 | 0.7 min | 77.7 % | 25.1 % | another project's fix worktree, a mutation run, a unit run | 15.435 | 0.607 | 47.479 | —, — |
| 11 | 11:28:27 | 1.4 min | 100 % | 13.7 % | another project's fix worktree, a mutation run, a unit run | 14.626 | 0.565 | 43.316 | 6.064, 10.9 |
| 12 | 11:47:02 | 0.8 min | 99.3 % | 39.3 % | another project's fix worktree, a lint run, a type check, a unit run | 14.466 | 0.653 | 61.373 | —, — |
| 13 | 11:49:22 | 0.1 min | 84.7 % | 32.1 % | another project's fix worktree, a unit run, a mutation run | — | — | — | —, — |
| 14 | 11:50:31 | 0.5 min | 94.5 % | 41.0 % | a mutation run, another project's fix worktree, a lint run | 15.924 | 0.609 | 58.562 | —, — |
| 15 | 11:56:42 | 1.8 min | 88.8 % | 28.7 % | a mutation run | 18.412 | 0.665 | 67.723 | 6.667, **15** |
| 16 | 11:59:57 | 2.9 min | 78.6 % | 19.3 % | a mutation run | 15.705 | 0.63 | 49.76 | 5.125, 9.9 |
| 17 | 12:03:48 | 4.3 min | 76.6 % | 16.9 % | a mutation run, another project's fix worktree, a unit run, a lint run | 15.31 | 0.58 | 43.405 | 4.982, 9.4 |
| 18 | 12:09:09 | 2.5 min | 84.7 % | 29.7 % | a mutation run, another project's fix worktree, a unit run | 17.393 | 0.623 | 64.379 | 5.99, 10.9 |
| 19 | 12:13:17 | 0.5 min | 76.4 % | 23.8 % | another project's fix worktree, a mutation run, a unit run, a lint run | 17.039 | 0.764 | 61.105 | —, — |
| 20 | 12:15:46 | 0.6 min | 79.6 % | 20.8 % | another project's fix worktree, a mutation run, a unit run | 16.688 | 0.67 | 51.487 | —, — |
| 21 | 12:17:55 | 0.2 min | 99.2 % | 27.2 % | a mutation run | 15.588 | **1.011** | — | —, — |
| 22 | 12:21:15 | 2.1 min | 80.7 % | 26.1 % | a mutation run | 15.054 | 0.609 | 48.572 | 6.735, **12** |
| 23 | 12:25:15 | 1.1 min | 77 % | 37.8 % | a mutation run | 17.866 | 0.681 | 43.178 | 6.5, **16.6** |
| 24 | 12:27:14 | 0.7 min | 76.2 % | 34.1 % | a mutation run, a unit run, another project's review worktree | 14.791 | 0.567 | 45.42 | —, — |
| 25 | 12:28:48 | 1.4 min | 88.7 % | 22.9 % | a mutation run, another project's review worktree, a unit run | 15.883 | 0.613 | 58.906 | 6.289, **19.6** |
| 26 | 12:32:56 | 0.1 min | 83.3 % | 36.6 % | another project's review worktree, a mutation run, a unit run | — | — | — | —, — |
| 27 | 12:40:58 | 0.2 min | 99.8 % | 36.0 % | wsl, another project's fix worktree, a unit run | — | — | — | —, — |
| 28 | 12:44:58 | 0.3 min | 77.8 % | 39.2 % | a unit run | 15.653 | 0.602 | 55.629 | —, — |
| 29 | 12:51:49 | 0.3 min | 75.1 % | 38.4 % | another project's fix worktree, a unit run, a mutation run | 19.366 | **0.913** | 77.526 | —, — |
| 30 | 12:56:19 | 0.2 min | 86.1 % | 37.9 % | another project's fix worktree, a unit run | — | — | — | —, — |
| 31 | 13:02:41 | 0.2 min | 83 % | 37.5 % | none listed | — | **1.396** | — | —, — |
| 32 | 13:54:50 | 0.6 min | 82.2 % | 31.2 % | another project's fix worktree, a mutation run, a lint run | 16.431 | 0.628 | 53.094 | —, — |
| 33 | 14:02:16 | 0.3 min | 82 % | 39.6 % | another project's fix worktree, a mutation run, a unit run | **37.805** | **1.386** | 138.06 | —, — |
| 34 | 14:16:35 | 0.1 min | 85.2 % | 38.8 % | none listed | — | — | — | —, — |
| 35 | 14:27:36 | 0.2 min | 80.4 % | 38.6 % | none listed | — | — | — | —, — |
| 36 | 14:55:38 | 0.2 min | 75.4 % | 39.3 % | none listed | — | — | — | —, — |
| 37 | 14:57:02 | 0.3 min | 82.8 % | 40.0 % | none listed | **36.546** | **1.077** | 121.625 | —, — |
| 38 | 14:58:27 | 0.6 min | 83.4 % | 39.3 % | none listed | **22.155** | 0.852 | 69.496 | —, — |
| 39 | 15:00:41 | 1.2 min | 76.6 % | 39.9 % | none listed | 21.684 | **0.97** | 85.821 | 7.778, **12.7** |
| 40 | 15:02:46 | 0.1 min | 75.9 % | 30.9 % | none listed | — | — | — | —, — |
| 41 | 15:03:50 | 0.6 min | 76.8 % | 39.3 % | none listed | 19.059 | 0.857 | 64.56 | —, — |
| 42 | 15:06:00 | 0.4 min | 81.6 % | 39.5 % | none listed | **22.351** | **0.936** | 68.35 | —, — |
| 43 | 15:07:19 | 0.4 min | 75.9 % | 35.8 % | none listed | **37.402** | **0.908** | 70.72 | —, — |
| 44 | 15:08:43 | 0.9 min | 83.3 % | 31.9 % | none listed | **24.674** | 0.84 | 108.071 | —, — |
| 45 | 15:12:27 | 0.2 min | 86.8 % | 38.6 % | a unit run | — | — | — | —, — |
| 46 | 15:13:43 | 0.4 min | 83.1 % | 39.9 % | none listed | **30.212** | **1.255** | 87.675 | —, — |
| 47 | 15:16:12 | 3.3 min | 79.3 % | 31.8 % | none listed | 15.543 | **0.915** | 83.112 | 7.249, **14.6** |
| 48 | 15:20:25 | 1.0 min | 77.9 % | 36.7 % | none listed | **24.951** | **1.167** | 118.783 | —, — |
| 49 | 15:22:20 | 1.1 min | 83.3 % | 24.9 % | none listed | 14.999 | 0.697 | 48.843 | 6.472, **14.9** |
| 50 | 15:24:24 | 2.8 min | 76.3 % | 27.0 % | none listed | 16.394 | 0.614 | 68.001 | **8.181**, **14.9** |
| 51 | 15:29:09 | 0.2 min | 75.9 % | 22.0 % | none listed | **23.529** | **0.925** | — | —, — |
| 52 | 15:30:18 | 2.8 min | 79.5 % | 36.9 % | none listed | 16.62 | 0.634 | 87.047 | 6.53, **12.3** |
| 53 | 15:34:08 | 1.8 min | 75.1 % | 31.9 % | none listed | **22.345** | 0.814 | 66.895 | 7.62, **14.2** |
| 54 | 15:38:43 | 0.3 min | 78.3 % | 28.8 % | none listed | **22.347** | **1.005** | 92.112 | —, — |
| 55 | 15:42:32 | 5.5 min | 76.2 % | 38.2 % | wsl | 16.325 | 0.699 | 51.918 | 6.403, **17.9** |
| 56 | 15:49:10 | 0.6 min | 86 % | 35.7 % | wsl | 15.117 | 0.62 | 47.52 | —, — |
| 57 | 15:50:49 | 2.0 min | 80 % | 35.9 % | wsl | 15.567 | 0.623 | 51.38 | 7.023, **18** |
| 59 | 16:05:49 | 0.9 min | 85 % | 38.0 % | a unit run, wsl | 15.445 | 0.661 | 52.6 | —, — |
| 60 | 16:07:54 | 2.0 min | 77.5 % | 37.9 % | a unit run, wsl | 17.134 | 0.788 | 75.124 | 6.324, 10.9 |
| 61 | 16:13:29 | 0.5 min | 75.7 % | 32.9 % | none listed | **28.831** | **1.019** | 100.648 | —, — |
| 62 | 16:19:24 | 0.3 min | 75.4 % | 39.0 % | none listed | **31.286** | **1.206** | 97.428 | —, — |
| 63 | 16:20:38 | 1.1 min | 77.6 % | 30.8 % | none listed | 15.134 | 0.637 | 49.895 | 5.263, 10.4 |

### What those runs show, and what they do not

- **They do not show the gate green on a free machine.** No run was on one. Runs 1 and 8 exited 0 with every
  reading inside its limit, at a mean load of 31.8 and 25.2 per cent and with three samples and one sample
  over 75; they are the nearest thing to a kept run and are not one.
- **The reds are in runs the rule discards.** Of the seven runs that ended, five were red: run 3 on the worst
  frame; run 5 on the worst frame and the empty cold start; run 58 on both cold starts and the load; run 64
  on parse, layout, both frame figures and the empty cold start; run 65 on both frame figures. Of the 58
  stopped runs, 28 had printed at least one red by the time they stopped; the table marks each. Under
  `AGENTS.md` §11 none of them is a finding about the product. They do show the three
  timed benchmarks moving with load as the end-to-end budgets do: parse read 14.198 to 24.998 microseconds a
  commit in the seven runs that ended, and past its limit of 21.87 in 13 of the 48 stopped runs that printed
  it; layout read past its limit of 0.885 in 15 of 49.
- **Two runs averaged under 40 per cent and were red.** Runs 64 and 65 averaged 38.0 and 36.0 per cent, with
  two samples and one over 75 (the highest 76.3 and 90.7) and no other run listed. Their frame case read a
  mean of 8.374 and 8.16 ms against 7.86 and a worst of 14.2 and 15.1 against 11.55, and run 64 was red on
  parse, layout and one cold start as well. Both are discarded for their samples over 75. They are set down
  because the averages alone would have kept them: what the frame case reads at a steady 36 to 38 per cent
  is not established by two discarded runs, and no run of the day had the machine near idle throughout.
- **The gate's own load reaches the cap.** In run 2 the process table listed no other run in 29 of its 37
  readings, among them the three taken at 09:13:05, 09:13:20 and 09:13:36, and through that half-minute, in
  which the run was launching the application over and over for its two cold-start cases, the samples read
  45.7, 48.2, 62.4, 57.4, 47.0, 55.9 and then 77.7 per cent, the sample that discarded it. In run 1 the same
  phase read 42 to 68.4 per cent with a mutation run of another project listed. So a `gates:budgets` run can
  put a five-second sample over 75 per cent with no other run listed. That nothing else was running then is
  an inference from the listing, which sees only the kinds of process it looks for and nothing inside WSL.
  This is an observation and not a rule: counted whole, the gate's own cold-start cases sampled 45.7 to
  77.7 per cent with no other run listed. The 65 runs were judged by the whole load, which is how the rule
  read when they were taken. `AGENTS.md` §11 on `dev`, read at `0439a82` on 2026-10-10, now says that the
  load counted is that of everything except the reading's own process tree. No run of this slice was judged
  that way: the sampler read one figure for the whole machine and did not separate the gate's own share.
- **How rare a free stretch was.** Between 08:50 and 16:43 the load series holds five stretches of nine
  minutes or more with no sample over 75 per cent: 08:55 to 09:13, 09:13 to 09:23, 09:26 to 09:41, 11:01 to
  11:10 and 16:21 to 16:30. The third held this slice's own quick-tier and planted-failure runs. Runs 2, 3, 8
  and 64 each ran inside one of the others until the sample over 75 that ended the stretch.

### The third session's four runs, on a quiet machine that was not free

Taken at `dab51b5`, before the timed benchmarks joined the gate and under the rule as it was first written
(no other project's run in the process table, and load under 40 per cent for a minute), which never held in
the 144 minutes that session waited for it. Each was started when load alone had stayed under 40 per cent for
sixty-five seconds, with another project's gate run in the table. They are not kept runs either.

| | run 1 | run 2 | run 3 | run 4 | limit |
| --- | --- | --- | --- | --- | --- |
| started, lasted | 07:23, 8.7 min | 07:34, 9.0 min | 07:50, 8.9 min | 07:59, 8.9 min | |
| load sampled during it: median, highest | 13 %, 72 % | 17 %, 100 % | 14 %, 81 % | 22 %, 87 % | |
| samples of 5 s at 40 % or more | 13 of 98 | 21 of 101 | 10 of 99 | 24 of 99 | |
| exit | 0 | **1** | 0 | 0 | |
| cold start, empty repository, ms | 1021 | 1198 | 1006 | 1057 | 1486.5 |
| cold start, first page of 10 000, ms | 1121 | 1216 | 1143 | 1135 | 1560 |
| 10 000 commits, one load, ms | 453.8 | **659.8** | 464.8 | 465 | 635.25 |
| frame, mean of the 1 200 px scroll, ms | 7.036 | 5.755 | 7.005 | 6.242 | 7.86 |
| frame, worst of the 1 200 px scroll, ms | 10 | 8.3 | 11.3 | 9.4 | 11.55 |
| private memory at 50 000, bytes | 160 071 680 | 161 345 536 | 157 913 088 | 161 423 360 | 173 109 657 |
| resident after five idle minutes, ratio | 1.003 | 1.003 | 1.003 | 0.978 | 1.02 |
| processor while idle, % of a core | 0.078 | 0.036 | 0.063 | 0.073 | 0.5 |
| page callbacks, redraws, main-process callbacks while idle | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0 |
| resident after closing, bytes | 0 | 0 | 0 | 0 | 0 |
| worst main-process round trip during a load, ms | 2 | 3 | 3 | 3 | under 500 |

Those samples are instantaneous readings of the formatted counter, not five-second means, so their highest
figures are not comparable with the fourth session's. Run 2's red, the load of 10 000 commits at 659.8 ms,
came in the last minutes of a run in which another project's run went from three processes to between ten
and twelve.


## A damaged fixture cache, met on the way

The third session's first `npm run gates` went red after four minutes at `gates:unit`, in a file this slice
does not touch: *counts a modified file and an untracked one apart* of `src/adapters/git-page.spec.ts`
expected one untracked file and read none, and failed the same way run alone. The adapter suite and the
end-to-end suite each keep built fixture repositories in the operating system's temporary directory, in a
folder named after a digest of the recipe, and reuse it for as long as it exists. On this machine both
folders held repositories whose working-tree files were gone — `git status` in the adapter suite's
`dirty-working-tree` listed its tracked file as deleted and no untracked file — while their `.git` folders
were intact; the damaged repositories' folders were last modified on 2026-10-05 at 16:19. What removed the
files was not established. The suites rebuild a fixture only when its folder is missing, so a folder that
exists and is damaged is used as it is.

Neither session touched those folders. Each set `TEMP` and `TMP` to a directory of this lane's own for every
run, the suites built fresh fixtures there, and the same case passed (34 of 34 in that file). **Until those
two folders are removed, `npm run gates` and `npm run gates:quick` run on this machine with the default
temporary directory are red at `gates:unit`** — measured by the third session, once in the full tier and
once with the file run alone — and the end-to-end cases would open repositories with a deleted file in their
working tree, which was not run. The fourth session did not look at the folders again.

## What is unproven

- **Every run in this document used a private temporary directory.** None of the four scripts has been seen
  green on this machine with the default one, for the reason above, and the shared caches were left as they
  were found.
- **`npm run gates` at this slice's head.** One full run, at `dab51b5`, green through mutation and the
  end-to-end set and red at the timings that have since moved; its verdict at `b60051f` and at `71d141c`
  is the inference under *What the tiers measured*.
- **`npm run gates` on any planted failure, and `gates:quick` on the two benchmark plants**: inferences from
  composition, labelled above.
- **No `gates:budgets` run since the split has been taken on a free machine.** 69 runs were taken to read the
  gate, not counting the three that carried a planted failure, and all 69 are discarded. The fourth
  session's 65 each met a five-second sample over 75 per cent: the highest sample of a run was 75.1 to 100
  per cent, the mean load in the minute before one 13.7 to 41.0 per cent, and the mean during the seven
  that ran to their end 25.2 to 64.2 per cent. The third session's four, taken
  before the timed benchmarks joined the gate, were started with another project's run in the process table
  and read instantaneous samples up to 72, 100, 81 and 87 per cent; they were not judged by the rule as it
  now stands. **A red in a discarded run is not a verdict**, about the product or about the gate, and
  neither is a green. So whether the gate is green on a free machine is unmeasured, for the six end-to-end
  cases and for the three benchmarks that joined it. What is measured is what the gate holds and that it
  can fail: it runs the three timed benchmarks and the six tagged cases and nothing else (the lists above),
  and it went red on a planted failure in a case and in a benchmark (*The planted failures*).
- **The first kept run is owed by whoever next has a free machine.** `AGENTS.md` §11 has the reviewer run
  `npm run gates:budgets` on a free machine at the reviewed commit every round.
- **Whether a run of the gate can meet the rule on this machine.** Under the whole-load reading its own
  cold-start cases reached 77.7 per cent in a five-second sample with no other run listed. Under the reading
  `dev` now states, which leaves out the reading's own process tree, nothing has been measured.
- **The `budgets` job in continuous integration**: never run.
- **This document's last commit**: the runs above are at `71d141c` or earlier. The commit after it changes
  this one Markdown file, which of the fifteen gates only `gates:provenance` and `gates:commits` read.
