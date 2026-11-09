import { detailsTargetOf, FailureKind } from '../contracts/index';
import type { CommitDetails, Result, UncommittedDetails } from '../contracts/index';
import {
  createChangedFilesParser,
  createCommitDetailsParser,
  createStashListParser,
  createUncommittedStatusParser,
  finishChangedFiles,
  finishCommitDetails,
  finishStashList,
  finishUncommittedStatus,
  isStashCommit,
  pushChangedFiles,
  pushCommitDetails,
  pushStashList,
  pushUncommittedStatus,
  thirdParentOf,
  uncommittedDetailsOf,
  withUntrackedFiles,
} from '../core/parse/index';
import type { StashList } from '../core/parse/index';
import type { DetailsQuery } from '../ports/index';

import { commitDetailsArgs, stashArgs, statusArgs, uncommittedDiffArgs } from './git-commands';
import { runGit } from './git-process';

/**
 * The details of one commit, or of the uncommitted changes: one git process for
 * a commit (more for a commit with three parents, below), two for the
 * uncommitted changes, and nothing else.
 *
 * Like `./git-page.ts`, this holds no rule about what the output means
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1): it checks the
 * target with `detailsTargetOf` before anything of it reaches a command line,
 * runs git, and streams every chunk to the parsers of `src/core/parse/`. A
 * commit is read by a single `git log` (`commitDetailsArgs`); the uncommitted
 * changes by the status, which names HEAD's commit and lists the untracked
 * files, then a diff of the working tree against that commit
 * (`uncommittedDiffArgs`), which has to wait for the status to name it.
 *
 * **A stash's untracked files** (E04-M01-S14). A stash is read as any commit is,
 * so its files are its changes against the commit it was made on, its first
 * parent. A stash that holds untracked files keeps them in a commit of their own,
 * its third parent, and those files are listed after its own, as `untracked`.
 * Only a commit with exactly three parents may be such a stash, so only its read
 * asks the stash list whether it is one, and only a stash's reads its third
 * parent. An ordinary commit costs the one process it always did. A merge of
 * three branches costs two, or three in a repository with a stash, because
 * there `git stash list` starts a `git log` of its own; a stash with untracked
 * files costs four (counted by `git-details.spec.ts` from git's own trace).
 *
 * No probe runs first, as one does before a page: the repository is the one the
 * window has open, and a path that is no longer a repository fails the read with
 * git's own message.
 */

/** What a request is told when it names neither a commit by its full object name nor the uncommitted changes. */
const NOT_A_TARGET =
  'The details asked for name neither a commit by its full object name nor the uncommitted changes.';

/** One commit's details, from one `git log`, a stash's untracked files after its own. */
async function readCommit(
  executable: string,
  repositoryPath: string,
  hash: string,
): Promise<Result<CommitDetails>> {
  const read = await readOneCommit(executable, repositoryPath, hash);
  const third = read.ok ? thirdParentOf(read.value) : null;
  if (!read.ok || third === null) {
    return read;
  }
  const stashes = await readStashes(executable, repositoryPath);
  if (!stashes.ok) {
    return stashes;
  }
  if (!isStashCommit(hash, stashes.value)) {
    return read;
  }
  const untracked = await readOneCommit(executable, repositoryPath, third);
  if (!untracked.ok) {
    return untracked;
  }
  return { ok: true, value: withUntrackedFiles(read.value, untracked.value) };
}

/** The stash entries, which say whether a commit is a stash. */
async function readStashes(executable: string, repositoryPath: string): Promise<Result<StashList>> {
  const parser = createStashListParser();
  const outcome = await runGit({
    executable,
    args: stashArgs(repositoryPath),
    onOutput: (chunk) => {
      pushStashList(parser, chunk);
    },
  });
  if (!outcome.ok) {
    return outcome;
  }
  return { ok: true, value: finishStashList(parser) };
}

/** One commit's details and nothing more, from one `git log`. */
async function readOneCommit(
  executable: string,
  repositoryPath: string,
  hash: string,
): Promise<Result<CommitDetails>> {
  const parser = createCommitDetailsParser();
  const outcome = await runGit({
    executable,
    args: commitDetailsArgs(repositoryPath, hash),
    onOutput: (chunk) => {
      pushCommitDetails(parser, chunk);
    },
  });
  if (!outcome.ok) {
    return outcome;
  }
  return finishCommitDetails(parser, hash);
}

/** The uncommitted changes' details, from the status and then the diff it names the base of. */
async function readUncommitted(
  executable: string,
  repositoryPath: string,
): Promise<Result<UncommittedDetails>> {
  const status = createUncommittedStatusParser();
  const stated = await runGit({
    executable,
    args: statusArgs(repositoryPath),
    onOutput: (chunk) => {
      pushUncommittedStatus(status, chunk);
    },
  });
  if (!stated.ok) {
    return stated;
  }
  finishUncommittedStatus(status);
  const diff = createChangedFilesParser();
  const differed = await runGit({
    executable,
    args: uncommittedDiffArgs(repositoryPath, status.base),
    onOutput: (chunk) => {
      pushChangedFiles(diff, chunk);
    },
  });
  if (!differed.ok) {
    return differed;
  }
  return { ok: true, value: uncommittedDetailsOf(status, finishChangedFiles(diff)) };
}

/** The details `query` asks for, read with the git at `executable`. */
export async function readGitDetails(
  executable: string,
  query: DetailsQuery,
): Promise<Result<CommitDetails | UncommittedDetails>> {
  const target = detailsTargetOf(query.target);
  if (target === null) {
    return { ok: false, kind: FailureKind.GitFailed, message: NOT_A_TARGET };
  }
  if (target.kind === 'commit') {
    return readCommit(executable, query.repositoryPath, target.hash);
  }
  return readUncommitted(executable, query.repositoryPath);
}
