import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../contracts/index';
import type { BranchSelection } from '../contracts/index';
import type { RepositoryPage } from '../ports/index';

import { fixtureAt, gitLines, hexAt, refNameAt } from './fixtures.spec-support';
import * as commands from './git-commands';
import {
  commitDetailsArgs,
  commitLogArgs,
  PARSING_CONFIGURATION,
  referenceArgs,
  repositoryProbeArgs,
  stashArgs,
  statusArgs,
  uncommittedDiffArgs,
} from './git-commands';
import { createGitRepositoryReader } from './git-repository-reader';
import { referenceFixtureAt } from './reference-fixtures.spec-support';

/**
 * Colour a user has configured never reaches a name the reader shows.
 *
 * Three places a person's colour setting can come from, one case each, because
 * an override that one of them defeats is the regression this guards:
 *
 * - **the repository's own configuration**: the `colour-config` repository,
 *   whose `.git/config` sets `color.ui`, `color.branch`, `color.diff` and
 *   `color.status` to `always` (`./reference-fixtures.spec-support.ts`);
 * - **a global configuration file**, named by `GIT_CONFIG_GLOBAL`, setting
 *   `color.ui` and `color.branch` to `always`, over the `remotes` and `stash`
 *   fixtures;
 * - **the environment**, `GIT_CONFIG_COUNT` and its pairs, setting
 *   `color.diff` to `always`, which outranks every file, over the same two.
 *
 * Each case runs with only its own source: the system file is switched off and
 * the global file is an empty one, except where the global file is the source.
 *
 * For each source, two things are held. **The commands as they are**: every
 * command the reader runs prints no escape sequence, and every name, subject and
 * person on a page read through the reader is free of one and equal to what git
 * reports. That held before `color.diff=never` was added to the reader's
 * configuration, so it cannot fail when that override is removed. **The
 * override itself**: a `%C(red)` placeholder in a `git log` and a `git stash
 * list` format is coloured by every one of the three sources when git runs
 * without the reader's configuration, and is not coloured with it. That is the
 * case that fails when the override is removed, or when it is replaced by
 * `color.ui=never`, which the repository's `color.diff=always` and the
 * environment's both defeat.
 *
 * **The override in every argument list.** Holding the override for
 * `PARSING_CONFIGURATION` says nothing about a list that leaves it out: E03-M01's
 * review round 05 removed it from `stashArgs` alone and every case above stayed
 * green. So every argument list `./git-commands` exports is held to carry the
 * whole configuration ahead of its git command, where git reads it as
 * configuration rather than as the command's own arguments, and the two whose
 * formats are coloured by `color.diff`, the log and the stash list, are run as
 * the reader builds them with a `%C(red)` placeholder put in place of their
 * format, under each source. The other three print nothing a `%C` placeholder
 * reaches, so for them the first check is the whole of what can be held.
 */

const ESCAPE = '\u001b';

const reader = createGitRepositoryReader();

/**
 * Two global configuration files: an empty one for the sources that are not a
 * global file, and the coloured one for the source that is.
 */
let scratch = '';
let emptyGlobal = '';
let colouredGlobal = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'git-graphical-colour-'));
  emptyGlobal = join(scratch, 'empty.gitconfig');
  colouredGlobal = join(scratch, 'coloured.gitconfig');
  writeFileSync(emptyGlobal, '');
  writeFileSync(colouredGlobal, '[color]\n\tui = always\n\tbranch = always\n');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** One place colour is configured, and the repositories read under it. */
interface Source {
  readonly name: string;
  /** Repositories with every kind of reference name between them, a stash included. */
  readonly repositories: () => readonly string[];
  /** A repository with a stash. */
  readonly stashed: () => string;
  readonly environment: () => Record<string, string>;
}

const SOURCES: readonly Source[] = [
  {
    name: 'the repository’s own configuration',
    repositories: () => [referenceFixtureAt('colour-config')],
    stashed: () => referenceFixtureAt('colour-config'),
    environment: () => ({ GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobal }),
  },
  {
    name: 'a global configuration file',
    repositories: () => [fixtureAt('remotes'), fixtureAt('stash')],
    stashed: () => fixtureAt('stash'),
    environment: () => ({ GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: colouredGlobal }),
  },
  {
    name: 'the environment',
    repositories: () => [fixtureAt('remotes'), fixtureAt('stash')],
    stashed: () => fixtureAt('stash'),
    environment: () => ({
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: emptyGlobal,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'color.diff',
      GIT_CONFIG_VALUE_0: 'always',
    }),
  },
];

/**
 * Run `work` with `variables` set in this process's environment, which is the
 * environment the reader gives git (`readingEnvironment` of `./git-process`),
 * and restore it whatever happens.
 */
async function under<T>(variables: Record<string, string>, work: () => Promise<T> | T): Promise<T> {
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

/** What git prints for `args`, as text, under the current environment. */
function printed(args: readonly string[]): string {
  return execFileSync('git', [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** `text` without the colour sequences git writes, each `ESC [ <digits and ;> m`. */
function withoutColour(text: string): string {
  return text
    .split(ESCAPE)
    .map((part, at) => (at === 0 ? part : part.slice(part.indexOf('m') + 1)))
    .join('');
}

/** The whole of a repository as one page, or a thrown failure. */
async function pageOf(repositoryPath: string): Promise<RepositoryPage> {
  const outcome = await reader.readPage({ repositoryPath, pageSize: 100_000 });
  if (!outcome.ok) {
    throw new Error(`${outcome.kind}: ${outcome.message}`);
  }
  return outcome.value;
}

/** Every reference name of a page. */
function namesOf(page: RepositoryPage): string[] {
  return Array.from({ length: page.refs.count }, (_, index) =>
    refNameAt(page.refs.names, page.refs.nameOffsets, index),
  );
}

/** Every reference name git reports for a repository, as a page names them, stashes included. */
function gitNames(where: string): string[] {
  const named = gitLines(where, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]).map((refname) => refname.replace(/^refs\/(heads|remotes|tags)\//, ''));
  return [...named, ...gitLines(where, ['stash', 'list', '--format=%gd'])];
}

/** Every command the reader runs on a page of `where`. */
function readerCommands(where: string): readonly (readonly string[])[] {
  return [
    repositoryProbeArgs(where),
    commitLogArgs(where, 100_000),
    referenceArgs(where),
    stashArgs(where),
    statusArgs(where),
  ];
}

describe.each(SOURCES)('colour set in $name, through the commands as they are', (source) => {
  it('is printed by none of the commands the reader runs', async () => {
    for (const where of source.repositories()) {
      await under(source.environment(), () => {
        for (const args of readerCommands(where)) {
          expect(printed(args).includes(ESCAPE), args.join(' ')).toBe(false);
        }
      });
    }
  });

  it('reaches no reference name, subject or person on a page', async () => {
    for (const where of source.repositories()) {
      const page = await under(source.environment(), () => pageOf(where));
      expect(namesOf(page).toSorted()).toEqual(gitNames(where).toSorted());
      expect(page.refs.names.includes(ESCAPE)).toBe(false);
      expect(page.commits.subjects.includes(ESCAPE)).toBe(false);
      expect(page.commits.people.names.join('').includes(ESCAPE)).toBe(false);
      expect(page.commits.people.emails.join('').includes(ESCAPE)).toBe(false);
    }
  });
});

describe.each(SOURCES)('colour set in $name, against the override', (source) => {
  it('colours a %C placeholder without the reader’s configuration, and not with it', async () => {
    const where = source.stashed();
    const formats = [
      ['log', '-1', '--format=%C(red)%s'],
      ['stash', 'list', '--format=%C(red)%gd'],
    ];
    await under(source.environment(), () => {
      for (const format of formats) {
        const bare = printed(['-C', where, ...format]);
        const read = printed(['-C', where, ...PARSING_CONFIGURATION, ...format]);
        expect(bare.includes(ESCAPE), `${format.join(' ')} without it`).toBe(true);
        expect(read.includes(ESCAPE), `${format.join(' ')} with it`).toBe(false);
        expect(read).toBe(withoutColour(bare));
      }
    });
  });
});

/** Where `PARSING_CONFIGURATION` begins in `args`, whole and in order, or -1. */
function configurationAt(args: readonly string[]): number {
  const length = PARSING_CONFIGURATION.length;
  for (let at = 0; at + length <= args.length; at += 1) {
    if (PARSING_CONFIGURATION.every((argument, offset) => args[at + offset] === argument)) {
      return at;
    }
  }
  return -1;
}

/** `args` with the reader's configuration taken out, which is how git runs without it. */
function withoutConfiguration(args: readonly string[]): string[] {
  const at = configurationAt(args);
  return [...args.slice(0, at), ...args.slice(at + PARSING_CONFIGURATION.length)];
}

/** `args` with its `--format=` argument replaced by `format`. */
function withFormat(args: readonly string[], format: string): string[] {
  return args.map((argument) =>
    argument.startsWith('--format=') ? `--format=${format}` : argument,
  );
}

/** Every argument list the adapter exports, each built as the reader builds it, and its git command. */
function exportedLists(where: string): readonly (readonly [string, readonly string[], string])[] {
  const selected: BranchSelection = { branches: ['refs/heads/side'], showRemoteBranches: false };
  return [
    ['repositoryProbeArgs', repositoryProbeArgs(where), 'rev-parse'],
    ['commitLogArgs', commitLogArgs(where, 100_000), 'log'],
    ['commitLogArgs, under a selection', commitLogArgs(where, 100_000, selected), 'log'],
    ['referenceArgs', referenceArgs(where), 'for-each-ref'],
    ['referenceArgs, remote branches hidden', referenceArgs(where, false), 'for-each-ref'],
    ['stashArgs', stashArgs(where), 'stash'],
    ['statusArgs', statusArgs(where), 'status'],
    ['commitDetailsArgs', commitDetailsArgs(where, '0'.repeat(40)), 'log'],
    ['uncommittedDiffArgs', uncommittedDiffArgs(where, '0'.repeat(40)), 'diff'],
  ];
}

describe('the override, in every argument list the adapter exports', () => {
  it('names every exported argument list, so that a list added later is held here too', () => {
    const exported = Object.keys(commands).filter((name) => name.endsWith('Args'));
    const held = new Set(exportedLists('repository').map(([name]) => name.split(',')[0]));
    expect(exported.toSorted()).toEqual([...held].toSorted());
  });

  it('carries the whole configuration ahead of the git command, in every list', () => {
    for (const [name, args, command] of exportedLists('repository')) {
      const at = configurationAt(args);
      expect(at, name).toBeGreaterThanOrEqual(0);
      expect(at + PARSING_CONFIGURATION.length, name).toBeLessThanOrEqual(args.indexOf(command));
    }
  });
});

describe.each(SOURCES)('colour set in $name, against the lists the reader runs', (source) => {
  it('colours a %C placeholder in the log and the stash list as built, only without the configuration', async () => {
    const where = source.stashed();
    const lists = [
      withFormat(commitLogArgs(where, 1), '%C(red)%s'),
      withFormat(stashArgs(where), '%C(red)%gd'),
    ];
    await under(source.environment(), () => {
      for (const args of lists) {
        const bare = printed(withoutConfiguration(args));
        const read = printed(args);
        expect(bare.includes(ESCAPE), `${args.join(' ')} without it`).toBe(true);
        expect(read.includes(ESCAPE), `${args.join(' ')} as built`).toBe(false);
        expect(read).toBe(withoutColour(bare));
      }
    });
  });
});

/**
 * The two names E03-M01's review round 04 sent, on the `colour-config` fixture,
 * which has the branch `side` one commit below `main`, HEAD on `main` and a
 * stash on top of it.
 *
 * Here rather than in `git-selection.spec.ts` because E04-M01-S02, which refuses
 * them, had this file and not that one inside its boundary; the fixture is this
 * file's own, and it was the one with a `side`, a HEAD past it and a stash.
 */
describe('a selection naming a revision expression behind a branch’s name', () => {
  const range = 'refs/heads/side..HEAD';
  const symmetric = 'refs/heads/side...refs/stash';
  let where = '';

  beforeAll(() => {
    where = referenceFixtureAt('colour-config');
  });

  /** The hashes of the page `branches` gives, remote branches shown. */
  async function rowsUnder(branches: readonly string[]): Promise<string[]> {
    const selection: BranchSelection = { branches, showRemoteBranches: true };
    const outcome = await reader.readPage({ repositoryPath: where, pageSize: 100_000, selection });
    if (!outcome.ok) {
      throw new Error(`${outcome.kind}: ${outcome.message}`);
    }
    const page = outcome.value;
    return Array.from({ length: page.commits.count }, (_, row) =>
      hexAt(page.commits.hashes, row, HASH_BYTE_LENGTH),
    );
  }

  /** What git's own log of `revisions` is. */
  function gitLog(revisions: readonly string[]): string[] {
    return gitLines(where, ['log', '--format=%H', ...revisions, '--']);
  }

  it('is a name git, given it, reads HEAD’s and the stash’s commits for', () => {
    const [head = ''] = gitLines(where, ['rev-parse', 'HEAD']);
    const stashed = gitLines(where, ['rev-parse', 'refs/stash', 'refs/stash^2']);
    expect(gitLog([range])).toContain(head);
    for (const commit of stashed) {
      expect(gitLog([symmetric])).toContain(commit);
    }
  });

  it('reads no commit when it is all that is selected, as a branch that is gone reads none', async () => {
    expect(await rowsUnder(['refs/heads/gone'])).toEqual([]);
    expect(await rowsUnder([range])).toEqual([]);
    expect(await rowsUnder([symmetric])).toEqual([]);
  });

  it('is dropped beside a branch, which is read alone, as a branch that is gone is dropped', async () => {
    const head = gitLines(where, ['rev-parse', 'HEAD']);
    const stashed = gitLines(where, ['rev-parse', 'refs/stash', 'refs/stash^2']);
    const side = gitLog(['refs/heads/side']);
    expect(await rowsUnder(['refs/heads/gone', 'refs/heads/side'])).toEqual(side);
    for (const name of [range, symmetric]) {
      const rows = await rowsUnder([name, 'refs/heads/side']);
      expect(rows, name).toEqual(side);
      for (const commit of [...head, ...stashed]) {
        expect(rows, name).not.toContain(commit);
      }
    }
  });
});
