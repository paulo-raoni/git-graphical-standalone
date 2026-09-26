/**
 * The shared vocabulary of the whole application: the data the graph is made
 * of, and the contract that carries it between processes.
 *
 * This ring imports nothing — not a library, not a Node builtin, not another
 * ring — and holds no behaviour. It is the one thing the git adapter, the layout
 * core and the renderer share, which is what lets them be built in parallel
 * without touching each other's files.
 */
export { BRIDGE_GLOBAL_NAME } from './bridge';
export type { GitGraphicalBridge } from './bridge';

export { HASH_BYTE_LENGTH } from './commits';
export type { CommitColumns } from './commits';

/**
 * Reading a {@link CommitColumns}.
 *
 * These belong to this ring and not to `src/core/`, because the page is a
 * **compressed encoding** — binary object names, offset tables, one string blob
 * — and no consumer can read a single field of it without them. A data contract
 * whose consumers cannot read it is not a complete contract. None of them has an
 * alternative implementation either: changing what `hexHashOf` returns is
 * changing what the contract means, not choosing a different policy, which is
 * the test that keeps the **builder** in `src/core/store/`
 * (`docs/ADR-0002-architecture-and-performance.md` decision 3, amended
 * 2026-09-12, and `docs/plan/E01-commit-graph/M01-first-graph/S08-contract-decode-api.md`).
 *
 * This is what lets `src/ui/` draw a commit at all: the renderer may import this
 * ring and nothing else (`ui-only-contracts`), so with the decoders in `core/`
 * it could not read the page it is given.
 */
export {
  authorOf,
  commitCount,
  committerOf,
  hexHashOf,
  parentsOf,
  subjectOf,
} from './commit-columns';
export type { Person } from './commit-columns';

/**
 * Reading a {@link Refs}.
 *
 * Here for the same reason the page decoders above are, and by the same test:
 * a reference's name is the slice of the name blob between its two offsets and
 * cannot be anything else, so reading it back is the contract's own job. `Refs`
 * is a columnar block with a name blob and an offset table, so without these a
 * consumer of the contract has **no way to read a reference's name at all**,
 * which is the same incompleteness `CommitColumns` had before S08.
 */
export { refCommitOf, refCount, refFlagsOf, refKindOf, refNameOf } from './ref-list';

export type { GraphPage } from './graph-page';

export { UNKNOWN_INDEX } from './indices';

export { CHANNELS } from './ipc';
export type {
  ApplicationInfo,
  ApplicationInfoResponse,
  ChannelName,
  ChooseFolderResponse,
  ChosenFolder,
  LoadMoreCommitsRequest,
  LoadMoreCommitsResponse,
  OpenRepositoryRequest,
  OpenRepositoryResponse,
  RefreshRequest,
  RefreshResponse,
  StartupRepository,
  StartupRepositoryResponse,
} from './ipc';

export { RowFlag } from './layout';
export type { LayoutRows } from './layout';

export type { PersonTable } from './people';

export { RefFlag, RefKind } from './refs';
export type { Refs } from './refs';

export { FailureKind } from './result';
export type { Failure, Result, Success } from './result';

export type { WorkingTree } from './working-tree';
