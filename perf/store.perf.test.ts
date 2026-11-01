import { describe, expect, it } from 'vitest';

import { retainedByteLength, storeWork } from '../src/core/store/index';

import { compareWithBaseline, readBaselines } from './baselines';
import { RATIO_LARGE, RATIO_SMALL, WORST_CASE, build, report, siteOf } from './workloads';
import type { Built } from './workloads';

/**
 * The performance gate over the commit store.
 *
 * Counters, not stopwatches (`docs/ADR-0003-quality-gates-and-ci.md` decision
 * 4). Bytes retained per commit and units of work done per commit are the same
 * numbers on every machine, so they can be a ratchet. The wall clock of the same
 * three builds is held, at an order of magnitude, by
 * `perf/store.timed.perf.test.ts`, which `npm run gates:budgets` runs and
 * `gates:perf` does not (`AGENTS.md` §11, *Gate tiers*). Both files build with
 * `build` of `perf/workloads.ts`, at its three sizes.
 *
 * **Where a benchmark measures is part of what it measures.** The store retains
 * a step function of the commit count — its columns grow by five quarters and
 * its hash index doubles — so retained bytes per commit is that step function
 * divided by the count, and it therefore has a maximum just after a growth and a
 * minimum just before the next one. A size chosen for being round is a size
 * chosen at random along that curve, and two of the round ones are the worst
 * possible choice: `INITIAL_COMMIT_CAPACITY × (5/4)ⁿ` is 8000, 10 000 and
 * 12 500, where the last growth lands exactly on the data and the store shows
 * its best face. The three sizes, `WORST_CASE`, `RATIO_SMALL` and `RATIO_LARGE`
 * of `perf/workloads.ts`, are chosen against the two cycles instead, and say
 * there how; {@link capacityExactComplaint} refuses any that stops being so.
 */

type Measurement = Built;

function measure(count: number): Measurement {
  return { count, builder: build(count) };
}

/**
 * The guard: what to say when a measurement size has become capacity-exact.
 *
 * Empty when every size still carries slack. This is the rule that keeps the
 * rest of the file honest, because both the initial capacity and the growth
 * factor are the store's own tuning knobs: a later slice that changes either
 * moves every boundary of the curve, and a size that used to sit mid-cycle can
 * land on one. Measuring there reads the store at its best and would look like
 * an improvement worth committing, which is how a ratchet quietly re-anchors
 * itself to a coincidence.
 *
 * Note what this is not. A change to those constants **should** move the
 * worst-case figure and **should** require a re-recorded baseline with a reason
 * in the commit, because that is a real change to how much memory the store
 * holds. What must not happen is the number moving because an accident of
 * arithmetic broke.
 */
function capacityExactComplaint(measurements: readonly Measurement[]): string {
  const exact = measurements.filter((each) => each.builder.capacity <= each.count);
  if (exact.length === 0) {
    return '';
  }
  const sizes = exact
    .map((each) => `${String(each.count)} (capacity ${String(each.builder.capacity)})`)
    .join(', ');
  return (
    `the store's growth now lands exactly on ${sizes}, so the columns there carry no slack at ` +
    `all. That is the cheapest point of the whole curve, not a representative one: measuring ` +
    `there understates both retained bytes and work per commit, and asserts the 96-byte budget ` +
    `of ADR-0002 decision 6 where it cannot bind. Re-choose the size by re-running the sweep the ` +
    `slice document records — every count over the range, then a rebuild of the survivors — and ` +
    `not from a description of the curve, which has twice put the worst point in the wrong place. ` +
    `Do not re-record a baseline against a capacity-exact size (AGENTS.md section 11).`
  );
}

const baselines = readBaselines();
const worst = measure(WORST_CASE);
const small = measure(RATIO_SMALL);
const large = measure(RATIO_LARGE);
const everySize: readonly Measurement[] = [worst, small, large];

describe('the commit store, measured', () => {
  it('measures at no size the store grows to exactly', () => {
    const complaint = capacityExactComplaint(everySize);
    for (const measurement of everySize) {
      process.stdout.write(`  site ${siteOf(measurement)}\n`);
    }
    expect(complaint).toBe('');
  });

  it('retains no more per commit than the budget allows, at the worst size the sweep found', () => {
    const perCommit = retainedByteLength(worst.builder) / WORST_CASE;
    const comparison = compareWithBaseline(
      'structural bytes per commit, at the worst size the recorded sweep found',
      perCommit,
      baselines['structuralBytesPerCommitWorst'] ?? { baseline: 96, unit: 'bytes' },
    );
    report(comparison, worst);
    expect(comparison.message.length).toBeGreaterThan(0);
    expect(comparison.failed).toBe(false);
  });

  it('retains no more per commit at twenty thousand than the budget allows', () => {
    const perCommit = retainedByteLength(small.builder) / RATIO_SMALL;
    const comparison = compareWithBaseline(
      'structural bytes per commit, at twenty thousand',
      perCommit,
      baselines['structuralBytesPerCommit'] ?? { baseline: 96, unit: 'bytes' },
    );
    report(comparison, small);
    expect(comparison.failed).toBe(false);
  });

  it('retains no more per commit at eighty thousand than at twenty', () => {
    const perCommit = retainedByteLength(large.builder) / RATIO_LARGE;
    const comparison = compareWithBaseline(
      'structural bytes per commit, at eighty thousand',
      perCommit,
      baselines['structuralBytesPerCommitLarge'] ?? { baseline: 96, unit: 'bytes' },
    );
    report(comparison, large);
    expect(comparison.failed).toBe(false);
  });
});

describe('the commit store, counted', () => {
  it('does about four times the work for four times the commits, not sixteen', () => {
    const ratio = storeWork(large.builder) / storeWork(small.builder);
    const comparison = compareWithBaseline(
      'work at eighty thousand over work at twenty thousand',
      ratio,
      baselines['scalingRatio'] ?? { baseline: 6, unit: 'times' },
    );
    report(comparison, large);
    expect(comparison.failed).toBe(false);
    expect(ratio).toBeGreaterThan(2);
  });

  it('does a constant amount of work per commit', () => {
    const perCommit = storeWork(large.builder) / RATIO_LARGE;
    const comparison = compareWithBaseline(
      'units of work per commit',
      perCommit,
      baselines['workPerCommit'] ?? { baseline: 20, unit: 'units' },
    );
    report(comparison, large);
    expect(comparison.failed).toBe(false);
  });
});
