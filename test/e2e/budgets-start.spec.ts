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
  median,
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
 * **Every figure is five readings and the median is what is compared**, with all
 * five and their range printed beside it. One reading of a wall clock is a draw;
 * the median of five is not moved by one run that met a busy machine, and is
 * moved by a regression, which moves every run. Each case holds its median to
 * `perf/baselines.json` under the regime the run is in (`regimeOf` in
 * `perf/baselines.ts`): strictly on the development machine, and four times wider
 * on a CI runner.
 *
 * "Painted" is a mark of `./support/budgets-page.ts`: the second animation frame
 * after the change that brought the state about, which cannot run before that
 * change was painted, and shows it — the path in the bar, the rows in the list,
 * ink on the graph canvas.
 */

/** A cold start, in milliseconds from the operating system creating the process. */
interface ColdStart {
  readonly fromCreation: number;
  readonly fromLaunchCall: number;
}

/** Runs in the page: the first contentful paint, as Chromium timed it. */
function firstContentfulPaint(): { paintTime: number; presentationTime: number } {
  interface Entry {
    readonly name: string;
    readonly startTime: number;
    readonly paintTime?: number;
    readonly presentationTime?: number;
  }
  const scope = globalThis as unknown as {
    performance: { getEntriesByType: (type: string) => Entry[] };
  };
  const entry = scope.performance
    .getEntriesByType('paint')
    .find((each) => each.name === 'first-contentful-paint');
  return {
    paintTime: entry?.paintTime ?? Number.NaN,
    presentationTime: entry?.presentationTime ?? entry?.startTime ?? Number.NaN,
  };
}

/**
 * Hold the probe to Chromium's own clock: the first mark the window took may not
 * be earlier than the first contentful paint's main-thread paint.
 */
async function checkedAgainstChromium(page: Page): Promise<number> {
  const first = (await page.evaluate(readProbe)).marks[0];
  const chromium = await page.evaluate(firstContentfulPaint);
  expect(first).toBeDefined();
  expect(first?.paintedAt ?? 0).toBeGreaterThanOrEqual(chromium.paintTime);
  return chromium.presentationTime - chromium.paintTime;
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
    const presentation = await checkedAgainstChromium(budgeted.page);
    process.stdout.write(
      `    painted ${String(mark.wall - created)} ms after the main process was created; ` +
        `first contentful paint presented ${presentation.toFixed(0)} ms after it was painted\n`,
    );
    return { fromCreation: mark.wall - created, fromLaunchCall: mark.wall - budgeted.launchedAt };
  } finally {
    await closeBudgeted(budgeted);
  }
}

async function fiveColdStarts(
  open: string,
  wanted: (state: PaintState) => boolean,
): Promise<readonly ColdStart[]> {
  const runs: ColdStart[] = [];
  for (let run = 0; run < 5; run += 1) {
    runs.push(await coldStart(open, wanted));
  }
  process.stdout.write(
    `  from process creation: ${described(runs.map((each) => each.fromCreation))} ms\n` +
      `  from the launch call:  ${described(runs.map((each) => each.fromLaunchCall))} ms\n`,
  );
  return runs;
}

test.describe.configure({ timeout: 300_000 });

test('cold start to a painted window, empty repository', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-empty-'));
  try {
    execFileSync('git', ['init', '--quiet', empty], { stdio: 'ignore' });
    const runs = await fiveColdStarts(
      empty,
      (state) => state.path === empty && state.viewShown && state.rows === 0,
    );
    const comparison = holdToBaseline(
      'coldStartEmptyMilliseconds',
      'cold start to a painted window, empty repository, median of five',
      median(runs.map((each) => each.fromCreation)),
    );
    expect(comparison.failed).toBe(false);
  } finally {
    rmSync(empty, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('cold start to a painted first page, ten thousand commits on the command line', async () => {
  const large = fixture('large', 'large', 10_000);
  const runs = await fiveColdStarts(
    large,
    (state) =>
      state.path === large &&
      state.rows === 300 &&
      state.firstRow.includes('commit 10000') &&
      state.ink > 0,
  );
  const comparison = holdToBaseline(
    'coldStartOpenMilliseconds',
    'cold start to a painted first page of 300, median of five',
    median(runs.map((each) => each.fromCreation)),
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
 * Five Refreshes in one window: the first draws 10 000 rows over 300, the next
 * four draw 10 000 over 10 000, and each one's mark is the first after its press
 * to show the control back at rest over a painted page of 10 000.
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
    const runs: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      await page.evaluate(setMarking, true);
      const pressed = await page.evaluate(pressRefresh);
      const mark = await paintedState(page, refreshedTenThousand, pressed);
      runs.push(mark.paintedAt - pressed);
    }
    process.stdout.write(`  Refresh of 10000 to rows painted: ${described(runs)} ms\n`);
    const comparison = holdToBaseline(
      'load10000Milliseconds',
      'ten thousand commits read, laid out and painted, median of five',
      median(runs),
    );
    expect(comparison.failed).toBe(false);
  });
});
