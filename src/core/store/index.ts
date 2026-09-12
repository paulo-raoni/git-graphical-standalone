/**
 * The columnar commit store: the single import surface later rings use.
 *
 * S03's parser feeds {@link appendCommit}; S04 and S05 read a built page through
 * the accessors. Nothing outside this folder needs the hash index, the pending
 * parent table or the growth helpers, so they are not re-exported here.
 */
export {
  commitCount,
  hexHashOf,
  subjectOf,
  parentsOf,
  authorOf,
  committerOf,
} from './commit-columns';
export type { Person } from './commit-columns';

export {
  appendCommit,
  buildCommitColumns,
  createCommitStoreBuilder,
  retainedByteLength,
  storeWork,
} from './commit-store';
export type { AppendedCommit, CommitStoreBuilder, StoreCounters } from './commit-store';

export { INITIAL_COMMIT_CAPACITY } from './growth';
