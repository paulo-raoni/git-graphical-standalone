import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { FailureKind } from '../contracts/index';
import type { Result } from '../contracts/index';

import { runGit } from './git-process';

/**
 * Finding git, and measuring the one that was found.
 *
 * `docs/ADR-0001-stack.md` Axis 1: the executable is discovered — a configured
 * path, then `PATH`, then the usual install locations — and **never assumed**. A
 * bare `git` handed to `spawn` resolves against the environment of whatever
 * launched the application, which for a desktop application started from a
 * launcher is not the environment its user has in a terminal; the failure that
 * produces is "no repository opens" with nothing said about why.
 *
 * Not finding it is a value, not an exception: `FailureKind.GitMissing`, with
 * the list of places that were looked in, so that the message names the search
 * rather than the conclusion.
 */

/** What `git --version` prints before the number. */
const VERSION_PREFIX = 'git version ';

/**
 * Where the Windows installer puts git: an environment variable naming a root,
 * and the path under it, per install scope.
 */
const WINDOWS_INSTALLS: readonly (readonly [string, readonly string[]])[] = [
  ['ProgramFiles', ['Git', 'cmd', 'git.exe']],
  ['ProgramFiles', ['Git', 'bin', 'git.exe']],
  ['ProgramW6432', ['Git', 'cmd', 'git.exe']],
  ['ProgramFiles(x86)', ['Git', 'cmd', 'git.exe']],
  ['LOCALAPPDATA', ['Programs', 'Git', 'cmd', 'git.exe']],
];

/** Where git lives on the platforms with a filesystem hierarchy standard. */
const POSIX_INSTALLS: readonly string[] = [
  '/usr/bin/git',
  '/usr/local/bin/git',
  '/bin/git',
  '/opt/homebrew/bin/git',
  '/Library/Developer/CommandLineTools/usr/bin/git',
  '/Applications/Xcode.app/Contents/Developer/usr/bin/git',
];

/** The version git reported. */
export interface GitVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The line git printed, kept verbatim, suffixes and all. */
  readonly text: string;
}

/** The git that was found. */
export interface GitExecutable {
  readonly path: string;
  readonly version: GitVersion;
}

/** Where to look, and on what. */
export interface DiscoveryOptions {
  /** A path the user configured, which is tried before anything else. */
  readonly configuredPath?: string | undefined;
  /** The platform, which decides the install locations and the file name. */
  readonly platform: string;
  /** The environment, which is where `PATH` and the install roots come from. */
  readonly environment: NodeJS.ProcessEnv;
}

/** One dot-separated part of a version, or -1 when it is not a number. */
function numberOf(parts: readonly string[], index: number): number {
  const value = Number.parseInt(parts[index] ?? '', 10);
  return Number.isNaN(value) ? -1 : value;
}

/**
 * The version in what `git --version` printed, or `null` when that is not what
 * this program is.
 */
export function parseGitVersion(text: string): GitVersion | null {
  const line = text.trim();
  if (!line.startsWith(VERSION_PREFIX)) {
    return null;
  }
  const parts = line.slice(VERSION_PREFIX.length).split('.');
  const major = numberOf(parts, 0);
  const minor = numberOf(parts, 1);
  if (major < 0 || minor < 0) {
    return null;
  }
  return { major, minor, patch: Math.max(numberOf(parts, 2), 0), text: line };
}

/**
 * Every `PATH` entry with the executable's name joined onto it.
 *
 * The separator comes from `options.platform` rather than from `node:path`'s own
 * `delimiter`, so that the whole search is a function of what it was told. They
 * are the same character wherever this actually runs; the difference is that a
 * search described as a Windows one can be read, and tested, on any machine.
 */
function pathCandidates(options: DiscoveryOptions): string[] {
  const search = options.environment['PATH'] ?? options.environment['Path'] ?? '';
  const windows = options.platform === 'win32';
  const name = windows ? 'git.exe' : 'git';
  const candidates: string[] = [];
  for (const entry of search.split(windows ? ';' : ':')) {
    if (entry.length > 0) {
      candidates.push(join(entry, name));
    }
  }
  return candidates;
}

/** The usual install locations for this platform. */
function installCandidates(options: DiscoveryOptions): string[] {
  if (options.platform !== 'win32') {
    return [...POSIX_INSTALLS];
  }
  const candidates: string[] = [];
  for (const [variable, under] of WINDOWS_INSTALLS) {
    const root = options.environment[variable];
    if (root !== undefined && root.length > 0) {
      candidates.push(join(root, ...under));
    }
  }
  return candidates;
}

/** Everywhere this search would look, in the order it looks. */
export function candidateGitPaths(options: DiscoveryOptions): readonly string[] {
  const configured = options.configuredPath;
  const candidates: string[] = [];
  if (configured !== undefined && configured.length > 0) {
    candidates.push(configured);
  }
  candidates.push(...pathCandidates(options), ...installCandidates(options));
  return candidates;
}

/** Run one candidate's `--version`, and report what it is, or `null`. */
async function versionOf(path: string): Promise<GitVersion | null> {
  const said: Uint8Array[] = [];
  const outcome = await runGit({
    executable: path,
    args: ['--version'],
    onOutput: (chunk) => {
      said.push(chunk);
    },
  });
  if (!outcome.ok) {
    return null;
  }
  return parseGitVersion(Buffer.concat(said).toString('utf8'));
}

/** The message a failed search carries: what was searched, not just the verdict. */
function notFoundMessage(searched: readonly string[]): string {
  return `No git executable was found. Looked in ${String(searched.length)} places:\n${searched.join('\n')}`;
}

/**
 * The first candidate that exists and answers `--version` as git.
 *
 * Existence is checked before the process is started so that a long `PATH` costs
 * a few `stat` calls rather than a failed spawn for every entry of it.
 */
export async function discoverGit(options: DiscoveryOptions): Promise<Result<GitExecutable>> {
  const searched = candidateGitPaths(options);
  for (const candidate of searched) {
    if (existsSync(candidate)) {
      const version = await versionOf(candidate);
      if (version !== null) {
        return { ok: true, value: { path: candidate, version } };
      }
    }
  }
  return { ok: false, kind: FailureKind.GitMissing, message: notFoundMessage(searched) };
}
