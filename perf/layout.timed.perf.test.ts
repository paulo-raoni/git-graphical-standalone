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
 * is turned over rather than the comparison).
 *
 * **It runs in `npm run gates:budgets`, not in `gates:perf`**, because its
 * verdict is a time and a time is read on a free machine (`AGENTS.md` §11,
 * *Gate tiers*); the file's name is what selects it, as
 * `perf/parse.timed.perf.test.ts` says. The same layout **counted**, which is
 * the ratchet and reads the same on every machine, is
 * `perf/layout.perf.test.ts` and stays in `gates:perf`.
 *
 * **How it is read.** First the passes S07's file made before its timing, when
 * the timing shared a file with the counted cases: the large page twice and the
 * small one once. Then five batches half a second apart, each one untimed layout
 * and five timed ones; the **fastest of the twenty-five** is compared. The
 * readings are spread because load arrives in bursts and only ever adds to a
 * reading. Five runs back to back take under a fifth of a second, and on
 * 2026-10-17 review round 21 kept a reading of this file, as it then was, whose
 * five runs all read 1.27 to 1.59 µs a commit against a limit of 0.885, on a
 * product unchanged since its baseline. The same day E01-M01-FIX-37 kept seven
 * readings of that file, fastest 0.669 to 0.788, and seven of S07's file, with
 * its passes before the timing, 0.618 to 0.714, all at other load of 25 to 38
 * per cent during the reading. So the passes are worth a few per cent, not a
 * factor of two; they are restored because S07's baseline was read after them.
 * The twenty-five runs take about three seconds, so a burst moves the fastest
 * only if it lasts through all of them, and a slower layout moves every run,
 * the fastest included. What the fastest does not see is a regression that
 * slows some runs and not others; the start cases of
 * `test/e2e/budgets-start.spec.ts` pay the same price for the same reason.
 *
 * The shape is the braided one that file describes, and `braided` below is a
 * copy of its function of the same name: a test file cannot import another
 * without running its cases too, which would put the counted cases in both
 * gates. The two must stay the same function.
 */

const SMALL = 10_000;
const LARGE = 40_000;
/** Batches of timed runs, how many runs each, and the pause between batches. */
const BATCHES = 5;
const RUNS = 5;
const PAUSE_MILLISECONDS = 500;

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

const small = braided(SMALL);
const large = braided(LARGE);

const pause = (milliseconds: number): Promise<void> =>
  new Promise((done) => setTimeout(done, milliseconds));

/** Every timed run, batch by batch, after the passes S07's file made before its timing. */
async function timedBatches(): Promise<number[][]> {
  layOut(large);
  layOut(large);
  layOut(small);
  const batches: number[][] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    if (batch > 0) await pause(PAUSE_MILLISECONDS);
    layOut(large);
    batches.push(Array.from({ length: RUNS }, () => layOut(large)));
  }
  return batches;
}

describe('the lane layout, timed', () => {
  it('lays a commit out in no more than five microseconds', async () => {
    const batches = await timedBatches();
    process.stdout.write(
      `  layout: ${String(LARGE)} braided rows, ${String(BATCHES)} batches of ${String(RUNS)}, ` +
        `${batches.map((runs) => runs.map((each) => each.toFixed(4)).join(', ')).join(' | ')} ` +
        `microseconds a commit\n`,
    );
    const fastest = Math.min(...batches.flat());
    const comparison = held(
      'layoutMicrosecondsPerCommit',
      'microseconds to lay out one commit of a braided page',
      fastest,
    );
    expect(comparison.failed).toBe(false);
  });
});
