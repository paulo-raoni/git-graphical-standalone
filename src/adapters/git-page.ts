import { FailureKind, HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../contracts/index';
import type { CommitColumns, Result } from '../contracts/index';
import {
  addStashReferences,
  buildRefs,
  buildWorkingTree,
  createCommitLogParser,
  createReferenceList,
  createReferenceParser,
  createStashListParser,
  createStatusParser,
  finishCommitLog,
  finishReferences,
  finishStashList,
  finishStatus,
  interleaveStashes,
  markDetachedFrom,
  pushCommitLog,
  pushReferences,
  pushStashList,
  pushStatus,
  resolveCommitRows,
  stashBaseNames,
} from '../core/parse/index';
import type { ReferenceList, StashList, StatusFacts } from '../core/parse/index';
import { shownWorkingTree } from '../core/page/index';
import { appendCommit, buildCommitColumns, createCommitStoreBuilder } from '../core/store/index';
import type { PageRequest, RepositoryPage } from '../ports/index';

import {
  commitLogArgs,
  referenceArgs,
  repositoryProbeArgs,
  selectsAnyRevision,
  stashArgs,
  statusArgs,
} from './git-commands';
import { runGit } from './git-process';

/**
 * One page of a repository: five git invocations, four parsers, one store.
 *
 * This module holds no rule about what the output means
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1). It obtains
 * bytes, hands them to `src/core/parse/`, and joins the four results at the one
 * point where they meet: a reference names an object, and the row that object
 * landed in is only known once the commits have been read.
 *
 * **The stash list is read first**, before the log, since E04-M01-S14: the log
 * needs it twice, for the commits the stashes were made on, which it is given as
 * further tips on every branch, and for the stash rows, which are put into its
 * stream (`interleaveStashes` of `src/core/parse/stash-list.ts`). The stashes'
 * references join the reference listing after it, as they did when the listing
 * read them itself, so the references keep their order. The invocations are the
 * same five.
 *
 * It does not lay out lanes and it does not build a `GraphPage`. Layout is S04's
 * and assembly is S06's.
 */

/** The commits of a page, and whether the repository has more of them. */
interface PagedCommits {
  readonly columns: CommitColumns;
  readonly hasMore: boolean;
}

/**
 * Read the commits, feeding each one to the store as its record completes.
 *
 * One more commit than the page is asked for, and the extra row is counted and
 * dropped rather than stored: it is how "are there more" is answered without a
 * second walk of the history, and it is the only reason this function counts at
 * all.
 *
 * A selection that names no branch to read runs no log at all and reads an empty
 * page, because a log given no revision walks HEAD (`selectsAnyRevision` in
 * `./git-commands.ts`).
 *
 * The rows counted are the log's commits with the stash rows put in among them
 * (`interleaveStashes`), so a page of a repository with stashes holds as many
 * rows as one without: the stash rows take the places of commits, which the next
 * page reads.
 */
async function readCommits(
  executable: string,
  request: PageRequest,
  stashes: StashList,
): Promise<Result<PagedCommits>> {
  const builder = createCommitStoreBuilder(request.pageSize);
  let seen = 0;
  if (!selectsAnyRevision(request.selection)) {
    return { ok: true, value: { columns: buildCommitColumns(builder), hasMore: false } };
  }
  const everyBranch = (request.selection?.branches ?? null) === null;
  const rows = interleaveStashes(stashes, everyBranch, (commit) => {
    seen += 1;
    if (seen <= request.pageSize) {
      appendCommit(builder, commit);
    }
  });
  const parser = createCommitLogParser(rows);
  const tips = everyBranch ? stashBaseNames(stashes) : [];
  const outcome = await runGit({
    executable,
    args: commitLogArgs(request.repositoryPath, request.pageSize + 1, request.selection, tips),
    onOutput: (chunk) => {
      pushCommitLog(parser, chunk);
    },
  });
  if (!outcome.ok) {
    return outcome;
  }
  finishCommitLog(parser);
  return {
    ok: true,
    value: { columns: buildCommitColumns(builder), hasMore: seen > request.pageSize },
  };
}

/** Read the stash entries, each into the commit of a stash row. */
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

/** Read the references, and put the stash entries after them in one list. */
async function readReferences(
  executable: string,
  request: PageRequest,
  stashList: StashList,
): Promise<Result<ReferenceList>> {
  const { repositoryPath } = request;
  const list = createReferenceList();
  const references = createReferenceParser(list);
  const named = await runGit({
    executable,
    args: referenceArgs(repositoryPath, request.selection?.showRemoteBranches),
    onOutput: (chunk) => {
      pushReferences(references, chunk);
    },
  });
  if (!named.ok) {
    return named;
  }
  finishReferences(references);
  addStashReferences(list, stashList);
  return { ok: true, value: list };
}

/** Read the working tree. */
async function readStatus(
  executable: string,
  repositoryPath: string,
): Promise<Result<StatusFacts>> {
  const parser = createStatusParser();
  const outcome = await runGit({
    executable,
    args: statusArgs(repositoryPath),
    onOutput: (chunk) => {
      pushStatus(parser, chunk);
    },
  });
  if (!outcome.ok) {
    return outcome;
  }
  finishStatus(parser);
  return { ok: true, value: parser.facts };
}

/**
 * Every object name whose row is wanted: the references, then HEAD's own commit.
 *
 * HEAD rides along at the end so that one pass over the page answers it too,
 * rather than a second pass answering one question.
 */
function targetsWithHead(list: ReferenceList, facts: StatusFacts): Uint8Array {
  const used = list.count * HASH_BYTE_LENGTH;
  const targets = new Uint8Array(used + (facts.hasHead ? HASH_BYTE_LENGTH : 0));
  targets.set(list.targets.subarray(0, used));
  if (facts.hasHead) {
    targets.set(facts.headHash, used);
  }
  return targets;
}

/** Join the four readings into the page the port promises, under the selection it was read for. */
function assemble(
  request: PageRequest,
  commits: PagedCommits,
  list: ReferenceList,
  facts: StatusFacts,
): RepositoryPage {
  const targets = targetsWithHead(list, facts);
  const rows = resolveCommitRows(
    targets,
    targets.length / HASH_BYTE_LENGTH,
    commits.columns.hashes,
    commits.columns.count,
  ).rows;
  const headRow = facts.hasHead ? (rows[list.count] ?? UNKNOWN_INDEX) : UNKNOWN_INDEX;
  markDetachedFrom(list, rows, facts.isDetached ? headRow : UNKNOWN_INDEX);
  return {
    commits: commits.columns,
    refs: buildRefs(list, rows),
    workingTree: shownWorkingTree(buildWorkingTree(facts, headRow), request.selection),
    hasMore: commits.hasMore,
  };
}

/**
 * One page of the repository at `request.repositoryPath`.
 *
 * The probe runs first and is the only place `FailureKind.NotARepository` comes
 * from: every other command would fail the same way on a path that is not a
 * repository, but only this one is asked a question whose whole answer is
 * whether it is.
 */
export async function readGitPage(
  executable: string,
  request: PageRequest,
): Promise<Result<RepositoryPage>> {
  const probe = await runGit({ executable, args: repositoryProbeArgs(request.repositoryPath) });
  if (!probe.ok) {
    return probe.kind === FailureKind.GitMissing
      ? probe
      : { ...probe, kind: FailureKind.NotARepository };
  }
  const stashes = await readStashes(executable, request.repositoryPath);
  if (!stashes.ok) {
    return stashes;
  }
  const commits = await readCommits(executable, request, stashes.value);
  if (!commits.ok) {
    return commits;
  }
  const references = await readReferences(executable, request, stashes.value);
  if (!references.ok) {
    return references;
  }
  const status = await readStatus(executable, request.repositoryPath);
  if (!status.ok) {
    return status;
  }
  return { ok: true, value: assemble(request, commits.value, references.value, status.value) };
}
