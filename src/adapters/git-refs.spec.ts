import { beforeAll, describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, RefFlag, RefKind, UNKNOWN_INDEX } from '../contracts/index';
import type { BranchSelection } from '../contracts/index';
import { FIRST_PAGE_COMMITS } from '../core/page/index';
import type { RepositoryPage } from '../ports/index';

import { gitLines, hexAt, refNameAt } from './fixtures.spec-support';
import { createGitRepositoryReader } from './git-repository-reader';
import {
  MANY_LOCAL_BRANCHES,
  MANY_REFS_COMMITS,
  MANY_REMOTE_BRANCHES,
  MANY_TAGS,
  referenceFixtureAt,
} from './reference-fixtures.spec-support';

/**
 * The references of a repository that has very many of them, and of one that
 * `git svn` wrote, read through the reader and checked against git.
 *
 * `many-refs` holds {@link MANY_LOCAL_BRANCHES} local branches besides `main`,
 * {@link MANY_REMOTE_BRANCHES} remote-tracking branches and {@link MANY_TAGS}
 * tags, half of them annotated, over a trunk of {@link MANY_REFS_COMMITS}
 * commits. `svn-remotes` holds `refs/remotes/trunk`, `refs/remotes/tags/v1` and
 * `refs/remotes/svn/trunk`, which name no remote, beside
 * `refs/remotes/origin/main` (`./reference-fixtures.spec-support.ts`).
 */

const reader = createGitRepositoryReader();

let many = '';
let svn = '';

beforeAll(() => {
  many = referenceFixtureAt('many-refs');
  svn = referenceFixtureAt('svn-remotes');
});

/** A page of `repositoryPath`, or a thrown failure. */
async function pageOf(
  repositoryPath: string,
  pageSize: number,
  selection?: BranchSelection,
): Promise<RepositoryPage> {
  const outcome = await reader.readPage({
    repositoryPath,
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

/** How many references of `kind` a page holds. */
function countOf(page: RepositoryPage, kind: RefKind): number {
  return page.refs.kind.filter((each) => each === kind).length;
}

/**
 * What git says each reference is: `kind:name` and the commit it labels, a tag
 * dereferenced to its commit.
 */
function gitReferences(repositoryPath: string): Map<string, string> {
  const kinds: Record<string, RefKind> = {
    heads: RefKind.LocalHead,
    remotes: RefKind.RemoteBranch,
    tags: RefKind.Tag,
  };
  const found = new Map<string, string>();
  for (const line of gitLines(repositoryPath, [
    'for-each-ref',
    '--format=%(refname) %(objectname) %(*objectname)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ])) {
    const [refname = '', object = '', peeled = ''] = line.split(' ');
    const [, namespace = '', ...rest] = refname.split('/');
    found.set(`${String(kinds[namespace])}:${rest.join('/')}`, peeled === '' ? object : peeled);
  }
  return found;
}

describe('a repository with over a thousand branches and five hundred tags', () => {
  it('lists every reference on a first page, by kind', async () => {
    const page = await pageOf(many, FIRST_PAGE_COMMITS);
    expect(countOf(page, RefKind.LocalHead)).toBe(MANY_LOCAL_BRANCHES + 1);
    expect(countOf(page, RefKind.RemoteBranch)).toBe(MANY_REMOTE_BRANCHES);
    expect(countOf(page, RefKind.Tag)).toBe(MANY_TAGS);
    expect(countOf(page, RefKind.RemoteSymbolicHead)).toBe(0);
    const annotated = Array.from(page.refs.flags).filter(
      (flags) => (flags & RefFlag.AnnotatedTag) !== 0,
    );
    expect(annotated.length).toBe(MANY_TAGS / 2);
    expect(page.refs.count).toBe(MANY_LOCAL_BRANCHES + 1 + MANY_REMOTE_BRANCHES + MANY_TAGS);
  });

  it('points each reference at its commit’s row, or at none past the first page', async () => {
    const page = await pageOf(many, FIRST_PAGE_COMMITS);
    const rows = new Map(hashesOf(page).map((hash, row) => [hash, row]));
    const expected = new Map(
      [...gitReferences(many)].map(([label, commit]) => [label, rows.get(commit) ?? UNKNOWN_INDEX]),
    );
    const labels = labelsOf(page);
    expect(labels).toEqual(expected);
    const onPage = [...labels.values()].filter((row) => row !== UNKNOWN_INDEX).length;
    expect(onPage).toBeGreaterThan(0);
    expect(onPage).toBeLessThan(page.refs.count);
  });

  it('reads the same first page of commits git does', async () => {
    const page = await pageOf(many, FIRST_PAGE_COMMITS);
    const log = gitLines(many, ['log', '--format=%H', '--branches', '--tags', '--remotes', 'HEAD']);
    expect(hashesOf(page)).toEqual(log.slice(0, FIRST_PAGE_COMMITS));
    expect(page.hasMore).toBe(true);
  });

  it('lands every reference on a row once the whole history is read', async () => {
    const page = await pageOf(many, 100_000);
    expect(page.commits.count).toBe(MANY_REFS_COMMITS);
    expect(Array.from(page.refs.commitIndex).every((row) => row !== UNKNOWN_INDEX)).toBe(true);
  });
});

describe('the remote branches git svn writes', () => {
  const remote = (name: string): string => `${String(RefKind.RemoteBranch)}:${name}`;

  it('reads each as a remote branch, named as git branch -r names it', async () => {
    const page = await pageOf(svn, 100);
    const names = gitLines(svn, ['branch', '-r', '--format=%(refname:lstrip=2)']);
    expect(names.toSorted()).toEqual(['origin/main', 'svn/trunk', 'tags/v1', 'trunk']);
    const remotes = [...labelsOf(page).keys()].filter((label) =>
      label.startsWith(`${String(RefKind.RemoteBranch)}:`),
    );
    expect(remotes.toSorted()).toEqual(names.map(remote).toSorted());
    expect(countOf(page, RefKind.Tag)).toBe(0);
    expect(countOf(page, RefKind.RemoteSymbolicHead)).toBe(0);
  });

  it('labels the commit each one names, including one only trunk reaches', async () => {
    const page = await pageOf(svn, 100);
    const rows = new Map(hashesOf(page).map((hash, row) => [hash, row]));
    const labels = labelsOf(page);
    for (const name of ['trunk', 'tags/v1', 'svn/trunk', 'origin/main']) {
      const [commit = ''] = gitLines(svn, ['rev-parse', `refs/remotes/${name}`]);
      expect(labels.get(remote(name)), name).toBe(rows.get(commit));
    }
    const [trunkOnly = ''] = gitLines(svn, ['rev-parse', 'refs/remotes/trunk']);
    expect(gitLines(svn, ['branch', '--contains', trunkOnly])).toEqual([]);
    expect(hashesOf(page)).toContain(trunkOnly);
  });

  it('selects one like any remote branch, by its full name', async () => {
    for (const name of ['refs/remotes/trunk', 'refs/remotes/tags/v1']) {
      const page = await pageOf(svn, 100, { branches: [name], showRemoteBranches: true });
      expect(hashesOf(page)).toEqual(gitLines(svn, ['log', '--format=%H', name, '--']));
    }
  });

  it('hides every one, and the commit only trunk reaches, with remote branches', async () => {
    const page = await pageOf(svn, 100, { branches: null, showRemoteBranches: false });
    const [trunkOnly = ''] = gitLines(svn, ['rev-parse', 'refs/remotes/trunk']);
    expect(countOf(page, RefKind.RemoteBranch)).toBe(0);
    expect(hashesOf(page)).not.toContain(trunkOnly);
    expect(hashesOf(page)).toEqual(gitLines(svn, ['log', '--format=%H', '--branches', 'HEAD']));
  });
});
