import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { entryAt } from '../contracts/column-read';
import { FailureKind, HASH_BYTE_LENGTH, RowFlag } from '../contracts/index';
import { createLayoutState } from '../core/layout/index';
import { addPage, createRowBlock, layoutReading } from '../core/page/index';

import { hexAt } from './fixtures.spec-support';
import { runGit } from './git-process';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * A repository with more stashes, each made on a commit of its own, than their
 * object names fit on a 32 767-character command line (E04-M01-FIX-08). One name
 * is forty characters on the command line and a space, so 1 200 of them are
 * about 49 200, past the limit Windows puts on a process. The page must still be
 * read, and the newest stash must be a stash row joined to its base.
 *
 * The repository is built from a `fast-import` stream with fixed dates and a
 * stash reflog written directly, so the case holds no clock.
 */

const STASHES = 1_200;
const FIRST_SECOND = 1_700_000_000;

const reader = createGitRepositoryReader();

let scratch = '';
let where = '';
let newestBase = '';

/** Run git in `where`, with `input` on its standard input. */
function git(args: readonly string[], input?: string): string {
  return execFileSync('git', ['-C', where, ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** A `fast-import` commit with every date fixed, an empty tree and the given parents. */
function commit(ref: string, mark: number, second: number, parents: readonly string[]): string {
  const stamp = `${String(second)} +0000`;
  const message = `commit ${String(mark)}\n`;
  const [first, ...merges] = parents;
  return [
    `commit ${ref}\nmark :${String(mark)}\n`,
    `author Many <many@fixture.invalid> ${stamp}\ncommitter Many <many@fixture.invalid> ${stamp}\n`,
    `data ${String(Buffer.byteLength(message))}\n${message}`,
    first === undefined ? 'deleteall\n' : `from ${first}\n`,
    ...merges.map((parent) => `merge ${parent}\n`),
    '\n',
  ].join('');
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'git-graphical-many-stashes-'));
  where = join(scratch, 'many');
  mkdirSync(where);
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', where]);
  // Marks: base k is k + 1, its index commit is STASHES + k + 1, its stash is 2 * STASHES + k + 1.
  const stream: string[] = [];
  for (let k = 0; k < STASHES; k += 1) {
    const base = FIRST_SECOND + k * 60;
    stream.push(commit('refs/heads/main', k + 1, base, k === 0 ? [] : [`:${String(k)}`]));
    stream.push(commit('refs/tmp/work', STASHES + k + 1, base + 20, [`:${String(k + 1)}`]));
    stream.push(
      commit('refs/tmp/work', 2 * STASHES + k + 1, base + 30, [
        `:${String(k + 1)}`,
        `:${String(STASHES + k + 1)}`,
      ]),
    );
  }
  const marks = join(scratch, 'marks');
  git(['fast-import', '--done', '--quiet', `--export-marks=${marks}`], `${stream.join('')}done\n`);
  git(['update-ref', '-d', 'refs/tmp/work']);
  const hashOfMark = new Map<number, string>();
  for (const line of readFileSync(marks, 'utf8').trim().split('\n')) {
    const [mark = '', hash = ''] = line.split(' ');
    hashOfMark.set(Number(mark.slice(1)), hash);
  }
  const zero = '0'.repeat(HASH_BYTE_LENGTH * 2);
  const entries: string[] = [];
  let before = zero;
  for (let k = 0; k < STASHES; k += 1) {
    const stash = hashOfMark.get(2 * STASHES + k + 1) ?? '';
    const stamp = `${String(FIRST_SECOND + k * 60 + 30)} +0000`;
    entries.push(
      `${before} ${stash} Many <many@fixture.invalid> ${stamp}\tWIP on main: ${String(k)}`,
    );
    before = stash;
  }
  mkdirSync(join(where, '.git', 'logs', 'refs'), { recursive: true });
  writeFileSync(join(where, '.git', 'logs', 'refs', 'stash'), `${entries.join('\n')}\n`);
  writeFileSync(join(where, '.git', 'refs', 'stash'), `${before}\n`);
  newestBase = hashOfMark.get(STASHES) ?? '';
}, 120_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('a repository with more stashes than a command line holds their bases', () => {
  it('is read, and its newest stash is a stash row joined to its base', async () => {
    const outcome = await reader.readPage({ repositoryPath: where, pageSize: 100 });
    if (!outcome.ok) {
      throw new Error(`${outcome.kind}: ${outcome.message}`);
    }
    const read = outcome.value;
    expect(read.commits.count).toBe(100);
    const block = createRowBlock();
    const page = addPage(block, layoutReading(createLayoutState(), block, read), read);
    expect(entryAt(page.layout.flags, 0) & RowFlag.Stash).toBe(RowFlag.Stash);
    expect(entryAt(read.commits.parentOffsets, 1) - entryAt(read.commits.parentOffsets, 0)).toBe(1);
    const base = entryAt(read.commits.parentIndices, entryAt(read.commits.parentOffsets, 0));
    expect(hexAt(read.commits.hashes, base, HASH_BYTE_LENGTH)).toBe(newestBase);
    expect(entryAt(page.layout.flags, base) & RowFlag.Stash).toBe(0);
  });
});

describe('runGit given a command line the system refuses', () => {
  it('answers a failure value naming that git could not be started, and does not reject', async () => {
    const outcome = await runGit({
      executable: 'git',
      args: ['version', 'x'.repeat(4_000_000)],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe(FailureKind.GitFailed);
      expect(outcome.message).toContain('could not be started');
    }
  });
});
