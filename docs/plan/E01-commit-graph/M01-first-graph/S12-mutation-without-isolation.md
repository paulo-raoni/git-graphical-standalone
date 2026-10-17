# E01-M01-S12 · The mutation gate without per-file isolation

## What changed

One flag, in one file. The command Stryker runs once per mutant, `commandRunner.command` in
`stryker.config.json`, was

```
node node_modules/vitest/vitest.mjs run --reporter=dot --fsModuleCache
```

and is now the same command followed by `--no-isolate`. With it, the 25 test files of one run of the unit
suite share one module registry instead of each starting from a fresh one. Nothing else moved:
`vitest.config.js` is not in this lane's diff, so `fileParallelism: false`, `testTimeout` and `hookTimeout`
are where E01-M01-S09 put them; `timeoutMS` is still 120 000; no clause of `scripts/gates/mutation.js`
changed, only its header, which now describes the command; and `scripts/gates/mutation-survivors.json` is
unchanged at three entries.

Every measurement below was taken by this lane on 2026-10-10 and 2026-10-11, on the eight-core development
machine, with times in UTC. The base is `ef3981f`; the commit that adds the flag is `ab6dc36`.

**What it bought, on a free machine:** the gate took **77.5 minutes** with isolation and **35.0 minutes**
without, two runs taken one after the other with nothing else in the process table. **What it cost** is in
*Kills that name no failing test* below, and should be read before this is relied on.

## Why it could not simply be switched on

E01-M01-S09 measured the gain and left it alone, because sharing a module registry changes what a test can
see: a module evaluated for the first file is the same object for the twenty-fifth, so state one file leaves
in a module is there for the next. A gate that is faster with the same score can hide a mutant that only
isolation was killing — the score is a ratio and the survivor list is compared by identity, so neither would
show a kill that had quietly become an accident of file order. So the flag was taken on two measurements and
not on the score: that no test file depends on another's module state, and that every one of the 1 353
mutants gets the same status with the flag as without it.

## No test file depends on another's module state

**By running it.** The per-mutant command with `--no-isolate`, at the base:

| order of the 25 files | runs | files passed | tests passed | exit |
| --- | --- | --- | --- | --- |
| vitest's default | 1 | 25 of 25 | 380 of 380 | 0 |
| shuffled, `--sequence.shuffle.files --sequence.seed=<n>` | 22 | 25 of 25 in each | 380 of 380 in each | 0 in each |

The 22 seeds were 101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212, 1313, 1414, 1515, 1616,
1717, 1818, 1919, 2020, 31337 and 271828. Each run wrote vitest's JSON report, and the order was read back
from it as the files sorted by the start time it records for each: 23 runs, **23 different orders**, so the
seeds did shuffle. Only the files were shuffled; the tests inside a file kept their order. The same command
without the flag passes the same 380 tests in 25 files.

That the flag does what its name says was measured too, by sampling the process table about every 200 ms
through one run of the command each way, twice: **one** vitest worker process without isolation, **25** with
it.

**By reading.** Without isolation there are three places state could cross from one file to the next. Each
was searched for over `src/`, and what the searches found was read.

- **The test files' own top level.** Besides their `describe` blocks, the 25 test files declare 52 constants
  and 53 functions at their top level and nothing else: no `let` or `var`, no `beforeAll`, `beforeEach`,
  `afterAll` or `afterEach`, no `vi.` call of any kind (no mock, spy, stub, fake timer or module reset), no
  snapshot and no `expect.extend`. No test is asynchronous — there is no `async`, `await` or promise in any of
  them — so nothing a test starts can still be running when the next file begins. Some of the constants are
  arrays and objects a test could alter, but a test file's top level belongs to that file with or without
  isolation: no test file imports another, so nothing declared in one is reachable from a second.
- **The modules the tests import.** These are what the files do share once the registry is shared. The tests
  import from `src/core/`, `src/contracts/`, `src/ports/` and `src/ui/status-text.ts`, which is 41 files that
  are not tests, and none of those imports from outside those four places. They hold 84 top-level constants:
  79 are a number or a string, and five are flat tables of numbers or strings wrapped in `Object.freeze`
  (`CHANNELS`, `RowFlag`, `RefKind`, `RefFlag`, `FailureKind`). There is no top-level `let` or `var`, no
  class, no static field, and no top-level statement other than an import, an export, a constant, a function
  or a type. The work counters, `storeWork` and `layoutWork`, are functions of a builder or a state the caller
  passes in, not counts a module keeps. So no module in these rings has anything a test could leave behind.
  The top-level `let` declarations `src/` does have are in `src/app/main.ts`, `src/app/repository-host.ts`
  and two `*.spec.ts` files under `src/adapters/`, none of which this suite includes or imports.
- **The process.** No line of code in those 41 modules or in the test files names `globalThis`, `process`, a
  timer, `Date`, `performance` or `Math.random`, or assigns to a prototype.

That is a statement about the tree at `ef3981f`. It is the thing to check again when a test file gains a hook
or a mock, or a module in these rings gains a top-level variable.

## Every mutant keeps its verdict

Two runs of `node scripts/gates/mutation.js`, which is the whole of `npm run gates:mutation`, over the
configured scope, unnarrowed, on the same source: the first at the base as it was, the second with the flag
added and nothing else. The two JSON reports were compared mutant by mutant. They were joined on Stryker's
mutant id, and the two sides of every pair were checked to agree on file, start and end position, mutator and
replacement, which all 1 353 do.

| quantity | isolated | without isolation |
| --- | --- | --- |
| mutants | 1 353 | 1 353 |
| `Killed` | 1 303 | 1 303 |
| `Timeout` | 47 | 47 |
| `Survived` | 3 | 3 |
| any other status | 0 | 0 |
| score | 99.78 | 99.78 |
| tests per mutant | 0.97 | 0.97 |
| survivors, against a list of 3 | 3 and 3 | 3 and 3 |
| listed entries reported detected rather than alive | 0 | 0 |
| survivors not on the list | 0 | 0 |
| kills carrying vitest's own test timeout | 0 | 0 |
| detections resting on a clock | 47 of 1 350, 3.5 % | 47 of 1 350, 3.5 % |
| kills whose output names no failing test | 0 of 1 303 | 0 of 1 303 |
| the gate's verdict | `mutation: ok`, exit 0 | `mutation: ok`, exit 0 |

And between the two:

| quantity | count |
| --- | --- |
| **mutants whose status differs** | **0 of 1 353** |
| mutants that moved between `Killed` and `Timeout` | 0 |
| killed in both, with vitest's failed-test counter in both outputs | 1 303 of 1 303 |
| killed in both, with the same failing tests named in both outputs | 1 303 of 1 303 |

The last row is stronger than the gate's own clause, and is what answers the question this lane exists for.
Each kill's recorded output is a whole vitest run, and the lines vitest prints as `FAIL <file> > <suite> >
<test>` were collected for each mutant on each side: every one of the 1 303 kills has at least one, and for
every one of them the set is the same in the two runs. A mutant killed by its own test with isolation and by
some other file's leftovers without it would show here as a different set. There is none.

That the second run really ran without isolation is in the reports themselves. When it isolates, vitest 5.0.0
ends its output with a line counting the workers it spawned; that line is in the recorded output of all 1 303
kills of the first report and of none of the second.

No mutant moved between `Killed` and `Timeout`, so the one difference the task allowed for did not have to be
argued for any mutant.

## Where the flag lives, and why there

On the command line in `stryker.config.json`, and nowhere else.

- **It is the gate's own setting.** Isolation is given up for the per-mutant run only, and that file is where
  the per-mutant run is defined. A reader asking what a mutant is measured by reads one line.
- **It cannot reach `gates:unit`.** `vitest.config.js` does not change, so every other run of the suite gets
  what it got before. Putting `isolate: false` in that file would have changed the unit gate, about which
  this lane has no evidence. A second configuration file for the mutation run would have been a copy of the
  first to be kept equal to it by hand — the include list, `fileParallelism` and both clocks — and
  E01-M01-S09 chose one configuration for both runs so that the two cannot disagree about which test is hung.
- **Undoing it is deleting one word.** Nothing else was changed to accommodate it.

The gate's code needed no change: the script hands Stryker its configuration and reads the JSON report, and
neither depends on how vitest schedules its files.

## What `gates:unit` still does

What it did. `npm run gates:unit:modules` is `vitest run --coverage` from the unchanged `vitest.config.js`:
with isolation, the files one at a time, the same clocks and the same per-directory coverage thresholds. Run
at `ab6dc36` on 2026-10-11 at 04:45: exit 0, 25 files and 380 tests passed, and its output carries vitest's
`Isolate  25 workers spawned` line.

So the two gates no longer run the suite the same way, which E01-M01-S09 valued and this lane gives up in one
respect: the mutation gate measures the suite's assertions with a shared registry, and the unit gate runs
them with a fresh one per file. What ties the two together is the comparison above and the same 380 tests
passing both ways.

## How long it takes now

Seven runs of the gate without isolation and two with, all over the full scope. The machine is shared, so
each row says what else was running. The process table was sampled once a minute during every run; a sample
counts as *other work* when it holds a process of another worktree of this project, or of another project,
that is a test runner, a linter, a type checker, a formatter, a build or a gate script. The processor was
sampled every ten seconds and its mean was between 96.7 and 99.9 % in every run, which says only that a
mutation run fills the machine by itself.

| run | tree | started | wall clock | minute samples with other work | of those, with another project's mutation run |
| --- | --- | --- | --- | --- | --- |
| isolated, first | base | 10-10 20:18 | 7 036.8 s, 117.3 min | 79 of 118 | 0 |
| the comparison run | base with the flag added | 10-10 22:16 | 2 692.4 s, 44.9 min | 6 of 45 | 0 |
| first of three | `ab6dc36` | 10-10 23:04 | 3 810.0 s, 63.5 min | 55 of 64 | 25 |
| second of three | `ab6dc36` | 10-11 00:08 | 3 171.1 s, 52.9 min | 23 of 53 | 9 |
| third of three | `ab6dc36` | 10-11 01:01 | 3 060.3 s, 51.0 min | 41 of 51 | 13 |
| probe planted (below) | `ab6dc36` and the probe | 10-11 01:59 | 2 875.8 s, 47.9 min | 42 of 48 | 4 |
| probe removed | `ab6dc36` | 10-11 02:47 | 2 376.4 s, 39.6 min | 32 of 40 | 7 |
| **isolated, second** | `ab6dc36` with the flag removed | 10-11 03:27 | 4 647.4 s, **77.5 min** | **0 of 78** | 0 |
| **without isolation, free** | `ab6dc36` | 10-11 04:45 | 2 099.9 s, **35.0 min** | **0 of 35** | 0 |

The other work during the first isolated run was three fix lanes of this project running their own gates,
the end-to-end suite among them. During the six runs after it, it was another project's gates, in five of
them its mutation gate too, and during the first twelve minutes of the first of the three also a recursive
search this lane had started and should not have. **The three runs the task asked for were all disturbed**,
so the pair to compare is the last two rows: taken back to back, at the same commit but for the flag, with no
other work in any minute sample of either. **77.5 minutes against 35.0, 2.2 times faster, 42 minutes saved.**
E01-M01-FIX-28 recorded 88 minutes for the isolated gate on 2026-10-04; this lane did not reproduce that
figure and does not know that run's load.

**Why the gate is not four times faster when the suite is.** Seven concurrent copies of the per-mutant
command, the healthy suite, measured the way E01-M01-S09 measured it, three batches each way on 2026-10-11 at
01:54, with another project's gate run in the process table:

| the command | copies | batch wall clock | per-copy wall clock | copies that failed | slowest test that passed |
| --- | --- | --- | --- | --- | --- |
| with `--no-isolate` | 21, in 3 batches | 4.9–6.3 s | 4.4–6.2 s | 0 | 498 ms |
| without it | 21, in 3 batches | 21.2–25.7 s | 20.2–25.6 s | 0 | 600 ms |

That is S09's 5.7 s against 25 to 30 s again, about four times the throughput, over 7 980 test observations
each way. The gate gains less because 47 of its mutants never finish: each holds one of Stryker's seven
workers until the outer clock stops it, and that clock did not get shorter. Stryker's budget for a mutant is
1.5 times the dry run plus `timeoutMS`; the dry run took between 3.4 and 12.0 s in the seven runs without
isolation, so a `Timeout` cost between 125 and 138 s, and 47 of them shared among seven workers come to
fourteen or fifteen minutes of any run, 14.0 of the free run's 35.0. That is arithmetic on the budget, not a
measurement of where the time went.

## What the nine reports agree on, and the two things they do not

On **status**, all of them agree: the two isolated runs and the seven without isolation give every one of the
1 353 mutants the same status, except that the run with the probe planted differs in the one mutant the
probe was aimed at. Five of the nine — both isolated runs, the comparison run, the first of the three and the
run after the probe was removed — also name the same failing tests for all 1 303 kills.

The other runs differ in *why* some mutant was killed, in two ways.

### Two kills that also carried vitest's test timeout

In the second and third of the three. The mutants are `src/core/layout/segment-buffer.ts` 97:7
`ConditionalExpression` to `true`, and the `EqualityOperator` at the same place. Both make the buffer grow on
every push, which is a copy of the whole buffer per segment, and one test of another file gets slow under
it: *the colour of a lane > cycles once the graph is wider than the contract has indices*, in
`lane-layout-pages.test.ts`. In those two runs it crossed the 15 000 ms inner clock. Both mutants were still
killed by an assertion in the same output — the segment buffer's own test fails under both in all nine
reports — so the status did not move; the gate's clock clause counted them, 49 of 1 350 and 3.6 % in place of
47 and 3.5 %.

This is the mutant and the load, not the flag. With the first of those mutants planted by hand and the
suite run directly, on 2026-10-11 at 01:56:

| the command, mutant planted | copies at once | that test took | crossed 15 000 ms |
| --- | --- | --- | --- |
| with `--no-isolate` | 1 | 4.07 s | no |
| without it | 1 | 4.65 s | no |
| with `--no-isolate` | 7, two batches | 15.2–17.8 s | in 14 of 14 copies |
| without it | 7, two batches | 12.4–13.0 s in one batch, 17.0–17.7 s in the other | in 7 of 14 copies |

So the test takes four seconds under the mutant on a quiet machine either way, and crosses the clock either
way once seven copies of that mutant compete — which is harsher than the gate, where the other six workers
hold other mutants. Neither isolated run happened to catch it and two of the seven runs without isolation,
both on a loaded machine, did. That is nine draws and not a rate.

### Kills that name no failing test

**In two of the seven runs without isolation, and in neither of the two with.** This is the finding of this
lane that a reader deciding whether to keep the flag needs.

| run | mutants | what their recorded output holds |
| --- | --- | --- |
| third of three | `reference-list.ts` 57:3 `CallExpression`, 74:9 `BlockStatement` | no test result; vitest reports its worker `exited unexpectedly … during starting state`, with exit codes 3221225773 and 3221226505, and one output also carries `VirtualAlloc failed` |
| without isolation, free | `reference-list.ts` 94:97 `BlockStatement`, 95:7 `ConditionalExpression` to `true` and to `false` | two outputs are empty; the third is node's own uncaught `RangeError: WebAssembly.instantiate(): Out of memory`, with nothing from vitest |

All five are in `src/core/parse/reference-list.ts`. In every other report each is killed by failing
assertions of `reference-list.test.ts` — one failed test, sixteen, two, two and one respectively. In the two
runs above the suite never ran: the process could not get memory to start, it exited non-zero, and under the
command runner a non-zero exit is a kill. The gate's fourth clause exists for this and counted it both times,
2 and 3 of 1 303, 0.2 % against a cap of 25 %, and the gate passed. The first of the two exit codes is
`0xC000012D`, the status Windows gives when the commit limit is reached.

**What takes the memory is other mutants, and it takes it in either mode.** Six mutants carry `RangeError:
Array buffer allocation failed` in their recorded output in all nine reports: three of the growth condition
at `reference-list.ts` 53, two at `src/core/store/pending-parents.ts` 114:7 and one at `segment-buffer.ts`
103:3. Each makes a column double without end, and the three in `reference-list.ts` are killed, in every
report, by two tests that fail on that refused allocation and by nothing else. With the first of them planted
by hand (`reference-list.ts` 53:7 to `false`) and the suite run once, alone, on a free machine, twice each
way on 2026-10-11 at 05:22, the process table sampled about every 200 ms:

| the command, mutant planted | run took | largest peak working set of a worker | largest `PeakPageFileUsage` of a worker |
| --- | --- | --- | --- |
| with `--no-isolate` | 36.8 s, 38.0 s | 10.9 GB, 12.0 GB | 71.9 GB, 71.8 GB |
| without it | 41.9 s, 43.3 s | 11.1 GB, 12.0 GB | 71.8 GB, 71.8 GB |

The machine has 15.6 GB of memory and reported a commit limit of 37.4 GB just before. So one such mutant
holds most of the machine's memory for most of the half minute it runs, with the flag or without. (The last
column is the figure Windows reports under that name; it is above the commit limit the same interface
reports, so this lane does not know exactly what it counts, and the working set is the figure to rely on.)
The healthy suite is not the cost: sampled the same way, its worker peaked at 79 MB of working set without
isolation and at 67 to 71 MB with it.

The five casualties have ids 911, 912, 920, 921 and 922, and the three memory-hungry mutants of that file
have ids 906, 908 and 909. That is consistent with the casualties having been started by other Stryker
workers while one of those three was running; the report records no times, so that is an inference and not
an observation.

**Why it showed only without isolation is not established.** Two isolated runs showed none and two of seven
runs without isolation showed some; the same six mutants exhaust memory in both. One difference that could
matter is that a suite of five seconds is started several times in the half minute a hungry mutant runs,
where a suite of twenty-five is started once or twice, but that was not measured, and nine runs cannot
separate it from chance. The gate script's header records that E01-M01-FIX-10 found no such kill in four
isolated runs; this lane did not reproduce those.

**Why it mattered.** A kill of this kind says nothing about the mutant. Until E01-M01-FIX-36 the gate could not
refuse such kills one at a time — the cap is a quarter, because a mutant that breaks its module on import
looks the same — so:

- a *listed* survivor that met such a moment would be reported as detected, which the gate prints as a note;
- an *unlisted* survivor that met one would be counted as killed, and the gate would pass that run.

In these nine runs neither happened: every one of the five casualties is a mutant the other eight reports
kill by assertion. Review round 21 met one more at `021fba6`, for a cause nobody established. What
E01-M01-FIX-36 changed about it, and measured, follows.

#### What E01-M01-FIX-36 measured and changed

Every figure in this subsection was taken by E01-M01-FIX-36 on 2026-10-17, in UTC, on the same eight-core
machine with 15.6 GB of memory, which reported a commit limit of 28.8 to 31.2 GB during the samples below.
The machine was never free: another project's gate script, and for part of the day its mutation run, was in
the process table, and so were the two other fix lanes of this project. A sampler of FIX-36's own read every
`node.exe`'s working set, peak working set, commit and peak commit, with the machine's free memory and
processor load, every 250 ms through the single runs and every five seconds through the full ones, beside the
process table once a minute; *peak* below is the process's own peak counter, which no sampling interval can
miss. Base is `021fba6`.

**The runaway mutants, reproduced.** S12's figures were for one of the six. FIX-36 planted each of the six by
hand in a copy of the tree and ran the per-mutant command alone, as it was at the base (`… --fsModuleCache
--no-isolate`). The ids are the ones FIX-36's base report gives them; *largest process* is the largest of the
vitest process and its worker.

| mutant | id | run took | largest process, peak working set | its peak commit | how the run ended |
| --- | --- | --- | --- | --- | --- |
| `reference-list.ts` 53:7 `ConditionalExpression` to `false` | 906 | 78.3 s, 65.4 s | 8.0 GB, 8.9 GB | 35.9 GB | exit 1, two tests failed on `RangeError: Array buffer allocation failed` |
| `reference-list.ts` 53:7 `EqualityOperator` to `>` | 908 | 77.6 s | 9.5 GB | 71.9 GB | the same |
| `reference-list.ts` 53:40 `BlockStatement` to `{}` | 909 | 62.0 s | 9.0 GB | 71.8 GB | the same |
| `pending-parents.ts` 114:7 `ConditionalExpression` to `true` | 1362 | 39.4 s | 102 MB | 43.1 GB | exit 1, four tests failed, that `RangeError` among their errors |
| `pending-parents.ts` 114:7 `EqualityOperator` to `!==` | 1364 | 25.8 s | 110 MB | 84.2 GB | the same |
| `segment-buffer.ts` 103:3 `AssignmentOperator` to `-=` | 319 | 21.9 s | 113 MB | 41.3 GB | exit 1, 24 tests failed, one on that `RangeError` |

So S12's working set of 10.9 to 12.0 GB was not reproduced: the three of `reference-list.ts` reached 8.0 to
9.5 GB here, on a machine that had 5.9 to 9.1 GB free when each began and between 1 and 283 MB at its lowest.
The other three hold little working set and take their memory as commit instead, tens of gigabytes of it for a
moment, which is the resource whose exhaustion status, `0xC000012D`, S12 found in a casualty's output. The
first of the six held more than 1 GB of working set for 62.5 s of its first run, and for 77.1 s of its run
beside six other copies, below.

**Seven copies at once, one planted.** At 08:48, mutant 906 planted in one copy and the healthy suite in six
others, each of those six started again as soon as it finished, as Stryker's other workers would, for as
long as the planted copy ran (103.1 s): the planted copy's largest process peaked at 8.0 GB, free memory
fell to 4 MB, and the six healthy copies ran 35 times between them and **passed all 35**. So FIX-36 did not
reproduce a casualty either: nothing in that one trial was starved into a false kill. That is one trial,
not a rate.

**What bounds them now.** Two tests, each first in its file, see the five growth mutants after one growth:
*keeps the target column it started with for its first reference* in `reference-list.test.ts`, and *keeps the
room it started with while its first parent waits* in `pending-parents.test.ts`. The sixth was already killed
by assertion, by *a straight line of commits > draws exactly one segment a row* in `lane-layout.test.ts`,
among others. And the per-mutant command now stops at its first failing test and runs its files in a fixed
order: `node node_modules/vitest/vitest.mjs run --reporter=dot --fsModuleCache --bail=1 --no-cache
--no-isolate`.

`--no-cache` is the half that is easy to miss. Vitest orders a run's files by the results of the last run it
recorded, in `node_modules/.vite/vitest/<hash>/results.json`, failed files first and then the slowest; every
Stryker sandbox links the same `node_modules`, so that file is whatever the last of seven concurrent workers
wrote. Measured with vitest's JSON report, three runs of the healthy suite in one copy: with the cache, a
file this lane's planted runs had left marked failed, `pending-parents.test.ts`, ran first; with
`--no-cache`, with isolation and without, the order was the 25 files by size, largest first,
`lane-layout.test.ts` first and `column-read.test.ts` last. Without a fixed order, which failure comes first,
and so whether a run stops before the allocation or after it, would depend on which mutant finished last.

Planted again at the head, run alone with that command, both ways:

| mutant | without isolation: run, largest process peak working set, peak commit | with isolation |
| --- | --- | --- |
| 906 | 3.9 s, 113 MB, 197 MB | 9.8 s, 109 MB, 171 MB |
| 908 | 2.7 s, 110 MB, 173 MB | 8.9 s, 106 MB, 168 MB |
| 909 | 4.9 s, 111 MB, 191 MB | 8.4 s, 105 MB, 169 MB |
| 1362 | 2.9 s, 107 MB, 172 MB | 3.6 s, 110 MB, 174 MB |
| 1364 | 1.4 s, 106 MB, 171 MB | 3.3 s, 106 MB, 186 MB |
| 319 | 2.0 s, 107 MB, 172 MB | 1.6 s, not sampled: it ended before the sampler found its processes |

Every run exited 1 on one failing test, the one named above, and none carried an allocation failure. The
healthy suite, run alone the same way with isolation, peaked at 110 MB.

**The clause.** The gate has a fifth clause, in `scripts/gates/mutation-remeasure.js`: every killed mutant
whose recorded output names no failing test, or says its suite ran out of memory or lost its worker, is run
again alone after Stryker has finished, by the same command under the same outer clock, in a copy of the tree
with that one mutant planted, and is counted by what that run says. The argument, and the line it hinges on,
are in that file. At the base it would have chosen the six above, whose kills all carried `Array buffer
allocation failed` in FIX-36's base report, and run each of them again; FIX-36 did not run it there. At the
head their kills carry none, and in the runs below it chose nothing. It was watched failing on a copy of the
head report in which the kill of `growth.ts` 73:3, S12's probe mutant below, had its output replaced with a
worker's crash, with the one assertion that kills that mutant neutered: refused, the mutant re-measured as a
survivor that is not on the list; with the clause neutered, the same copy passed, counted as one kill naming
no failing test; the original report passed. The audit of E01-M01-FIX-36 has the four steps.

**Every mutant keeps its verdict.** Three full runs of `node scripts/gates/mutation.js` over the configured
scope, compared mutant by mutant on file, start and end position, mutator and replacement, which all 1 353
share between the three reports:

| run | tree | started | wall clock | killed | timeout | survived | kills carrying vitest's test clock | kills naming no failing test | re-measured | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base | `021fba6` | 09:20 | 2 699.5 s | 1 303 | 47 | 3 | 0 | 0 | — | `mutation: ok` |
| head, without isolation | `7129fd8` | 10:42 | 2 057.9 s | 1 316 | 34 | 3 | 2 | 0 | 0 | `mutation: ok` |
| head, isolation restored in the working tree | `7129fd8` with `--no-isolate` deleted | 11:17 | 3 477.9 s | 1 316 | 34 | 3 | 2 | 0 | 0 | `mutation: ok` |

Between the base and the head without isolation, **13 of 1 353 statuses differ, and all 13 are `Timeout` at
the base and `Killed` at the head**: no mutant moved to `Survived`, and none moved from `Killed`. They are
loop-control mutants of the growth loops (`growth.ts` 42 and 43, `segment-buffer.ts` 48 and 49,
`open-lanes.ts` 74 and 75, `row-block.ts` 58), of the hash index's load test (`hash-index.ts` 120:7, two), of
`bytes.ts` 144:20, `records.ts` 178:33, `pending-parents.ts` 74:38 and `column-read.ts` 64:71. Each hung the
suite at the base until Stryker's clock stopped it; with the run stopping at its first failure, a test that
fails before the hung one now ends the run: seven of the 13 by an assertion, four by an error the code under
test throws, and the two of `hash-index.ts` by vitest's own 15 000 ms clock, which the clock clause counts.
That is the one difference the bail can make, and it moves verdicts towards a named test, not away from one.
A fourth full run, at 10:07 with S12's probe of *The gate can still fail* planted at the head, exited 1 with
one finding, `growth.ts` 73:3 `CallExpression` survived and is not on the list, and differed from the base
in those 13 and in that mutant alone.

Between the two runs at the head, with isolation and without, **no status differs**, and every one of the
1 316 kills names the same failing tests in both outputs: the bound and the clause hold with isolation too,
and neither changes a verdict there. The flag
`--no-isolate` was deleted in the working tree for that run only and restored after it; at `7129fd8` it is
where S12 put it.

The base run had another project's mutation run beside it in all 44 of its minute samples, and free memory
under 1 GB in 13 of its 538 five-second samples, at its lowest 0.0 GB; the head run had that project's gate
script beside it in 21 of 34 minutes and not its mutation run, the other fix lanes of this project in 33, and
free memory never under 3.0 GB. The isolated run had that project's mutation run beside it in 10 of 57 minutes
and free memory never under 2.6 GB. The processor averaged 99.3, 99.9 and 99.7 % over the three. So the wall
clocks are not a comparison of the trees.

## The gate can still fail

A faster run has to be shown to kill by assertion and not by accident, so one assertion was neutered and the
gate run in full, twice.

The first isolated report names 223 mutants killed by exactly one test. One of them is
`src/core/store/growth.ts` 73:3, `CallExpression` to `;`, which removes the copy from `copiedInt16`; its only
killer is *the copying growers > keeps signed values signed* in `growth.test.ts`, whose single assertion
compares the copied values. The probe replaced that assertion's `toEqual([-600, 330, 0])` with
`toHaveLength(3)`, which holds whether or not anything was copied. The suite still passed, 380 of 380.

Predicted before the run: exit 1; 1 302 killed, 47 timeout, 4 survived; one finding, naming that mutant; every
other mutant unchanged, the neighbouring mutant that empties the whole function included, because spreading
its `undefined` result throws.

1. Probe planted, `node scripts/gates/mutation.js` over the full scope → **exit 1**. 1 353 mutants: 1 302
   killed, 47 timeout, **4 survived**; score 99.70; `survivors of this run not on the list 1`; one finding,
   `src/core/store/growth.ts:73:3 CallExpression (to ";") survived and is not in
   scripts/gates/mutation-survivors.json`. Compared mutant by mutant with the first of the three runs: one
   status differs, that mutant's, `Killed` to `Survived`, and the other 1 302 kills name the same failing
   tests.
2. Probe removed with `git checkout`, `git status --short` empty, the same command → **exit 0**,
   `mutation: ok`. 1 303 killed, 47 timeout, 3 survived; score 99.78; no status differs from the first of the
   three runs, and all 1 303 kills name the same failing tests.

## What would make someone revisit this

- **A kill that names no failing test, or that says its suite starved.** Since E01-M01-FIX-36 the gate
  re-measures each one alone after the run and prints the count on every run, on the line `… re-measured
  alone after the run, <n> killed mutants …`, each with its second verdict. A figure other than nought there
  is the thing to read: a mutant re-measured as a survivor is a test gap, and one that could not be measured
  refuses the build with its output quoted. A run that refuses that way on unchanged source is the machine
  starving the second run too, which is the measurement to take before anything else. Whether isolated runs
  show such kills at the rate runs without isolation did is still not measured; FIX-36's one isolated run
  and one without showed none either way. Whether the gate keeps `--no-isolate` remains the owner's
  decision, recorded by review round 21, and FIX-36 did not take it.
- **A mutant that asks for more memory than the machine has.** The six of *What E01-M01-FIX-36 measured and
  changed* stop at a test that sees them after one growth, because the run stops at its first failure and
  its files run largest first. Three things undo that: a seventh such mutant whose only killers fail on the
  allocation (a kill carrying `Array buffer allocation failed` is now re-measured, so it shows on that line
  first), `--bail=1` or `--no-cache` leaving the command, or a test file outgrowing `lane-layout.test.ts`,
  which is what makes it run first and kill the sixth by assertion before `row-block.test.ts` asks for its
  columns. The file sizes at `7129fd8` are 14 391 and 12 931 bytes. Re-planting the six by hand and reading
  the largest process's peak, as that subsection did, takes a minute.
- **A test file that keeps state, or a module that does.** The argument rests on *No test file depends on
  another's module state*. A `beforeAll`, a `vi.mock`, a fake timer left running, a top-level `let` in a
  module of `src/core/` or `src/contracts/`: any of these is the reason to run the shuffled orders again, and
  the comparison of the two reports if they pass. The shuffled orders are 23 runs of about two seconds.
- **`gates:unit` and the mutation gate disagreeing.** A test that passes one way and fails the other is a
  test that depends on the registry, and is repaired as a test; it is not a reason to move the flag into
  `vitest.config.js`.
- **The mutants that never finish.** By the arithmetic above they are now about two fifths of the gate's wall
  clock on a free machine. Shortening the outer clock is E01-M01-S09's subject and has its own relation to
  hold; it is where the next gain is, and it was out of this lane's scope.
- **Everything E01-M01-S09 lists.** A different machine, a slower test, a vitest that rewords its messages
  and the vitest runner starting to work all apply unchanged, since both clocks are where that lane left
  them.
