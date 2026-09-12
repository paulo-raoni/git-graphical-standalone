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
} from './ipc';

export { RowFlag } from './layout';
export type { LayoutRows } from './layout';

export type { PersonTable } from './people';

export { RefFlag, RefKind } from './refs';
export type { Refs } from './refs';

export { FailureKind } from './result';
export type { Failure, Result, Success } from './result';

export type { WorkingTree } from './working-tree';
