import type { BranchSelection } from '../contracts/index';
import { isRefName } from '../core/page/index';
import { COMMIT_LOG_FORMAT, REFERENCE_FORMAT, STASH_FORMAT } from '../core/parse/index';

/**
 * Every git invocation this application makes, in one place.
 *
 * They are argument arrays and never command strings, and they are built here
 * rather than at each call site so that the whole of what this process runs can
 * be read at once — including by the reviewer checking what the user's own
 * configuration is allowed to keep doing.
 *
 * **What is overridden, and why.** Three configuration variables, each because
 * a user who has set it would otherwise change the shape of the output rather
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
 * - `color.diff=never`. No format read here asks for colour today, and none of
 *   the five commands printed an escape sequence with `color.ui`,
 *   `color.branch`, `color.diff`, `color.status`, `color.decorate` or
 *   `color.showBranch` set to `always` (git 2.51.0, measured by E03-M01-S11;
 *   `src/adapters/git-colour.spec.ts` holds it for the commands as they are).
 *   But a `%C(…)` placeholder in a `git log` or `git stash list` format is
 *   coloured whenever colour is on, so the first format that used one would put
 *   escape sequences into a subject or a stash name for every user who has
 *   colour on. `color.diff` is the key those two commands read, and it outranks
 *   `color.ui`: with `-c color.ui=never` alone, a user's `color.diff=always`
 *   still coloured `%C(red)` in both (same measurement). Given on the command
 *   line, it also outranks the user's files and the `GIT_CONFIG_COUNT` and
 *   `GIT_CONFIG_PARAMETERS` variables, each of which was measured setting
 *   `color.diff=always` against it and losing. `for-each-ref` reads no colour
 *   key for its `%(color)` atoms (it coloured them only for `--color=always`)
 *   and porcelain `status` is never coloured, so a command added later that
 *   reads a key of its own, such as `git branch` and `color.branch`, needs that
 *   key overridden beside this one.
 *
 * **What is deliberately not overridden.** The locale is left alone, so git's
 * own diagnostics reach the user in the user's own language; every format read
 * here is a machine format that a locale does not move. `.mailmap` is turned
 * off with the command-line option `--no-use-mailmap` rather than by writing to
 * `log.mailmap`, because
 * `PersonTable` says identity is whatever git reported **before** a mailmap is
 * applied, and applying one is a later milestone's decision to take.
 */

/** Configuration overridden for every invocation, and nothing beyond it. */
export const PARSING_CONFIGURATION: readonly string[] = [
  '-c',
  'log.showSignature=false',
  '-c',
  'i18n.logOutputEncoding=UTF-8',
  '-c',
  'color.diff=never',
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

/** What a page shows when nothing was chosen: every branch, remote-tracking ones included. */
const EVERY_BRANCH: BranchSelection = { branches: null, showRemoteBranches: true };

/** The prefix of a local branch's full reference name. */
const LOCAL_BRANCHES = 'refs/heads/';

/** The prefix of a remote-tracking branch's full reference name. */
const REMOTE_BRANCHES = 'refs/remotes/';

/**
 * Whether one selected name is read: a local branch always, a remote-tracking
 * branch only while remote-tracking branches are shown, and only when the name is
 * one git's ref-name rules accept ({@link isRefName}); anything else never.
 *
 * The two checks make the list safe to put on a command line a renderer chose,
 * and each does a part of it. **The prefix**: a name that begins with
 * `refs/heads/` or `refs/remotes/` cannot begin with `-`, so no name can be read
 * by git as an option. **The ref-name rules**: the prefix alone let a revision
 * expression ride in behind a branch's name. Review round 04 of E03-M01 measured
 * `refs/heads/side...refs/stash` and `refs/heads/side..HEAD` passing it and git
 * reading the stash's and HEAD's commits; `isRefName` refuses both, because each
 * holds `..`, and with them every name holding the `~`, `^`, `:`, `@{` or
 * pattern characters the other revision expressions are made of. The fixtures
 * suite holds both of round 04's names on the `colour-config` fixture: the page
 * each selection gives holds neither the stash's commits nor HEAD's, where git
 * given the same names reads them (`git-colour.spec.ts`). A refused name is
 * dropped exactly as a name without either prefix is, and the rest of the
 * selection is read.
 *
 * **What neither check refuses.** A name that passes both is still resolved by
 * git's own rules for a name, which try it under `refs/`, `refs/tags/`,
 * `refs/heads/` and `refs/remotes/` as well as alone. So where `refs/heads/gone`
 * names no branch, a tag spelled `refs/heads/gone` — the reference
 * `refs/tags/refs/heads/gone` — is read in its place: git 2.51.0 printed that
 * tag's history for `log --ignore-missing refs/heads/gone --` on a scratch
 * repository with no branch `gone` (measured by E04-M01-S02). The Branches
 * dropdown builds a selection from the branches a page lists (E03-M01-S10), so
 * through it such a name can reach git only for a branch deleted since it was
 * chosen, in a repository holding a reference of that spelling; that is an
 * inference from how the dropdown builds names, not a measurement.
 */
function isReadBranch(name: string, showRemoteBranches: boolean): boolean {
  return (
    (name.startsWith(LOCAL_BRANCHES) || (showRemoteBranches && name.startsWith(REMOTE_BRANCHES))) &&
    isRefName(name)
  );
}

/**
 * The revisions a page's log walks from.
 *
 * **Every branch** is read as **every local branch, every remote-tracking branch
 * while they are shown, every tag, and HEAD** — the same set a user sees
 * without having chosen anything. With remote-tracking branches shown, that is
 * exactly the list every page was read with before selections existed, which
 * `git-selection.spec.ts` holds to the argument.
 *
 * It is spelled out rather than written `--all`, and the reason is measurable:
 * on the `stash` fixture, `--all` returns four commits and this list returns
 * two, because `--all` walks `refs/stash` as well and a stash is two commits of
 * git's own making. Git documents `--all` as every reference under `refs/`, so
 * whatever else a host or a tool has put there — notes, replacements, a
 * `refs/pull/*` namespace — is walked too. Only the stash was measured here;
 * the rest follows from what `--all` is documented to mean.
 *
 * **A selection** is read as the selected names alone, each a full reference
 * name, so a tag or a local branch of the same short name is never read in its
 * place: with a tag `side` beside a branch `side`, git 2.51.0 resolves `side` to
 * the tag and warns that it is ambiguous, and resolves `refs/heads/side` to the
 * branch (measured by E03-M01-S09 on a scratch repository).
 *
 * `--ignore-missing` is what lets a name be given that resolves to nothing. On
 * every branch that name is `HEAD`: in a repository with no commits yet, HEAD
 * resolves to nothing and naming it would otherwise be a fatal error rather
 * than an empty page. Under a selection it is a branch deleted since it was
 * chosen, which is skipped, and a selection whose every name is skipped reads
 * nothing: git 2.51.0 printed no commit for `--ignore-missing refs/heads/gone`
 * and exited 0, and printed the other branch's history alone for
 * `--ignore-missing refs/heads/gone refs/heads/side`, and it failed with `bad
 * revision` without `--ignore-missing` (measured by E03-M01-S09 on a scratch
 * repository; the fixture suite holds the first two on the `remotes` fixture).
 */
function revisionArgs(selection: BranchSelection): string[] {
  if (selection.branches === null) {
    return selection.showRemoteBranches
      ? ['--branches', '--tags', '--remotes', '--ignore-missing', 'HEAD']
      : ['--branches', '--tags', '--ignore-missing', 'HEAD'];
  }
  return [
    '--ignore-missing',
    ...selection.branches.filter((name) => isReadBranch(name, selection.showRemoteBranches)),
  ];
}

/**
 * Whether the log of a page under `selection` has any revision to walk from.
 *
 * It has none when a selection names no branch that is read. Git's log, given
 * no revision at all, walks HEAD — measured with git 2.51.0, where
 * `log --ignore-missing --` printed HEAD's history — so a selection naming
 * nothing would show HEAD's history rather than the nothing it names. The
 * adapter asks this before it runs the log, and does not run it when the answer
 * is no.
 */
export function selectsAnyRevision(selection: BranchSelection = EVERY_BRANCH): boolean {
  return (
    selection.branches === null ||
    selection.branches.some((name) => isReadBranch(name, selection.showRemoteBranches))
  );
}

/**
 * Read the newest `limit` commits of the branches `selection` shows.
 *
 * Which revisions those are is {@link revisionArgs}'s to say, and its comment
 * says why each is there.
 */
export function commitLogArgs(
  repositoryPath: string,
  limit: number,
  selection: BranchSelection = EVERY_BRANCH,
): string[] {
  return [
    ...baseArgs(repositoryPath),
    'log',
    '-z',
    `--format=${COMMIT_LOG_FORMAT}`,
    '--date=raw',
    '--no-use-mailmap',
    `--max-count=${String(limit)}`,
    ...revisionArgs(selection),
    '--',
  ];
}

/**
 * Read every reference that decorates a commit: the local branches, the
 * remote-tracking ones while they are shown, and the tags.
 *
 * It reads them whatever branches are selected, so a reference that is not
 * selected still labels a commit a selected branch reaches; a reference whose
 * commit is not on the page points at `UNKNOWN_INDEX`, as every reference past a
 * page always has.
 */
export function referenceArgs(repositoryPath: string, showRemoteBranches = true): string[] {
  return [
    ...baseArgs(repositoryPath),
    'for-each-ref',
    `--format=${REFERENCE_FORMAT}`,
    'refs/heads',
    ...(showRemoteBranches ? ['refs/remotes'] : []),
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
