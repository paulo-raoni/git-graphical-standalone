import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

import { fixture, withOwnProfile } from './support/fixtures';

/**
 * A choice that cannot be kept for the next start is said in a notice inside the
 * window that blocks nothing (E04-M01-S13), in place of the message box
 * E04-M01-S03 raised, which the owner met blocking their screen on 2026-11-04.
 *
 * Each case makes the write fail the way the disk would, by putting something in
 * the profile where the file goes, and makes the choice through the window's own
 * controls, so the notice is reached only through a real failed write and the
 * message the main process sends. It reads the notice by its role and its text,
 * uses a control of the graph with the notice still open, closes the notice from
 * the keyboard, and fails twice to hold that each kind is said once.
 *
 * **That no message box was asked for** is held by {@link withOwnProfile}, which
 * replaces every message box of the main process with a recorder for the whole
 * case and fails the case when one was asked for.
 */

test.describe.configure({ timeout: 180_000 });

/** The line the main process writes to its standard error at each failed write. */
const THEME_LINE = 'The theme could not be kept';
const SELECTION_LINE = 'The branch selection could not be kept';
/** What every notice says after the choice, before the file. */
const STILL_APPLIES =
  'It still applies until the application closes, but the next start will not have it. ' +
  'This file could not be written: ';

/** What the page-side function below touches. `tsconfig.node.json` has no DOM library. */
interface PageScope {
  readonly document: { readonly querySelectorAll: (selector: string) => { length: number } };
  readonly gitGraphical: { readonly themeChoice: () => Promise<unknown> };
}

/**
 * Runs in the page: how many notices the strip holds once a request to the main
 * process has been answered. Every message the main process sent this window
 * before that answer has arrived by then, as messages of one window arrive in the
 * order they were sent; the probe that sends a second notice of one kind, which
 * this count then reads, is what measured it (E04-M01-S13's audit).
 */
async function noticesAfterRoundTrip(): Promise<number> {
  const scope = globalThis as unknown as PageScope;
  await scope.gitGraphical.themeChoice();
  return scope.document.querySelectorAll('[role="status"] .notice').length;
}

/** The strip, found as assistive technology finds it. */
const strip = (page: Page): Locator => page.getByRole('status');
/** What the notice says, without its Close control. */
const notice = (page: Page): Locator => strip(page).getByRole('paragraph');
const theme = (page: Page): Locator => page.getByRole('combobox', { name: 'Theme' });
const branches = (page: Page): Locator => page.getByRole('button', { name: /^Branches:/ });

/** How many times `line` is on the application's standard error, counted from now. */
function counting(application: ElectronApplication, line: string): () => number {
  let errors = '';
  application.process().stderr?.on('data', (chunk: Buffer) => (errors += chunk.toString()));
  return () => errors.split(line).length - 1;
}

/** The notice sits above the graph and covers none of it. */
async function expectNothingCovered(page: Page): Promise<void> {
  const notice = await strip(page).boundingBox();
  const graph = await page.locator('.graph__scroll').boundingBox();
  expect(notice).not.toBeNull();
  expect(graph).not.toBeNull();
  expect((notice?.y ?? 0) + (notice?.height ?? 0)).toBeLessThanOrEqual(graph?.y ?? -1);
}

/**
 * Press Load More Commits with a real click, which Playwright makes only on an
 * element that receives the pointer at that spot, and require the graph to grow.
 */
async function loadMore(page: Page): Promise<void> {
  const spacer = page.locator('.graph__spacer');
  const height = (): Promise<number> =>
    spacer.evaluate((element: { clientHeight: number }) => element.clientHeight);
  const before = await height();
  await page.getByRole('button', { name: 'Load More Commits' }).click();
  await expect.poll(height).toBeGreaterThan(before);
}

/** Tab from the Theme control, the bar's last, to the notice's Close control, and press it. */
async function closeFromTheKeyboard(page: Page): Promise<void> {
  const close = strip(page).getByRole('button', { name: 'Close' });
  await theme(page).focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(strip(page)).toHaveText('');
}

test('a theme choice that cannot be kept is said once in a notice, and the window stays usable', async () => {
  const repository = fixture('remotes', 'remotes', 5000);
  let home = '';
  // A directory where the file goes: every write of it is refused, as a disk would refuse it.
  const prepare = (directory: string): void => {
    home = directory;
    mkdirSync(join(directory, 'theme'));
  };
  await withOwnProfile({ open: repository, prepare }, async (application) => {
    const page = await application.firstWindow();
    const said = counting(application, THEME_LINE);
    await expect(page.locator('.bar__path')).toHaveText(repository);
    await expect(theme(page)).toBeEnabled();
    // Chosen from the keyboard, so the focus is somewhere the notice could take it from.
    await theme(page).focus();
    await page.keyboard.press('ArrowUp');
    await expect(theme(page)).toHaveValue('dark');
    await expect.poll(said).toBe(1);
    const text = `The theme choice could not be kept. ${STILL_APPLIES}${join(home, 'theme')}`;
    await expect(notice(page)).toHaveText(text);
    await expect(theme(page)).toBeFocused();
    await expectNothingCovered(page);
    await loadMore(page);

    await theme(page).selectOption('light');
    await expect.poll(said).toBe(2);
    expect(await page.evaluate(noticesAfterRoundTrip)).toBe(1);
    await closeFromTheKeyboard(page);
  });
});

test('a branch selection that cannot be kept is said once in a notice, and the window stays usable', async () => {
  const repository = fixture('remotes', 'remotes', 5000);
  let home = '';
  // A file where the records' folder goes: every write is refused, as a disk would refuse it.
  const prepare = (directory: string): void => {
    home = directory;
    writeFileSync(join(directory, 'branch-selections'), '');
  };
  await withOwnProfile({ open: repository, prepare }, async (application) => {
    const page = await application.firstWindow();
    const said = counting(application, SELECTION_LINE);
    const list = page.getByRole('listbox', { name: 'Branches' });
    await expect(branches(page)).toBeEnabled();
    await branches(page).click();
    await list.getByRole('option', { name: 'feature', exact: true }).click();
    await expect.poll(said).toBe(1);
    const folder = join(home, 'branch-selections');
    const text = `The branch selection could not be kept. ${STILL_APPLIES}${folder}`;
    const shown = await notice(page).textContent();
    expect(shown?.slice(0, text.length)).toBe(text);
    // The record's own name: the SHA-256 of the repository's path, after a separator.
    expect(shown?.slice(text.length)).toMatch(/^[\\/][0-9a-f]{64}$/);
    await expect(strip(page).getByRole('button', { name: 'Close' })).not.toBeFocused();

    // The control applies a second selection with the notice open, refused again.
    await list.getByRole('option', { name: 'Show All', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.branches__text')).toHaveText('Show All');
    await expect.poll(said).toBe(2);
    expect(await page.evaluate(noticesAfterRoundTrip)).toBe(1);
    await expectNothingCovered(page);
    await loadMore(page);
    await closeFromTheKeyboard(page);
  });
});
