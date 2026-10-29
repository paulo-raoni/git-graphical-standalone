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
 *
 * **The three cases are run by two gates** (`AGENTS.md` §11, *Gate tiers*).
 * *main-thread work per frame while scrolling* is held to a time, so it
 * carries the `@budgets` tag in its title, which `playwright.config.js`
 * selects by, and runs in `npm run gates:budgets` alone. The other two hold
 * counts — row elements, canvas redraws — so they carry no tag and run in
 * `gates:e2e`.
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
    const verdicts = [
      holdToBaseline('liveRowElements', 'live row elements, 10000 commits loaded', atAll).failed,
      holdToBaseline(
        'liveRowGrowth',
        'row elements at 10000 over row elements at 300',
        atAll / atFirstPage,
      ).failed,
    ];
    expect(verdicts).toEqual([false, false]);
    expect(atAll).toBeLessThanOrEqual(bound);
  });
});

/** Runs of the 1 200 px scroll the budget is held on, and the pause between two of them. */
const HELD_RUNS = 10;
const HELD_PAUSE_MILLISECONDS = 1_000;
/** The slowest frames of a run set aside before its worst is read: the fifth-slowest of 240 is read. */
const SET_ASIDE_FRAMES = 4;
/** Timings of the reference workload in the page before each run, and as many after it. */
const REFERENCE_TIMES = 10;
/**
 * The milliseconds a held figure is expressed in: a run's figure over the middle of its
 * reference timings, times this, which is about what that middle reads on this machine
 * when it is free (the case's comment says where it was read).
 */
const REFERENCE_MILLISECONDS = 7;

/**
 * Runs in the page: the reference workload, timed `count` times after three untimed
 * passes. It is the view's kind of work and none of the view's code: 800 text cells
 * in 200 flex rows of an element of its own, off screen, each pass rewriting every
 * cell's text and reading the element's height, which makes the engine recompute
 * their style and layout at once. The element is in the document only while it is
 * timed, so the scrolled frames do not pay for it.
 */
const referenceTimes = (count: number): number[] => {
  interface Node {
    textContent: string | null;
    readonly offsetHeight: number;
    readonly style: { cssText: string };
    appendChild: (child: Node) => void;
    remove: () => void;
  }
  const scope = globalThis as unknown as {
    document: { body: Node; createElement: (tag: string) => Node };
    performance: { now: () => number };
  };
  const make = (tag: string, css: string): Node => {
    const made = scope.document.createElement(tag);
    made.style.cssText = css;
    return made;
  };
  const box = make('div', 'position:absolute;left:-10000px;top:0;width:600px');
  const cells: Node[] = [];
  for (let row = 0; row < 200; row += 1) {
    const line = make('div', 'display:flex;gap:4px');
    for (let cell = 0; cell < 4; cell += 1) cells.push(make('span', ''));
    cells.slice(-4).forEach((cell) => {
      line.appendChild(cell);
    });
    box.appendChild(line);
  }
  scope.document.body.appendChild(box);
  let turn = 0;
  const once = (): number => {
    const at = scope.performance.now();
    turn += 1;
    cells.forEach((cell, index) => {
      cell.textContent = `${String((turn * 7_919 + index * 104_729) % 1_000_003)} x`;
    });
    turn += box.offsetHeight & 1;
    return scope.performance.now() - at;
  };
  const times = Array.from({ length: count + 3 }, once).slice(3);
  box.remove();
  return times;
};

/**
 * The mean, the worst frame and the worst frame once the {@link SET_ASIDE_FRAMES}
 * slowest are set aside, of each run, at one scroll step, `pause` ms between runs;
 * and the lowest mean and the lowest of those worst frames, each scaled by its own
 * run's factor: `REFERENCE_MILLISECONDS` over the middle of the run's reference
 * timings, at most 1.
 */
async function framesAt(
  page: Page,
  step: number,
  runs: number,
  pause: number,
): Promise<{ means: number[]; worsts: number[]; trimmed: number[]; held: number[] }> {
  const means: number[] = [];
  const worsts: number[] = [];
  const trimmed: number[] = [];
  const references: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    if (run > 0 && pause > 0) await page.waitForTimeout(pause);
    const before = await page.evaluate(referenceTimes, REFERENCE_TIMES);
    const sample = await page.evaluate(sampleScrollFrames, { frames: 240, step });
    const after = await page.evaluate(referenceTimes, REFERENCE_TIMES);
    const slowestFirst = [...sample.work].sort((left, right) => right - left);
    means.push(sample.work.reduce((all, one) => all + one, 0) / sample.work.length);
    worsts.push(slowestFirst[0] ?? Number.NaN);
    trimmed.push(slowestFirst[SET_ASIDE_FRAMES] ?? Number.NaN);
    references.push(median([...before, ...after]));
  }
  const scaled = [means, trimmed].map((values) =>
    values.map((value, run) => (REFERENCE_MILLISECONDS * value) / (references[run] ?? Number.NaN)),
  );
  const held = scaled.map((values) => Math.min(...values));
  process.stdout.write(
    `  ${String(step)} px a frame, 240 frames a run: mean ${described(means, 2)} ms, ` +
      `worst ${described(worsts, 1)} ms, ` +
      `fifth-slowest ${described(trimmed, 1)} ms, ` +
      `reference ${described(references, 3)} ms, ` +
      `mean per reference ${described(scaled[0] ?? [], 2)} ms, ` +
      `fifth-slowest per reference ${described(scaled[1] ?? [], 1)} ms\n`,
  );
  return { means, worsts, trimmed, held };
}

/**
 * Two scrolls of 240 frames a run: three rows a frame, a brisk wheel, five runs
 * back to back, and 1 200 pixels a frame, fifty rows, more than the whole pool,
 * so that every frame rewrites every row element and redraws every line — the
 * most a frame of this view can be asked to do. **The budget is held on the
 * second**, ten runs a second apart. The mean of a run is its work per frame, and
 * its worst frame is read **with its four slowest frames set aside**: the
 * fifth-slowest of its 240. **The lowest of the ten of each is compared.**
 *
 * The lowest, and not the median of five as S07 held it, because the machine is
 * shared and what other programs do to a frame only ever adds to it. On
 * 2026-10-17 E01-M01-FIX-37 kept six runs of the median of five at other load of
 * 21 to 37 per cent, and three were red on the worst frame (11.7, 11.7 and
 * 13.4 ms against 11.55) on a product unchanged since its baseline. Split into
 * its script and its rendering, in 50 runs that lane read from five kept runs
 * of ten scrolls, a run's worst frame was 1.4 to 3.5 times its median frame, its
 * script part 1.0 to 4.4 times the median frame's and its rendering 1.5 to 3.6
 * times; that it was the same work done slower is an inference, because only
 * the two parts were timed and nothing counted the work (the slice document,
 * *Main-thread work per frame while scrolling*). A burst of load lasts
 * seconds; the ten runs take about fifty, so it moves the lowest only if it
 * lasts through all ten, and a regression of the product moves every run, the
 * lowest included. What the lowest does not see is a slow frame the product
 * makes in some runs and not others; that is the price, and the start cases of
 * `budgets-start.spec.ts` pay it for the same reason.
 *
 * **The four slowest frames of a run are set aside since E03-M01-FIX-03**
 * (2026-10-28), because the lowest of ten slowest frames flapped too: it went red
 * at E03-M01-S09's head on 2026-10-25, 12.5 ms against 11.55, on a renderer that
 * lane and review round 04 found byte-identical to the one rounds 03 and 04 read
 * green at 10.1, 8.3 and 8.3 ms (their readings, not reproduced by FIX-03).
 * FIX-03 kept twelve readings of this case at its base on 2026-10-28, other load
 * 11.0 to 34.5 per cent over each, its own processes counted apart through a
 * Windows job object: the lowest slowest frame read 7.1 to 10.8 ms, none red,
 * the highest 1.30 times their median of 8.3; in the same runs the lowest
 * fifth-slowest read 6.3 to 8.4, the highest 1.22 times their median of 6.9,
 * which is now the baseline, so the limit is 10.35. The highest reading sits
 * 1.95 ms under its limit where the slowest's sat 0.75 ms under 11.55. Planted at
 * the top of the view's `paint`, a busy-wait of 4 ms in every frame read 10.4 to
 * 12.4, red in three kept readings of three; of 3 ms, 9.7 to 11.8, red in two of
 * three; of 6 ms in every tenth frame, 10.9 to 11.3, red in three of three while
 * the mean stayed green at 5.48 to 5.64. Twelve more readings kept at FIX-03's
 * first commit, other load 23.2 to 36.5 per cent, read 6.5 to 8.0, all green; in
 * neither series did the slowest frame go red, so the flap was not reproduced,
 * and the case for the change is the margin above. By construction, and not
 * measured, it cannot see a regression that slows four or fewer frames of every
 * run.
 */
test('main-thread work per frame while scrolling @budgets', async () => {
  const repository = fixture('large', 'large', LARGE);
  await withBudgeted({ open: repository }, async ({ page }) => {
    await openAll(page, repository);
    await page.evaluate(setMarking, false);
    await framesAt(page, 72, 5, 0);
    const jumping = await framesAt(page, 1_200, HELD_RUNS, HELD_PAUSE_MILLISECONDS);
    const verdicts = [
      holdToBaseline(
        'scrollFrameMeanMilliseconds',
        'mean main-thread work a frame',
        jumping.held[0] ?? Number.NaN,
      ).failed,
      holdToBaseline(
        'scrollFrameWorstMilliseconds',
        'worst main-thread frame of a run, its four slowest set aside',
        jumping.held[1] ?? Number.NaN,
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
