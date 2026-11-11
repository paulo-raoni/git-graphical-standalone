import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../contracts/index';

import { hexAt } from './fixtures.spec-support';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * A repository with more branches, each with a long full reference name, than
 * their names fit on a 32 767-character command line (E04-M01-S17). A name here
 * is 55 characters on the command line and a space, so 1 000 of them are about
 * 56 000. Selecting every one must still read the page, with the selected
 * branches' commits.
 *
 * The repository is built from a `fast-import` stream with fixed dates, so the
 * case holds no clock: a root commit on `main` and one child commit on each of
 * the branches, which is what tells a page that read the selection from one
 * that read nothing.
 */

const BRANCHES = 1_000;
const FIRST_SECOND = 1_700_000_000;

const reader = createGitRepositoryReader();

let scratch = '';
let where = '';
const names: string[] = [];

/** The full reference name of branch `k`, 55 characters. */
function nameOf(k: number): string {
  return `refs/heads/feature/ticket-${String(k).padStart(4, '0')}-a-description-of-the-work`;
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'git-graphical-many-branches-'));
  where = join(scratch, 'many');
  mkdirSync(where);
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', where]);
  const identity = (second: number): string =>
    `author Many <many@fixture.invalid> ${String(second)} +0000\ncommitter Many <many@fixture.invalid> ${String(second)} +0000\n`;
  const stream = [
    `commit refs/heads/main\nmark :1\n${identity(FIRST_SECOND)}data 5\nroot\ndeleteall\n\n`,
  ];
  for (let k = 0; k < BRANCHES; k += 1) {
    const name = nameOf(k);
    names.push(name);
    stream.push(
      `commit ${name}\nmark :${String(k + 2)}\n${identity(FIRST_SECOND + k + 1)}data 5\nside\nfrom :1\n\n`,
    );
  }
  execFileSync('git', ['-C', where, 'fast-import', '--done', '--quiet'], {
    input: `${stream.join('')}done\n`,
    maxBuffer: 64 * 1024 * 1024,
  });
}, 120_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('a selection of more branches than a command line holds their names', () => {
  it('is read, with the commits of the selected branches', async () => {
    expect(names.join(' ').length).toBeGreaterThan(32_767);
    const outcome = await reader.readPage({
      repositoryPath: where,
      pageSize: 100_000,
      selection: { branches: names, showRemoteBranches: true },
    });
    if (!outcome.ok) {
      throw new Error(`${outcome.kind}: ${outcome.message}`);
    }
    const page = outcome.value;
    expect(page.commits.count).toBe(BRANCHES + 1);
    const tips = execFileSync('git', ['-C', where, 'rev-list', '--branches=feature/*'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .trim()
      .split('\n')
      .sort();
    const read = Array.from({ length: page.commits.count }, (_, row) =>
      hexAt(page.commits.hashes, row, HASH_BYTE_LENGTH),
    );
    for (const tip of tips) {
      expect(read).toContain(tip);
    }
  });
});
