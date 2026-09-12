import type {
  ApplicationInfoResponse,
  ChooseFolderResponse,
  LoadMoreCommitsRequest,
  LoadMoreCommitsResponse,
  OpenRepositoryRequest,
  OpenRepositoryResponse,
  RefreshRequest,
  RefreshResponse,
} from './ipc';

/** The property the preload attaches the bridge to on the renderer's global. */
export const BRIDGE_GLOBAL_NAME = 'gitGraphical';

/**
 * The only surface the renderer has on the rest of the application.
 *
 * It is a fixed set of methods, one per channel, and not a generic `invoke`
 * that takes a channel name: a generic one would let anything running in the
 * page reach a channel the renderer was never meant to use, which is the whole
 * reason the bridge exists. Adding a capability here is a change to this file
 * and to the preload, and therefore visible in review.
 *
 * Every method resolves to a `Result`. None of them rejects on a failure the
 * user could be told about; a rejection here means the bridge itself is broken.
 */
export interface GitGraphicalBridge {
  /** Open a repository by absolute path. */
  readonly openRepository: (request: OpenRepositoryRequest) => Promise<OpenRepositoryResponse>;
  /** Show the folder chooser and report what the user picked. */
  readonly chooseFolder: () => Promise<ChooseFolderResponse>;
  /** Append more commits to the open repository's page. */
  readonly loadMoreCommits: (request: LoadMoreCommitsRequest) => Promise<LoadMoreCommitsResponse>;
  /** Re-read the open repository from disk. */
  readonly refresh: (request: RefreshRequest) => Promise<RefreshResponse>;
  /** Report the application's own versions. */
  readonly applicationInfo: () => Promise<ApplicationInfoResponse>;
}

declare global {
  interface Window {
    /**
     * The bridge the preload exposed. Present in every window this application
     * creates; absent in any other context, which is why the renderer must not
     * assume it when running outside the shell.
     */
    readonly gitGraphical: GitGraphicalBridge;
  }
}
