import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { DETAILS_HEIGHT, ROW_HEIGHT } from '../../src/ui/geometry';

import { fixture, ownFixture, removeOwnFixtures, withOwnProfile } from './support/fixtures';

/**
 * The details area under a row, in the built application (E04-M01-S09): where it
 * opens and what moves, what it says, what closes it, and what a page that
 * arrives does to it. The pixels its lines are drawn in, the centring and the
 * cost of an open area are `details-lines.spec.ts`'s.
 *
 * The repositories are the `details` fixture (a merge, a commit by two people, a
 * root, and an uncommitted change), `stashes`, `remotes` and `large`. Every
 * field is compared with a literal; a hash is what `git rev-parse` prints, and a
 * date is spelt from the fixture's times by hand (Node's `toUTCString` agreed
 * with each on 2026-11-11), so nothing is compared with the code under test.
 */

const SLOW_TEST_MS = 240_000;
const [MERGE, MOVE] = ['merge the side', 'move main on'];
const REMOVE = 'remove the names Windows cannot check out';
const TWO_PEOPLE = 'rename, delete, add and modify, by two people';
const [OPEN, DETAILS, INFO] = ['.row--open', '.details', '.details__info'];

/** Launch on `repository`, wait for a row, run `body`, close. */
async function withWindow(repository: string, body: (page: Page) => Promise<void>): Promise<void> {
  await withOwnProfile({ open: repository }, async (application) => {
    const page = await application.firstWindow();
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await body(page);
  });
}

const git = (repository: string, ...args: string[]): string[] =>
  execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

const subjectOf = (page: Page, text: string): Locator =>
  page.locator('.row', { hasText: text }).locator('.row__subject');

/** The top of every row shown, by its subject. */
async function tops(page: Page): Promise<Record<string, number>> {
  const found: Record<string, number> = {};
  for (const row of await page.locator('.row:not([hidden])').all()) {
    found[(await row.locator('.row__subject').textContent()) ?? ''] =
      (await row.boundingBox())?.y ?? -1;
  }
  return found;
}

const linesOf = (page: Page): Promise<string[]> =>
  page.locator('.details__info > .details__line').allInnerTexts();
const filesOf = (page: Page): Promise<string[]> => page.locator('.details__file').allTextContents();
const messageOf = (page: Page): Promise<string | null> =>
  page.locator('.details__message').textContent();

/** Open `text` and wait until its reply is drawn. */
async function show(page: Page, text: string): Promise<void> {
  await subjectOf(page, text).click();
  await expect(page.locator(INFO)).not.toHaveText('Loading…');
}

test('a click opens the area under the row; the rows below move down by its height', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    const before = await tops(page);
    await expect(page.locator(DETAILS)).toBeHidden();
    await subjectOf(page, MOVE).click();
    await expect(page.locator(OPEN)).toContainText(MOVE);
    const [after, box] = [await tops(page), await page.locator(DETAILS).boundingBox()];
    const clicked = before[MOVE] ?? 0;
    expect([box?.height, box?.y]).toEqual([DETAILS_HEIGHT, clicked + ROW_HEIGHT]);
    for (const [subject, top] of Object.entries(before)) {
      expect(after[subject], subject).toBe(top + (top > clicked ? DETAILS_HEIGHT : 0));
    }
    await expect(page.locator(DETAILS)).toHaveCount(1);
  });
});

test('a merge and a commit by two people show their fields, message and files', async () => {
  const repository = fixture('details', 'script', 6);
  const revisions = ['main', 'main^1', 'main^2', 'main~4', 'main~3'];
  const [main = '', first = '', second = '', root = '', two = ''] = git(
    repository,
    'rev-parse',
    ...revisions,
  );
  await withWindow(repository, async (page) => {
    await show(page, MERGE);
    expect(await linesOf(page)).toEqual([
      `Commit: ${main}`,
      `Parents: ${first}, ${second}`,
      'Author: Fixture Author <author@fixture.invalid>',
      'Committer: Fixture Committer <committer@fixture.invalid>',
      'Date: Tue Nov 14 2023 22:18:20 GMT+0000',
    ]);
    expect([await messageOf(page), await filesOf(page)]).toEqual([MERGE, ['side.txt']]);
    expect(await page.locator('.details__info a').allTextContents()).toEqual([first, second]);
    await show(page, TWO_PEOPLE);
    expect(await linesOf(page)).toEqual([
      `Commit: ${two}`,
      `Parents: ${root}`,
      'Author: Détails Author <details-author@fixture.invalid>',
      'Author Date: Mon Nov 13 2023 23:44:20 GMT+0130',
      'Committer: Details Committer <details-committer@fixture.invalid>',
      'Committer Date: Tue Nov 14 2023 15:14:20 GMT-0700',
    ]);
    const body =
      '\n\n    a line indented by four spaces\n\ta line indented by a tab\n\nafter a blank line';
    expect(await messageOf(page)).toBe(TWO_PEOPLE + body);
    expect((await filesOf(page)).join(' | ')).toBe(
      'added.txt | binary.dat | deep/er/still/leaf.txt | delete-me.txt | hash#percent%.txt | naïve café 日本.txt | question?.txt | quote"mark.txt | renamed.txt',
    );
  });
});

test('a root, the uncommitted changes and a stash show what they are', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    await show(page, 'begin the details history');
    expect([(await linesOf(page))[1], (await linesOf(page))[4]]).toEqual([
      'Parents: None',
      'Date: Tue Nov 14 2023 22:13:20 GMT+0000',
    ]);
    await show(page, 'Uncommitted changes');
    expect(await page.locator(INFO).textContent()).toBe('Displaying all uncommitted changes.');
    expect((await filesOf(page)).join(' | ')).toBe(
      'deep/er/still/leaf.txt | staged ✓ #%.txt | untracked ünï.txt',
    );
  });
  const repository = fixture('stashes', 'script', 3);
  const revisions = ['stash@{0}', 'stash@{0}^1', 'stash@{0}^2', 'stash@{0}^3'];
  const [stash, ...parents] = git(repository, 'rev-parse', ...revisions);
  const untracked = git(repository, 'ls-tree', '-r', '--name-only', 'stash@{0}^3');
  await withWindow(repository, async (page) => {
    await page.locator('.ref--stash').first().click();
    await expect(page.locator(DETAILS)).toBeHidden();
    await show(page, 'On main: stash with an untracked file');
    expect((await linesOf(page)).slice(0, 2)).toEqual([
      `Commit: ${stash ?? ''}`,
      `Parents: ${parents.join(', ')}`,
    ]);
    expect(await page.locator('.details__info a').allTextContents()).toEqual(parents.slice(0, 1));
    expect(await filesOf(page)).toEqual(expect.arrayContaining(untracked));
  });
});

test('a label or the inside of the area opens nothing; the four ways of closing close one area', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(fixture('details', 'script', 6), async (page) => {
    const before = await tops(page);
    await page.locator('.ref', { hasText: 'main' }).first().click();
    await expect(page.locator(DETAILS)).toBeHidden();
    await show(page, MOVE);
    await page.locator('.ref', { hasText: 'side' }).click();
    await page.locator(INFO).click();
    await expect(page.locator(OPEN)).toContainText(MOVE);
    await page.locator('.details__close').click();
    await expect(page.locator(DETAILS)).toBeHidden();
    expect([await tops(page), await page.locator(OPEN).count()]).toEqual([before, 0]);
    await subjectOf(page, MOVE).click();
    await subjectOf(page, MOVE).click();
    await expect(page.locator(DETAILS)).toBeHidden();
    expect(await tops(page)).toEqual(before);
    await subjectOf(page, MOVE).click();
    await subjectOf(page, REMOVE).click();
    await expect(page.locator(OPEN)).toHaveCount(1);
    await expect(page.locator(OPEN)).toContainText(REMOVE);
    const after = await tops(page);
    for (const [subject, top] of Object.entries(before)) {
      expect(after[subject], subject).toBe(
        top + (top > (before[REMOVE] ?? 0) ? DETAILS_HEIGHT : 0),
      );
    }
    await show(page, MERGE);
    await page.locator('.details__info a').nth(1).click();
    await expect(page.locator(OPEN)).toContainText('add a file on the side');
  });
});

test('a Refresh asks again for the uncommitted changes, and a new selection closes the area', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const own = ownFixture('details', 'script', 6);
  try {
    await withWindow(own, async (page) => {
      await show(page, 'Uncommitted changes');
      writeFileSync(join(own, 'fresh.txt'), 'new\n');
      await page.locator('.bar__refresh').click();
      await expect(page.locator('.details__file', { hasText: 'fresh.txt' })).toBeVisible();
    });
  } finally {
    removeOwnFixtures();
  }
  await withWindow(fixture('remotes', 'remotes', 5000), async (page) => {
    await subjectOf(page, 'merge the topic').click();
    await expect(page.locator(DETAILS)).toBeVisible();
    await page.getByRole('checkbox', { name: 'Show Remote Branches' }).uncheck();
    await expect(page.locator(DETAILS)).toBeHidden();
    await expect(page.locator(OPEN)).toHaveCount(0);
  });
});

test('a Load More with an area open keeps it on the same commit', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withWindow(fixture('large', 'large', 10_000), async (page) => {
    const [spacer, area] = [page.locator('.graph__spacer'), page.locator(DETAILS)];
    await page.locator('.row:has(.ref--head) .row__subject').click();
    await expect(page.locator(INFO)).not.toHaveText('Loading…');
    const [commit, before] = [await page.locator(INFO).textContent(), await spacer.boundingBox()];
    await page.locator('.graph__scroll').evaluate((each) => {
      const list = each as unknown as { scrollTop: number };
      list.scrollTop = 1e9;
    });
    await page.locator('.graph__more').click();
    await expect
      .poll(async () => (await spacer.boundingBox())?.height)
      .toBeGreaterThan(before?.height ?? 0);
    await expect(area).toBeVisible();
    expect(await page.locator(INFO).textContent()).toBe(commit);
  });
});

/** What runs in the page: a second view mounted over the stage and fed the open repository's page. */
interface Mounted {
  asked: ((reply: unknown) => void)[];
}

async function mountSecondView(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const scope = globalThis as unknown as {
      document: { querySelector: (at: string) => unknown };
      gitGraphical: { refresh: (request: object) => Promise<{ value: unknown }> };
      gitGraphicalView: { mount: (root: unknown) => MountedView };
      mounted: Mounted;
    };
    const view = scope.gitGraphicalView.mount(scope.document.querySelector('.stage'));
    view.showPage((await scope.gitGraphical.refresh({})).value);
    scope.mounted = { asked: [] };
    view.onDetails((_target, answer) => scope.mounted.asked.push(answer));
  });
}

interface MountedView {
  showPage(page: unknown): void;
  onDetails(listener: (target: unknown, answer: (reply: unknown) => void) => void): void;
}

/** Answer the `nth` request the second view made. */
const answer = (page: Page, nth: number, reply: object): Promise<void> =>
  page.evaluate(
    ([at, value]) => (globalThis as unknown as { mounted: Mounted }).mounted.asked[at]?.(value),
    [nth, reply] as const,
  );

const person = { name: 'Ann', email: 'ann@x.invalid', time: 1, offsetMinutes: 0 };
const file = (path: string): object => ({
  path,
  oldPath: null,
  status: 'added',
  additions: 1,
  deletions: 0,
});
const detailsOf = (hash: string, path: string): object => ({
  ok: true,
  value: {
    hash,
    parents: [],
    author: person,
    committer: person,
    message: hash,
    files: [file(path)],
  },
});

test('the area opens at once saying it is loading, and a stale reply is never drawn', async () => {
  await withWindow(fixture('details', 'script', 6), async (page) => {
    await mountSecondView(page);
    await subjectOf(page, MERGE).click();
    await expect(page.locator(INFO)).toHaveText('Loading…');
    expect((await page.locator(DETAILS).boundingBox())?.height).toBe(DETAILS_HEIGHT);
    await subjectOf(page, MOVE).click();
    await answer(page, 0, detailsOf('a'.repeat(40), 'stale.txt'));
    await expect(page.locator(INFO)).toHaveText('Loading…');
    expect(await filesOf(page)).toEqual([]);
    await answer(page, 1, detailsOf('b'.repeat(40), 'fresh.txt'));
    await expect(page.locator('.details__file')).toHaveText(['fresh.txt']);
    await subjectOf(page, REMOVE).click();
    await answer(page, 2, { ok: false, kind: 'git-failed', message: 'git said no' });
    await expect(page.locator(INFO)).toHaveText('git said no');
    await subjectOf(page, TWO_PEOPLE).click();
    await answer(page, 3, { ok: false, kind: 'cancelled', message: '' });
    await expect(page.locator(DETAILS)).toBeHidden();
  });
});

/** Click `selector` and report how long the area took to hold its reply, five times. */
async function timeClicks(page: Page, selector: string): Promise<string> {
  const times: number[] = [];
  for (let round = 0; round < 5; round += 1) {
    times.push(
      await page.evaluate(async (at) => {
        const scope = globalThis as unknown as {
          document: {
            querySelector: (s: string) => { click(): void; textContent: string } | null;
          };
          performance: { now: () => number };
        };
        const started = scope.performance.now();
        scope.document.querySelector(at)?.click();
        for (;;) {
          const text = scope.document.querySelector('.details__info')?.textContent ?? '';
          if (text !== '' && text !== 'Loading…')
            return Math.round(scope.performance.now() - started);
          await new Promise((next) => setTimeout(next, 0));
        }
      }, selector),
    );
    await page.locator('.details__close').click();
  }
  return times.join(', ');
}

test('how long a click takes, printed and not held', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const [head, uncommitted] = [
    '.row:has(.ref--head) .row__subject',
    '.row:not([hidden]).row--uncommitted .row__subject',
  ];
  await withWindow(fixture('details', 'script', 6), async (page) => {
    process.stdout.write(`  details: HEAD ${await timeClicks(page, head)} ms; `);
    process.stdout.write(`uncommitted ${await timeClicks(page, uncommitted)} ms\n`);
  });
  await withWindow(fixture('large', 'large', 10_000), async (page) => {
    process.stdout.write(`  large: HEAD ${await timeClicks(page, head)} ms\n`);
  });
});
