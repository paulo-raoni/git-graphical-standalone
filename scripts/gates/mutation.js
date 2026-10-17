import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { remeasure } from './mutation-remeasure.js';
import { repositoryRoot, report } from './tree.js';

/**
 * The mutation gate: StrykerJS, a committed list of the mutants known to survive,
 * and a refusal of any run whose own shape says it cannot have measured the
 * tests.
 *
 * Stryker scores a **timeout as a detection**. That is the right default — a
 * mutant that makes the code loop forever has been detected — and it is what made
 * this gate's failure invisible: the per-mutant timeout budget is derived from the
 * dry run, which has the machine to itself, and spent on per-mutant runs that
 * share it with six others, so almost every one of them ran out of time, every
 * timeout was counted as a kill, and the score read 100.00 with nine of 1131
 * mutants killed by a test. The gate was green for a reason unrelated to what it
 * measures, which `AGENTS.md` §7 says is the one failure a green run cannot be
 * distinguished from working by.
 *
 * So the score is not the only thing read back. Stryker's own JSON report carries
 * `testsCompleted` per mutant — one completed test per mutant whose suite reached
 * an exit status under this runner, and none for a mutant that timed out — and
 * `statusReason`, the runner's whole captured output. Five properties of the
 * report refuse the build on their own:
 *
 * 1. **Every killed and every surviving mutant carries a completed test run.**
 *    Both verdicts are statements about what the tests did, so both need a test
 *    result behind them. This is what catches a runner that returns verdicts
 *    without running anything: `@stryker-mutator/vitest-runner` 10.0.0 against
 *    the pinned `vitest` 5.0.0 reports every mutant as survived with `Ran 0.00
 *    tests per mutant on average`, measured here, and would be refused by this
 *    clause even if its score were not already below the threshold.
 * 2. **Detections resting on a clock are at most a quarter of all detections.**
 *    This is what catches the failure above, which reported `Ran 0.01 tests per
 *    mutant on average` and a 99.2 per cent timeout share at a score of 100.00.
 *    A quarter is a validity bound and not a quality target: four honest full
 *    runs measured below sit between 6.2 and 8.5 per cent, and the four runs that
 *    were green while this gate measured nothing sat at 10, 62, 82 and 99.6.
 * 3. **A killed mutant whose output names a timeout this gate cannot read** is
 *    refused rather than counted as an assertion — see *the two clocks* below.
 * 4. **Killed mutants whose output names no failing test are at most a quarter
 *    of the kills.** A kill under the command runner is only "the suite exited
 *    non-zero", and a suite that exits non-zero without failing a test did not
 *    assert anything about the mutant.
 * 5. **No kill rests on a suite that could not get memory, that died before it
 *    ran a test, or that printed nothing.** Every killed mutant whose output
 *    names no failing test, or says its suite ran out of memory or lost its
 *    worker, is run again alone once Stryker has finished, and is counted by
 *    what that second run says: a failing test or a crash of its own module is
 *    a kill, a pass is a survivor for the survivor clause below, and anything
 *    else refuses the build. Added by E01-M01-FIX-36; the clause, its reasons
 *    and the line it hinges on are in `mutation-remeasure.js` beside this file,
 *    called once, below, before the survivor clause reads the report.
 *
 * No clause is the tests-per-mutant figure itself, because a genuinely
 * non-terminating mutant is a legitimate detection with no test result: 43 of the
 * 1131 mutants of the honest run are loop-control mutations in the store's probing
 * and growth loops and in the UTF-8 decoder, which is why that run prints `Ran
 * 0.96 tests per mutant on average` rather than 1.00 and why a floor on that
 * figure is not one of the clauses. It is printed on every run beside the clock
 * numbers, because what caught both failures late was that nobody had those
 * numbers in one place.
 *
 * A missing or unreadable report is refused for the same reason: a run whose
 * shape cannot be read is not a measurement. The stale report of an earlier run
 * is deleted before Stryker starts, so a crash cannot leave one behind to be
 * checked in place of the run that just failed.
 *
 * ## The command every mutant is measured by
 *
 * Stryker runs under its command runner, so a verdict is the exit status of one
 * command, and the command is the one line `commandRunner.command` of
 * `stryker.config.json`: `node node_modules/vitest/vitest.mjs run --reporter=dot
 * --fsModuleCache --bail=1 --no-cache --no-isolate`. It runs the unit suite
 * `vitest.config.js` includes, once per mutant, its files one at a time, and —
 * since E01-M01-S12 — **without isolating the test files from one another**: with `--no-isolate`
 * the files of one run share a module registry instead of each getting a fresh
 * one. That flag is on the command line and nowhere else, so `gates:unit`, which
 * runs the same suite from the same configuration without it, keeps isolation.
 *
 * **The flag is the line the gate's speed and its equivalence both hinge on.**
 * It was taken only because S12 ran this gate over the configured scope both
 * ways at one commit and compared the two reports mutant by mutant: the
 * measurement, its method and what would undo it are in
 * `docs/plan/E01-commit-graph/M01-first-graph/S12-mutation-without-isolation.md`
 * and are not repeated here. What it rests on is that no test file of the suite
 * depends on module state another file leaves behind; a test or a module that
 * starts keeping such state is the reason to take that measurement again, and
 * removing the flag restores the isolated run with nothing else to change.
 *
 * **Since E01-M01-FIX-36 a run stops at its first failing test, and runs its
 * files in an order that does not move.** Six mutants of this scope ask for
 * more memory than the machine has: five make a column double without end, three
 * in `src/core/parse/reference-list.ts` and two in
 * `src/core/store/pending-parents.ts`, and one in
 * `src/core/layout/segment-buffer.ts` runs a count below zero, after which a
 * page's layout asks for columns far larger than memory. Planted one at a time
 * at FIX-36's base and run alone with the command as it was, the three of
 * `reference-list.ts` took a worker to 8.0 to 9.5 GB of working set, on a
 * machine of 15.6 GB, with free memory under 300 MB, for up to 78 seconds; all
 * six took its commit to between 35.9 and 84.2 GB. Each is now seen by a test
 * that fails after one growth — two added by FIX-36, first in their own files,
 * and for the sixth an existing test of `lane-layout.test.ts`, the first file
 * to run — and `--bail=1` ends the run at that failure: the same six peaked at
 * 113 MB of working set and 197 MB of commit in the largest process of the run,
 * with isolation and without, where the healthy suite measured 110 MB. `--no-cache`
 * is what makes that stop a bound. Without it vitest orders the files by the last
 * run it recorded, in a file under `node_modules/.vite/` that all seven of
 * Stryker's sandboxes share through their link to `node_modules`, so which file
 * failed first, and so how much the run took first, depended on which mutant had
 * finished last. Without the cache the order is the files' sizes, largest first,
 * in every run and both modes. Neither flag can move a verdict to `Survived`: a
 * run that fails no test runs every test, as before. What the first can move is
 * a `Timeout` to `Killed`, when a test fails before the one that hangs. The
 * measurements, and what moved, are in S12's slice document, *Kills that name no
 * failing test*.
 *
 * ## The two clocks, and what the second clause actually counts
 *
 * There are two clocks over every mutant run and only one of them is Stryker's.
 * `stryker.config.json` sets `timeoutMS`, which bounds the whole per-mutant
 * command; `vitest.config.js` sets `testTimeout`, which bounds each test
 * **inside** that command. Both values were chosen by E01-M01-S09, and they and
 * the measurements behind them are recorded in
 * `docs/plan/E01-commit-graph/M01-first-graph/S09-mutation-clocks.md` rather
 * than repeated here, so that there is one copy of each number. Before S09 the
 * inner clock was vitest's own default, which nobody chose, and FIX-10's
 * measurements below were taken under that default. The inner clock is much the
 * shorter of the two, so when a clock fires it is that one: the test fails, the
 * suite exits non-zero, and Stryker records `Killed` rather than `Timeout`.
 *
 * E01-M01-FIX-10 measured the gap on its own full run of the configured scope,
 * unnarrowed, at the commit this lane was cut from: of 1183 mutants, **44 were
 * reported `Timeout`, and a further 38 of the 1136 reported `Killed` carried
 * vitest's own test-timeout message in their recorded output**, those 38 spread
 * over eight files. The clause as first written counted only Stryker's 44 and
 * printed **3.7 per cent**, where the share of detections resting on a clock was
 * 82 of 1180, **6.9 per cent**.
 *
 * Neither number is fixed, and which of them moves is the point. FIX-10 ran this
 * scope four times over identical source and measured `Timeout` at **44, 46, 46,
 * 46** and timeout-shaped kills at **38, 42, 54, 27** — so detections resting on
 * a clock of **82, 88, 100 and 73** out of about 1180, or **6.9, 7.5, 8.5 and
 * 6.2 per cent**, where the old clause's number moved only between 3.7 and 3.9.
 * **Stryker's own count is very nearly constant; the quantity the clause is
 * about varied by a factor of two over those four runs**, because the inner clock
 * fires on whichever tests the machine was too busy to finish while the outer one
 * is reached by almost nothing. The variation is noise about the machine's load
 * and not a trend. That is the defect stated as a measurement: the old clause
 * could not see any of that movement, and would go on reporting 3.8 per cent
 * however much of a run's score became a stopwatch reading.
 *
 * **Why that matters is the direction.** The old number is not merely too small,
 * it is **insensitive**: over those four runs it moved between 3.7 and 3.9 while
 * the quantity it is meant to bound moved between 6.2 and 8.5. A run whose score
 * is largely a stopwatch reading therefore barely moves it — good news printed
 * while the gate gets hollower, which is the failure this whole clause exists to
 * prevent. So the clause counts both, and both numbers are printed separately
 * beside the combined share, so the gap between the two clocks is readable on
 * every run rather than having to be rediscovered. (That mutants also *migrate*
 * out of `Timeout` and into `Killed` as a machine gets busier is the mechanism
 * behind the 99 per cent failure at the top of this file. It is named here as a
 * mechanism and not as something this lane measured: at this load `Timeout` is
 * nearly constant and no migration is visible in these four runs.)
 *
 * **What this counts is detections that rest on a clock, which is the property
 * the cap is about. It is not a count of spurious kills, and it cannot be one.**
 * A mutant that genuinely never terminates is caught by the inner clock exactly
 * as a mutant on a loaded machine is, and the two produce the same message; the
 * report carries nothing that tells them apart. A run at the cap is being told
 * that too much of its score is a stopwatch reading, not that any particular
 * kill was wrong.
 *
 * **The predicate is the line this clause hinges on**, so it is written to fail
 * loudly rather than quietly. `VITEST_CLOCK` is the narrow reading — vitest's own
 * `timed out in <n>ms` — and `CLOCK_WORDS` is the broad one: the word `timeout`
 * and its near spellings (`timeouts`, `time-out`, `time out`, `timed out`,
 * `times out`), as a whole word and in any case. A killed mutant matching the
 * broad reading and not the narrow one **refuses the build** with the output
 * quoted, so a vitest that rewords its message into another of those spellings
 * turns this gate red and readable instead of turning the share back down to
 * Stryker's `Timeout` count alone. **A wording without one of them is not read
 * at all.** Measured by E01-M01-FIX-19 on the report of its own full run, and by
 * E01-M01's sixteenth review round before it: a copy of the report in which one
 * honest kill's recorded output also carries `Error: Test exceeded its time
 * limit of 5000 ms`, beside its `Tests  1 failed`, replays through
 * `--check-report` to **exit 0**, that kill counted as an assertion; the same
 * copy carrying `timeout of 5000 ms` instead replays to exit 1. What bounds the
 * risk is that `vitest` is pinned to an exact version in `package.json`, so a
 * new wording can arrive only with a change to that pin, which is a commit a
 * reviewer reads.
 *
 * **Why a clock word in a test file's comment matters.** A kill's recorded
 * output is not only what vitest says: for a failing assertion it prints a code
 * frame of the test file, the line that failed and two lines either side, as
 * the file spells them, comments included. Measured by E01-M01-FIX-19 on the
 * report of its own full run, at `f5a95df`: 1100 of the 1303 killed mutants'
 * outputs carry at least one frame of a `*.test.ts` file, and all 7414 such
 * frames show exactly two lines before and two after the line they point at.
 * So a comment holding a clock word within two lines of an assertion prints
 * into a kill's output, and the broad reading refuses an honest run for it.
 *
 * Grepped by E01-M01-FIX-19 on 2026-09-27 at `f5a95df`, with `CLOCK_WORDS` itself
 * as the pattern, read out of this file, over every tracked file of `src/`,
 * `test/` and `perf/`: exactly one match, in `test/e2e/open-repository.spec.ts`,
 * a Playwright `{ timeout: 60_000 }` that E01-M01-S06 added. That file belongs to
 * the end-to-end suite, and Stryker does not run it: the per-mutant command runs
 * the suite `vitest.config.js` includes, `src/**` test files only, where the same
 * grep found nothing. At `52b7247`, the commit FIX-19 was cut from, it found
 * three more, all in the doc comment above the page sizes suite of
 * `src/core/page/graph-page.test.ts`, which E01-M01-FIX-16 wrote: inside the
 * suite Stryker runs, and three lines short of the nearest assertion's frame.
 * FIX-19 reworded them. So no test name, assertion message or comment of the
 * suite this gate reads can match the broad reading. Measured for FIX-10: across
 * four full runs — 4540 kills, the first read offline and the other three with
 * this clause live — **none** matched broad without narrow; FIX-19's own run,
 * 1303 kills, found none either.
 *
 * **Lines vitest's worker pool prints about its own workers are not read by the
 * broad reading.** They begin `[vitest-pool]:`, sometimes after `Error: `, and say
 * how a worker started, failed or took to stop — `Timeout terminating forks worker
 * for test files …` among them — which is a statement about the machine and not
 * about any test. Measured by E01-M01-S06 and by E01-M01's fifteenth review round,
 * not by the lane that wrote this paragraph: five full runs of identical source,
 * three refused by this clause on a different mutant each time, and in each
 * refusal the line that matched was such a line, beside a failing test. So
 * `POOL_LINE` removes those lines before `CLOCK_WORDS` is applied, and removes
 * nothing else; the narrow reading, the failing-test counter and the excerpt
 * still read the whole output, and a timeout sentence anywhere else, including
 * the stack or cause printed under a pool error, still refuses. The failing-test
 * counter is deliberately **not** the way out: a reworded test timeout fails its
 * test too, so `Tests 1 failed` is exactly what the case this clause exists for
 * looks like.
 *
 * What the exclusion gives up is a future pool line that does mean a test ran out
 * of time: it would no longer refuse on its own wording. Read from the pinned
 * vitest 5.0.0 by FIX-13, the pool has six such messages, all in one module of
 * its node side; two of them carry a timeout word, and both are the pool's own
 * clocks on starting and on stopping a worker. The per-test clock and its `timed
 * out in <n>ms` live in the test runner, in a different module that runs inside
 * the worker, and a test that crosses it reports through its own failure, not
 * through the pool. A pool line that did one day mean a test ran out of time
 * would still be read by what the rest of the run says: the narrow reading if
 * the test's own message is there, and the no-failure count if nothing failed.
 *
 * ## A kill that names no failing test
 *
 * Under the command runner a kill is an exit status, so the report is also asked
 * whether the suite that produced it actually failed a test: vitest's summary
 * counter is the evidence, and `FAILING_TESTS` reads it. The count is printed on
 * every run and the mutants are named when there are few.
 *
 * It is **not** a flat refusal, because a mutant that breaks the module on import
 * exits non-zero with no failing test and is a genuine detection: refusing it
 * would fail a correct run, and `AGENTS.md` §11 calls a gate that flaps a defect
 * of the gate. It is a cap of the same shape and the same number as the clock cap
 * beside it, and the number is argued rather than picked. FIX-10 measured **zero**
 * on each of four full runs, over 4540 kills in all, so a cap of zero would flap
 * on the first legitimate crash-kill and is not available. A quarter
 * is above any legitimate population of crash-kills this scope can produce, by
 * the same arithmetic the survivor clause uses below: the largest single file in
 * scope, `src/core/layout/lane-layout.ts`, carries **140** mutants — counted on
 * that run, where the report holds 1183 mutants and 1136 kills — so even if
 * *every* mutant of the largest file in the project crashed the suite on import,
 * the share would be 12.3 per cent, half the cap. What the cap catches is the
 * collapse: a suite exiting non-zero for every mutant for a reason that is not
 * the mutant, which would otherwise score 100 with nothing asserted. It does not
 * pretend to catch a handful, and the printed count is what makes a handful
 * visible — that being the lesson of the number nobody read for four rounds.
 *
 * A handful was then measured, by E01-M01-S12 and by review round 21: suites
 * that could not get memory, or died before they ran a test, counted as kills
 * at a few in a thousand while the cap passed them. Since E01-M01-FIX-36 the
 * fifth clause re-measures every one of them, and this cap stays what it was, a
 * validity bound over Stryker's own report, at the same number.
 *
 * ## Watching the clauses fail without paying for a run
 *
 * Every clause above is only observable at the end of a run that costs most of an
 * hour, which is why two of them had never been watched failing on anything but
 * the accident that revealed them, and `AGENTS.md` §7 says a gate is not evidence
 * until it has been watched failing. So `--check-report=<path>` **replays** the
 * clauses over a report that already exists and does not run Stryker at all. It
 * is a diagnostic and not a gate: it says so on its first line, it names the
 * report it was handed, and every line it prints — the final verdict included —
 * carries the label `mutation-replay` rather than `mutation`, so a pasted
 * transcript of it cannot be read as a green mutation gate. `npm run gates:mutation`
 * passes no such flag and is unchanged.
 *
 * ## Beside the four shape clauses: a committed survivor baseline
 *
 * Stryker's own `break` threshold compares **one global score**, and at this
 * project's size that number cannot fail for anything smaller than a collapse.
 * The arithmetic, over the 1195 mutants this scope produced when the clause was
 * written: a score under 85 needs `(1195 − S) / 1195 < 0.85`, so **180
 * survivors**, and the largest single file in scope carries **140 mutants**.
 * Deleting the tests of the largest file in the project therefore reads 88.28 and
 * **passes**. Measured rather than argued, in the lane that wrote this clause:
 * reducing one module's tests to a single assertion-free test took that module's
 * own line to 66.20 with 24 survivors and left the whole run at 97.32, which
 * `break` passes. `break` is kept, because it is Stryker's own message and
 * it catches the collapse that this list would report as hundreds of lines, but
 * it is a backstop and not the ratchet `AGENTS.md` §11 asks for.
 *
 * So the ratchet is `mutation-survivors.json`: every mutant known to survive,
 * named exactly, each with the reason it survives. **A survivor that is not on
 * that list fails the build**, whatever the score, which is what catches the
 * first new survivor in a file of any size.
 *
 * The comparison is the whole of the guarantee, so it is exact: an entry matches
 * a mutant on **file, line, column, mutator and replacement**, all five. Four of
 * them are not enough — Stryker emits two `ConditionalExpression` mutants at the
 * same line and column of an `if`, one replacing the condition with `true` and
 * one with `false`, so an entry that named only the position would excuse both
 * when only one survives. The cost of exactness is that an edit **above** a
 * listed line moves it, and the entry then names no mutant at all; that is the
 * case the second half of the clause reports, and it says so rather than passing
 * quietly.
 *
 * All five are still not a **unique** key, and the gate does not pretend they
 * are: measured on the recorded run, 12 of 1195 mutants share all five with
 * another, every one of them a `ConditionalExpression` Stryker emits twice where
 * a compound condition is mutated once whole and once in part. None of the 12 is
 * on the list and every group of them was killed outright, but the clause counts
 * mutants rather than identities so that the survivors it reports and the
 * survivors Stryker reports are the same number, and it says how many mutants an
 * identity covered when that is more than one. Stryker's own mutant `id` would
 * be unique and is not used: it is positional, so it would move under any edit
 * anywhere in the file, which is the flapping this identity is chosen to avoid.
 *
 * What the clause does **not** do is fail when a listed mutant comes back
 * detected, because that verdict is not deterministic. Under the command runner
 * a mutant counts as detected whenever the suite exits non-zero, for any reason,
 * and seven suites share the machine. Measured over three full runs of identical
 * unmodified source, recorded in
 * `docs/plan/E01-commit-graph/M01-first-graph/S02-gates-and-store.md`: two agree
 * on eight survivors and differ in two verdicts, and the third reports seven,
 * because a mutant this file's own list records as **equivalent** came back
 * `Killed`. A clause that refused a detected entry would have failed that run,
 * on an unmodified tree with a correct list, and `AGENTS.md` §11 says a gate
 * that flaps is a defect of the gate. It is reported instead, with what to do: an
 * entry whose mutant a test now kills is removed in the commit that wrote the
 * test, which is the list shrinking, which is the direction §11 allows it to move
 * without an argument. The note carries an **excerpt** of that mutant's recorded
 * output, so a reader can tell a failed assertion from a suite that fell over
 * without paying for a second run.
 *
 * Entries for files this run did not mutate are **out of consideration** rather
 * than missing, so narrowing `--mutate` for speed removes entries from the
 * question instead of diluting a percentage, and the count of them is printed.
 */

/** Stryker's own entry point, run as a child so its output reaches the terminal. */
const STRYKER = join(repositoryRoot, 'node_modules/@stryker-mutator/core/bin/stryker.js');

/** The gate's configuration, read for the one path this script and Stryker share. */
const CONFIG = join(repositoryRoot, 'stryker.config.json');

/** The committed survivor baseline, beside this script with the other gate data. */
const SURVIVORS = join(dirname(fileURLToPath(import.meta.url)), 'mutation-survivors.json');

/** The same file as a reader sees it, for the messages that tell one what to edit. */
const SURVIVORS_NAME = 'scripts/gates/mutation-survivors.json';

/** Where Stryker's json reporter writes, when the configuration does not say. */
const DEFAULT_REPORT = join('reports', 'mutation', 'mutation.json');

/** Replay the clauses over a report that already exists: `--check-report=<path>`. */
const REPLAY_FLAG = '--check-report';

/**
 * The cap on the share of detections that rest on a clock rather than on an
 * assertion. A validity bound rather than a baseline: the four runs that reported
 * 100.00 while this gate measured nothing sat at 10, 62, 82 and 99.6 per cent,
 * and four honest runs of E01-M01-FIX-10 measured between 6.2 and 8.5. The number
 * did not move when FIX-10 corrected what is counted, and moving it is not the
 * answer to a run that fails it.
 */
const CLOCK_SHARE_CAP = 0.25;

/** The cap on the share of kills whose output names no failing test. Argued above. */
const NO_FAILURE_SHARE_CAP = 0.25;

/** Beyond this many, a list of mutants is a count rather than a list. */
const NAMED_AT_MOST = 12;

/** Every mutant status the report schema defines, so an unknown one is visible. */
const STATUSES =
  'Killed Timeout Survived NoCoverage RuntimeError CompileError Ignored Pending'.split(' ');

/** Vitest's own test timeout, the inner clock: the narrow reading of a stopwatch. */
const VITEST_CLOCK = /\b(?:test|hook) timed out in \d+ ?ms\b/i;

/**
 * The broad reading: `timeout` and its near spellings as a whole word, in any
 * case. Not every wording that says a run ran out of time — `time limit` is
 * not read — as the header measures. See the header.
 */
const CLOCK_WORDS = /\btime[ds]?[ -]?outs?\b/i;

/**
 * A line vitest's worker pool prints about its own workers, never about a test:
 * `[vitest-pool]:` at the start, sometimes after `Error: `. Removed from what the
 * broad reading reads, and from nothing else. See the header.
 */
const POOL_LINE = /^[^\S\r\n]*(?:Error: )?\[vitest-pool\]:.*$/gm;

/** Vitest's summary counter, which is where a run says a test actually failed. */
const FAILING_TESTS = /^\s*Tests\s+\d+ failed\b/m;

/** The lines of a captured run that say what happened, for the excerpt below. */
const OUTCOME_LINE = /^(?:Test Files|Tests|Errors)\s|\bFAIL\b|Error:|timed out in \d+ ?ms/i;

/** How much of a thousands-of-lines capture the excerpt shows, and how wide. */
const EXCERPT_LINES = 6;
const EXCERPT_WIDTH = 160;

/** The report a replay was handed, or `null` when this is the gate itself. */
function replayPathOf(argv) {
  const at = argv.findIndex((one) => one.startsWith(REPLAY_FLAG));
  const tail = at < 0 ? '' : argv[at].slice(REPLAY_FLAG.length + 1) || (argv[at + 1] ?? '');
  return at < 0 ? null : resolve(repositoryRoot, tail);
}

/** The json report's path, from the configuration Stryker itself reads. */
function reportPath() {
  const options = JSON.parse(readFileSync(CONFIG, 'utf8'));
  return join(repositoryRoot, options.jsonReporter?.fileName ?? DEFAULT_REPORT);
}

/** Stryker, with whatever extra arguments the caller passed through. */
function runStryker(argv) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [STRYKER, 'run', ...argv], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolveRun(signal === null ? (code ?? 1) : 1);
    });
  });
}

/** A report key as a reader's path: repository-relative, with `/` separators. */
function fileNameOf(key) {
  return (isAbsolute(key) ? relative(repositoryRoot, key) : key).split('\\').join('/');
}

/** One mutant named the way the clear-text reporter names it, plus its replacement. */
function nameOf(file, line, column, mutator, replacement) {
  return `${file}:${String(line)}:${String(column)} ${mutator} (to ${JSON.stringify(replacement ?? null)})`;
}

/**
 * What a killed mutant's recorded output says the kill rests on.
 *
 * `clock` and `unreadable` are the narrow and broad readings of the header's
 * predicate and are deliberately exclusive: a kill the narrow reading recognises
 * is counted, and one only the broad reading recognises refuses the build. The
 * broad reading skips the worker pool's own lines, and that skip is the line the
 * refusal's honesty hinges on in both directions: widen `POOL_LINE` and a
 * reworded test timeout passes as an assertion, drop it and a worker that was
 * slow to stop refuses a correct run.
 */
const READINGS = {
  clock: (reason) => VITEST_CLOCK.test(reason),
  unreadable: (reason) =>
    !VITEST_CLOCK.test(reason) && CLOCK_WORDS.test(reason.replace(POOL_LINE, '')),
  noFailure: (reason) => !FAILING_TESTS.test(reason),
};

/** One killed mutant, read into the three lists above by its recorded output. */
function readKill(mutant, file, kills) {
  const reason = String(mutant.statusReason ?? '');
  const { line, column } = mutant.location.start;
  const where = nameOf(file, line, column, mutant.mutatorName, mutant.replacement);
  for (const [reading, holds] of Object.entries(READINGS)) {
    if (holds(reason)) kills[reading].push(where);
  }
}

/** Mutants by status, the completed test runs behind them, and what the kills rest on. */
function tally(files) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  const unknown = new Set();
  const kills = { clock: [], unreadable: [], noFailure: [] };
  let testsCompleted = 0;
  for (const [key, file] of Object.entries(files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (counts[mutant.status] === undefined) {
        unknown.add(String(mutant.status));
        continue;
      }
      counts[mutant.status] += 1;
      testsCompleted += mutant.testsCompleted ?? 0;
      if (mutant.status === 'Killed') readKill(mutant, fileNameOf(key), kills);
    }
  }
  return { counts, testsCompleted, kills, unknown: [...unknown] };
}

/**
 * The same arithmetic `mutation-testing-metrics` does, spelled out here so that
 * the numbers this gate prints are the numbers Stryker printed and not a second
 * set: detected is killed plus timeout, valid excludes the errors, and the
 * denominator of tests per mutant is every mutant in the report. `onAClock` is
 * the one number that is not Stryker's, and it is a **subset** of two of them —
 * every `Timeout` plus the named part of `Killed` — never a restatement of
 * either.
 *
 * A report with mutants but no **valid** one — every mutant an error — would
 * score `NaN` and pass the clauses below. It is left unguarded because it
 * cannot be reached: mutation testing does not start unless the dry run
 * succeeded, and the only way this runner reports an error is a failure to start
 * a process, which would have failed the dry run first.
 */
function metricsOf({ counts, testsCompleted, kills }) {
  const detected = counts.Killed + counts.Timeout;
  const valid = detected + counts.Survived + counts.NoCoverage;
  const invalid = counts.RuntimeError + counts.CompileError;
  const total = valid + invalid + counts.Ignored + counts.Pending;
  const onAClock = counts.Timeout + kills.clock.length;
  return {
    counts,
    kills,
    detected,
    valid,
    invalid,
    total,
    testsCompleted,
    onAClock,
    score: valid > 0 ? (detected / valid) * 100 : Number.NaN,
    clockShare: detected > 0 ? onAClock / detected : 0,
    noFailureShare: counts.Killed > 0 ? kills.noFailure.length / counts.Killed : 0,
    testsPerMutant: total > 0 ? testsCompleted / total : Number.NaN,
  };
}

/** A list of mutants when it is short enough to read, and nothing when it is not. */
function namedOrCounted(mutants) {
  return mutants.length === 0 || mutants.length > NAMED_AT_MOST ? '' : ` — ${mutants.join('; ')}`;
}

/** The shape of the run, printed whether it passes or fails. */
function describe(metrics, provenance) {
  const { counts, kills } = metrics;
  const lines = [
    `${LABEL}: ${String(metrics.total)} mutants — ${String(counts.Killed)} killed, ${String(counts.Timeout)} timeout, ${String(counts.Survived)} survived, ${String(counts.NoCoverage)} no coverage, ${String(metrics.invalid)} errored, ${String(counts.Ignored)} ignored, ${String(counts.Pending)} pending\n`,
    `${LABEL}: score ${metrics.score.toFixed(2)} over ${String(metrics.valid)} valid mutants, ${metrics.testsPerMutant.toFixed(2)} tests per mutant, ${provenance}\n`,
    `${LABEL}: detections resting on a clock — ${String(counts.Timeout)} stryker reports Timeout, plus ${String(kills.clock.length)} of the ${String(counts.Killed)} it reports Killed whose recorded output carries vitest's own test timeout; ${String(metrics.onAClock)} of ${String(metrics.detected)} detections, ${(metrics.clockShare * 100).toFixed(1)}% against a cap of ${(CLOCK_SHARE_CAP * 100).toFixed(0)}%\n`,
    `${LABEL}: ${String(kills.noFailure.length)} of the ${String(counts.Killed)} killed mutants' recorded output names no failing test (${(metrics.noFailureShare * 100).toFixed(1)}%, cap ${(NO_FAILURE_SHARE_CAP * 100).toFixed(0)}%)${namedOrCounted(kills.noFailure)}\n`,
  ];
  process.stdout.write(lines.join(''));
}

/** What the run's shape refuses, if anything. */
function shapeFindings(metrics, unknown) {
  const found = [];
  for (const status of unknown) {
    found.push(`the report holds a mutant status this gate does not count: ${status}`);
  }
  if (metrics.total === 0) {
    found.push('the report holds no mutants, so nothing was measured');
    return found;
  }
  const verdicts = metrics.counts.Killed + metrics.counts.Survived;
  const noTestRun = `${String(verdicts - metrics.testsCompleted)} of the ${String(verdicts)} mutants reported as killed or survived carry no completed test run: both verdicts are statements about what the tests did, and this runner reports one completed test per mutant whose suite reached an exit status, so ${String(metrics.testsCompleted)} test runs cannot account for them`;
  const unreadable = `${String(metrics.kills.unreadable.length)} killed mutants' recorded output says a run ran out of time in a wording this gate cannot read${namedOrCounted(metrics.kills.unreadable)}: the clock clause counts vitest's own \`timed out in <n>ms\` and nothing else, so an output that means a timeout and does not say it that way would otherwise be counted as an assertion and make the share smaller. That is a wrong answer in the direction that reads as good news, so it refuses instead. Read the mutants named above, then widen VITEST_CLOCK in scripts/gates/mutation.js to the wording they use`;
  const onAClock = `${String(metrics.onAClock)} of ${String(metrics.detected)} detections rest on a clock rather than on an assertion (${(metrics.clockShare * 100).toFixed(1)}%, cap ${(CLOCK_SHARE_CAP * 100).toFixed(0)}%): ${String(metrics.counts.Timeout)} stryker reports Timeout and ${String(metrics.kills.clock.length)} it reports Killed because vitest's own test timeout fired inside the run. Stryker scores a timeout as a detection, so a score built out of them says how long the runs took and not what the tests assert. This does not say those kills were wrong — a mutant that never terminates is caught by the same clock and the report cannot tell the two apart — it says that too much of this score is a stopwatch reading`;
  const noFailure = `${String(metrics.kills.noFailure.length)} of the ${String(metrics.counts.Killed)} killed mutants' recorded output names no failing test (${(metrics.noFailureShare * 100).toFixed(1)}%, cap ${(NO_FAILURE_SHARE_CAP * 100).toFixed(0)}%)${namedOrCounted(metrics.kills.noFailure)}: a kill under the command runner is only "the suite exited non-zero", and a suite that exits non-zero without failing a test has asserted nothing about the mutant. A few are genuine — a mutant that breaks its module on import is detected by crashing the suite — which is why this is a cap and not a refusal; a quarter of them is the suite failing for a reason that is not the mutant`;
  if (metrics.testsCompleted < verdicts) found.push(noTestRun);
  if (metrics.kills.unreadable.length > 0) found.push(unreadable);
  if (metrics.clockShare > CLOCK_SHARE_CAP) found.push(onAClock);
  if (metrics.noFailureShare > NO_FAILURE_SHARE_CAP) found.push(noFailure);
  return found;
}

/**
 * **The line this gate's guarantee hinges on.** An entry of the baseline stands
 * for exactly one mutant, and this is what "the same mutant" means: the same
 * file, the same start line and column, the same mutator and the same
 * replacement. Loosen any of the five and one entry starts excusing mutants
 * nobody wrote it for, which is an allow-list turning into a blanket; the
 * position alone already covers two mutants wherever Stryker replaces a
 * condition with both `true` and `false`.
 */
function identityOf(file, line, column, mutator, replacement) {
  return JSON.stringify([file, line, column, mutator, replacement ?? null]);
}

/** The committed list, by identity, with the entry kept for its message. */
function readSurvivors() {
  const listed = new Map();
  for (const entry of JSON.parse(readFileSync(SURVIVORS, 'utf8')).survivors) {
    const key = identityOf(entry.file, entry.line, entry.column, entry.mutator, entry.replacement);
    listed.set(key, entry);
  }
  return listed;
}

/**
 * The run by identity, with the files it covered.
 *
 * An identity can cover more than one mutant, which is why a group is counted
 * rather than overwritten: measured on the recorded run, 12 of 1195 mutants
 * share a file, line, column, mutator **and** replacement with another, all of
 * them Stryker's `ConditionalExpression` emitted twice where a compound
 * condition is mutated once whole and once in part. Every such group was killed
 * outright and none is on the list, but counting them keeps the number this gate
 * prints equal to the number Stryker printed three lines above it, which is the
 * property whose absence let four green runs measure nothing.
 *
 * The group also keeps one recorded output, taken from a mutant of it that was
 * detected, because that is the one the note below quotes and a survivor's
 * output says only that the suite passed.
 */
function indexRun(files) {
  const mutated = new Set();
  const produced = new Map();
  for (const [key, file] of Object.entries(files ?? {})) {
    const name = fileNameOf(key);
    mutated.add(name);
    for (const mutant of file.mutants ?? []) {
      const { line, column } = mutant.location.start;
      const identity = identityOf(name, line, column, mutant.mutatorName, mutant.replacement);
      const group = produced.get(identity) ?? {
        file: name,
        line,
        column,
        mutator: mutant.mutatorName,
        replacement: mutant.replacement ?? null,
        survived: 0,
        reason: '',
        statuses: new Set(),
      };
      group.statuses.add(mutant.status);
      if (mutant.status === 'Survived') group.survived += 1;
      else group.reason = String(mutant.statusReason ?? '');
      produced.set(identity, group);
    }
  }
  return { mutated, produced };
}

/** The refusal: a mutant survived and the committed list does not name it. */
function unlistedFindings(produced, listed) {
  const found = [];
  const unlisted = [];
  let survivors = 0;
  for (const [identity, group] of produced) {
    if (group.survived === 0 || listed.has(identity)) {
      continue;
    }
    survivors += group.survived;
    unlisted.push(group);
    const name = nameOf(group.file, group.line, group.column, group.mutator, group.replacement);
    const shared = ` survived in ${String(group.survived)} mutants that share this position, mutator and replacement`;
    const what = group.survived === 1 ? `${name} survived` : `${name}${shared}`;
    found.push(
      `${what} and is not in ${SURVIVORS_NAME}: either the test that would kill it has not been written, which is the test to write, or no behavioural test can kill it, which is an entry to add with the reason — and adding one is a commit a reviewer reads (AGENTS.md section 11)`,
    );
  }
  return { found, unlisted, survivors };
}

/** The message for an entry that names no mutant, and whether a line moved under it. */
function staleMessage(entry, unlisted) {
  const name = nameOf(entry.file, entry.line, entry.column, entry.mutator, entry.replacement);
  const replacement = entry.replacement ?? null;
  const moved = unlisted.find(
    (one) =>
      one.file === entry.file && one.mutator === entry.mutator && one.replacement === replacement,
  );
  return (
    `${SURVIVORS_NAME} lists ${name}, and this run mutated that file and produced no such mutant: the entry names nothing, so it protects nothing and nobody is checking it` +
    (moved === undefined
      ? '. Re-record it against a run, or remove it'
      : `. The same mutator and replacement survives at ${String(moved.line)}:${String(moved.column)} of that file, which is what a line that moved looks like: correct this entry rather than adding a second one`)
  );
}

/**
 * An excerpt of a mutant's recorded output, which is the whole vitest run.
 *
 * The lines chosen are the ones that name a verdict — vitest's `Test Files` and
 * `Tests` counters, a `FAIL` header, anything carrying `Error:`, and vitest's own
 * test timeout — and of those, the last few, because the counters come last. The
 * bound is stated in the line that introduces the excerpt so that a reader knows
 * what was left out rather than guessing.
 */
function excerptOf(reason) {
  const lines = String(reason)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => OUTCOME_LINE.test(line))
    .slice(-EXCERPT_LINES);
  if (lines.length === 0) lines.push('(no line of its recorded output names a verdict)');
  return lines.map((line) => `${LABEL}:     ${line.slice(0, EXCERPT_WIDTH)}\n`).join('');
}

/** The line printed for an entry whose mutant this run detected rather than left alive. */
function detectedNote(entry, group) {
  const status = [...group.statuses].join(' and ');
  return (
    `${LABEL}: ${nameOf(entry.file, entry.line, entry.column, entry.mutator, entry.replacement)} is on the list and this run reports it ${status}. If a test now kills it, drop the entry from ${SURVIVORS_NAME} in the commit that wrote that test: a shrinking list is the direction AGENTS.md section 11 lets a baseline move on its own. This does not refuse the build, because the verdict is not deterministic — the command runner counts any non-zero exit of the suite as a detection, and runs of identical source have been measured disagreeing about a mutant, in the mutation section of docs/plan/E01-commit-graph/M01-first-graph/S02-gates-and-store.md\n` +
    `${LABEL}:   an excerpt of the runner's captured output for it, which is a whole vitest run: the last ${String(EXCERPT_LINES)} lines of it that name a verdict — the Test Files and Tests counters, a FAIL header, an Error: line, or vitest's own test timeout — each cut at ${String(EXCERPT_WIDTH)} characters\n` +
    excerptOf(group.reason)
  );
}

/**
 * The list against the run: every entry the run did not leave alive.
 *
 * The split is the one the header argues. An entry that matches no mutant at all
 * is a fact about the source, which is deterministic, so it refuses. An entry
 * whose mutant came back detected is a fact about one run under seven concurrent
 * workers, which is not, so it is printed instead. An entry in a file this run
 * did not mutate is out of consideration, which is what makes narrowing
 * `--mutate` safe.
 */
function staleFindings(listed, { mutated, produced }, unlisted) {
  const found = [];
  const notes = [];
  const counts = { matched: 0, detected: 0, outOfScope: 0 };
  for (const [identity, entry] of listed) {
    if (!mutated.has(entry.file)) {
      counts.outOfScope += 1;
      continue;
    }
    const group = produced.get(identity);
    if (group === undefined) {
      found.push(staleMessage(entry, unlisted));
      continue;
    }
    counts.matched += 1;
    if (group.survived === 0) {
      counts.detected += 1;
      notes.push(detectedNote(entry, group));
    }
  }
  return { found, notes, counts };
}

/** The run against the committed list: what it refuses, and what it merely reports. */
function survivorFindings(files, listed) {
  const run = indexRun(files);
  const unlisted = unlistedFindings(run.produced, listed);
  const stale = staleFindings(listed, run, unlisted.unlisted);
  const { matched, detected, outOfScope } = stale.counts;
  return {
    found: [...unlisted.found, ...stale.found],
    notes: [
      `${LABEL}: survivor baseline — ${String(listed.size)} entries; matched a mutant of this run ${String(matched)}, of those detected rather than left alive ${String(detected)}; in a file this run did not mutate ${String(outOfScope)}; survivors of this run not on the list ${String(unlisted.survivors)}\n`,
      ...stale.notes,
    ],
  };
}

const started = Date.now();
const replay = replayPathOf(process.argv.slice(2));

/** What every line of this transcript is labelled with. The two are never the same. */
const LABEL = replay === null ? 'mutation' : 'mutation-replay';

const json = replay ?? reportPath();
const inTree = fileNameOf(json);
const shownPath = inTree.startsWith('..') ? json : inTree;

if (replay === null) {
  rmSync(json, { force: true });
} else {
  process.stdout.write(
    `${LABEL}: stryker did NOT run. This replays the gate's clauses over ${shownPath}, which is whatever the caller handed it and may have been doctored, and it reports under the label ${LABEL} for that reason: it is a diagnostic, it is not the mutation gate, and a transcript of it is not evidence that npm run gates:mutation passed\n`,
  );
}

const status = replay === null ? await runStryker(process.argv.slice(2)) : 0;
const elapsed = Date.now() - started;
const provenance =
  replay === null ? `${(elapsed / 1000).toFixed(1)} seconds` : `report read from ${shownPath}`;
const findings = [];

if (existsSync(json)) {
  const { files } = JSON.parse(readFileSync(json, 'utf8'));
  const counted = tally(files);
  const metrics = metricsOf(counted);
  describe(metrics, provenance);
  findings.push(...shapeFindings(metrics, counted.unknown));
  const against = survivorFindings(await remeasure(files, LABEL, findings), readSurvivors());
  for (const note of against.notes) {
    process.stdout.write(note);
  }
  findings.push(...against.found);
} else if (replay === null) {
  findings.push(
    `stryker wrote no report to ${shownPath}, so the shape of the run cannot be read, and a run whose shape cannot be read is not a measurement`,
  );
} else {
  findings.push(`there is no report at ${shownPath} to replay the clauses over`);
}

if (status !== 0) {
  findings.push(`stryker exited with status ${String(status)}`);
}

report(LABEL, findings);
