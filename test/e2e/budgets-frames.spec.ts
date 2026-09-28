import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { OVERSCAN_ROWS, visibleRowCount } from '../../src/ui/geometry';

import { described, holdToBaseline, median, paintedState, withBudgeted } from './support/budgets';
import {
  countRowElements,
  loadMoreAndShow,
  readProbe,
  sampleScrollFrames,
  scrollListTo,
  setMarking,
  viewportHeight,
} from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * What scrolling costs in the built application with a real repository loaded,
 * against two budgets of `docs/ADR-0002-architecture-and-performance.md`
 * decision 6 — main-thread work per frame, and live row elements — and two
 * counters of `docs/ADR-0003-quality-gates-and-ci.md` decision 4: canvas redraws
 * for a scripted scroll, and live row elements again as a count.
 *
 * `test/e2e/graph-table.spec.ts` reads the same two properties over a page
 * handed to the view by the driver; these read them over the ten-thousand-commit
 * fixture opened and loaded through the bridge, and hold them to
 * `perf/baselines.json`. The fixture is a straight chain, one lane wide, so a
 * frame here draws one line and one dot a row; a braided history draws more, and
 * that is the limit of this reading.
 */

const LARGE = 10_000;

/** Open the fixture and load all of it, painted. */
async function openAll(page: Page, repository: string): Promise<number> {
  await paintedState(page, (state) => state.path === repository && state.rows === 300);
  const atFirstPage = await page.evaluate(countRowElements);
  await page.evaluate(loadMoreAndShow, LARGE - 300);
  await paintedState(page, (state) => state.rows === LARGE && state.ink > 0);
  return atFirstPage;
}

test.describe.configure({ timeout: 300_000 });

test('live row elements: a function of the window, not of the commits loaded', async () => {
  const repository = fixture('large', 'large', LARGE);
  await withBudgeted({ open: repository }, async ({ page }) => {
    const atFirstPage = await openAll(page, repository);
    for (const offset of [40_000, 120_000, 239_000, 0]) {
      expect(await page.evaluate(scrollListTo, offset)).toBe(offset);
      await page.waitForTimeout(100);
    }
    const atAll = await page.evaluate(countRowElements);
    const bound = visibleRowCount(await page.evaluate(viewportHeight)) + 2 * OVERSCAN_ROWS;
    process.stdout.write(
      `  row elements: ${String(atFirstPage)} with 300 loaded, ${String(atAll)} with ${String(LARGE)} ` +
        `after scrolling, against viewport rows plus twice the overscan, ${String(bound)}\n`,
    );
    expect(atAll).toBeLessThanOrEqual(bound);
    const verdicts = [
      holdToBaseline('liveRowElements', 'live row elements, 10000 commits loaded', atAll).failed,
      holdToBaseline(
        'liveRowGrowth',
        'row elements at 10000 over row elements at 300',
        atAll / atFirstPage,
      ).failed,
    ];
    expect(verdicts).toEqual([false, false]);
  });
});

/** The mean and the worst frame of each run, at one scroll step. */
async function framesAt(page: Page, step: number): Promise<{ means: number[]; worsts: number[] }> {
  const means: number[] = [];
  const worsts: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const sample = await page.evaluate(sampleScrollFrames, { frames: 240, step });
    means.push(sample.work.reduce((all, one) => all + one, 0) / sample.work.length);
    worsts.push(Math.max(...sample.work));
  }
  process.stdout.write(
    `  ${String(step)} px a frame, 240 frames a run: mean ${described(means, 2)} ms, ` +
      `worst ${described(worsts, 1)} ms\n`,
  );
  return { means, worsts };
}

/**
 * Two scrolls, five runs of 240 frames each: three rows a frame, a brisk wheel,
 * and 1 200 pixels a frame, fifty rows, more than the whole pool, so that every
 * frame rewrites every row element and redraws every line — the most a frame of
 * this view can be asked to do. **The budget is held on the second.** The mean
 * of a run is its work per frame and its worst frame is its worst; the median of
 * five runs of each is compared.
 */
test('main-thread work per frame while scrolling', async () => {
  const repository = fixture('large', 'large', LARGE);
  await withBudgeted({ open: repository }, async ({ page }) => {
    await openAll(page, repository);
    await page.evaluate(setMarking, false);
    await framesAt(page, 72);
    const jumping = await framesAt(page, 1_200);
    const verdicts = [
      holdToBaseline(
        'scrollFrameMeanMilliseconds',
        'mean main-thread work a frame',
        median(jumping.means),
      ).failed,
      holdToBaseline(
        'scrollFrameWorstMilliseconds',
        'worst main-thread frame of a run',
        median(jumping.worsts),
      ).failed,
    ];
    expect(verdicts).toEqual([false, false]);
  });
});

/**
 * Runs in the page: dispatch a scroll event for each offset, all in one task.
 * Dispatched because Chromium coalesces programmatic scrolling into one event by
 * itself (`graph-table.spec.ts` measured one event for twenty-five writes), and
 * the view's own coalescing is what this counts.
 */
function burst(offsets: readonly number[]): number {
  const scope = globalThis as unknown as {
    document: {
      querySelector: (
        at: string,
      ) => { scrollTop: number; dispatchEvent: (e: object) => boolean } | null;
    };
    Event: new (type: string) => object;
  };
  const list = scope.document.querySelector('.graph__scroll');
  if (list === null) return -1;
  for (const offset of offsets) {
    list.scrollTop = offset;
    list.dispatchEvent(new scope.Event('scroll'));
  }
  return list.scrollTop;
}

test('canvas redraws: one a scrolled frame, one for a burst of scroll events', async () => {
  const repository = fixture('large', 'large', LARGE);
  await withBudgeted({ open: repository }, async ({ page }) => {
    await openAll(page, repository);
    await page.evaluate(setMarking, false);
    await page.waitForTimeout(300);
    const before = (await page.evaluate(readProbe)).redraws;
    await page.evaluate(sampleScrollFrames, { frames: 120, step: 240 });
    await page.waitForTimeout(300);
    const scrolled = (await page.evaluate(readProbe)).redraws - before;
    const offsets = Array.from({ length: 25 }, (_unused, step) => (step + 1) * 53);
    expect(await page.evaluate(burst, offsets)).toBe(25 * 53);
    await page.waitForTimeout(300);
    const burstRedraws = (await page.evaluate(readProbe)).redraws - before - scrolled;
    process.stdout.write(
      `  ${String(scrolled)} redraws for 120 scrolled frames, ${String(burstRedraws)} for 25 events in one task\n`,
    );
    const verdicts = [
      holdToBaseline('redrawsPerScrolledFrame', 'canvas redraws per scrolled frame', scrolled / 120)
        .failed,
      holdToBaseline(
        'redrawsPerScrollBurst',
        'canvas redraws for 25 scroll events in one task',
        burstRedraws,
      ).failed,
    ];
    expect(verdicts).toEqual([false, false]);
  });
});
