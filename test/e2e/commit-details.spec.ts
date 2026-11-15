import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { FailureKind } from '../../src/contracts/index';
import type { ChangedFile, DetailsResponse, GitGraphicalBridge } from '../../src/contracts/index';
import { fixture } from './support/fixtures';

/**
 * The details of a commit and of the uncommitted changes, asked for from the
 * page over the real bridge of the built application, and read back.
 *
 * The repository is the `details` fixture (`test/fixtures/generate.ts`): a
 * commit by two people whose body holds a line indented by four spaces, one
 * indented by a tab and a blank line, whose changes are a rename, a deletion,
 * additions, a binary file and the names `naïve café 日本.txt`, `quote"mark.txt`,
 * `question?.txt` and `hash#percent%.txt`; a merge whose second parent added
 * `side.txt`; and a working tree with an unstaged modification, a staged
 * addition and an untracked file. What the replies hold is compared with
 * literals, and the commits' object names with what `git rev-parse` prints.
 *
 * Every launch has a user-data directory of its own (`--user-data-dir`), made
 * for it and removed after it, so no case reads or writes the default profile.
 *
 * The second case prints how long a request takes, on this fixture and on the
 * ten-thousand-commit one, and holds nothing about it: a time is not a verdict
 * this gate gives (`playwright.config.js`, *the tag*), and the budget of a
 * request belongs to the slice that draws it.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Long enough for the ten-thousand-commit fixture to be written and read. */
const SLOW_TEST_MS = 240_000;

/** The user-data directories made by this run, removed after every case. */
const homes: string[] = [];

/** The applications launched and not yet closed, closed after every case whatever ended it. */
const running = new Set<ElectronApplication>();

/** Close `application`, and fail if its process outlived the close. */
async function close(application: ElectronApplication): Promise<void> {
  running.delete(application);
  const child = application.process();
  await application.close();
  expect(child.exitCode === null && !child.killed).toBe(false);
}

/** What runs inside the page: one request over the bridge, and how long its reply took. */
async function ask(target: unknown): Promise<{ reply: DetailsResponse; milliseconds: number }> {
  const scope = globalThis as unknown as {
    readonly gitGraphical: GitGraphicalBridge;
    readonly performance: { readonly now: () => number };
  };
  const started = scope.performance.now();
  const reply = await scope.gitGraphical.commitDetails({ target } as Parameters<
    GitGraphicalBridge['commitDetails']
  >[0]);
  return { reply, milliseconds: scope.performance.now() - started };
}

/** Launch on `repository` with a user-data directory of its own, run `body` once a row is drawn, and close. */
async function withWindow(repository: string, body: (page: Page) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-details-'));
  homes.push(home);
  const application = await electron.launch({
    args: ['.', repository, `--user-data-dir=${home}`],
    cwd: repositoryRoot,
  });
  running.add(application);
  try {
    const page = await application.firstWindow();
    // Not the 10 s `expect` limit: no verdict here is a time, and at 100 % sampled load the first
    // row of this fixture once took longer than that to be drawn (E04-M01-S06, 2026-11-04).
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await body(page);
  } finally {
    await close(application);
  }
}

/** The full object names `revisions` resolve to in `repository`. */
function hashesOf(repository: string, revisions: readonly string[]): string[] {
  return execFileSync('git', ['-C', repository, 'rev-parse', ...revisions], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const file = (
  path: string,
  status: ChangedFile['status'],
  additions: number | null,
  deletions: number | null,
  oldPath: string | null = null,
): ChangedFile => ({ path, oldPath, status, additions, deletions });

test.beforeAll(() => {
  expect(existsSync(join(repositoryRoot, 'dist', 'main.cjs')), 'run `npm run build` first').toBe(
    true,
  );
});

test.afterEach(async () => {
  for (const application of [...running]) {
    await close(application);
  }
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

/** What `main~3`'s details are, given its object name and its parent's. */
function twoPeopleDetails(hash: string, parent: string): DetailsResponse {
  return {
    ok: true,
    value: {
      hash,
      parents: [parent],
      author: {
        name: 'Détails Author',
        email: 'details-author@fixture.invalid',
        time: 1_700_000_060 - 86_400,
        offsetMinutes: 90,
      },
      committer: {
        name: 'Details Committer',
        email: 'details-committer@fixture.invalid',
        time: 1_700_000_060,
        offsetMinutes: -420,
      },
      message:
        'rename, delete, add and modify, by two people\n\n    a line indented by four spaces\n' +
        '\ta line indented by a tab\n\nafter a blank line\n',
      files: [
        file('added.txt', 'added', 1, 0),
        file('binary.dat', 'modified', null, null),
        file('deep/er/still/leaf.txt', 'modified', 1, 0),
        file('delete-me.txt', 'deleted', 0, 1),
        file('hash#percent%.txt', 'added', 1, 0),
        file('naïve café 日本.txt', 'added', 1, 0),
        file('question?.txt', 'added', 1, 0),
        file('quote"mark.txt', 'added', 1, 0),
        file('renamed.txt', 'renamed', 1, 1, 'rename-me.txt'),
      ],
    },
  };
}

/** What the uncommitted changes' details are. */
const UNCOMMITTED: DetailsResponse = {
  ok: true,
  value: {
    files: [
      file('deep/er/still/leaf.txt', 'modified', 1, 0),
      file('staged ✓ #%.txt', 'added', 1, 0),
      file('untracked ünï.txt', 'untracked', null, null),
    ],
  },
};

test('the page reads a commit’s details and the uncommitted changes’ over the bridge', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const repository = fixture('details', 'script', 6);
  const revisions = ['main~3', 'main~4', 'main', 'main^1', 'main^2'];
  const [twoPeople = '', root = '', merge = '', first = '', second = ''] = hashesOf(
    repository,
    revisions,
  );
  await withWindow(repository, async (page) => {
    const asked = (await page.evaluate(ask, { kind: 'commit', hash: twoPeople })).reply;
    expect(asked).toEqual(twoPeopleDetails(twoPeople, root));
    const merged = (await page.evaluate(ask, { kind: 'commit', hash: merge })).reply;
    expect(merged.ok && 'parents' in merged.value ? merged.value.parents : null).toEqual([
      first,
      second,
    ]);
    expect(merged.ok ? merged.value.files : null).toEqual([file('side.txt', 'added', 1, 0)]);
    expect((await page.evaluate(ask, { kind: 'uncommitted' })).reply).toEqual(UNCOMMITTED);
  });
});

test('the page is answered with a failure for what is not a commit of the repository', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const repository = fixture('details', 'script', 6);
  const [tree = ''] = hashesOf(repository, ['main^{tree}']);
  await withWindow(repository, async (page) => {
    expect((await page.evaluate(ask, { kind: 'commit', hash: tree })).reply).toEqual({
      ok: false,
      kind: FailureKind.GitFailed,
      message: `${tree} is not a commit of this repository.`,
    });
    for (const target of [{ kind: 'commit', hash: 'HEAD' }, { kind: 'commit' }, null]) {
      const refused = (await page.evaluate(ask, target)).reply;
      expect(refused.ok ? null : refused.kind, JSON.stringify(target)).toBe(FailureKind.GitFailed);
    }
  });
});

test('how long a request takes, printed and not held', async () => {
  test.setTimeout(SLOW_TEST_MS);
  for (const [name, repository] of [
    ['details', fixture('details', 'script', 6)],
    ['large', fixture('large', 'large', 10_000)],
  ] as const) {
    const [head = ''] = hashesOf(repository, ['HEAD']);
    await withWindow(repository, async (page) => {
      const times: Record<string, number[]> = { commit: [], uncommitted: [] };
      for (let round = 0; round < 5; round += 1) {
        const commit = await page.evaluate(ask, { kind: 'commit', hash: head });
        const uncommitted = await page.evaluate(ask, { kind: 'uncommitted' });
        expect(commit.reply.ok && uncommitted.reply.ok).toBe(true);
        times['commit']?.push(Math.round(commit.milliseconds));
        times['uncommitted']?.push(Math.round(uncommitted.milliseconds));
      }
      process.stdout.write(
        `  ${name}: HEAD's details ${(times['commit'] ?? []).join(', ')} ms; ` +
          `the uncommitted changes' ${(times['uncommitted'] ?? []).join(', ')} ms\n`,
      );
    });
  }
});
