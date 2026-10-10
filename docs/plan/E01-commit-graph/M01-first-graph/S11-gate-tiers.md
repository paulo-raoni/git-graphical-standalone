# E01-M01-S11 · Gate tiers, and the wall-clock budgets as their own gate

`AGENTS.md` §11, *Gate tiers*, rules that a lane runs the gates its change can move and that the wall-clock
budgets are a gate of their own. It names four scripts. This slice lands them: three tiers in `package.json`,
the end-to-end cases split in two by a tag, and a job for the new gate in the one workflow file. No gate's own
command changed except the selection `gates:e2e` makes, no script was removed or renamed, and nothing under
`src/`, `perf/` or `scripts/` was touched.

## The four scripts

| script | what it runs, in order |
| --- | --- |
| `npm run gates:static` | `gates:provenance`, `gates:commits` |
| `npm run gates:quick` | `gates:format`, `gates:lint`, `gates:boundaries`, `gates:types`, `gates:contract`, `gates:unit`, `gates:build`, `gates:e2e`, `gates:perf`, `gates:size`, `gates:licences`, `gates:provenance`, `gates:commits`, `gates:placeholders` |
| `npm run gates` | the fourteen of `gates:quick` with `gates:mutation` between `gates:unit` and `gates:build`, where it was before this slice |
| `npm run gates:budgets` | `gates:build`, then the budgets set of the end-to-end cases |

`gates` and `gates:quick` are two lists in `package.json`, each handed to `run-s`, which runs them one after
another and stops at the first that fails. They are two lists and not one script calling the other because
mutation sits in the middle of the order. So the two can drift: nothing checks that `gates` is `gates:quick`
plus mutation except a reader of that file. Compared on 2026-10-10 by removing `gates:mutation` from the first
list: the remainder is the second, name for name.

`gates:e2e` keeps its name and is now `playwright test --project=application`. `gates:budgets` builds for
itself, as `gates:build` does, so that it can be run alone in a fresh worktree; it is in none of the tiers,
so `npm run gates` no longer runs a single case that is held to a clock **in the end-to-end suite** (see
*Two times still run inside the tiers* for the two that remain elsewhere).

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

Measured on 2026-10-10 at commit `dab51b5` with `playwright test --list`: 45 cases in 13 files with no project
named, 39 in 11 files for `--project=application`, 6 in 4 files for `--project=budgets`. Compared by file and
title, no case is in both lists and the two together are the 45. The list at this slice's base, `ef3981f`, was
taken by this slice's second session, the same day, from an unpacked copy of that commit: 45 cases in 13
files, the same ones once the tag is removed from six titles. That session saw its comparison fail: with one
line removed from the application list it reported the partition broken.

How each untagged case was judged: every `expect` in `test/e2e/*.spec.ts` that compares a magnitude, and every
read of a clock, was listed by search on 2026-10-10. Outside the six tagged cases the magnitudes are counts
(row elements, redraws, strokes, lanes), and the two clocks that are read — the five *load more* presses of
`open-repository.spec.ts` and the settle order of `superseded-reply.spec.ts` — are printed or used for order,
never compared with a limit.

**What nothing checks.** The judgement itself: a new wall-clock case written without the tag, or with the tag
misspelt, runs in `gates:e2e`, on a machine nobody checked was free. And nothing counts the budgets set, so
six cases becoming five is caught by no gate.

**The tagged lines are the only code that changed in the test files.** Each of the six files this slice
touched under `test/e2e/` was transpiled by TypeScript with comments removed, from the base commit and from
the working tree, and compared line by line on 2026-10-10: `budgets-git.spec.ts` and `support/budgets.ts` are
identical, and the other four differ in three, one, one and one lines, each a `test('…'` line equal to its
base line once ` @budgets` is removed. The comparison was seen failing at this head: a changed number in
`budgets-git.spec.ts` and an added statement in `budgets-frames.spec.ts` each made it report a difference
and exit 1, and an added comment did not. `open-repository.spec.ts` still counts 285 of the 300 lines
`max-lines` allows (measured by this slice's second session by running ESLint with the limit set to 1).

## What a Markdown-only change can move: `gates:static`

Two gates, established by planting changes in a document on 2026-10-10 and by reading what the others read.

| gate | can a `*.md` change its verdict? | how that was established |
| --- | --- | --- |
| `gates:provenance` | **yes** | it walks the working tree and reads the files it finds, documents among them; a line naming one of its own tokens, appended to the S07 slice document, turned it red, and `gates:static` with it |
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
| `gates:perf` | no | includes `perf/**/*.perf.test.ts` |
| `gates:licences` | no | reads the installed packages |

The commit object and the plants in `gates:format`, `gates:lint` and `gates:placeholders` are the second
session's; the third session planted the provenance token again and saw the same three stay green beside
it. For the last eight rows nothing was planted: the argument is their commands and configuration, read on
2026-10-10, and one search of `src`, `test`, `perf` and `scripts` for a quoted string ending in `.md` or naming
`docs` outside comment lines, which printed nothing. A source file that started reading a document would
make that argument false without any gate noticing.

## Continuous integration

`.github/workflows/ci.yml`, the one workflow file, has a new job, `budgets`: on `windows-latest`, the runner the
`e2e` job uses, needing the `build` job as that job does, running `npm run gates:budgets`. It is in the `needs`
of `gate`, the single required check, which fails when any job it needs was skipped. The job does not download
the `dist` artefact: `gates:budgets` builds for itself, there as in a worktree. The `e2e` job still calls
`npm run gates:e2e`, which is now the application set.

**Unproven.** No run of this workflow has happened since the scaffold, and none will until the owner asks for
a push. Whether the job starts, whether the budget cases hold on a hosted runner under the wide regime `CI`
selects, and how long they take there, are all unmeasured.

## How the scripts were proved

Everything from here to the end of this document was measured by this slice's third session on **2026-10-10**,
between 00:43 and 08:37 local time, at commit `dab51b5` (the head before this document was added), on the
development machine: an Intel Core i5-10310U, four cores and eight threads, 15.6 GB, Windows 11 Pro
10.0.26200, Node 24.18.0, Electron 44.3.0, Playwright 1.63.0, Vitest 5.0.0, Stryker 10.0.0. Exit statuses
were read from the command itself, never through a pipe.

**The machine was never free in those eight hours.** Other projects' agents ran test, lint, mutation and
build runs on it throughout. Load was sampled every five seconds from Windows' processor counters
(`Win32_PerfFormattedData_PerfOS_Processor`, `_Total`), and the process table was read every fifteen for
processes of another run; between 00:45 and 03:47, the hours of this slice's own mutation run, the sampler
itself was starved and wrote nothing for up to forty-eight minutes at a time, so the series has gaps where
the load was highest. A run started inside the WSL virtual machine is in Windows' process table only as the
`wsl.exe` that launched it, when one did, and otherwise was visible only as load.

**Every run used a private temporary directory** (`TEMP` and `TMP` set for the run), for the reason given
under *A damaged fixture cache* below.

### The planted failures

One at a time, each removed before the next, `git status --short` printing nothing after each removal.

| planted | `gates:static` | `gates:quick` | `gates:budgets` |
| --- | --- | --- | --- |
| a formatting error in `playwright.config.js` | exit 0 | exit 1 at `gates:format`, which named the file | not run |
| one of the provenance gate's own tokens in the S07 slice document | exit 1 at `gates:provenance`, which named the document | not run to that gate: see below | not run |
| a failing assertion in an application case, *the window opens and shows the empty state* of `window.spec.ts` | exit 0 | exit 1 at `gates:e2e`: 38 passed, 1 failed, the planted case | exit 0: 6 passed in 8.7 minutes, the planted case not among them |
| a failing assertion in a budgets case, the row count of *the main process keeps answering…* in `open-repository.spec.ts` | exit 0 | `gates:e2e` green inside it, 39 passed, the planted case not among them; the run then went red at `gates:perf` (next section) | exit 1: the planted case failed on its planted line, expected 10 001 and received 10 000 |

Three cells are weaker than the task asked for, and say so:

- **A provenance token and `gates:quick`.** `gates:provenance` is the twelfth of the fourteen gates
  `gates:quick` runs and `gates:perf` is the ninth; on this night `gates:perf` went red in every run of the
  chain that reached it (next section), so no run reached `gates:provenance`. That `gates:quick` is red on
  the planted token is an **inference** from two measurements: `gates:provenance` alone exits 1 on it, and
  `gates:quick` runs `gates:provenance`.
- **A budgets-case plant and `gates:quick`.** The run did not exit 0, because of `gates:perf`. What was
  measured with the plant in place: the eight gates before `gates:perf` green in the chain, four times; and
  `gates:size`, `gates:licences`, `gates:provenance`, `gates:commits` and `gates:placeholders` green, each run
  alone. `gates:perf` reads nothing under `test/e2e`.
- **The reds beside the planted one in the fourth row's budgets run.** Four other cases were red in it as
  well — the frame case, both cold starts and the load — on a machine at 2 to 100 per cent load, median 52,
  with another project's gate run in the process table. That they are load and not the plant is an
  inference: the plant is one changed number in another case. The planted case failed on its own line.

**That `npm run gates` gives the same verdict for each plant is an inference from composition**, not a run:
`gates` is `gates:quick`'s fourteen gates with `gates:mutation` added, as the comparison under *The four
scripts* shows, and `run-s` stops at the first gate that fails.

## What the tiers measured at `dab51b5`

**`npm run gates`, once, 00:58 to 03:52: it did not exit 0.** Nine gates were green in it and the tenth,
`gates:perf`, was red on its two wall-clock entries; `run-s` stopped there.

| gate | in that run |
| --- | --- |
| `gates:format`, `gates:lint`, `gates:boundaries`, `gates:types`, `gates:contract` | green; boundaries cruised 101 modules and 335 dependencies |
| `gates:unit` | green: 380 tests in 25 files, then 70 tests in 5 files against fixture repositories |
| `gates:mutation` | green, 161 minutes 51 seconds on the loaded machine: 1 353 mutants, 1 303 killed, 47 timed out, 3 survived, none without coverage, none in error; score 99.78 against a threshold of 85; 49 of the 1 350 detections rest on a clock, 3.6 per cent against the gate's cap of 25; the survivor list holds 3 entries and the run left 3 alive, the same three |
| `gates:build` | green |
| `gates:e2e` | green: **39 cases, the application set**, in 2.8 minutes |
| `gates:perf` | **red**: parse 24.298 and layout 0.913 microseconds a commit (next section); its ten other cases green |
| `gates:size`, `gates:licences`, `gates:provenance`, `gates:commits`, `gates:placeholders` | not reached in that run; each run alone at the same commit at 06:40, all five exit 0 (production build 48 087 of 54 272 budgeted bytes; 518 packages) |

**`npm run gates:quick`, twice at the clean head, 06:36 and 06:40: neither exited 0**, for the same reason
and no other. Both ran `gates:format`, `gates:lint`, `gates:boundaries`, `gates:types`, `gates:contract`,
`gates:unit`, `gates:build` and `gates:e2e` green, in that order — the list `gates` ran, without mutation —
with 39 application cases passing in 1.6 and 1.9 minutes, and stopped at `gates:perf`. The whole of a quick
run to that point took 2 minutes 43 seconds and 3 minutes 11 seconds.

**`npm run gates:static`: exit 0**, at 00:42 and again after each planted document change was removed.

So at `dab51b5` every one of the fifteen gates has been seen green, fourteen of them in a tier's own run or
alone and `gates:perf` only when run alone (below); and **no run of `gates` or of `gates:quick` has exited 0**.

## Two times still run inside the tiers

This slice partitioned `test/e2e` only. `gates:perf` stays in the quick and full tiers, and two of its
entries are wall-clock: `parseMicrosecondsPerCommit` (baseline 14.579, held to 1.5 times that, 21.87) and
`layoutMicrosecondsPerCommit` (baseline 0.59, held to 0.885), each the fastest of five timed runs after a
warm-up. Its other entries are counts and allocations and were green in every run below.

Every reading of 2026-10-10, fastest of five, microseconds a commit:

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

Seven of seven readings taken inside a tier were red, and three of five taken alone were green, none by
much: the best parse of the night is 29 per cent over its baseline of 2026-09-28. The four tier runs of 04:28
to 06:05 carried the planted budgets-case assertion, which `gates:perf` does not read. In the 06:38 run the
machine read 3 to 49 per cent in the minute before the tier started and 60 to 100 through its own
`gates:e2e`, so the load `gates:perf` met there was at least in part the tier's own. **Why the readings are
this far from the baseline tonight was not established** — the other projects' runs, the tier's own
preceding gates, or a processor slowed by hours at full load are each consistent with these numbers,
and nothing here tells them apart. What the numbers do show is that these two entries behave, inside a tier,
like the budget cases this slice moved out of one.

## The budgets gate on its own

**None of the five free-machine runs `AGENTS.md` §11 asks for was taken**: the rule is no other project's
run in the process table and load under 40 per cent for a minute, and in the 144 minutes this session spent
waiting for exactly that (03:58 to 04:07, 04:30 to 05:41, 06:08 to 06:36 and 06:44 to 07:21) it never held
for sixty-five seconds. Four runs were taken instead when load alone had stayed under 40 per cent for
sixty-five seconds, with another project's gate run in the table at the start of each. They are readings on
a quiet machine that was not free, and are not the five.

| | run 1 | run 2 | run 3 | run 4 | limit |
| --- | --- | --- | --- | --- | --- |
| started, lasted | 07:23, 8.7 min | 07:34, 9.0 min | 07:50, 8.9 min | 07:59, 8.9 min | |
| load sampled during it: median, highest | 13 %, 72 % | 17 %, 100 % | 14 %, 81 % | 22 %, 87 % | |
| samples of 5 s at 40 % or more | 13 of 98 | 21 of 101 | 10 of 99 | 24 of 99 | |
| process-table samples with no other run | 0 of 33 | 0 of 34 | 0 of 33 | 14 of 33 | |
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

Each time is the fastest of ten and each frame cost the median of five runs, as the cases compute them; the
limit column is the smaller of the entry's ceiling and its baseline times its tolerance, computed here from
`perf/baselines.json` and not printed by the gate.

Run 2's red is one case, the load of 10 000 commits, at 659.8 ms against 635.25. It is the last timed case
of the run, and in the last minutes of that run the other project's run went from three processes to
between ten and twelve, with load reaching 100 per cent. Under `AGENTS.md` §11 that case is re-run alone
once that run has ended; it had not ended when this session did, and the re-run was not taken. The three other runs
read that case at 453.8 to 465 ms.

A fifth set of readings exists and is not a fifth run of the gate at this commit: the budgets run of the
planted-failure table's third row, taken at 08:28 with one application case changed in the tree, under the
same quiet-machine rule, read 1003, 1055 and 467.3 ms, frames of 6.008 and 10.2 ms, 160 407 552 bytes, and
exited 0.

What these four runs do and do not show: with the budgets set alone in its gate, on a machine quiet at the
start, the frame case that went red inside `npm run gates` on 2026-10-04 at 14.4 ms read 8.3 to 11.3 ms
against 11.55 — inside the limit four times, once by a quarter of a millisecond. Under load, in the budgets
run of the planted-failure table's fourth row, the same case read 20.9 ms. They do not show the gate
green on a free machine, because the machine was not free.

## A damaged fixture cache, met on the way

The first `npm run gates` of this session went red after four minutes at `gates:unit`, in a file this slice
does not touch: *counts a modified file and an untracked one apart* of `src/adapters/git-page.spec.ts`
expected one untracked file and read none, and failed the same way run alone. The adapter suite and the
end-to-end suite each keep built fixture repositories in the operating system's temporary directory, in a
folder named after a digest of the recipe, and reuse it for as long as it exists. On this machine both
folders held repositories whose working-tree files were gone — `git status` in the adapter suite's
`dirty-working-tree` listed its tracked file as deleted and no untracked file — while their `.git` folders
were intact; the damaged repositories' folders were last modified on 2026-10-05 at 16:19. What removed the
files was not established. The suites rebuild a fixture only when its folder is missing, so a folder that
exists and is damaged is used as it is.

This session did not touch those folders. It set `TEMP` and `TMP` to an empty directory of its own for every
run, the suites built fresh fixtures there, and the same case passed (34 of 34 in that file). **Until those
two folders are removed, `npm run gates` and `npm run gates:quick` run on this machine with the default
temporary directory are red at `gates:unit`** — measured once in the full tier and once with the file run
alone, both on 2026-10-10 — and the end-to-end cases would open repositories with a deleted file in their
working tree, which was not run.

## What is unproven

- **The five runs of `gates:budgets` on a free machine.** Not taken; four on a quiet machine stand in their
  place, one of them red on one case while another project's run was active.
- **An exit status of 0 from `npm run gates` and from `npm run gates:quick`.** Not seen, in one run of the first and
  six of the second, four of the six with the planted budgets-case assertion in the tree: `gates:perf`'s
  wall-clock entries were red in every one. Every other gate was green in those
  runs or alone at the same commit.
- **The provenance plant inside `gates:quick`, and `npm run gates` on any plant**: inferences from
  composition, labelled above.
- **The `budgets` job in continuous integration**: never run.
- **This document's own commit**: the tier runs above are at `dab51b5`. The commit that adds this document
  changes one Markdown file, and `npm run gates:static` was run after it.
