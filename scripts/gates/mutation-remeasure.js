import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { plainOutput } from './mutation-output.js';
import { GENERATED, repositoryRoot, walkFiles } from './tree.js';

/**
 * Re-exported for `mutation.js`, which reads the report through `plainFiles`
 * before any clause does and quotes a recorded output through `excerptOf`, and
 * is near its module's line limit, so it imports from this module alone.
 */
export { excerptOf, plainFiles } from './mutation-output.js';

/**
 * The mutation gate's fifth clause: **no kill rests on a suite that could not get
 * memory, that died before it ran a test, that printed nothing, or on vitest's own
 * per-test clock alone.** The last of the four was added by E03-M01-S06, and
 * *Kills resting on vitest's clock* below is its argument.
 *
 * Under Stryker's command runner a mutant is `Killed` when one run of the unit
 * suite exits non-zero, for any reason. The gate's fourth clause caps the share
 * of kills whose output names no failing test at a quarter, which catches a
 * collapse and cannot see a handful, and a handful is what this machine makes.
 * E01-M01-S12 recorded five such kills in two of its seven runs without
 * isolation, and review round 21 one more at `021fba6`, as S12's slice document
 * and E01-M01-FIX-36's task record them; FIX-36 reproduced neither. Their outputs
 * held a vitest worker that exited with the commit limit's status, a
 * `VirtualAlloc failed`, node's own `Out of memory`, nothing at all, and a
 * worker that died before any test file was loaded. Of S12's five outputs,
 * two say in words that the suite could not get memory, a third ends on a
 * worker's exit status, and two are empty, as S12's document lists them; that a mutant
 * running beside them had taken it is S12's inference, labelled as one in its
 * document, since the report records no times. Review round 21's had some 2.4 GB free and a cause nobody
 * established. In every case the suite never ran a test, and in every case the
 * gate counted a detection. A mutant that **survives** the tests and
 * meets such a moment is reported killed, and the gate stays green.
 *
 * So every such kill is measured again, here, **alone and after the run**, when
 * the seven workers are gone, by the very command Stryker ran it with
 * (`commandRunner.command` of `stryker.config.json`) and under the outer clock
 * Stryker itself gave it (*The outer clock* below), over a copy of the tree
 * with that one mutant planted. A kill is chosen for it when its recorded output names no failing
 * test, or says its suite ran out of memory or lost its worker, or carries
 * vitest's own test timeout, in each of the last two cases whether or not a test
 * failed beside it: a test that failed because the suite could not get memory,
 * or because the machine was too busy for it to finish inside the clock, is no
 * statement about the mutant either. What the second run says is the verdict:
 *
 * - **vitest's own test timeout again**, alone, with no sign of starving, or,
 *   for a kill chosen for the clock alone, **past the outer clock**: killed, by
 *   a test the mutant itself keeps from finishing, which is a detection on a
 *   clock exactly as Stryker's `Timeout` is;
 * - **a failing test**, with no sign of starving: killed, as Stryker said; and
 *   so is a failing test whose only sign of starving is V8 refusing a buffer
 *   the mutated file itself asked for, which *A mutant's own refused
 *   allocation* below argues;
 * - **a failed test file and an error that names the mutated file**, with no
 *   failing test and no sign of starving: killed, by its own module breaking on
 *   import, which is the one legitimate kill that names no failing test;
 * - **exit status 0**: it survives the tests, and it goes to the survivor clause
 *   as a survivor, so an unlisted one refuses the build exactly as it would have
 *   if the run had measured it;
 * - **anything else** — starved again, no test and no crash of its own module,
 *   nothing printed, or past the outer clock for a kill chosen for anything but
 *   the clock — refuses the build, naming the mutant, because neither run says
 *   anything about it.
 *
 * The fourth clause is not replaced and its number does not move: it is a
 * validity bound over Stryker's own report, read before this clause and over
 * the kills as Stryker recorded them. A run with more kills to re-measure than
 * `REMEASURED_AT_MOST` is refused without re-measuring any, and re-measuring
 * hundreds would be a second mutation run in the place of a refusal. Before S06
 * the most this project had recorded in one run was three, S12's; with the kills
 * on vitest's clock counted too it is five, in E03-M01-S03's run with a probe
 * planted, three on the clock and two naming no failing test, as S03's slice
 * document records them (S06 did not reproduce that run). The number did not
 * move when S06 widened what it counts.
 *
 * ## Kills resting on vitest's clock
 *
 * A kill whose output carries vitest's `timed out in <n>ms` also carries a
 * failing test, because the test that ran out of time fails, so until S06 this
 * clause never chose one. The gate's clock clause counts such kills, beside
 * Stryker's `Timeout`, against a cap of a quarter of all detections, and that cap
 * is the same kind of bound as the fourth clause's: it catches a collapse and
 * cannot see a handful. A handful is what the recorded runs hold since S09 set
 * the inner clock at 15 000 ms: 0 in S09's own, 2 in two of S12's runs and in
 * both of FIX-36's runs at its head, and 3, 3 and 2 in S03's, as those lanes'
 * slice documents record them. A healthy test that crosses that clock because
 * the machine is too busy fails, the suite exits non-zero, and a mutant no test
 * kills is reported killed: the case this clause exists for, by another cause.
 * Two of S12's were that shape in part, a test of another file slowed past the
 * clock by a mutant and seven copies of it, with an assertion failing beside it.
 *
 * So these are chosen too, whether or not an assertion failed beside the
 * timeout, and run again alone, where the clock means something: S09 measured
 * the slowest healthy test of this suite at 0.40 s alone and 1.92 s under a
 * deliberately tripled load. A test that runs out of the clock again alone is
 * kept from finishing by the mutant, which is a detection resting on a clock,
 * exactly what Stryker's `Timeout` is; it stays a kill and the clock clause goes
 * on counting it, since that clause reads the report as Stryker wrote it. What
 * the clock clause does not do, and this one now does, is run such a kill again.
 *
 * **A kill chosen for the clock alone that runs past the outer clock alone is a
 * kill too**, and a kill chosen for any other reason that does so still refuses.
 * The first form of S06's change refused it, and S06's first full run at its
 * head, at `663d720`, was refused for it: `hash-index.ts` 120:7
 * `ConditionalExpression` to `true`, whose recorded output was one test of
 * `commit-store.test.ts` timing out on vitest's 15 000 ms clock and nothing
 * else, ran alone for the whole of `timeoutMS`, 120 000 ms, without ending,
 * while a review's mutation run of this project held the machine. Replayed
 * minutes later over the same report, the same mutant alone failed a test. So
 * it is a mutant that makes that test slow, slow enough to cross either clock
 * on a busy machine: at FIX-36's base Stryker reported it `Timeout`, as S12's
 * document records, and the gate has always counted a `Timeout` as a detection.
 * A mutant the tests do not kill has no such reason to be slow: S09 measured
 * the healthy suite's worst run at 77.6 s under a deliberately tripled load,
 * beside six other copies. Refusing it would turn the gate red on unchanged
 * source for a mutant the tests detect. A kill whose output named no failing
 * test or said its suite starved is not given the same reading, because nothing
 * in its first run says a clock was involved.
 *
 * **The line this clause hinges on is `chosen`**, the predicate that picks the
 * kills to re-measure. Narrow it and a starved kill, or one that rests on the
 * clock alone, is counted again; widen it and every honest kill is run twice.
 * Its clock half is the gate's own narrow reading, `VITEST_CLOCK`, which
 * `mutation.js` hands to `remeasure` rather than this file keeping a copy, so
 * that widening the reading there widens what is chosen here. `STARVED` is its
 * broad half and is read over the whole output, test frames included. Grepped by
 * E03-M01-S06 at its base, `7294f0f`, with `STARVED`'s phrases over every tracked
 * file: none in `src/`, `test/` or `perf/`, the folders whose files a test run
 * prints code frames of, which is what keeps an honest kill's code frame from
 * matching it; four lines of `scripts/gates/`, three of them in this file and one
 * in `mutation.js`, whose frames no run of the unit suite prints. Grepped again
 * by E04-M01-FIX-04 at its head, with the same phrases over `src/`, `test/`,
 * `perf/` and `scripts/`: none in `src/` or `perf/`; in `test/` only
 * `test/gates/fixtures/remeasure-report.json`, which the checks read as data,
 * never a module whose lines a stack frame can show; in `scripts/` this file
 * alone.
 *
 * ## A mutant's own refused allocation
 *
 * **A second run that fails a test, and whose only sign of starving is V8
 * refusing a buffer the mutated file itself asked for, is a kill.** Until
 * E04-M01-FIX-04 it was read "could not get memory again" and refused the build,
 * because `STARVED` matches `allocation failed` and was tested first; and the gate
 * went red on an unchanged product in E04-M01-S07's and S08's lanes, both times on
 * `hash-index.ts` 120:7 run again alone beside another lane's mutation run.
 *
 * Both mutants of that line, `ConditionalExpression` to `true` and
 * `EqualityOperator` to `<=`, make the index rehash at almost every insert, so its
 * table doubles at almost every insert. The suite's files run one at a time,
 * `commit-store.test.ts` before `hash-index.test.ts`, and `--bail=1` stops the run
 * at the first failure, which is always the store's 200-insert test of its work
 * counter. What that test fails with depends on how much memory one process can
 * get at that moment, not on the mutant. E04-M01's review round 04 measured it on
 * 2026-11-07 at `8e645c8`, each mutant planted in turn and the per-mutant command
 * run alone: uncapped on a free machine, 12 of 12 runs failed that test with a
 * `RangeError` saying a column entry is outside a column of 4 294 967 296 entries,
 * which carries no `STARVED` phrase and was always read as a kill; with the run's
 * memory capped by a Windows job object, at 2, 4, 8 and 16 GiB for `<=` and at
 * 8 GiB for `true`, 5 of 5 failed it with V8's `RangeError: Array buffer
 * allocation failed`, whose first frame is `rehash` in `hash-index.ts`; and the
 * suite with no mutant passed all 524 tests under the 2 GiB cap. FIX-04 measured
 * it again at its head on the same day, the same way, each mutant once under a
 * 2 GiB cap, once under an 8 GiB cap and once uncapped: under either cap both
 * failed that test with `RangeError: Array buffer allocation failed`, first frame
 * `rehash` at `hash-index.ts:103:17`, in 6 to 21 s; uncapped both failed it with
 * the column's `RangeError`, in 37 and 50 s; the suite with no mutant passed 524 of
 * 524 under the 2 GiB cap; and each of the six outputs, handed to `remeasure` as a
 * second run, read "assertion". Either way the test fails because of the mutant,
 * so either way it is a detection.
 *
 * `refusedOwnBuffer` reads it, before `STARVED` is tested, and only when every one
 * of these holds: the output names a failing test (`FAILING_TESTS`); the only
 * `STARVED` phrase in it is V8's `RangeError: Array buffer allocation failed`, so
 * node's `Allocation failed - JavaScript heap out of memory`, `out of memory`,
 * `OUT_OF_MEMORY`, `VirtualAlloc failed` and a worker that `exited unexpectedly`
 * still refuse; and the first line under every such refusal is a frame of a stack
 * naming the mutated file, so a buffer refused to any other file, a test's own
 * included, still refuses. Its verdict is printed "a test failed on the mutant's
 * own allocation", so that a reader of the gate's output can tell it from an
 * ordinary assertion.
 *
 * **What it leaves:** a healthy suite starved so hard that a buffer the mutated
 * file asks for is refused, with a test failing on it and nothing else printed
 * that says starving, now reads as a kill, and a mutant that survives the tests
 * could be counted as detected. That is accepted, on three grounds. Every
 * `Array buffer allocation failed` that FIX-04 found recorded, grepping `docs/` at
 * its base, came from a mutant that grows a column without end: S12's six, in all
 * nine of its reports, as its slice document records them (FIX-04 did not
 * reproduce those), and the two of line 120 above. The starved suites this clause
 * was written for, S12's five and review round 21's one, listed at the top of
 * this header, said so in other ways, all of which still refuse: a worker's exit
 * status, `VirtualAlloc failed`, node's own `Out of memory`, a worker that died
 * before any test file was loaded, or nothing at all. And the clause has just run
 * the same suite, in the same copy, with no mutant planted, and refuses every kill
 * when that run fails. That the buffers a mutated file
 * asks for in a healthy run are too small to be refused alone, while the rest of
 * the suite gets its memory, is an inference, measured for one file only: FIX-04
 * logged every table `hash-index.ts` allocates in one run of the per-mutant
 * command with no mutant planted, 81 tables, the largest 32 768 bytes; the
 * buffers of the other mutated files were not measured. Narrowing further, to
 * buffers above some size, is not open: V8's message names no size.
 *
 * ## The outer clock
 *
 * A second run is stopped once it has run as long as Stryker would have let it
 * run: `timeoutFactor` times the dry run's net time, plus `timeoutMS`, plus the
 * dry run's overhead, which is `createMutantRunPlan` in `mutant-test-planner.js`
 * of `@stryker-mutator/core` 10.0.0, read there by E04-M01-S01; with
 * `coverageAnalysis` off every mutant's net time is the whole dry run. Until S01
 * it was `timeoutMS` alone, 120 000 ms, shorter than that by one and a half dry
 * runs, and E03-M01's review round 03 saw a second run of `hash-index.ts` 120:7
 * go past it in two of four draws. Each value is read from what the run used:
 * `timeoutFactor` and `timeoutMS` from the report's own `config`, which is
 * Stryker's options with its defaults filled in (`stryker.config.json`, and
 * Stryker's default factor of 1.5, for a report that carries none); the dry
 * run's net time and overhead from the record Stryker's `event-recorder`
 * reporter writes of it, `*-onDryRunCompleted.json` under
 * `eventReporter.baseDir`. The net time taken is the larger of that record's and
 * this clause's own run with no mutant planted, which is the same command over
 * the same tree, so a replay with no record of its run still gets a budget, and
 * a record left by another run can only lengthen it. What S01 measured of it is
 * in its slice document.
 *
 * Every run goes through `runs`, the copy of the tree unless a caller hands
 * another: `test/gates/` replays committed reports through this clause with
 * recorded runs in the copy's place, so that each verdict is held by a check
 * that `npm run gates:unit` runs.
 *
 * The copy of the tree is every file the gates read, which leaves out what a run
 * generates and the lanes' worktrees, with a junction to `node_modules`, under
 * `.stryker-tmp/`, removed when the clause is done. Before any mutant is planted
 * the copy runs the command once with none, as Stryker's dry run does, and a copy
 * that fails it measures nothing: every kill chosen is then refused. Without that
 * run, a copy missing a file a test reads would fail that test for every mutant,
 * and "a test failed" would confirm kills it says nothing about. The mutated file
 * is written from the `source` Stryker recorded in its report, with the mutant's
 * `replacement` over its `location`; the rest of the copy is the working tree,
 * so a replay (`--check-report`) re-measures the mutants of the report it was
 * handed against the tests as they are now.
 *
 * Every output this clause reads is plain text: the kills it chooses from reach
 * it with their recorded output already stripped of terminal escape sequences,
 * and the output of each of its own runs is stripped the same way before
 * `verdictOf` reads it. Without that, a run that printed in colour, as vitest
 * does on a continuous-integration runner, names no failing test to any reading
 * here. `mutation-output.js` holds the measurement.
 */

/** Where the copy of the tree lives while the clause runs. Removed when it is done. */
const SANDBOX = join(repositoryRoot, '.stryker-tmp', `remeasure-${String(process.pid)}`);

/**
 * Vitest's summary counter of failed tests: a copy of `FAILING_TESTS` in
 * `mutation.js`. Should the two part, a kill the gate reads as failing a test
 * and this copy does not is re-measured, and its second run is read by this copy
 * too, so the parting refuses the build, with the output quoted, rather than
 * passing anything quietly.
 */
const FAILING_TESTS = /^\s*Tests\s+\d+ failed\b/m;

/** Vitest's summary counter of failed test files, which a module that breaks on import moves. */
const FAILING_FILES = /^\s*Test Files\s+\d+ failed\b/m;

/** What a suite that could not get memory, or whose worker died, prints. See the header. */
const STARVED =
  /allocation failed|out of memory|OUT_OF_MEMORY|VirtualAlloc failed|exited unexpectedly/i;

/**
 * V8's refusal of one `ArrayBuffer`, the one `STARVED` phrase a second run may carry and still
 * be read as a kill, under *A mutant's own refused allocation* in the header.
 */
const REFUSED_BUFFER = 'RangeError: Array buffer allocation failed';

/** A frame of a stack as vitest prints it (`❯ <function> <file>:<line>:<column>`) or as node does. */
const FRAME = /^\s*(?:❯|at)\s/;

/** Beyond this many kills to re-measure, the run is refused instead. Argued in the header. */
const REMEASURED_AT_MOST = 50;

/** How much of an output a refusal quotes, from its end, where vitest prints its verdict. */
const QUOTED_CHARACTERS = 600;

/** Stryker's own defaults, from its schema, for a configuration that sets neither. */
const STRYKER_DEFAULTS = {
  timeoutFactor: 1.5,
  timeoutMS: 5000,
  baseDir: 'reports/mutation/events',
};

/** A dry run nothing recorded. */
const NO_DRY_RUN = { net: 0, overhead: 0 };

/**
 * **The line this clause hinges on.** A kill whose output gives it no test result to rest on,
 * read with the gate's own reading of vitest's clock, `clock`. See the header.
 */
const chosen = (reason, clock) =>
  !FAILING_TESTS.test(reason) || STARVED.test(reason) || clock.test(reason);

/** A report key as a reader's path: repository-relative, with `/` separators. */
export function fileNameOf(key) {
  return (isAbsolute(key) ? relative(repositoryRoot, key) : key).split('\\').join('/');
}

/** One mutant named the way the gate names it. */
function nameOf(file, mutant) {
  const { line, column } = mutant.location.start;
  return `${file}:${String(line)}:${String(column)} ${mutant.mutatorName} (to ${JSON.stringify(mutant.replacement ?? null)})`;
}

/** Every killed mutant whose recorded output gives its kill nothing to rest on. */
function suspectsOf(files, clock) {
  const suspects = [];
  for (const [key, file] of Object.entries(files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (mutant.status === 'Killed' && chosen(String(mutant.statusReason ?? ''), clock)) {
        suspects.push({ key, file: fileNameOf(key), source: String(file.source ?? ''), mutant });
      }
    }
  }
  return suspects;
}

/** Where the mutant's location starts and ends in the source; lines and columns count from one. */
function spanOf(source, mutant) {
  const starts = [0];
  for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) {
    starts.push(at + 1);
  }
  const offsetOf = ({ line, column }) => (starts[line - 1] ?? source.length) + column - 1;
  return [offsetOf(mutant.location.start), offsetOf(mutant.location.end)];
}

/** The source with the mutant's replacement over its location. */
function mutatedSource(source, mutant) {
  const [start, end] = spanOf(source, mutant);
  return source.slice(0, start) + String(mutant.replacement ?? '') + source.slice(end);
}

/**
 * The source text the mutant replaces, with every run of white space read as one
 * space, so that reflowing it does not change it. `mutation.js` keys its survivor
 * list by it.
 */
export function originalOf(source, mutant) {
  const [start, end] = spanOf(String(source ?? ''), mutant);
  return String(source ?? '')
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The copy of the tree the mutants are planted in, one at a time: every file the
 * gates read, which leaves out what a run generates and the lanes' worktrees.
 */
function makeSandbox() {
  removeSandbox();
  for (const file of walkFiles(repositoryRoot, [...GENERATED, '.worktrees'])) {
    mkdirSync(dirname(join(SANDBOX, file)), { recursive: true });
    copyFileSync(join(repositoryRoot, file), join(SANDBOX, file));
  }
  symlinkSync(join(repositoryRoot, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction');
}

/** The link first, on its own, so that nothing can follow it into the real `node_modules`. */
function removeSandbox() {
  rmSync(join(SANDBOX, 'node_modules'), { force: true });
  rmSync(SANDBOX, { recursive: true, force: true });
  if (existsSync(dirname(SANDBOX)) && readdirSync(dirname(SANDBOX)).length === 0) {
    rmdirSync(dirname(SANDBOX));
  }
}

/** Stop a run and every process it started; on Windows a parent's death leaves its children. */
function stopTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group has already gone, which is what this was for.
  }
}

/** One run of the gate's command in the copy, with its whole output and how it ended. */
function runAlone(command, budget) {
  const [program = '', ...args] = command.trim().split(/\s+/);
  return new Promise((resolveRun) => {
    const child = spawn(program === 'node' ? process.execPath : program, args, {
      cwd: SANDBOX,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    const chunks = [];
    const began = Date.now();
    let timedOut = false;
    const clock = setTimeout(() => {
      timedOut = true;
      stopTree(child);
    }, budget);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', (error) => chunks.push(Buffer.from(String(error))));
    child.on('close', (code) => {
      clearTimeout(clock);
      const output = plainOutput(Buffer.concat(chunks).toString('utf8'));
      resolveRun({ code, timedOut, output, ms: Date.now() - began });
    });
  });
}

/** `stryker.config.json`, as Stryker reads it. */
function readConfig() {
  return JSON.parse(readFileSync(join(repositoryRoot, 'stryker.config.json'), 'utf8'));
}

/** The runs the clause makes in the copy of the tree; a `null` suspect is the run with none planted. */
const sandboxRuns = {
  open: makeSandbox,
  close: removeSandbox,
  async run(suspect, budget) {
    const command = String(readConfig().commandRunner?.command ?? '');
    if (suspect === null) return runAlone(command, budget);
    const target = join(SANDBOX, suspect.file);
    writeFileSync(target, mutatedSource(suspect.source, suspect.mutant));
    const run = await runAlone(command, budget);
    writeFileSync(target, suspect.source);
    return run;
  },
};

/** The dry run's net time and overhead as Stryker's event recorder wrote them, or none. */
function recordedDryRun(config) {
  const folder = join(repositoryRoot, config.eventReporter?.baseDir ?? STRYKER_DEFAULTS.baseDir);
  const name = existsSync(folder)
    ? readdirSync(folder)
        .filter((one) => one.endsWith('-onDryRunCompleted.json'))
        .sort()
        .pop()
    : undefined;
  if (name === undefined) return NO_DRY_RUN;
  const { timing } = JSON.parse(readFileSync(join(folder, name), 'utf8'));
  return { net: Number(timing?.net ?? 0), overhead: Number(timing?.overhead ?? 0) };
}

/**
 * **The line the outer clock hinges on.** What Stryker gives one mutant run: `timeoutFactor` times
 * the dry run's net time, plus `timeoutMS`, plus the dry run's overhead. See the header.
 */
export function outerClockOf(config, dryRun) {
  const factor = Number(config.timeoutFactor ?? STRYKER_DEFAULTS.timeoutFactor);
  const absolute = Number(config.timeoutMS ?? STRYKER_DEFAULTS.timeoutMS);
  return factor * dryRun.net + absolute + dryRun.overhead;
}

/**
 * A second run past the outer clock: a kill when the first was chosen for vitest's clock and for
 * nothing else, unmeasured otherwise. See the header.
 */
function pastTheOuterClock(suspect, clock) {
  const reason = String(suspect.mutant.statusReason ?? '');
  return clock.test(reason) && FAILING_TESTS.test(reason) && !STARVED.test(reason)
    ? { verdict: 'clock', why: 'ran past the outer clock, alone, as Stryker reports a Timeout' }
    : { verdict: 'unmeasured', why: 'ran past the outer clock, alone' };
}

/** The first non-blank line under the one at `at`, when it is a frame of a stack. */
function frameUnder(lines, at) {
  const next = lines.slice(at + 1).find((line) => line.trim() !== '');
  return next !== undefined && FRAME.test(next) ? next : undefined;
}

/**
 * **The line the reading of a refused buffer hinges on.** A test failed, and the only sign of
 * starving is V8 refusing a buffer the mutated file asked for: every refusal's first frame names
 * that file, and no other `STARVED` phrase is printed. See the header.
 */
function refusedOwnBuffer(output, suspect) {
  if (!FAILING_TESTS.test(output) || STARVED.test(output.replaceAll(REFUSED_BUFFER, ''))) {
    return false;
  }
  const lines = output.split(/\r?\n/);
  const refusals = lines.flatMap((line, at) => (line.includes(REFUSED_BUFFER) ? [at] : []));
  return (
    refusals.length > 0 &&
    refusals.every((at) => frameUnder(lines, at)?.includes(` ${suspect.file}:`) === true)
  );
}

/** What the second run says about the mutant, read in the order the header gives. */
function verdictOf({ code, timedOut, output }, suspect, clock) {
  if (timedOut) return pastTheOuterClock(suspect, clock);
  if (code === 0) return { verdict: 'survived', why: 'every test passed' };
  if (refusedOwnBuffer(output, suspect)) {
    return { verdict: 'assertion', why: "a test failed on the mutant's own allocation" };
  }
  if (STARVED.test(output)) return { verdict: 'unmeasured', why: 'could not get memory again' };
  if (clock.test(output))
    return { verdict: 'clock', why: "a test ran out of vitest's clock again" };
  if (FAILING_TESTS.test(output)) return { verdict: 'assertion', why: 'a test failed' };
  if (FAILING_FILES.test(output) && output.includes(`${suspect.file}:`)) {
    return { verdict: 'own crash', why: 'its own module broke a test file on import' };
  }
  return { verdict: 'unmeasured', why: 'no test failed and no error names the mutated file' };
}

/**
 * Each suspect run again, alone, in turn, after one run with none planted, each under the outer
 * clock: the dry run's net time is the larger of Stryker's record and that first run's.
 */
async function rerunAll(suspects, clock, { config, dryRun, runs }) {
  const results = [];
  runs.open();
  try {
    const clean = await runs.run(null, outerClockOf(config, dryRun));
    if (clean.timedOut || clean.code !== 0) {
      const why =
        'could not be run at all: the copy of the tree fails its own suite with no mutant planted';
      return suspects.map((suspect) => ({ ...suspect, ...clean, verdict: 'unmeasured', why }));
    }
    const budget = outerClockOf(config, { ...dryRun, net: Math.max(dryRun.net, clean.ms) });
    for (const suspect of suspects) {
      const run = await runs.run(suspect, budget);
      results.push({ ...suspect, ...run, budget, ...verdictOf(run, suspect, clock) });
    }
  } finally {
    runs.close();
  }
  return results;
}

/** The report with every re-measured survivor recorded as one, and nothing else changed. */
function correctedFiles(files, results) {
  const survived = new Map();
  for (const result of results) {
    if (result.verdict === 'survived') survived.set(result.mutant, result.output);
  }
  const corrected = { ...files };
  for (const [key, file] of Object.entries(files ?? {})) {
    if (!(file.mutants ?? []).some((mutant) => survived.has(mutant))) continue;
    corrected[key] = {
      ...file,
      mutants: file.mutants.map((mutant) =>
        survived.has(mutant)
          ? { ...mutant, status: 'Survived', statusReason: survived.get(mutant) }
          : mutant,
      ),
    };
  }
  return corrected;
}

/** The refusal for a mutant neither run says anything about. */
function unmeasuredFinding(result) {
  const tail = result.output.trim().slice(-QUOTED_CHARACTERS) || '(it printed nothing)';
  return `${nameOf(result.file, result.mutant)} was reported killed by a run whose output names no failing test, says its suite could not get memory or lost its worker, or carries vitest's own test timeout, and run again alone after the run it ${result.why}: neither run says anything about the mutant, so it is not counted as a detection. The end of the second run's output: ${tail}`;
}

/** What the clause prints, run or not, so the count is visible on every run. */
function describeResults(label, results) {
  const count = (verdict) => results.filter((one) => one.verdict === verdict).length;
  const lines = [
    `${label}: re-measured alone after the run, ${String(results.length)} killed mutants whose recorded output names no failing test, says the suite could not get memory or lost its worker, or carries vitest's own test timeout — ${String(count('assertion'))} failed a test, ${String(count('clock'))} ran out of a clock again, ${String(count('own crash'))} broke their own module on import, ${String(count('survived'))} survived, ${String(count('unmeasured'))} could not be measured\n`,
  ];
  const budget = results.find((one) => one.budget !== undefined)?.budget;
  if (budget !== undefined) {
    lines.push(
      `${label}:   each mutant run alone was stopped after ${budget.toFixed(0)} ms, the budget Stryker gives a mutant: timeoutFactor times the dry run, plus timeoutMS, plus the dry run's overhead\n`,
    );
  }
  for (const result of results) {
    lines.push(
      `${label}:   ${nameOf(result.file, result.mutant)}: ${result.verdict}, ${result.why}\n`,
    );
  }
  process.stdout.write(lines.join(''));
}

/**
 * The clause. Re-measures what it must, pushes a refusal into `findings` for
 * every mutant it cannot measure, and returns the report as the survivor clause
 * should read it. `clock` is the gate's narrow reading of vitest's own test
 * timeout, `VITEST_CLOCK` in `mutation.js`, handed in so that there is one copy.
 * `given` may carry the report's `config`, a recorded `dryRun` and the `runs` to
 * make; each one left out is read or made as the header says.
 */
export async function remeasure(files, label, findings, clock, given = {}) {
  const config = { ...readConfig(), ...given.config };
  const setup = {
    config,
    dryRun: given.dryRun ?? recordedDryRun(config),
    runs: given.runs ?? sandboxRuns,
  };
  const suspects = suspectsOf(files, clock);
  if (suspects.length > REMEASURED_AT_MOST) {
    findings.push(
      `${String(suspects.length)} killed mutants rest on a run whose output names no failing test, says its suite could not get memory or lost its worker, or carries vitest's own test timeout, which is more than the ${String(REMEASURED_AT_MOST)} this gate re-measures one at a time after a run: a run with this many did not measure the tests, so it is refused without re-measuring any of them`,
    );
    return files;
  }
  const results = suspects.length === 0 ? [] : await rerunAll(suspects, clock, setup);
  describeResults(label, results);
  for (const result of results) {
    if (result.verdict === 'unmeasured') findings.push(unmeasuredFinding(result));
  }
  return correctedFiles(files, results);
}
