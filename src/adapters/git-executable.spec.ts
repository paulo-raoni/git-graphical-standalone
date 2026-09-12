import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { FailureKind } from '../contracts/index';

import { candidateGitPaths, discoverGit, parseGitVersion } from './git-executable';

/**
 * Discovery, against the git this machine actually has.
 *
 * The pure half — what a search would look at, and what a version line means —
 * is checked with a fabricated environment so that it says the same thing on
 * every machine. The half that can only be checked here is that the search
 * finds the real one.
 */

/** A directory that exists on no machine, so a search through it finds nothing. */
const NOWHERE = join(tmpdir(), 'git-graphical-standalone-no-such-directory');

describe('parseGitVersion', () => {
  it('reads the version git prints', () => {
    const version = parseGitVersion('git version 2.51.0\n');
    expect(version).toEqual({ major: 2, minor: 51, patch: 0, text: 'git version 2.51.0' });
  });

  it('reads a build with a suffix, keeping the line as it was printed', () => {
    const version = parseGitVersion('git version 2.51.0.windows.1');
    expect(version?.major).toBe(2);
    expect(version?.minor).toBe(51);
    expect(version?.patch).toBe(0);
    expect(version?.text).toBe('git version 2.51.0.windows.1');
  });

  it('reads a version with no patch number as patch zero', () => {
    expect(parseGitVersion('git version 3.0')?.patch).toBe(0);
  });

  it('refuses a program that is not git', () => {
    expect(parseGitVersion('GNU bash, version 5.2.15')).toBeNull();
  });

  it('refuses a version line with no numbers in it', () => {
    expect(parseGitVersion('git version unknown')).toBeNull();
  });
});

describe('candidateGitPaths', () => {
  it('tries a configured path before anything else', () => {
    const candidates = candidateGitPaths({
      configuredPath: '/somewhere/of/my/own/git',
      platform: 'linux',
      environment: { PATH: '/usr/bin' },
    });
    expect(candidates[0]).toBe('/somewhere/of/my/own/git');
  });

  it('ignores a configured path that is empty', () => {
    const candidates = candidateGitPaths({
      configuredPath: '',
      platform: 'linux',
      environment: { PATH: '/usr/bin' },
    });
    expect(candidates[0]).toBe(join('/usr/bin', 'git'));
  });

  it('looks through PATH before the usual install locations', () => {
    const candidates = candidateGitPaths({
      platform: 'linux',
      environment: { PATH: '/first' },
    });
    expect(candidates[0]).toBe(join('/first', 'git'));
    expect(candidates).toContain('/usr/bin/git');
  });

  it('looks for the Windows executable name on Windows', () => {
    const candidates = candidateGitPaths({
      platform: 'win32',
      environment: { Path: 'C:\\tools', ProgramFiles: 'C:\\Program Files' },
    });
    expect(candidates).toContain(join('C:\\tools', 'git.exe'));
    expect(candidates).toContain(join('C:\\Program Files', 'Git', 'cmd', 'git.exe'));
  });
});

describe('candidateGitPaths, on how PATH is read', () => {
  it('splits PATH the way the platform it was told about splits it', () => {
    const windows = candidateGitPaths({
      platform: 'win32',
      environment: { Path: 'C:\\tools;D:\\more' },
    });
    expect(windows).toEqual([join('C:\\tools', 'git.exe'), join('D:\\more', 'git.exe')]);
    const posix = candidateGitPaths({
      platform: 'linux',
      environment: { PATH: '/one:/two', ProgramFiles: 'ignored' },
    });
    expect(posix.slice(0, 2)).toEqual([join('/one', 'git'), join('/two', 'git')]);
  });

  it('skips an empty entry in PATH rather than looking in the current directory', () => {
    const candidates = candidateGitPaths({
      platform: 'linux',
      environment: { PATH: '::/usr/bin' },
    });
    expect(candidates).not.toContain('git');
    expect(candidates[0]).toBe(join('/usr/bin', 'git'));
  });

  it('looks nowhere at all when the environment names nowhere', () => {
    expect(candidateGitPaths({ platform: 'win32', environment: {} })).toEqual([]);
  });
});

describe('discoverGit', () => {
  it('finds the git this machine has, and measures it', async () => {
    const found = await discoverGit({ platform: process.platform, environment: process.env });
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value.version.major).toBeGreaterThanOrEqual(2);
      expect(found.value.version.text.startsWith('git version ')).toBe(true);
      expect(found.value.path.length).toBeGreaterThan(0);
    }
  });

  it('uses a configured path when it is a git', async () => {
    const byPath = await discoverGit({ platform: process.platform, environment: process.env });
    expect(byPath.ok).toBe(true);
    if (!byPath.ok) {
      return;
    }
    const configured = await discoverGit({
      configuredPath: byPath.value.path,
      platform: 'win32',
      environment: {},
    });
    expect(configured.ok).toBe(true);
    if (configured.ok) {
      expect(configured.value.path).toBe(byPath.value.path);
    }
  });

  it('reports git missing as a value, naming what it searched', async () => {
    const found = await discoverGit({ platform: 'win32', environment: { Path: NOWHERE } });
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.kind).toBe(FailureKind.GitMissing);
      expect(found.message).toContain(NOWHERE);
      expect(found.message).toContain('Looked in');
    }
  });

  it('passes over a configured path that is not a git at all', async () => {
    const found = await discoverGit({
      configuredPath: process.execPath,
      platform: 'win32',
      environment: { Path: NOWHERE },
    });
    expect(found.ok).toBe(false);
  });
});
