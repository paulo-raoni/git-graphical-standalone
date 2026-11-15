import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { ownFixture, removeOwnFixtures, withOwnProfile } from './support/fixtures';

/**
 * What the actions of a changed file do (E04-M01-S10): copy its relative or its
 * absolute path, show it in the file manager, and what each says when it cannot.
 *
 * **No case writes the system clipboard or opens a window of another program.**
 * Each replaces `clipboard.writeText` and `shell.showItemInFolder` in the built
 * application's main process, with `application.evaluate`, and reads what the
 * replacements were handed. The replacement is measured to be the call the
 * handler makes, and not a second one beside it: `readText` of the real clipboard
 * is read before and after each action and is the same, while the replacement
 * holds the text the action produced (`interceptedOnly`). The handler looks both
 * functions up on Electron's modules at each call, which is why a property
 * assigned from here is what it reaches (`src/app/handlers.ts`, `fileAction`).
 *
 * The repositories are `ownFixture` copies of `details`, because three cases
 * change the working tree. A path is compared with the one git prints for the
 * top level, written with this platform's separators.
 */

const TWO_PEOPLE = 'rename, delete, add and modify, by two people';
const LEAF = 'deep/er/still/leaf.txt';
const REFUSED =
  'The request names neither one of the three file actions on a file of a commit or of the uncommitted changes.';

interface Handed {
  copied: string[];
  shown: string[];
}

/** Replace the two calls in the main process; every call is recorded, none reaches the machine. */
async function intercept(application: ElectronApplication): Promise<void> {
  await application.evaluate(async ({ clipboard, shell }) => {
    const scope = globalThis as unknown as { handed: Handed; before: string };
    scope.handed = { copied: [], shown: [] };
    scope.before = await clipboard.readText();
    clipboard.writeText = (text: string): Promise<void> => {
      scope.handed.copied.push(text);
      return Promise.resolve();
    };
    shell.showItemInFolder = (path: string): void => {
      scope.handed.shown.push(path);
    };
  });
}

/** What the replacements were handed, and whether the real clipboard is as it was. */
async function handedOf(
  application: ElectronApplication,
): Promise<Handed & { interceptedOnly: boolean }> {
  return application.evaluate(async ({ clipboard }) => {
    const scope = globalThis as unknown as { handed: Handed; before: string };
    return { ...scope.handed, interceptedOnly: (await clipboard.readText()) === scope.before };
  });
}

async function withWindow(
  repository: string,
  body: (page: Page, application: ElectronApplication) => Promise<void>,
  env?: Record<string, string>,
): Promise<void> {
  await withOwnProfile({ open: repository, ...(env === undefined ? {} : { env }) }, async (app) => {
    const page = await app.firstWindow();
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await intercept(app);
    await body(page, app);
  });
}

async function show(page: Page, text: string): Promise<void> {
  await page.locator('.row', { hasText: text }).locator('.row__subject').click();
  await expect(page.locator('.details__info')).not.toHaveText('Loading…');
  await expect(page.locator('.files__row:not([hidden])').first()).toBeVisible();
}

const topOf = (repository: string): string =>
  execFileSync('git', ['-C', repository, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
    .trim()
    .replace(/\//g, sep);

/** The row of `name`, found by its name cell. */
const rowOf = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.locator('.files__row:not([hidden])').filter({
    has: page.locator('.files__name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }),
  });

/** Click the hover icon `action` of `name`, which is shown while the pointer is over its row. */
async function icon(page: Page, name: string, action: string): Promise<void> {
  const row = rowOf(page, name);
  await row.hover();
  await row.locator(`.files__act[data-action="${action}"]`).click();
}

/** Right-click `name` and choose `entry` of its menu. */
async function menu(page: Page, name: string, entry: string): Promise<void> {
  await rowOf(page, name).click({ button: 'right' });
  await page.locator('.files__menu').getByText(entry, { exact: true }).click();
}

test('each action on a modified, an added, a deleted and an untracked file hands the machine what it should', async () => {
  test.setTimeout(240_000);
  const repository = ownFixture('details', 'script', 6);
  const top = topOf(repository);
  try {
    await withWindow(repository, async (page, application) => {
      await show(page, TWO_PEOPLE);
      for (const [name, path] of [
        ['leaf.txt', LEAF],
        ['added.txt', 'added.txt'],
        ['delete-me.txt', 'delete-me.txt'],
      ] as const) {
        await menu(page, name, 'Copy Relative File Path');
        await menu(page, name, 'Copy Absolute File Path');
        await icon(page, name, 'copy-absolute-path');
        const absolute = join(top, ...path.split('/'));
        await expect
          .poll(async () => (await handedOf(application)).copied.slice(-3), { message: name })
          .toEqual([path, absolute, absolute]);
      }
      await menu(page, 'leaf.txt', 'Open File');
      await icon(page, 'added.txt', 'open-file');
      await expect
        .poll(async () => (await handedOf(application)).shown)
        .toEqual([join(top, ...LEAF.split('/')), join(top, 'added.txt')]);
      await show(page, 'Uncommitted changes');
      await menu(page, 'untracked ünï.txt', 'Copy Relative File Path');
      await menu(page, 'untracked ünï.txt', 'Copy Absolute File Path');
      await menu(page, 'untracked ünï.txt', 'Open File');
      const absolute = join(top, 'untracked ünï.txt');
      await expect
        .poll(async () => (await handedOf(application)).shown.slice(-1))
        .toEqual([absolute]);
      const handed = await handedOf(application);
      expect(handed.copied.slice(-2)).toEqual(['untracked ünï.txt', absolute]);
      expect(handed.interceptedOnly).toBe(true);
    });
  } finally {
    removeOwnFixtures();
  }
});

test('Open File of a commit follows a rename the working tree made, and says a deleted file is gone', async () => {
  test.setTimeout(240_000);
  const repository = ownFixture('details', 'script', 6);
  const top = topOf(repository);
  execFileSync('git', ['-C', repository, 'mv', 'renamed.txt', 'moved.txt']);
  rmSync(join(repository, 'added.txt'));
  try {
    await withWindow(repository, async (page, application) => {
      await show(page, TWO_PEOPLE);
      await icon(page, 'renamed.txt', 'open-file');
      await expect
        .poll(async () => (await handedOf(application)).shown)
        .toEqual([join(top, 'moved.txt')]);
      await icon(page, 'added.txt', 'open-file');
      await expect(page.locator('.files__error')).toHaveText(
        '`added.txt` is not in the working tree.',
      );
      expect((await handedOf(application)).shown).toEqual([join(top, 'moved.txt')]);
      await menu(page, 'leaf.txt', 'Copy Relative File Path');
      await expect(page.locator('.files__error')).toBeHidden();
    });
  } finally {
    removeOwnFixtures();
  }
});

/** The bridge call a page can make, with whatever it is given. */
function ask(page: Page, request: unknown): Promise<{ ok: boolean; message?: string }> {
  return page.evaluate(
    (given) =>
      (
        globalThis as unknown as {
          gitGraphical: { fileAction: (r: unknown) => Promise<{ ok: boolean; message?: string }> };
        }
      ).gitGraphical.fileAction(given),
    request,
  );
}

test('a request that names no file of the repository reaches neither git, the clipboard nor the file manager', async () => {
  test.setTimeout(240_000);
  const hash = 'ab'.repeat(20);
  await withWindow(ownFixture('details', 'script', 6), async (page, application) => {
    try {
      const target = { kind: 'commit', hash };
      const bad = [
        { action: 'copy-absolute-path', target, path: '../outside.txt' },
        { action: 'copy-absolute-path', target, path: 'a/../../outside.txt' },
        { action: 'open-file', target: { kind: 'uncommitted' }, path: '/etc/passwd' },
        { action: 'open-file', target: { kind: 'uncommitted' }, path: 'a\\..\\b' },
        { action: 'copy-relative-path', target, path: '' },
        { action: 'copy-relative-path', target: { kind: 'commit', hash: '--output=x' }, path: 'a' },
        { action: 'delete', target, path: 'a' },
        null,
      ];
      for (const request of bad) {
        expect(await ask(page, request), JSON.stringify(request)).toEqual({
          ok: false,
          kind: 'git-failed',
          message: REFUSED,
        });
      }
      const handed = await handedOf(application);
      expect([handed.copied, handed.shown, handed.interceptedOnly]).toEqual([[], [], true]);
    } finally {
      removeOwnFixtures();
    }
  });
});

/**
 * Wait until an action has answered: the replaced clipboard or file manager was handed the
 * calls in `answered` since `since`. A request that is refused answers by its reply, which
 * the caller awaits, so it names none.
 */
async function answeredBy(
  application: ElectronApplication,
  since: Handed,
  answered?: { copied?: number; shown?: number },
): Promise<void> {
  if (answered === undefined) {
    return;
  }
  await expect
    .poll(async () => {
      const handed = await handedOf(application);
      return [handed.copied.length - since.copied.length, handed.shown.length - since.shown.length];
    })
    .toEqual([answered.copied ?? 0, answered.shown ?? 0]);
}

test('each action starts the git processes it needs and no more', async () => {
  test.setTimeout(240_000);
  const scratch = mkdtempSync(join(tmpdir(), 'git-graphical-actions-'));
  const trace = join(scratch, 'trace.json');
  writeFileSync(trace, '');
  const started = (): number =>
    readFileSync(trace, 'utf8')
      .split('\n')
      .filter((line) => line.includes('"event":"start"')).length;
  try {
    await withWindow(
      ownFixture('details', 'script', 6),
      async (page, application) => {
        await show(page, TWO_PEOPLE);
        const counted = async (
          work: () => Promise<void>,
          answered?: { copied?: number; shown?: number },
        ): Promise<number> => {
          const before = started();
          const handedBefore = await handedOf(application);
          await work();
          await answeredBy(application, handedBefore, answered);
          return started() - before;
        };
        const relative = await counted(() => menu(page, 'leaf.txt', 'Copy Relative File Path'), {
          copied: 1,
        });
        const absolute = await counted(() => menu(page, 'leaf.txt', 'Copy Absolute File Path'), {
          copied: 1,
        });
        const opened = await counted(() => menu(page, 'leaf.txt', 'Open File'), { shown: 1 });
        const refused = await counted(async () => {
          await ask(page, { action: 'open-file', target: { kind: 'uncommitted' }, path: '..' });
        });
        await show(page, 'Uncommitted changes');
        const uncommitted = await counted(() => menu(page, 'untracked ünï.txt', 'Open File'), {
          shown: 1,
        });
        expect([relative, absolute, opened, refused, uncommitted]).toEqual([0, 1, 2, 0, 1]);
      },
      { ...(process.env as Record<string, string>), GIT_TRACE2_EVENT: trace },
    );
  } finally {
    removeOwnFixtures();
    rmSync(scratch, { recursive: true, force: true });
  }
});
