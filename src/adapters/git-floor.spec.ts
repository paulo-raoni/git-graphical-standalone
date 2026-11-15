import { beforeAll, describe, expect, it } from 'vitest';

import type { CommitDetails, Result, UncommittedDetails } from '../contracts/index';

import { fixtureAt, gitLines } from './fixtures.spec-support';
import { commitDetailsArgs, stashArgs, statusArgs, uncommittedDiffArgs } from './git-commands';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * The details read on the git this project states as its requirement, 2.25
 * (`docs/SETUP.md`), and under the two settings its forms for git 2.25 left to
 * be overridden.
 *
 * **Only a newer git is installed on this machine**, so no run here can show git
 * 2.25 refusing an option. What this suite holds instead is that every option
 * the details read passes is one whose first documentation is at or below 2.25,
 * by the version E04-M01-S16 read for each from git's own documentation at its
 * release tag; the slice document carries the table and how each line was read.
 * An option added to a list that is not in the table fails here until its first
 * version is read and written into both.
 */

/**
 * The first git release whose documentation names each option the details read
 * passes, as `[major, minor]`: read by E04-M01-S16 from `Documentation/` of
 * git/git at the `vX.Y.0` tags, present at the version given and absent at the
 * minor before it, or present at the oldest tag read (v1.6.0) where it says so in
 * the slice document. `--no-use-mailmap` is the negation of `--use-mailmap`
 * (v1.8.2), which git's `gitcli` documents for every long option from then on;
 * `git-log` names the negated form itself from v2.23.0. `--` is entered at 2.25,
 * where the synopses of `git log`, `git diff` and `git status` name it; earlier
 * tags were not searched for it.
 */
const FIRST_DOCUMENTED: ReadonlyMap<string, readonly [number, number]> = new Map([
  ['--no-pager', [1, 6]],
  ['--no-optional-locks', [2, 15]],
  ['-C', [1, 8]],
  ['-c', [1, 7]],
  ['-<number>', [1, 6]],
  ['--format', [1, 7]],
  ['--date=raw', [1, 7]],
  ['--no-use-mailmap', [1, 8]],
  ['-m', [1, 7]],
  ['--first-parent', [1, 6]],
  ['--raw', [1, 6]],
  ['--numstat', [1, 6]],
  ['-z', [1, 6]],
  ['-M', [1, 6]],
  ['--porcelain=v2', [2, 11]],
  ['--branch', [1, 7]],
  ['--untracked-files=all', [1, 7]],
  ['--', [2, 25]],
]);

/** The requirement `docs/SETUP.md` states. */
const STATED: readonly [number, number] = [2, 25];

/** The words of `args` that are options: everything that begins with `-`, keyed as the table keys it. */
function optionsOf(args: readonly string[]): string[] {
  return args
    .filter((word) => word.startsWith('-'))
    .map((word) => {
      if (/^-\d+$/.test(word)) {
        return '-<number>';
      }
      return word.startsWith('--format=') ? '--format' : word;
    });
}

const reader = createGitRepositoryReader();

let where = '';

beforeAll(async () => {
  where = fixtureAt('details');
  expect((await reader.describe()).ok).toBe(true);
});

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

/** One setting given to git the way a user's own configuration would be. */
const setting = (key: string, value: string): Record<string, string> => ({
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: key,
  GIT_CONFIG_VALUE_0: value,
});

/** The files of the commit `revision` names, read through the adapter. */
async function filesOf(revision: string): Promise<CommitDetails['files']> {
  const [hash = ''] = gitLines(where, ['rev-parse', revision]);
  const reply: Result<CommitDetails | UncommittedDetails> = await reader.readDetails({
    repositoryPath: where,
    target: { kind: 'commit', hash },
  });
  if (!reply.ok) {
    throw new Error(`${reply.kind}: ${reply.message}`);
  }
  return reply.value.files;
}

describe('the details read, on the git the setup states', () => {
  it('passes only options git documents at or below 2.25', () => {
    const lists = [
      commitDetailsArgs('repository', '0'.repeat(40)),
      stashArgs('repository'),
      statusArgs('repository'),
      uncommittedDiffArgs('repository', '0'.repeat(40)),
    ];
    for (const list of lists) {
      for (const option of optionsOf(list)) {
        const first = FIRST_DOCUMENTED.get(option);
        expect(first, `${option} has no first version read`).toBeDefined();
        const [major = 0, minor = 0] = first ?? [];
        const [floorMajor, floorMinor] = STATED;
        expect(major * 1000 + minor, option).toBeLessThanOrEqual(floorMajor * 1000 + floorMinor);
      }
    }
  });

  it('reads a merge against its first parent, whatever log.diffMerges says', async () => {
    const plain = await filesOf('main');
    expect(plain.map((changed) => changed.path)).toEqual(['side.txt']);
    for (const value of ['combined', 'dense-combined', 'separate', 'remerge']) {
      const files = await under(setting('log.diffMerges', value), () => filesOf('main'));
      expect(files, value).toEqual(plain);
    }
  });

  it('reads a root commit against the empty tree, whatever log.showRoot says', async () => {
    const plain = await filesOf('main~4');
    expect(plain).toHaveLength(4);
    const hidden = await under(setting('log.showRoot', 'false'), () => filesOf('main~4'));
    expect(hidden).toEqual(plain);
  });
});
