import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChangedFile, CommitDetails, Result, UncommittedDetails } from '../contracts/index';

import { fixtureAt, gitLines } from './fixtures.spec-support';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * A stash's details read through the adapter (E04-M01-S14), and the git
 * processes each read starts, counted by git as `git-details.spec.ts` counts
 * them: `GIT_TRACE2_EVENT`, set to a file for the length of one request, makes
 * every git process append a `start` event to it. The helpers are that file's,
 * written out again, because importing a test module registers its suites here
 * as well.
 */

const reader = createGitRepositoryReader();

let scratch = '';

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'git-graphical-stash-details-'));
  expect((await reader.describe()).ok).toBe(true);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

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

/** One request's reply, and the git commands it started, in order. */
interface Counted {
  readonly reply: Result<CommitDetails | UncommittedDetails>;
  readonly started: readonly string[];
}

/** Ask for the details of the commit `hash` in `repositoryPath`, counting the git processes started. */
async function counted(hash: string, repositoryPath: string): Promise<Counted> {
  const trace = join(scratch, `trace-${String(Date.now())}-${String(Math.random()).slice(2)}.json`);
  writeFileSync(trace, '');
  const saved = process.env['GIT_TRACE2_EVENT'];
  process.env['GIT_TRACE2_EVENT'] = trace;
  try {
    const reply = await reader.readDetails({ repositoryPath, target: { kind: 'commit', hash } });
    const started = readFileSync(trace, 'utf8')
      .split('\n')
      .filter((line) => line.includes('"event":"start"'))
      .map((line) => commandOf((JSON.parse(line) as { argv?: string[] }).argv ?? []));
    return { reply, started };
  } finally {
    if (saved === undefined) {
      Reflect.deleteProperty(process.env, 'GIT_TRACE2_EVENT');
    } else {
      process.env['GIT_TRACE2_EVENT'] = saved;
    }
  }
}

/** The value of a success, or a thrown failure. */
function valueOf<T>(reply: Result<T>): T {
  if (!reply.ok) {
    throw new Error(`${reply.kind}: ${reply.message}`);
  }
  return reply.value;
}

const file = (
  path: string,
  status: ChangedFile['status'],
  additions: number | null,
  deletions: number | null,
): ChangedFile => ({ path, oldPath: null, status, additions, deletions });

/**
 * A stash's details, on the `stashes` fixture (`test/fixtures/generate.ts`):
 * `stash@{0}` changed `main.txt` and holds the untracked `untracked.txt` in its
 * third parent; `stash@{1}` changed `gone.txt` and holds no untracked file.
 *
 * `git stash list` runs a `git log` of its own when the repository has a
 * stash, which the trace counts: the stash list's `start` event is followed by
 * a `log` one on `stashes`, and by none in the repository of the merge below,
 * which has no stash (measured here, git 2.51.0).
 */
let stashes = '';
let octopus = '';

beforeAll(() => {
  stashes = fixtureAt('stashes');
  octopus = join(scratch, 'octopus');
  const run = (args: readonly string[]): void => {
    const identity = ['-c', 'user.name=Octopus', '-c', 'user.email=octopus@fixture.invalid'];
    execFileSync('git', ['-C', octopus, ...identity, '-c', 'commit.gpgsign=false', ...args]);
  };
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', octopus]);
  run(['commit', '--quiet', '--allow-empty', '-m', 'root']);
  run(['branch', 'one']);
  run(['branch', 'two']);
  for (const branch of ['one', 'two']) {
    run(['switch', '--quiet', branch]);
    run(['commit', '--quiet', '--allow-empty', '-m', branch]);
  }
  run(['switch', '--quiet', 'main']);
  run(['commit', '--quiet', '--allow-empty', '-m', 'main']);
  run(['merge', '--quiet', '--no-edit', 'one', 'two']);
});

/** The object names `revisions` name in the `stashes` fixture. */
const named = (...revisions: string[]): string[] => gitLines(stashes, ['rev-parse', ...revisions]);

describe('the details of a stash, with its untracked files after its own changes', () => {
  it("lists a stash's changes against the commit it was made on, then its untracked files", async () => {
    const [stash = '', base = '', index = '', untracked = ''] = named(
      'stash@{0}',
      'stash@{0}^1',
      'stash@{0}^2',
      'stash@{0}^3',
    );
    const { reply, started } = await counted(stash, stashes);
    const details = valueOf(reply) as CommitDetails;
    expect(details.parents).toEqual([base, index, untracked]);
    expect(details.message).toBe('On main: stash with an untracked file\n');
    expect(details.files).toEqual([
      file('main.txt', 'modified', 1, 1),
      file('untracked.txt', 'untracked', 1, 0),
    ]);
    expect(started).toEqual(['log', 'stash', 'log', 'log']);
  });

  it('lists a stash with no untracked file as any commit, in one git process', async () => {
    const [stash = ''] = named('stash@{1}');
    const { reply, started } = await counted(stash, stashes);
    expect((valueOf(reply) as CommitDetails).files).toEqual([file('gone.txt', 'modified', 1, 1)]);
    expect(started).toEqual(['log']);
  });
});

describe('the details of a merge of three branches', () => {
  it('lists a merge of three branches that is no stash against its first parent alone', async () => {
    const [merge = ''] = gitLines(octopus, ['rev-parse', 'main']);
    const { reply, started } = await counted(merge, octopus);
    const details = valueOf(reply) as CommitDetails;
    expect(details.parents).toHaveLength(3);
    expect(details.files).toEqual([]);
    expect(started).toEqual(['log', 'stash']);
  });
});
