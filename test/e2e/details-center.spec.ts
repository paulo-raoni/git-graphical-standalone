import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ROW_HEIGHT } from '../../src/ui/geometry';

import { withBudgeted } from './support/budgets';
import {
  loadMoreAndShow,
  scrollListTo,
  viewportHeight,
  wakeupsSettled,
} from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * What opening a row does to the scroll offset with Auto Center off, and docked
 * (E04-M01-S12, scope D): the smallest scroll that shows the block, none when it
 * is shown already, and the row at the top when it is above the view. Inline with
 * Auto Center on is `details-lines.spec.ts`'s and `keyboard-moves.spec.ts`'s,
 * unchanged.
 *
 * Each offset is compared with a literal computed here from the rows' heights and
 * the list's height read from the page: the block is the row, and inline the
 * area's 250 pixels with it.
 */

test.describe.configure({ timeout: 300_000 });

const FIRST = 5000;
const AREA = '.details:not([hidden])';

const painted = (page: Page): Promise<number> => page.evaluate(wakeupsSettled, 20_000);
/** Runs in the page: where the list is scrolled to. */
function readOffset(): number {
  const scope = globalThis as unknown as {
    document: { querySelector: (at: string) => { scrollTop: number } | null };
  };
  return scope.document.querySelector('.graph__scroll')?.scrollTop ?? -1;
}
const offset = (page: Page): Promise<number> => page.evaluate(readOffset);

/** Open layout row `row`, which is at its closed place, and wait for its frame. */
async function open(page: Page, row: number): Promise<void> {
  const mine = page.locator(`.row[style*="translateY(${String(row * ROW_HEIGHT)}px)"]`);
  await mine.locator('.row__subject').click();
  await expect(mine).toHaveClass(/row--open/);
  await expect(page.locator('.details__info')).not.toHaveText('Loading…');
  await painted(page);
}

async function close(page: Page): Promise<void> {
  await page.locator('.details__close').click();
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

/** The window on 10 000 commits, with the options set, no area open, and the list at the first row. */
async function prepare(page: Page, docked: boolean, centred: boolean): Promise<void> {
  await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(loadMoreAndShow, 9700);
  await page.evaluate(scrollListTo, FIRST * ROW_HEIGHT);
  await open(page, FIRST + 5);
  await choose(page, 'Auto Center', centred ? 'On' : 'Off');
  if (docked) {
    await choose(page, 'Location', 'Docked to Bottom');
  }
  await close(page);
}

/** The three readings of Auto Center off: shown already, near the foot, out of view above. */
async function smallest(page: Page, block: number, list: number, show: number): Promise<void> {
  await page.evaluate(scrollListTo, FIRST * ROW_HEIGHT);
  await open(page, FIRST + 5);
  expect(await offset(page)).toBe(FIRST * ROW_HEIGHT);
  await close(page);
  const near = FIRST + Math.floor(show / ROW_HEIGHT);
  const wanted = (cur: number, row: number): number =>
    Math.min(row * ROW_HEIGHT, Math.max(cur, row * ROW_HEIGHT + block - list));
  await open(page, near);
  const shown = await offset(page);
  expect(shown).toBe(wanted(FIRST * ROW_HEIGHT, near));
  // The next row, by an arrow, is one more row down: in view whole, or scrolled in by the least.
  await page.keyboard.press('ArrowDown');
  await painted(page);
  expect(await offset(page)).toBe(wanted(shown, near + 1));
  // The row above the view: an arrow brings the next row in, with the row at the top.
  await page.evaluate(scrollListTo, (near + 40) * ROW_HEIGHT);
  await painted(page);
  await page.keyboard.press('ArrowDown');
  await painted(page);
  expect(await offset(page)).toBe((near + 2) * ROW_HEIGHT);
}

test('inline, Auto Center off: the smallest scroll that shows the row and its area', async () => {
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await prepare(page, false, false);
    const list = await page.evaluate(viewportHeight);
    await smallest(page, ROW_HEIGHT + 250, list, list - 100);
  });
});

test('docked, Auto Center off: the smallest scroll that shows the row above the panel', async () => {
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await prepare(page, true, false);
    await page.evaluate(scrollListTo, FIRST * ROW_HEIGHT);
    await open(page, FIRST + 5);
    // The list above a docked panel is the panel's height shorter.
    const list = await page.evaluate(viewportHeight);
    await close(page);
    await smallest(page, ROW_HEIGHT, list, list - 30);
  });
});

test('docked, Auto Center on: the row sits in the middle of the list above the panel', async () => {
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await prepare(page, true, true);
    await page.evaluate(scrollListTo, FIRST * ROW_HEIGHT);
    await open(page, FIRST + 5);
    const list = await page.evaluate(viewportHeight);
    const wanted = (FIRST + 5) * ROW_HEIGHT + (ROW_HEIGHT - list) / 2;
    expect(Math.abs((await offset(page)) - wanted)).toBeLessThanOrEqual(1);
  });
});
