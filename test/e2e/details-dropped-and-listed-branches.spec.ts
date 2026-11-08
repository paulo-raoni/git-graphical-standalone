import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { FailureKind } from '../../src/contracts/index';
import type {
  BranchSelection,
  DetailsResponse,
  GitGraphicalBridge,
  GraphPage,
} from '../../src/contracts/index';
import { withOwnProfile } from './support/fixtures';

/**
 * Two replies of the utility process that no other suite drives
 * (`src/app/repository-host.ts`): the details of a commit read while another
 * repository was opened, and a page read under a selection naming a branch that
 * has since been deleted.
 *
 * **Its own file**, because `commit-details.spec.ts` could not hold both cases
 * under the line limit the lint gate holds every module to. Each case builds the
 * repositories it opens in a directory of its own and removes it after; nothing
 * shared is written.
 *
 * **The details case makes its timing certain.** The repository opened first
 * includes, by `include.path`, a named pipe this process serves, and git opens it
 * at the start of every command it runs there. While the case holds the pipe, a
 * git that opened it waits for it, so the details read is held inside git
 * until the case lets it go — and it lets it go only after the open of the second
 * repository has answered. So the details reply is decided after that open was
 * applied, in every run. Git 2.51.0 on Windows waited 1 650 ms on a pipe held
 * for 1 500 ms, and read through in 161 ms with the pipe answering at once
 * (E04-M01-S16, on a scratch repository).
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SLOW_TEST_MS = 240_000;

/** The directories this run made, removed after every case. */
const made: string[] = [];

/** Run git in `where`, as a fixture's author, and say what it printed. */
function git(where: string, args: readonly string[]): string {
  const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@fixture.invalid'];
  return execFileSync('git', ['-C', where, ...identity, '-c', 'commit.gpgSign=false', ...args], {
    encoding: 'utf8',
  }).trim();
}

/** A new repository on `main` with one commit per subject, in a directory of this run's own. */
function repositoryWith(subjects: readonly string[]): string {
  const where = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-s16-'));
  made.push(where);
  git(where, ['init', '--quiet', '--initial-branch=main']);
  for (const subject of subjects) {
    writeFileSync(join(where, 'file.txt'), `${subject}\n`);
    git(where, ['add', '--', 'file.txt']);
    git(where, ['commit', '--quiet', '-m', subject]);
  }
  return where;
}

/** A named pipe that answers every opening at once, or holds every opening until released. */
interface HeldPipe {
  readonly name: string;
  hold(): void;
  release(): void;
  waiting(): number;
  close(): Promise<void>;
}

/** Serve a named pipe of this process's own; see the file comment for what it is for. */
async function servePipe(): Promise<HeldPipe> {
  const backslash = String.fromCharCode(92);
  const name = `${backslash}${backslash}.${backslash}pipe${backslash}gg-s16-${String(process.pid)}`;
  const held: Socket[] = [];
  let holding = false;
  const server: Server = createServer((socket) => {
    if (holding) {
      held.push(socket);
    } else {
      socket.end();
    }
  });
  await new Promise<void>((done) => server.listen(name, done));
  return {
    name,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      for (const socket of held.splice(0)) {
        socket.end();
      }
    },
    waiting: () => held.length,
    close: () =>
      new Promise<void>((done) =>
        server.close(() => {
          done();
        }),
      ),
  };
}

/* --- What runs inside the page. --- */

interface PageScope {
  readonly gitGraphical: GitGraphicalBridge;
  heldDetails?: { settled: boolean; reply?: DetailsResponse };
}

/** Ask for a commit's details and keep the reply on the page's global, without waiting for it. */
function askForDetails(hash: string): void {
  const scope = globalThis as unknown as PageScope;
  const kept: { settled: boolean; reply?: DetailsResponse } = { settled: false };
  scope.heldDetails = kept;
  void scope.gitGraphical.commitDetails({ target: { kind: 'commit', hash } }).then((reply) => {
    kept.settled = true;
    kept.reply = reply;
  });
}

function detailsSettled(): boolean {
  return (globalThis as unknown as PageScope).heldDetails?.settled ?? false;
}

function detailsReply(): DetailsResponse | null {
  return (globalThis as unknown as PageScope).heldDetails?.reply ?? null;
}

/** One request that answers a page, and the object names of the page it answered. */
async function pageOf(input: {
  open?: string;
  selection?: BranchSelection;
}): Promise<string[] | string> {
  const bridge = (globalThis as unknown as PageScope).gitGraphical;
  let reply: Awaited<ReturnType<GitGraphicalBridge['refresh']>>;
  if (input.open !== undefined) {
    reply = await bridge.openRepository({ path: input.open });
  } else {
    reply = await bridge.refresh(
      input.selection === undefined ? {} : { selection: input.selection },
    );
  }
  if (!reply.ok) {
    return reply.kind;
  }
  const page: GraphPage = reply.value;
  const hex = Array.from(page.commits.hashes, (byte) => byte.toString(16).padStart(2, '0'));
  return Array.from({ length: page.commits.count }, (_, row) =>
    hex.slice(row * 20, row * 20 + 20).join(''),
  );
}

/* --- Driving the built application. --- */

/** Launch on `repository`, wait for its first row, and run `body` against the window. */
async function withWindow(repository: string, body: (page: Page) => Promise<void>): Promise<void> {
  await withOwnProfile({ open: repository }, async (application) => {
    const page = await application.firstWindow();
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await body(page);
  });
}

test.beforeAll(() => {
  if (!existsSync(join(repositoryRoot, 'dist', 'main.cjs'))) {
    throw new Error('run `npm run build` before the end-to-end gate');
  }
});

test.afterEach(() => {
  for (const where of made.splice(0)) {
    rmSync(where, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('a details reply read while another repository was opened reaches the window as dropped', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const pipe = await servePipe();
  try {
    const first = repositoryWith(['first one', 'first two']);
    const head = git(first, ['rev-parse', 'HEAD']);
    const second = repositoryWith(['second one']);
    const secondHead = git(second, ['rev-parse', 'HEAD']);
    // The last git this process runs in `first`: from here every git there opens the pipe, which
    // this process serves, so a synchronous git of its own there would wait on itself for ever.
    git(first, ['config', 'include.path', pipe.name]);
    await withWindow(first, async (page) => {
      pipe.hold();
      await page.evaluate(askForDetails, head);
      // The details' git has opened the pipe and waits on it, and has answered nothing.
      await expect.poll(() => pipe.waiting()).toBeGreaterThan(0);
      expect(await page.evaluate(detailsSettled)).toBe(false);
      expect(await page.evaluate(pageOf, { open: second })).toEqual([secondHead]);
      expect(await page.evaluate(detailsSettled)).toBe(false);
      pipe.release();
      await expect.poll(() => page.evaluate(detailsSettled)).toBe(true);
      expect(await page.evaluate(detailsReply)).toEqual({
        ok: false,
        kind: FailureKind.Cancelled,
        message:
          'Another repository was opened while these details were being read, so this reply was dropped.',
      });
    });
  } finally {
    pipe.release();
    await pipe.close();
  }
});

test('a selected branch deleted since is not read as a tag of the same spelling', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const where = repositoryWith(['main one', 'main two']);
  const mainHistory = git(where, ['rev-list', 'main']).split('\n');
  git(where, ['switch', '--quiet', '-c', 'gone']);
  git(where, ['commit', '--quiet', '--allow-empty', '-m', 'on gone']);
  const onGone = git(where, ['rev-parse', 'HEAD']);
  git(where, ['switch', '--quiet', 'main']);
  // A commit only the tag reaches, and the tag whose own name is `refs/heads/gone`.
  const tagOnly = git(where, ['commit-tree', '-m', 'tag only', 'main^{tree}']);
  git(where, ['update-ref', 'refs/tags/refs/heads/gone', tagOnly]);
  const selection: BranchSelection = {
    branches: ['refs/heads/main', 'refs/heads/gone'],
    showRemoteBranches: true,
  };
  await withWindow(where, async (page) => {
    expect(await page.evaluate(pageOf, { selection })).toEqual([onGone, ...mainHistory]);
    git(where, ['branch', '--quiet', '-D', 'gone']);
    // Git given the same names reads the tag's commit in the deleted branch's place.
    const given = git(where, [
      'rev-list',
      '--ignore-missing',
      'refs/heads/main',
      'refs/heads/gone',
    ]);
    expect(given.split('\n')).toContain(tagOnly);
    // The page, refreshed under the selection kept, and asked for it again, does not.
    expect(await page.evaluate(pageOf, {})).toEqual(mainHistory);
    expect(await page.evaluate(pageOf, { selection })).toEqual(mainHistory);
  });
});
