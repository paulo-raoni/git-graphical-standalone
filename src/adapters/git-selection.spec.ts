import { beforeAll, describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, RefKind, UNKNOWN_INDEX } from '../contracts/index';
import type { BranchSelection } from '../contracts/index';
import { COMMIT_LOG_FORMAT, REFERENCE_FORMAT } from '../core/parse/index';
import type { RepositoryPage } from '../ports/index';

import { fixtureAt, gitLines, hexAt, refNameAt } from './fixtures.spec-support';
import { commitLogArgs, referenceArgs } from './git-commands';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * A page read under a branch selection, from the `remotes` fixture, checked
 * against what git says directly.
 *
 * The fixture holds a trunk on `main`, a `feature` and a `topic` branch off its
 * end, `topic` merged into `main`, a remote-tracking `origin/only-remote` that no
 * local branch reaches, `origin/main` and `origin/feature` one commit behind
 * their local branches, `origin/HEAD`, a local `release` inside the trunk, two
 * tags, and `main` checked out over a dirty working tree
 * (`test/fixtures/generate.ts`). Each case below is one case of the reference
 * behaviour recorded in this slice's document: which commits a page holds, which
 * references label them, and whether it carries the working tree.
 */

const reader = createGitRepositoryReader();

let where = '';

beforeAll(() => {
  where = fixtureAt('remotes');
});

/** The whole of what `selection` shows as one page, or a thrown failure. */
async function pageUnder(
  selection: BranchSelection | undefined,
  pageSize = 100_000,
): Promise<RepositoryPage> {
  const outcome = await reader.readPage({
    repositoryPath: where,
    pageSize,
    ...(selection === undefined ? {} : { selection }),
  });
  if (!outcome.ok) {
    throw new Error(`${outcome.kind}: ${outcome.message}`);
  }
  return outcome.value;
}

/** Every object name of a page, in the order the page holds them. */
function hashesOf(page: RepositoryPage): string[] {
  return Array.from({ length: page.commits.count }, (_, row) =>
    hexAt(page.commits.hashes, row, HASH_BYTE_LENGTH),
  );
}

/** Every reference of a page as `kind:name`, with the row it labels. */
function labelsOf(page: RepositoryPage): Map<string, number> {
  const found = new Map<string, number>();
  for (let index = 0; index < page.refs.count; index += 1) {
    const name = refNameAt(page.refs.names, page.refs.nameOffsets, index);
    found.set(`${String(page.refs.kind[index])}:${name}`, page.refs.commitIndex[index] ?? -1);
  }
  return found;
}

/** The kinds of every reference of a page. */
function kindsOf(page: RepositoryPage): Set<number> {
  return new Set(page.refs.kind);
}

/** What git's own log of these revisions is. */
function gitLog(revisions: readonly string[]): string[] {
  return gitLines(where, ['log', '--format=%H', '--date-order', ...revisions, '--']);
}

const local = (name: string): string => `${String(RefKind.LocalHead)}:${name}`;
const remote = (name: string): string => `${String(RefKind.RemoteBranch)}:${name}`;

const shown = (...branches: string[]): BranchSelection => ({ branches, showRemoteBranches: true });

describe('every branch, as the arguments that were run before selections existed', () => {
  // Today's argument lists, written out by hand from the base of this slice
  // (4c7ff80), so that the default changing in any way fails here by name. The
  // one change since is `color.diff=never`, which E03-M01-S11 added to the
  // configuration every invocation carries, and which no format read today
  // answers to (`git-colour.spec.ts`).
  const before = [
    '--no-pager',
    '--no-optional-locks',
    '-C',
    'repository',
    '-c',
    'log.showSignature=false',
    '-c',
    'i18n.logOutputEncoding=UTF-8',
    '-c',
    'color.diff=never',
  ];

  it('runs exactly the log it ran before, with remote-tracking branches shown', () => {
    const log = [
      ...before,
      'log',
      '-z',
      `--format=${COMMIT_LOG_FORMAT}`,
      '--date=raw',
      '--no-use-mailmap',
      '--date-order',
      '--max-count=301',
      '--branches',
      '--tags',
      '--remotes',
      '--ignore-missing',
      'HEAD',
      '--',
    ];
    expect(commitLogArgs('repository', 301)).toEqual(log);
    expect(commitLogArgs('repository', 301, { branches: null, showRemoteBranches: true })).toEqual(
      log,
    );
  });

  it('reads exactly the references it read before, with remote-tracking branches shown', () => {
    const refs = [...before, 'for-each-ref', `--format=${REFERENCE_FORMAT}`];
    expect(referenceArgs('repository')).toEqual([
      ...refs,
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
    expect(referenceArgs('repository', true)).toEqual(referenceArgs('repository'));
    expect(referenceArgs('repository', false)).toEqual([...refs, 'refs/heads', 'refs/tags']);
  });
});

describe('the log of a page with stashes', () => {
  it('adds the commits the stashes were made on as tips on every branch, and under no selection', () => {
    const bases = ['ab'.repeat(HASH_BYTE_LENGTH), 'cd'.repeat(HASH_BYTE_LENGTH)];
    const every = commitLogArgs('repository', 301, undefined, bases);
    expect(every.slice(-4)).toEqual(['HEAD', ...bases, '--']);
    const local = commitLogArgs(
      'repository',
      301,
      { branches: null, showRemoteBranches: false },
      bases,
    );
    expect(local.slice(-7)).toEqual([
      '--branches',
      '--tags',
      '--ignore-missing',
      'HEAD',
      ...bases,
      '--',
    ]);
    const selected = commitLogArgs('repository', 301, shown('refs/heads/main'), bases);
    expect(selected.slice(-3)).toEqual(['--ignore-missing', 'refs/heads/main', '--']);
  });
});

describe('every branch, as a page', () => {
  it('shows every commit, remote-only ones included, and every label', async () => {
    const page = await pageUnder({ branches: null, showRemoteBranches: true });
    expect(hashesOf(page)).toEqual(gitLog(['--branches', '--tags', '--remotes', 'HEAD']));
    expect(hashesOf(page)).toEqual(hashesOf(await pageUnder(undefined)));
    expect(hashesOf(page)).toContain(gitLog(['refs/remotes/origin/only-remote'])[0]);
    expect(labelsOf(page).get(remote('origin/only-remote'))).toBe(
      hashesOf(page).indexOf(gitLog(['refs/remotes/origin/only-remote'])[0] ?? ''),
    );
    expect(kindsOf(page).has(RefKind.RemoteSymbolicHead)).toBe(true);
  });

  it('carries the working tree as it is', async () => {
    const page = await pageUnder(undefined);
    expect(page.workingTree.hasChanges).toBe(true);
    expect(page.workingTree.changedFileCount).toBe(1);
    expect(page.workingTree.untrackedFileCount).toBe(1);
    expect(page.workingTree.headCommitIndex).toBe(0);
  });
});

describe('one local branch selected', () => {
  it('shows that branch’s history and nothing else', async () => {
    const page = await pageUnder(shown('refs/heads/feature'));
    expect(hashesOf(page)).toEqual(gitLog(['refs/heads/feature']));
    expect(hashesOf(page)).not.toContain(gitLog(['refs/heads/main'])[0]);
    expect(hashesOf(page)).not.toContain(gitLog(['refs/remotes/origin/only-remote'])[0]);
  });

  it('still labels a shown commit with the branches that were not selected', async () => {
    const labels = labelsOf(await pageUnder(shown('refs/heads/feature')));
    expect(labels.get(local('feature'))).toBe(0);
    expect(labels.get(remote('origin/feature'))).toBe(1);
    expect(labels.get(local('release'))).not.toBe(UNKNOWN_INDEX);
    expect(labels.get(`${String(RefKind.Tag)}:light`)).not.toBe(UNKNOWN_INDEX);
    expect(labels.get(local('main'))).toBe(UNKNOWN_INDEX);
    expect(labels.get(local('topic'))).toBe(UNKNOWN_INDEX);
  });

  it('withholds the working tree when HEAD’s commit is not in that history', async () => {
    const page = await pageUnder(shown('refs/heads/feature'));
    expect(page.workingTree).toEqual({
      hasChanges: false,
      changedFileCount: 0,
      untrackedFileCount: 0,
      headCommitIndex: UNKNOWN_INDEX,
      headRefName: 'main',
      isDetached: false,
    });
  });

  it('carries the working tree when the checked-out branch is the one selected', async () => {
    const page = await pageUnder(shown('refs/heads/main'));
    expect(hashesOf(page)).toEqual(gitLog(['refs/heads/main']));
    expect(page.workingTree.hasChanges).toBe(true);
    expect(page.workingTree.headCommitIndex).toBe(0);
  });

  it('reads a page smaller than the history from that history alone', async () => {
    const page = await pageUnder(shown('refs/heads/feature'), 25);
    expect(page.commits.count).toBe(25);
    expect(page.hasMore).toBe(true);
    expect(hashesOf(page)).toEqual(gitLog(['refs/heads/feature']).slice(0, 25));
  });
});

describe('two branches, and a remote-only branch, selected', () => {
  it('shows the union of two histories', async () => {
    const page = await pageUnder(shown('refs/heads/feature', 'refs/heads/topic'));
    expect(hashesOf(page)).toEqual(gitLog(['refs/heads/feature', 'refs/heads/topic']));
    expect(hashesOf(page)).not.toContain(gitLog(['refs/heads/main'])[0]);
    expect(page.workingTree.hasChanges).toBe(false);
  });

  it('selects a remote-tracking branch no local branch has, like a local one', async () => {
    const page = await pageUnder(shown('refs/remotes/origin/only-remote'));
    expect(hashesOf(page)).toEqual(gitLog(['refs/remotes/origin/only-remote']));
    expect(labelsOf(page).get(remote('origin/only-remote'))).toBe(0);
    expect(labelsOf(page).get(local('feature'))).toBe(UNKNOWN_INDEX);
  });
});

describe('remote-tracking branches hidden', () => {
  it('reads no commit only they reach, and labels nothing with them', async () => {
    const page = await pageUnder({ branches: null, showRemoteBranches: false });
    expect(hashesOf(page)).toEqual(gitLog(['--branches', '--tags', 'HEAD']));
    expect(hashesOf(page)).not.toContain(gitLog(['refs/remotes/origin/only-remote'])[0]);
    expect(kindsOf(page).has(RefKind.RemoteBranch)).toBe(false);
    expect(kindsOf(page).has(RefKind.RemoteSymbolicHead)).toBe(false);
    expect(labelsOf(page).get(local('release'))).not.toBe(UNKNOWN_INDEX);
    expect(labelsOf(page).get(`${String(RefKind.Tag)}:annotated`)).not.toBe(UNKNOWN_INDEX);
    expect(page.workingTree.hasChanges).toBe(true);
  });

  it('reads no remote-tracking branch even when one is selected', async () => {
    const page = await pageUnder({
      branches: ['refs/heads/feature', 'refs/remotes/origin/only-remote'],
      showRemoteBranches: false,
    });
    expect(hashesOf(page)).toEqual(gitLog(['refs/heads/feature']));
    expect(kindsOf(page).has(RefKind.RemoteBranch)).toBe(false);
  });
});

describe('names that git does not resolve, or that are not branches', () => {
  it('skips a branch deleted since it was chosen and reads the rest', async () => {
    const page = await pageUnder(shown('refs/heads/gone', 'refs/heads/topic'));
    expect(hashesOf(page)).toEqual(gitLog(['refs/heads/topic']));
  });

  it('reads nothing, without failing, when every name selected is gone', async () => {
    const page = await pageUnder(shown('refs/heads/gone'));
    expect(page.commits.count).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.workingTree.hasChanges).toBe(false);
    expect(labelsOf(page).get(local('main'))).toBe(UNKNOWN_INDEX);
  });

  it('reads nothing for a selection naming no branch, rather than HEAD’s history', async () => {
    for (const names of [[], ['refs/tags/light', 'HEAD', 'main', '--all']]) {
      const page = await pageUnder(shown(...names));
      expect(page.commits.count).toBe(0);
      expect(page.workingTree.hasChanges).toBe(false);
    }
  });
});
