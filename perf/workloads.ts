import { expect } from 'vitest';

import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../src/contracts/index';
import type { CommitColumns } from '../src/contracts/index';
import { appendCommit, createCommitStoreBuilder } from '../src/core/store/index';
import type { AppendedCommit, CommitStoreBuilder } from '../src/core/store/index';

import { compareInRegime, readBaselines } from './baselines';
import type { Comparison } from './baselines';

/**
 * The synthetic workloads the benchmarks of `perf/` build, written once.
 *
 * Each workload is read twice: counted by a file that `npm run gates:perf`
 * runs, and timed by a `*.timed.perf.test.ts` file that `npm run gates:budgets`
 * runs (`AGENTS.md` §11, *Gate tiers*). The braided page is counted by
 * `perf/layout.perf.test.ts` and timed by `perf/layout.timed.perf.test.ts`; the
 * store build by `perf/store.perf.test.ts` and `perf/store.timed.perf.test.ts`.
 * A test file cannot import another without running its cases too, which would
 * put the counted cases in both gates, so what both halves need lives here, in a
 * module that is not a test file. Its name matches neither `*.perf.test.ts`,
 * which `vitest.perf.config.js` collects, nor `*.timed.perf.test.ts`, which
 * the two scripts tell apart, so neither gate runs it as a suite of its own.
 *
 * Until E03-M01-S05 each timed file carried a copy of these functions, equal to
 * the original by a reviewer's reading and kept so by nothing.
 */

/** The two sizes of braided page the layout benchmarks lay out. */
export const BRAIDED_SMALL = 10_000;
export const BRAIDED_LARGE = 40_000;

/**
 * The parents of a braided page of `count` commits; nothing else of the columns is read.
 *
 * For row *i* the first parent is *i + 1 + r* for *r* from 0 to 2, and every
 * ninth row has a second parent *i + 1 + r* for *r* from 0 to 39, *r* drawn from
 * a fixed linear congruential sequence; a parent past the end of the page is
 * `UNKNOWN_INDEX`, which is what a page read from git holds.
 * `perf/layout.perf.test.ts` says why the shape is braided.
 */
export function braided(count: number): CommitColumns {
  let state = 12345;
  const next = (bound: number): number => {
    state = (state * 1103515245 + 12345) >>> 0;
    return (state >>> 16) % bound;
  };
  const parentOffsets = new Uint32Array(count + 1);
  const parents: number[] = [];
  const within = (row: number): number => (row < count ? row : UNKNOWN_INDEX);
  for (let row = 0; row < count; row += 1) {
    parentOffsets[row] = parents.length;
    parents.push(within(row + 1 + next(3)));
    if (row % 9 === 0) {
      parents.push(within(row + 1 + next(40)));
    }
  }
  parentOffsets[count] = parents.length;
  return {
    count,
    hashes: new Uint8Array(count * HASH_BYTE_LENGTH),
    parentOffsets,
    parentIndices: Uint32Array.from(parents),
    authorId: new Uint32Array(count),
    committerId: new Uint32Array(count),
    authorTime: new Float64Array(count),
    commitTime: new Float64Array(count),
    authorTzMinutes: new Int16Array(count),
    commitTzMinutes: new Int16Array(count),
    subjectOffsets: new Uint32Array(count + 1),
    subjects: '',
    people: { names: [], emails: [] },
  };
}

const baselines = readBaselines();

/**
 * Compare `measured` with the entry `key` of `perf/baselines.json` under the
 * run's regime, print the verdict, and return it. The entry must exist.
 */
export function held(key: string, name: string, measured: number): Comparison {
  const baseline = baselines[key];
  expect(baseline).toBeDefined();
  const comparison = compareInRegime(name, measured, baseline ?? { baseline: 0, unit: 'missing' });
  process.stdout.write(`  ${comparison.failed ? 'FAIL' : 'ok  '} ${comparison.message}\n`);
  return comparison;
}

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
export const WORST_CASE = 12502;

/**
 * An ordinary mid-cycle size, and the denominator of the scaling ratio.
 *
 * Capacity 24 415 against 20 000 commits, so 22.1 per cent slack: neither the
 * best nor the worst of its cycle, which is what makes it a fair reading of what
 * the store costs at a size a user actually reaches. One build serves both its
 * own memory figure and the ratio, so the gate does not build it twice.
 */
export const RATIO_SMALL = 20000;

/**
 * Four times {@link RATIO_SMALL}, and large enough for the initial capacity of
 * 4096 to be noise rather than a term.
 *
 * Capacity 93 140, so 16.4 per cent slack, and again mid-cycle. The pair reads
 * about four times the work for four times the commits, which is what
 * `docs/ADR-0003-quality-gates-and-ci.md` decision 4 asks the ratio to show.
 */
export const RATIO_LARGE = 80000;

/** A distinct object name per commit, cheap enough not to dominate the build. */
export function nameInto(hash: Uint8Array, seed: number): void {
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
export function build(count: number): CommitStoreBuilder {
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

/** A store built at one size: what the store benchmarks read. */
export interface Built {
  readonly count: number;
  readonly builder: CommitStoreBuilder;
}

/** How much room the store ended up holding beyond the commits it was given. */
export function slackPerCent(measurement: Built): number {
  return ((measurement.builder.capacity - measurement.count) / measurement.count) * 100;
}

/** Where a number was taken, printed beside it so the reader need not read this file. */
export function siteOf(measurement: Built): string {
  return (
    `[${String(measurement.count)} commits, capacity ` +
    `${String(measurement.builder.capacity)}, ${slackPerCent(measurement).toFixed(1)}% slack]`
  );
}

/** Print a store benchmark's verdict, with where it was taken. */
export function report(comparison: Comparison, measurement: Built): void {
  const status = comparison.failed ? 'FAIL' : 'ok  ';
  process.stdout.write(`  ${status} ${comparison.message} ${siteOf(measurement)}\n`);
}
