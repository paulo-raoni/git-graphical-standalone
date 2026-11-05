import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

import { FailureKind, RefKind, UNKNOWN_INDEX } from '../../src/contracts/index';
import type { BranchSelection, GitGraphicalBridge, GraphPage } from '../../src/contracts/index';
import { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from '../../src/core/page/index';
import { fixture, withOwnProfile } from './support/fixtures';

/**
 * A branch selection, driven through the bridge of the built application, reaches
 * git and is kept.
 *
 * The Branches dropdown applies a selection since E03-M01-S10, and
 * `branches-dropdown.spec.ts` drives it. The cases here go beneath it and call
 * `window.gitGraphical` as the dropdown does — `refresh` with a `selection` to
 * apply one — so that they can also send requests together and set their replies
 * racing on cue, read again under a selection with `refresh({})` and
 * `loadMoreCommits`, and open without remote branches with `openRepository` and
 * `showRemoteBranches`. Each reply is drawn with the view's own `showPage`, in the order the
 * replies arrive, as the renderer draws them, and the window is photographed into
 * this run's output directory after each selection so that what was drawn can be
 * looked at.
 *
 * Every launch is on a user-data directory of its own (`withOwnProfile`,
 * `./support/fixtures.ts`), so a selection kept by an earlier run is not what the
 * first page opens on, and none applied here is kept past the case.
 *
 * The repository is the `remotes` fixture (`test/fixtures/generate.ts`): a trunk
 * of 5 000 commits on `main`, `feature` and `topic` cut from its end, `topic`
 * merged into `main`, a remote-tracking `origin/only-remote` no local branch
 * reaches, and `main` checked out over a dirty working tree. Every page is
 * compared, object name for object name, with what `git log` itself prints for
 * the same revisions.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SLOW_TEST_MS = 180_000;

/** More commits than the fixture holds, so a Load More of this many reads all of it. */
const WHOLE_HISTORY = 100_000;

const MORE = '.graph__more';

/** One request over the bridge. */
type Step =
  | { readonly call: 'refresh'; readonly selection?: BranchSelection }
  | { readonly call: 'loadMore'; readonly count: number }
  | { readonly call: 'open'; readonly path: string; readonly showRemoteBranches: boolean };

/** What one page drawn came to: its object names, its labels by row, and its rows. */
interface Drawn {
  readonly ok: true;
  readonly step: number;
  readonly names: string[];
  readonly labels: Record<string, number>;
  readonly hasChanges: boolean;
  readonly rows: number;
  readonly hasMore: boolean;
  readonly layout: string;
}

/** What one reply came to: a page drawn, or the failure it answered. */
type Summary = Drawn | { readonly ok: false; readonly step: number; readonly kind: string };

/* --- What runs inside the page, where nothing defined outside can be called. --- */

interface PageScope {
  readonly gitGraphical: GitGraphicalBridge;
  readonly gitGraphicalView?: { readonly showPage: (page: GraphPage) => void };
  summariseReply?: (step: number, page: GraphPage) => Drawn;
}

/**
 * Put the summariser on the page's global, once a window: what `drive` reports
 * of a page, as plain values a test can compare.
 */
function installSummariser(): void {
  const scope = globalThis as unknown as PageScope;
  scope.summariseReply = (step: number, page: GraphPage): Drawn => {
    const { commits, refs, workingTree } = page;
    const hex = Array.from(commits.hashes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const labels: Record<string, number> = {};
    for (let at = 0; at < refs.count; at += 1) {
      const name = refs.names.slice(refs.nameOffsets[at], refs.nameOffsets[at + 1]);
      labels[`${String(refs.kind[at])}:${name}`] = refs.commitIndex[at] ?? -1;
    }
    const names = Array.from({ length: commits.count }, (_, row) =>
      hex.slice(row * 40, row * 40 + 40),
    );
    const { rowCount: rows, maxLane, ...columns } = page.layout;
    const columnValues = Object.values(columns).map((column) => Array.from(column));
    const layout = JSON.stringify([maxLane, ...columnValues]);
    const { hasChanges } = workingTree;
    return { ok: true, step, names, labels, hasChanges, rows, hasMore: page.hasMore, layout };
  };
}

/**
 * Send `steps` over the bridge — one after another, or all at once — draw every
 * page that comes back in the order it comes back, and summarise each reply in
 * that order.
 */
async function drive(input: { steps: readonly Step[]; together: boolean }): Promise<Summary[]> {
  const scope = globalThis as unknown as PageScope;
  const bridge = scope.gitGraphical;
  const ask = (step: Step): ReturnType<GitGraphicalBridge['refresh']> => {
    if (step.call === 'loadMore') {
      return bridge.loadMoreCommits({ count: step.count });
    }
    if (step.call === 'open') {
      const { path, showRemoteBranches } = step;
      return bridge.openRepository({ path, showRemoteBranches });
    }
    return bridge.refresh(step.selection === undefined ? {} : { selection: step.selection });
  };
  const answered: Summary[] = [];
  const settle = (step: number, reply: Awaited<ReturnType<typeof ask>>): void => {
    if (!reply.ok) {
      answered.push({ ok: false, step, kind: reply.kind });
      return;
    }
    scope.gitGraphicalView?.showPage(reply.value);
    const summary = scope.summariseReply?.(step, reply.value);
    answered.push(summary ?? { ok: false, step, kind: 'no summariser installed' });
  };
  if (input.together) {
    await Promise.all(
      input.steps.map(async (step, at) => {
        settle(at, await ask(step));
      }),
    );
  } else {
    for (const [at, step] of input.steps.entries()) {
      settle(at, await ask(step));
    }
  }
  return answered;
}

/* --- Driving the built application, and the witness. --- */

let where = '';

/** The newest `count` object names git's own log prints for `revisions`. */
function gitLog(revisions: readonly string[], count: number): string[] {
  return execFileSync(
    'git',
    ['-C', where, 'log', '--format=%H', `--max-count=${String(count)}`, ...revisions, '--'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter((line) => line.length > 0);
}

/**
 * Launch the built application on the fixture, on a user-data directory of its own,
 * run `body` once the first page is drawn, and stop it.
 */
async function withWindow(body: (page: Page) => Promise<void>): Promise<void> {
  await withOwnProfile({ open: where }, async (application) => {
    const page = await application.firstWindow();
    await expect(page.locator(MORE)).toBeVisible();
    await page.evaluate(installSummariser);
    await body(page);
  });
}

/** Send one step, photograph what was drawn, and return its reply. */
async function one(page: Page, step: Step, info: TestInfo, photo?: string): Promise<Drawn> {
  const [reply] = await page.evaluate(drive, { steps: [step], together: false });
  if (photo !== undefined) {
    await page.screenshot({ path: info.outputPath(`${photo}.png`) });
  }
  if (reply?.ok !== true) {
    throw new Error(`step ${JSON.stringify(step)} answered ${JSON.stringify(reply)}`);
  }
  return reply;
}

const select = (...branches: string[]): Step => ({
  call: 'refresh',
  selection: { branches, showRemoteBranches: true },
});

const everyBranch = (showRemoteBranches: boolean): Step => ({
  call: 'refresh',
  selection: { branches: null, showRemoteBranches },
});

const label = (kind: number, name: string): string => `${String(kind)}:${name}`;

const isRemote = (key: string): boolean =>
  key.startsWith(`${String(RefKind.RemoteBranch)}:`) ||
  key.startsWith(`${String(RefKind.RemoteSymbolicHead)}:`);

const FEATURE = 'refs/heads/feature';
const TOPIC = 'refs/heads/topic';
const ONLY_REMOTE = 'refs/remotes/origin/only-remote';
const EVERY = ['--branches', '--tags', '--remotes', 'HEAD'];
const EVERY_LOCAL = ['--branches', '--tags', 'HEAD'];

test.beforeAll(() => {
  if (!existsSync(join(repositoryRoot, 'dist', 'main.cjs'))) {
    throw new Error('run `npm run build` before the end-to-end gate');
  }
  where = fixture('remotes', 'remotes', 5000);
});

test('each selection reads the histories it names, labelled, and decides the uncommitted row', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const info = test.info();
  const page300 = FIRST_PAGE_COMMITS;
  await withWindow(async (page) => {
    const all = await one(page, everyBranch(true), info, 'every-branch');
    expect(all.names).toEqual(gitLog(EVERY, page300));
    expect(all.labels[label(RefKind.RemoteBranch, 'origin/only-remote')]).toBe(
      all.names.indexOf(gitLog([ONLY_REMOTE], 1)[0] ?? ''),
    );
    expect([all.hasChanges, all.rows]).toEqual([true, page300 + 1]);

    const feature = await one(page, select(FEATURE), info, 'feature');
    expect(feature.names).toEqual(gitLog([FEATURE], page300));
    expect(feature.labels[label(RefKind.RemoteBranch, 'origin/feature')]).toBe(1);
    expect(feature.labels[label(RefKind.LocalHead, 'main')]).toBe(UNKNOWN_INDEX);
    expect([feature.hasChanges, feature.rows]).toEqual([false, page300]);

    const both = await one(page, select(FEATURE, TOPIC), info, 'feature-and-topic');
    expect(both.names).toEqual(gitLog([FEATURE, TOPIC], page300));
    expect(both.hasChanges).toBe(false);

    const remote = await one(page, select(ONLY_REMOTE), info, 'only-remote');
    expect(remote.names).toEqual(gitLog([ONLY_REMOTE], page300));
    expect(remote.labels[label(RefKind.RemoteBranch, 'origin/only-remote')]).toBe(0);

    const local = await one(page, everyBranch(false), info, 'remotes-hidden');
    expect(local.names).toEqual(gitLog(EVERY_LOCAL, page300));
    expect(Object.keys(local.labels).filter(isRemote)).toEqual([]);

    const gone = await one(page, select('refs/heads/gone'), info, 'deleted-branch');
    expect([gone.names, gone.rows, gone.hasMore]).toEqual([[], 0, false]);

    const main = await one(page, select('refs/heads/main'), info, 'main');
    expect(main.names).toEqual(gitLog(['refs/heads/main'], page300));
    expect([main.hasChanges, main.rows]).toEqual([true, page300 + 1]);
  });
});

test('an open without remote branches keeps them hidden through refresh and load more', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const info = test.info();
  await withWindow(async (page) => {
    const opened = await one(page, { call: 'open', path: where, showRemoteBranches: false }, info);
    const again = await one(page, { call: 'refresh' }, info);
    const more = await one(page, { call: 'loadMore', count: FURTHER_PAGE_COMMITS }, info);
    for (const reply of [opened, again]) {
      expect(reply.names).toEqual(gitLog(EVERY_LOCAL, FIRST_PAGE_COMMITS));
    }
    expect(more.names).toEqual(gitLog(EVERY_LOCAL, FIRST_PAGE_COMMITS + FURTHER_PAGE_COMMITS));
    for (const reply of [opened, again, more]) {
      expect(Object.keys(reply.labels).filter(isRemote)).toEqual([]);
    }
  });
});

test('load more and refresh under a selection keep it, and append what a refresh lays out', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const info = test.info();
  const grown = FIRST_PAGE_COMMITS + FURTHER_PAGE_COMMITS;
  await withWindow(async (page) => {
    await one(page, select(FEATURE), info);
    const more = await one(page, { call: 'loadMore', count: FURTHER_PAGE_COMMITS }, info);
    const again = await one(page, { call: 'refresh' }, info, 'feature-grown');
    expect(more.names).toEqual(gitLog([FEATURE], grown));
    expect([more.hasMore, more.hasChanges]).toEqual([true, false]);
    expect(again.names).toEqual(more.names);
    expect(more.layout).toBe(again.layout);
  });
});

test('a selection racing a load more and a refresh ends on the selection asked for last', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const info = test.info();
  const more: Step = { call: 'loadMore', count: FURTHER_PAGE_COMMITS };
  // The whole history, which is what makes the last two orders below catch a
  // Load More applied under a selection it was not read for: asked after the
  // selection, its read is of all 5 008 commits and the selection's of a first
  // page. Measured by E03-M01-S09 on 2026-10-25: its reply came back after the
  // selection had been applied in each of those orders in every run watched —
  // answered Cancelled in two runs, and drawn last, failing this case, in two
  // runs with the drop check of `loadMore` planted out. The first three orders
  // are races whose outcome varies from run to run.
  const everything: Step = { call: 'loadMore', count: WHOLE_HISTORY };
  const orders: readonly (readonly Step[])[] = [
    [more, { call: 'refresh' }, select(FEATURE), more, select(TOPIC)],
    [select(FEATURE), more, select(TOPIC), more],
    [select(TOPIC), { call: 'refresh' }, more],
    [select(TOPIC), everything],
    [select(TOPIC), everything],
  ];
  const histories = [
    gitLog(EVERY, FIRST_PAGE_COMMITS),
    gitLog(EVERY, FIRST_PAGE_COMMITS + FURTHER_PAGE_COMMITS),
    gitLog(EVERY, WHOLE_HISTORY),
    gitLog([FEATURE], FIRST_PAGE_COMMITS),
    gitLog([TOPIC], FIRST_PAGE_COMMITS),
  ].map((names) => names.join());
  await withWindow(async (page) => {
    for (const steps of orders) {
      await one(page, everyBranch(true), info);
      const replies = await page.evaluate(drive, { steps, together: true });
      const drawn = replies.filter((reply) => reply.ok);
      // Every page drawn is one whole history asked for, never a mixture, and the
      // last one drawn is the selection asked for last.
      for (const reply of drawn) {
        expect(histories).toContain(reply.names.join());
      }
      expect(drawn.at(-1)?.names).toEqual(gitLog([TOPIC], FIRST_PAGE_COMMITS));
      const kept = await one(page, { call: 'refresh' }, info);
      expect(kept.names).toEqual(gitLog([TOPIC], FIRST_PAGE_COMMITS));
    }
  });
});

/** How many times the race below is run in one window. */
const RACES = 3;

test('a selection overtaken by a later one is dropped when its reply would arrive last', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const info = test.info();
  // The earlier selection reads a first page of `feature`; the later one names no
  // branch, so the utility process runs no log for it (`selectsAnyRevision` in
  // `src/adapters/git-commands.ts`) and its read ends first. That order is what
  // the drop of an overtaken selection in `select` (`src/app/repository-host.ts`,
  // `open.selectedBy > ticket`) is for: without it the earlier reply is applied
  // and drawn after the later one, and the selection read again is the earlier.
  // Measured by E04-M01-S04 on 2026-11-04 through this pair sent together: the
  // earlier one was answered cancelled and the later one drawn in 50 of 50 rounds,
  // 40 of them with every five-second sample of processor load at 100 %; with that
  // clause removed this case went red in 2 of 2 runs. The slice document has the
  // rest of the readings.
  const earlier = select(FEATURE);
  const later: Step = { call: 'refresh', selection: { branches: [], showRemoteBranches: true } };
  let dropped = 0;
  await withWindow(async (page) => {
    for (let round = 0; round < RACES; round += 1) {
      await one(page, everyBranch(true), info);
      const replies = await page.evaluate(drive, { steps: [earlier, later], together: true });
      const last = replies.filter((reply) => reply.ok).at(-1);
      expect([last?.step, last?.names]).toEqual([1, []]);
      const kept = await one(page, { call: 'refresh' }, info);
      expect(kept.names).toEqual([]);
      dropped += replies.filter(
        (reply) => !reply.ok && reply.step === 0 && reply.kind === FailureKind.Cancelled,
      ).length;
    }
  });
  // At least one round ran the race this case is about, the earlier reply's read
  // ending after the later one was applied, so the case cannot pass on rounds
  // that only ever read in the order they were asked.
  expect(dropped).toBeGreaterThan(0);
});
