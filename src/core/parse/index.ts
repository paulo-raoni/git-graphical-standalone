/**
 * The parsers: git's bytes in, contract values out, and nothing else.
 *
 * This is the single import surface the git adapter uses. Everything here is
 * pure — no process, no file system, no clock — which is why it sits in
 * `src/core/` and carries the project's highest gates
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1). The adapter's
 * job is to obtain bytes and to hand them over; every decision that can be wrong
 * about what those bytes mean is made here.
 */
export {
  COMMIT_LOG_FORMAT,
  createCommitLogParser,
  finishCommitLog,
  pushCommitLog,
} from './commit-log';
export type { CommitLogParser, CommitSink } from './commit-log';

export { resolveCommitRows } from './commit-lookup';

export { addReference, buildRefs, createReferenceList, markDetachedFrom } from './reference-list';
export type { ReferenceList } from './reference-list';

export {
  createReferenceParser,
  createStashParser,
  finishReferences,
  finishStashes,
  pushReferences,
  pushStashes,
  REFERENCE_FORMAT,
  STASH_FORMAT,
} from './reference-records';
export type { ReferenceParser } from './reference-records';

export {
  buildWorkingTree,
  createStatusParser,
  finishStatus,
  pushStatus,
} from './working-tree-status';
export type { StatusFacts, StatusParser } from './working-tree-status';
