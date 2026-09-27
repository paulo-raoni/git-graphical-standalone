import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { GitGraphicalBridge, GraphPage } from '../../src/contracts/index';
import { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from '../../src/core/page/index';
import { ROW_HEIGHT } from '../../src/ui/geometry';
import { fixture, ownFixture, removeOwnFixtures } from './support/fixtures';

/**
 * A Load More appends only onto the history its rows were laid out from.
 *
 * Load More reads the whole page again, larger, and lays out only the rows past
 * the ones already shown. Review round 15 of E01-M01 changed the repository
 * between the open and the press — a branch cut a hundred commits down, and one
 * commit on it, which is then the newest commit — and the press answered the
 * right six hundred commits under a layout of a different history: the new
 * commit drawn as the child of the old tip in one straight line, where a Refresh
 * a moment later drew it on its own lane (finding F-32). This suite runs that
 * sequence in the built application and requires the Load More reply's layout to
 * equal, column for column, the one a Refresh answers right after it.
 *
 * **Its own file, with its own copy of two helpers**, for the reason
 * `test/e2e/superseded-reply.spec.ts` gives: `test/e2e/open-repository.spec.ts`
 * was at the line limit the lint gate holds every module to when this suite was
 * written. The repositories
 * come from `test/e2e/support/fixtures.ts`: the unchanged one is shared with the
 * other suites and every run on the machine, and the one this suite writes a
 * branch and a commit into is this run's own, built for the case and removed
 * after it, as that file's refresh case does with its own.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Long enough for the ten-thousand-commit fixture to be written and read. */
const SLOW_TEST_MS = 240_000;

const MORE = '.graph__more';

/** Run git in `repository` as a person at the keyboard would, while the window is open. */
function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Fixture Author',
      GIT_AUTHOR_EMAIL: 'author@fixture.invalid',
      GIT_COMMITTER_NAME: 'Fixture Committer',
      GIT_COMMITTER_EMAIL: 'committer@fixture.invalid',
    },
  }).trim();
}

/* --- What runs inside the page. `tsconfig.node.json` has no DOM library, so
   every element this touches is described here rather than borrowed. --- */

interface PageScope {
  readonly document: {
    readonly querySelector: (selector: string) => { readonly clientHeight: number } | null;
  };
  readonly gitGraphical: GitGraphicalBridge;
  readonly gitGraphicalView?: { readonly showPage: (page: GraphPage) => void };
}

/** How many rows the table's spacer is sized for, which is the page's own row count. */
function tableRows(rowHeight: number): number {
  const spacer = (globalThis as unknown as PageScope).document.querySelector('.graph__spacer');
  return spacer === null ? -1 : Math.round(spacer.clientHeight / rowHeight);
}

/** Every column of a page's layout, as plain numbers, so two can be compared entry for entry. */
type LayoutColumns = {
  rowCount: number;
  maxLane: number;
  laneIndex: number[];
  colourIndex: number[];
  flags: number[];
  segmentOffsets: number[];
  segmentFromLane: number[];
  segmentToLane: number[];
  segmentColour: number[];
};

/** One reply: the object names it holds, as hex, newest first, and its layout. */
type Answered = { names: string; layout: LayoutColumns };

/**
 * Press Load More over the bridge and draw its reply, then Refresh over the
 * bridge and draw that; return both. Everything is converted inside the page,
 * because a function passed to `evaluate` is sent as its source and can call
 * nothing defined outside it.
 */
async function loadMoreThenRefresh(count: number): Promise<{ more: Answered; again: Answered }> {
  const scope = globalThis as unknown as PageScope;
  const answered = (page: GraphPage): Answered => {
    const layout = page.layout;
    return {
      names: Array.from(page.commits.hashes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      layout: {
        rowCount: layout.rowCount,
        maxLane: layout.maxLane,
        laneIndex: Array.from(layout.laneIndex),
        colourIndex: Array.from(layout.colourIndex),
        flags: Array.from(layout.flags),
        segmentOffsets: Array.from(layout.segmentOffsets),
        segmentFromLane: Array.from(layout.segmentFromLane),
        segmentToLane: Array.from(layout.segmentToLane),
        segmentColour: Array.from(layout.segmentColour),
      },
    };
  };
  const more = await scope.gitGraphical.loadMoreCommits({ count });
  if (!more.ok) {
    throw new Error(more.message);
  }
  scope.gitGraphicalView?.showPage(more.value);
  const again = await scope.gitGraphical.refresh({});
  if (!again.ok) {
    throw new Error(again.message);
  }
  scope.gitGraphicalView?.showPage(again.value);
  return { more: answered(more.value), again: answered(again.value) };
}

/** What a layout comes to, which is what a failure should say first. */
function shapeOf(layout: LayoutColumns): { rows: number; maxLane: number; segments: number } {
  return { rows: layout.rowCount, maxLane: layout.maxLane, segments: layout.segmentColour.length };
}

/* --- Driving the built application. --- */

/**
 * Launch the built application on `open`, run `body` against its window, and
 * stop it; the exit status is read back, because a leaked Electron process is a
 * failure whatever the assertions said, and the utility process is its child.
 */
async function withWindow(open: string, body: (page: Page) => Promise<void>): Promise<void> {
  const application = await electron.launch({ args: ['.', open], cwd: repositoryRoot });
  try {
    await body(await application.firstWindow());
  } finally {
    const child = application.process();
    await application.close();
    expect(child.exitCode === null && !child.killed).toBe(false);
  }
}

/** Open `repository`, let `change` run while it is open, then Load More and Refresh. */
async function pressAfter(
  repository: string,
  change: () => void,
): Promise<{ more: Answered; again: Answered }> {
  const replies: { more: Answered; again: Answered }[] = [];
  await withWindow(repository, async (page) => {
    await expect(page.locator(MORE)).toBeVisible();
    expect(await page.evaluate(tableRows, ROW_HEIGHT)).toBe(FIRST_PAGE_COMMITS);
    change();
    const answered = await page.evaluate(loadMoreThenRefresh, FURTHER_PAGE_COMMITS);
    expect(await page.evaluate(tableRows, ROW_HEIGHT)).toBe(answered.again.layout.rowCount);
    replies.push(answered);
  });
  const [answered] = replies;
  if (answered === undefined) {
    throw new Error('the window closed before both replies arrived');
  }
  return answered;
}

test.beforeAll(() => {
  if (!existsSync(join(repositoryRoot, 'dist', 'main.cjs'))) {
    throw new Error('run `npm run build` before the end-to-end gate');
  }
});

test.afterEach(removeOwnFixtures);

test('a load more after a commit on a new branch lays out the history as it now is', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const target = ownFixture('stale-load-more', 'large', 10_000);
  let head = '';
  const { more, again } = await pressAfter(target, () => {
    git(target, ['checkout', '--quiet', '-b', 'side', 'main~100']);
    git(target, ['commit', '--quiet', '--allow-empty', '-m', 'made on a side branch while open']);
    head = git(target, ['rev-parse', 'HEAD']);
  });
  const grown = FIRST_PAGE_COMMITS + FURTHER_PAGE_COMMITS;
  // The same commits, hash for hash, with the new one first: any difference
  // below is the layout's and nothing else's.
  expect(more.names).toBe(again.names);
  expect(more.names.startsWith(head)).toBe(true);
  // The side branch is a lane of its own. A layout without one is the graph
  // round 15 saw, and the comparison below would then compare nothing.
  expect(shapeOf(again.layout)).toEqual({ rows: grown, maxLane: 1, segments: grown + 101 });
  expect(shapeOf(more.layout)).toEqual(shapeOf(again.layout));
  expect(more.layout).toEqual(again.layout);
});

test('a load more of a repository that has not changed still appends what a refresh lays out', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const { more, again } = await pressAfter(fixture('large', 'large', 10_000), () => undefined);
  const grown = FIRST_PAGE_COMMITS + FURTHER_PAGE_COMMITS;
  expect(more.names).toBe(again.names);
  expect(shapeOf(again.layout)).toEqual({ rows: grown, maxLane: 0, segments: grown });
  expect(more.layout).toEqual(again.layout);
});
