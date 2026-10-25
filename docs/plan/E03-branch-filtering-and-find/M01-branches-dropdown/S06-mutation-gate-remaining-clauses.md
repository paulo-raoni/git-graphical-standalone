# E03-M01-S06 · The mutation gate's remaining clauses

## What changed

- **The re-measure clause reads vitest's own clock.** `scripts/gates/mutation-remeasure.js` now chooses, besides
  the kills whose output names no failing test or says the suite starved, every kill whose output carries
  vitest's own test timeout (`timed out in <n>ms`, the gate's `VITEST_CLOCK`), and runs it again alone after
  Stryker has finished, as it does the others. A second run that times out on that clock again, or, for a kill
  chosen for the clock and nothing else, runs past the outer clock, is a new verdict, `clock`, and stays a kill;
  a pass is a survivor for the survivor clause; a failing test is a kill, as before. A kill chosen for any other
  reason that runs past the outer clock alone still refuses the build, as it did.
- **One copy of the reading.** `VITEST_CLOCK` stays in `scripts/gates/mutation.js`, which hands it to
  `remeasure` as an argument, so widening the gate's reading of the clock widens what the clause chooses. The
  file is at its 300-line `max-lines` limit, measured with ESLint's own count before and after: the call takes
  one line more and one line elsewhere (`shownPath`) one fewer, with the same value.
- **Sentences.** The headers of `mutation.js`, `mutation-remeasure.js` and `vitest.config.js`, and two
  sentences each of the S09 and S12 slice documents, corrected against the tree at this lane's base,
  `7294f0f`. Listed in *The sentences* below.

Nothing else moved: no threshold, cap or clock, no survivor entry, the per-mutant command, `stryker.config.json`
and `defineConfig`'s argument in `vitest.config.js`, which was compared byte for byte before and after. Every
measurement here was taken by this lane on 2026-10-24 and 2026-10-25 on the eight-core development machine;
times are the machine's local time, UTC−3.

## Kills resting on vitest's clock: the decision

**Re-measured, yes.** The argument against the clock-share clause that already counts such kills:

- **The two clauses answer different questions.** The clock-share clause bounds the share of detections that
  rest on a clock at a quarter. Like the cap on kills that name no failing test, it is a validity bound: it
  catches a run whose score has become a stopwatch reading and cannot see a handful. A handful is what the runs
  hold since E01-M01-S09 set the inner clock at 15 000 ms: 0 in S09's runs, 2 in two of S12's and in both of
  FIX-36's at its head, 3, 3 and 2 in E03-M01-S03's, as those slice documents record them (not reproduced
  here).
- **A handful is enough to hide a survivor.** A test that crosses the clock because the machine is busy fails,
  the suite exits non-zero, and a mutant no test kills is reported killed; the survivor clause never sees it.
  That is the defect E01-M01-FIX-36's clause exists for, by a different cause. Two of S12's clock kills were of
  that shape in part: a test of another file slowed past the clock by the mutant and by seven copies of it, an
  assertion failing beside it.
- **Alone, the clock means something.** S09 measured the slowest healthy test of this suite at 0.40 s alone and
  1.92 s under a deliberately tripled load. A test that crosses 15 000 ms in a run without Stryker's six other
  workers beside it is, by that reading, kept from finishing by the mutant, which is what Stryker's own `Timeout` means; so a second timeout keeps
  the kill, and the clock-share clause, which reads the report as Stryker wrote it, goes on counting it exactly
  as before. Its number and its cap do not move.

**Chosen whether or not an assertion failed beside the timeout.** Telling a timeout that is the only failure
from one with an assertion beside it would mean counting vitest's failed tests against its timeout messages,
two readings of a format this gate does not otherwise rely on. With `--bail=1` a run ends at its first failure:
in this lane's two full runs all five clock kills had the timeout as their only failure, while S12's two, taken
before `--bail=1`, had an assertion beside it. The cost of the simpler reading is one run alone for a kill that
would have stood anyway.

**What it costs.** One run alone per chosen kill: a suite of a few seconds, or up to the clause's outer clock,
120 s, for a mutant that makes a test slow. In this lane's first full run the clause took about three minutes,
from Stryker's end at 00:32:53 to the gate's at 00:36:00, for three kills, one of them the full 120 s. The cap on
how many kills the clause will re-measure, `REMEASURED_AT_MOST`, is 50 and did not move; it now counts the
clock kills too. The most recorded in one run is five, S03's run with a probe planted (three on the clock, two
naming no failing test).

**What it can newly refuse on an honest run.** Three things, each read from the code: a run with more than 50
kills to re-measure, where before S06 one with up to 50 clock kills under the clock cap passed, which needs a
run more than ten times worse than any recorded since S09; a clock kill whose second run starves; and a clock
kill whose second run neither passes nor fails a test nor times out. The first full run below met none of the
three; it met a fourth, which `01fb07d` removed.

## The clause, watched failing

On a report of this lane's own, a run of the gate narrowed to `src/core/store/growth.ts` at the base (16
mutants: 14 killed, 2 timeout, `mutation: ok`), a copy was doctored: the kill of `growth.ts` 73:3
`CallExpression` to `;`, whose only killer by S12's reading of its report is the one assertion of *the copying growers > keeps signed values
signed*, had its recorded output replaced by a run whose one failure is that test timing out on vitest's
15 000 ms clock. Replayed with `--check-report`, with the clause as `eabf845` left it (`01fb07d` changes only a second run past
the outer clock, which none of these replays had):

| replay | tree | re-measured | verdict |
| --- | --- | --- | --- |
| 1 | the change | 1: "a test failed" | exit 0, `ok` |
| 2 | the change, that assertion neutered (`toEqual([-600, 330, 0])` to `toHaveLength(3)`) | 1: survived | exit 1: the mutant survived and is not on the list |
| 3 | as 2, and the clock half of `chosen` removed | 0 | exit 0, `ok`, counted as one kill on a clock |
| 4 | the change, both restored | 1: "a test failed" | exit 0, `ok` |
| 5 | the change, the undoctored report | 0 | exit 0, `ok` |

Replay 2 is the red, replay 3 the same red gone with the clause neutered: **the line it hinges on is `chosen`**,
its third half, `clock.test(reason)`. The probe and the neutering were reverted, `git status --short` showing
only this lane's then uncommitted change.

Neither form of the new `clock` verdict was produced by a replay: a test timing out again alone needs a mutant
that keeps a test from finishing for 15 s on its own, and a run past the outer clock needs 120 s, and the
replays had neither. The second form was met in a real run, below, before it existed.

## A refusal of unchanged source, met and repaired

The first full run at this lane's head, `npm run gates` at `663d720` from 2026-10-24 23:29 to 2026-10-25 00:36,
exit 1, chose three kills, all three resting on vitest's clock and on nothing else: each recorded output's one
failure is a test that timed out on 15 000 ms. Run again alone, `segment-buffer.ts` 97:7 `ConditionalExpression`
to `true` and `hash-index.ts` 120:7 `EqualityOperator` failed a test; `hash-index.ts` 120:7
`ConditionalExpression` to `true`, whose timed-out test is *a store that outgrows its columns > reallocates
geometrically and keeps every commit* in `commit-store.test.ts`, ran for the whole of the clause's outer clock,
`timeoutMS`, 120 000 ms, and the clause as first written refused the build for it: red on unchanged source.
During that run a review's mutation run of this project was in 22 of the 44 minute samples of the process
table (below).

Replayed at 00:39 over that run's report with `--check-report`, the same three re-measured as "a test failed",
`mutation-replay: ok`, exit 0. So that mutant makes its test slow enough to cross either clock on a busy
machine, and does not survive: at E01-M01-FIX-36's base Stryker reported it `Timeout`, as S12's document
records, and a `Timeout` is a detection to the gate. `01fb07d` therefore reads a second run past the outer clock
as a kill when the first was chosen for the clock and nothing else, and leaves FIX-36's reading of the same
event, a refusal, for the kills it chose. That is one draw, and the reading is argued, not measured: a mutant the
tests do not kill has no reason to make a run of the suite take 120 s alone, where S09 measured the healthy
suite's worst run at 77.6 s under a deliberately tripled load beside six other copies.

The clause's outer clock is `timeoutMS` alone, where Stryker's per-mutant budget is 1.5 times the dry run plus
`timeoutMS`: 144.5 s in that run, whose dry run took 16.3 s. That is FIX-36's choice and was not changed here.

## The sentences

Each was falsified against the tree at `7294f0f` first.

- **`mutation.js` header, run counts behind by one, and the memory crashes stated without their label**: by this lane's reading of the finding, the
  paragraph review round 21 read at `021fba6` ("S12 took seven full runs with it and two without … nought in the
  other seven runs. Each of those five was a suite that could not get memory to start …") was removed by
  E01-M01-FIX-36 and is not at the base, so it was left. What was behind by one at the base is the heading
  *Beside the four shape clauses*, written before FIX-36 added the fifth: now five. The inference's other copy,
  in `mutation-remeasure.js` ("S12 traced its five to suites that could not get memory beside a mutant that had
  taken it"), now says what the outputs held and labels the rest S12's inference.
- **`mutation.js` header, "`gates:unit` … runs the same suite"**: `gates:unit` runs `gates:unit:*`, the fixture
  suite among them; now `gates:unit:modules`. The same name was corrected in two places of the `vitest.config.js`
  header.
- **`vitest.config.js` header and the S09 document, the per-mutant command**: both now say the command they
  quote is the one S09 measured with, name the flags S12 and FIX-36 added since, and say S09's figures were not
  taken again. The S09 document's *The gate's hour* says that S12 took the flag and measured 77.5 against 35.0
  minutes, 2.2 times faster where S09 predicted about four, with S12's own account of the gap labelled as
  arithmetic.
- **The S12 document**: "on a free machine" now says it means no other work in any minute sample, and that S12's
  processor samples, whole-machine and every ten seconds, cannot say whether `AGENTS.md` §11's rule held; "this
  is the mutant and the load, not the flag" is labelled an inference from its table.
- **`mutation-remeasure.js` header, the grep for `STARVED`**: grepped at `7294f0f` over every tracked file with
  `STARVED`'s phrases, it matches nothing in `src/`, `test/` or `perf/` and four lines of `scripts/gates/`, three
  in that file and one in `mutation.js`. The sentence now names the three folders.

E03-M01-S03 corrected none of these: its diff touched `mutation.js` in its import line, the line that parses the
report and one header sentence about `mutation-output.js`.

## How often the clause refuses unchanged source

Scope item 2 asked for at least three full runs of `npm run gates:mutation` at the head for this. **None was
taken**: the owner's checkpoint of 2026-10-24 left time for two full-tier runs and no more, and the first of them
had to be repeated (*A refusal of unchanged source*). So what follows is the mutation step of this lane's two
`npm run gates` runs, two draws and not a rate; the question stays open.

| run | head | started, Stryker done, gate done | Stryker's part | killed | timeout | survived | kills on vitest's clock | kills naming no failing test | chosen | re-run verdicts | a second run starved | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first | `663d720` | about 23:45, 00:32:53, 00:36:00 | 46 min 6 s | 1 316 | 34 | 3 | 3 | 0 | 3, all on the clock alone | 2 a test failed, 1 past the outer clock | no | refused, that one |
| second | `01fb07d` | by 00:46:42, 01:20:10, by 01:22:36 | 33 min 3 s | 1 316 | 34 | 3 | 2 | 0 | 2, both on the clock alone | 2 a test failed | no | `mutation: ok` |

Both runs: score 99.78, 0.97 tests per mutant, survivors against the list of three 3 and 3, none of them
detected rather than alive; detections on a clock 37 and 36 of 1 350, 2.7 %. The first run's three clock kills
are `segment-buffer.ts` 97:7 `ConditionalExpression` to `true` (its timed-out test *the colour of a lane > cycles
once the graph is wider than the contract has indices*, the same S12 met) and the two `hash-index.ts` 120:7
mutants S12's FIX-36 section names; the second run's are the two of `hash-index.ts`. No second run of either
clause population starved in either run, and no kill named no failing test, so FIX-36's own population was
empty in both: what item 27 asks, a second run starving on unchanged source, was not met in these two.

**Load.** A sampler of this lane's read the processor load across all processors about every five seconds and
the `node.exe` command lines once a minute, beside both runs; its counts are of the whole machine, this run
included, so they do not apply `AGENTS.md` §11's rule. The first run's refusal was a reading of a clock, and
by these samples the machine was saturated throughout it, so it would not have counted as free. During the first run's mutation step, 535 samples, mean 98.1 %, 521 over 75 %; a mutation run of another
worktree of this project, the review of E03-M01's round 02, in 22 of 44 minute samples, and node processes of
another worktree of this project in 41. During the second's, 382 samples, mean 96.4 %, 362 over 75 %; no other
mutation run in any of 32 minute samples, node processes of another worktree in 8. The sampler counts a process
by a path in its command line, and vitest's and Stryker's workers carry relative ones, so the other-work counts
are a floor.
