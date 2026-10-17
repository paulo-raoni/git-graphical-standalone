import { FailureKind, HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../contracts/index';
import type { CommitColumns, Result } from '../contracts/index';
import {
  buildRefs,
  buildWorkingTree,
  createCommitLogParser,
  createReferenceList,
  createReferenceParser,
  createStashParser,
  createStatusParser,
  finishCommitLog,
  finishReferences,
  finishStashes,
  finishStatus,
  markDetachedFrom,
  pushCommitLog,
  pushReferences,
  pushStashes,
  pushStatus,
  resolveCommitRows,
} from '../core/parse/index';
import type { ReferenceList, StatusFacts } from '../core/parse/index';
import { appendCommit, buildCommitColumns, createCommitStoreBuilder } from '../core/store/index';
import type { PageRequest, RepositoryPage } from '../ports/index';

import {
  commitLogArgs,
  referenceArgs,
  repositoryProbeArgs,
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
 * One more commit than the page is asked for, and the extra one is counted and
 * dropped rather than stored: it is how "are there more" is answered without a
 * second walk of the history, and it is the only reason this function counts at
 * all.
 */
async function readCommits(
  executable: string,
  request: PageRequest,
): Promise<Result<PagedCommits>> {
  const builder = createCommitStoreBuilder(request.pageSize);
  let seen = 0;
  const parser = createCommitLogParser((commit) => {
    seen += 1;
    if (seen <= request.pageSize) {
      appendCommit(builder, commit);
    }
  });
  const outcome = await runGit({
    executable,
    args: commitLogArgs(request.repositoryPath, request.pageSize + 1),
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

/** Read the references and the stash entries into one list. */
async function readReferences(
  executable: string,
  repositoryPath: string,
): Promise<Result<ReferenceList>> {
  const list = createReferenceList();
  const references = createReferenceParser(list);
  const named = await runGit({
    executable,
    args: referenceArgs(repositoryPath),
    onOutput: (chunk) => {
      pushReferences(references, chunk);
    },
  });
  if (!named.ok) {
    return named;
  }
  finishReferences(references);
  const stashes = createStashParser(list);
  const stashed = await runGit({
    executable,
    args: stashArgs(repositoryPath),
    onOutput: (chunk) => {
      pushStashes(stashes, chunk);
    },
  });
  if (!stashed.ok) {
    return stashed;
  }
  finishStashes(stashes);
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

/** Join the four readings into the page the port promises. */
function assemble(commits: PagedCommits, list: ReferenceList, facts: StatusFacts): RepositoryPage {
  const targets = targetsWithHead(list, facts);
  const rows = resolveCommitRows(
    targets,
    targets.length / HASH_BYTE_LENGTH,
    commits.columns.hashes,
    commits.columns.count,
  );
  const headRow = facts.hasHead ? (rows[list.count] ?? UNKNOWN_INDEX) : UNKNOWN_INDEX;
  markDetachedFrom(list, rows, facts.isDetached ? headRow : UNKNOWN_INDEX);
  return {
    commits: commits.columns,
    refs: buildRefs(list, rows),
    workingTree: buildWorkingTree(facts, headRow),
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
  const commits = await readCommits(executable, request);
  if (!commits.ok) {
    return commits;
  }
  const references = await readReferences(executable, request.repositoryPath);
  if (!references.ok) {
    return references;
  }
  const status = await readStatus(executable, request.repositoryPath);
  if (!status.ok) {
    return status;
  }
  return { ok: true, value: assemble(commits.value, references.value, status.value) };
}
