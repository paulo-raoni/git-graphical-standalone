import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../src/contracts/index';
import type { CommitColumns } from '../src/contracts/index';
import { createLayoutState, layoutPage } from '../src/core/layout/index';

import { compareInRegime, readBaselines } from './baselines';
import type { Comparison } from './baselines';

/**
 * The lane layout, timed.
 *
 * The budget of `docs/ADR-0002-architecture-and-performance.md` decision 6: at
 * least 200 000 commits a second, held as **at most five microseconds a commit**
 * so that a slower pass raises the number, as every other regression in
 * `perf/baselines.json` does (`perf/parse.timed.perf.test.ts` says why the unit
 * is turned over rather than the comparison). The fastest of five runs after a
 * warm-up pass is compared.
 *
 * **It runs in `npm run gates:budgets`, not in `gates:perf`**, because its
 * verdict is a time and a time is read on a free machine (`AGENTS.md` §11,
 * *Gate tiers*); the file's name is what selects it, as
 * `perf/parse.timed.perf.test.ts` says. The same layout **counted**, which is
 * the ratchet and reads the same on every machine, is
 * `perf/layout.perf.test.ts` and stays in `gates:perf`.
 *
 * The shape is the braided one that file describes, and `braided` below is a
 * copy of its function of the same name: a test file cannot import another
 * without running its cases too, which would put the counted cases in both
 * gates. The two must stay the same function.
 */

const LARGE = 40_000;
const RUNS = 5;

/** The parents of a braided page of `count` commits; nothing else of the columns is read. */
function braided(count: number): CommitColumns {
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

/** Lay `columns` out in one page from a fresh state; the microseconds a commit it took. */
function layOut(columns: CommitColumns): number {
  const state = createLayoutState();
  const started = performance.now();
  layoutPage(state, columns, 0);
  const elapsed = performance.now() - started;
  return (elapsed * 1000) / columns.count;
}

const baselines = readBaselines();

function held(key: string, name: string, measured: number): Comparison {
  const baseline = baselines[key];
  expect(baseline).toBeDefined();
  const comparison = compareInRegime(name, measured, baseline ?? { baseline: 0, unit: 'missing' });
  process.stdout.write(`  ${comparison.failed ? 'FAIL' : 'ok  '} ${comparison.message}\n`);
  return comparison;
}

const large = braided(LARGE);

describe('the lane layout, timed', () => {
  it('lays a commit out in no more than five microseconds', () => {
    layOut(large);
    const runs = Array.from({ length: RUNS }, () => layOut(large));
    process.stdout.write(
      `  layout: ${String(LARGE)} braided rows, ` +
        `${runs.map((each) => each.toFixed(4)).join(', ')} microseconds a commit\n`,
    );
    const fastest = Math.min(...runs);
    const comparison = held(
      'layoutMicrosecondsPerCommit',
      'microseconds to lay out one commit of a braided page',
      fastest,
    );
    expect(comparison.failed).toBe(false);
  });
});
