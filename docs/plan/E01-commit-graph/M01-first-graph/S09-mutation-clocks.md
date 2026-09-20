# E01-M01-S09 · The two clocks the mutation gate runs under

## What changed

Three values, in two files.

| clock | where | was | is |
| --- | --- | --- | --- |
| the inner one, per test | `vitest.config.js` `testTimeout` | unset, so the framework's 5 000 ms | **15 000 ms** |
| the inner one, per hook | `vitest.config.js` `hookTimeout` | unset, so the framework's 10 000 ms | **15 000 ms** |
| the outer one, per mutant | `stryker.config.json` `timeoutMS` | 60 000 ms | **120 000 ms** |

And one setting that is not a clock but is the reason the inner clock kept firing:
`vitest.config.js` now sets **`fileParallelism: false`**, so the suite runs its files one at a time.

Nothing in `scripts/gates/mutation.js` changed. The 25 per cent cap on detections resting on a clock is where
it was, and the survivor mechanism is untouched.

## The defect, reproduced here rather than inherited

`gates:mutation` refuses a run in which more than a quarter of the detections rest on a clock rather than on
a failing assertion (`docs/ADR-0003-quality-gates-and-ci.md` decision 3, and the clause's own header in
`scripts/gates/mutation.js`). That clause had started refusing honest work — 25.2, 53.8 and 61.4 per cent over
three runs of identical source in the other lane of this wave — and `AGENTS.md` §11 says a gate that flaps is
a defect of the gate.

The cause was two clocks of which only one was ever chosen. Stryker's `timeoutMS` bounds the whole per-mutant
command and was set deliberately. Vitest's `testTimeout` bounds each test *inside* that command, was never
set, and so was the framework's 5 000 ms. The inner one is much the shorter, so it fires first: a healthy test
crosses it, the suite exits non-zero, and Stryker records the mutant as `Killed` by a clock that says nothing
about the mutant.

That is reproduced here directly, without running Stryker at all, by running **the gate's own per-mutant
command** — `node node_modules/vitest/vitest.mjs run --reporter=dot --fsModuleCache` — in **seven concurrent
copies**, which is Stryker's default concurrency on this eight-core machine and therefore the condition every
mutant is measured under. Three batches of seven, on an otherwise idle machine:

| batch | per-copy wall clock | copies that exited non-zero | slowest test that passed | slowest test overall |
| --- | --- | --- | --- | --- |
| 1 | 25.3–27.1 s | **1 of 7** | 4.30 s | 5.11 s, failed on the 5 000 ms clock |
| 2 | 24.5–26.1 s | 0 of 7 | 4.06 s | 4.06 s |
| 3 | 25.1–26.2 s | **1 of 7** | 3.88 s | 6.26 s, failed on the 5 000 ms clock |

The same suite run once, alone, takes 3.8 s and its slowest test takes 0.40 s. **Two of those 21 runs failed
with every assertion in the project passing**, which as a rate over a run of 1 230 mutants is of the order of
a hundred kills that are stopwatch readings — the order of magnitude E01-M01-FIX-10 measured directly (73, 82,
88 and 100 of about 1 180 over four full runs) and the reason the other lane of this wave crossed the cap by
doing nothing but adding tests.

## The inner clock, and why the fix is not only a bigger number

A bigger `testTimeout` alone would have raised the bar over a tail rather than removed what produces it. The
tail is produced by nesting: the gate runs **seven** copies of a suite that itself spreads 21 files over as
many workers, which is some 147 runnable threads on eight cores. So the first half of the fix is
`fileParallelism: false` — the mutation gate already saturates the machine, and the suite multiplying itself
on top of that buys nothing and costs the tail.

Measured the same way, seven concurrent copies of the same command with the files run one at a time:

| how the suite is scheduled | copies run | test observations | copies that failed | slowest test that passed |
| --- | --- | --- | --- | --- |
| 21 files in parallel (before) | 21, in 3 batches | 7 161 | **2** | 4.30 s |
| one file at a time (after) | 57, in 8 batches | 19 437 | 0 | **1.07 s** |
| one file at a time, machine deliberately loaded | 14, in 2 batches | 4 774 | 0 | **1.92 s** |

The load in the third row is eight processes each spinning in a tight floating-point loop for the whole
measurement, beside the seven copies, on eight cores — the machine's runnable work roughly tripled. Under that
same load the *unchanged* parallel scheduling put its slowest passing test at **4.57 s**, a tenth of a second
under the clock that was firing.

**`testTimeout` is 15 000 ms.** That is 7.8 times the slowest healthy test measured under the tripled load,
14 times the slowest measured without it, and about a ninth of the outer budget, so an asynchronously hung
test is caught by the clock that names the test rather than by the clock that names nothing.

**One value, for every run of this suite, not a mutation-only value.** The mutation gate exists to measure
what `gates:unit` runs, and two configurations would mean the two disagree about which test is hung. Run
alone, a generous inner clock costs one timeout on a test that actually hangs and nothing on any other run.
`vitest.fixtures.config.js` and `vitest.perf.config.js` already set their own timeouts explicitly, so this
was the last run in the project still on a clock nobody picked.

`hookTimeout` is set to the same 15 000 ms. This suite has no `beforeAll`, `beforeEach` or `afterAll` today —
grepped, not assumed — so the value is chosen ahead of the hook that will want it rather than discovered by a
hook crossing the framework's 10 000 ms.

## Why not simply lower Stryker's concurrency

Because it buys the same tail for more wall clock, measured both ways. Throughput here is mutants per second,
which is the concurrency divided by what one copy of the suite costs while that many run at once:

| scheduling | concurrency | batch wall clock | mutants per second | slowest test that passed |
| --- | --- | --- | --- | --- |
| 21 files in parallel | 7 | 26.6 s (26.2–27.2) | 0.263 | 4.30 s |
| 21 files in parallel | 4 | 14.7 s (14.2–15.2) | 0.272 | 2.62 s |
| 21 files in parallel | 2 | 8.3 s | 0.241 | 0.70 s |
| one file at a time | 7 | 26.9 s (25.1–29.8) | 0.260 | 1.07 s |

**Throughput is flat from two concurrent suites to seven**, because the machine is saturated either way, so
lowering concurrency is nearly free in wall clock and does tighten the tail. What decides it is the other
cost: a mutant that hangs occupies one worker for the whole outer budget, and a full run with the chosen
clocks reports 43 of those. At concurrency 2 they occupy half the machine for two minutes each; at
concurrency 7, a seventh.
Running the files one at a time gets the same tail without giving that up, so **`concurrency` is left at
Stryker's default** and nothing in `stryker.config.json` says otherwise.

## The outer clock, and the relation between the two

Stryker's effective budget for one mutant is not `timeoutMS`. It is

```
timeoutFactor × netTime + timeoutMS + overhead
```

with `timeoutFactor` at its default of 1.5 and `netTime` the duration of the **dry run**, which is one run of
the whole suite with the machine to itself. Read from `@stryker-mutator/core` 10.0.0's
`mutant-test-planner.js`, and confirmed against the run's own log: the before run reported
`net 5642 ms, overhead 2 ms`, so its real per-mutant budget was 68.5 s rather than the 60 s the file names.

**The relation the two clocks have to hold:** the outer budget must exceed the worst a *healthy* suite costs
under contention, plus one whole inner timeout, or the two swap places and the outer clock starts killing
healthy runs instead. The worst healthy suite measured here is **77.6 s**, with the files run one at a time
and the machine deliberately loaded as described above; one inner timeout is 15 s; so the outer budget must
clear **92.6 s**. With the files run one at a time the dry run takes about 9.5 s, so `timeoutMS` at 120 000
gives an effective budget of about **134 s** — 1.4 times what it has to clear, and 3 times what it has to
clear on an idle machine.

That the budget is computed from the dry run also means it moves the right way on its own: a dry run taken on
a busy machine yields a bigger `netTime` and therefore a bigger budget for every mutant after it.

## Before and after, on the same source

Both are full runs of the configured scope, unnarrowed, on this machine, taken by this lane rather than
quoted from another. The "before" run is this tree with the two files reverted to their old values, so the
only difference between the two columns is the three numbers and the scheduling. Neither column carries the
test added below, which is why the after column ends with four survivors against a list of three.

| quantity | before | after |
| --- | --- | --- |
| mutants | 1 230 | 1 230 |
| killed by a failing assertion | **904** | **1 183** |
| killed with vitest's own test timeout in the output | **241** | **0** |
| reported `Timeout` by Stryker | 85 | 43 |
| detections resting on a clock | 326 of 1 230, **26.5 %** | 43 of 1 226, **3.5 %** |
| kills whose output names no failing test | 0 | 0 |
| survivors, against a list of 3 | 0 | **4** |
| score | 100.00 | 99.67 |
| tests per mutant | 0.93 | 0.97 |
| `gates:mutation`, wall clock | **106 minutes** | **61 minutes** |
| the gate's verdict | **refused**, exit 1 | refused, exit 1, for the survivor below |

Three things in that table are the whole argument.

**The 241 went to nought.** Every one of them was a kill whose recorded output was a healthy test crossing
5 000 ms, and the clause that counts them now counts none. Those 241 were spread over 18 of the 20 files in
scope, 63 of them in `bytes.ts` alone.

**Stryker's own `Timeout` count fell from 85 to 43**, which is the second half of the same effect and was
predicted by nobody. E01-M01-FIX-10 measured that count at 44, 46, 46, 46 over four runs and called it very
nearly constant; the before run here put it at 85. 43 is FIX-10's number, so what the before run had was
about forty extra mutants pushed past even the outer budget by a machine running seven copies of a suite
that was thrashing against itself — the migration out of `Killed` and into `Timeout` that
`scripts/gates/mutation.js` names as the mechanism behind its original failure and that FIX-10's four runs
were too lightly loaded to show.

**The score fell, and that is the gate working.** 100.00 was a number built partly out of stopwatch
readings; 99.67 is what the suite actually kills.

## The survivor the clocks uncovered, and why it was closed with a test

One mutant that had been "killed" on every previous run came back alive:
`src/core/layout/segment-buffer.ts:97:7`, `ConditionalExpression` replaced with `true`, so `pushSegment`
grows the buffer on every push instead of only when it is full.

It is **not** equivalent and it is **not** unobservable, which is why it is a test gap closed with a test
rather than an entry added to `scripts/gates/mutation-survivors.json`. Under the mutant every value, every
length and every count this module answers with is identical — `nextSegmentCapacity` returns the capacity it
was handed whenever the requirement already fits — so the only thing that can see it is the identity of the
three typed arrays, and what it costs is a copy of the whole buffer per segment in the module whose entire
reason to exist is that it copies once per page. `src/core/layout/`'s `layoutWork` counts rows, parent edges,
lane visits and segments, and none of those moves, so there was no counter to assert it against either.

`segment-buffer.test.ts` now asserts that a push with room left keeps the three columns it already has and
that the push that fills the buffer replaces all three. Watched on a run of the configured scope narrowed to
that file: **24 mutants, 100.00, no survivor**, where the same narrowed run before the test had the mutant
alive.

`scripts/gates/mutation-survivors.json` is unchanged: three entries, all three left alive by every run with
the chosen clocks, where the before run reported all three **detected** — two of them by a test in an
unrelated file timing out, and one by the outer clock.

## What it did to the pipeline's duration

| step | before | after |
| --- | --- | --- |
| `gates:mutation` | 106 minutes | **61 minutes** |
| `gates:unit:modules` (the suite alone, with coverage) | 6.3 s | 11.3–14.0 s |

The mutation gate got **45 minutes faster**, which was not the point and is worth saying plainly: the time it
lost before was spent waiting out mutants that had been pushed past the outer clock by contention, and about
a hundred per-mutant runs that had to fail a test on a stopwatch before they could exit. The unit gate pays
about six seconds for running its files one at a time. `npm run gates` end to end is 63 minutes on an idle
machine, against ADR-0003's expectation of about an hour, which is where it was.

## The same source, twice, at two loads

Two full runs through `npm run gates`, both at the commit that adds the test above, exit status read
directly. The second was taken with **four processes each spinning in a tight floating-point loop for the
whole run**, on the same eight cores the gate's seven workers were already using.

| quantity | idle | loaded |
| --- | --- | --- |
| `npm run gates` exit status | **0** | **0** |
| mutants | 1 230 | 1 230 |
| killed | 1 184 | 1 184 |
| reported `Timeout` | 43 | 43 |
| killed with vitest's own test timeout in the output | 0 | 0 |
| survivors, against a list of 3 | **3 and 3** | **3 and 3** |
| listed entries this run reported detected rather than alive | 0 | 0 |
| detections resting on a clock | 43 of 1 227, 3.5 % | 43 of 1 227, 3.5 % |
| score | 99.76 | 99.76 |
| tests per mutant | 0.97 | 0.97 |
| `gates:mutation`, wall clock | 3 660.7 s | 5 604.7 s |
| `npm run gates`, wall clock | 62 min 53 s | 95 min 28 s |

**The verdicts agree, and so does every count in the report.** The load cost 1.53 times the wall clock and
moved nothing else at all. A third full run, the one taken before the test above was written, reported the
same 43 and the same 3.5 per cent on the same scope.

**That is evidence and not proof, and the difference matters here**, because this gate has twice been green
for a reason unrelated to what it measures. Three runs is three draws. What would falsify the claim is a run
whose `Timeout` count leaves 43 while timeout-shaped kills stay at nought — that is the outer clock starting
to fire on healthy suites — or any timeout-shaped kill at all, which is the inner clock firing again. Both
are printed on every run, which is what makes the series readable across audits rather than rediscovered.

## What was watched failing

`AGENTS.md` §7: a gate is not evidence until it has been watched failing.

**The clock clause still bites, and the cap did not move.** Through the replay mode, which runs the clauses
over a report without running Stryker:

1. Over the idle run's own report, untouched: `mutation-replay: ok`, exit 0, 43 of 1 227 at 3.5 per cent.
2. Over a **copy** of it with 300 of the 1 184 kills given vitest's own `Test timed out in 5000ms` wording
   and nothing else changed: exit 1, 343 of 1 227 at **28.0 per cent against a cap of 25**, one finding.
3. Over the untouched report again: `ok`, exit 0.

`CLOCK_SHARE_CAP` in `scripts/gates/mutation.js` is still 0.25 and that file is not in this lane's diff.

**A suite that asserts nothing still fails.** `src/core/parse/raw-date.test.ts` was reduced to the same
thirteen calls with every assertion removed and every expected throw swallowed — the suite still passed, 341
tests, exit 0, which is the point of the probe. Then, on a real run of the gate over that module:

1. Probe planted: `node scripts/gates/mutation.js --mutate src/core/parse/raw-date.ts` → **exit 1**, 71
   mutants, 47 killed, **24 survived**, score **66.20**, 24 findings, each an unlisted survivor.
2. Probe removed: the same command → **exit 0**, 71 mutants, **71 killed**, score 100.00, no survivor.

Those two numbers are the ones E01-M01-FIX-04 measured for the same probe on the same module, 66.20 and 24,
reproduced here under the new clocks.

**The survivor clause was watched both ways on the mutant this lane uncovered** as well: narrowed to
`src/core/layout/segment-buffer.ts` it refused the run before the test was written and passed after, 24
mutants and no survivor.

## What would make someone revisit this

- **The gate's hour.** `isolate: false` was measured and deliberately **not** taken: seven concurrent copies
  of the gate's command finish in **5.7 s** with it against 25–30 s without, which is about four times the
  throughput and would take `gates:mutation` from an hour to roughly a quarter of one. It is left alone
  because it shares one module registry across the suite's 21 files, so it changes what a test sees, and this
  lane's remit is the clocks. It is the first thing to measure if the hour becomes the constraint, and what
  it needs is evidence that no file of this suite depends on another's module state.
- **A hook, or a slower test.** Both clocks are chosen against a measured distribution whose slowest healthy
  member is about a second. A test that legitimately takes ten would leave the inner clock with no margin at
  all, and the measurement to repeat is the seven-copy one in this document, not a guess at a bigger number.
- **A different machine.** Every number here is eight cores and Stryker's default concurrency of seven on
  them. On a machine with a different core count the concurrency changes, so the contention changes, so both
  clocks want re-measuring — and the seven-copy command is the whole method.
- **`@stryker-mutator/vitest-runner` starting to work** (`docs/ADR-0003-quality-gates-and-ci.md` decision 3,
  as amended). It would run one test rather than a whole suite per mutant, which removes the nesting this
  document is about and makes both values questions about a single test rather than about a suite.
- **A vitest that rewords its timeout message.** The gate already refuses a run whose output says a timeout
  in a wording it cannot read, so that arrives as a red gate naming the mutants rather than as a quiet
  undercount; the fix is `VITEST_CLOCK` in `scripts/gates/mutation.js`, not a number here.
