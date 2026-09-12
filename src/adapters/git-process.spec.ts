import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { beforeAll, describe, expect, it } from 'vitest';

import { FailureKind } from '../contracts/index';

import { discoverGit } from './git-executable';
import { commitLogArgs } from './git-commands';
import { readingEnvironment, runGit } from './git-process';
import { ensureFixtures, fixtureAt } from './fixtures.spec-support';

/**
 * Running git for real: the stream, the failure, and the cleanup.
 *
 * The test that matters most here is the one that measures rather than asserts a
 * sentence: reading the ten thousand commit history hands the output over in
 * many chunks, and the largest of them is the pipe's buffer rather than the
 * output. That is the evidence for "git's whole output is never one string",
 * which is otherwise a claim about code nobody re-reads.
 */

let git = '';

beforeAll(async () => {
  ensureFixtures();
  const found = await discoverGit({ platform: process.platform, environment: process.env });
  if (!found.ok) {
    throw new Error(found.message);
  }
  git = found.value.path;
});

describe('readingEnvironment', () => {
  it('keeps the user’s own variables', () => {
    const kept = readingEnvironment({ PATH: '/usr/bin', GIT_SSH_COMMAND: 'ssh -v' });
    expect(kept['PATH']).toBe('/usr/bin');
    expect(kept['GIT_SSH_COMMAND']).toBe('ssh -v');
  });

  it('removes every variable that would redirect which repository is read', () => {
    const kept = readingEnvironment({
      GIT_DIR: '/elsewhere/.git',
      GIT_WORK_TREE: '/elsewhere',
      GIT_INDEX_FILE: '/elsewhere/index',
      GIT_OBJECT_DIRECTORY: '/elsewhere/objects',
      GIT_ALTERNATE_OBJECT_DIRECTORIES: '/other/objects',
      GIT_COMMON_DIR: '/elsewhere/common',
      GIT_NAMESPACE: 'ns',
      PATH: '/usr/bin',
    });
    expect(Object.keys(kept)).toEqual(['PATH']);
  });
});

describe('runGit', () => {
  it('streams standard output to the caller and reports success', async () => {
    const chunks: Uint8Array[] = [];
    const outcome = await runGit({
      executable: git,
      args: ['--version'],
      onOutput: (chunk) => {
        chunks.push(chunk);
      },
    });
    expect(outcome.ok).toBe(true);
    expect(Buffer.concat(chunks).toString('utf8')).toContain('git version');
  });

  it('reads a repository through -C rather than the environment it inherited', async () => {
    const chunks: Uint8Array[] = [];
    const outcome = await runGit({
      executable: git,
      args: ['-C', fixtureAt('linear'), 'rev-parse', '--is-inside-work-tree'],
      onOutput: (chunk) => {
        chunks.push(chunk);
      },
    });
    expect(outcome.ok).toBe(true);
    expect(Buffer.concat(chunks).toString('utf8').trim()).toBe('true');
  });

  it('hands a large output over in many chunks, never as one', async () => {
    let total = 0;
    let largest = 0;
    let chunks = 0;
    const outcome = await runGit({
      executable: git,
      args: commitLogArgs(fixtureAt('large'), 10_000),
      onOutput: (chunk) => {
        chunks += 1;
        total += chunk.length;
        largest = Math.max(largest, chunk.length);
      },
    });
    expect(outcome.ok).toBe(true);
    expect(total).toBeGreaterThan(1_000_000);
    expect(chunks).toBeGreaterThan(1);
    expect(largest).toBeLessThan(total);
    process.stdout.write(
      `streamed ${String(total)} bytes in ${String(chunks)} chunks; ` +
        `largest chunk ${String(largest)} bytes\n`,
    );
  });
});

describe('runGit, when it does not succeed', () => {
  it('reports a non-zero exit as a value carrying git’s own words', async () => {
    const outcome = await runGit({
      executable: git,
      args: ['-C', join(tmpdir(), 'git-graphical-standalone-no-such-directory'), 'status'],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe(FailureKind.GitFailed);
      expect(outcome.exitCode).toBeGreaterThan(0);
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });

  it('reports an executable that cannot be started as git missing', async () => {
    const outcome = await runGit({
      executable: join(tmpdir(), 'git-graphical-standalone-no-such-program'),
      args: ['--version'],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe(FailureKind.GitMissing);
    }
  });

  it('stops the process and settles when the caller refuses a chunk', async () => {
    const outcome = await runGit({
      executable: git,
      args: commitLogArgs(fixtureAt('large'), 10_000),
      onOutput: () => {
        throw new SyntaxError('this is not the format I asked for');
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe(FailureKind.GitFailed);
      expect(outcome.message).toContain('this is not the format I asked for');
    }
  });

  it('runs without an output handler at all, for a command read only for its status', async () => {
    const outcome = await runGit({
      executable: git,
      args: ['-C', fixtureAt('linear'), 'rev-parse', '--git-dir'],
    });
    expect(outcome.ok).toBe(true);
  });
});
