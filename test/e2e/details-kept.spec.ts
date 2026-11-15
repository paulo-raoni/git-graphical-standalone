import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { removeDirectory } from '../fixtures/shared-store';
import { scrollListTo } from './support/budgets-page';
import { ended, fixture } from './support/fixtures';

/**
 * What the Commit Details View keeps across restarts (E04-M01-S12, scope E): each
 * repository's height, divider and file view, and the application's options, in
 * files of the main process under the user-data directory, read at each open and
 * once at start.
 *
 * Each case launches twice on one `--user-data-dir` of its own and waits for the
 * process to end before the directory goes. The repositories are the shared
 * `details` and `stashes` fixtures, which no case writes into.
 */

test.describe.configure({ timeout: 300_000 });

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [AREA, EDGE, DIVIDER, INFO, FILES] = [
  '.details:not([hidden])',
  '.details__edge',
  '.details__divider',
  '.details__info',
  '.details__files',
];
const [A, B] = ['merge the side', 'On main: stash with an untracked file'];

const homes: string[] = [];
const children: ChildProcess[] = [];

test.afterAll(async () => {
  for (const child of children.splice(0)) await ended(child);
  for (const home of homes.splice(0)) removeDirectory(home);
});

function freshHome(): string {
  homes.push(mkdtempSync(join(tmpdir(), 'git-graphical-standalone-details-')));
  return homes.at(-1) ?? '';
}

/** The record file of a repository, as the main process names it. */
const recordOf = (home: string, repository: string): string =>
  join(home, 'details-layouts', createHash('sha256').update(resolve(repository)).digest('hex'));

/** Runs in the page: resolves after two animation frames, so what a task changed is drawn. */
function twoFrames(): Promise<void> {
  const scope = globalThis as unknown as {
    requestAnimationFrame: (callback: () => void) => number;
  };
  return new Promise((done) => {
    scope.requestAnimationFrame(() => {
      scope.requestAnimationFrame(() => {
        done();
      });
    });
  });
}

const painted = (page: Page): Promise<void> => page.evaluate(twoFrames);

/** Launch on `home` with `repository`, run `body`, close and require the process gone. */
async function withWindow(
  home: string,
  repository: string,
  body: (page: Page, application: ElectronApplication) => Promise<void>,
): Promise<void> {
  const application = await electron.launch({
    args: ['.', repository, `--user-data-dir=${home}`],
    cwd: repositoryRoot,
  });
  const child = application.process();
  children.push(child);
  try {
    const page = await application.firstWindow();
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 90_000 });
    await body(page, application);
  } finally {
    await application.close();
    expect(child.exitCode === null && !child.killed).toBe(false);
  }
}

async function box(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const found = await page.locator(selector).boundingBox();
  if (found === null) throw new Error(`${selector} has no box`);
  return { x: found.x, y: found.y, w: found.width, h: found.height };
}

async function drag(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const at = await box(page, selector);
  const [x, y] = [at.x + at.w / 2, at.y + at.h / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
  await painted(page);
}

async function show(page: Page, text: string): Promise<void> {
  await page.locator('.row', { hasText: text }).locator('.row__subject').first().click();
  await expect(page.locator('.row--open')).toContainText(text);
  await expect(page.locator(INFO)).not.toHaveText('Loading…');
  await painted(page);
}

/** Choose `value` of the option `title` from the open area's Options menu. */
async function choose(page: Page, title: string, value: string): Promise<void> {
  await page.locator(`${AREA} button[title="Options"]`).click();
  const lines = page.locator('.files__menu > *');
  const texts = (await lines.allTextContents()).map((text) => text.replace('●', ''));
  const heading = texts.indexOf(title);
  await lines.nth(texts.findIndex((text, at) => at > heading && text === value)).click();
  await painted(page);
}

/** The area's height and the left pane's share of the two panes, read from the boxes. */
async function sizes(page: Page): Promise<{ height: number; share: number; docked: boolean }> {
  const [area, info, files] = [
    await box(page, AREA),
    await box(page, INFO),
    await box(page, FILES),
  ];
  return {
    height: area.h,
    share: info.w / (files.x + files.w - info.x),
    docked: (await page.locator('.details--docked:not([hidden])').count()) === 1,
  };
}

/** The Options menu's lines, each chosen value marked, closed again. */
async function menu(page: Page): Promise<string[]> {
  await page.locator(`${AREA} button[title="Options"]`).click();
  const lines = await page.locator('.files__menu > *').allTextContents();
  await page.keyboard.press('Escape');
  await expect(page.locator('.files__menu')).toBeHidden();
  return lines;
}

const near = (value: number, wanted: number, within: number): void => {
  expect(
    Math.abs(value - wanted),
    `${String(value)} against ${String(wanted)}`,
  ).toBeLessThanOrEqual(within);
};

test('each repository keeps its own height, divider and view, across a restart', async () => {
  const [one, two] = [fixture('details', 'script', 6), fixture('stashes', 'script', 3)];
  const home = freshHome();
  let shared = 0;
  await withWindow(home, one, async (page, application) => {
    await show(page, A);
    await drag(page, EDGE, 0, 60);
    await drag(page, DIVIDER, -80, 0);
    await page.locator(`${AREA} button[title="File List View"]`).click();
    const mine = await sizes(page);
    expect(mine.height).toBe(310);
    shared = mine.share;
    // Nothing is kept for the second repository: it opens on the defaults, in this run.
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (): Promise<{ canceled: boolean; filePaths: string[] }> =>
        Promise.resolve({ canceled: false, filePaths: [path] });
    }, two);
    await page.getByRole('button', { name: 'Open Repository' }).click();
    await expect(page.locator('.row', { hasText: B }).first()).toBeVisible({ timeout: 90_000 });
    await show(page, B);
    expect(await sizes(page)).toMatchObject({ height: 250, docked: false });
    near((await sizes(page)).share, 0.5, 0.01);
    await expect(page.locator(`${AREA} button[title="File Tree View"]`)).toHaveClass(
      /details__tool--active/,
    );
  });
  expect(readdirSync(join(home, 'details-layouts'))).toHaveLength(1);
  await withWindow(home, one, async (page) => {
    await show(page, A);
    const kept = await sizes(page);
    expect(kept.height).toBe(310);
    near(kept.share, shared, 0.005);
    await expect(page.locator(`${AREA} button[title="File List View"]`)).toHaveClass(
      /details__tool--active/,
    );
  });
});

test('the options, and the place of the first area, survive a restart', async () => {
  const repository = fixture('details', 'script', 6);
  const home = freshHome();
  const expected = [
    'Default File View',
    'Tree',
    '●List',
    'Compact Folders',
    'On',
    '●Off',
    'Status Letters',
    '●On',
    'Off',
    'Location',
    'Inline',
    '●Docked to Bottom',
    'Auto Center',
    'On',
    '●Off',
  ];
  await withWindow(home, repository, async (page) => {
    await show(page, A);
    await choose(page, 'Default File View', 'List');
    await choose(page, 'Compact Folders', 'Off');
    await choose(page, 'Status Letters', 'On');
    await choose(page, 'Auto Center', 'Off');
    await choose(page, 'Location', 'Docked to Bottom');
    expect(await menu(page)).toEqual(expected);
  });
  expect(existsSync(join(home, 'details-options'))).toBe(true);
  await withWindow(home, repository, async (page) => {
    await show(page, A);
    expect((await sizes(page)).docked).toBe(true);
    expect(await menu(page)).toEqual(expected);
    await expect(page.locator('.files__row--folder:not([hidden])')).toHaveCount(0);
  });
});

test('a record that is not one is nothing kept, and the window works', async () => {
  const repository = fixture('details', 'script', 6);
  for (const [options, layout] of [
    ['{ not json', '{ "height": 119, "divider": 0.5, "fileView": null }'],
    ['{"place":"floating"}', '{ "height": 250, "divider": 0.9, "fileView": null }'],
    ['null', '{ "height": 250, "divider": 0.5, "fileView": "grid" }'],
  ] as const) {
    const home = freshHome();
    mkdirSync(join(home, 'details-layouts'), { recursive: true });
    writeFileSync(join(home, 'details-options'), options);
    writeFileSync(recordOf(home, repository), layout);
    await withWindow(home, repository, async (page) => {
      await show(page, A);
      expect(await sizes(page)).toMatchObject({ height: 250, docked: false });
      near((await sizes(page)).share, 0.5, 0.01);
      expect((await menu(page)).filter((line) => line.startsWith('●'))).toEqual([
        '●Tree',
        '●On',
        '●Off',
        '●Inline',
        '●On',
      ]);
    });
  }
});

test('an open, a click that opens an area and a scroll write no record', async () => {
  const repository = fixture('details', 'script', 6);
  const home = freshHome();
  await withWindow(home, repository, async (page) => {
    await show(page, A);
    await page.evaluate(scrollListTo, 40);
    await painted(page);
  });
  expect(existsSync(join(home, 'details-layouts'))).toBe(false);
  expect(existsSync(join(home, 'details-options'))).toBe(false);
});
