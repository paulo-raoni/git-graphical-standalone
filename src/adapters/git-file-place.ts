import { detailsTargetOf, FailureKind } from '../contracts/index';
import type { ChangedFile, Result } from '../contracts/index';
import {
  createChangedFilesParser,
  currentPathOf,
  finishChangedFiles,
  pushChangedFiles,
} from '../core/parse/index';
import type { FilePlace, FilePlaceQuery } from '../ports/index';

import { topLevelArgs, uncommittedDiffArgs } from './git-commands';
import { runGit } from './git-process';

/**
 * Where a changed file is (E04-M01-S10): the repository's top level, which an
 * absolute path is made from, and, for a file of a commit or a stash, where the
 * working tree has it now.
 *
 * Like `./git-details.ts` it holds no rule about what the output means: the rule
 * that follows a rename is `currentPathOf` of `src/core/parse/`. It starts git
 * only when asked: one process for the top level, and one more for the diff that
 * follows a commit's file. The uncommitted changes' path is the working tree's
 * already, so it starts no diff; a refused target starts nothing.
 *
 * The path is not checked here: the main process checks the whole request once
 * (`fileActionRequestOf` of `src/contracts/file-action.ts`) before it asks, and
 * the path never reaches a command line in any case, because it is only compared
 * with the paths git printed. The target does reach one, and is checked again.
 */

/** What a request is told when it names neither a commit by its full object name nor the uncommitted changes. */
const NOT_A_TARGET =
  'The file asked for is in neither a commit by its full object name nor the uncommitted changes.';

/** The top level, from `git rev-parse --show-toplevel`. */
async function readTopLevel(executable: string, repositoryPath: string): Promise<Result<string>> {
  const chunks: Uint8Array[] = [];
  const outcome = await runGit({
    executable,
    args: topLevelArgs(repositoryPath),
    onOutput: (chunk) => {
      chunks.push(chunk);
    },
  });
  if (!outcome.ok) {
    return outcome;
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks)).replace(/\r?\n$/, '');
  if (text === '') {
    return { ok: false, kind: FailureKind.GitFailed, message: 'Git printed no top level.' };
  }
  return { ok: true, value: text };
}

/** The changes of the working tree's tracked files against `hash`. */
async function readChangesSince(
  executable: string,
  repositoryPath: string,
  hash: string,
): Promise<Result<ChangedFile[]>> {
  const parser = createChangedFilesParser();
  const outcome = await runGit({
    executable,
    args: uncommittedDiffArgs(repositoryPath, hash),
    onOutput: (chunk) => {
      pushChangedFiles(parser, chunk);
    },
  });
  if (!outcome.ok) {
    return outcome;
  }
  return { ok: true, value: finishChangedFiles(parser) };
}

/** The place `query` asks for, read with the git at `executable`. */
export async function readGitFilePlace(
  executable: string,
  query: FilePlaceQuery,
): Promise<Result<FilePlace>> {
  const target = detailsTargetOf(query.target);
  if (target === null) {
    return { ok: false, kind: FailureKind.GitFailed, message: NOT_A_TARGET };
  }
  const top = await readTopLevel(executable, query.repositoryPath);
  if (!top.ok) {
    return top;
  }
  if (!query.follow || target.kind === 'uncommitted') {
    return { ok: true, value: { top: top.value, path: query.path } };
  }
  const changes = await readChangesSince(executable, query.repositoryPath, target.hash);
  if (!changes.ok) {
    return changes;
  }
  return { ok: true, value: { top: top.value, path: currentPathOf(changes.value, query.path) } };
}
