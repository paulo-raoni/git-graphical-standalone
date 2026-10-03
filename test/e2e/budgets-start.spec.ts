import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  closeBudgeted,
  described,
  holdToBaseline,
  launchBudgeted,
  paintedState,
  processTree,
  withBudgeted,
} from './support/budgets';
import type { PaintState } from './support/budgets-page';
import { pressRefresh, readProbe, setMarking } from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * Starting the application, and loading ten thousand commits, against the two
 * wall-clock budgets of `docs/ADR-0002-architecture-and-performance.md`
 * decision 6 that are about time to pixels.
 *
 * **Every figure is the fastest of ten readings**, with all ten and their range
 * printed beside it, and the fastest is what each case holds to
 * `perf/baselines.json` under the regime the run is in (`regimeOf` in
 * `perf/baselines.ts`): strictly on the development machine, and four times wider
 * on a CI runner.
 *
 * The fastest, and not the median, because the development machine is shared
 * with other programs and what they do to a reading only ever adds to it. On
 * 2026-10-03 ten runs of this file as it held the median of five went red seven
 * times on an unchanged product, with the processor load sampled at 17 to 100
 * per cent. Timed stage by stage with git's own trace, a Refresh is five git
 * processes started one after another; Refreshes of 1257 to 1813 ms spent their
 * extra time starting and running those, and from the last one's exit to the
 * rows painted took 23 to 53 ms, in the fast Refreshes and the slow ones alike.
 * A burst of load lasts seconds, so it moved three or five readings of five
 * together, and with them the median. The fastest of ten is moved only if all
 * ten readings, spread over fifteen seconds or more, met the load; and a
 * regression of the product moves every reading, the fastest included. What it
 * does not see is a regression that slows some readings and not others; that is
 * the price, and the benchmarks in `perf/` pay it for the same reason.
 *
 * What it does not survive is load that lasts longer than the readings: of ten
 * runs on 2026-10-03, the eight taken at a sampled load of 17 to 99 per cent were
 * green, and the two that ran into four and a half minutes at 76 to 100 per cent
 * were red; at the end of those minutes another project's mutation run had seven
 * workers at a whole core each. That is how long the product takes on a machine
 * that busy, not a reading this gate got wrong.
 *
 * "Painted" is a mark of `./support/budgets-page.ts`: the state is read in an
 * animation frame after the change, and the time in the frame after that, which
 * cannot run before the state read was painted.
 */

/** How many readings each case takes; the fastest of them is compared. */
const READINGS = 10;

/** A pause before each Refresh, so that ten Refreshes do not all fall in one burst of load. */
const REFRESH_SPACING_MILLISECONDS = 1_000;

/** A cold start, in milliseconds from the operating system creating the process. */
interface ColdStart {
  readonly fromCreation: number;
  readonly fromLaunchCall: number;
}

/** Runs in the page: Chromium's own main-thread paint times for its first two paint entries. */
function chromiumPaints(): { first: number; contentful: number; presented: number } {
  interface Entry {
    readonly name: string;
    readonly startTime: number;
    readonly paintTime?: number;
    readonly presentationTime?: number;
  }
  const scope = globalThis as unknown as {
    performance: { getEntriesByType: (type: string) => Entry[] };
  };
  const entries = scope.performance.getEntriesByType('paint');
  const first = entries.find((each) => each.name === 'first-paint');
  const contentful = entries.find((each) => each.name === 'first-contentful-paint');
  return {
    first: first?.paintTime ?? Number.NaN,
    contentful: contentful?.paintTime ?? Number.NaN,
    presented: contentful?.presentationTime ?? contentful?.startTime ?? Number.NaN,
  };
}

/**
 * Hold the probe to Chromium's own clock. Before the renderer mounts its bar the
 * document has no text, so the first paint is the paint of the first mark's
 * state, and the first contentful paint is the paint of the bar: the first mark
 * may not be earlier than the one, and the first mark showing the bar may not
 * be earlier than the other. Returns how late that mark was, and how long the
 * compositor took to present the first contentful paint.
 */
async function checkedAgainstChromium(page: Page): Promise<{ late: number; presented: number }> {
  const marks = (await page.evaluate(readProbe)).marks;
  const chromium = await page.evaluate(chromiumPaints);
  const first = marks[0];
  const showingBar = marks.find((mark) => mark.state.path !== '');
  expect(first).toBeDefined();
  expect(showingBar).toBeDefined();
  expect(first?.paintedAt ?? 0).toBeGreaterThanOrEqual(chromium.first);
  expect(showingBar?.paintedAt ?? 0).toBeGreaterThanOrEqual(chromium.contentful);
  return {
    late: (showingBar?.paintedAt ?? Number.NaN) - chromium.contentful,
    presented: chromium.presented - chromium.contentful,
  };
}

/**
 * Launch with `open` on the command line and time the window to the first mark
 * showing `wanted`: from the main process's creation, which is when a person's
 * start begins, and from the call to `electron.launch`, which also pays for
 * Playwright's own connection and is printed for comparison.
 */
async function coldStart(open: string, wanted: (state: PaintState) => boolean): Promise<ColdStart> {
  const budgeted = await launchBudgeted({ open });
  try {
    const mark = await paintedState(budgeted.page, wanted);
    const main = await budgeted.application.evaluate(() => process.pid);
    const created = processTree(main)[0]?.createdAt ?? Number.NaN;
    const chromium = await checkedAgainstChromium(budgeted.page);
    process.stdout.write(
      `    painted ${String(mark.wall - created)} ms after the main process was created; ` +
        `the bar marked ${chromium.late.toFixed(1)} ms after Chromium painted it, ` +
        `presented ${chromium.presented.toFixed(0)} ms after that paint\n`,
    );
    return { fromCreation: mark.wall - created, fromLaunchCall: mark.wall - budgeted.launchedAt };
  } finally {
    await closeBudgeted(budgeted);
  }
}

/** The smallest of the readings. */
function fastest(values: readonly number[]): number {
  return Math.min(...values);
}

/** {@link READINGS} cold starts, one after another, and the fastest from process creation. */
async function coldStarts(open: string, wanted: (state: PaintState) => boolean): Promise<number> {
  const runs: ColdStart[] = [];
  for (let run = 0; run < READINGS; run += 1) {
    runs.push(await coldStart(open, wanted));
  }
  process.stdout.write(
    `  from process creation: ${described(runs.map((each) => each.fromCreation))} ms\n` +
      `  from the launch call:  ${described(runs.map((each) => each.fromLaunchCall))} ms\n`,
  );
  return fastest(runs.map((each) => each.fromCreation));
}

test.describe.configure({ timeout: 300_000 });

test('cold start to a painted window, empty repository', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-empty-'));
  try {
    execFileSync('git', ['init', '--quiet', empty], { stdio: 'ignore' });
    const quickest = await coldStarts(
      empty,
      (state) => state.path === empty && state.viewShown && state.rows === 0,
    );
    const comparison = holdToBaseline(
      'coldStartEmptyMilliseconds',
      'cold start to a painted window, empty repository, fastest of ten',
      quickest,
    );
    expect(comparison.failed).toBe(false);
  } finally {
    rmSync(empty, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('cold start to a painted first page, ten thousand commits on the command line', async () => {
  const large = fixture('large', 'large', 10_000);
  const quickest = await coldStarts(
    large,
    (state) =>
      state.path === large &&
      state.rows === 300 &&
      state.firstRow.includes('commit 10000') &&
      state.ink > 0,
  );
  const comparison = holdToBaseline(
    'coldStartOpenMilliseconds',
    'cold start to a painted first page of 300, fastest of ten',
    quickest,
  );
  expect(comparison.failed).toBe(false);
});

/** The rows of a whole ten-thousand-commit page, painted, after Refresh was pressed. */
function refreshedTenThousand(state: PaintState): boolean {
  return (
    state.refresh === 'Refresh' &&
    !state.refreshDisabled &&
    state.rows === 10_000 &&
    state.firstRow.includes('commit 10000') &&
    state.ink > 0
  );
}

/** Press Refresh {@link READINGS} times, a pause before each, and time each to its rows painted. */
async function timedRefreshes(page: Page): Promise<readonly number[]> {
  const runs: number[] = [];
  for (let run = 0; run < READINGS; run += 1) {
    await page.waitForTimeout(REFRESH_SPACING_MILLISECONDS);
    await page.evaluate(setMarking, true);
    const pressed = await page.evaluate(pressRefresh);
    const mark = await paintedState(page, refreshedTenThousand, pressed);
    runs.push(mark.paintedAt - pressed);
  }
  return runs;
}

/**
 * **Ten thousand commits as one load, without changing the product.**
 *
 * An open reads `FIRST_PAGE_COMMITS`, 300, and nothing on the bridge asks for
 * more in one read. A Refresh does: `src/app/repository-host.ts` reads the open
 * repository again at the size already loaded, into a fresh store, lays out
 * every row from a fresh layout state, and ships the whole page. So the case
 * first grows the utility process's state to 10 000 commits with one Load More
 * over the bridge — **without drawing it**, so the window still shows 300 rows —
 * and then presses Refresh, which is one read of git, one parse, one store, one
 * layout of 10 000 rows, two structured clones and one paint.
 *
 * What that leaves out of a real first open: finding git, which the reader
 * memoises on the first read, and starting the utility process, which the
 * client does on the first request. Both are paid inside the cold-start figures
 * above, and neither grows with the commits.
 *
 * Ten Refreshes in one window, each after a second's pause: the first draws
 * 10 000 rows over 300, the next nine draw 10 000 over 10 000, and each one's
 * mark is the first after its press to show the control back at rest over a
 * painted page of 10 000.
 */
test('ten thousand commits, one load, to rows painted', async () => {
  const large = fixture('large', 'large', 10_000);
  await withBudgeted({ open: large }, async ({ page }) => {
    await paintedState(page, (state) => state.path === large && state.rows === 300);
    await page.evaluate(() => {
      const scope = globalThis as unknown as {
        gitGraphical: { loadMoreCommits: (request: { count: number }) => Promise<unknown> };
      };
      return scope.gitGraphical.loadMoreCommits({ count: 9_700 });
    });
    const runs = await timedRefreshes(page);
    process.stdout.write(`  Refresh of 10000 to rows painted: ${described(runs)} ms\n`);
    const comparison = holdToBaseline(
      'load10000Milliseconds',
      'ten thousand commits read, laid out and painted, fastest of ten',
      fastest(runs),
    );
    expect(comparison.failed).toBe(false);
  });
});
