import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../src/contracts/index';
import type { CommitColumns } from '../src/contracts/index';
import { createLayoutState, layoutPage, layoutWork } from '../src/core/layout/index';

import { compareInRegime, readBaselines } from './baselines';
import type { Comparison } from './baselines';

/**
 * The lane layout, counted.
 *
 * This is the ratchet (`docs/ADR-0003-quality-gates-and-ci.md` decision 4):
 * `layoutWork` sums the rows laid out, the parent entries read, the lane slots
 * inspected and the segments emitted, which are the same numbers on every
 * machine. Work per row at forty thousand, and the work of forty thousand over
 * the work of ten thousand, are both held with no tolerance at all; a pass that
 * had become quadratic would read about sixteen, not four.
 *
 * The same layout **timed**, against the budget of
 * `docs/ADR-0002-architecture-and-performance.md` decision 6, is
 * `perf/layout.timed.perf.test.ts`, which `npm run gates:budgets` runs and
 * `gates:perf` does not: a time is read on a free machine (`AGENTS.md` §11,
 * *Gate tiers*), a count anywhere. That file builds the same shape from a copy
 * of `braided` below; the two must stay the same function.
 *
 * The shape is braided on purpose: the straight chain the end-to-end fixtures
 * have costs five units a row and says nothing about lanes. For row *i* the
 * first parent is *i + 1 + r* for *r* from 0 to 2, and every ninth row has a
 * second parent *i + 1 + r* for *r* from 0 to 39, *r* drawn from a fixed linear
 * congruential sequence; a parent past the end of the page is `UNKNOWN_INDEX`,
 * which is what a page read from git holds. That is the description of the
 * braided shape E01-M01-S04 measured, implemented here from the description, so
 * its counters are this file's own and are not claimed to equal S04's.
 */

const SMALL = 10_000;
const LARGE = 40_000;

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

/** Lay `columns` out in one page from a fresh state, and say how much work it counted. */
function layOut(columns: CommitColumns): number {
  const state = createLayoutState();
  layoutPage(state, columns, 0);
  return layoutWork(state);
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

describe('the lane layout, counted', () => {
  it('does a constant amount of work per row on a braided page', () => {
    const perRow = layOut(large) / LARGE;
    expect(held('layoutWorkPerRow', 'units of layout work per row', perRow).failed).toBe(false);
  });

  it('does about four times the work for four times the rows, not sixteen', () => {
    const ratio = layOut(large) / layOut(small);
    const comparison = held('layoutScalingRatio', 'layout work at 40000 over 10000', ratio);
    expect(comparison.failed).toBe(false);
    expect(ratio).toBeGreaterThan(2);
  });
});
