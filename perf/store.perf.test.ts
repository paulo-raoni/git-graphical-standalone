import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../src/contracts/index';
import {
  appendCommit,
  createCommitStoreBuilder,
  retainedByteLength,
  storeWork,
} from '../src/core/store/index';
import type { AppendedCommit, CommitStoreBuilder } from '../src/core/store/index';

import { compareWithBaseline, readBaselines } from './baselines';
import type { Comparison } from './baselines';

/**
 * The performance gate over the commit store.
 *
 * Counters, not stopwatches (`docs/ADR-0003-quality-gates-and-ci.md` decision
 * 4). Bytes retained per commit and units of work done per commit are the same
 * numbers on every machine, so they can be a ratchet; the wall clock is recorded
 * beside them and asserted only at an order of magnitude, which is all it can
 * honestly carry on a shared runner.
 *
 * **Where a benchmark measures is part of what it measures.** The store retains
 * a step function of the commit count — its columns grow by five quarters and
 * its hash index doubles — so retained bytes per commit is that step function
 * divided by the count, and it therefore has a maximum just after a growth and a
 * minimum just before the next one. A size chosen for being round is a size
 * chosen at random along that curve, and two of the round ones are the worst
 * possible choice: `INITIAL_COMMIT_CAPACITY × (5/4)ⁿ` is 8000, 10 000 and
 * 12 500, where the last growth lands exactly on the data and the store shows
 * its best face. The sizes below are chosen against the two cycles instead, and
 * {@link capacityExactComplaint} refuses any that stops being so.
 */

/**
 * The worst size found by the search this comment records.
 *
 * Three structures have to grow for the store to hold `n` commits: the per
 * commit columns, the parent index column, and the hash index, whose slots are a
 * power of two kept under a three-quarter load. Retained bytes per commit is
 * their sum over `n`, so it jumps at a growth and falls across the plateau that
 * follows.
 *
 * That describes the shape of the curve. It does not locate the maximum, and two
 * earlier attempts to locate it by description put it somewhere else. So this
 * size was **searched for**, over every commit count from 4097 to 200 000, in
 * two phases. First an incremental pass reading the retained total after every
 * append: it gives every commit a parent, so its parent column is never smaller
 * than this gate's and its reading at any count is an upper bound on this gate's
 * reading at that count. Then a rebuild, with this file's `build`, of every count
 * that bound could not rule out. 12 502 was the worst of them, at 85.519 bytes
 * per commit and 25.0 per cent column slack.
 *
 * **That is the whole claim.** The workload is this gate's own synthetic one —
 * one parent per commit, one author and one committer, message text excluded —
 * and a repository of merges or of thousands of distinct people costs
 * differently. Nor is the size durable: changing `INITIAL_COMMIT_CAPACITY` or the
 * growth factor moves every boundary of the curve, and the size must then be
 * found again by **re-running that search**, never adjusted.
 * `docs/plan/E01-commit-graph/M01-first-graph/S02-gates-and-store.md` records the
 * method, and the parent-column trap that makes the second phase necessary.
 *
 * This is the only point at which the 96-byte budget of
 * `docs/ADR-0002-architecture-and-performance.md` decision 6 means anything: a
 * page-by-page load walks the whole curve, so the store passes through here, and
 * the budget has to hold where the curve is highest.
 */
const WORST_CASE = 12502;

/**
 * An ordinary mid-cycle size, and the denominator of the scaling ratio.
 *
 * Capacity 24 415 against 20 000 commits, so 22.1 per cent slack: neither the
 * best nor the worst of its cycle, which is what makes it a fair reading of what
 * the store costs at a size a user actually reaches. One build serves both its
 * own memory figure and the ratio, so the gate does not build it twice.
 */
const RATIO_SMALL = 20000;

/**
 * Four times {@link RATIO_SMALL}, and large enough for the initial capacity of
 * 4096 to be noise rather than a term.
 *
 * Capacity 93 140, so 16.4 per cent slack, and again mid-cycle. The pair reads
 * about four times the work for four times the commits, which is what
 * `docs/ADR-0003-quality-gates-and-ci.md` decision 4 asks the ratio to show.
 */
const RATIO_LARGE = 80000;

/** A distinct object name per commit, cheap enough not to dominate the build. */
function nameInto(hash: Uint8Array, seed: number): void {
  let state = seed + 1;
  for (let byte = 0; byte < HASH_BYTE_LENGTH; byte += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    hash[byte] = (state >>> 16) & 0xff;
  }
}

/**
 * Build `count` commits in git's own order: every commit names the next one as
 * its parent, so every parent is resolved after its child, through the pending
 * table, which is the path a real log takes.
 */
function build(count: number): CommitStoreBuilder {
  const builder = createCommitStoreBuilder();
  const hash = new Uint8Array(HASH_BYTE_LENGTH);
  const parent = new Uint8Array(HASH_BYTE_LENGTH);
  const empty = new Uint8Array(0);
  for (let row = 0; row < count; row += 1) {
    nameInto(hash, row);
    nameInto(parent, row + 1);
    const commit: AppendedCommit = {
      hash,
      parentHashes: row === count - 1 ? empty : parent,
      authorName: 'Fixture Author',
      authorEmail: 'author@fixture.invalid',
      authorTime: 1700000000 + row,
      authorTzMinutes: 0,
      committerName: 'Fixture Committer',
      committerEmail: 'committer@fixture.invalid',
      commitTime: 1700000000 + row,
      commitTzMinutes: 0,
      subject: `commit ${String(row)}`,
    };
    appendCommit(builder, commit);
  }
  return builder;
}

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

/** How much room the store ended up holding beyond the commits it was given. */
function slackPerCent(measurement: Measurement): number {
  return ((measurement.builder.capacity - measurement.count) / measurement.count) * 100;
}

/** Where a number was taken, printed beside it so the reader need not read this file. */
function siteOf(measurement: Measurement): string {
  return (
    `[${String(measurement.count)} commits, capacity ` +
    `${String(measurement.builder.capacity)}, ${slackPerCent(measurement).toFixed(1)}% slack]`
  );
}

function report(comparison: Comparison, measurement: Measurement): void {
  const status = comparison.failed ? 'FAIL' : 'ok  ';
  process.stdout.write(`  ${status} ${comparison.message} ${siteOf(measurement)}\n`);
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
