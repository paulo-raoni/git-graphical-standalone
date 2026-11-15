import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { fixture, withOwnProfile } from './support/fixtures';

/**
 * The changed files of the details area, in the built application
 * (E04-M01-S10): the tree and the list, each row's label, colour class, counts,
 * letter and tooltip compared with a literal; the view kept across commits and
 * per repository; each option's two values; a folder collapsed and expanded; the
 * hover icons and the menu of a deleted, an added and a modified file; and the
 * menu's closings.
 *
 * The repositories are the `details` fixture (a commit by two people with a
 * rename, a deletion, a binary file, unusual names and the chain
 * `deep / er / still`; a merge; the uncommitted changes with a staged and an
 * untracked file) and `stashes` (a stash with an untracked file). Every literal
 * was read from what `git diff-tree --raw --numstat -M` and `git status` say of
 * those repositories on 2026-11-12, not from the code under test. What is drawn
 * with the cost of a large reply is `changed-files-cost.spec.ts`'s, and what the
 * actions do to the clipboard and the file manager is `file-actions.spec.ts`'s.
 */

const TWO_PEOPLE = 'rename, delete, add and modify, by two people';
const [MERGE, ROOT] = ['merge the side', 'begin the details history'];
const ROWS = '.files__row:not([hidden])';
const TREE_BUTTON = '.details:not([hidden]) button[title="File Tree View"]';
const LIST_BUTTON = '.details:not([hidden]) button[title="File List View"]';

interface Shown {
  className: string;
  style: { paddingLeft: string };
  title: string;
  querySelector: (at: string) => { textContent: string | null; hidden: boolean } | null;
}

/** Each visible row as `depth | class | name | counts | letter | tooltip`. */
/** Wait two frames, which is when a change of rows has been drawn. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const scope = globalThis as unknown as {
          requestAnimationFrame: (call: () => void) => void;
        };
        scope.requestAnimationFrame(() => {
          scope.requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );
}

async function rowsOf(page: Page): Promise<string[]> {
  await settled(page);
  return page.locator(ROWS).evaluateAll((nodes) =>
    (nodes as unknown as Shown[]).map((node) => {
      const text = (at: string): string => {
        const found = node.querySelector(at);
        return found === null || found.hidden ? '' : (found.textContent ?? '');
      };
      const depth = (Number.parseInt(node.style.paddingLeft, 10) - 4) / 14;
      const cells = [depth, node.className.replace('files__row ', ''), text('.files__name')];
      return [...cells, text('.files__counts'), text('.files__letter'), node.title].join(' | ');
    }),
  );
}

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

/** Open `text` and wait until its reply is drawn. */
async function show(page: Page, text: string): Promise<void> {
  await page.locator('.row', { hasText: text }).locator('.row__subject').click();
  await expect(page.locator('.details__info')).not.toHaveText('Loading…');
  await expect(page.locator(ROWS).first()).toBeVisible();
}

/** The rows of the details area as they are in each shape. */
const TREE_TWO_PEOPLE = [
  '0 | files__row--folder | deep / er / still |  |  | deep / er / still',
  '1 | files__row--file files__row--plain | leaf.txt | (+1 | -0) |  | deep/er/still/leaf.txt\nModified',
  '0 | files__row--file files__row--added | added.txt |  |  | added.txt\nAdded',
  '0 | files__row--file files__row--plain | binary.dat |  |  | binary.dat\nModified',
  '0 | files__row--file files__row--deleted | delete-me.txt |  |  | delete-me.txt\nDeleted',
  '0 | files__row--file files__row--added | hash#percent%.txt |  |  | hash#percent%.txt\nAdded',
  '0 | files__row--file files__row--added | naïve café 日本.txt |  |  | naïve café 日本.txt\nAdded',
  '0 | files__row--file files__row--added | question?.txt |  |  | question?.txt\nAdded',
  '0 | files__row--file files__row--added | quote"mark.txt |  |  | quote"mark.txt\nAdded',
  '0 | files__row--file files__row--plain | renamed.txt | (+1 | -1) |  | renamed.txt\nRenamed (rename-me.txt → renamed.txt)',
];

test('the commit by two people is a tree by default, and a list when its button is pressed', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    await show(page, TWO_PEOPLE);
    expect(await rowsOf(page)).toEqual(TREE_TWO_PEOPLE);
    await expect(page.locator(TREE_BUTTON)).toHaveClass(/details__tool--active/);
    await page.locator(LIST_BUTTON).click();
    await expect(page.locator('.files__row--folder:not([hidden])')).toHaveCount(0);
    const list = TREE_TWO_PEOPLE.filter((row) => !row.includes('files__row--folder')).map((row) =>
      row.replace(/^\d \| /, '0 | '),
    );
    list[0] = list[0]?.replace('| leaf.txt |', '| deep/er/still/leaf.txt |') ?? '';
    expect(await rowsOf(page)).toEqual(list);
    await expect(page.locator(LIST_BUTTON)).toHaveClass(/details__tool--active/);
    await expect(page.locator(TREE_BUTTON)).not.toHaveClass(/details__tool--active/);
  });
});

test('the view is kept for the next commits, the uncommitted changes and a stash', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    await show(page, TWO_PEOPLE);
    await page.locator(LIST_BUTTON).click();
    await show(page, ROOT);
    expect(await rowsOf(page)).toEqual([
      '0 | files__row--file files__row--added | deep/er/still/leaf.txt |  |  | deep/er/still/leaf.txt\nAdded',
      '0 | files__row--file files__row--added | binary.dat |  |  | binary.dat\nAdded',
      '0 | files__row--file files__row--added | delete-me.txt |  |  | delete-me.txt\nAdded',
      '0 | files__row--file files__row--added | rename-me.txt |  |  | rename-me.txt\nAdded',
    ]);
    await show(page, 'Uncommitted changes');
    expect(await rowsOf(page)).toEqual([
      '0 | files__row--file files__row--plain | deep/er/still/leaf.txt | (+1 | -0) |  | deep/er/still/leaf.txt\nModified',
      '0 | files__row--file files__row--added | staged ✓ #%.txt |  |  | staged ✓ #%.txt\nAdded',
      '0 | files__row--file files__row--added | untracked ünï.txt |  |  | untracked ünï.txt\nUntracked',
    ]);
    await show(page, MERGE);
    expect(await rowsOf(page)).toEqual([
      '0 | files__row--file files__row--added | side.txt |  |  | side.txt\nAdded',
    ]);
  });
  await withWindow(fixture('stashes', 'script', 3), async (page) => {
    await show(page, 'On main: stash with an untracked file');
    expect(await rowsOf(page)).toEqual([
      '0 | files__row--file files__row--plain | main.txt | (+1 | -1) |  | main.txt\nModified',
      '0 | files__row--file files__row--added | untracked.txt |  |  | untracked.txt\nUntracked',
    ]);
  });
});

/** Answer the folder dialog with `chosen`, in the main process, which is the only place it can be. */
async function answerTheDialog(application: ElectronApplication, chosen: string): Promise<void> {
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, chosen);
}

test('a view chosen on one repository is not the view of a second one opened in the same run', async () => {
  await withWindow(fixture('details', 'script', 6), async (page, application) => {
    await show(page, TWO_PEOPLE);
    await page.locator(LIST_BUTTON).click();
    await expect(page.locator('.files__row--folder:not([hidden])')).toHaveCount(0);
    await answerTheDialog(application, fixture('stashes', 'script', 3));
    await page.getByRole('button', { name: 'Open Repository' }).click();
    await expect(page.locator('.row', { hasText: 'On main: stash' })).toBeVisible();
    await show(page, 'On main: stash with an untracked file');
    // Neither shape changes a root-level file, so the second repository is told by its button.
    await expect(page.locator(TREE_BUTTON)).toHaveClass(/details__tool--active/);
    await expect(page.locator(LIST_BUTTON)).not.toHaveClass(/details__tool--active/);
    await answerTheDialog(application, fixture('details', 'script', 6));
    await page.getByRole('button', { name: 'Open Repository' }).click();
    await show(page, TWO_PEOPLE);
    await expect(page.locator(LIST_BUTTON)).toHaveClass(/details__tool--active/);
  });
});

/** Choose `value` of the option `title` in the options menu. */
async function choose(page: Page, title: string, value: string): Promise<void> {
  await page.locator('.details:not([hidden]) button[title="Options"]').click();
  const entries = page.locator('.files__menu > *');
  const names = (await entries.allTextContents()).map((text) => text.replace('●', ''));
  const at = names.indexOf(title);
  expect(at, title).toBeGreaterThanOrEqual(0);
  const offset = names.slice(at + 1).indexOf(value);
  await entries.nth(at + 1 + offset).click();
}

test('each option has two values, and the rows follow each', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    await show(page, TWO_PEOPLE);
    await page.locator('.details:not([hidden]) button[title="Options"]').click();
    expect(await page.locator('.files__menu > *').allTextContents()).toEqual([
      ...['Default File View', '●Tree', 'List', 'Compact Folders', '●On', 'Off'],
      ...['Status Letters', 'On', '●Off', 'Location', '●Inline', 'Docked to Bottom'],
      ...['Auto Center', '●On', 'Off'],
    ]);
    // The button toggles: pressed again, it closes the menu it opened.
    await page.locator('.details:not([hidden]) button[title="Options"]').click();
    await expect(page.locator('.files__menu')).toBeHidden();
    await choose(page, 'Compact Folders', 'Off');
    expect((await rowsOf(page)).slice(0, 5)).toEqual([
      '0 | files__row--folder | deep |  |  | deep',
      '1 | files__row--folder | er |  |  | er',
      '2 | files__row--folder | still |  |  | still',
      '3 | files__row--file files__row--plain | leaf.txt | (+1 | -0) |  | deep/er/still/leaf.txt\nModified',
      '0 | files__row--file files__row--added | added.txt |  |  | added.txt\nAdded',
    ]);
    await choose(page, 'Compact Folders', 'On');
    expect((await rowsOf(page))[0]).toBe(
      '0 | files__row--folder | deep / er / still |  |  | deep / er / still',
    );
    await choose(page, 'Status Letters', 'On');
    await settled(page);
    const letters = await page
      .locator(`${ROWS} .files__letter`)
      .evaluateAll((nodes) =>
        (nodes as unknown as { hidden: boolean; textContent: string }[]).map((one) =>
          one.hidden ? '' : one.textContent,
        ),
      );
    expect(letters).toEqual(['', 'M', 'A', 'M', 'D', 'A', 'A', 'A', 'A', 'R']);
    await choose(page, 'Status Letters', 'Off');
    expect(await rowsOf(page)).toEqual(TREE_TWO_PEOPLE);
    await choose(page, 'Default File View', 'List');
    await expect(page.locator('.files__row--folder:not([hidden])')).toHaveCount(0);
    await choose(page, 'Default File View', 'Tree');
    await expect(page.locator('.files__row--folder:not([hidden])')).toHaveCount(1);
  });
});

test('a folder row collapses and expands its files, a compacted chain as one row', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    await show(page, TWO_PEOPLE);
    const folder = page.locator('.files__row--folder:not([hidden])');
    await folder.click();
    expect((await rowsOf(page)).slice(0, 2)).toEqual([
      '0 | files__row--folder | deep / er / still |  |  | deep / er / still',
      '0 | files__row--file files__row--added | added.txt |  |  | added.txt\nAdded',
    ]);
    await expect(page.locator(`${ROWS} .files__name`)).toHaveCount(10 - 1);
    await folder.click();
    expect(await rowsOf(page)).toEqual(TREE_TWO_PEOPLE);
    await folder.click();
    await show(page, ROOT);
    expect((await rowsOf(page))[1]).toContain('| leaf.txt |');
  });
});

/** Which hover icons a row shows, by their titles, with the pointer over it. */
async function iconsOf(page: Page, name: string): Promise<string[]> {
  const row = page.locator(ROWS, { hasText: name });
  await row.hover();
  return row
    .locator('.files__act:visible')
    .evaluateAll((nodes) => (nodes as unknown as { title: string }[]).map((node) => node.title));
}

test('a deleted, an added and a modified file show their hover icons and their menu entries', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    await show(page, TWO_PEOPLE);
    expect(await iconsOf(page, 'delete-me.txt')).toEqual(['Copy Absolute File Path to Clipboard']);
    expect(await iconsOf(page, 'added.txt')).toEqual([
      'Copy Absolute File Path to Clipboard',
      'Open File',
    ]);
    expect(await iconsOf(page, 'leaf.txt')).toEqual([
      'Copy Absolute File Path to Clipboard',
      'Open File',
    ]);
    const entries = async (name: string): Promise<string[]> => {
      await page.locator(ROWS, { hasText: name }).click({ button: 'right' });
      return page.locator('.files__menu:not([hidden]) > *').allTextContents();
    };
    expect(await entries('delete-me.txt')).toEqual([
      'Copy Absolute File Path',
      'Copy Relative File Path',
    ]);
    expect(await entries('added.txt')).toEqual([
      'Open File',
      'Copy Absolute File Path',
      'Copy Relative File Path',
    ]);
    expect(await entries('renamed.txt')).toEqual([
      'Open File',
      'Copy Absolute File Path',
      'Copy Relative File Path',
    ]);
    await page.locator('.files__row--folder:not([hidden])').click({ button: 'right' });
    await expect(page.locator('.files__menu')).toBeHidden();
    await page.locator('.details__info').click({ button: 'right' });
    await expect(page.locator('.files__menu')).toBeHidden();
  });
});

test('the menu closes on a choice, a click elsewhere, a scroll, the area closing and a lost focus', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    await show(page, TWO_PEOPLE);
    const menu = page.locator('.files__menu');
    const open = async (): Promise<void> => {
      await page.locator(ROWS, { hasText: 'added.txt' }).click({ button: 'right' });
      await expect(menu).toBeVisible();
    };
    await open();
    await menu.getByText('Copy Relative File Path').click();
    await expect(menu).toBeHidden();
    await open();
    await page.locator('.details__info').click();
    await expect(menu).toBeHidden();
    await open();
    await page.locator('.files__scroll').evaluate((each) => {
      const pane = each as unknown as { scrollTop: number; dispatchEvent: (e: unknown) => void };
      pane.scrollTop = 1;
      pane.dispatchEvent(new Event('scroll'));
    });
    await expect(menu).toBeHidden();
    await open();
    await page.locator('.graph__scroll').evaluate((each) => {
      const list = each as unknown as { dispatchEvent: (e: unknown) => void };
      list.dispatchEvent(new Event('scroll'));
    });
    await expect(menu).toBeHidden();
    await open();
    await page.locator('.details__close').click();
    await expect(menu).toBeHidden();
    await show(page, TWO_PEOPLE);
    await open();
    await page.evaluate(() => {
      const scope = globalThis as unknown as {
        dispatchEvent: (e: unknown) => void;
        Event: new (type: string) => unknown;
      };
      scope.dispatchEvent(new scope.Event('blur'));
    });
    await expect(menu).toBeHidden();
  });
});
