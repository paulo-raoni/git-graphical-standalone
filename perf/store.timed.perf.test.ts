import { describe, expect, it } from 'vitest';

import type { CommitStoreBuilder } from '../src/core/store/index';

import { compareWithBaseline, readBaselines } from './baselines';
import { RATIO_LARGE, RATIO_SMALL, WORST_CASE, build, report } from './workloads';

/**
 * The commit store's build, timed.
 *
 * The wall clock of the three builds `perf/store.perf.test.ts` counts, asserted
 * only at an order of magnitude — ten times its recorded figure — which is all
 * a stopwatch can honestly carry on a shared runner.
 *
 * **It runs in `npm run gates:budgets`, not in `gates:perf`**, because its
 * verdict is a time (`AGENTS.md` §11, *Gate tiers*); the file's name is what
 * selects it, as `perf/parse.timed.perf.test.ts` says. The counters of the same
 * builds, which read the same on every machine, stay in `gates:perf`.
 *
 * The sizes are that file's three and the build is its build, both from
 * `perf/workloads.ts`, which says why each size was chosen. A test file cannot
 * import another without running its cases too, which would put the counted
 * cases in both gates, so they live in a module that is not a test file.
 */

interface Measurement {
  readonly count: number;
  readonly builder: CommitStoreBuilder;
  readonly milliseconds: number;
}

function measure(count: number): Measurement {
  const started = performance.now();
  const builder = build(count);
  return { count, builder, milliseconds: performance.now() - started };
}

const baselines = readBaselines();
const worst = measure(WORST_CASE);
const small = measure(RATIO_SMALL);
const large = measure(RATIO_LARGE);
const everySize: readonly Measurement[] = [worst, small, large];

describe('the commit store, timed', () => {
  it('stays inside an order of magnitude of its recorded wall clock', () => {
    const perTenThousand = everySize.map((each) => (each.milliseconds / each.count) * 10000);
    const slowest = everySize[perTenThousand.indexOf(Math.max(...perTenThousand))] ?? large;
    const comparison = compareWithBaseline(
      'milliseconds to build ten thousand commits',
      Math.max(...perTenThousand),
      baselines['buildMilliseconds'] ?? { baseline: 1000, tolerance: 10, unit: 'ms' },
    );
    report(comparison, slowest);
    expect(comparison.failed).toBe(false);
  });
});
