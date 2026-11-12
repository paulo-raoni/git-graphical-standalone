import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { fixture, withOwnProfile } from './support/fixtures';

/**
 * Escape, the keys that are not the view's, and the files menu by key
 * (E04-M01-S11), in the built application.
 *
 * Escape closes one thing a press: the files menu, then the details. The Branches
 * list closes on its own Escape and the area stays. An arrow goes to the control
 * that has it first (the theme control, the Branches list), and with no details
 * open the window keeps what it does. The menu's entries take the arrows, Enter
 * and Space, and no arrow moves the details while it is open.
 *
 * The clipboard is replaced in the main process as `file-actions.spec.ts` replaces
 * it, so no case writes the machine's.
 */

const SLOW_TEST_MS = 240_000;
const TWO_PEOPLE = 'rename, delete, add and modify, by two people';
const OPEN_ROW = '.row--open .row__subject';
const AREA = '.details:not([hidden])';
const ENTRIES = ['Open File', 'Copy Absolute File Path', 'Copy Relative File Path'];

async function withWindow(
  body: (page: Page, application: ElectronApplication) => Promise<void>,
): Promise<void> {
  await withOwnProfile({ open: fixture('details', 'script', 6) }, async (application) => {
    const page = await application.firstWindow();
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await body(page, application);
  });
}

/** Open the commit by two people, in the list view of its files. */
async function openFiles(page: Page): Promise<void> {
  await page.locator('.row', { hasText: TWO_PEOPLE }).locator('.row__subject').click();
  await expect(page.locator('.details__info')).not.toHaveText('Loading…');
  await page.locator(`${AREA} button[title="File List View"]`).click();
  await expect(page.locator('.files__row:not([hidden])').first()).toBeVisible();
}

/** Right-click `added.txt` and wait for the menu. */
async function openMenu(page: Page): Promise<void> {
  await page
    .locator('.files__row:not([hidden])', { hasText: 'added.txt' })
    .click({ button: 'right' });
  await expect(page.locator('.files__menu')).toBeVisible();
}

/** The text of the element that has the focus, or an empty string. */
const focusedText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: { activeElement: { className?: string; textContent: string | null } | null };
    };
    const active = scope.document.activeElement;
    return active?.className === 'files__menu-item' ? (active.textContent ?? '') : '';
  });

test('Escape closes the menu, then the area, one thing a press, and the Branches list alone', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(async (page) => {
    await page.keyboard.press('Escape');
    await expect(page.locator(AREA)).toHaveCount(0);
    await openFiles(page);
    await openMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.files__menu')).toBeHidden();
    await expect(page.locator(OPEN_ROW)).toHaveText(TWO_PEOPLE);
    await expect(page.locator(AREA)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(AREA)).toHaveCount(0);
    await expect(page.locator('.row--open')).toHaveCount(0);
    await page.locator('.row', { hasText: TWO_PEOPLE }).locator('.row__subject').click();
    await page.getByRole('button', { name: /^Branches:/ }).click();
    await expect(page.locator('.branches__popup')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.branches__popup')).toBeHidden();
    await expect(page.locator(OPEN_ROW)).toHaveText(TWO_PEOPLE);
    await page.keyboard.press('Escape');
    await expect(page.locator('.row--open')).toHaveCount(0);
  });
});

/** Record, for every keydown that reaches the window, its key and whether its default was withheld. */
async function recordKeys(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const scope = globalThis as unknown as {
      prevented: string[];
      addEventListener: (
        type: string,
        call: (event: { key: string; defaultPrevented: boolean }) => void,
      ) => void;
    };
    scope.prevented = [];
    scope.addEventListener('keydown', (event) =>
      scope.prevented.push(`${event.key} ${event.defaultPrevented ? 'withheld' : 'left'}`),
    );
  });
  return async () =>
    (
      await page.evaluate(() => (globalThis as unknown as { prevented: string[] }).prevented)
    ).filter((each) => !/^(Control|Shift|Alt) /.test(each));
}

test('with no area open no key is taken, and with one open Shift and Alt change nothing', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(async (page) => {
    const seen = await recordKeys(page);
    for (const key of ['ArrowDown', 'ArrowUp', 'Control+ArrowDown', 'Escape']) {
      await page.keyboard.press(key);
    }
    expect(await seen()).toEqual([
      'ArrowDown left',
      'ArrowUp left',
      'ArrowDown left',
      'Escape left',
    ]);
    await page.locator('.row', { hasText: TWO_PEOPLE }).locator('.row__subject').click();
    await expect(page.locator('.details__info')).not.toHaveText('Loading…');
    for (const key of ['Shift+ArrowUp', 'Alt+ArrowUp', 'Alt+Control+ArrowDown', 'ArrowLeft']) {
      await page.keyboard.press(key);
    }
    expect((await seen()).slice(4)).toEqual([
      'ArrowUp left',
      'ArrowUp left',
      'ArrowDown left',
      'ArrowLeft left',
    ]);
    await expect(page.locator(OPEN_ROW)).toHaveText(TWO_PEOPLE);
    await page.keyboard.press('ArrowDown');
    expect((await seen()).slice(8)).toEqual(['ArrowDown withheld']);
    await expect(page.locator(OPEN_ROW)).toHaveText('begin the details history');
  });
});

test('the theme control and the Branches list keep their arrows over an open area', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(async (page) => {
    await page.locator('.row', { hasText: TWO_PEOPLE }).locator('.row__subject').click();
    const theme = page.locator('.bar__theme');
    await theme.focus();
    await expect(theme).toHaveValue('system');
    await page.keyboard.press('ArrowUp');
    await expect(theme).toHaveValue('dark');
    await expect(page.locator(OPEN_ROW)).toHaveText(TWO_PEOPLE);
    await page.getByRole('button', { name: /^Branches:/ }).click();
    await expect(page.locator('.branches__popup')).toBeVisible();
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'Control+ArrowDown']) {
      await page.keyboard.press(key);
    }
    await expect(page.locator(OPEN_ROW)).toHaveText(TWO_PEOPLE);
    await expect(page.locator('.branches__popup')).toBeVisible();
  });
});

test('the menu takes the arrows, Enter and Space, and the open row stays', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(async (page, application) => {
    await application.evaluate(({ clipboard }) => {
      const scope = globalThis as unknown as { copied: string[] };
      scope.copied = [];
      clipboard.writeText = (text: string): Promise<void> => {
        scope.copied.push(text);
        return Promise.resolve();
      };
    });
    const copied = (): Promise<string[]> =>
      application.evaluate(() => (globalThis as unknown as { copied: string[] }).copied);
    await openFiles(page);
    await openMenu(page);
    expect(await page.locator('.files__menu > *').allTextContents()).toEqual(ENTRIES);
    expect(await focusedText(page)).toBe('');
    const walk: [string, string][] = [
      ['ArrowDown', ENTRIES[0] ?? ''],
      ['ArrowDown', ENTRIES[1] ?? ''],
      ['ArrowUp', ENTRIES[0] ?? ''],
      ['ArrowUp', ENTRIES[0] ?? ''],
      ['ArrowDown', ENTRIES[1] ?? ''],
      ['ArrowDown', ENTRIES[2] ?? ''],
      ['ArrowDown', ENTRIES[2] ?? ''],
    ];
    for (const [key, entry] of walk) {
      await page.keyboard.press(key);
      expect(await focusedText(page), key).toBe(entry);
      await expect(page.locator(OPEN_ROW)).toHaveText(TWO_PEOPLE);
    }
    await page.keyboard.press('Control+ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator(OPEN_ROW)).toHaveText(TWO_PEOPLE);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.files__menu')).toBeHidden();
    await expect.poll(copied).toEqual(['added.txt']);
    await openMenu(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(page.locator('.files__menu')).toBeHidden();
    await expect.poll(copied).toEqual(['added.txt', 'added.txt']);
    await expect(page.locator(OPEN_ROW)).toHaveText(TWO_PEOPLE);
  });
});

test('the focused entry is marked in both themes', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(async (page) => {
    await openFiles(page);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openMenu(page);
      await page.keyboard.press('ArrowDown');
      const [focused, other] = await page.evaluate((): [string[], string[]] => {
        const scope = globalThis as unknown as {
          document: { querySelectorAll: (at: string) => Iterable<object> };
          getComputedStyle: (at: object) => { outlineStyle: string; backgroundColor: string };
        };
        const [first, second] = [...scope.document.querySelectorAll('.files__menu-item')];
        const read = (each: object | undefined): string[] => {
          const style = scope.getComputedStyle(each ?? {});
          return [style.outlineStyle, style.backgroundColor];
        };
        return [read(first), read(second)];
      });
      expect(focused[0], scheme).toBe('solid');
      expect(other[0], scheme).toBe('none');
      expect(focused[1], scheme).not.toBe(other[1]);
      await page.keyboard.press('Escape');
      await expect(page.locator('.files__menu')).toBeHidden();
    }
  });
});
