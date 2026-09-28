import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The ratchet, read and enforced.
 *
 * `AGENTS.md` §11: a committed baseline moves in the improving direction only,
 * and loosening one is a commit that says why. That is a rule a person has to
 * remember unless the comparison itself refuses, so this one does:
 *
 * - a measurement worse than the committed baseline **fails**;
 * - a measurement better than it **passes and prints the number to commit**,
 *   which is the only way the baseline ever goes down;
 * - a measurement worse than a `ceiling` — a budget from
 *   `docs/ADR-0002-architecture-and-performance.md` decision 6 — fails whatever
 *   the baseline says, so that a baseline cannot be walked upward past the
 *   budget one commit at a time.
 *
 * There is deliberately no "update the baselines" flag. Editing the file by hand
 * is the point: it puts the new number inside the diff a reviewer reads.
 */

/** One committed number. */
export interface Baseline {
  /** The best measurement committed so far. A run may not be worse than this. */
  readonly baseline: number;
  /** A hard budget this may never cross, whatever the baseline says. */
  readonly ceiling?: number;
  /**
   * How much worse than the baseline a run may be before it fails, as a factor.
   * Present only for wall-clock figures, which are not deterministic; the
   * counters have no tolerance at all, because they cannot drift.
   */
  readonly tolerance?: number;
  /** What the number means, for a reader of the file. */
  readonly unit: string;
  /**
   * How much wider **every** limit of this entry is in the CI regime, as a
   * factor: the ceiling, and the baseline's own tolerance. Present only for
   * wall-clock figures, beside a `tolerance`; a counter has neither, because a
   * counter reads the same on every machine. See {@link regimeOf}.
   */
  readonly ciTolerance?: number;
}

export interface Baselines {
  readonly [measurement: string]: Baseline;
}

export function baselinesPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'baselines.json');
}

export function readBaselines(path: string = baselinesPath()): Baselines {
  return JSON.parse(readFileSync(path, 'utf8')) as Baselines;
}

/** What a comparison decided, and what to do about it. */
export interface Comparison {
  readonly name: string;
  readonly measured: number;
  readonly limit: number;
  readonly failed: boolean;
  readonly message: string;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Compare one measurement with its committed baseline and its budget.
 *
 * Improvements are only reported when they are worth committing — a tenth of a
 * per cent of noise on a wall-clock figure is not a ratchet step, and a gate
 * that asks to be edited on every run is a gate people stop reading.
 */
export function compareWithBaseline(
  name: string,
  measured: number,
  baseline: Baseline,
): Comparison {
  const limit = baseline.baseline * (baseline.tolerance ?? 1);
  const ceiling = baseline.ceiling;
  if (ceiling !== undefined && measured > ceiling) {
    return {
      name,
      measured,
      limit: ceiling,
      failed: true,
      message: `${name} is ${String(round(measured))} ${baseline.unit}, past the budget of ${String(ceiling)}. The budget is not the thing to change (AGENTS.md section 11).`,
    };
  }
  if (measured > limit) {
    return {
      name,
      measured,
      limit,
      failed: true,
      message: `${name} regressed to ${String(round(measured))} ${baseline.unit} from a baseline of ${String(baseline.baseline)}.`,
    };
  }
  // Only a deterministic counter is ever reported as an improvement worth
  // committing. A wall-clock figure that is four per cent quicker than last time
  // is the machine having a good minute, and a gate that asks for a new baseline
  // on every run teaches people to edit baselines without reading them.
  const improved = baseline.tolerance === undefined && measured < baseline.baseline * 0.99;
  return {
    name,
    measured,
    limit,
    failed: false,
    message: improved
      ? `${name} improved to ${String(round(measured))} ${baseline.unit}: commit that as the baseline in perf/baselines.json, replacing ${String(baseline.baseline)}.`
      : `${name} is ${String(round(measured))} ${baseline.unit}, against a baseline of ${String(baseline.baseline)}.`,
  };
}

/**
 * Which limits a run is held to: `strict` on the development machine, `ci` on a
 * continuous-integration runner.
 *
 * `docs/ADR-0003-quality-gates-and-ci.md` decision 4 checks the wall-clock
 * budgets strictly where an executor and a reviewer run them and with a wide
 * tolerance on a shared runner, so that only an order-of-magnitude regression
 * fails there. **The run is told which by the `CI` variable**, which GitHub
 * Actions sets to `true` in every job, and which nothing on the development
 * machine sets. It is read rather than a flag of this project's own because it
 * is the runner declaring itself: a gate that needed the workflow file to pass a
 * flag would be a gate whose CI behaviour lived in the workflow, which
 * `AGENTS.md` §11 forbids.
 *
 * The failure it can have is one-sided and loud. A runner that does not set the
 * variable is held to the strict limits and goes red, which is seen; a
 * development shell that sets it is held to the wide ones and stays green,
 * which would not be — so every message {@link compareInRegime} prints begins
 * with the regime it was held to, and the transcript says which a run was.
 * `CI` empty, `0` or `false` is the strict regime, as it is for the tools that
 * read the same variable.
 */
export type Regime = 'strict' | 'ci';

export function regimeOf(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Regime {
  const flag = (environment['CI'] ?? '').trim().toLowerCase();
  return flag === '' || flag === '0' || flag === 'false' ? 'strict' : 'ci';
}

/**
 * The entry with its limits as `regime` sets them.
 *
 * The CI regime **widens** — the ceiling and the tolerance, both by the entry's
 * `ciTolerance` — and removes nothing: every assertion a strict run makes, a CI
 * run makes too, against a larger number. An entry without `ciTolerance` is the
 * same in both regimes, which is every counter.
 */
export function limitsIn(baseline: Baseline, regime: Regime): Baseline {
  const widen = regime === 'ci' ? (baseline.ciTolerance ?? 1) : 1;
  if (widen === 1) {
    return baseline;
  }
  return {
    ...baseline,
    tolerance: (baseline.tolerance ?? 1) * widen,
    ...(baseline.ceiling === undefined ? {} : { ceiling: baseline.ceiling * widen }),
  };
}

/** {@link compareWithBaseline}, under the limits of `regime`, saying which regime it was. */
export function compareInRegime(
  name: string,
  measured: number,
  baseline: Baseline,
  regime: Regime = regimeOf(),
): Comparison {
  const comparison = compareWithBaseline(name, measured, limitsIn(baseline, regime));
  return { ...comparison, message: `[${regime} regime] ${comparison.message}` };
}
