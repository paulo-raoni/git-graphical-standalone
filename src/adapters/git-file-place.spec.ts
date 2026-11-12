import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FailureKind } from '../contracts/index';
import type { DetailsTarget, Result } from '../contracts/index';
import type { FilePlace } from '../ports/index';

import { PARSING_CONFIGURATION, topLevelArguments } from './git-commands';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * Where a changed file is (E04-M01-S10), read through the adapter from a
 * repository this suite builds and then changes in its working tree, each answer
 * compared with a literal and with the top level git itself prints, and each
 * request's git processes counted from git's own trace as `git-details.spec.ts`
 * counts the details read.
 *
 * The repository: one commit holding `keep.txt`, `moved.txt`, `gone.txt` and
 * `dir/inner.txt`; then, in the working tree, `moved.txt` is renamed with
 * `git mv` to `dir/renamed.txt`, `gone.txt` is deleted, and `loose.txt` is
 * written and never added.
 */

const reader = createGitRepositoryReader();
let scratch = '';
let repository = '';
let commit = '';

const git = (...args: string[]): string =>
  execFileSync(
    'git',
    ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-C', repository, ...args],
    { encoding: 'utf8' },
  ).trim();

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'git-graphical-place-'));
  repository = join(scratch, 'repo');
  mkdirSync(join(repository, 'dir'), { recursive: true });
  execFileSync('git', ['init', '--quiet', repository]);
  for (const name of ['keep.txt', 'moved.txt', 'gone.txt', 'dir/inner.txt']) {
    writeFileSync(join(repository, name), `${name} has some lines\nof its own\nto be found\n`);
  }
  git('add', '--', '.');
  git('commit', '--quiet', '-m', 'one');
  commit = git('rev-parse', 'HEAD');
  git('mv', 'moved.txt', 'dir/renamed.txt');
  rmSync(join(repository, 'gone.txt'));
  writeFileSync(join(repository, 'loose.txt'), 'never added\n');
  expect((await reader.describe()).ok).toBe(true);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const COMMIT: DetailsTarget = { kind: 'commit', hash: '' };
const target = (): DetailsTarget => ({ ...COMMIT, hash: commit });

/** Run `work` with `GIT_TRACE2_EVENT` set to a file, and say which git commands it started. */
async function started<T>(work: () => Promise<T>): Promise<{ result: T; commands: string[] }> {
  const trace = join(scratch, `trace-${String(Date.now())}-${String(Math.random()).slice(2)}.json`);
  writeFileSync(trace, '');
  const saved = process.env['GIT_TRACE2_EVENT'];
  process.env['GIT_TRACE2_EVENT'] = trace;
  let result: T;
  try {
    result = await work();
  } finally {
    if (saved === undefined) {
      Reflect.deleteProperty(process.env, 'GIT_TRACE2_EVENT');
    } else {
      process.env['GIT_TRACE2_EVENT'] = saved;
    }
  }
  const commands = readFileSync(trace, 'utf8')
    .split('\n')
    .filter((line) => line.includes('"event":"start"'))
    .map((line) => {
      const argv = (JSON.parse(line) as { argv?: string[] }).argv ?? [];
      const at = argv.findIndex((word) => word === 'rev-parse' || word === 'diff');
      return argv[at] ?? '';
    });
  return { result, commands };
}

/** Ask, and return the reply with the commands the ask started. */
async function ask(
  path: string,
  follow: boolean,
  what: unknown = target(),
  repositoryPath = repository,
): Promise<{ reply: Result<FilePlace>; commands: string[] }> {
  const { result, commands } = await started(() =>
    reader.readFilePlace({ repositoryPath, target: what as DetailsTarget, path, follow }),
  );
  return { reply: result, commands };
}

describe('the top level', () => {
  it('is asked with the whole configuration ahead of its git command, as every list of the adapter is', () => {
    const args = topLevelArguments('repository');
    const at = args.findIndex((_, place) =>
      PARSING_CONFIGURATION.every((word, offset) => args[place + offset] === word),
    );
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at + PARSING_CONFIGURATION.length).toBeLessThanOrEqual(args.indexOf('rev-parse'));
  });

  it('is the one git prints, for the root and for a folder inside it', async () => {
    const top = git('rev-parse', '--show-toplevel');
    const root = await ask('keep.txt', false);
    expect(root.reply).toEqual({ ok: true, value: { top, path: 'keep.txt' } });
    const inside = await ask('keep.txt', false, target(), join(repository, 'dir'));
    expect(inside.reply).toEqual({ ok: true, value: { top, path: 'keep.txt' } });
  });

  it('costs one git process without following, for a commit and for the uncommitted changes', async () => {
    expect((await ask('keep.txt', false)).commands).toEqual(['rev-parse']);
    expect((await ask('keep.txt', false, { kind: 'uncommitted' })).commands).toEqual(['rev-parse']);
  });

  it('fails with an error of git in a folder that is no repository', async () => {
    const { reply, commands } = await ask('a.txt', false, target(), scratch);
    expect(reply).toMatchObject({ ok: false, kind: FailureKind.GitFailed });
    expect(commands).toEqual(['rev-parse']);
  });
});

describe('following the file of a commit', () => {
  it('gives a file the working tree renamed its new path, with the diff as the second process', async () => {
    const { reply, commands } = await ask('moved.txt', true);
    expect(reply).toMatchObject({ ok: true, value: { path: 'dir/renamed.txt' } });
    expect(commands).toEqual(['rev-parse', 'diff']);
  });

  it('says a file the working tree deleted is gone', async () => {
    const { reply } = await ask('gone.txt', true);
    expect(reply).toMatchObject({ ok: true, value: { path: null } });
  });

  it('leaves an unchanged file, and one inside a folder, where it is', async () => {
    expect((await ask('keep.txt', true)).reply).toMatchObject({ value: { path: 'keep.txt' } });
    expect((await ask('dir/inner.txt', true)).reply).toMatchObject({
      value: { path: 'dir/inner.txt' },
    });
  });

  it('does not follow a rename it was not asked to', async () => {
    const { reply, commands } = await ask('moved.txt', false);
    expect(reply).toMatchObject({ ok: true, value: { path: 'moved.txt' } });
    expect(commands).toEqual(['rev-parse']);
  });

  it('starts no diff for the uncommitted changes, whose paths are those of the working tree', async () => {
    const { reply, commands } = await ask('loose.txt', true, { kind: 'uncommitted' });
    expect(reply).toMatchObject({ ok: true, value: { path: 'loose.txt' } });
    expect(commands).toEqual(['rev-parse']);
  });
});

describe('a request that names no target', () => {
  it('is refused without starting a git process', async () => {
    for (const what of [{ kind: 'commit', hash: '--output=x' }, null, 'HEAD', { kind: 'x' }]) {
      const { reply, commands } = await ask('keep.txt', true, what);
      expect(reply, JSON.stringify(what)).toMatchObject({ ok: false, kind: FailureKind.GitFailed });
      expect(commands).toEqual([]);
    }
  });

  it('fails with an error of git for a commit the repository does not have', async () => {
    const { reply, commands } = await ask('keep.txt', true, {
      kind: 'commit',
      hash: 'a'.repeat(40),
    });
    expect(reply).toMatchObject({ ok: false, kind: FailureKind.GitFailed });
    expect(commands).toEqual(['rev-parse', 'diff']);
  });
});
