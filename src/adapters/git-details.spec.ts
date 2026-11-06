import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FailureKind } from '../contracts/index';
import type {
  ChangedFile,
  CommitDetails,
  DetailsTarget,
  Result,
  UncommittedDetails,
} from '../contracts/index';

import { fixtureAt, gitLines, gitSays } from './fixtures.spec-support';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * The details of a commit and of the uncommitted changes, read through the
 * adapter from the `details` fixture (`test/fixtures/generate.ts`), and each
 * asserted whole: every field, every file in git's order, and the number of git
 * processes the request started.
 *
 * The fixture's history is `main~4`, a root commit; `main~3`, the commit by two
 * people with an indented body, a rename, a deletion, additions, a binary file
 * and the names `naïve café 日本.txt`, `quote"mark.txt`, `question?.txt` and
 * `hash#percent%.txt`; `main~2`, which deletes the two names Windows refuses;
 * `main^1`, on `main`; `main^2`, on `side`; and `main`, their merge, which
 * brings `side.txt`. Its working tree holds an unstaged modification, a staged
 * addition and an untracked file.
 *
 * **The git processes are counted by git**, as `test/e2e/budgets-git.spec.ts`
 * counts them: `GIT_TRACE2_EVENT`, set to a file for the length of one request,
 * makes every git process append a `start` event to it, and the adapter passes
 * this process's environment on to git (`readingEnvironment` of
 * `./git-process.ts`). The reader has found its git before the first count, so
 * discovery is in none of them.
 */

const reader = createGitRepositoryReader();

let where = '';
let scratch = '';
let unborn = '';

/** The fixture's commits, by the revision that names each. */
const hashes = new Map<string, string>();

const REVISIONS = ['main~4', 'main~3', 'main~2', 'main^1', 'main^2', 'main'];

beforeAll(async () => {
  where = fixtureAt('details');
  const named = gitLines(where, ['rev-parse', ...REVISIONS]);
  REVISIONS.forEach((revision, at) => hashes.set(revision, named[at] ?? ''));
  scratch = mkdtempSync(join(tmpdir(), 'git-graphical-details-'));
  unborn = join(scratch, 'unborn');
  execFileSync('git', ['init', '--quiet', unborn]);
  writeFileSync(join(unborn, 'staged.txt'), 'staged\n');
  execFileSync('git', ['-C', unborn, 'add', '--', 'staged.txt']);
  writeFileSync(join(unborn, 'staged.txt'), 'staged\nand changed after\n');
  writeFileSync(join(unborn, 'loose.txt'), 'never added\n');
  const found = await reader.describe();
  expect(found.ok).toBe(true);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const hashOf = (revision: string): string => hashes.get(revision) ?? '';

/** Run `work` with `variables` set in this process's environment, and restore it whatever happens. */
async function under<T>(variables: Record<string, string>, work: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(variables)) {
    saved.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    return await work();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  }
}

/** One request's reply, and the git commands it started, in order. */
interface Counted {
  readonly reply: Result<CommitDetails | UncommittedDetails>;
  readonly started: readonly string[];
}

/** The git command of one trace `start` event's argument list: the first word that is not an option. */
function commandOf(argv: readonly string[]): string {
  for (let at = 1; at < argv.length; at += 1) {
    const word = argv[at] ?? '';
    if (word === '-C' || word === '-c') {
      at += 1;
    } else if (!word.startsWith('-')) {
      return word;
    }
  }
  return '';
}

/** Ask for `target`'s details in `repositoryPath`, counting the git processes started. */
async function counted(target: unknown, repositoryPath = where): Promise<Counted> {
  const trace = join(scratch, `trace-${String(Date.now())}-${String(Math.random()).slice(2)}.json`);
  writeFileSync(trace, '');
  const reply = await under({ GIT_TRACE2_EVENT: trace }, () =>
    reader.readDetails({ repositoryPath, target: target as DetailsTarget }),
  );
  const started = readFileSync(trace, 'utf8')
    .split('\n')
    .filter((line) => line.includes('"event":"start"'))
    .map((line) => commandOf((JSON.parse(line) as { argv?: string[] }).argv ?? []));
  return { reply, started };
}

/** The value of a success, or a thrown failure. */
function valueOf<T>(reply: Result<T>): T {
  if (!reply.ok) {
    throw new Error(`${reply.kind}: ${reply.message}`);
  }
  return reply.value;
}

const fixturePerson = (role: 'Author' | 'Committer', time: number): CommitDetails['author'] => ({
  name: `Fixture ${role}`,
  email: `${role.toLowerCase()}@fixture.invalid`,
  time,
  offsetMinutes: 0,
});

const file = (
  path: string,
  status: ChangedFile['status'],
  additions: number | null,
  deletions: number | null,
  oldPath: string | null = null,
): ChangedFile => ({ path, oldPath, status, additions, deletions });

/** The first second of the fixture's clock, and the step between two commits (`specification.json`). */
const FIRST = 1_700_000_000;
const STEP = 60;

/** The message of `main~3`, as `specification.json` writes it. */
const MESSAGE =
  'rename, delete, add and modify, by two people\n\n    a line indented by four spaces\n' +
  '\ta line indented by a tab\n\nafter a blank line\n';

describe('the details of a commit, read through the adapter in one git process', () => {
  it('reads a root commit against the empty tree', async () => {
    const { reply, started } = await counted({ kind: 'commit', hash: hashOf('main~4') });
    expect(valueOf(reply)).toEqual({
      hash: hashOf('main~4'),
      parents: [],
      author: fixturePerson('Author', FIRST),
      committer: fixturePerson('Committer', FIRST),
      message: 'begin the details history\n',
      files: [
        file('binary.dat', 'added', null, null),
        file('deep/er/still/leaf.txt', 'added', 1, 0),
        file('delete-me.txt', 'added', 1, 0),
        file('rename-me.txt', 'added', 5, 0),
      ],
    });
    expect(started).toEqual(['log']);
  });
});

describe('the details of a commit by two people, read through the adapter in one git process', () => {
  it('reads two people, the whole message and every kind of change, by every name', async () => {
    const { reply, started } = await counted({ kind: 'commit', hash: hashOf('main~3') });
    expect(valueOf(reply)).toEqual({
      hash: hashOf('main~3'),
      parents: [hashOf('main~4')],
      author: {
        name: 'Détails Author',
        email: 'details-author@fixture.invalid',
        time: FIRST + STEP - 86_400,
        offsetMinutes: 90,
      },
      committer: {
        name: 'Details Committer',
        email: 'details-committer@fixture.invalid',
        time: FIRST + STEP,
        offsetMinutes: -420,
      },
      message: MESSAGE,
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
    });
    expect(started).toEqual(['log']);
  });
});

describe('the details of a commit, its message, a merge and a folder inside the repository', () => {
  it('reads the message exactly as the commit object holds it', async () => {
    const details = valueOf(
      (await counted({ kind: 'commit', hash: hashOf('main~3') })).reply,
    ) as CommitDetails;
    const object = gitSays(where, ['cat-file', 'commit', hashOf('main~3')]);
    expect(details.message).toBe(object.slice(object.indexOf('\n\n') + 2));
    expect(details.message).toContain('\n    a line indented by four spaces\n\ta line indented');
  });

  it('reads the deletion of the two names Windows refuses', async () => {
    const { reply } = await counted({ kind: 'commit', hash: hashOf('main~2') });
    expect((valueOf(reply) as CommitDetails).files).toEqual([
      file('question?.txt', 'deleted', 0, 1),
      file('quote"mark.txt', 'deleted', 0, 1),
    ]);
  });

  it('reads a merge against its first parent, which lists what the second brought', async () => {
    const { reply, started } = await counted({ kind: 'commit', hash: hashOf('main') });
    expect(valueOf(reply)).toEqual({
      hash: hashOf('main'),
      parents: [hashOf('main^1'), hashOf('main^2')],
      author: fixturePerson('Author', FIRST + 5 * STEP),
      committer: fixturePerson('Committer', FIRST + 5 * STEP),
      message: 'merge the side\n',
      files: [file('side.txt', 'added', 1, 0)],
    });
    expect(started).toEqual(['log']);
  });
});

describe('the details of a commit under configuration that would change them', () => {
  it('reads the same files from a folder inside the repository, whatever diff.relative says', async () => {
    const hash = hashOf('main~3');
    const fromRoot = valueOf((await counted({ kind: 'commit', hash })).reply);
    const relative = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'diff.relative',
      GIT_CONFIG_VALUE_0: 'true',
    };
    const inside = join(where, 'deep', 'er');
    const fromInside = await under(relative, () => counted({ kind: 'commit', hash }, inside));
    expect(valueOf(fromInside.reply)).toEqual(fromRoot);
    const uncommitted = await under(relative, () => counted({ kind: 'uncommitted' }, inside));
    expect(valueOf(uncommitted.reply)).toEqual(
      valueOf((await counted({ kind: 'uncommitted' })).reply),
    );
  });

  it('detects a rename whatever diff.renames says', async () => {
    // With diff.renames=false and no -M, git 2.51.0 lists main~3's rename as a
    // deletion of rename-me.txt and an addition of renamed.txt.
    const hash = hashOf('main~3');
    const off = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'diff.renames',
      GIT_CONFIG_VALUE_0: 'false',
    };
    const { reply } = await under(off, () => counted({ kind: 'commit', hash }));
    const files = (valueOf(reply) as CommitDetails).files;
    expect(files.filter((changed) => changed.path.startsWith('rename'))).toEqual([
      file('renamed.txt', 'renamed', 1, 1, 'rename-me.txt'),
    ]);
  });
});

describe('the details of something that is not a commit of the repository', () => {
  it('answers a tree’s and a blob’s object name with a failure, after one git process', async () => {
    const [tree = '', blob = ''] = gitLines(where, ['rev-parse', 'main^{tree}', 'main:side.txt']);
    for (const hash of [tree, blob]) {
      const { reply, started } = await counted({ kind: 'commit', hash });
      expect(reply).toEqual({
        ok: false,
        kind: FailureKind.GitFailed,
        message: `${hash} is not a commit of this repository.`,
      });
      expect(started).toEqual(['log']);
    }
  });

  it('answers an object name the repository does not hold with git’s own failure', async () => {
    const { reply, started } = await counted({ kind: 'commit', hash: '0123456789'.repeat(4) });
    expect(reply.ok).toBe(false);
    expect(reply.ok ? '' : reply.kind).toBe(FailureKind.GitFailed);
    expect(reply.ok ? '' : reply.message).toContain('0123456789'.repeat(4));
    expect(started).toEqual(['log']);
  });

  it('answers a target that is not one with a failure, and starts no git process', async () => {
    const refused = {
      ok: false,
      kind: FailureKind.GitFailed,
      message:
        'The details asked for name neither a commit by its full object name nor the uncommitted changes.',
    };
    for (const target of [
      { kind: 'commit', hash: 'main' },
      { kind: 'commit', hash: '--output=details.txt' },
      { kind: 'commit', hash: hashOf('main').slice(0, 12) },
      { kind: 'stash' },
      undefined,
    ]) {
      const { reply, started } = await counted(target);
      expect(reply, JSON.stringify(target)).toEqual(refused);
      expect(started).toEqual([]);
    }
  });
});

describe('the details of the uncommitted changes, read through the adapter in two git processes', () => {
  it('reads every changed path against HEAD, staged or not, then every untracked file', async () => {
    const { reply, started } = await counted({ kind: 'uncommitted' });
    expect(valueOf(reply)).toEqual({
      files: [
        file('deep/er/still/leaf.txt', 'modified', 1, 0),
        file('staged ✓ #%.txt', 'added', 1, 0),
        file('untracked ünï.txt', 'untracked', null, null),
      ],
    });
    expect(started).toEqual(['status', 'diff']);
  });

  it('reads a repository with no commit yet as every path added or untracked', async () => {
    const { reply, started } = await counted({ kind: 'uncommitted' }, unborn);
    expect(valueOf(reply)).toEqual({
      files: [file('staged.txt', 'added', 2, 0), file('loose.txt', 'untracked', null, null)],
    });
    expect(started).toEqual(['status', 'diff']);
  });

  it('answers a commit asked for in a repository with no commit with git’s own failure', async () => {
    const { reply, started } = await counted({ kind: 'commit', hash: hashOf('main') }, unborn);
    expect(reply.ok).toBe(false);
    expect(started).toEqual(['log']);
  });
});
