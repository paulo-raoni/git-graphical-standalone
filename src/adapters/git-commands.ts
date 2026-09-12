import { COMMIT_LOG_FORMAT, REFERENCE_FORMAT, STASH_FORMAT } from '../core/parse/index';

/**
 * Every git invocation this application makes, in one place.
 *
 * They are argument arrays and never command strings, and they are built here
 * rather than at each call site so that the whole of what this process runs can
 * be read at once — including by the reviewer checking what the user's own
 * configuration is allowed to keep doing.
 *
 * **What is overridden, and why.** Two configuration variables, both because a
 * user who has set them would otherwise change the shape of the output rather
 * than its content:
 *
 * - `log.showSignature=false`. With it on, `git log` runs the signature verifier
 *   and writes its lines into the log output, between the records. They are not
 *   part of the format asked for, so the parser would read them as a record and
 *   fail on the first signed commit.
 * - `i18n.logOutputEncoding=UTF-8`. Git re-encodes a commit message to this
 *   encoding on the way out. The parser decodes UTF-8, so a user who has set a
 *   legacy encoding would otherwise get mojibake for every message with a
 *   character outside ASCII in it.
 *
 * **What is deliberately not overridden.** The locale is left alone, so git's
 * own diagnostics reach the user in the user's own language; every format read
 * here is a machine format that a locale does not move. Colour is left alone,
 * because `--format` without a `%C` placeholder emits none and no porcelain
 * format is coloured. `.mailmap` is turned off with the command-line option
 * `--no-use-mailmap` rather than by writing to `log.mailmap`, because
 * `PersonTable` says identity is whatever git reported **before** a mailmap is
 * applied, and applying one is a later milestone's decision to take.
 */

/** Configuration overridden for every invocation, and nothing beyond it. */
export const PARSING_CONFIGURATION: readonly string[] = [
  '-c',
  'log.showSignature=false',
  '-c',
  'i18n.logOutputEncoding=UTF-8',
];

/**
 * What every invocation starts with.
 *
 * `--no-optional-locks` is what makes this milestone's promise true: `git status`
 * refreshes the index by default, which is a write to the user's repository that
 * nothing here asked for.
 */
function baseArgs(repositoryPath: string): string[] {
  return ['--no-pager', '--no-optional-locks', '-C', repositoryPath, ...PARSING_CONFIGURATION];
}

/** Ask git whether this path is a repository at all. */
export function repositoryProbeArgs(repositoryPath: string): string[] {
  return [...baseArgs(repositoryPath), 'rev-parse', '--git-dir'];
}

/**
 * Read the newest `limit` commits of the references shown.
 *
 * "The branches being shown" is read here as **every local branch, every
 * remote-tracking branch, every tag, and HEAD** — the same set a user sees
 * without having chosen anything.
 *
 * It is spelled out rather than written `--all`, and the reason is measurable:
 * on the `stash` fixture, `--all` returns four commits and this list returns
 * two, because `--all` walks `refs/stash` as well and a stash is two commits of
 * git's own making. Git documents `--all` as every reference under `refs/`, so
 * whatever else a host or a tool has put there — notes, replacements, a
 * `refs/pull/*` namespace — is walked too. Only the stash was measured here;
 * the rest follows from what `--all` is documented to mean.
 *
 * `--ignore-missing` is what lets `HEAD` be named unconditionally: in a
 * repository with no commits yet, HEAD resolves to nothing and naming it would
 * otherwise be a fatal error rather than an empty page.
 */
export function commitLogArgs(repositoryPath: string, limit: number): string[] {
  return [
    ...baseArgs(repositoryPath),
    'log',
    '-z',
    `--format=${COMMIT_LOG_FORMAT}`,
    '--date=raw',
    '--no-use-mailmap',
    `--max-count=${String(limit)}`,
    '--branches',
    '--tags',
    '--remotes',
    '--ignore-missing',
    'HEAD',
    '--',
  ];
}

/** Read every reference that decorates a commit. */
export function referenceArgs(repositoryPath: string): string[] {
  return [
    ...baseArgs(repositoryPath),
    'for-each-ref',
    `--format=${REFERENCE_FORMAT}`,
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ];
}

/** Read the stash entries, each with the commit it sits on. */
export function stashArgs(repositoryPath: string): string[] {
  return [...baseArgs(repositoryPath), 'stash', 'list', '-z', `--format=${STASH_FORMAT}`];
}

/**
 * Read the working tree.
 *
 * `--untracked-files=all` rather than git's default `normal`, because
 * `WorkingTree.untrackedFileCount` is documented as files: the default reports an
 * untracked directory as one entry, so a directory of forty new files would be
 * counted as one.
 */
export function statusArgs(repositoryPath: string): string[] {
  return [
    ...baseArgs(repositoryPath),
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=all',
    '-z',
  ];
}
