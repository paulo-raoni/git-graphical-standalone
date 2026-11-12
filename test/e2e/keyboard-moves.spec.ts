import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { DETAILS_HEIGHT, ROW_HEIGHT } from '../../src/ui/geometry';

import { fixture, withOwnProfile } from './support/fixtures';

/**
 * The keys that move the open details between commits (E04-M01-S11), in the
 * built application: Up and Down, Ctrl+Up and Ctrl+Down, with Shift for the
 * other branch, and what each opens and where the view sits afterwards.
 *
 * Every row opened is read from the details it shows (its `Commit:` line, or the
 * uncommitted sentence) and compared with a literal. A hash is what `git
 * rev-parse` prints for a revision written out by hand below, never what the code
 * under test says. No key of the reference extension was observed
 * (`docs/plan/E04-commit-details-comparison-and-diff/M01-commit-details-view/S11-keyboard-navigation.md`).
 */

const SLOW_TEST_MS = 240_000;
const UNCOMMITTED = 'Displaying all uncommitted changes.';
const INFO = '.details__info';
const OPEN_ROW = '.row--open .row__subject';

const revisions = (repository: string, ...names: string[]): string[] =>
  execFileSync('git', ['-C', repository, 'rev-parse', ...names], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

/** Launch on `repository`, wait for a row, run `body`, close. */
async function withWindow(
  repository: string,
  body: (page: Page, application: ElectronApplication) => Promise<void>,
): Promise<void> {
  await withOwnProfile({ open: repository }, async (application) => {
    const page = await application.firstWindow();
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await body(page, application);
  });
}

/** Count the calls the main process answers on `channel` from now on, and say how many there have been. */
async function countCalls(
  application: ElectronApplication,
  channel: string,
): Promise<() => Promise<number>> {
  await application.evaluate(({ ipcMain }, name) => {
    const scope = globalThis as unknown as { asked: number };
    scope.asked = 0;
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
    )._invokeHandlers;
    const handler = handlers.get(name);
    handlers.set(name, (...args: unknown[]) => {
      scope.asked += 1;
      return handler?.(...args);
    });
  }, channel);
  return () => application.evaluate(() => (globalThis as unknown as { asked: number }).asked);
}

/** Click the row whose subject is `text` and wait for its reply to be drawn. */
async function open(page: Page, text: string): Promise<void> {
  await page.locator('.row', { hasText: text }).locator('.row__subject').click();
  await expect(page.locator(INFO)).not.toHaveText('Loading…');
}

/** What the open details say they are of: the uncommitted sentence, or the `Commit:` line. */
async function shown(page: Page): Promise<string> {
  await expect(page.locator(INFO)).not.toHaveText('Loading…');
  const text = (await page.locator(INFO).innerText()).trim();
  return text === UNCOMMITTED ? text : (text.split('\n')[0] ?? '');
}

/** Wait until two frames have run, so that a key that changes nothing has had its chance to. */
const settle = (page: Page): Promise<unknown> =>
  page.evaluate(() => {
    const { requestAnimationFrame: frame } = globalThis as unknown as {
      requestAnimationFrame: (call: () => void) => void;
    };
    return new Promise<void>((done) => {
      frame(() => {
        frame(done);
      });
    });
  });

/** Press `key` and expect the details to show `want` (a `Commit:` line, or the sentence). */
async function expectMove(page: Page, key: string, want: string): Promise<void> {
  await page.keyboard.press(key);
  await expect.poll(() => shown(page), { message: key }).toBe(want);
}

/** Press `key` and expect the open row and its details not to change. */
async function expectStill(page: Page, key: string): Promise<void> {
  const [row, details] = [await page.locator(OPEN_ROW).textContent(), await shown(page)];
  await page.keyboard.press(key);
  await settle(page);
  expect([await page.locator(OPEN_ROW).textContent(), await shown(page)], key).toEqual([
    row,
    details,
  ]);
}

test('Up and Down open every row in turn, and stop at the first and the last', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const repository = fixture('details', 'script', 6);
  // Rows: 0 uncommitted, 1 the merge, 2 and 3 its parents (main^1, main^2), 4 their parent, 5, 6 the root.
  const [merge = '', first = '', side = '', fourth = '', fifth = '', root = ''] = revisions(
    repository,
    'main',
    'main^1',
    'main^2',
    'main~2',
    'main~3',
    'main~4',
  );
  await withWindow(repository, async (page) => {
    await open(page, 'Uncommitted changes');
    await expectStill(page, 'ArrowUp');
    const down = [merge, first, side, fourth, fifth, root].map((hash) => `Commit: ${hash}`);
    for (const want of down) await expectMove(page, 'ArrowDown', want);
    await expectStill(page, 'ArrowDown');
    for (const want of [...down.slice(0, -1).reverse(), UNCOMMITTED]) {
      await expectMove(page, 'ArrowUp', want);
    }
    await expectStill(page, 'ArrowUp');
  });
});

test('Ctrl+Up and Ctrl+Down follow the first parent and its child; Shift takes the other branch', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const repository = fixture('details', 'script', 6);
  const [merge = '', first = '', side = '', fourth = '', root = ''] = revisions(
    repository,
    'main',
    'main^1',
    'main^2',
    'main~2',
    'main~4',
  );
  await withWindow(repository, async (page) => {
    await open(page, 'Uncommitted changes');
    await expectStill(page, 'Control+ArrowUp');
    await expectMove(page, 'Control+ArrowDown', `Commit: ${merge}`);
    await expectMove(page, 'Control+ArrowDown', `Commit: ${first}`);
    await expectMove(page, 'Control+ArrowUp', `Commit: ${merge}`);
    await expectMove(page, 'Control+Shift+ArrowDown', `Commit: ${side}`);
    // The tip of the merged branch has the merge as its only child, so both Ups go there.
    await expectMove(page, 'Control+Shift+ArrowUp', `Commit: ${merge}`);
    await expectMove(page, 'Control+Shift+ArrowDown', `Commit: ${side}`);
    await expectMove(page, 'Control+ArrowUp', `Commit: ${merge}`);
    await expectMove(page, 'Control+ArrowUp', UNCOMMITTED);
    await open(page, 'remove the names Windows cannot check out');
    // Row 4 has two children, rows 2 (lane 0) and 3 (lane 1); it sits in lane 0.
    await expectMove(page, 'Control+ArrowUp', `Commit: ${first}`);
    await expectMove(page, 'Control+ArrowDown', `Commit: ${fourth}`);
    await expectMove(page, 'Control+Shift+ArrowUp', `Commit: ${side}`);
    await open(page, 'begin the details history');
    await expectStill(page, 'Control+ArrowDown');
    await expectStill(page, 'Control+Shift+ArrowDown');
    expect(await shown(page)).toBe(`Commit: ${root}`);
  });
});

test('Ctrl+Up and Ctrl+Shift+Up open the two children of a fork by their lanes', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const repository = fixture('branch-and-merge', 'branch-and-merge', 3);
  const [main = '', feature = '', base = ''] = revisions(repository, 'main^1', 'main^2', 'main~2');
  await withWindow(repository, async (page) => {
    // The page's lanes by row: the merge 0, "move main on" 0, "add the feature" 1, then 0 for
    // "commit 3", "commit 2" and "commit 1". "commit 3" is the fork, in lane 0: its children are
    // rows 1 (lane 0) and 2 (lane 1), and the nearer is the one in lane 1.
    const lanes = await page.evaluate(async () => {
      const scope = globalThis as unknown as {
        gitGraphical: { refresh: (request: object) => Promise<{ value: { layout: object } }> };
      };
      const { layout } = (await scope.gitGraphical.refresh({})).value;
      return Array.from((layout as { laneIndex: Uint16Array }).laneIndex);
    });
    expect(lanes).toEqual([0, 0, 1, 0, 0, 0]);
    await open(page, 'commit 3');
    expect(await shown(page)).toBe(`Commit: ${base}`);
    await expectMove(page, 'Control+ArrowUp', `Commit: ${main}`);
    await expectMove(page, 'Control+ArrowDown', `Commit: ${base}`);
    await expectMove(page, 'Control+Shift+ArrowUp', `Commit: ${feature}`);
  });
});

test('Ctrl+Down on the newest stash opens the commit it was made on', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const repository = fixture('stashes', 'script', 3);
  const [base = ''] = revisions(repository, 'main');
  await withWindow(repository, async (page) => {
    await open(page, 'On main: stash with an untracked file');
    await expectMove(page, 'Control+ArrowDown', `Commit: ${base}`);
    await expectMove(page, 'Control+ArrowUp', UNCOMMITTED);
  });
});

/** Set the scroll offset of the list. */
const scrollTo = (page: Page, offset: number): Promise<void> =>
  page.locator('.graph__scroll').evaluate((each, to) => {
    (each as unknown as { scrollTop: number }).scrollTop = to;
  }, offset);

/** Scroll the list to `offset`, wait for the rows to be drawn, and click the row at layout row `row`. */
async function openAt(page: Page, offset: number, row: number): Promise<void> {
  await scrollTo(page, offset);
  const mine = page.locator(`.row[style*="translateY(${String(row * ROW_HEIGHT)}px)"]`);
  await expect(mine).toBeVisible();
  await mine.locator('.row__subject').click();
  await expect(mine).toHaveClass(/row--open/);
}

/** Where the open block sits in the list: the top of its row, and the height of row and area together. */
async function blockOf(page: Page): Promise<number[]> {
  const [list, row, area] = await Promise.all([
    page.locator('.graph__canvas').boundingBox(),
    page.locator('.row--open').boundingBox(),
    page.locator('.details').boundingBox(),
  ]);
  const [listTop, rowTop] = [list?.y ?? 0, row?.y ?? 0];
  return [Math.round(rowTop - listTop), Math.round((area?.y ?? 0) + (area?.height ?? 0) - rowTop)];
}

test('a key keeps the opened block centred, even after the open row was scrolled away', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(fixture('remotes', 'remotes', 5000), async (page) => {
    const rows = await page
      .locator('.graph__spacer')
      .evaluate((each) => (each as unknown as { clientHeight: number }).clientHeight / 24);
    expect(rows).toBeGreaterThan(200);
    const middle = Math.floor(rows / 2);
    await openAt(page, (middle - 5) * ROW_HEIGHT, middle);
    const height = (await page.locator('.graph__canvas').boundingBox())?.height ?? 0;
    const block = ROW_HEIGHT + DETAILS_HEIGHT;
    const centred = async (): Promise<void> => {
      await expect
        .poll(async () => {
          const [top = 0, size = 0] = await blockOf(page);
          return [Math.abs(top - (height - block) / 2) <= 1, size];
        })
        .toEqual([true, block]);
    };
    await centred();
    for (const key of ['ArrowDown', 'ArrowDown', 'Control+ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key);
      await centred();
    }
    // Scrolled far away from the open row, which leaves the pool, a move brings its successor back.
    await scrollTo(page, 0);
    await expect(page.locator('.row--open')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await centred();
    // Near the end of the loaded page the view stops at its end.
    await page.locator('.details__close').click();
    await openAt(page, (rows - 8) * ROW_HEIGHT, rows - 3);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(() =>
        page.locator('.graph__scroll').evaluate((each) => {
          const node = each as unknown as {
            scrollTop: number;
            clientHeight: number;
            scrollHeight: number;
          };
          return node.scrollHeight - node.scrollTop - node.clientHeight <= 1;
        }),
      )
      .toBe(true);
    await expect(page.locator(OPEN_ROW)).toHaveCount(1);
  });
});

test('Down on the last loaded row changes nothing and asks for no more commits', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(fixture('remotes', 'remotes', 5000), async (page, application) => {
    const rows = await page
      .locator('.graph__spacer')
      .evaluate((each) => (each as unknown as { clientHeight: number }).clientHeight / 24);
    const asked = await countCalls(application, 'repository:load-more-commits');
    await openAt(page, (rows - 8) * ROW_HEIGHT, rows - 1);
    const text = await page.locator(OPEN_ROW).textContent();
    await expectStill(page, 'ArrowDown');
    await expectStill(page, 'Control+ArrowDown');
    expect(await page.locator(OPEN_ROW).textContent()).toBe(text);
    expect(await page.locator('.graph__more').textContent()).toBe('Load More Commits');
    expect(await page.locator('.graph__more').isDisabled()).toBe(false);
    expect(await asked()).toBe(0);
    expect(
      await page
        .locator('.graph__spacer')
        .evaluate((each) => (each as unknown as { clientHeight: number }).clientHeight),
    ).toBe(rows * ROW_HEIGHT + DETAILS_HEIGHT);
  });
});
