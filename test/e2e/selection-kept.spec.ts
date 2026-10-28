import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

import { fixture, ownFixture, removeOwnFixtures } from './support/fixtures';

/**
 * The branch selection and Show Remote Branches are kept per repository by the
 * main process: across a restart, between two instances open at once on one
 * user-data directory, each repository its own, a kept branch the repository no
 * longer has dropped, and a record that is not one this application wrote read as
 * nothing kept.
 *
 * The behaviour is the owner's ruling of 2026-10-28, recorded in
 * `docs/plan/E03-branch-filtering-and-find/M01-branches-dropdown/S12-selection-kept-per-repository.md`.
 * Every choice is applied by clicks on the control, as a person applies it, and
 * read back from the control and from the graph's rows, which are compared with
 * what `git log` prints for the same revisions.
 *
 * The repository is the `remotes` fixture (`test/fixtures/generate.ts`): `main`
 * checked out over a dirty working tree, the local branches `feature`, `release`
 * and `topic`, and `origin/HEAD`, `origin/feature`, `origin/main` and
 * `origin/only-remote`. The case that deletes branches deletes them from a copy
 * of its own.
 *
 * **Every case has user-data directories of its own** (`--user-data-dir`), each
 * launched on more than once on purpose; nothing reaches another case, nor the
 * person who runs the suite.
 */

test.describe.configure({ timeout: 180_000 });

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** How many of the graph's top commit rows a check compares with git. */
const COMPARED_ROWS = 8;
/** The folder the main process keeps its records in, inside the user-data directory. */
const RECORDS = 'branch-selections';

const EVERY = ['--branches', '--tags', '--remotes', 'HEAD'];
const [FEATURE, TOPIC] = ['refs/heads/feature', 'refs/heads/topic'];
const ONLY_REMOTE = 'refs/remotes/origin/only-remote';
const LOCALS = ['Show All', 'main', 'feature', 'release', 'topic'];
const REMOTES = ['origin/HEAD', 'origin/feature', 'origin/main', 'origin/only-remote'];

let remotesRepository = '';
const temporary: string[] = [];

/** One launched instance, and what its renderer drew. */
interface Instance {
  readonly application: ElectronApplication;
  readonly page: Page;
  /** Milliseconds from the launch to the first page's control being usable. */
  readonly firstPageMs: number;
}

const box = (page: Page): Locator => page.getByRole('button', { name: /^Branches:/ });
const text = (page: Page): Locator => page.locator('.branches__text');
const list = (page: Page): Locator => page.getByRole('listbox', { name: 'Branches' });
const remotes = (page: Page): Locator =>
  page.getByRole('checkbox', { name: 'Show Remote Branches' });
const entry = (page: Page, label: string): Locator =>
  list(page)
    .getByRole('option')
    .filter({ hasText: new RegExp(`^${label}$`) });

/** What {@link recordDrawn} touches in the page. `tsconfig.node.json` has no DOM library. */
interface PageScope {
  readonly document: {
    readonly querySelectorAll: (selector: string) => ArrayLike<{ textContent: string | null }>;
  };
  readonly MutationObserver: new (callback: () => void) => {
    observe: (target: unknown, options: Record<string, boolean>) => void;
  };
  drawnRows?: string[][];
  viewBeforeScript?: boolean;
}

/**
 * Runs in the page before its own scripts: record, after every change to the
 * document, the object names of the rows the graph shows, so that a case can say
 * every page that was ever drawn, and not only the last.
 */
function recordDrawn(): void {
  const scope = globalThis as unknown as PageScope;
  scope.viewBeforeScript = 'gitGraphicalView' in globalThis;
  const drawn: string[][] = [];
  scope.drawnRows = drawn;
  new scope.MutationObserver(() => {
    const rows = Array.from(
      scope.document.querySelectorAll('.row:not([hidden]) .row__hash'),
      (row) => row.textContent ?? '',
    );
    if (rows.length > 0) drawn.push(rows.slice(0, 8));
  }).observe(scope.document, { subtree: true, childList: true, characterData: true });
}

/** Runs in the page: the rows {@link recordDrawn} saw, and whether it ran first. */
function readDrawn(): { rows: string[][]; first: boolean } {
  const scope = globalThis as unknown as PageScope;
  return { rows: scope.drawnRows ?? [], first: scope.viewBeforeScript === false };
}

/** Launch on `repository` with `home` as its user-data directory, its first page drawn. */
async function launch(repository: string, home: string): Promise<Instance> {
  const started = Date.now();
  const args = ['.', repository, `--user-data-dir=${home}`];
  const application = await electron.launch({ args, cwd: repositoryRoot });
  await application.context().addInitScript(recordDrawn);
  const page = await application.firstWindow();
  await expect(box(page)).toBeEnabled();
  return { application, page, firstPageMs: Date.now() - started };
}

async function close(instance: Instance): Promise<void> {
  const child = instance.application.process();
  await instance.application.close();
  expect(child.exitCode === null && !child.killed).toBe(false);
}

/** Launch, run `body`, and close whatever `body` did. */
async function withWindow(
  repository: string,
  home: string,
  body: (page: Page) => Promise<unknown>,
): Promise<void> {
  const instance = await launch(repository, home);
  try {
    await body(instance.page);
  } finally {
    await close(instance);
  }
}

function freshHome(): string {
  temporary.push(mkdtempSync(join(tmpdir(), 'git-graphical-standalone-kept-')));
  return temporary.at(-1) ?? '';
}

/** The newest object names git prints for `revisions` in `repository`, as the table shows them. */
function gitLog(repository: string, revisions: readonly string[], count = COMPARED_ROWS): string[] {
  const args = ['log', '--format=%h', '--abbrev=8', `--max-count=${String(count)}`];
  const printed = execFileSync('git', ['-C', repository, ...args, ...revisions, '--']);
  return printed.toString().split('\n').filter(Boolean);
}

/**
 * Wait for the graph to show `revisions` of `repository` from its first row, the
 * uncommitted row above them or not, and a remote label or not. A selection
 * applied is on the disk by the time its page is drawn, so this is also what a
 * case waits on before it closes the application.
 */
async function expectGraph(
  page: Page,
  repository: string,
  graph: { revisions: readonly string[]; uncommitted?: boolean; labels?: boolean },
): Promise<void> {
  const rows = page.locator('.row:not([hidden])');
  const read = async (): Promise<unknown> => {
    const hashes = await rows.locator('.row__hash').allTextContents();
    const remote = (await rows.locator('.ref--remote').count()) > 0;
    return [hashes[0] === '', hashes.filter(Boolean).slice(0, COMPARED_ROWS), remote];
  };
  const any = expect.any(Boolean) as unknown;
  const shown = [
    graph.uncommitted ?? any,
    gitLog(repository, graph.revisions),
    graph.labels ?? any,
  ];
  await expect.poll(read).toEqual(shown);
}

/**
 * What the control and the graph show: the box's text, the checkbox, the rows the
 * open list holds and holds checked, and the graph's top rows, the uncommitted
 * row first or not, compared with `git log` of `revisions` in `repository`. A
 * remote label is drawn exactly when remote branches are shown, unless `labels`
 * says otherwise.
 */
interface Shown {
  readonly box: string;
  readonly remotes: boolean;
  readonly listed: readonly string[];
  readonly checked: readonly string[];
  readonly revisions: readonly string[];
  readonly uncommitted: boolean;
  readonly labels?: boolean;
}

async function expectShown(page: Page, repository: string, shown: Shown): Promise<void> {
  await expect(text(page)).toHaveText(shown.box);
  await expect(remotes(page)).toBeChecked({ checked: shown.remotes });
  await expectGraph(page, repository, { labels: shown.remotes, ...shown });
  await box(page).click();
  await expect.poll(() => list(page).getByRole('option').allTextContents()).toEqual(shown.listed);
  const checked = list(page).locator('[aria-selected="true"]');
  await expect.poll(() => checked.allTextContents()).toEqual(shown.checked);
  await page.keyboard.press('Escape');
}

/** Click the control: `uncheck`, `check`, or the label of a row of the list. */
async function apply(page: Page, ...clicks: string[]): Promise<void> {
  for (const click of clicks) {
    if (click === 'uncheck' || click === 'check') {
      await remotes(page).setChecked(click === 'check');
    } else {
      if (!(await list(page).isVisible())) await box(page).click();
      await entry(page, click).click();
    }
  }
  await page.keyboard.press('Escape');
}

const SHOW_ALL: Shown = {
  box: 'Show All',
  remotes: true,
  listed: [...LOCALS, ...REMOTES],
  checked: ['Show All'],
  revisions: EVERY,
  uncommitted: true,
};

const FEATURE_AND_TOPIC_LOCAL: Shown = {
  box: 'feature & topic',
  remotes: false,
  listed: LOCALS,
  checked: ['feature', 'topic'],
  revisions: [FEATURE, TOPIC],
  uncommitted: false,
};

test.beforeAll(() => {
  expect(existsSync(join(repositoryRoot, 'dist', 'main.cjs')), 'run `npm run build` first').toBe(
    true,
  );
  remotesRepository = fixture('remotes', 'remotes', 5000);
});

test.afterAll(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
  removeOwnFixtures();
});

test('a selection and Show Remote Branches survive a restart, drawn from the first page', async () => {
  const home = freshHome();
  await withWindow(remotesRepository, home, async (page) => {
    await expectShown(page, remotesRepository, SHOW_ALL);
    await apply(page, 'uncheck', 'feature', 'topic');
    await expectShown(page, remotesRepository, FEATURE_AND_TOPIC_LOCAL);
  });
  await withWindow(remotesRepository, home, async (page) => {
    await expectShown(page, remotesRepository, FEATURE_AND_TOPIC_LOCAL);
    // Every page the window ever drew is the kept selection's: no uncommitted row,
    // which every branch would have put first, and no commit outside its history.
    const drawn = await page.evaluate(readDrawn);
    const history = gitLog(remotesRepository, [FEATURE, TOPIC], 100);
    expect(drawn.first).toBe(true);
    expect(drawn.rows.length).toBeGreaterThan(0);
    for (const rows of drawn.rows) {
      expect(rows[0]).not.toBe('');
      expect(rows.filter((row) => !history.includes(row))).toEqual([]);
    }
  });
});

test('each repository keeps its own selection', async () => {
  const home = freshHome();
  const other = fixture('tags', 'tags', 3);
  await withWindow(remotesRepository, home, async (page) => {
    await apply(page, 'feature');
    await expectGraph(page, remotesRepository, { revisions: [FEATURE], uncommitted: false });
  });
  await withWindow(other, home, async (page) => {
    await expect(text(page)).toHaveText('Show All');
    await expect(remotes(page)).toBeChecked();
    await expectGraph(page, other, { revisions: EVERY });
    await apply(page, 'uncheck');
    // This repository has no remote branch, so its graph does not change: what is
    // waited on is a record saying remote branches are hidden, renamed into place
    // (the file it is written to first has a dot in its name), which the first
    // repository's, holding them shown, is not.
    const hidden = (): boolean =>
      readdirSync(join(home, RECORDS))
        .filter((name) => !name.includes('.'))
        .some((name) => readFileSync(join(home, RECORDS, name), 'utf8').includes(':false'));
    await expect.poll(hidden).toBe(true);
  });
  await withWindow(remotesRepository, home, (page) =>
    expectShown(page, remotesRepository, {
      ...SHOW_ALL,
      box: 'feature',
      checked: ['feature'],
      revisions: [FEATURE],
      uncommitted: false,
    }),
  );
  await withWindow(other, home, (page) => expect(remotes(page)).not.toBeChecked());
});

test('a second instance at once opens on what the first applied, without a stall', async () => {
  const home = freshHome();
  const first = await launch(remotesRepository, home);
  try {
    await apply(first.page, 'uncheck', 'topic');
    const topic = { ...FEATURE_AND_TOPIC_LOCAL, box: 'topic', checked: ['topic'] };
    await expectShown(first.page, remotesRepository, { ...topic, revisions: [TOPIC] });
    const second = await launch(remotesRepository, home);
    try {
      await expectShown(second.page, remotesRepository, { ...topic, revisions: [TOPIC] });
      // The first does not pick up a choice the second makes in the same repository.
      await apply(second.page, 'Show All');
      await expect(text(second.page)).toHaveText('Show All');
      await expect(text(first.page)).toHaveText('topic');
      const reading = `second instance's first page after ${String(second.firstPageMs)} ms`;
      test.info().annotations.push({ type: 'reading', description: reading });
      process.stdout.write(`selection-kept reading: ${reading}\n`);
    } finally {
      await close(second);
    }
  } finally {
    await close(first);
  }
});

test('a kept branch the repository no longer has is dropped, and Show All when none is left', async () => {
  const home = freshHome();
  const copy = ownFixture('remotes', 'remotes', 5000);
  const git = (...args: string[]): string => execFileSync('git', ['-C', copy, ...args]).toString();
  await withWindow(copy, home, async (page) => {
    await apply(page, 'feature', 'topic');
    await expectGraph(page, copy, { revisions: [FEATURE, TOPIC], uncommitted: false });
  });
  git('branch', '--quiet', '-D', 'topic');
  const feature = { box: 'feature', checked: ['feature'], revisions: [FEATURE] };
  const listed = SHOW_ALL.listed.filter((label) => label !== 'topic');
  await withWindow(copy, home, async (page) => {
    await expectShown(page, copy, { ...SHOW_ALL, ...feature, listed, uncommitted: false });
    await apply(page, 'origin/only-remote');
    await expectGraph(page, copy, { revisions: [FEATURE, ONLY_REMOTE], uncommitted: false });
  });
  // Every kept branch gone: `feature` deleted, and every branch of `origin` with
  // it, as removing the remote would.
  git('branch', '--quiet', '-D', 'feature');
  for (const name of git('for-each-ref', '--format=%(refname)', 'refs/remotes/').split('\n')) {
    if (name !== '') git('update-ref', '-d', name);
  }
  const locals = LOCALS.filter((label) => label !== 'feature' && label !== 'topic');
  await withWindow(copy, home, (page) =>
    expectShown(page, copy, { ...SHOW_ALL, listed: locals, revisions: EVERY, labels: false }),
  );
});

test('a record that is not one this application wrote opens as nothing kept', async () => {
  const home = freshHome();
  await withWindow(remotesRepository, home, async (page) => {
    await apply(page, 'uncheck', 'feature');
    await expectGraph(page, remotesRepository, { revisions: [FEATURE], labels: false });
  });
  const records = readdirSync(join(home, RECORDS));
  expect(records).toHaveLength(1);
  const record = join(home, RECORDS, records[0] ?? '');
  const malformed = [
    '{"branches":["refs/heads/feature"],"showRemoteBranches":fal',
    '{"branches":["feature"],"showRemoteBranches":false}',
    '{"branches":["refs/heads/feature"],"showRemoteBranches":"false"}',
  ];
  for (const written of malformed) {
    writeFileSync(record, written);
    await withWindow(remotesRepository, home, (page) =>
      expectShown(page, remotesRepository, SHOW_ALL),
    );
  }
});
