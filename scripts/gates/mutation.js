import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repositoryRoot, report } from './tree.js';

/**
 * The mutation gate: StrykerJS, and a refusal of any run whose own shape says it
 * cannot have measured the tests.
 *
 * Stryker scores a **timeout as a detection**. That is the right default — a
 * mutant that makes the code loop forever has been detected — and it is what
 * made this gate's failure invisible: with a per-mutant timeout budget measured
 * on a warm transform cache and spent on cold ones, every per-mutant run ran out
 * of time, every timeout was counted as a kill, and the score was 100.00 with not
 * one mutant killed by an assertion. The gate was green for a reason unrelated to
 * what it measures, which `AGENTS.md` §7 says is the one failure a green run
 * cannot distinguish from working.
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
 *    3.9 per cent, and the four runs that were green while this gate measured
 *    nothing sat at 10, 62, 82 and 99.6.
 *
 * Neither clause subsumes the other, and neither is the tests-per-mutant figure
 * itself, because a genuinely non-terminating mutant is a legitimate detection
 * with no test result: 44 of the 1131 mutants of the honest run are loop-control
 * mutations in the store's probing and growth loops, which is why that run prints
 * `Ran 0.96 tests per mutant on average` rather than 1.00. The figure is printed
 * on every run beside the timeout share, because what caught both failures late
 * was that nobody had those two numbers in one place.
 *
 * A missing or unreadable report is refused for the same reason: a run whose
 * shape cannot be read is not a measurement. The stale report of an earlier run
 * is deleted before Stryker starts, so a crash cannot leave one behind to be
 * checked in place of the run that just failed.
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

/** Where Stryker's json reporter writes, when the configuration does not say. */
const DEFAULT_REPORT = join('reports', 'mutation', 'mutation.json');

/**
 * The cap on the timeout share of detections. A validity bound rather than a
 * baseline: the four runs that reported 100.00 while this gate measured nothing
 * sat at 10, 62, 82 and 99.6 per cent, and the honest run measures 3.9.
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
 * the number this gate refuses is the number Stryker printed and not a second
 * one: detected is killed plus timeout, valid excludes the errors, and the
 * denominator of tests per mutant is every mutant in the report.
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

const started = Date.now();
const json = reportPath();
rmSync(json, { force: true });
const status = await runStryker(process.argv.slice(2));
const elapsed = Date.now() - started;
const findings = [];

if (existsSync(json)) {
  const counted = tally(JSON.parse(readFileSync(json, 'utf8')).files);
  const metrics = metricsOf(counted);
  describe(metrics, elapsed);
  findings.push(...shapeFindings(metrics, counted.unknown));
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
