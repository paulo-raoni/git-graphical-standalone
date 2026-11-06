import { detailsTargetOf, FailureKind } from '../contracts/index';
import type { CommitDetails, Result, UncommittedDetails } from '../contracts/index';
import {
  createChangedFilesParser,
  createCommitDetailsParser,
  createUncommittedStatusParser,
  finishChangedFiles,
  finishCommitDetails,
  finishUncommittedStatus,
  pushChangedFiles,
  pushCommitDetails,
  pushUncommittedStatus,
  uncommittedDetailsOf,
} from '../core/parse/index';
import type { DetailsQuery } from '../ports/index';

import { commitDetailsArgs, statusArgs, uncommittedDiffArgs } from './git-commands';
import { runGit } from './git-process';

/**
 * The details of one commit, or of the uncommitted changes: one git process for
 * a commit, two for the uncommitted changes, and nothing else.
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
 * No probe runs first, as one does before a page: the repository is the one the
 * window has open, and a path that is no longer a repository fails the read with
 * git's own message.
 */

/** What a request is told when it names neither a commit by its full object name nor the uncommitted changes. */
const NOT_A_TARGET =
  'The details asked for name neither a commit by its full object name nor the uncommitted changes.';

/** One commit's details, from one `git log`. */
async function readCommit(
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
