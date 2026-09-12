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
 */

const SMALL = 10000;
const LARGE = 40000;

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
  readonly builder: CommitStoreBuilder;
  readonly milliseconds: number;
}

function measure(count: number): Measurement {
  const started = performance.now();
  const builder = build(count);
  return { builder, milliseconds: performance.now() - started };
}

function report(comparison: Comparison): void {
  const status = comparison.failed ? 'FAIL' : 'ok  ';
  process.stdout.write(`  ${status} ${comparison.message}\n`);
}

const baselines = readBaselines();
const small = measure(SMALL);
const large = measure(LARGE);

describe('the commit store, measured', () => {
  it('retains no more structural bytes per commit than the budget allows', () => {
    const perCommit = retainedByteLength(small.builder) / SMALL;
    const comparison = compareWithBaseline(
      'structural bytes per commit',
      perCommit,
      baselines['structuralBytesPerCommit'] ?? { baseline: 96, unit: 'bytes' },
    );
    report(comparison);
    expect(comparison.message.length).toBeGreaterThan(0);
    expect(comparison.failed).toBe(false);
  });

  it('retains no more per commit at forty thousand than at ten', () => {
    const perCommit = retainedByteLength(large.builder) / LARGE;
    const comparison = compareWithBaseline(
      'structural bytes per commit, at forty thousand',
      perCommit,
      baselines['structuralBytesPerCommitLarge'] ?? { baseline: 96, unit: 'bytes' },
    );
    report(comparison);
    expect(comparison.failed).toBe(false);
  });
});

describe('the commit store, counted', () => {
  it('does about four times the work for four times the commits, not sixteen', () => {
    const ratio = storeWork(large.builder) / storeWork(small.builder);
    const comparison = compareWithBaseline(
      'work at forty thousand over work at ten thousand',
      ratio,
      baselines['scalingRatio'] ?? { baseline: 6, unit: 'times' },
    );
    report(comparison);
    expect(comparison.failed).toBe(false);
    expect(ratio).toBeGreaterThan(2);
  });

  it('does a constant amount of work per commit', () => {
    const perCommit = storeWork(large.builder) / LARGE;
    const comparison = compareWithBaseline(
      'units of work per commit',
      perCommit,
      baselines['workPerCommit'] ?? { baseline: 20, unit: 'units' },
    );
    report(comparison);
    expect(comparison.failed).toBe(false);
  });

  it('stays inside an order of magnitude of its recorded wall clock', () => {
    const perTenThousand = (large.milliseconds / LARGE) * SMALL;
    const comparison = compareWithBaseline(
      'milliseconds to build ten thousand commits',
      Math.max(small.milliseconds, perTenThousand),
      baselines['buildMilliseconds'] ?? { baseline: 1000, tolerance: 10, unit: 'ms' },
    );
    report(comparison);
    expect(comparison.failed).toBe(false);
  });
});
