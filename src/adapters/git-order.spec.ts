import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { entryAt } from '../contracts/column-read';
import { HASH_BYTE_LENGTH, RowFlag } from '../contracts/index';
import type { BranchSelection } from '../contracts/index';
import { createLayoutState } from '../core/layout/index';
import { addPage, createRowBlock, layoutReading } from '../core/page/index';
import type { RepositoryPage } from '../ports/index';

import { hexAt } from './fixtures.spec-support';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * No commit of a page is listed before any of its children (E04-M01-S14, scope
 * 10), on the case that made one so: a branch tip `main two` and its child
 * `on gone`, on another branch, committed in the same second.
 *
 * The tie is made certain rather than hoped for: both commits are written with
 * the same `GIT_COMMITTER_DATE`. With two tips and equal commit times, git
 * 2.51.0's log of `refs/heads/main refs/heads/gone` with no ordering option
 * listed `main two` first, and the page laid it out as a dot with no line to
 * its child (measured by E04-M01-S14; the slice document has the rows). The page's
 * log is read with `--date-order` (`commitLogArgs` of `./git-commands.ts`).
 */

const reader = createGitRepositoryReader();

let scratch = '';
let where = '';

/** Run git in the scratch repository with every date fixed at `second`. */
function gitAt(second: number, args: readonly string[]): void {
  const stamp = `${String(second)} +0000`;
  execFileSync('git', ['-C', where, '-c', 'commit.gpgsign=false', ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Order',
      GIT_AUTHOR_EMAIL: 'order@fixture.invalid',
      GIT_COMMITTER_NAME: 'Order',
      GIT_COMMITTER_EMAIL: 'order@fixture.invalid',
      GIT_AUTHOR_DATE: stamp,
      GIT_COMMITTER_DATE: stamp,
    },
  });
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'git-graphical-order-'));
  where = join(scratch, 'tie');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', where]);
  gitAt(1_700_000_000, ['commit', '--quiet', '--allow-empty', '-m', 'main one']);
  gitAt(1_700_000_060, ['commit', '--quiet', '--allow-empty', '-m', 'main two']);
  gitAt(1_700_000_060, ['switch', '--quiet', '--create', 'gone']);
  gitAt(1_700_000_060, ['commit', '--quiet', '--allow-empty', '-m', 'on gone']);
  gitAt(1_700_000_060, ['switch', '--quiet', 'main']);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The page read under `selection`, or a thrown failure. */
async function pageUnder(selection?: BranchSelection): Promise<RepositoryPage> {
  const request = { repositoryPath: where, pageSize: 100, ...(selection ? { selection } : {}) };
  const outcome = await reader.readPage(request);
  if (!outcome.ok) {
    throw new Error(`${outcome.kind}: ${outcome.message}`);
  }
  return outcome.value;
}

/** The subject of every row of a reading, in its order. */
function subjectsOf(read: RepositoryPage): string[] {
  const { subjects, subjectOffsets, count } = read.commits;
  return Array.from({ length: count }, (_unused, row) =>
    subjects.slice(entryAt(subjectOffsets, row), entryAt(subjectOffsets, row + 1)),
  );
}

/** Whether every parent of every row of a reading is a row below it, or not loaded. */
function childrenFirst(read: RepositoryPage): boolean {
  const { parentOffsets, parentIndices, count } = read.commits;
  for (let row = 0; row < count; row += 1) {
    for (let at = entryAt(parentOffsets, row); at < entryAt(parentOffsets, row + 1); at += 1) {
      if (entryAt(parentIndices, at) <= row) {
        return false;
      }
    }
  }
  return true;
}

describe('a branch tip and its child committed in the same second', () => {
  it('share one commit time, so the tie is certain', async () => {
    const read = await pageUnder();
    expect(new Set(Array.from(read.commits.commitTime).slice(0, 2))).toEqual(
      new Set([1_700_000_060]),
    );
    expect(hexAt(read.commits.hashes, 0, HASH_BYTE_LENGTH)).toHaveLength(40);
  });

  it('are listed child first under the selection of both branches, and joined', async () => {
    const read = await pageUnder({
      branches: ['refs/heads/main', 'refs/heads/gone'],
      showRemoteBranches: true,
    });
    expect(subjectsOf(read)).toEqual(['on gone', 'main two', 'main one']);
    expect(childrenFirst(read)).toBe(true);
    const block = createRowBlock();
    const page = addPage(block, layoutReading(createLayoutState(), block, read), read);
    expect(entryAt(page.layout.flags, 1) & RowFlag.ClipAboveVertex).toBe(0);
  });

  it('are listed child first on every branch', async () => {
    const read = await pageUnder();
    expect(subjectsOf(read)).toEqual(['on gone', 'main two', 'main one']);
    expect(childrenFirst(read)).toBe(true);
  });
});
