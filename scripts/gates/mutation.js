import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * two properties of it refuse the build on their own:
 *
 * 1. **Every killed and every surviving mutant carries a completed test run.**
 *    Both verdicts are statements about what the tests did, so both need a test
 *    result behind them. This is what catches a runner that returns verdicts
 *    without running anything: `@stryker-mutator/vitest-runner` 10.0.0 against
 *    the pinned `vitest` 5.0.0 reports every mutant as survived with `Ran 0.00
 *    tests per mutant on average`, measured here, and would be refused by this
 *    clause even if its score were not already below the threshold.
 * 2. **Timeouts are at most a quarter of all detections.** This is what catches
 *    the failure above, which reported `Ran 0.01 tests per mutant on average` and
 *    a 99.2 per cent timeout share at a score of 100.00. A quarter is a validity
 *    bound and not a quality target: the honest full run measured for
 *    `docs/plan/E01-commit-graph/M01-first-graph/S02-gates-and-store.md` sits at
 *    3.8 per cent, and the four runs that were green while this gate measured
 *    nothing sat at 10, 62, 82 and 99.6.
 *
 * Neither clause subsumes the other, and neither is the tests-per-mutant figure
 * itself, because a genuinely non-terminating mutant is a legitimate detection
 * with no test result: 43 of the 1131 mutants of the honest run are loop-control
 * mutations in the store's probing and growth loops and in the UTF-8 decoder,
 * which is why that run prints `Ran 0.96 tests per mutant on average` rather than
 * 1.00 and why a floor on that figure is not one of the clauses. It is printed
 * on every run beside the timeout share, because what caught both failures late
 * was that nobody had those two numbers in one place.
 *
 * A missing or unreadable report is refused for the same reason: a run whose
 * shape cannot be read is not a measurement. The stale report of an earlier run
 * is deleted before Stryker starts, so a crash cannot leave one behind to be
 * checked in place of the run that just failed.
 *
 * ## The third clause: a committed survivor baseline
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
 * without an argument.
 *
 * Entries for files this run did not mutate are **out of consideration** rather
 * than missing, so narrowing `--mutate` for speed removes entries from the
 * question instead of diluting a percentage, and the count of them is printed.
 */

/** Stryker's own entry point, run as a child so its output reaches the terminal. */
const STRYKER = join(
  repositoryRoot,
  'node_modules',
  '@stryker-mutator',
  'core',
  'bin',
  'stryker.js',
);

/** The gate's configuration, read for the one path this script and Stryker share. */
const CONFIG = join(repositoryRoot, 'stryker.config.json');

/** The committed survivor baseline, beside this script with the other gate data. */
const SURVIVORS = join(dirname(fileURLToPath(import.meta.url)), 'mutation-survivors.json');

/** The same file as a reader sees it, for the messages that tell one what to edit. */
const SURVIVORS_NAME = 'scripts/gates/mutation-survivors.json';

/** Where Stryker's json reporter writes, when the configuration does not say. */
const DEFAULT_REPORT = join('reports', 'mutation', 'mutation.json');

/**
 * The cap on the timeout share of detections. A validity bound rather than a
 * baseline: the four runs that reported 100.00 while this gate measured nothing
 * sat at 10, 62, 82 and 99.6 per cent, and the honest run measures 3.8.
 */
const TIMEOUT_SHARE_CAP = 0.25;

/** Every mutant status the report schema defines, so an unknown one is visible. */
const STATUSES = [
  'Killed',
  'Timeout',
  'Survived',
  'NoCoverage',
  'RuntimeError',
  'CompileError',
  'Ignored',
  'Pending',
];

/** The json report's path, from the configuration Stryker itself reads. */
function reportPath() {
  const options = JSON.parse(readFileSync(CONFIG, 'utf8'));
  return join(repositoryRoot, options.jsonReporter?.fileName ?? DEFAULT_REPORT);
}

/** Stryker, with whatever extra arguments the caller passed through. */
function runStryker(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STRYKER, 'run', ...argv], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve(signal === null ? (code ?? 1) : 1);
    });
  });
}

/** Mutants by status, and the number of completed test runs behind them. */
function tally(files) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  const unknown = new Set();
  let testsCompleted = 0;
  for (const file of Object.values(files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (counts[mutant.status] === undefined) {
        unknown.add(String(mutant.status));
        continue;
      }
      counts[mutant.status] += 1;
      testsCompleted += mutant.testsCompleted ?? 0;
    }
  }
  return { counts, testsCompleted, unknown: [...unknown] };
}

/**
 * The same arithmetic `mutation-testing-metrics` does, spelled out here so that
 * the numbers this gate prints are the numbers Stryker printed and not a second
 * set: detected is killed plus timeout, valid excludes the errors, and the
 * denominator of tests per mutant is every mutant in the report.
 *
 * A report with mutants but no **valid** one — every mutant an error — would
 * score `NaN` and pass both clauses below. It is left unguarded because it
 * cannot be reached: mutation testing does not start unless the dry run
 * succeeded, and the only way this runner reports an error is a failure to start
 * a process, which would have failed the dry run first.
 */
function metricsOf({ counts, testsCompleted }) {
  const detected = counts.Killed + counts.Timeout;
  const valid = detected + counts.Survived + counts.NoCoverage;
  const invalid = counts.RuntimeError + counts.CompileError;
  const total = valid + invalid + counts.Ignored + counts.Pending;
  return {
    counts,
    detected,
    valid,
    invalid,
    total,
    testsCompleted,
    score: valid > 0 ? (detected / valid) * 100 : Number.NaN,
    timeoutShare: detected > 0 ? counts.Timeout / detected : 0,
    testsPerMutant: total > 0 ? testsCompleted / total : Number.NaN,
  };
}

/** The shape of the run, printed whether it passes or fails. */
function describe(metrics, elapsedMs) {
  const { counts } = metrics;
  const parts = [
    `${String(counts.Killed)} killed`,
    `${String(counts.Timeout)} timeout`,
    `${String(counts.Survived)} survived`,
    `${String(counts.NoCoverage)} no coverage`,
    `${String(metrics.invalid)} errored`,
    `${String(counts.Ignored)} ignored`,
    `${String(counts.Pending)} pending`,
  ];
  process.stdout.write(`mutation: ${String(metrics.total)} mutants — ${parts.join(', ')}\n`);
  process.stdout.write(
    `mutation: score ${metrics.score.toFixed(2)} over ${String(metrics.valid)} valid mutants, ` +
      `timeouts ${(metrics.timeoutShare * 100).toFixed(1)}% of ${String(metrics.detected)} ` +
      `detections, ${metrics.testsPerMutant.toFixed(2)} tests per mutant, ` +
      `${(elapsedMs / 1000).toFixed(1)} seconds\n`,
  );
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
  if (metrics.testsCompleted < verdicts) {
    found.push(
      `${String(verdicts - metrics.testsCompleted)} of the ${String(verdicts)} mutants reported ` +
        'as killed or survived carry no completed test run: both verdicts are statements about ' +
        'what the tests did, and this runner reports one completed test per mutant whose suite ' +
        `reached an exit status, so ${String(metrics.testsCompleted)} test runs cannot account ` +
        'for them',
    );
  }
  if (metrics.timeoutShare > TIMEOUT_SHARE_CAP) {
    found.push(
      `${String(metrics.counts.Timeout)} of ${String(metrics.detected)} detections were ` +
        `timeouts (${(metrics.timeoutShare * 100).toFixed(1)}%, cap ` +
        `${(TIMEOUT_SHARE_CAP * 100).toFixed(0)}%): stryker scores a timeout as a detection, so ` +
        'a score built out of them says how long the runs took and not what the tests assert',
    );
  }
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

/** A report key as a reader's path: repository-relative, with `/` separators. */
function fileNameOf(key) {
  const relativePath = isAbsolute(key) ? relative(repositoryRoot, key) : key;
  return relativePath.split('\\').join('/');
}

/** One mutant named the way the clear-text reporter names it, plus its replacement. */
function nameOf(file, line, column, mutator, replacement) {
  const shown = JSON.stringify(replacement ?? null);
  return `${file}:${String(line)}:${String(column)} ${mutator} (to ${shown})`;
}

/** The committed list, by identity, with the entry kept for its message. */
function readSurvivors() {
  const listed = new Map();
  for (const entry of JSON.parse(readFileSync(SURVIVORS, 'utf8')).survivors) {
    listed.set(
      identityOf(entry.file, entry.line, entry.column, entry.mutator, entry.replacement),
      entry,
    );
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
        statuses: new Set(),
      };
      group.statuses.add(mutant.status);
      if (mutant.status === 'Survived') {
        group.survived += 1;
      }
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
    const what =
      group.survived === 1
        ? `${name} survived`
        : `${name} survived in ${String(group.survived)} mutants that share this position, ` +
          'mutator and replacement';
    found.push(
      `${what} and is not in ${SURVIVORS_NAME}: either the test that would kill it has not been ` +
        'written, which is the test to write, or no behavioural test can kill it, which is an entry ' +
        'to add with the reason — and adding one is a commit a reviewer reads (AGENTS.md section 11)',
    );
  }
  return { found, unlisted, survivors };
}

/** The message for an entry that names no mutant, and whether a line moved under it. */
function staleMessage(entry, unlisted) {
  const name = nameOf(entry.file, entry.line, entry.column, entry.mutator, entry.replacement);
  const moved = unlisted.find(
    (mutant) =>
      mutant.file === entry.file &&
      mutant.mutator === entry.mutator &&
      mutant.replacement === (entry.replacement ?? null),
  );
  return (
    `${SURVIVORS_NAME} lists ${name}, and this run mutated that file and produced no such mutant: ` +
    'the entry names nothing, so it protects nothing and nobody is checking it' +
    (moved === undefined
      ? '. Re-record it against a run, or remove it'
      : `. The same mutator and replacement survives at ${String(moved.line)}:` +
        `${String(moved.column)} of that file, which is what a line that moved looks like: ` +
        'correct this entry rather than adding a second one')
  );
}

/** The line printed for an entry whose mutant this run detected rather than left alive. */
function detectedNote(entry, status) {
  return (
    `mutation: ${nameOf(entry.file, entry.line, entry.column, entry.mutator, entry.replacement)} ` +
    `is on the list and this run reports it ${status}. If a test now kills it, drop the entry from ` +
    `${SURVIVORS_NAME} in the commit that wrote that test: a shrinking list is the direction ` +
    'AGENTS.md section 11 lets a baseline move on its own. This does not refuse the build, because ' +
    'the verdict is not deterministic — the command runner counts any non-zero exit of the suite ' +
    'as a detection, and runs of identical source have been measured disagreeing about a mutant, ' +
    'in the mutation section of ' +
    'docs/plan/E01-commit-graph/M01-first-graph/S02-gates-and-store.md\n'
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
      notes.push(detectedNote(entry, [...group.statuses].join(' and ')));
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
      `mutation: survivor baseline — ${String(listed.size)} entries; matched a mutant of this run ` +
        `${String(matched)}, of those detected rather than left alive ${String(detected)}; in a ` +
        `file this run did not mutate ${String(outOfScope)}; survivors of this run not on the ` +
        `list ${String(unlisted.survivors)}\n`,
      ...stale.notes,
    ],
  };
}

const started = Date.now();
const json = reportPath();
rmSync(json, { force: true });
const status = await runStryker(process.argv.slice(2));
const elapsed = Date.now() - started;
const findings = [];

if (existsSync(json)) {
  const { files } = JSON.parse(readFileSync(json, 'utf8'));
  const counted = tally(files);
  const metrics = metricsOf(counted);
  describe(metrics, elapsed);
  findings.push(...shapeFindings(metrics, counted.unknown));
  const against = survivorFindings(files, readSurvivors());
  for (const note of against.notes) {
    process.stdout.write(note);
  }
  findings.push(...against.found);
} else {
  findings.push(
    `stryker wrote no report to ${relative(repositoryRoot, json).split('\\').join('/')}, ` +
      'so the shape of the run cannot be read, and a run whose shape cannot be read is not a ' +
      'measurement',
  );
}

if (status !== 0) {
  findings.push(`stryker exited with status ${String(status)}`);
}

report('mutation', findings);
