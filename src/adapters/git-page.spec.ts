import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FailureKind, HASH_BYTE_LENGTH, RefFlag, RefKind, UNKNOWN_INDEX } from '../contracts/index';
import type { Result } from '../contracts/index';
import type { RepositoryPage } from '../ports/index';

import { ensureFixtures, fixtureAt, gitLines, hexAt, refNameAt } from './fixtures.spec-support';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * A page, read from real repositories, checked against what git says directly.
 *
 * Every test in the module suite chooses its own input, so every one of them can
 * pass against a parser that is quietly wrong about a repository. These do not:
 * the object names, their order and the reference names are compared with what
 * `git log` and `git for-each-ref` print, and the shapes the fixture generator
 * built on purpose — a merge, two roots, an annotated tag, a stash, a detached
 * HEAD, a dirty tree — are each asserted to be what they are.
 */

const reader = createGitRepositoryReader();

/** The whole of a repository as one page, or a thrown failure. */
async function pageOf(repositoryPath: string, pageSize = 100_000): Promise<RepositoryPage> {
  const outcome = await reader.readPage({ repositoryPath, pageSize });
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

/** Every reference of a page, as `kind:name` pointing at a row. */
function referencesOf(page: RepositoryPage): Map<string, number> {
  const found = new Map<string, number>();
  for (let index = 0; index < page.refs.count; index += 1) {
    const name = refNameAt(page.refs.names, page.refs.nameOffsets, index);
    found.set(`${String(page.refs.kind[index])}:${name}`, page.refs.commitIndex[index] ?? -1);
  }
  return found;
}

/** The flags of one reference, by its kind and name. */
function flagsOf(page: RepositoryPage, kind: RefKind, name: string): number {
  for (let index = 0; index < page.refs.count; index += 1) {
    if (
      page.refs.kind[index] === kind &&
      refNameAt(page.refs.names, page.refs.nameOffsets, index) === name
    ) {
      return page.refs.flags[index] ?? 0;
    }
  }
  return -1;
}

/** What git itself says the commits of a repository are, in its own order. */
function gitCommits(repositoryPath: string): string[] {
  return gitLines(repositoryPath, [
    'log',
    '--format=%H',
    '--branches',
    '--tags',
    '--remotes',
    '--ignore-missing',
    'HEAD',
    '--',
  ]);
}

const SHAPES = [
  'linear',
  'branch-and-merge',
  'two-roots',
  'tags',
  'stash',
  'detached-head',
  'dirty-working-tree',
  'large',
];

let empty = '';
let notARepository = '';

beforeAll(() => {
  ensureFixtures();
  empty = mkdtempSync(join(tmpdir(), 'git-graphical-empty-'));
  execFileSync('git', ['-C', empty, 'init', '--quiet']);
  notARepository = mkdtempSync(join(tmpdir(), 'git-graphical-plain-'));
});

afterAll(() => {
  rmSync(empty, { recursive: true, force: true });
  rmSync(notARepository, { recursive: true, force: true });
});

describe('readPage, against every shape the fixtures build', () => {
  for (const shape of SHAPES) {
    it(`reads ${shape} exactly as git reports it`, async () => {
      const where = fixtureAt(shape);
      const page = await pageOf(where);
      expect(hashesOf(page)).toEqual(gitCommits(where));
    });

    it(`reads every reference of ${shape} that git reports`, async () => {
      const where = fixtureAt(shape);
      const page = await pageOf(where);
      const expected = gitLines(where, [
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads',
        'refs/remotes',
        'refs/tags',
      ]).map((refname) => refname.replace(/^refs\/(heads|remotes|tags)\//, ''));
      const found = [...referencesOf(page).keys()]
        .filter((entry) => !entry.startsWith(`${String(RefKind.Stash)}:`))
        .map((entry) => entry.slice(entry.indexOf(':') + 1));
      expect(found.toSorted()).toEqual(expected.toSorted());
    });
  }
});

describe('readPage, on the shapes that carry a decision', () => {
  it('points every reference at the row its commit landed in', async () => {
    const page = await pageOf(fixtureAt('linear'));
    const references = referencesOf(page);
    expect(references.get(`${String(RefKind.LocalHead)}:main`)).toBe(0);
    expect(page.workingTree.headCommitIndex).toBe(0);
  });

  it('reads a merge as a commit with two parents', async () => {
    const page = await pageOf(fixtureAt('branch-and-merge'));
    const widths = Array.from(
      { length: page.commits.count },
      (_, row) =>
        (page.commits.parentOffsets[row + 1] ?? 0) - (page.commits.parentOffsets[row] ?? 0),
    );
    expect(widths[0]).toBe(2);
    expect(widths.at(-1)).toBe(0);
  });

  it('reads two histories joined, with a root commit in each', async () => {
    const page = await pageOf(fixtureAt('two-roots'));
    const roots = Array.from(
      { length: page.commits.count },
      (_, row) =>
        (page.commits.parentOffsets[row + 1] ?? 0) - (page.commits.parentOffsets[row] ?? 0),
    ).filter((width) => width === 0);
    expect(roots.length).toBe(2);
  });

  it('tells an annotated tag from a lightweight one, and points both at commits', async () => {
    const page = await pageOf(fixtureAt('tags'));
    expect(flagsOf(page, RefKind.Tag, 'annotated') & RefFlag.AnnotatedTag).toBe(
      RefFlag.AnnotatedTag,
    );
    expect(flagsOf(page, RefKind.Tag, 'lightweight') & RefFlag.AnnotatedTag).toBe(0);
    const references = referencesOf(page);
    expect(references.get(`${String(RefKind.Tag)}:annotated`)).toBe(0);
    expect(references.get(`${String(RefKind.Tag)}:lightweight`)).toBe(1);
  });

  it('marks the branch that is checked out', async () => {
    const page = await pageOf(fixtureAt('linear'));
    expect(flagsOf(page, RefKind.LocalHead, 'main') & RefFlag.CheckedOut).toBe(RefFlag.CheckedOut);
  });
});

describe('readPage, on the working tree and what HEAD is', () => {
  it('reads a stash as an entry on the commit it sits on', async () => {
    const page = await pageOf(fixtureAt('stash'));
    const references = referencesOf(page);
    expect(references.get(`${String(RefKind.Stash)}:stash@{0}`)).toBe(0);
    const stashed = gitLines(fixtureAt('stash'), ['stash', 'list', '--format=%H']);
    expect(stashed.length).toBe(1);
    expect(hashesOf(page)).not.toContain(stashed[0]);
  });

  it('reads a detached HEAD as detached, and marks what it stands on', async () => {
    const page = await pageOf(fixtureAt('detached-head'));
    expect(page.workingTree.isDetached).toBe(true);
    expect(page.workingTree.headRefName).toBeNull();
    expect(page.workingTree.headCommitIndex).toBe(1);
    expect(flagsOf(page, RefKind.LocalHead, 'main') & RefFlag.DetachedHead).toBe(0);
  });

  it('counts a modified file and an untracked one apart', async () => {
    const page = await pageOf(fixtureAt('dirty-working-tree'));
    expect(page.workingTree.hasChanges).toBe(true);
    expect(page.workingTree.changedFileCount).toBe(1);
    expect(page.workingTree.untrackedFileCount).toBe(1);
    expect(page.workingTree.isDetached).toBe(false);
    expect(page.workingTree.headRefName).toBe('main');
  });

  it('reads a clean tree as clean', async () => {
    const page = await pageOf(fixtureAt('linear'));
    expect(page.workingTree.hasChanges).toBe(false);
    expect(page.workingTree.changedFileCount).toBe(0);
    expect(page.workingTree.untrackedFileCount).toBe(0);
  });

  it('interns the people of a page once each', async () => {
    const page = await pageOf(fixtureAt('large'));
    expect(page.commits.people.names.length).toBe(2);
    expect(page.commits.people.emails.length).toBe(2);
  });
});

describe('readPage, on a page smaller than the history', () => {
  it('says there are more commits, and stores only the page', async () => {
    const page = await pageOf(fixtureAt('large'), 25);
    expect(page.commits.count).toBe(25);
    expect(page.hasMore).toBe(true);
    expect(hashesOf(page)).toEqual(gitCommits(fixtureAt('large')).slice(0, 25));
  });

  it('says there are none when the page reached the root', async () => {
    const page = await pageOf(fixtureAt('linear'), 5);
    expect(page.commits.count).toBe(5);
    expect(page.hasMore).toBe(false);
  });

  it('leaves a parent that is not on the page unknown', async () => {
    const page = await pageOf(fixtureAt('linear'), 2);
    const last = page.commits.count - 1;
    const at = page.commits.parentOffsets[last] ?? 0;
    expect(page.commits.parentIndices[at]).toBe(UNKNOWN_INDEX);
  });
});

describe('readPage, where there is nothing or the wrong thing', () => {
  it('reads a repository with no commits as an empty page on an unborn branch', async () => {
    const page = await pageOf(empty);
    expect(page.commits.count).toBe(0);
    expect(page.refs.count).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.workingTree.headCommitIndex).toBe(UNKNOWN_INDEX);
    expect(page.workingTree.isDetached).toBe(false);
    expect(page.workingTree.headRefName).not.toBeNull();
  });

  it('reports a path that is not a repository as a value, with git’s own words', async () => {
    const outcome: Result<RepositoryPage> = await reader.readPage({
      repositoryPath: notARepository,
      pageSize: 10,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe(FailureKind.NotARepository);
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });

  it('reports a path that does not exist as a value too', async () => {
    const outcome = await reader.readPage({
      repositoryPath: join(tmpdir(), 'git-graphical-standalone-no-such-directory'),
      pageSize: 10,
    });
    expect(outcome.ok).toBe(false);
  });
});

describe('describe', () => {
  it('says which git it found and what version it is', async () => {
    const outcome = await reader.describe();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.version.startsWith('git version ')).toBe(true);
      expect(outcome.value.program.length).toBeGreaterThan(0);
    }
  });
});

describe('parse throughput', () => {
  it('reads the ten thousand commit history, and reports the rate', async () => {
    const started = process.hrtime.bigint();
    const page = await pageOf(fixtureAt('large'));
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    expect(page.commits.count).toBe(10_000);
    process.stdout.write(
      `read ${String(page.commits.count)} commits in ${elapsed.toFixed(1)} ms ` +
        `(${(page.commits.count / (elapsed / 1000)).toFixed(0)} commits per second, ` +
        `end to end, five git processes included)\n`,
    );
  });
});
