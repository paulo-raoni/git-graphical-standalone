import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from '../../src/core/page/index';
import { ROW_HEIGHT } from '../../src/ui/geometry';
import { fixture } from './support/fixtures';

/**
 * The bar's Branches dropdown and Show Remote Branches checkbox, driven by clicks
 * and keys through the built application.
 *
 * Each case holds a part of the reference behaviour recorded in
 * `docs/plan/E03-branch-filtering-and-find/M01-branches-dropdown/S10-branches-dropdown.md`,
 * most of it as a list of {@link Step}s: actions, then what the box, the list and
 * the graph must show after them. The list, the box and the checkbox are found the
 * way assistive technology finds them, by role and accessible name; the graph is
 * read from the rows it draws — each row's abbreviated object name, whether it is
 * the uncommitted row and whether a remote label is drawn — and compared with what
 * `git log` prints for the same revisions.
 *
 * The repository is the `remotes` fixture (`test/fixtures/generate.ts`): `main`
 * checked out over a dirty working tree, the local branches `feature`, `release`
 * and `topic`, and `origin/HEAD`, `origin/feature`, `origin/main` and
 * `origin/only-remote`, the last reached by no local branch; two tags. The
 * thousand-branch repository of the last case is built by this file, privately.
 *
 * **Every launch has a user-data directory of its own** (`--user-data-dir`), so a
 * Show Remote Branches choice one case stores cannot reach another case, nor the
 * person who runs the suite. The case that holds the choice across a restart
 * launches more than once on one directory, on purpose.
 */

test.describe.configure({ timeout: 180_000 });

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** How many of the graph's top commit rows a step compares with git. */
const COMPARED_ROWS = 8;

const EVERY = ['--branches', '--tags', '--remotes', 'HEAD'];
const EVERY_LOCAL = ['--branches', '--tags', 'HEAD'];
const [MAIN, FEATURE] = ['refs/heads/main', 'refs/heads/feature'];
const [RELEASE, TOPIC] = ['refs/heads/release', 'refs/heads/topic'];
const ONLY_REMOTE = 'refs/remotes/origin/only-remote';
const LOCALS = ['main', 'feature', 'release', 'topic'];
const REMOTES = ['origin/HEAD', 'origin/feature', 'origin/main', 'origin/only-remote'];
const ENTRIES = ['Show All', ...LOCALS, ...REMOTES];
const ALONE = ['Show All'];

/** How many branches the last case's repository has, `main` among them. */
const MANY = 1_000;
const LONG_NAME = `a-branch-whose-name-is-far-longer-than-the-box-${'x'.repeat(40)}`;

let remotesRepository = '';
let manyRepository = '';
const temporary: string[] = [];
let page: Page;

const box = (): Locator => page.getByRole('button', { name: /^Branches:/ });
const list = (): Locator => page.getByRole('listbox', { name: 'Branches' });
const options = (): Locator => list().getByRole('option');
const filter = (): Locator => page.getByRole('textbox', { name: 'Filter branches' });
const remotes = (): Locator => page.getByRole('checkbox', { name: 'Show Remote Branches' });
const entry = (label: string): Locator => options().filter({ hasText: new RegExp(`^${label}$`) });

/**
 * The checkbox after a first page, as assistive technology reads it: checked or not,
 * where an indeterminate box reads `mixed` and matches neither. `toBeChecked` reads
 * the `checked` property alone, which a box left indeterminate also carries.
 */
const [SHOWN, HIDDEN] = ['- checkbox [checked=true]', '- checkbox [checked=false]'];

/** What {@link measure} touches in the page. `tsconfig.node.json` has no DOM library. */
interface PageScope {
  readonly document: {
    readonly querySelector: (selector: string) => { click(): void } | null;
    readonly querySelectorAll: (selector: string) => ArrayLike<unknown>;
  };
  readonly performance: { now(): number };
  readonly requestAnimationFrame: (callback: () => void) => number;
}

/**
 * Runs in the page: how long it takes from a click on `target` until `selector`
 * finds `count` elements and a frame has run after that.
 */
async function measure([target, selector, count]: readonly (string | number)[]): Promise<number> {
  const { document, performance, requestAnimationFrame } = globalThis as unknown as PageScope;
  const frame = (): Promise<void> =>
    new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
  const started = performance.now();
  document.querySelector(String(target))?.click();
  while (document.querySelectorAll(String(selector)).length !== count) await frame();
  await frame();
  return performance.now() - started;
}

/** The newest object names git prints for `revisions`, abbreviated as the table shows them. */
function gitLog(revisions: readonly string[]): string[] {
  const args = ['log', '--format=%h', '--abbrev=8', `--max-count=${String(COMPARED_ROWS)}`];
  const printed = execFileSync('git', ['-C', remotesRepository, ...args, ...revisions, '--']);
  return printed.toString().split('\n').filter(Boolean);
}

/**
 * Launch on `repository`, or on none, with `home` as its user-data directory, run
 * `body`, close it. On none, no page arrives until one is opened: the control is
 * required disabled, as it is before a first page.
 */
async function withWindow(repository: string | null, home: string, body: () => Promise<unknown>) {
  const args = ['.', ...(repository === null ? [] : [repository]), `--user-data-dir=${home}`];
  const application = await electron.launch({ args, cwd: repositoryRoot });
  const child = application.process();
  try {
    page = await application.firstWindow();
    if (repository === null) await expect(remotes()).toBeDisabled();
    else await expect(box()).toBeEnabled();
    await body();
  } finally {
    await application.close();
    expect(child.exitCode === null && !child.killed).toBe(false);
  }
}

function freshHome(): string {
  temporary.push(mkdtempSync(join(tmpdir(), 'git-graphical-standalone-branches-')));
  return temporary.at(-1) ?? '';
}

async function rect(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const shown = await locator.boundingBox();
  if (shown === null) throw new Error('not on screen');
  return { x: shown.x, y: shown.y, w: shown.width, h: shown.height };
}

/** How many rows the table is sized for, which is the page's own row count. */
const rowCount = async (): Promise<number> =>
  Math.round((await rect(page.locator('.graph__spacer'))).h / ROW_HEIGHT);

/** Revisions the graph shows from its first row, whether the uncommitted row is above them, and whether any remote label is drawn. */
type Graph = readonly [readonly string[], boolean, boolean?];

/**
 * Require the graph to show `revisions` from its first row. The rows are read in
 * the document's order, which is their order on screen while the table is at its
 * top: the pool puts row *n* in slot *n* then (`rowInSlot` of `src/ui/geometry.ts`),
 * and every selection's page is drawn from its first row.
 */
async function expectGraph([revisions, uncommitted, remote]: Graph): Promise<void> {
  const rows = page.locator('.row:not([hidden])');
  const read = async (): Promise<unknown> => {
    const hashes = await rows.locator('.row__hash').allTextContents();
    const remotes = (await rows.locator('.ref--remote').count()) > 0;
    return [hashes[0] === '', hashes.filter(Boolean).slice(0, COMPARED_ROWS), remotes];
  };
  await expect.poll(read).toEqual([uncommitted, gitLog(revisions), remote ?? expect.any(Boolean)]);
}

/**
 * Actions — `verb` or `verb:argument`, separated by `, ` — then what must be
 * shown: the element with the focus, the box's text, the labels the open list
 * shows checked, the labels it shows, and the graph.
 */
interface Step {
  readonly do?: string;
  readonly focused?: Locator;
  readonly box?: string;
  readonly checked?: readonly string[];
  readonly listed?: readonly string[];
  readonly graph?: Graph;
}

const ACTIONS: Readonly<Record<string, (argument: string) => Promise<unknown>>> = {
  '': () => Promise.resolve(),
  open: () => box().click(),
  click: (label) => entry(label).click(),
  dblclick: (label) => entry(label).dblclick(),
  key: (key) => page.keyboard.press(key),
  uncheck: () => remotes().uncheck(),
  check: () => remotes().check(),
  refresh: () => page.locator('.bar__refresh').click(),
  // Dispatched rather than clicked, so the table is not scrolled to the control first.
  more: () => page.locator('.graph__more').dispatchEvent('click'),
};

const checkedOf = (): Promise<string[]> =>
  list().locator('[aria-selected="true"]').allTextContents();
const listed = (): Promise<string[]> => options().allTextContents();

async function play(steps: readonly Step[]): Promise<void> {
  for (const step of steps) {
    for (const act of (step.do ?? '').split(', ')) {
      const [verb, ...argument] = act.split(':');
      const action = ACTIONS[String(verb)];
      if (action === undefined) throw new Error(`no action ${String(verb)}`);
      await action(argument.join(':'));
    }
    if (step.focused !== undefined) await expect(step.focused).toBeFocused();
    if (step.box !== undefined) await expect(page.locator('.branches__text')).toHaveText(step.box);
    if (step.checked !== undefined) await expect.poll(checkedOf).toEqual(step.checked);
    if (step.listed !== undefined) await expect.poll(listed).toEqual(step.listed);
    if (step.graph !== undefined) await expectGraph(step.graph);
  }
}

/** Runs in the page: whether `element` is cut short, and how far it is scrolled. */
function overflowOf(element: unknown): { cut: boolean; scrollTop: number } {
  const shown = element as { scrollWidth: number; clientWidth: number; scrollTop: number };
  return { cut: shown.scrollWidth > shown.clientWidth, scrollTop: shown.scrollTop };
}

/**
 * `MANY` branches on a history of two commits: `main` checked out on the second,
 * every other branch on the root.
 */
function buildMany(directory: string): void {
  mkdirSync(directory, { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', directory, ...args])
      .toString()
      .trim();
  const commit = ['-c', 'user.name=A', '-c', 'user.email=a@a.invalid', 'commit', '--quiet'];
  git('init', '--quiet', '--initial-branch=main');
  git(...commit, '--allow-empty', '-m', 'root');
  git(...commit, '--allow-empty', '-m', 'tip');
  const root = git('rev-parse', 'HEAD~1');
  const names = Array.from({ length: MANY - 2 }, (_, at) => `b${String(at + 1).padStart(3, '0')}`);
  const creates = [...names, LONG_NAME].map((name) => `create refs/heads/${name} ${root}\n`);
  execFileSync('git', ['-C', directory, 'update-ref', '--stdin'], { input: creates.join('') });
}

test.beforeAll(() => {
  const built = existsSync(join(repositoryRoot, 'dist', 'main.cjs'));
  expect(built, 'run `npm run build` first').toBe(true);
  remotesRepository = fixture('remotes', 'remotes', 5000);
  manyRepository = join(freshHome(), 'many');
  buildMany(manyRepository);
});

test.afterAll(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('the bar shows Branches, the box and the checkbox, and the list opens under the box', async () => {
  await withWindow(remotesRepository, freshHome(), async () => {
    await expect(remotes()).toMatchAriaSnapshot(SHOWN);
    await play([{ box: 'Show All', listed: [], graph: [EVERY, true, true] }]);
    const label = await rect(page.getByText('Branches:', { exact: true }));
    const [shut, checkbox] = [await rect(box()), await rect(remotes())];
    expect(label.x < shut.x && shut.x < checkbox.x).toBe(true);
    for (const each of [label, checkbox]) {
      expect(Math.abs(each.y + each.h / 2 - shut.y - shut.h / 2)).toBeLessThan(shut.h / 2);
    }
    await expect(list()).toBeHidden();
    // `main` first is the checked-out branch first: by name it would follow `feature`.
    await play([{ do: 'open', checked: ALONE, listed: ENTRIES }]);
    // Found by its exact name: the check mark is drawn, and `aria-selected` alone says it.
    const checked = list().getByRole('option', { name: 'Show All', exact: true, selected: true });
    await expect(checked).toHaveCSS('content', '"✓ " / ""', { pseudo: 'before' });
    await expect(entry('feature')).toHaveCSS('content', 'none', { pseudo: 'before' });
    await expect(box()).toHaveAttribute('aria-expanded', 'true');
    await expect(filter()).toHaveAttribute('placeholder', 'Filter branches…');
    const [popup, opened] = [await rect(page.locator('.branches__popup')), await rect(box())];
    const corner = [popup.x, popup.w, popup.y].map(Math.round);
    expect(corner).toEqual([opened.x, opened.w, opened.y + opened.h].map(Math.round));
    // Over the graph: the last entry, below the bar, is what the pointer meets there.
    await entry('origin/only-remote').hover({ trial: true });
    const transparent = 'rgba(0, 0, 0, 0)';
    await expect(entry('feature')).toHaveCSS('background-color', transparent);
    await entry('feature').hover();
    await expect(entry('feature')).not.toHaveCSS('background-color', transparent);
    await page.locator('.graph').click({ position: { x: 5, y: 5 } });
    await expect(list()).toBeHidden();
    await expect(box()).toHaveAttribute('aria-expanded', 'false');
  });
});

test('a click adds or removes one branch, keeps the list open, and redraws the graph', async () => {
  await withWindow(remotesRepository, freshHome(), async () => {
    const three = 'main, feature & origin/only-remote';
    await play([
      { do: 'open, click:feature', box: 'feature', checked: ['feature'] },
      { graph: [[FEATURE], false] },
      { do: 'click:origin/only-remote', box: 'feature & origin/only-remote' },
      // The list's order, not the order of the clicks.
      { do: 'click:main', box: three, checked: ['main', 'feature', 'origin/only-remote'] },
      { graph: [[MAIN, FEATURE, ONLY_REMOTE], true] },
      { do: 'click:feature', box: 'main & origin/only-remote', graph: [[MAIN, ONLY_REMOTE], true] },
      // Removing the last one returns to Show All.
      { do: 'click:main, click:origin/only-remote', box: 'Show All', checked: ALONE },
      { graph: [EVERY, true] },
      { do: 'click:topic, click:release', box: 'release & topic' },
      { graph: [[RELEASE, TOPIC], false] },
      { do: 'click:Show All', box: 'Show All', checked: ALONE, graph: [EVERY, true] },
      { do: 'click:feature, click:topic', box: 'feature & topic' },
    ]);
    await expect(list()).toBeVisible();
    await expect(box()).toHaveAttribute('title', 'feature & topic');
  });
});

test('double-clicking Show All checks every entry, and toggles back', async () => {
  await withWindow(remotesRepository, freshHome(), async () => {
    const rest = ENTRIES.slice(1).filter((label) => label !== 'feature');
    const text = `${rest.slice(0, -1).join(', ')} & origin/only-remote`;
    const graph = [MAIN, RELEASE, TOPIC, ...REMOTES.map((name) => `refs/remotes/${name}`)];
    await play([
      { do: 'open, dblclick:Show All', box: 'Show All', checked: ENTRIES, graph: [EVERY, true] },
      // From every entry checked, a click unchecks only that one.
      { do: 'click:feature', box: text, checked: rest, graph: [graph, true] },
      { do: 'dblclick:Show All', box: 'Show All', checked: ENTRIES, graph: [EVERY, true] },
      { do: 'dblclick:Show All', box: 'Show All', checked: ALONE, graph: [EVERY, true] },
    ]);
  });
});

test('unchecking Show Remote Branches drops remote entries, labels and selections', async () => {
  await withWindow(remotesRepository, freshHome(), async () => {
    const wide = (await rect(box())).w;
    await play([
      { do: 'open, click:feature, click:origin/only-remote', box: 'feature & origin/only-remote' },
      { do: 'key:Escape, uncheck', box: 'feature', graph: [[FEATURE], false, false] },
      { do: 'open', checked: ['feature'], listed: ['Show All', ...LOCALS] },
    ]);
    // The box follows its widest entry, which is now a local one.
    expect((await rect(box())).w).toBeLessThan(wide);
    await play([
      // Checked again, it restores no remote selection.
      { do: 'check', box: 'feature', graph: [[FEATURE], false, true] },
      { do: 'open', checked: ['feature'], listed: ENTRIES },
      { do: 'click:feature, click:origin/only-remote', box: 'origin/only-remote' },
      // Only remote branches selected: unchecking returns to Show All.
      { do: 'key:Escape, uncheck', box: 'Show All', graph: [EVERY_LOCAL, true, false] },
      { do: 'check', box: 'Show All', graph: [EVERY, true, true] },
    ]);
    expect((await rect(box())).w).toBe(wide);
  });
});

test('Refresh and Load More keep the selection; a restart keeps it and Show Remote Branches', async () => {
  const home = freshHome();
  const feature: Step = { box: 'feature', graph: [[FEATURE], false, false] };
  await withWindow(remotesRepository, home, async () => {
    await play([{ do: 'uncheck, open, click:feature, key:Escape' }, feature]);
    await play([{ do: 'refresh' }, feature, { do: 'more' }, feature]);
    await expect.poll(rowCount).toBe(FIRST_PAGE_COMMITS + FURTHER_PAGE_COMMITS);
  });
  await withWindow(remotesRepository, home, async () => {
    await expect(remotes()).toMatchAriaSnapshot(HIDDEN);
    await play([feature, { do: 'open', checked: ['feature'], listed: ['Show All', ...LOCALS] }]);
  });
  // Before a first page, nothing has said what is kept: the checkbox is in neither state.
  await withWindow(null, home, () => expect(remotes()).toBeChecked({ indeterminate: true }));
  // Another repository on the same user-data directory has a choice of its own.
  await withWindow(manyRepository, home, () => expect(remotes()).toMatchAriaSnapshot(SHOWN));
});

test('the control works from the keyboard alone', async () => {
  await withWindow(remotesRepository, freshHome(), async () => {
    // Open Repository, Refresh, then the box.
    await play([
      { do: 'key:Tab, key:Tab, key:Tab', focused: box() },
      { do: 'key:Enter', focused: filter() },
      // Case-insensitive, and Show All stays.
      { do: 'key:F, key:e, key:A, key:t', listed: ['Show All', 'feature', 'origin/feature'] },
      { do: 'key:ArrowDown', focused: options().first() },
      { do: 'key:ArrowDown, key:Space', box: 'feature', checked: ['feature'] },
      { graph: [[FEATURE], false] },
      { do: 'key:ArrowDown, key:Enter', box: 'feature & origin/feature' },
      { do: 'key:ArrowUp, key:ArrowUp, key:ArrowUp', focused: filter() },
      { do: 'key:Escape', focused: box(), listed: [] },
      { do: 'key:Space', listed: ENTRIES },
    ]);
    await expect(filter()).toHaveValue('');
    await play([{ do: 'key:ArrowDown, key:Enter', box: 'Show All' }, { do: 'key:Escape' }]);
    await expect(page.getByRole('button', { name: 'Branches: Show All' })).toBeFocused();
  });
});

test('a thousand branches open, scroll, filter and select', async () => {
  await withWindow(manyRepository, freshHome(), async () => {
    const opening = await page.evaluate(measure, ['.branches__box', '[role=option]', 1 + MANY]);
    await expect(list()).toBeVisible();
    // About nine and a half rows show; the rest scroll inside the list.
    const popup = page.locator('.branches__popup');
    const shownRows = (await rect(popup)).h / (await rect(options().first())).h;
    expect(shownRows > 9 && shownRows < 11).toBe(true);
    // A long name is cut short, and named in full on hover.
    const long = options().filter({ hasText: LONG_NAME });
    expect(await long.evaluate(overflowOf)).toMatchObject({ cut: true });
    await expect(long).toHaveAttribute('title', LONG_NAME);
    await options().last().scrollIntoViewIfNeeded();
    expect((await popup.evaluate(overflowOf)).scrollTop).toBeGreaterThan(0);
    // Reopened, it is scrolled to the top.
    await play([{ do: 'open, open' }]);
    expect(await popup.evaluate(overflowOf)).toMatchObject({ scrollTop: 0 });
    await filter().fill('B09');
    await expect(options()).toHaveCount(1 + 10);
    // `b090` is the root alone: one row where Show All had two.
    const selecting = await page.evaluate(measure, ['[title="b090"]', '.row:not([hidden])', 1]);
    await expect(page.locator('.branches__text')).toHaveText('b090');
    expect(await rowCount()).toBe(1);
    const reading = `open ${opening.toFixed(1)} ms, select ${selecting.toFixed(1)} ms`;
    test.info().annotations.push({ type: 'reading', description: reading });
    process.stdout.write(`branches-dropdown reading, ${String(MANY)} branches: ${reading}\n`);
  });
});
