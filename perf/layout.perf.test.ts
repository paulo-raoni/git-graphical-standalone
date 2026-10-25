import { describe, expect, it } from 'vitest';

import type { CommitColumns } from '../src/contracts/index';
import { createLayoutState, layoutPage, layoutWork } from '../src/core/layout/index';

import { BRAIDED_LARGE as LARGE, BRAIDED_SMALL as SMALL, braided, held } from './workloads';

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
 * *Gate tiers*), a count anywhere. Both files build the same page with
 * `braided` of `perf/workloads.ts`, so the shape timed is the shape counted.
 *
 * The shape is braided on purpose: the straight chain the end-to-end fixtures
 * have costs five units a row and says nothing about lanes. For row *i* the
 * first parent is *i + 1 + r* for *r* from 0 to 2, and every ninth row has a
 * second parent *i + 1 + r* for *r* from 0 to 39, *r* drawn from a fixed linear
 * congruential sequence; a parent past the end of the page is `UNKNOWN_INDEX`,
 * which is what a page read from git holds. That is the description of the
 * braided shape E01-M01-S04 measured, implemented in `perf/workloads.ts` from
 * the description, so its counters are this gate's own and are not claimed to
 * equal S04's.
 */

/** Lay `columns` out in one page from a fresh state, and say how much work it counted. */
function layOut(columns: CommitColumns): number {
  const state = createLayoutState();
  layoutPage(state, columns, 0);
  return layoutWork(state);
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
