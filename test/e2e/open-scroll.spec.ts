import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { ROW_HEIGHT } from '../../src/ui/geometry';
import { fixture } from './support/fixtures';

/**
 * A repository opened in the window starts at its newest commit.
 *
 * The view keeps its scroll offset when it is handed a page, which is what Load
 * More and Refresh need. Review round 15 of E01-M01 measured what that did to an
 * open (finding F-34): the ten-thousand-commit fixture scrolled to row 150, Open
 * Repository answered with another ten-thousand-commit repository, and the new
 * one appeared at the same 3 600 pixels, its newest commits above the top of the
 * window. This suite drives that sequence through the built application and
 * requires the offset to be 0 afterwards and the row at the top to be the new
 * repository's newest commit; then the same for opening the repository already
 * open; then that a Refresh still keeps the offset, so the reset is the open's
 * alone. The Load More half of "only an open resets it" is
 * `test/e2e/open-repository.spec.ts`, which requires that offset to be kept.
 *
 * **The second repository has the same shape and a different clock.** Two
 * repositories built from one recipe are the same commits with the same object
 * names, so "the new repository's newest commit" could not be told from the old
 * one's. Starting the clock one second later gives every commit of the second a
 * different name while keeping its ten thousand commits and their subjects, and
 * the check reads that name from git rather than assuming it.
 *
 * **Its own file, with its own copy of three helpers**, for the reason
 * `test/e2e/superseded-reply.spec.ts` gives: `open-repository.spec.ts` is at the
 * line limit the lint gate holds every module to. The repositories come from
 * `test/e2e/support/fixtures.ts`, so this suite shares one copy of the large
 * repository with the other suites and every run on the machine; its fourth
 * argument is the later clock. This suite writes into neither repository.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Long enough for a ten-thousand-commit fixture to be written and read. */
const SLOW_TEST_MS = 240_000;

/** Round 15's offset: row 150, 3 600 pixels at 24 a row. */
const ROUND_15_OFFSET = 150 * ROW_HEIGHT;

const MORE = '.graph__more';
const OPEN = '.bar__open';
const REFRESH = '.bar__refresh';
const PATH = '.bar__path';

/** The abbreviated name the Commit column shows for `HEAD` of `directory`, as git reports it. */
function newestCommit(directory: string): string {
  const full = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return full.trim().slice(0, 8);
}

/* --- What runs inside the page. `tsconfig.node.json` has no DOM library, so
   every element this touches is described here rather than borrowed. --- */

interface ScrollLike {
  scrollTop: number;
}

interface RowLike {
  readonly style: { readonly transform: string };
  readonly textContent: string | null;
  readonly hidden: boolean;
}

interface PageScope {
  readonly document: {
    readonly querySelector: (selector: string) => ScrollLike | null;
    readonly querySelectorAll: (selector: string) => Iterable<RowLike>;
  };
}

/** The table's scroll offset, in pixels, or -1 when there is no table. */
function readScroll(): number {
  const scroll = (globalThis as unknown as PageScope).document.querySelector('.graph__scroll');
  return scroll === null ? -1 : scroll.scrollTop;
}

function setScroll(offset: number): number {
  const scroll = (globalThis as unknown as PageScope).document.querySelector('.graph__scroll');
  if (scroll === null) {
    return -1;
  }
  scroll.scrollTop = offset;
  return scroll.scrollTop;
}

/**
 * What the row standing at `top` inside the scrolled area says, found by the
 * transform its pool element carries: the pool puts a row in slot `row modulo
 * pool size`, so the first `.row` in the document is not the top row.
 */
function rowTextAt(top: number): string {
  for (const row of (globalThis as unknown as PageScope).document.querySelectorAll('.row')) {
    if (!row.hidden && row.style.transform === `translateY(${String(top)}px)`) {
      return row.textContent ?? '';
    }
  }
  return '';
}

/* --- Driving the built application. --- */

/**
 * Launch the built application on `open`, run `body` against its window, and
 * stop it; the exit status is read back, because a leaked Electron process is a
 * failure whatever the assertions said, and the utility process is its child.
 */
async function withWindow(
  open: string,
  body: (page: Page, application: ElectronApplication) => Promise<void>,
): Promise<void> {
  const application = await electron.launch({ args: ['.', open], cwd: repositoryRoot });
  try {
    await body(await application.firstWindow(), application);
  } finally {
    const child = application.process();
    await application.close();
    expect(child.exitCode === null && !child.killed).toBe(false);
  }
}

/**
 * Answer the folder dialog with `chosen`. It runs in the main process, which is
 * the only place it can be answered; the handler looks `showOpenDialog` up on
 * `dialog` at every call.
 */
async function answerTheDialog(application: ElectronApplication, chosen: string): Promise<void> {
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, chosen);
}

/** Scroll to round 15's offset and wait until a row is drawn there. */
async function scrollDown(page: Page): Promise<void> {
  expect(await page.evaluate(setScroll, ROUND_15_OFFSET)).toBe(ROUND_15_OFFSET);
  await expect.poll(() => page.evaluate(rowTextAt, ROUND_15_OFFSET)).toContain('commit');
}

/**
 * Press a control of the bar and wait for its request to be answered. The click
 * handler disables the control before it awaits anything, and `whileBusy` in
 * `src/ui/renderer.ts` enables it again only after the reply has been drawn.
 */
async function pressAndWait(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click();
  await expect(page.locator(selector)).toBeEnabled();
}

/** The window shows `directory` from its first row, and that row is `newest`. */
async function expectFromTheTop(page: Page, directory: string, newest: string): Promise<void> {
  await expect(page.locator(PATH)).toHaveText(directory);
  expect(await page.evaluate(readScroll)).toBe(0);
  await expect.poll(() => page.evaluate(rowTextAt, 0)).toContain(newest);
  expect(await page.evaluate(rowTextAt, 0)).toContain('commit 10000');
}

test.beforeAll(() => {
  if (!existsSync(join(repositoryRoot, 'dist', 'main.cjs'))) {
    throw new Error('run `npm run build` before the end-to-end gate');
  }
});

test('opening another repository shows it from its newest commit', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  const other = fixture('large-a-second-later', 'large', 10_000, 1);
  const newest = newestCommit(other);
  expect(newest).not.toBe(newestCommit(large));
  await withWindow(large, async (page, application) => {
    await expect(page.locator(MORE)).toBeVisible();
    await scrollDown(page);
    await answerTheDialog(application, other);
    await pressAndWait(page, OPEN);
    await expectFromTheTop(page, other, newest);
  });
});

test('opening the repository already open shows it from its newest commit', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  await withWindow(large, async (page, application) => {
    await expect(page.locator(MORE)).toBeVisible();
    await scrollDown(page);
    await answerTheDialog(application, large);
    await pressAndWait(page, OPEN);
    await expectFromTheTop(page, large, newestCommit(large));
  });
});

test('a refresh keeps the scroll offset, so only an open resets it', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  await withWindow(large, async (page) => {
    await expect(page.locator(MORE)).toBeVisible();
    await scrollDown(page);
    const onTop = await page.evaluate(rowTextAt, ROUND_15_OFFSET);
    await pressAndWait(page, REFRESH);
    expect(await page.evaluate(readScroll)).toBe(ROUND_15_OFFSET);
    expect(await page.evaluate(rowTextAt, ROUND_15_OFFSET)).toBe(onTop);
  });
});
