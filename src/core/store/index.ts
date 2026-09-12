/**
 * The columnar commit store: the single import surface later rings use.
 *
 * S03's parser feeds {@link appendCommit}. Nothing outside this folder needs the
 * hash index, the pending parent table or the growth helpers, so they are not
 * re-exported here.
 *
 * **Reading a built page is not here.** `commitCount`, `hexHashOf`, `subjectOf`,
 * `parentsOf`, `authorOf`, `committerOf` and `Person` are imported from
 * `src/contracts/`, because decoding an encoding the contract fixed has no
 * alternative implementation, while building one — interning, growth, hash
 * resolution — is policy that can be wrong
 * (`docs/ADR-0002-architecture-and-performance.md` decision 3, amended
 * 2026-09-12). They are deliberately not forwarded from here: a forwarding
 * barrel would leave the old imports working and the rings only nominally
 * separated.
 */
export {
  appendCommit,
  buildCommitColumns,
  createCommitStoreBuilder,
  retainedByteLength,
  storeWork,
} from './commit-store';
export type { AppendedCommit, CommitStoreBuilder, StoreCounters } from './commit-store';

export { INITIAL_COMMIT_CAPACITY } from './growth';
