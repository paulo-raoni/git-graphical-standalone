import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import type {
  ApplicationInfoResponse,
  GitGraphicalBridge,
  GraphPage,
} from '../../src/contracts/index';
import { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from '../../src/core/page/index';
import { ROW_HEIGHT } from '../../src/ui/geometry';
import { fixture, fixtureRoot, ownFixture, removeOwnFixtures } from './support/fixtures';

/**
 * The whole application, against real repositories.
 *
 * Every other gate of this slice sees one layer. This one starts the built
 * application the way a person does — with a folder on the command line, or
 * with none — and reads the window. It is the only thing in the project that
 * can tell a green wiring from a working one, which is what `AGENTS.md` §7
 * means by opening the actual thing.
 *
 * **The repositories are shared with the other suites that open them, and with
 * every run on the machine.** `test/fixtures/repositories/` is rebuilt in place
 * by the generator's own test, and `src/adapters/fixtures.spec-support.ts`
 * builds a second copy for the adapter suite; `test/e2e/support/fixtures.ts`
 * builds a third for the end-to-end suites that open repositories, names them
 * in its own header, and says when a shared repository counts as built and who
 * builds it. The refresh case writes a commit into its repository, so that one
 * is this run's own, built for the case and removed after it.
 *
 * **The missing-git case is a Windows case by construction**, and it fails
 * loudly rather than passing quietly anywhere else. `src/adapters/git-executable.ts`
 * searches a configured path, then `PATH`, then the usual install locations —
 * and on Windows every one of those comes from an environment variable, so an
 * environment can hide git completely, while on a filesystem-hierarchy platform
 * `/usr/bin/git` is an absolute path no environment reaches. `.github/workflows/ci.yml`
 * runs this gate on `windows-latest` and nowhere else, which is the platform
 * `docs/ADR-0001-stack.md` verifies; a run on another platform reports this test
 * red, which is the right direction for a check that cannot make its own
 * precondition true.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Long enough for the ten-thousand-commit fixture to be written and read. */
const SLOW_TEST_MS = 240_000;

/** What the table and the failure view are spelled as in the document. */
const ROW = '.row';
const MORE = '.graph__more';
const FAILURE_HEADLINE = '.failure__headline';
const FAILURE_MESSAGE = '.failure__message';

/* --- What runs inside the page. `tsconfig.node.json` has no DOM library, so
   every element this touches is described here rather than borrowed. --- */

interface ElementLike {
  readonly clientHeight: number;
  hidden: boolean;
  scrollTop: number;
}

interface PageScope {
  readonly document: { readonly querySelector: (selector: string) => ElementLike | null };
  readonly gitGraphical: GitGraphicalBridge;
  readonly gitGraphicalView?: { readonly showPage: (page: GraphPage) => void };
  readonly performance: { readonly now: () => number };
}

/** `rows` is what the spacer is sized for, which is the page's own row count. */
type TableState = { rows: number; scrollTop: number; more: boolean };

function readTable(rowHeight: number): TableState {
  const scope = globalThis as unknown as PageScope;
  const spacer = scope.document.querySelector('.graph__spacer');
  const scroll = scope.document.querySelector('.graph__scroll');
  const more = scope.document.querySelector('.graph__more');
  return {
    rows: spacer === null ? -1 : Math.round(spacer.clientHeight / rowHeight),
    scrollTop: scroll === null ? -1 : scroll.scrollTop,
    more: more !== null && !more.hidden,
  };
}

interface RowLike {
  readonly style: { readonly transform: string };
  readonly textContent: string | null;
  readonly hidden: boolean;
}

/**
 * What the row standing at `top` inside the scrolled area says.
 *
 * Found by the transform the pool element carries rather than by its position
 * among its siblings, because the pool assigns a row to a slot by `row modulo
 * pool size` — so the first `.row` in the document is the first *slot*, which at
 * any offset but zero is holding some other row.
 */
function rowTextAt(top: number): string {
  const scope = globalThis as unknown as {
    readonly document: { readonly querySelectorAll: (selector: string) => Iterable<RowLike> };
  };
  for (const row of scope.document.querySelectorAll('.row')) {
    if (!row.hidden && row.style.transform === `translateY(${String(top)}px)`) {
      return row.textContent ?? '';
    }
  }
  return '';
}

function setScroll(offset: number): number {
  const scope = globalThis as unknown as PageScope;
  const scroll = scope.document.querySelector('.graph__scroll');
  if (scroll === null) {
    return -1;
  }
  scroll.scrollTop = offset;
  return scroll.scrollTop;
}

/** Press Load More `presses` times over the bridge, timing each round trip. */
async function timeLoadMores(input: { presses: number; count: number }): Promise<number[]> {
  const scope = globalThis as unknown as PageScope;
  const times: number[] = [];
  for (let press = 0; press < input.presses; press += 1) {
    const at = scope.performance.now();
    const reply = await scope.gitGraphical.loadMoreCommits({ count: input.count });
    if (!reply.ok) {
      throw new Error(reply.message);
    }
    scope.gitGraphicalView?.showPage(reply.value);
    times.push(Math.round(scope.performance.now() - at));
  }
  return times;
}

/**
 * Load `count` more commits while asking the main process a question it answers
 * by itself, as often as it will answer.
 *
 * `startupRepository` is the one channel `src/app/handlers.ts` answers without
 * asking the utility process anything, so a slow reply to it is the main process
 * being busy and nothing else. If the parsing and the layout were happening
 * there, these round trips would stall for as long as the load takes.
 */
async function probeWhileLoading(input: {
  count: number;
}): Promise<{ loadMs: number; worstProbeMs: number; probes: number; rows: number }> {
  const scope = globalThis as unknown as PageScope;
  const started = scope.performance.now();
  const loading = scope.gitGraphical.loadMoreCommits({ count: input.count });
  // Raced rather than watched through a flag: the load and one probe are the
  // only two things in flight, and whichever settles first says what to do next.
  const stopped = Symbol('the load finished');
  const ends = loading.then(() => stopped);
  let worstProbeMs = 0;
  let probes = 0;
  for (;;) {
    const at = scope.performance.now();
    const outcome = await Promise.race([ends, scope.gitGraphical.startupRepository()]);
    if (outcome === stopped) {
      break;
    }
    worstProbeMs = Math.max(worstProbeMs, scope.performance.now() - at);
    probes += 1;
  }
  const reply = await loading;
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return {
    loadMs: Math.round(scope.performance.now() - started),
    worstProbeMs: Math.round(worstProbeMs),
    probes,
    rows: reply.value.layout.rowCount,
  };
}

function askApplicationInfo(): Promise<ApplicationInfoResponse> {
  return (globalThis as unknown as PageScope).gitGraphical.applicationInfo();
}

/* --- Driving the built application. --- */

/** `open` is the folder to start with; `env` hides git for the one case that needs it. */
type Launch = { open?: string; env?: Record<string, string> };

/**
 * Launch the built application, run `body` against its window, and stop it.
 *
 * The exit status is read back afterwards, as the other end-to-end suites do:
 * a leaked Electron process is a failure of the gate whatever the assertions
 * said, and the utility process this slice adds is a child of that one.
 */
async function withWindow(launch: Launch, body: (page: Page) => Promise<void>): Promise<void> {
  const args = launch.open === undefined ? ['.'] : ['.', launch.open];
  const application: ElectronApplication = await electron.launch({
    args,
    cwd: repositoryRoot,
    ...(launch.env === undefined ? {} : { env: launch.env }),
  });
  try {
    await body(await application.firstWindow());
  } finally {
    const child = application.process();
    await application.close();
    expect(child.exitCode === null && !child.killed).toBe(false);
  }
}

/** An environment in which none of the places discovery looks holds a git. */
function environmentWithoutGit(nowhere: string): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      inherited[name] = value;
    }
  }
  const roots = [
    'PATH',
    'Path',
    'ProgramFiles',
    'ProgramW6432',
    'ProgramFiles(x86)',
    'LOCALAPPDATA',
  ];
  for (const name of roots) {
    inherited[name] = nowhere;
  }
  return inherited;
}

test.beforeAll(() => {
  if (!existsSync(join(repositoryRoot, 'dist', 'main.cjs'))) {
    throw new Error('run `npm run build` before the end-to-end gate');
  }
});

test.afterEach(removeOwnFixtures);

test('a repository named on the command line is open when the window appears', async () => {
  const tags = fixture('tags', 'tags', 3);
  await withWindow({ open: tags }, async (page) => {
    await expect(page.locator(ROW).first()).toContainText('commit 3');
    await expect(page.locator('.bar__path')).toHaveText(tags);
    await expect(page.locator('.ref--head')).toHaveText('main');
    await expect(page.locator('.ref--tag')).toHaveText(['annotated', 'lightweight']);
    await expect(page.locator(ROW).nth(1)).toContainText('commit 2');
    await expect(page.locator(MORE)).toBeHidden();
    expect((await page.evaluate(readTable, ROW_HEIGHT)).rows).toBe(3);
  });
});

test('a dirty working tree puts the uncommitted row above every commit', async () => {
  const dirty = fixture('dirty-working-tree', 'dirty-working-tree', 2);
  await withWindow({ open: dirty }, async (page) => {
    await expect(page.locator(ROW).first()).toContainText('Uncommitted changes (2)');
    await expect(page.locator(ROW).nth(1)).toContainText('commit 2');
    expect((await page.evaluate(readTable, ROW_HEIGHT)).rows).toBe(3);
  });
});

test('the window says what git said when the folder is not a repository', async () => {
  const notARepository = join(fixtureRoot, 'not-a-repository');
  mkdirSync(notARepository, { recursive: true });
  await withWindow({ open: notARepository }, async (page) => {
    await expect(page.locator(FAILURE_HEADLINE)).toHaveText('That folder is not a git repository.');
    await expect(page.locator(FAILURE_MESSAGE)).toContainText('not a git repository');
    await expect(page.locator('.bar__open')).toBeEnabled();
  });
});

test('the window says so when git cannot be found, and says where it looked', async () => {
  const nowhere = join(fixtureRoot, 'no-git-here');
  mkdirSync(nowhere, { recursive: true });
  await withWindow(
    { open: fixture('tags', 'tags', 3), env: environmentWithoutGit(nowhere) },
    async (page) => {
      await expect(page.locator(FAILURE_HEADLINE)).toHaveText(
        'Git could not be found on this machine.',
      );
      await expect(page.locator(FAILURE_MESSAGE)).toContainText('No git executable was found');
      await expect(page.locator(FAILURE_MESSAGE)).toContainText(nowhere);
    },
  );
});

test('refresh shows a commit made since the repository was opened', async () => {
  const target = ownFixture('refresh-target', 'linear', 5);
  await withWindow({ open: target }, async (page) => {
    await expect(page.locator(ROW).first()).toContainText('commit 5');
    execFileSync('git', ['-C', target, 'commit', '--allow-empty', '-m', 'made while open'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture Author',
        GIT_AUTHOR_EMAIL: 'author@fixture.invalid',
        GIT_COMMITTER_NAME: 'Fixture Committer',
        GIT_COMMITTER_EMAIL: 'committer@fixture.invalid',
      },
      stdio: 'ignore',
    });
    await page.locator('.bar__refresh').click();
    await expect(page.locator(ROW).first()).toContainText('made while open');
    expect((await page.evaluate(readTable, ROW_HEIGHT)).rows).toBe(6);
  });
});

test('load more grows the page by one page and leaves the scroll where it was', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  await withWindow({ open: large }, async (page) => {
    await expect(page.locator(MORE)).toBeVisible();
    const opened = await page.evaluate(readTable, ROW_HEIGHT);
    expect(opened.rows).toBe(FIRST_PAGE_COMMITS);
    const offset = 40 * ROW_HEIGHT;
    expect(await page.evaluate(setScroll, offset)).toBe(offset);
    await expect.poll(() => page.evaluate(rowTextAt, offset)).toContain('commit');
    const wasOnTop = await page.evaluate(rowTextAt, offset);
    // Dispatched rather than clicked, because Playwright's click scrolls the
    // control into view first — the control sits below the last row — and that
    // moves the offset this case is about before the load has even started.
    await page.locator(MORE).dispatchEvent('click');
    await expect
      .poll(async () => (await page.evaluate(readTable, ROW_HEIGHT)).rows, { timeout: 60_000 })
      .toBe(FIRST_PAGE_COMMITS + FURTHER_PAGE_COMMITS);
    const grown = await page.evaluate(readTable, ROW_HEIGHT);
    expect(grown.scrollTop).toBe(offset);
    expect(grown.more).toBe(true);
    expect(await page.evaluate(rowTextAt, offset)).toBe(wasOnTop);
    expect(await page.evaluate(setScroll, 0)).toBe(0);
    await expect(page.locator(ROW).first()).toContainText('commit 10000');
  });
});

test('the second and the fifth load more, measured on ten thousand commits', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  await withWindow({ open: large }, async (page) => {
    await expect(page.locator(MORE)).toBeVisible();
    const times = await page.evaluate(timeLoadMores, { presses: 5, count: FURTHER_PAGE_COMMITS });
    process.stdout.write(
      `load more, ${String(FURTHER_PAGE_COMMITS)} commits a press, five presses: ` +
        `${times.map((ms) => `${String(ms)} ms`).join(', ')}\n`,
    );
    expect(times).toHaveLength(5);
    expect((await page.evaluate(readTable, ROW_HEIGHT)).rows).toBe(
      FIRST_PAGE_COMMITS + 5 * FURTHER_PAGE_COMMITS,
    );
  });
});

test('the main process keeps answering while the whole of a large load runs @budgets', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  await withWindow({ open: large }, async (page) => {
    await expect(page.locator(MORE)).toBeVisible();
    const measured = await page.evaluate(probeWhileLoading, { count: 10_000 - FIRST_PAGE_COMMITS });
    process.stdout.write(
      `a ${String(measured.loadMs)} ms load answered ${String(measured.probes)} main-process ` +
        `round trips, worst ${String(measured.worstProbeMs)} ms\n`,
    );
    expect(measured.probes).toBeGreaterThan(10);
    expect(measured.worstProbeMs).toBeLessThan(500);
    expect(measured.rows).toBe(10_000);
  });
});

test('the application reports the git it found', async () => {
  await withWindow({}, async (page) => {
    await expect(page.locator('.empty-state__message')).toBeVisible();
    const info = await page.evaluate(askApplicationInfo);
    expect(info.ok).toBe(true);
    if (info.ok) {
      expect(info.value.git).toMatch(/^git version \d+\.\d+/);
      expect(info.value.electron).toMatch(/^\d+\./);
      expect(info.value.version.length).toBeGreaterThan(0);
    }
  });
});
