import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../src/contracts/index';
import { appendCommit, createCommitStoreBuilder } from '../src/core/store/index';
import type { AppendedCommit, CommitStoreBuilder } from '../src/core/store/index';

import { compareWithBaseline, readBaselines } from './baselines';
import type { Comparison } from './baselines';

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
 * The sizes are that file's three, and it says why each was chosen; `nameInto`
 * and `build` below are copies of its functions of the same names. A test file
 * cannot import another without running its cases too, which would put the
 * counted cases in both gates. The two must stay the same.
 */

const WORST_CASE = 12502;
const RATIO_SMALL = 20000;
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
